/**
 * O contrato de `/book/entries`, do lado da tela.
 *
 * Espelha `artifacts/api-server/src/routes/book.ts`. Fica escrito aqui, e não
 * importado do pacote do servidor, porque a interface é servida como bundle
 * próprio e não deve arrastar o cliente de banco junto — mas os nomes são os
 * mesmos de propósito, para que uma divergência apareça na revisão em vez de em
 * produção. Mesma decisão de `components/inicio/types.ts`.
 */

export type BookEntryKind = "DOCUMENTO" | "TEXTO";

/** O que toda entrada carrega, em qualquer das rotas. */
export interface BookEntryBase {
  id: string;
  blockKey: string;
  blockCategory: string;
  blockTitle: string;
  kind: BookEntryKind;
  revision: number;
  /** Só em DOCUMENTO. */
  filename: string | null;
  mimeType: string;
  byteSize: number;
  contentSha256: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

/**
 * `GET /book/entries` — a entrada vigente de cada bloco.
 *
 * Traz `bodyPreview` e não o texto inteiro: são 63 blocos, e o índice não pode
 * custar o conteúdo de todos eles. `bodyTruncated` é o que impede a tela de
 * exibir meia frase como se fosse a regra completa.
 */
export interface BookEntryCurrent extends BookEntryBase {
  bodyPreview: string | null;
  bodyTruncated: boolean;
  /** Quantas revisões este bloco tem, contando esta. */
  revisions: number;
}

/** `GET /book/entries/history?blockKey=…` — todas as revisões, com o texto. */
export interface BookEntryRevision extends BookEntryBase {
  bodyText: string | null;
}

/**
 * A resposta de `POST /book/entries` quando o conteúdo não mudou.
 *
 * O servidor devolve 200 e não 201 nesse caso, e a tela precisa distinguir os
 * dois: dizer "salvo" sobre um envio que não gravou nada faria alguém acreditar
 * que editou quando não editou.
 */
export interface BookEntryUnchanged {
  unchanged: true;
  revision: number;
  message: string;
}

export type BookEntryPostResult = BookEntryBase | BookEntryUnchanged;

export function isUnchanged(
  resultado: BookEntryPostResult,
): resultado is BookEntryUnchanged {
  return (resultado as BookEntryUnchanged).unchanged === true;
}
