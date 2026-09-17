/**
 * O ARREDONDAMENTO MONETÁRIO — uma regra, e uma só.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * Porque havia duas regras, e elas discordavam exatamente onde arredondar é uma
 * decisão: no valor que cai sobre o meio centavo.
 *
 * - `Math.round((v + Number.EPSILON) * 100) / 100` — a da apuração do extrato;
 * - `Number(v.toFixed(2))` — a das rotas HTTP.
 *
 * A soma das cinco duplicatas retidas do extrato de 2026 é R$ 21.206,765. A
 * primeira devolve **21.206,77**; a segunda, **21.206,76**. Não é um detalhe de
 * ponto flutuante sem consequência: era o número que a tela mostrava ao lado de
 * "5 lançamentos repetidos, retidos", um centavo abaixo do que qualquer pessoa
 * apura conferindo as cinco linhas à mão.
 *
 * A causa é conhecida e vale escrever, porque ela volta: `toFixed` arredonda o
 * **binário**, não o decimal que a pessoa digitou. O `float64` mais próximo de
 * 21.206,765 é 21206.764999999999417…, que está abaixo do meio — então `toFixed`
 * desce, corretamente e inutilmente. Somar `Number.EPSILON` antes de multiplicar
 * por 100 empurra esse fio de volta para cima do meio, e o meio centavo passa a
 * subir, que é a convenção que uma pessoa usa e a que uma auditoria consegue
 * conferir.
 *
 * ---------------------------------------------------------------------------
 * Por que ele mora em `@workspace/ingest`
 * ---------------------------------------------------------------------------
 * Não por afinidade temática — arredondar dinheiro não é ingestão. É por
 * alcance: `ingest` é o pacote mais baixo que a apuração do extrato, o confronto
 * (`@workspace/comparison`, que depende dele), o servidor e a tela conseguem
 * importar sem inverter nenhuma seta de dependência. Uma segunda cópia em cada
 * um deles concordaria no dia em que fosse escrita, e a discordância só
 * apareceria num centavo, meses depois, numa tela que ninguém suspeitaria.
 */

/**
 * Meio centavo — o limiar abaixo do qual dois valores monetários são o mesmo.
 *
 * Reexportado de `@workspace/comparison/competencia-de-finame`? Não: é o
 * contrário. Aquele módulo é quem deveria importar daqui, e o fará quando alguém
 * tocar nele; declarar aqui é o que permite a esta função e a quem a usa
 * falarem da mesma tolerância sem criar um ciclo.
 */
export const MEIO_CENTAVO = 0.005;

/**
 * Um valor monetário com duas casas — a **única** forma autorizada de produzir
 * um número em reais neste produto.
 *
 * Meio centavo sobe. `arredondarCentavos(21206.765)` é `21206.77`, e
 * `arredondarCentavos(-21206.765)` é `-21206.76`: o arredondamento é *para
 * cima* na reta, e não *para longe do zero*. É a convenção do
 * `Math.round` da linguagem, ela é simétrica com a soma de um crédito e de um
 * débito de mesmo módulo, e mudá-la para "meio se afasta do zero" exigiria
 * medir o efeito em todo estorno do acervo — o que ninguém mediu, e por isso
 * não se muda.
 *
 * `null` e o que não é número finito atravessam como `null`: ausência não é
 * zero, e arredondar o nada produziria um R$ 0,00 que afirma dinheiro.
 */
export function arredondarCentavos(valor: number): number;
export function arredondarCentavos(valor: number | null | undefined): number | null;
export function arredondarCentavos(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * A soma de uma lista de valores, arredondada **uma vez, no fim**.
 *
 * Arredondar parcela a parcela e somar depois é outra conta, e ela erra por
 * centavos que crescem com o tamanho da lista. Existir como função é o que
 * impede que a ordem seja escolhida de novo, diferente, em cada lugar que soma.
 */
export function somarCentavos(valores: Iterable<number | null | undefined>): number {
  let total = 0;
  for (const v of valores) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    total += v;
  }
  return arredondarCentavos(total);
}

/** Se dois valores monetários são o mesmo valor, dentro de meio centavo. */
export function mesmoValor(a: number, b: number): boolean {
  return Math.abs(a - b) < MEIO_CENTAVO;
}
