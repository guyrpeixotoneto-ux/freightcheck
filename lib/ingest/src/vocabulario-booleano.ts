/**
 * O vocabulário com que a fonte escreve um sim/não.
 *
 * A coluna `ativo` do export chega como **texto** — `ATIVO` ou `PARADO` —, e
 * não como booleano: `parseCellValue` só resolve `BOOLEAN` quando a célula do
 * Excel é do tipo booleano, e esta não é. Então quem quiser saber se um veículo
 * está rodando tem de traduzir a palavra, e o vocabulário da tradução é o que
 * mora aqui.
 *
 * **`ATIVO` e `PARADO` são os dois valores do export real** — medidos no acervo
 * de CAMAÇARI · EMPURRADA em 19/08/2026: 442 linhas `ATIVO` e 116 `PARADO`, nas
 * nove vigências, e nenhum terceiro valor. É a palavra da planilha, e é ela que
 * a contagem tem de entender; `PARADO` é exatamente o que a aba chama de "Total
 * Frota Fixa Inativos".
 *
 * As outras entradas estão aqui porque a mesma coluna chega como booleano
 * tipado em outros exports, e porque `SIM`/`NAO` é a forma que a planilha usa em
 * colunas irmãs. Reconhecê-las não custa nada e evita que a contagem dependa de
 * qual variante o cliente mandou naquele mês.
 *
 * O que **não** está aqui é um padrão. Qualquer outro texto — inclusive o
 * vazio — é nulo, e nulo não é inativo: é "este veículo não respondeu", que a
 * contagem trata como categoria própria. Um `else return false` faria uma frota
 * inteira aparecer parada no dia em que a Ambev escrevesse a palavra de outro
 * jeito, e ninguém veria.
 *
 * **Por que mora em `lib/ingest`.** Nasceu privado em
 * `lib/remuneracao/src/leitura.ts`, que precisou dele primeiro. Quando o
 * Panorama passou a contar quantos veículos estão em `ATIVO`, o segundo leitor
 * apareceu em `lib/comparison` — e `comparison` não pode importar de
 * `remuneracao`, que depende dela. Copiar as duas listas resolveria hoje e
 * divergiria no primeiro mês em que o cliente escrevesse uma palavra nova:
 * uma tela contaria o veículo como parado e a outra como sem resposta, sobre o
 * mesmo dado. `lib/ingest` é o pacote que os dois já importam, e é onde mora o
 * resto do conhecimento sobre como a fonte escreve as coisas.
 */

/** As palavras que a fonte usa para "sim". Já em caixa alta, sem espaços. */
export const DIZ_QUE_SIM: ReadonlySet<string> = new Set([
  "ATIVO",
  "SIM",
  "S",
  "TRUE",
  "VERDADEIRO",
  "1",
]);

/** As palavras que a fonte usa para "não". Já em caixa alta, sem espaços. */
export const DIZ_QUE_NAO: ReadonlySet<string> = new Set([
  "PARADO",
  "INATIVO",
  "NAO",
  "NÃO",
  "N",
  "FALSE",
  "FALSO",
  "0",
]);

/**
 * O sim/não de um texto da fonte, ou `null` quando ele não é nenhum dos dois.
 *
 * `null` é resposta, e não falha: significa "esta linha não respondeu", que é
 * diferente de "respondeu que não". Ver o cabeçalho.
 */
export function booleanoDoTexto(texto: string | null | undefined): boolean | null {
  const palavra = (texto ?? "").trim().toUpperCase();
  if (DIZ_QUE_SIM.has(palavra)) return true;
  if (DIZ_QUE_NAO.has(palavra)) return false;
  return null;
}
