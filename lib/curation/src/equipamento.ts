/**
 * O tipo de equipamento como a base o guarda: em maiúsculas, sem espaço em
 * volta. Texto vazio vira `null`, que quer dizer "todos".
 *
 * Mora numa autoridade só, e não em cada ponta, porque o recorte atravessa a
 * rede: a tela manda `?equipamento=` no endereço do download e o servidor
 * decide que abas escrever com o que chegou. Duas normalizações dos mesmos três
 * tipos concordam hoje e discordam no dia em que uma delas aprender a tirar
 * acento — e a discordância apareceria como um arquivo vazio, que é a forma
 * mais cara de descobrir o problema.
 *
 * ---------------------------------------------------------------------------
 * Por que num arquivo só dela, e não junto da planilha
 * ---------------------------------------------------------------------------
 * Ela nasceu dentro de `planilha-de-atributos.ts`, e a tela a importava pelo
 * índice do pacote — `@workspace/curation`. O índice reexporta dez módulos, e
 * oito deles importam `@workspace/db`: pedir uma função de três linhas por ali
 * arrastava `drizzle-orm` e o `pg` inteiro para dentro do bundle do navegador.
 * O `pg` toca `Buffer` ao ser avaliado, `Buffer` não existe no navegador, e o
 * erro estourava **antes** de `createRoot().render()` — antes, portanto, do
 * `ErrorBoundary`, que só protege o que já montou. O produto inteiro abria em
 * branco, sem uma linha na tela dizendo o que houve.
 *
 * Este arquivo é a resposta estrutural: uma regra que as duas pontas precisam
 * compartilhar não pode morar em módulo que fala com o banco. Ele não importa
 * nada — é essa ausência que o mantém publicável pelo subcaminho
 * `@workspace/curation/equipamento`, do mesmo jeito que
 * `@workspace/curation/significado` já servia a tela. Quem estiver no servidor
 * continua recebendo o nome pelo índice, que não mudou.
 */
export function normalizarEquipamento(
  valor: string | null | undefined,
): string | null {
  const limpo = valor?.trim().toUpperCase() ?? "";
  return limpo === "" ? null : limpo;
}
