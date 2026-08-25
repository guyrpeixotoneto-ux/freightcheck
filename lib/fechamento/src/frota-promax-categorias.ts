/**
 * A CLASSIFICAÇÃO DE CATEGORIA DA FROTA PROMAX — a única regra que decide a
 * que grupo do contrato (frota fixa ou van) uma categoria do Promax se
 * refere.
 *
 * **Por que existe separado de `frota-promax-comparacao.ts`.** A mesma
 * pergunta — "esta categoria do Promax é frota fixa ou é van?" — precisa da
 * mesma resposta em dois lugares: na comparação real (arquivo importado,
 * placa por placa) e na leitura por imagem da tela (`competencia.tsx`,
 * totais por categoria, sem placa nenhuma). Um só módulo, sem depender de
 * `VeiculoDaFrotaPromax` nem de nada de UI, é o que permite os dois
 * reaproveitarem a mesma regra em vez de cada um manter a sua.
 *
 * **A confirmação de "Fixo" = van.** Até aqui só "FF"/"FIXA"/"FROTA FIXA" e
 * "PADRAO" eram reconhecidos como frota fixa, e só "VAN"/"VANS" como van —
 * nenhum dado real tinha confirmado o vocabulário. Uma print da tela real do
 * Promax (Rota → aba de veículos, contrato Horizonte Express, vigência
 * 01/08/2026) trouxe a confirmação: a coluna "Padrão" bate, veículo a
 * veículo e custo a custo, com a Frota Ativa do contrato (23 veículos,
 * custo fixo R$ 494,22 — os dois lados iguais), e a coluna "Fixo" bate do
 * mesmo jeito com a Van Ativa (3 veículos, custo de equipe de entrega
 * R$ 4.734,11 — os dois lados iguais). Por isso "FIXO" entra aqui como van,
 * não como frota fixa — o nome sugere o contrário, mas os números da tela
 * real são a fonte, não o nome da coluna.
 *
 * **O que ainda não está confirmado.** "MKT", "Refrigeração", "Especial" e
 * "Recarga" apareceram na mesma print sem contrapartida clara do lado do
 * contrato — nenhuma foi somada aqui. E o lado inativo (Quitado/Finame/
 * Ambev) ainda não tem uma print equivalente comparando contra Frota
 * Inativa/Van Inativa — por isso a classificação abaixo vale para os nomes
 * de categoria que já apareceram numa amostra real, e não tenta cobrir os
 * dois lados (ativa/inativa) por simetria de suposição.
 */

export type ReferenciaDeFrotaPromax = "FROTA_FIXA" | "VAN";

const CATEGORIAS_DE_FROTA_FIXA = ["FF", "FIXA", "FROTA FIXA", "PADRAO"];

/**
 * "FIXO" está aqui, e não em `CATEGORIAS_DE_FROTA_FIXA`, por causa da
 * confirmação por print descrita no comentário do arquivo — o nome engana,
 * o dado não.
 */
const CATEGORIAS_DE_VAN = ["VAN", "VANS", "FIXO"];

/**
 * Decide a que grupo do contrato uma categoria do Promax se refere.
 * `null` para texto ausente ou não reconhecido — nunca inventa uma
 * correspondência para uma categoria que a amostra real ainda não trouxe.
 */
export function classificarCategoriaDeFrotaPromax(
  categoria: string | null,
): ReferenciaDeFrotaPromax | null {
  const texto = (categoria ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  if (CATEGORIAS_DE_FROTA_FIXA.includes(texto)) return "FROTA_FIXA";
  if (CATEGORIAS_DE_VAN.includes(texto)) return "VAN";
  return null;
}
