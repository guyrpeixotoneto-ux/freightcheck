/**
 * O catálogo do Freightech, agora em `lib/knowledge`.
 *
 * O arquivo saiu daqui para que o Assistente pudesse lê-lo: ele roda no
 * servidor, e este é o corpus que explica o que cada cartão é e o que o export
 * não traz. Este re-export existe para que as telas continuem importando de
 * `@/lib/freightech-catalogo` — quem consome não precisa saber que a fonte
 * mudou de lugar.
 */
export {
  CATALOGO_FREIGHTECH,
  PARAMETROS_NO_CATALOGO,
  chaveDoCartao,
  ligarParametros,
  type CartaoCatalogo,
  type SecaoCatalogo,
} from "@workspace/knowledge";
