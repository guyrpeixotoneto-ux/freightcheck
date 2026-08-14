import type { RawChange } from "./grouped";

/**
 * O que **tipo** de alteração é aquela linha.
 *
 * A pergunta que a aba Análise passou a fazer: "aumentou custo, reduziu custo,
 * mexeu na operação, mexeu no cadastro, ou mudou algo que ainda não sabemos
 * precificar?". Ela não é respondida por palpite sobre o nome da coluna — é
 * lida do que a curadoria já declarou sobre o atributo:
 *
 * - `taxonomy_path` diz se aquilo é remuneração ou cadastro;
 * - `cost_class` (FIXO | VARIAVEL, herdado do ancestral que o declara) diz se é
 *   custo;
 * - `impact_confidence` e `impact_amount` dizem se há dinheiro apurado e para
 *   que lado ele foi;
 * - `is_monetary` e `unit` separam a grandeza operacional (km/l, %) do valor.
 *
 * **Nada aqui inventa dinheiro.** Uma linha sem impacto calculado nunca vira
 * "aumento" nem "redução": vira `SEM_IMPACTO_APURADO`, que é uma resposta e não
 * uma lacuna — e é diferente de "impacto zero", que ninguém apurou.
 */

export type ChangeClass =
  | "CUSTO_AUMENTOU"
  | "CUSTO_REDUZIU"
  | "RECEITA_AUMENTOU"
  | "RECEITA_REDUZIU"
  | "OPERACIONAL"
  | "CADASTRAL"
  | "SEM_IMPACTO_APURADO"
  | "EQUIPAMENTO_NOVO"
  | "EQUIPAMENTO_REMOVIDO";

export const CHANGE_CLASS_LABEL: Record<ChangeClass, string> = {
  CUSTO_AUMENTOU: "Aumento de custo",
  CUSTO_REDUZIU: "Redução de custo",
  RECEITA_AUMENTOU: "Aumento de receita",
  RECEITA_REDUZIU: "Redução de receita",
  OPERACIONAL: "Alteração operacional",
  CADASTRAL: "Alteração cadastral",
  SEM_IMPACTO_APURADO: "Sem impacto financeiro apurado",
  EQUIPAMENTO_NOVO: "Novo equipamento",
  EQUIPAMENTO_REMOVIDO: "Equipamento removido",
};

/**
 * Os ramos da taxonomia que **não** são remuneração.
 *
 * `remuneracao/cadastral/...` reúne chassi, modelo, ano, câmbio, unidade — o
 * que descreve o ativo. Mudou de verdade, aparece na tela, e nunca entra num
 * total: uma placa nova não é preço novo.
 */
const RAMO_CADASTRAL = "remuneracao/cadastral";

/**
 * Ramos de receita, se um dia existirem.
 *
 * Hoje a taxonomia deste produto não declara nenhum: a árvore inteira é
 * `custo_fixo`, `custo_variavel`, `cadastral` e `nao_classificado` — porque o
 * export descreve o que a Ambev **paga** ao transportador, e cada linha dele é
 * um custo do ponto de vista de quem monta a remuneração. Enquanto for assim,
 * `RECEITA_*` é um estado do domínio que nunca é emitido, e é melhor que seja
 * declarado e vazio do que emitido por adivinhação sobre o nome da gaveta.
 */
const RAMOS_DE_RECEITA = ["remuneracao/receita"];

/** Grandezas que descrevem operação, e não dinheiro. */
const UNIDADES_OPERACIONAIS = new Set([
  "KM_L",
  "KM",
  "L",
  "PERCENT",
  "PERCENTUAL",
  "MESES",
  "ANOS",
  "UNIDADE",
  "QUANTIDADE",
]);

export function changeClassOf(row: RawChange): ChangeClass {
  if (row.change_type === "ENTITY_ADDED") return "EQUIPAMENTO_NOVO";
  if (row.change_type === "ENTITY_REMOVED") return "EQUIPAMENTO_REMOVIDO";

  const caminho = row.taxonomy_path ?? "";
  const cadastral = caminho.startsWith(RAMO_CADASTRAL);
  const receita = RAMOS_DE_RECEITA.some((ramo) => caminho.startsWith(ramo));

  const apurado =
    row.impact_confidence === "CALCULATED" &&
    row.impact_amount !== null &&
    Number(row.impact_amount) !== 0;

  if (apurado) {
    const subiu = Number(row.impact_amount) > 0;
    if (receita) return subiu ? "RECEITA_AUMENTOU" : "RECEITA_REDUZIU";
    /*
      Sem `cost_class` e fora do ramo cadastral, o atributo está em
      `nao_classificado` — e ainda assim tem impacto calculado, o que só
      acontece com semântica CONFIRMED, monetária e somável. Chamar isso de
      custo é a leitura correta neste produto: a árvore inteira descreve o que
      a Ambev paga.
    */
    return subiu ? "CUSTO_AUMENTOU" : "CUSTO_REDUZIU";
  }

  if (cadastral) return "CADASTRAL";

  /*
    Operacional é o que mede a operação e não o dinheiro: consumo em km/l,
    quilometragem, percentuais, prazos. A unidade manda, e `is_monetary`
    desempata — um valor monetário sem impacto apurado não é "operacional", é
    dinheiro que ainda não sabemos valorar, e a tela precisa dizer isso.
  */
  if (row.is_monetary !== true && row.unit !== null && UNIDADES_OPERACIONAIS.has(row.unit)) {
    return "OPERACIONAL";
  }

  return "SEM_IMPACTO_APURADO";
}

/** As classes que representam dinheiro apurado — as únicas que somam. */
export const CLASSES_COM_DINHEIRO: ChangeClass[] = [
  "CUSTO_AUMENTOU",
  "CUSTO_REDUZIU",
  "RECEITA_AUMENTOU",
  "RECEITA_REDUZIU",
];
