import type { ErrorRequestHandler, RequestHandler } from "express";

/**
 * O contrato desta API, sustentado pelo servidor — e não por cada rota.
 *
 * A interface toda foi escrita sobre uma promessa: **toda resposta daqui é
 * JSON, mesmo quando é erro.** Está dito por extenso em
 * `lib/transporte.ts`, do lado do navegador, e é dela que sai a
 * classificação do que deu errado: corpo que não é JSON significa "não foi a
 * nossa API que respondeu — foi um proxy, um roteador, uma página de erro do
 * ambiente", e manda quem investiga para a plataforma.
 *
 * O servidor não cumpria essa promessa. Ela era cumprida rota a rota, dentro
 * de um `try/catch` por handler, e **nada** cobria o que passa por fora deles:
 *
 *   - caminho que não casa com rota nenhuma → `text/html` com 404;
 *   - corpo JSON malformado, recusado pelo `express.json()` antes de qualquer
 *     rota → `text/html` com 400;
 *   - exceção lançada fora de um `try` (ou dentro do próprio `catch`) →
 *     `text/html` com 500, cujo `<pre>` diz `Internal Server Error`.
 *
 * Os três vêm do `finalhandler`, que o Express monta quando ninguém mais
 * respondeu. Ele é a resposta certa para um servidor genérico e a errada para
 * este: o corpo em HTML faz a tela concluir que a requisição nem chegou à API,
 * e manda procurar um processo derrubado que está de pé o tempo todo. Um erro
 * interno passa a se parecer com uma falha de infraestrutura — que é a
 * confusão mais cara que este repositório já pagou.
 *
 * Os dois handlers abaixo fecham a promessa no único lugar onde ela pode ser
 * fechada por inteiro: depois de todas as rotas, para tudo o que sobrou.
 */

/** O `code` que a interface lê quando não há rota para o caminho pedido. */
export const CODIGO_ROTA_DESCONHECIDA = "ROTA_DESCONHECIDA";

/** O `code` de qualquer falha não prevista — a que antes virava HTML. */
export const CODIGO_ERRO_INTERNO = "ERRO_INTERNO";

/**
 * O `code` do pedido que não pôde ser aceito como veio.
 *
 * Separado de `ERRO_INTERNO` porque as duas mandam fazer coisas opostas: uma é
 * "corrija o que você enviou", a outra é "não há o que você possa fazer daqui".
 * Responder as duas com o mesmo código faria a tela dar o mesmo conselho para
 * um JSON truncado e para um banco fora do ar.
 */
export const CODIGO_PEDIDO_INVALIDO = "PEDIDO_INVALIDO";

/**
 * O detalhe da exceção sai na resposta?
 *
 * Fora de produção, sim: quem está desenvolvendo tem o processo à mão e o
 * detalhe economiza uma ida ao log. Em produção é uma decisão explícita —
 * `API_ERRO_DETALHADO=1` —, porque mensagem de exceção carrega nome de tabela,
 * trecho de SQL e, às vezes, valor que veio do banco.
 *
 * **O que não depende da chave:** o `requestId`. Ele sai sempre, nas duas
 * pontas — na resposta e na linha de log —, e é o que permite a quem está na
 * tela dizer *qual* chamada falhou para quem consegue ler o log. Sem ele, "deu
 * 500" e "o log tem 400 linhas" são dois fatos que não se encontram.
 */
function podeDetalhar(): boolean {
  if (process.env["API_ERRO_DETALHADO"] === "1") return true;
  return process.env["NODE_ENV"] !== "production";
}

function detalheDe(err: unknown): string | undefined {
  if (!podeDetalhar()) return undefined;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * O status que o erro já trazia, quando ele é uma recusa e não uma falha.
 *
 * O `express.json()` rejeita corpo malformado (400), corpo grande demais (413)
 * e codificação que não sabe ler (415) lançando um erro com `status`. São
 * respostas a um pedido inválido, não defeitos do servidor: preservá-las é o
 * que faz a tela dizer "o que você mandou não serve" em vez de "o servidor
 * quebrou". Qualquer `status` de 5xx é ignorado — se foi falha nossa, o número
 * é 500 e a explicação está no log, não no erro que subiu.
 */
function statusDeRecusa(err: unknown): number | null {
  const candidato = (err as { status?: unknown; statusCode?: unknown } | null)
    ?.status;
  const alternativo = (err as { statusCode?: unknown } | null)?.statusCode;
  for (const valor of [candidato, alternativo]) {
    if (typeof valor === "number" && valor >= 400 && valor < 500) return valor;
  }
  return null;
}

/** A frase de cada recusa que o parser de corpo produz. */
function frasePara(status: number, err: unknown): string {
  const tipo = (err as { type?: unknown } | null)?.type;
  if (tipo === "entity.parse.failed") {
    return "O corpo do pedido não é JSON válido.";
  }
  if (tipo === "entity.too.large" || status === 413) {
    return "O corpo do pedido passou do tamanho aceito.";
  }
  if (tipo === "encoding.unsupported" || status === 415) {
    return "A codificação do corpo do pedido não é suportada.";
  }
  return "O pedido não pôde ser aceito como veio.";
}

/**
 * Nenhuma rota casou com este caminho.
 *
 * Montado depois de todas elas e **fora** do `/api`, porque este processo só
 * serve API: qualquer caminho que chegue aqui e não tenha rota é um engano de
 * quem chamou ou de quem encaminhou, e nos dois casos a resposta precisa ser
 * legível pela mesma função que lê todas as outras.
 */
export const rotaDesconhecida: RequestHandler = (req, res) => {
  res.status(404).json({
    error: `Não existe ${req.method} ${req.path} nesta API.`,
    code: CODIGO_ROTA_DESCONHECIDA,
    requestId: req.id,
  });
};

/**
 * A última linha: o que sobrou de erro vira JSON, sempre.
 *
 * Três desfechos, nesta ordem:
 *
 * 1. **Cabeçalho já enviado.** Não há status para trocar. Se a resposta em
 *    curso é um stream de eventos — o `/assistant/ask` com `text/event-stream`
 *    —, o erro sai como o último evento, que é onde a tela já sabe procurá-lo.
 *    Qualquer outro caso só pode ser encerrado.
 * 2. **Recusa do parser de corpo.** O status dele é preservado (400, 413, 415)
 *    e a frase diz o que estava errado no pedido.
 * 3. **Falha nossa.** 500, com `code` e `requestId`, e o erro inteiro — com
 *    stack — na linha de log deste `requestId`.
 */
export const erroEmJson: ErrorRequestHandler = (err, req, res, _next) => {
  req.log?.error({ err }, "Erro não tratado — respondido pelo contrato JSON");

  if (res.headersSent) {
    const tipo = String(res.getHeader("content-type") ?? "");
    if (tipo.includes("text/event-stream")) {
      res.write(
        `event: erro\ndata: ${JSON.stringify({
          error: "A resposta foi interrompida por uma falha do servidor.",
          code: CODIGO_ERRO_INTERNO,
          requestId: req.id,
          ...(detalheDe(err) ? { detalhe: detalheDe(err) } : {}),
        })}\n\n`,
      );
    }
    res.end();
    return;
  }

  const recusa = statusDeRecusa(err);
  if (recusa !== null) {
    res.status(recusa).json({
      error: frasePara(recusa, err),
      code: CODIGO_PEDIDO_INVALIDO,
      requestId: req.id,
      ...(detalheDe(err) ? { detalhe: detalheDe(err) } : {}),
    });
    return;
  }

  res.status(500).json({
    error:
      "O servidor falhou ao processar este pedido. Nada foi gravado por esta " +
      "chamada.",
    code: CODIGO_ERRO_INTERNO,
    requestId: req.id,
    ...(detalheDe(err) ? { detalhe: detalheDe(err) } : {}),
  });
};
