import type { RequestedContext } from "@workspace/comparison";

import { operacaoDaConsulta } from "./operacao";

/**
 * O contexto pedido na query — unidade, canal e o recorte de vigências.
 *
 * Existe para que as abas de Alterações leiam a mesma coisa da mesma forma. As
 * três rotas nasceram com uma cópia desta função cada, e a cópia era inofensiva
 * enquanto o contexto era só unidade e canal; deixou de ser quando o recorte
 * `de`/`ate` entrou, porque uma aba que não o lesse mostraria a série inteira
 * ao lado de outra mostrando três vigências — com os dois números certos e a
 * comparação errada.
 *
 * Aqui só se lê a query. Quem decide se o pedido faz sentido é `resolveContext`
 * em `@workspace/comparison`, que é onde a lista de vigências existe.
 *
 * **A operação entra por aqui, e isso não é economia de digitação.** Onze
 * arquivos de rota chamam esta função, e é o que faz o recorte das quatro
 * auditorias valer em todas as leituras com contexto sem uma linha nova em cada
 * uma — a mesma razão pela qual a família do dataset vive dentro de
 * `contextFilter` e não em sessenta consultas. Ver `lib/operacao.ts`.
 */
export function parseContext(
  query: Record<string, unknown>,
): RequestedContext | undefined {
  const str = (chave: string) =>
    typeof query[chave] === "string" && query[chave] !== ""
      ? (query[chave] as string)
      : undefined;

  const scopeHash = str("scopeHash");
  const operacao = operacaoDaConsulta(query);
  // `?canal=` vazio quer dizer "as vigências sem canal legível no rótulo", que
  // é uma partição real e não a ausência de filtro.
  const hasCanal = typeof query.canal === "string";
  const de = str("de");
  const ate = str("ate");

  /*
    Um pedido que traz **só** a operação continua sendo um pedido: ele quer o
    contexto padrão *daquela operação*, e devolver `undefined` aqui faria
    `resolveContext` cair em `contexts[0]` do acervo inteiro — o vazamento no
    caminho mais comum de todos, o de quem acabou de abrir a tela.
  */
  if (
    scopeHash === undefined &&
    !hasCanal &&
    de === undefined &&
    ate === undefined &&
    operacao === null
  ) {
    return undefined;
  }

  return {
    ...(operacao !== null ? { operacao } : {}),
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(hasCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
    // Meia janela é um pedido legítimo — "de março para cá" —, e `aplicarJanela`
    // completa a outra ponta com o extremo da série.
    ...(de !== undefined || ate !== undefined ? { janela: { de, ate } } : {}),
  };
}
