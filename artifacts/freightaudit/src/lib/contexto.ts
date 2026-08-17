import type { ContextSelection } from "@/components/contexto/context-bar";

/**
 * O que trocar de contexto faz com o endereço.
 *
 * O estado da tela vive na URL — é o que permite mandar o endereço para outra
 * pessoa e ela ver a mesma coisa. Trocar unidade, canal ou vigência é, portanto,
 * reescrever a URL, e cada tela escrevia a sua própria versão dessa reescrita.
 *
 * **A regra que só uma delas conhecia.** Trocar de unidade **apaga a vigência**.
 * A data de uma unidade não existe necessariamente na outra: insistir nela leva
 * a uma tela vazia com aparência de defeito, e o vazio ainda seria daqueles sem
 * causa, que é o que esta auditoria persegue. Início documentava isso desde
 * sempre, em prosa, dentro do próprio `onSelect`; as outras oito telas não
 * sabiam. Aqui a regra é uma função, e a função é a mesma para todas.
 *
 * O mesmo vale para o canal: `EMPURRADA` e `ROTA` são remunerações diferentes e
 * não têm por que compartilhar o calendário.
 *
 * Só isto é função pura porque só isto dá para provar sem DOM — e é justamente
 * a parte com regra. O resto da barra é layout.
 */
export function aplicarContexto(
  /** A query string atual, como `useSearch()` a devolve. */
  search: string,
  selecao: ContextSelection,
): URLSearchParams {
  const params = new URLSearchParams(search);

  const trocouDeRecorte =
    (selecao.scopeHash !== undefined && selecao.scopeHash !== params.get("scopeHash")) ||
    (selecao.canal !== undefined && (selecao.canal ?? "") !== (params.get("canal") ?? ""));

  if (selecao.scopeHash !== undefined) params.set("scopeHash", selecao.scopeHash);

  if (selecao.canal !== undefined) {
    // `canal` vazio é uma partição real — "as vigências sem canal legível" —,
    // e não a ausência de filtro. Por isso ele é escrito, e não apagado.
    if (selecao.canal === null) params.delete("canal");
    else params.set("canal", selecao.canal);
  }

  /*
    A vigência **herdada** é que cai na troca de recorte — não a que veio no
    mesmo pedido.

    A distinção é o que separa a barra de um link montado. A barra manda
    `{ scopeHash }` sozinho, e ali apagar é o certo: a data que estava na tela é
    de outra unidade. Uma tela que monta um endereço manda
    `{ scopeHash, period }` junto, e ali o período é escolha explícita de quem
    montou — apagá-lo seria descartar o que o chamador acabou de dizer.
  */
  if (selecao.period !== undefined) params.set("period", selecao.period);
  else if (trocouDeRecorte) params.delete("period");

  return params;
}

/**
 * O endereço completo depois da troca.
 *
 * Existe para que a tela não precise lembrar de juntar a rota com a query — e
 * para que "sem nenhum parâmetro" produza `/dre` em vez de `/dre?`, que é feio
 * no histórico do navegador e diferente no cache do Tanstack Query.
 */
export function enderecoComContexto(
  rota: string,
  search: string,
  selecao: ContextSelection,
): string {
  const params = aplicarContexto(search, selecao);
  const query = params.toString();
  return query ? `${rota}?${query}` : rota;
}
