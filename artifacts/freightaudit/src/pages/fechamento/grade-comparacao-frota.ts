import {
  classificarCategoriaDeFrotaPromax,
  type ReferenciaDeFrotaPromax,
} from "@workspace/fechamento/frota-promax-categorias";

/**
 * A COMPARAÇÃO DA GRADE DA FROTA — o contrato contra a leitura por imagem
 * (ou, um dia, contra a leitura da tela real), separada de `competencia.tsx`
 * para poder ser testada sem montar componente nenhum.
 *
 * **Duas correspondências, não uma.** Uma célula da imagem entra na
 * comparação quando:
 * 1. a linha *e* a coluna que ela leu têm exatamente o mesmo texto do lado
 *    do contrato (ex.: "Noturna" bate com "Noturna"); ou
 * 2. a coluna é uma categoria que `classificarCategoriaDeFrotaPromax`
 *    reconhece — hoje, "Padrão"/"FF"/"Fixa"/"Frota Fixa" como frota fixa, e
 *    "Fixo"/"Van"/"Vans" como van — e a linha bate literalmente.
 *
 * A segunda via só entra quando a `situacao` (ativa/inativa) é conhecida —
 * sem ela não há como escolher entre "Frota Ativa" e "Frota Inativa" como
 * alvo, e a função se recusa a adivinhar (ver `resolverValorDoContrato`).
 *
 * Categorias fora do vocabulário reconhecido (`"MKT"`, `"Refrigeração"`,
 * `"Especial"`, `"Recarga"`, e tudo do lado inativo — `"Quitado"`,
 * `"Finame"`, `"Ambev"`) não têm correspondência nenhuma aqui, de propósito:
 * nenhuma amostra real confirmou a que coluna do contrato elas se referem.
 */

export type SituacaoDaFrota = "ATIVA" | "INATIVA";

/**
 * Tira acento, caixa e espaço a mais — só isso. Existe para que "Noturna" na
 * imagem encontre "Noturna" no contrato mesmo com uma maiúscula ou um espaço
 * de diferença. A correspondência por categoria (item 2 acima) é uma via
 * separada — ver `resolverValorDoContrato`.
 */
export function normalizarCategoria(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface ValorDoContratoParaComparar {
  valor: number;
  dinheiro: boolean;
}

/**
 * O título da coluna do contrato (ver `colunasDoContrato` em
 * `competencia.tsx`) que corresponde a uma categoria do Promax já
 * classificada — só para as duas categorias que uma amostra real confirmou
 * (ver o comentário de `frota-promax-categorias.ts`).
 */
export function nomeDaColunaPelaCategoria(
  referencia: ReferenciaDeFrotaPromax,
  situacao: SituacaoDaFrota,
): string {
  if (referencia === "FROTA_FIXA") {
    return situacao === "ATIVA" ? "Frota Ativa" : "Frota Inativa";
  }
  return situacao === "ATIVA" ? "Van Ativa" : "Van Inativa";
}

export interface ResultadoDaComparacaoDaGrade extends ValorDoContratoParaComparar {
  /**
   * `true` quando a correspondência veio da categoria (ex.: "Padrão" →
   * "Frota Ativa"), não do nome literal da coluna. A tela usa isto para
   * explicar a célula de um jeito diferente de um "Noturna" bate "Noturna".
   */
  porCategoria: boolean;
}

/**
 * Resolve, para uma célula lida da imagem (`linha`, `coluna`), o valor do
 * contrato com o qual ela se compara — primeiro pelo nome literal, depois,
 * quando `situacao` é conhecida, pela categoria da coluna. `undefined`
 * quando nenhuma das duas vias encontra correspondência — a mesma
 * `SEM_COMPARACAO` honesta do resto do sistema.
 */
export function resolverValorDoContrato(
  mapa: Map<string, ValorDoContratoParaComparar> | undefined,
  linha: string,
  coluna: string,
  situacao: SituacaoDaFrota | null,
): ResultadoDaComparacaoDaGrade | undefined {
  if (!mapa) return undefined;
  const linhaNormalizada = normalizarCategoria(linha);

  const literal = mapa.get(`${linhaNormalizada}|${normalizarCategoria(coluna)}`);
  if (literal) return { ...literal, porCategoria: false };

  if (!situacao) return undefined;
  const referencia = classificarCategoriaDeFrotaPromax(coluna);
  if (!referencia) return undefined;

  const colunaEquivalente = nomeDaColunaPelaCategoria(referencia, situacao);
  const porCategoria = mapa.get(`${linhaNormalizada}|${normalizarCategoria(colunaEquivalente)}`);
  return porCategoria ? { ...porCategoria, porCategoria: true } : undefined;
}
