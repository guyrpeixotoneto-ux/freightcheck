/**
 * A camada de linguagem — e o que ela está proibida de fazer.
 *
 * **O modelo não é a fonte da resposta; ele é a redação dela.** Tudo o que ele
 * recebe já foi recuperado por `recuperacao.ts` e `dados.ts`: os artigos que
 * este repositório aprovou e os números que este banco devolveu, com o recorte
 * de quem perguntou. A tarefa dele é escrever isso em português corrido. Se o
 * dossiê não contiver a resposta, a tarefa dele é dizer que não contém.
 *
 * **Por que não deixar o modelo consultar sozinho.** Porque este produto existe
 * para não exibir número sem lastro, e um modelo que compõe o número a partir do
 * que sabe do mundo produz exatamente isso — com a mesma fluência de quando
 * acerta. Fechar o material antes de escrever é o que torna a resposta
 * conferível: o dossiê vai junto para a tela, e quem discordar do texto compara
 * um com o outro.
 *
 * **Sem chave configurada, o produto não perde a função.** `redigir` devolve
 * `null` e `resposta.ts` monta o texto em código, do mesmo material. A tela diz
 * qual dos dois caminhos escreveu o que está sendo lido — quem confia num
 * assistente merece saber se um modelo participou.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * `claude-opus-5` por padrão.
 *
 * A variável existe para o dia em que este produto precisar de outro modelo sem
 * um deploy de código; o padrão é o mais capaz porque o custo aqui é uma
 * resposta por pergunta digitada, não um laço.
 */
const MODELO = process.env.ASSISTENTE_MODELO?.trim() || "claude-opus-5";

/**
 * Esforço médio: a tarefa é redigir sobre material fechado, não descobrir nada.
 *
 * `alto` gastaria tokens de raciocínio decidindo o que já foi decidido em
 * código; `baixo` começou a produzir respostas que ignoravam ressalvas do
 * dossiê — que é justamente o que não pode acontecer aqui.
 */
const ESFORCO = (process.env.ASSISTENTE_ESFORCO?.trim() ||
  "medium") as "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Teto de saída, não alvo.
 *
 * Precisa acomodar raciocínio **mais** texto: no Claude Opus 5 o pensamento é
 * ligado por padrão e consome deste mesmo teto. Um valor apertado aqui não
 * produz resposta curta — produz resposta cortada no meio.
 */
const MAX_TOKENS = 16000;

const INSTRUCAO = `Você é o Assistente de IA do FreightCheck, um produto que audita os modelos de
remuneração que a Ambev entrega pelas planilhas do Freightec. Quem fala com você
opera esse produto: analistas de logística e de custos, em português do Brasil.

## A regra que vale acima de todas

Responda **exclusivamente** a partir do DOSSIÊ que acompanha a pergunta. O
dossiê tem duas partes: CONHECIMENTO (texto aprovado sobre como o produto
funciona) e DADOS (números consultados agora no banco, dentro do recorte de quem
perguntou).

- **Nunca escreva um número que não esteja no dossiê.** Não estime, não some
  valores de periodicidades diferentes, não converta mensal em anual, não
  complete uma série, não calcule médias que o dossiê não trouxe.
- **Nunca descreva um comportamento do produto que o dossiê não afirme.** Se
  perguntarem sobre uma tela ou regra que o dossiê não cobre, diga que não sabe
  e aponte onde a pessoa pode olhar.
- Se o dossiê responder só parte da pergunta, responda essa parte e diga
  explicitamente qual parte ficou de fora e por quê.
- Se o dossiê estiver vazio ou não tiver relação com a pergunta, diga isso em
  uma ou duas frases e sugira o que perguntar em vez disso. Não improvise.

Conhecimento geral seu sobre logística, contabilidade ou sobre outros produtos
não entra na resposta. Se ele contradisser o dossiê, o dossiê vence.

## Como escrever

- Português do Brasil, direto, sem saudação e sem preâmbulo. Comece pela
  resposta.
- Curto: dois a cinco parágrafos curtos, ou uma lista quando a pergunta pedir
  uma. Prosa, não relatório.
- Ao citar um número do dossiê, cite-o exatamente como está lá, **com a
  ressalva que o acompanha**. Um valor com periodicidade nunca aparece sem ela.
  "0% de cobertura" nunca vira "sem impacto".
- Não repita o dossiê inteiro nem liste os fatos um a um: a tela já mostra os
  fatos ao lado da sua resposta. Escreva o que eles significam para a pergunta
  feita.
- Não invente nomes de telas, botões ou campos. Use os que o dossiê nomeia.
- Não escreva markdown de cabeçalho (\`#\`). Negrito e listas simples estão bem.`;

export interface PedidoDeRedacao {
  pergunta: string;
  /** O dossiê já montado: conhecimento e dados, em texto. */
  dossie: string;
}

/** Há modelo configurado? A tela usa isto para dizer em que modo está. */
export function disponivel(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim(),
  );
}

/** O modelo que responderia, para a tela poder dizê-lo. */
export function modeloConfigurado(): string | null {
  return disponivel() ? MODELO : null;
}

let cliente: Anthropic | null = null;

function obterCliente(): Anthropic {
  // O cliente é criado uma vez: ele carrega o pool de conexões HTTP, e um por
  // requisição desperdiçaria o handshake em toda pergunta digitada.
  cliente ??= new Anthropic();
  return cliente;
}

/**
 * Escreve a resposta sobre o dossiê. `null` quando não há como — e nunca lança.
 *
 * Toda falha desta função é recuperável por definição: existe uma redação
 * determinística esperando do outro lado. Derrubar o pedido porque a API de
 * linguagem está fora deixaria o produto sem responder uma pergunta que ele
 * sabe responder.
 */
export async function redigir(pedido: PedidoDeRedacao): Promise<string | null> {
  if (!disponivel()) return null;

  try {
    const resposta = await obterCliente().beta.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      output_config: { effort: ESFORCO },
      /*
        Recusa de classificador é resposta possível, não erro de infraestrutura.
        `fallbacks: "default"` manda o pedido recusado para o modelo que a
        Anthropic recomenda para aquela categoria, dentro da mesma chamada — o
        que importa aqui porque uma pergunta legítima sobre custo de frota não
        deve ficar sem resposta por um falso positivo.
      */
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        {
          type: "text",
          text: INSTRUCAO,
          // A instrução é byte a byte a mesma em toda pergunta; o dossiê, que
          // muda sempre, vem depois dela na mensagem do usuário.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `# DOSSIÊ\n\n${pedido.dossie}\n\n# PERGUNTA\n\n${pedido.pergunta}`,
        },
      ],
    });

    // `stop_reason` antes de `content`: numa recusa o conteúdo vem vazio, e ler
    // `content[0]` sem checar é como esta chamada quebraria em produção.
    if (resposta.stop_reason === "refusal") return null;

    const texto = resposta.content
      .filter((bloco): bloco is Anthropic.Beta.BetaTextBlock => bloco.type === "text")
      .map((bloco) => bloco.text)
      .join("\n")
      .trim();

    return texto || null;
  } catch {
    // Silêncio deliberado: o chamador já tem um caminho completo sem isto, e o
    // erro em si não diz nada a quem digitou a pergunta.
    return null;
  }
}
