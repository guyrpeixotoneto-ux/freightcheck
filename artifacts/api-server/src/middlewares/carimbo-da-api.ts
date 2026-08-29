import type { RequestHandler } from "express";

/**
 * O cabeçalho que só esta API sabe escrever — e por que ele existe.
 *
 * Toda a leitura de falha deste produto depende de uma pergunta anterior a
 * qualquer outra: **a requisição chegou ao Express?** Enquanto a resposta a ela
 * for inferida do corpo, ela é um palpite. Corpo JSON com `error` é *provável*
 * que seja nosso; corpo vazio com 502 é *provável* que seja do roteador; um
 * 302 opaco não tem corpo nenhum. "Provável" é o que fez este repositório
 * procurar processo derrubado enquanto o processo estava de pé.
 *
 * O carimbo troca a inferência por um fato. Ele é escrito no primeiro
 * middleware da pilha — antes do portão de prontidão, antes da sessão, antes de
 * qualquer rota —, de modo que **toda** resposta que sai deste processo o
 * carrega, inclusive o 503 do portão, o 401 sem sessão e o 500 do contrato. A
 * recíproca é o que interessa: uma resposta sem ele não passou por aqui, e
 * quem a escreveu foi uma camada intermediária.
 *
 * `X-Request-Id` vai junto, e por um motivo prático: o `requestId` só aparecia
 * no corpo de alguns erros (o 500 e o de schema). Num cabeçalho ele existe em
 * toda resposta — inclusive nas que dão certo e nas que não têm corpo —, e é o
 * que costura a tela ao log quando alguém liga dizendo "falhou agora".
 *
 * Nada aqui é sensível: um "1" e um identificador aleatório de requisição.
 */

/** O nome do carimbo. Exportado porque a interface e os testes o leem. */
export const CABECALHO_DA_API = "X-FreightCheck-API";

/** O identificador desta requisição, o mesmo que vai na linha de log. */
export const CABECALHO_DO_REQUEST_ID = "X-Request-Id";

export const carimboDaApi: RequestHandler = (req, res, next) => {
  res.setHeader(CABECALHO_DA_API, "1");
  const id = (req as { id?: unknown }).id;
  if (typeof id === "string" || typeof id === "number") {
    res.setHeader(CABECALHO_DO_REQUEST_ID, String(id));
  }
  next();
};
