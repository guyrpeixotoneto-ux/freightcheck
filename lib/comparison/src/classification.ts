import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * Resolvendo a classe de custo de um atributo.
 *
 * Ela **era** declarada nos nós de classe da taxonomia (`custo_fixo`,
 * `custo_variavel`) e herdada por tudo abaixo, e este arquivo existia para
 * fazer essa herança: um join lateral que achava o ancestral mais próximo com
 * classe declarada.
 *
 * Desde a migration 0030 a classe é do **atributo**, não do nó. O motivo é que
 * ela nunca foi propriedade da natureza: `Pessoal e encargos` é custo fixo
 * quando o valor descreve o cavalo e variável quando descreve o trecho, e
 * enquanto a classe morou na árvore a mesma natureza precisava de dois nós —
 * fazendo "o que é isto?" ter duas respostas conforme o contexto.
 *
 * O fragmento continua existindo, com o mesmo nome e o mesmo contrato, por uma
 * razão prática: cinco consultas o interpolam, e a regra que elas compartilham
 * — *de onde sai a classe de custo* — precisa ter um lugar só, ou vira cinco
 * respostas esperando para divergir. O que mudou é o que ele faz: nenhuma
 * recursão, nenhuma herança, uma coluna.
 */

/**
 * De onde sai a classe de custo, como fragmento interpolável.
 *
 * Recebe o alias da tabela que traz a coluna porque as três consultas que o
 * usam partem de lugares diferentes — duas de `attribute`, uma de
 * `attribute_semantics` —, e as duas tabelas têm a coluna: a versionada é a
 * verdade, a projeção é a leitura barata.
 *
 * O nome exposto continua sendo `inherited.cost_class`, que é o que as
 * consultas já selecionam. Ele ficou impróprio — não se herda mais nada — e
 * mudá-lo custaria tocar cinco `SELECT` para não dizer nada de novo.
 *
 * `NAO_APLICAVEL` sai como NULL. Para quem lê um total, "não é custo" e
 * "ninguém decidiu" são a mesma ausência; a diferença entre os dois é da
 * curadoria, e quem precisa dela lê `attribute.cost_class` direto. Traduzir
 * aqui é o que mantém intactas as telas que já distinguiam FIXO, VARIAVEL e
 * "sem classe".
 */
export function inheritedCostClassJoin(alias: "a" | "v") {
  const coluna = alias === "a" ? sql`a.cost_class` : sql`v.cost_class`;
  return sql`
      LEFT JOIN LATERAL (
        SELECT CASE WHEN ${coluna} IN ('FIXO', 'VARIAVEL') THEN ${coluna} END
                 AS cost_class
      ) AS inherited ON true`;
}

export interface AttributeClassification {
  /** Which semantics version this describes. Null before any versioning. */
  semanticsVersion?: number | null;
  calculationBasis?: string | null;
  attributeId: string;
  attributeCode: string;
  /** O nome de leitura: apelido gerencial quando existe, literal da planilha quando não. */
  attributeName: string;
  /**
   * Só o apelido, sem o literal por trás. Separado de `attributeName` porque
   * `attributeLabel` precisa saber se houve curadoria: um apelido confirmado
   * ganha do vocabulário fixo, um nome de coluna não.
   */
  attributeDisplayName: string | null;
  entityType: string;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  /** FIXO | VARIAVEL | null — resolved through inheritance. */
  costClass: string | null;
  taxonomyPath: string | null;
  taxonomyName: string | null;
  /** HIGHER_IS_BETTER | HIGHER_IS_WORSE | NEUTRAL | DEPENDS_ON_FORMULA | null. */
  economicDirection: string | null;
  economicEffect: string | null;
}

/**
 * Uma alteração é material quando o atributo mede grandeza econômica.
 *
 * `NEUTRAL` é cadastro ou identificação — `trecho.origem`, `trecho.destino`,
 * `unidade_nome`, `operador_nome`, `chave_trecho`, placa, chassi — e o Radar de
 * Trechos já faz esta mesma distinção (`classificarTrecho`) para separar o que
 * conta como sinal de negócio do que é só forma. `null` continua contando: é o
 * estado de quem nunca foi classificado, e não é a mesma coisa que "curado como
 * neutro" — tratar os dois igual faria todo atributo não confirmado sumir dos
 * contadores até alguém revisá-lo.
 */
export function ehAlteracaoMaterial(economicDirection: string | null | undefined): boolean {
  return economicDirection !== "NEUTRAL";
}

/**
 * Classifications as they stood on a given date, resolved from
 * `attribute_semantics`.
 *
 * The date is the vigência's, not today's: comparing Dez/2025 against Jan/2026
 * must use what those columns meant then, even if the meaning has since
 * changed. Falls back to the attribute's current projection for anything with
 * no version covering that date, so a database that never ran the backfill
 * behaves exactly as before.
 */
export async function loadAttributeClassificationsAt(
  db: Database,
  date: string,
): Promise<Map<string, AttributeClassification>> {
  const current = await loadAttributeClassifications(db);

  const { rows } = await db.execute<{
    attribute_id: string;
    version: number;
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    is_monetary: boolean | null;
    calculation_basis: string | null;
    semantics_status: string;
    cost_class: string | null;
    path: string | null;
    name: string | null;
    economic_direction: string | null;
    economic_effect: string | null;
  }>(sql`
    SELECT v.attribute_id,
           v.version,
           v.unit,
           v.periodicity,
           v.aggregation,
           v.is_monetary,
           v.calculation_basis,
           v.semantics_status,
           inherited.cost_class,
           node.path,
           node.name,
           v.economic_direction,
           v.economic_effect
      FROM attribute_semantics v
      LEFT JOIN taxonomy_node node ON node.id = v.taxonomy_node_id
      ${inheritedCostClassJoin("v")}
     WHERE v.effective_from <= ${date}::date
       AND (v.effective_until IS NULL OR ${date}::date < v.effective_until)
  `);

  const resolved = new Map(current);
  for (const row of rows) {
    const base = current.get(row.attribute_id);
    if (!base) continue;
    resolved.set(row.attribute_id, {
      ...base,
      semanticsVersion: row.version,
      unit: row.unit,
      periodicity: row.periodicity,
      aggregation: row.aggregation,
      isMonetary: row.is_monetary,
      calculationBasis: row.calculation_basis,
      semanticsStatus: row.semantics_status,
      costClass: row.cost_class,
      taxonomyPath: row.path,
      taxonomyName: row.name,
      economicDirection: row.economic_direction,
      economicEffect: row.economic_effect,
    });
  }
  return resolved;
}

export async function loadAttributeClassifications(
  db: Database,
): Promise<Map<string, AttributeClassification>> {
  const { rows } = await db.execute<{
    id: string;
    code: string;
    display_name: string | null;
    source_name: string;
    entity_type: string;
    data_type: string;
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    is_monetary: boolean | null;
    semantics_status: string;
    cost_class: string | null;
    path: string | null;
    name: string | null;
    economic_direction: string | null;
    economic_effect: string | null;
  }>(sql`
    SELECT a.id,
           a.code,
           a.display_name,
           a.source_name,
           a.entity_type,
           a.data_type,
           a.unit,
           a.periodicity,
           a.aggregation,
           a.is_monetary,
           a.semantics_status::text AS semantics_status,
           inherited.cost_class,
           node.path,
           node.name,
           a.economic_direction,
           a.economic_effect
      FROM attribute a
      LEFT JOIN taxonomy_node node ON node.id = a.taxonomy_node_id
      ${inheritedCostClassJoin("a")}
  `);

  const map = new Map<string, AttributeClassification>();
  for (const row of rows) {
    map.set(row.id, {
      attributeId: row.id,
      attributeCode: row.code,
      attributeName: row.display_name ?? row.source_name,
      attributeDisplayName: row.display_name,
      entityType: row.entity_type,
      dataType: row.data_type,
      unit: row.unit,
      periodicity: row.periodicity,
      aggregation: row.aggregation,
      isMonetary: row.is_monetary,
      semanticsStatus: row.semantics_status,
      costClass: row.cost_class,
      taxonomyPath: row.path,
      taxonomyName: row.name,
      economicDirection: row.economic_direction,
      economicEffect: row.economic_effect,
    });
  }
  return map;
}
