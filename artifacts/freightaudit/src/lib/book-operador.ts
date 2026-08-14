/**
 * O índice dos blocos do Book, agora em `lib/knowledge`.
 *
 * Mesmo motivo do catálogo ao lado: o Assistente precisa recuperar bloco por
 * assunto, e roda no servidor. As telas continuam importando daqui.
 */
export {
  BLOCOS_BOOK,
  TOTAL_DECLARADO_FREIGHTECH,
  categoriasDoBook,
  chaveDoBloco,
  normalizar,
  type BlocoBook,
} from "@workspace/knowledge";
