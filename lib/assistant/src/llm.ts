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

const INSTRUCAO = `Você é o Assistente do FreightCheck, um produto que audita os modelos de
remuneração que a Ambev entrega pelas planilhas do Freightec. Quem fala com você
opera esse produto: analistas de logística e de custos, em português do Brasil.

## A regra que vale acima de todas

Responda **exclusivamente** a partir do DOSSIÊ. Ele traz o que a orquestração
recuperou para esta pergunta: CONCEITO (trechos aprovados do catálogo do
Freightech, do índice do Book e dos artigos do produto), EVIDÊNCIA (resultados
de consultas feitas agora, no recorte de quem perguntou) e LACUNAS (o que
sabidamente falta).

- **Nunca escreva um número que não esteja no dossiê.** Não estime, não some
  periodicidades diferentes, não converta mensal em anual, não calcule médias,
  não complete séries. Se um número seria útil e não está lá, diga que não foi
  apurado.
- Ao citar um valor, cite-o **como está escrito**, com a ressalva que o
  acompanha. Valor em dinheiro nunca aparece sem a periodicidade. "0% de
  cobertura" nunca vira "sem impacto".
- **As LACUNAS são obrigatórias.** Se o dossiê traz uma, ela entra na resposta.
  São as quatro formas de não saber, e elas não se confundem:
  não encontrei · não existe no produto · o Freightech tem o conceito e este
  export não traz a coluna · há dado e não dá para precificar.

## Como escrever

- Comece **respondendo a pergunta**. Nada de preâmbulo, nada de saudação, nada
  de repetir a pergunta.
- Adapte o tamanho: pergunta simples, resposta curta; pergunta analítica,
  resposta mais funda; pergunta executiva, o que decide primeiro.
- Prosa. Listas só quando forem mesmo uma lista; tabela só quando a comparação
  exigir colunas.
- Não repita o dossiê inteiro nem enumere os fatos um a um — a tela mostra as
  fontes ao lado. Escreva o que eles significam para a pergunta feita.

- Não invente nomes de tela, botão ou campo. Use os que o dossiê nomeia.
- Não escreva cabeçalho markdown (\`#\`). Negrito e listas simples estão bem.
- Não mencione ferramentas, consultas, intenção nem orquestração: quem lê quer
  a resposta, não a implementação.

## Citações

Cada item do dossiê vem numerado — \`[1]\`, \`[2]\`. Ponha o número **no fim da
frase** que se apoia naquele item, antes do ponto: "o consumo negociado caiu em
onze veículos [2]". É assim que quem lê audita o que você escreveu.

- Toda frase com número, regra, fórmula ou conceito específico do FreightCheck
  leva citação. Frase de ligação, não.
- Use só os números que existem no dossiê. Citar \`[4]\` quando há três itens é
  o mesmo que inventar a fonte, e a resposta inteira é descartada por isso.
- Um número por frase costuma bastar. Não empilhe \`[1][2][3]\`.

Conhecimento seu sobre logística, contabilidade ou outros produtos não entra na
resposta. Se contradisser o dossiê, o dossiê vence.`;

export interface PedidoDeRedacao {
  pergunta: string;
  dossie: DossieParaRedacao;
}

/** O que o modelo precisa ver — nada além. */
export interface DossieParaRedacao {
  trechos: { trecho: { titulo: string; fonte: string; texto: string } }[];
  evidencias: {
    titulo: string;
    origem: string;
    fatos: { rotulo: string; valor: string; detalhe?: string }[];
    nota?: string;
    recorte?: { contexto: string; vigencia?: string; intervalo?: string };
  }[];
  lacunas: { tipo: string; explicacao: string }[];
  desambiguacao: { termo: string; opcoes: string[] } | null;
}

/**
 * O dossiê em texto, na ordem em que o modelo deve lê-lo.
 *
 * Conceito primeiro, evidência depois, lacuna por último — a mesma ordem que a
 * resposta deve ter. Um dossiê montado na ordem inversa produz resposta que
 * abre pelo número, que é o defeito que esta versão existe para corrigir.
 */
function emTexto(d: DossieParaRedacao): string {
  const partes: string[] = [];
  /*
    A numeração é a mesma de `montarFontes`: trechos primeiro, evidências
    depois, na ordem em que estão. As duas listas precisam contar juntas — se
    divergirem, o `[2]` que o modelo escreve aponta para a fonte errada na tela,
    e uma citação que aponta para outro lugar é pior que citação nenhuma.
  */
  let n = 1;

  if (d.desambiguacao) {
    partes.push(
      `## AMBIGUIDADE\n\n"${d.desambiguacao.termo}" casa mais de uma gaveta: ` +
        `${d.desambiguacao.opcoes.join(", ")}. Peça para a pessoa escolher, sem responder ainda.`,
    );
  }

  if (d.trechos.length > 0) {
    partes.push(
      "## CONCEITO\n\n" +
        d.trechos
          .map(
            (t) =>
              `### [${n++}] ${t.trecho.titulo}\n(fonte: ${t.trecho.fonte})\n\n${t.trecho.texto}`,
          )
          .join("\n\n"),
    );
  }

  if (d.evidencias.length > 0) {
    partes.push(
      "## EVIDÊNCIA (consultada agora)\n\n" +
        d.evidencias
          .map((e) => {
            const recorte = e.recorte
              ? `recorte: ${[e.recorte.contexto, e.recorte.vigencia ?? e.recorte.intervalo]
                  .filter(Boolean)
                  .join(" · ")}\n`
              : "";
            const fatos = e.fatos
              .map((f) => `- ${f.rotulo}: ${f.valor}${f.detalhe ? ` — ${f.detalhe}` : ""}`)
              .join("\n");
            return `### [${n++}] ${e.titulo}\n${recorte}(origem: ${e.origem})\n${fatos}${
              e.nota ? `\nRessalva: ${e.nota}` : ""
            }`;
          })
          .join("\n\n"),
    );
  }

  if (d.lacunas.length > 0) {
    partes.push(
      "## LACUNAS (dizer na resposta)\n\n" +
        d.lacunas.map((l) => `- [${l.tipo}] ${l.explicacao}`).join("\n"),
    );
  }

  return partes.join("\n\n") || "(vazio)";
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
          content: `# DOSSIÊ\n\n${emTexto(pedido.dossie)}\n\n# PERGUNTA\n\n${pedido.pergunta}`,
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
