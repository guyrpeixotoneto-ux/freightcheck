/**
 * A camada de linguagem do Agente de Compras — e o que ela está proibida de
 * fazer.
 *
 * **O modelo não decide preço nenhum.** Quando esta função é chamada, o
 * preço-alvo, o teto, as diferenças e o veredito já existem: foram calculados
 * pelo motor econômico sobre a remuneração que o acervo devolveu. A tarefa do
 * modelo é uma só — escrever aquilo como um colega sênior de compras
 * escreveria, com a conta aberta ao lado.
 *
 * É a mesma arquitetura do Assistente (`lib/assistant/src/llm.ts`), e aqui ela
 * é mais estrita por um motivo concreto: a resposta do Assistente é lida por
 * quem audita, e a deste vai para uma mesa de negociação. Um número inventado
 * ali vira um pedido de compra.
 *
 * **Sem chave, o produto não perde a função.** `redigir` devolve `null` e a
 * redação em código (`redacao.ts`) responde a mesma pergunta com o mesmo
 * material. A tela diz em qual dos dois modos está — quem confia num agente de
 * compras merece saber se um modelo participou.
 */

import Anthropic from "@anthropic-ai/sdk";

/** O mesmo padrão do Assistente, com variável própria para poder divergir. */
export const MODELO =
  process.env.COMPRAS_MODELO?.trim() || process.env.ASSISTENTE_MODELO?.trim() || "claude-opus-5";

/**
 * Esforço médio: a tarefa é redigir sobre material fechado.
 *
 * `alto` gastaria raciocínio decidindo o que o motor já decidiu; `baixo` começou
 * a produzir textos que omitiam a ressalva do catálogo — que é justamente o que
 * não pode faltar numa resposta sobre preço de pneu.
 */
const ESFORCO = (process.env.COMPRAS_ESFORCO?.trim() || "medium") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const MAX_TOKENS = 8000;

const INSTRUCAO = `Você é o **Agente de Compras** do FreightCheck. Quem fala com você decide
aquisições numa transportadora que opera para a Ambev: pneu, manutenção,
combustível, uniforme, telefonia, frota leve. Fale português do Brasil, como um
colega sênior de compras que está com a planilha de remuneração aberta ao lado.

## O que já foi decidido antes de você

A ANÁLISE desta mensagem é o resultado de um **motor econômico determinístico**.
Preço-alvo, teto, diferenças, margens e impacto já estão calculados, sobre a
remuneração que a Ambev paga naquela vigência. Você não calcula nada e não
escolhe nada.

## As quatro regras que não se negociam

1. **Nenhum valor em reais que não esteja na ANÁLISE.** Não arredonde para um
   número "mais negociável", não estime, não converta mensal em anual, não some
   itens, não projete o ano. Todo valor que você escrever é conferido contra a
   análise antes de chegar à tela; um valor a mais e o texto inteiro é
   descartado.
2. **Separe confirmado de estimado.** A análise marca cada dado. Vida útil e
   unidades por ativo quase sempre são premissa, e o texto tem de dizê-lo — um
   preço-alvo apoiado em premissa estimada apresentado como apurado é o pior
   resultado possível deste produto.
3. **A ressalva vem antes do número.** Quando o item tem ressalva de catálogo
   (a coluna que a fonte não preenche, a razão sem base), ela aparece antes de
   qualquer conclusão. "R$ 0,00" sem a ressalva faz parecer que a Ambev não
   remunera aquilo.
4. **O que falta é resposta.** Sem quantidade não há impacto total; sem cotação
   não há veredito; sem vida útil não há preço-alvo. Diga o que falta e o que
   fazer para destravar, em vez de responder pela metade.

## Como escrever

Comece pelo que quem está no telefone precisa em duas linhas: preço-alvo, teto
e, havendo proposta, o veredito e a diferença. Depois a conta — a remuneração
usada, a vigência, as premissas, o que é confirmado e o que é estimado. Nada de
saudação e nada de resumo do que você vai fazer.

Não invente fornecedor, prazo, qualidade ou histórico de compra: este acervo não
tem nada disso. Ele tem o modelo de remuneração e as cotações que quem compra
registrou.`;

export function disponivel(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim(),
  );
}

export function modeloConfigurado(): string | null {
  return disponivel() ? MODELO : null;
}

let cliente: Anthropic | null = null;

function obterCliente(): Anthropic {
  cliente ??= new Anthropic({
    timeout: (() => {
      const bruto = Number(process.env["COMPRAS_TIMEOUT_MS"]);
      return Number.isFinite(bruto) && bruto > 0 ? bruto : 120_000;
    })(),
    maxRetries: 1,
  });
  return cliente;
}

export interface PedidoDeRedacao {
  pergunta: string;
  /** A análise fechada, já em texto — a redação determinística serve de dossiê. */
  analise: string;
  /** Os turnos anteriores, do mais antigo para o mais recente. */
  historico?: { papel: "PERGUNTA" | "RESPOSTA"; texto: string }[];
}

/** Quantos turnos acompanham a pergunta. Quatro perguntas e quatro respostas. */
export const TURNOS_NO_HISTORICO = 8;
const LIMITE_DO_TURNO = 2000;

export interface Redacao {
  texto: string | null;
  /** IA, SEM_CHAVE, RECUSA ou ERRO — para o painel técnico, nunca para a leitura. */
  desfecho: "IA" | "SEM_CHAVE" | "RECUSA" | "ERRO";
  modelo: string;
  latenciaMs: number;
  erro: string | null;
}

/**
 * Escreve a resposta sobre a análise. Nunca lança.
 *
 * Toda falha aqui é recuperável por definição: há uma redação determinística do
 * outro lado, com o mesmo material. Derrubar o pedido porque a API de linguagem
 * está fora deixaria o produto sem responder uma pergunta que ele sabe
 * responder — e deixaria quem está negociando sem o número.
 */
export async function redigir(pedido: PedidoDeRedacao): Promise<Redacao> {
  if (!disponivel()) {
    return { texto: null, desfecho: "SEM_CHAVE", modelo: MODELO, latenciaMs: 0, erro: null };
  }

  const inicio = Date.now();
  try {
    const resposta = await obterCliente().beta.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      output_config: { effort: ESFORCO },
      /*
        Recusa de classificador é resposta possível, não erro de infraestrutura:
        uma pergunta legítima sobre preço de pneu não deve ficar sem resposta
        por um falso positivo. Mesma decisão do Assistente.
      */
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: [
        {
          type: "text" as const,
          text: INSTRUCAO,
          /* Byte a byte a mesma em toda pergunta — o que muda vem nas mensagens. */
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: montarMensagens(pedido),
    });

    if (resposta.stop_reason === "refusal") {
      return {
        texto: null,
        desfecho: "RECUSA",
        modelo: MODELO,
        latenciaMs: Date.now() - inicio,
        erro: null,
      };
    }

    const texto = resposta.content
      .filter((bloco): bloco is Anthropic.Beta.BetaTextBlock => bloco.type === "text")
      .map((bloco) => bloco.text)
      .join("\n")
      .trim();

    return {
      texto: texto || null,
      desfecho: "IA",
      modelo: MODELO,
      latenciaMs: Date.now() - inicio,
      erro: null,
    };
  } catch (erro) {
    return {
      texto: null,
      desfecho: "ERRO",
      modelo: MODELO,
      latenciaMs: Date.now() - inicio,
      erro: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

function montarMensagens(pedido: PedidoDeRedacao): Anthropic.Beta.BetaMessageParam[] {
  const mensagens: Anthropic.Beta.BetaMessageParam[] = [];

  for (const turno of (pedido.historico ?? []).slice(-TURNOS_NO_HISTORICO)) {
    mensagens.push({
      role: turno.papel === "PERGUNTA" ? "user" : "assistant",
      content: turno.texto.slice(0, LIMITE_DO_TURNO),
    });
  }

  mensagens.push({
    role: "user",
    content: `PERGUNTA\n${pedido.pergunta}\n\nANÁLISE (fechada — todo valor que você citar tem de estar aqui)\n${pedido.analise}`,
  });

  return mensagens;
}
