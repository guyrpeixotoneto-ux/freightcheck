import { sql } from "drizzle-orm";
import { podeSomar, podeTirarMedia, viraDinheiro } from "@workspace/curation";
import type { Database } from "@workspace/db";
import {
  detectFormatAnomaly,
  type Anomaly,
  type AnomalySide,
} from "./anomalies";
import {
  compositionOf,
  indexChangedAttributesByEntity,
  isCoveredByParts,
} from "./composition";
import {
  attributeLabel,
  equipmentLabel,
  equipmentPluralNoun,
  natureLabel,
  periodLabel,
  semanticsLabel,
} from "./labels";
import { buildCockpit, type CockpitView } from "./cockpit";
import { listPeriods } from "./consolidated";
import {
  channelSql,
  contextFilter,
  listContexts,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
  type SeriesContext,
} from "./series";

/**
 * A visão agrupada — o que a tela principal lê.
 *
 * A lista de alterações responde "o que mudou" em 267 linhas. A pergunta que a
 * pessoa tem é outra, e cabe em 20 respostas: *o cliente mexeu no quê, em
 * quantos veículos, e quanto isso me custa*. Este módulo faz essa redução.
 *
 * Agrupar é onde uma ferramenta de auditoria mais facilmente passa a mentir, e
 * por isso as regras abaixo são explícitas e nenhuma delas é negociável:
 *
 * 1. **Nunca agrupar linhas comparáveis com incomparáveis.** A chave do grupo
 *    inclui `comparability`. Um atributo com os dois casos vira dois cartões.
 * 2. **Nunca agrupar linhas com impacto apurado e sem.** A chave inclui
 *    `impact_confidence`, pelo mesmo motivo.
 * 3. **Nunca somar entre periodicidades.** Herdado do motor e mantido.
 * 4. **Só somar quando a semântica autoriza.** `aggregation = SUM` produz
 *    total; qualquer outra coisa produz média e faixa, ditas como tais. Somar
 *    meses de vida de manutenção daria "3.075,69 meses", que não é nada.
 * 5. **Média sempre com numerador, denominador e nº de veículos à vista.** Uma
 *    soma que cresce porque entraram dois cavalos não é aumento de preço, e a
 *    única defesa contra essa leitura é mostrar a divisão.
 * 6. **Sempre dizer quantos padrões distintos existem dentro do grupo.** Um
 *    cartão que diz "R$ 4.096,31 → R$ 2.505,97" quando há 13 pares diferentes
 *    está escondendo dispersão.
 * 7. **Nada sai da lista.** O agrupamento é uma leitura; toda linha continua
 *    acessível, rastreável e contada em algum lugar visível.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Badge =
  | "DINHEIRO"
  | "RUPTURA"
  | "COBERTURA"
  | "MOVIMENTO"
  | "TRAVADO"
  | "FORMATO"
  | "SEM_SINAL";

export type Coverage = "TOTAL" | "MAIORIA" | "PARCIAL";

export interface GroupImpact {
  /** CALCULATED | ESTIMATED | NOT_CALCULABLE — o do próprio grupo. */
  confidence: string;
  /** Soma dos impactos que **entram** no total da vigência. */
  amount: number | null;
  periodicity: string | null;
  reason: string | null;
  /** Veículos cujo impacto entrou na soma. */
  countedVehicles: number;
  /** Veículos cujo impacto ficou fora por já estar nas parcelas. */
  excludedVehicles: number;
  excludedAmount: number | null;
  /** Por que a exclusão aconteceu, com a evidência da composição. */
  excludedReason: string | null;
}

export interface GroupAggregate {
  /** true quando `aggregation = SUM`. Só então existe `totalBefore/After`. */
  summable: boolean;
  aggregation: string | null;
  totalBefore: number | null;
  totalAfter: number | null;
  /** Linhas que entraram na soma (as duas pontas numéricas presentes). */
  rowsInTotal: number;
  /** Numerador, denominador e nº de veículos, explícitos. */
  perVehicle: {
    numeratorBefore: number | null;
    numeratorAfter: number | null;
    denominator: number;
    averageBefore: number | null;
    averageAfter: number | null;
  } | null;
  deltaPercent: number | null;
  /** Para o que não é somável: a faixa de variação observada. */
  minPercent: number | null;
  maxPercent: number | null;
}

export interface ChangeGroup {
  key: string;
  attributeCode: string | null;
  title: string;
  entityType: string | null;
  equipment: string;
  changeType: string;
  category: string;
  comparability: string;
  /**
   * Linhas de alteração dentro do grupo.
   *
   * Não é o mesmo que `vehicles` e não pode ser lido como tal: `vehicles` conta
   * ativos distintos, `changes` conta linhas. Hoje elas coincidem — há uma
   * linha por (ativo, atributo) —, e coincidir não é ser a mesma coisa: a soma
   * de `changes` de todos os grupos fecha com `totals.changes`, e a de
   * `vehicles` não fecha com `totals.vehiclesTouched`, porque o mesmo caminhão
   * aparece em vários pontos.
   */
  changes: number;
  /** Quantos ativos distintos deste equipamento têm esta alteração. */
  vehicles: number;
  /** Quantos ativos a série tinha na vigência nova. */
  fleet: number;
  coverage: Coverage;
  coverageLabel: string;
  /** Pares "antes → depois" distintos dentro do grupo. */
  patterns: number;
  /** O par mais frequente, quando há mais de um. */
  dominantPattern: { before: string | null; after: string | null; vehicles: number } | null;
  aggregate: GroupAggregate;
  impact: GroupImpact;
  /** As naturezas em português, para a tela. */
  natures: string[];
  /**
   * As mesmas naturezas como o motor as registrou (`ZEROING`, `TYPE_CHANGE`…).
   *
   * Vão junto dos rótulos porque quem classifica criticidade precisa do código:
   * decidir por texto traduzido é atar a regra de negócio à revisão de um
   * rótulo — trocar "zerou" por "foi zerado" mudaria a fila de investigação.
   */
  natureCodes: string[];
  semanticsStatus: string | null;
  semanticsLabel: string;
  /** BRL | PERCENT | KM_L | MESES | … — a tela formata por isto, nunca por palpite. */
  unit: string | null;
  isMonetary: boolean | null;
  costClass: string | null;
  taxonomyName: string | null;
  inconclusiveReason: string | null;
  anomalies: (Anomaly & { vehicles: number })[];
  /**
   * Se **todas** as linhas deste grupo são troca de formato e nada mais.
   *
   * Não é o mesmo que "tem anomalia", e a distinção é a razão do campo existir.
   * Um grupo pode ter 54 linhas em que o serial é o mesmo instante, 8 em que
   * ele perdeu um milissegundo de precisão — e ainda assim uma única linha em
   * que a data por trás do número é **outra**. Essa linha é mudança de contrato
   * de verdade, e um grupo que a contenha continua sendo tratado como
   * alteração: `formatOnly` só é verdadeiro quando não sobra nenhuma.
   *
   * Quando é verdadeiro, o grupo deixa de ser lido como alteração contratual —
   * ganha selo próprio, sai da faixa crítica e é dito com o que ele é: a fonte
   * mudou a forma de exportar a coluna. Nada sai da lista, nada deixa de ser
   * contado: `changes` continua contando as linhas, elas continuam abríveis e
   * rastreáveis até a célula, e `totals.formatOnlyChanges` diz quantas das
   * alterações da vigência são disto.
   */
  formatOnly: boolean;
  /** Quando o atributo é o total de uma composição declarada. */
  composition: { total: string; parts: string[]; evidence: string } | null;
  badge: Badge;
  badgeLabel: string;
}

export interface ImpactSummary {
  /** Somado dentro de cada periodicidade, já sem dupla contagem. */
  byPeriodicity: Record<string, number>;
  /** O que foi deixado de fora por já estar contado nas parcelas. */
  excludedByPeriodicity: Record<string, number>;
  excludedChanges: number;
  /** Alterações sem preço, que continuam listadas. */
  notCalculable: number;
  calculatedChanges: number;
}

export interface GroupedSeries {
  entityTypeSet: string;
  equipment: string;
  snapshotLabel: string;
  previousLabel: string | null;
  /**
   * A vigência do snapshot com que esta série foi comparada — a data, não o
   * rótulo do arquivo.
   *
   * `previousLabel` responde *de qual entrega* veio o lado "Antes", e serve
   * para rastrear o arquivo; não responde *de quando*. A tabela de veículos
   * precisa da segunda pergunta para escrever "Antes · julho/2026" no
   * cabeçalho, e ela não pode ser deduzida subtraindo um mês:
   * `findPreviousSnapshot` pega a última entrega **daquela série**, que pula
   * junto com ela. Cavalo e carreta chegam em snapshots separados e podem ter
   * anteriores diferentes na mesma vigência — por isso é um campo por série, e
   * não um do cabeçalho.
   */
  previousPeriod: string | null;
  /** `previousPeriod` escrito para leitura: `julho/2026`. */
  previousPeriodLabel: string | null;
  fleet: number;
  changeSetId: string | null;
  reason: string | null;
}

/**
 * Os três estados em que a comparação de uma vigência pode estar.
 *
 * `NAO_MATERIALIZADA` e `SEM_ALTERACOES` produzem os mesmos zeros e pedem
 * ações opostas — "falta rodar o cálculo" e "siga em frente". Enquanto os dois
 * saíam da leitura como `changes: 0`, o assistente respondeu "0 alterações —
 * sem alterações neste recorte" num banco com 124 mil fatos, com a fonte ao
 * lado, indistinguível de uma resposta certa.
 *
 * São três e não dois porque o terceiro estado também precisa de nome. Um
 * booleano deixaria "comparada, e nada mudou" existindo só como dedução
 * (`!naoComparada && changes === 0`), refeita — ou esquecida — por cada leitor.
 */
export type EstadoDaComparacao =
  /** Ninguém calculou. Não se pode concluir nada sobre movimento. */
  | "NAO_MATERIALIZADA"
  /** Calculada, e a vigência não mudou nada. É uma resposta legítima. */
  | "SEM_ALTERACOES"
  /** Calculada, e há alterações para ler. */
  | "COM_ALTERACOES";

export interface GroupedView {
  /**
   * A unidade e o canal desta leitura.
   *
   * Vem na resposta porque o padrão — o contexto mais recente — é uma escolha,
   * e escolha que a tela não mostra é escolha em silêncio.
   */
  context: ContextInfo;
  /** Os outros contextos que existem no banco, para o seletor. */
  otherContexts: ContextInfo[];
  period: string;
  periodLabel: string;
  periods: { date: string; label: string; series: string[] }[];
  series: GroupedSeries[];
  missingSeries: string[];
  complete: boolean;
  /**
   * Em que estado está a comparação desta vigência — **três, e não dois**.
   *
   * Sem este campo, duas condições opostas saíam daqui como a mesma leitura:
   * `changes: 0`. E elas pedem ações contrárias — uma diz "siga em frente", a
   * outra diz "falta rodar a comparação".
   *
   * Um booleano `naoComparada` cobria o par pelo avesso e deixava o terceiro
   * estado sem nome: "comparada, e nada mudou" só existia como `!naoComparada
   * && changes === 0`, uma dedução que cada leitor refazia por conta própria —
   * ou esquecia de refazer. Os três estados nomeados tiram a dedução do
   * caminho: quem lê escolhe entre três palavras, e o compilador cobra as três.
   *
   * O estrago já aconteceu três vezes, e nas três a resposta errada era fluente
   * e vinha com a fonte ao lado:
   *
   * 1. O assistente respondeu "0 alterações — sem alterações neste recorte"
   *    num banco com 124 mil fatos e nove vigências.
   * 2. O caminho do agente repetiu o mesmo, meses depois, porque a garantia
   *    tinha sido pendurada no orquestrador do outro caminho.
   * 3. A auditoria de integridade Tool→Evidência rodou inteira sobre conteúdo
   *    vazio e reportou 16 de 18 ferramentas aprovadas. Eram 12.
   *
   * **Por que declarar e não calcular aqui.** A decisão registrada acima —
   * comparar é ato de importação, ler não dispara trabalho pesado — continua
   * valendo, e é ela que garante que dois usuários vejam o mesmo número
   * independentemente de quem abriu a tela primeiro. O defeito nunca foi a
   * função se recusar a calcular; foi ela não dizer que não havia o que ler.
   *
   * Quem precisa do dado materializado chama `garantirComparacoes` **antes**, de
   * propósito e num lugar só. Quem só lê recebe a verdade sobre o que leu.
   */
  comparacao: EstadoDaComparacao;
  totals: {
    changes: number;
    /**
     * Quantas das `changes` são só troca de formato — ver `ChangeGroup.formatOnly`.
     *
     * Fica como **parcela** de `changes`, e não subtraído dele, porque a soma
     * dos `changes` dos grupos tem de continuar fechando com este número. Uma
     * tela que quiser dizer "244 alterações, 62 delas de formato" tem os dois
     * lados aqui; uma que subtraísse em silêncio faria a lista não bater com o
     * cabeçalho, que é o defeito que este campo existe para evitar.
     */
    formatOnlyChanges: number;
    /**
     * De que eixo do motor vieram as `changes` — as quatro parcelas, somando
     * exatamente o total.
     *
     * Existe porque as duas telas que contam a mesma vigência contavam coisas
     * diferentes com palavras parecidas: a aba Planilha mostra "Valores
     * alterados", que é `change_set.value_changes` e conta **só**
     * `SOURCE_CHANGE`; a Visão gerencial mostra "Alterações detectadas", que é
     * `changes` e conta os quatro eixos. Um cliente leu 244 numa tela e 749 na
     * outra, no mesmo período, e não havia nada em nenhuma das duas que
     * explicasse a distância — que é a pior coisa que um produto de auditoria
     * pode fazer com dois números seus.
     *
     * **Contado sobre `rows`, e não lido dos contadores do `change_set`.** Os
     * contadores são gravados no instante do cálculo; `rows` é o que a tabela
     * `change` tem agora. Somar parcelas de uma fonte sob um total de outra
     * produziria um cartão que fecha na aritmética e mente sobre a origem —
     * e foi exatamente essa confusão de fontes que deixou a divergência
     * invisível por tanto tempo. Fechando aqui, o cartão vira o instrumento que
     * denuncia a próxima: se as parcelas somam o total mas o total discorda da
     * outra tela, a causa não está nos eixos, e a tela diz isso sozinha.
     */
    byCategory: {
      /** `SOURCE_CHANGE` — um valor que a fonte mandou mudou. */
      valueChanges: number;
      /** `FLEET_CHANGE` — um ativo entrou ou saiu da frota. */
      fleetChanges: number;
      /** `LAYOUT_CHANGE` — uma coluna apareceu ou sumiu do export. */
      layoutChanges: number;
      /** `SEMANTICS_CHANGE` — o significado de uma coluna mudou. */
      semanticsChanges: number;
      /**
       * Qualquer eixo que o motor passe a emitir e que esta lista não nomeie.
       *
       * Fica visível de propósito: uma parcela que não fecha com o total é um
       * defeito que a tela precisa poder mostrar, não um resto para arredondar.
       */
      outras: number;
    };
    groups: number;
    vehiclesTouched: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    unchanged: number;
    inconclusive: number;
  };
  /** O impacto **desta vigência**. */
  impact: ImpactSummary;
  /**
   * O acumulado de todas as comparações já feitas. Fica num campo próprio, com
   * nome próprio, porque confundir os dois é o erro que o Painel cometia: ele
   * exibia "−R$ 735.312/anual" — a soma de dezesseis transições — ao lado do
   * título de uma vigência só.
   */
  accumulated: ImpactSummary & {
    comparisons: number;
    from: string | null;
    to: string | null;
  };
  groups: ChangeGroup[];
  /**
   * A leitura executiva sobre estes mesmos grupos — ver `cockpit.ts`.
   *
   * Vem na mesma resposta de propósito. É projeção pura sobre o que já está
   * aqui: calcular no cliente exigiria repetir no TypeScript da tela regras de
   * negócio que moram neste pacote e que só aqui são testadas, e pedir numa
   * segunda chamada faria a tela render duas leituras que podem divergir.
   */
  cockpit: CockpitView;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

interface RawChange extends Record<string, unknown> {
  id: number;
  change_set_id: string;
  category: string;
  change_type: string;
  nature: string | null;
  entity_id: string | null;
  entity_label: string | null;
  entity_type: string | null;
  attribute_code: string | null;
  attribute_source_name: string | null;
  attribute_display_name: string | null;
  value_before: string | null;
  value_after: string | null;
  numeric_before: string | null;
  numeric_after: string | null;
  delta_percent: string | null;
  comparability: string;
  inconclusive_reason: string | null;
  impact_confidence: string;
  impact_amount: string | null;
  impact_periodicity: string | null;
  impact_reason: string | null;
  cost_class: string | null;
  taxonomy_name: string | null;
  semantics_status: string | null;
  aggregation: string | null;
  is_monetary: boolean | null;
  unit: string | null;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Todas as linhas de um conjunto de comparações, sem limite.
 *
 * Sem paginação de propósito: agrupar exige ver o conjunto inteiro, e um grupo
 * calculado sobre as primeiras 300 linhas contaria veículos errado. O maior
 * período desta base tem 593 linhas; o maior conjunto inteiro, 3.224.
 */
export async function loadChanges(
  db: Database,
  changeSetIds: string[],
): Promise<RawChange[]> {
  if (changeSetIds.length === 0) return [];
  const { rows } = await db.execute<RawChange>(sql`
    SELECT c.id, c.change_set_id, c.category, c.change_type, c.nature,
           c.entity_id::text AS entity_id, c.entity_label, c.entity_type,
           c.attribute_code, a.source_name AS attribute_source_name,
           a.display_name AS attribute_display_name,
           c.value_before, c.value_after,
           c.numeric_before::text AS numeric_before,
           c.numeric_after::text  AS numeric_after,
           c.delta_percent::text  AS delta_percent,
           c.comparability, c.inconclusive_reason,
           c.impact_confidence, c.impact_amount::text AS impact_amount,
           c.impact_periodicity, c.impact_reason,
           c.cost_class, c.taxonomy_name, c.semantics_status,
           a.aggregation, a.is_monetary, a.unit
      FROM "change" c
      LEFT JOIN attribute a ON a.code = c.attribute_code
     WHERE c.change_set_id IN (${sql.join(
       changeSetIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
  `);
  return rows;
}

/**
 * O impacto de um conjunto de linhas, com a dupla contagem retirada.
 *
 * A exclusão é por ativo: um total só sai da soma no ativo em que alguma
 * parcela dele também mudou. Ver `composition.ts` para por que essa é a
 * granularidade certa.
 */
export function summariseImpact(
  rows: RawChange[],
  /**
   * Índice de composição já pronto, quando `rows` é uma **fatia** do conjunto.
   *
   * Obrigatório ao somar por família: `carreta.custo_fixo` está em Aquisição e
   * financiamento, e a sua parcela `lucro_fixomodelo_novo_ciclo` está em
   * Modelos de remuneração. Um índice construído só com as linhas da primeira
   * não veria a segunda mudar, o titular voltaria para dentro da soma, e o
   * total inflaria — o mesmo defeito de 71% que este produto já corrigiu uma
   * vez, reintroduzido pela porta do agrupamento.
   */
  precomputedIndex?: Map<string, Set<string>>,
): ImpactSummary {
  const changedByEntity =
    precomputedIndex ??
    indexChangedAttributesByEntity(
      rows.map((r) => ({ entityId: r.entity_id, attributeCode: r.attribute_code })),
    );

  const byPeriodicity: Record<string, number> = {};
  const excludedByPeriodicity: Record<string, number> = {};
  let excludedChanges = 0;
  let notCalculable = 0;
  let calculatedChanges = 0;

  for (const row of rows) {
    if (row.impact_confidence !== "CALCULATED" || row.impact_amount === null) {
      notCalculable++;
      continue;
    }
    calculatedChanges++;
    const bucket = row.impact_periodicity ?? "SEM_PERIODICIDADE";
    const amount = Number(row.impact_amount);
    if (isCoveredByParts(row.attribute_code, row.entity_id, changedByEntity)) {
      excludedByPeriodicity[bucket] = (excludedByPeriodicity[bucket] ?? 0) + amount;
      excludedChanges++;
      continue;
    }
    byPeriodicity[bucket] = (byPeriodicity[bucket] ?? 0) + amount;
  }

  return {
    byPeriodicity: round(byPeriodicity),
    excludedByPeriodicity: round(excludedByPeriodicity),
    excludedChanges,
    notCalculable,
    calculatedChanges,
  };
}

function round(buckets: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, Number(v.toFixed(2))]),
  );
}

// ---------------------------------------------------------------------------
// Agrupamento
// ---------------------------------------------------------------------------

/**
 * Chave do grupo.
 *
 * `comparability` e `impact_confidence` entram porque misturar comparável com
 * incomparável, ou com preço com sem preço, produziria um cartão cujo número
 * não descreve as linhas que ele diz representar.
 */
export function groupKey(row: RawChange): string {
  return [
    row.attribute_code ?? "(sem atributo)",
    row.entity_type ?? "(sem equipamento)",
    row.change_type,
    row.comparability,
    row.impact_confidence,
  ].join("|");
}

export function buildGroup(
  rows: RawChange[],
  fleetByChangeSet: Map<string, number>,
  changedByEntity: Map<string, Set<string>>,
): ChangeGroup {
  const first = rows[0];
  const entities = new Set(rows.map((r) => r.entity_id ?? String(r.id)));
  const vehicles = entities.size;

  // A frota da série a que este grupo pertence. Quando o grupo abrange mais de
  // uma comparação (não acontece hoje, mas nada impede), toma-se a maior.
  const fleet = Math.max(
    ...rows.map(
      (r) => fleetByChangeSet.get(`${r.change_set_id}\u001f${r.entity_type}`) ?? 0,
    ),
    vehicles,
  );

  // ---- padrões distintos -------------------------------------------------
  const patternCounts = new Map<string, { before: string | null; after: string | null; vehicles: number }>();
  for (const row of rows) {
    const key = `${row.value_before ?? "∅"}→${row.value_after ?? "∅"}`;
    const entry = patternCounts.get(key);
    if (entry) entry.vehicles++;
    else patternCounts.set(key, { before: row.value_before, after: row.value_after, vehicles: 1 });
  }
  const patterns = patternCounts.size;
  const dominant =
    patterns > 1
      ? [...patternCounts.values()].sort((a, b) => b.vehicles - a.vehicles)[0]
      : null;

  // ---- agregado ----------------------------------------------------------
  // `podeSomar` e não `aggregation === "SUM"`: a pergunta é a mesma do impacto
  // e da composição, e a diferença deste cartão é só *qual* pergunta ele faz —
  // aritmética sobre o arquivo, sem exigir confirmação. A tarja TRAVADO abaixo
  // é quem avisa que a semântica ainda é proposta.
  const summable = podeSomar({
    unit: first.unit,
    aggregation: first.aggregation,
    isMonetary: first.is_monetary,
    semanticsStatus: first.semantics_status,
  }).ok;
  let totalBefore: number | null = null;
  let totalAfter: number | null = null;
  let rowsInTotal = 0;
  if (summable) {
    for (const row of rows) {
      const b = num(row.numeric_before);
      const a = num(row.numeric_after);
      if (b === null || a === null) continue;
      totalBefore = (totalBefore ?? 0) + b;
      totalAfter = (totalAfter ?? 0) + a;
      rowsInTotal++;
    }
  }
  const percents = rows
    .map((r) => num(r.delta_percent))
    .filter((v): v is number => v !== null);

  const aggregate: GroupAggregate = {
    summable,
    aggregation: first.aggregation,
    totalBefore: totalBefore === null ? null : Number(totalBefore.toFixed(2)),
    totalAfter: totalAfter === null ? null : Number(totalAfter.toFixed(2)),
    rowsInTotal,
    perVehicle:
      summable && rowsInTotal > 0 && totalBefore !== null && totalAfter !== null
        ? {
            numeratorBefore: Number(totalBefore.toFixed(2)),
            numeratorAfter: Number(totalAfter.toFixed(2)),
            denominator: rowsInTotal,
            averageBefore: Number((totalBefore / rowsInTotal).toFixed(2)),
            averageAfter: Number((totalAfter / rowsInTotal).toFixed(2)),
          }
        : null,
    deltaPercent:
      summable && totalBefore !== null && totalAfter !== null && totalBefore !== 0
        ? Number((((totalAfter - totalBefore) / Math.abs(totalBefore)) * 100).toFixed(1))
        : null,
    minPercent: percents.length ? Number(Math.min(...percents).toFixed(1)) : null,
    maxPercent: percents.length ? Number(Math.max(...percents).toFixed(1)) : null,
  };

  // ---- impacto, com a dupla contagem separada ----------------------------
  let counted = 0;
  let excluded = 0;
  let amount: number | null = null;
  let excludedAmount: number | null = null;
  for (const row of rows) {
    if (row.impact_confidence !== "CALCULATED" || row.impact_amount === null) continue;
    const value = Number(row.impact_amount);
    if (isCoveredByParts(row.attribute_code, row.entity_id, changedByEntity)) {
      excludedAmount = (excludedAmount ?? 0) + value;
      excluded++;
    } else {
      amount = (amount ?? 0) + value;
      counted++;
    }
  }
  const composition = compositionOf(first.attribute_code);
  const impact: GroupImpact = {
    confidence: first.impact_confidence,
    amount: amount === null ? null : Number(amount.toFixed(2)),
    periodicity: first.impact_periodicity,
    reason: first.impact_reason,
    countedVehicles: counted,
    excludedVehicles: excluded,
    excludedAmount: excludedAmount === null ? null : Number(excludedAmount.toFixed(2)),
    excludedReason:
      excluded > 0 && composition
        ? `Este atributo é o total de ${composition.parts.length} parcelas, e em ` +
          `${excluded} ${excluded === 1 ? "veículo" : "veículos"} a parcela também mudou. ` +
          `A variação já está contada nelas — somar o total de novo contaria o mesmo ` +
          `dinheiro duas vezes. A alteração continua na lista e continua rastreável.`
        : null,
  };

  // ---- anomalias de formato ----------------------------------------------
  const anomalyIndex = new Map<string, Anomaly & { vehicles: number }>();
  for (const row of rows) {
    const before: AnomalySide = {
      numeric: num(row.numeric_before),
      text: row.value_before,
      date: null,
      display: row.value_before,
    };
    const after: AnomalySide = {
      numeric: num(row.numeric_after),
      text: row.value_after,
      date: null,
      display: row.value_after,
    };
    const anomaly = detectFormatAnomaly(before, after);
    if (!anomaly) continue;
    // A diferença entra na chave: "instantes diferentes" agrupa casos de
    // magnitudes distintas, e um milissegundo de perda de precisão não é a
    // mesma notícia que um dia de diferença.
    const key = `${anomaly.kind}|${anomaly.sameInstant}|${anomaly.differenceMs}`;
    const found = anomalyIndex.get(key);
    if (found) found.vehicles++;
    else anomalyIndex.set(key, { ...anomaly, vehicles: 1 });
  }
  const anomalies = [...anomalyIndex.values()];
  // Só é troca de formato pura quando **nenhuma** linha do grupo escapou: uma
  // única data que mudou de verdade no meio das 62 faz do grupo uma alteração,
  // e é ela que o auditor precisa ver.
  const formatOnlyRows = anomalies
    .filter((a) => a.formatOnly)
    .reduce((total, a) => total + a.vehicles, 0);
  const formatOnly = anomalies.length > 0 && formatOnlyRows === rows.length;

  // ---- cobertura ---------------------------------------------------------
  const share = fleet > 0 ? vehicles / fleet : 0;
  const coverage: Coverage = share >= 1 ? "TOTAL" : share >= 0.5 ? "MAIORIA" : "PARCIAL";

  const natures = [...new Set(rows.map((r) => r.nature).filter((n): n is string => n !== null))];

  const badge = pickBadge({ impact, coverage, aggregate, anomalies, formatOnly, natures, first });

  return {
    key: groupKey(first),
    attributeCode: first.attribute_code,
    title: attributeLabel(
      first.attribute_code,
      first.attribute_source_name,
      first.attribute_display_name,
    ),
    entityType: first.entity_type,
    equipment: equipmentLabel(first.entity_type),
    changeType: first.change_type,
    category: first.category,
    comparability: first.comparability,
    changes: rows.length,
    vehicles,
    fleet,
    coverage,
    coverageLabel: coverageLabel(coverage, vehicles, fleet, first.entity_type),
    patterns,
    dominantPattern: dominant,
    aggregate,
    impact,
    natures: natures.map(natureLabel),
    natureCodes: natures,
    semanticsStatus: first.semantics_status,
    semanticsLabel: semanticsLabel(first.semantics_status),
    unit: first.unit,
    isMonetary: first.is_monetary,
    costClass: first.cost_class,
    taxonomyName: first.taxonomy_name,
    inconclusiveReason: rows.find((r) => r.inconclusive_reason)?.inconclusive_reason ?? null,
    anomalies,
    formatOnly,
    composition: composition
      ? { total: composition.total, parts: composition.parts, evidence: composition.evidence }
      : null,
    badge,
    badgeLabel: BADGE_LABELS[badge],
  };
}

function coverageLabel(
  coverage: Coverage,
  vehicles: number,
  fleet: number,
  entityType: string | null,
): string {
  const noun = equipmentPluralNoun(entityType);
  if (coverage === "TOTAL") return `Toda a frota · ${vehicles} de ${fleet} ${noun}`;
  if (coverage === "MAIORIA") return `Maioria da frota · ${vehicles} de ${fleet} ${noun}`;
  return `${vehicles} de ${fleet} ${noun}`;
}

const BADGE_LABELS: Record<Badge, string> = {
  DINHEIRO: "Dinheiro",
  RUPTURA: "Ruptura",
  COBERTURA: "Abrangência",
  MOVIMENTO: "Movimento grande",
  TRAVADO: "Preço travado",
  FORMATO: "Formato da fonte",
  SEM_SINAL: "Sem sinal relevante",
};

/** Naturezas que caracterizam ruptura: o valor não apenas variou, ele trocou de estado. */
const RUPTURE_NATURES = new Set([
  "ZEROING",
  "FROM_ZERO",
  "TYPE_CHANGE",
  "APPEARED",
  "DISAPPEARED",
  "NULL_REASON",
  "SEMANTICS_DRIFT",
]);

/**
 * O selo do grupo. Primeira regra que casar, e só uma.
 *
 * A ordem é a da proposta, com uma troca deliberada: **ruptura vem antes de
 * abrangência**. Um valor que trocou de tipo em toda a frota é mais acionável
 * como "a fonte mudou a forma do dado" do que como "mexeu em todo mundo" — foi
 * exatamente o caso de `dataFimContrato` em Ago/2026, e classificá-lo por
 * abrangência esconderia a única coisa que importa nele.
 *
 * E antes de ruptura vem `FORMATO`, que é a correção da leitura acima. Ruptura
 * responde *o valor trocou de estado*; quando o valor dos dois lados é o mesmo
 * instante escrito de outro jeito, nada trocou de estado — o que trocou foi o
 * arquivo. Chamar isso de ruptura punha a troca de formato de agosto no topo da
 * fila de risco, acima de dinheiro apurado de verdade.
 *
 * Nenhum selo é limiar financeiro: uma alteração pequena pode ser
 * contratualmente relevante, e o produto não decide isso pelo usuário.
 */
function pickBadge(input: {
  impact: GroupImpact;
  coverage: Coverage;
  aggregate: GroupAggregate;
  anomalies: unknown[];
  formatOnly: boolean;
  natures: string[];
  first: RawChange;
}): Badge {
  const { impact, coverage, aggregate, anomalies, formatOnly, natures, first } = input;

  if (impact.amount !== null && impact.amount !== 0) return "DINHEIRO";
  // Um total cuja variação inteira já está nas parcelas continua sendo um
  // cartão de dinheiro — o que ele tem a dizer é justamente que não deve ser
  // somado de novo. Classificá-lo por outro selo esconderia essa explicação.
  if (impact.excludedVehicles > 0) return "DINHEIRO";
  // Dinheiro apurado ganha de formato de propósito: se houver valor calculado
  // no grupo, há o que conferir em reais, e o formato vira contexto disso.
  if (formatOnly) return "FORMATO";
  if (anomalies.length > 0) return "RUPTURA";
  if (natures.some((n) => RUPTURE_NATURES.has(n))) return "RUPTURA";
  if (first.comparability === "INCONCLUSIVE") return "RUPTURA";
  if (coverage === "TOTAL" || coverage === "MAIORIA") return "COBERTURA";

  const movement =
    aggregate.deltaPercent !== null
      ? Math.abs(aggregate.deltaPercent)
      : Math.max(Math.abs(aggregate.minPercent ?? 0), Math.abs(aggregate.maxPercent ?? 0));
  if (movement >= 20) return "MOVIMENTO";

  // Somaria, é dinheiro, e só falta a confirmação: a diferença exata entre as
  // duas perguntas da autoridade.
  const semantica = {
    unit: first.unit,
    aggregation: first.aggregation,
    isMonetary: first.is_monetary,
    semanticsStatus: first.semantics_status,
  };
  if (first.is_monetary === true && podeSomar(semantica).ok && !viraDinheiro(semantica).ok) {
    return "TRAVADO";
  }
  return "SEM_SINAL";
}

/**
 * A ordem da lista.
 *
 * `FORMATO` fica no fim, e não fora: um ponto que só mudou de formato não
 * disputa atenção com dinheiro nem com ruptura, mas continua sendo uma notícia
 * — se ninguém a vir, na vigência seguinte a coluna volta ao normal (ou muda de
 * verdade) e não haverá registro de que a exportação oscilou.
 */
const BADGE_ORDER: Badge[] = [
  "DINHEIRO",
  "RUPTURA",
  "COBERTURA",
  "MOVIMENTO",
  "TRAVADO",
  "SEM_SINAL",
  "FORMATO",
];

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

/**
 * A visão da vigência escolhida, agrupada.
 *
 * Diferente de `getConsolidated`, esta função **não** calcula comparação: ela
 * lê as que existem. Comparar é ato de importação (`computeMissingChangeSets`);
 * abrir uma tela não deve disparar trabalho pesado nem, pior, produzir números
 * diferentes conforme quem abriu primeiro.
 */
export async function getGroupedView(
  db: Database,
  period?: string,
  requestedContext?: RequestedContext,
): Promise<GroupedView | null> {
  const contexts = await listContexts(db);
  const context = await resolveContext(db, requestedContext, contexts);
  if (!context) return null;

  const periods = await listPeriods(db, context);
  if (periods.length === 0) return null;

  const target = period
    ? periods.find((p) => p.effective_date === period)
    : periods[0];
  if (!target) return null;

  const otherContexts = contexts.filter(
    (c) => !(c.scopeHash === context.scopeHash && c.channel === context.channel),
  );

  // As comparações que terminam nesta vigência, uma por série.
  const { rows: sets } = await db.execute<{
    change_set_id: string;
    entity_type_set: string;
    snapshot_label: string;
    previous_label: string | null;
    fleet: number;
    entities_added: number;
    entities_removed: number;
    unchanged: number;
    inconclusive: number;
  }>(sql`
    SELECT cs.id AS change_set_id,
           sb.entity_type_set,
           sb.source_label AS snapshot_label,
           sa.source_label AS previous_label,
           sb.entity_count  AS fleet,
           cs.entities_added, cs.entities_removed, cs.unchanged, cs.inconclusive
      FROM change_set cs
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
     WHERE sb.effective_date = ${target.effective_date}::date
       AND sb.status <> 'SUPERSEDED'
       -- Sem este filtro, duas unidades que entregam na mesma data caem no
       -- mesmo cartão e no mesmo total, sem que nada na tela diga que caíram.
       AND ${contextFilter("sb", context)}
     -- Determinístico: a mesma vigência tem uma comparação por série, e a
     -- ordem não pode depender do que o Postgres devolver primeiro. Foi
     -- assim que o Painel passou a mostrar a série de menor impacto e a
     -- omitir a maior, sem dizer que omitia.
     ORDER BY sb.entity_type_set
  `);

  // As séries desta vigência, uma por **componente** de equipamento.
  //
  // Uma vigência completa cobre CARRETA e CAVALO num snapshot só desde que os
  // dois passaram a ser componentes da mesma identidade canônica. A tela
  // continua mostrando uma série por equipamento, e a frota de cada uma é a
  // dela — não a soma das duas. Sem essa distinção, a cobertura de um atributo
  // de cavalo era medida contra a frota inteira e um atributo presente em todos
  // os cavalos aparecia como "parcial".
  const { rows: seriesRows } = await db.execute<{
    change_set_id: string;
    entity_type: string;
    snapshot_label: string;
    previous_label: string | null;
    previous_date: string | null;
    fleet: number;
  }>(sql`
    SELECT cs.id AS change_set_id,
           t AS entity_type,
           sb.source_label AS snapshot_label,
           sa.source_label AS previous_label,
           -- A vigência do outro lado da comparação. Vem daqui, e não de uma
           -- conta sobre a data desta, porque findPreviousSnapshot compara
           -- cada série com a última entrega *dela* — uma série que pulou
           -- setembro compara outubro contra agosto, e subtrair um mês
           -- escreveria "setembro" num lado que ninguém entregou.
           sa.effective_date::text AS previous_date,
           (
             SELECT count(DISTINCT f.entity_id)::int
               FROM fact f
               JOIN entity e ON e.id = f.entity_id
              WHERE f.snapshot_id = sb.id AND e.entity_type = t
           ) AS fleet
      FROM change_set cs
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      CROSS JOIN LATERAL unnest(string_to_array(sb.entity_type_set, '+')) AS t
     WHERE sb.effective_date = ${target.effective_date}::date
       AND sb.status <> 'SUPERSEDED'
       AND ${contextFilter("sb", context)}
     ORDER BY t
  `);

  // Séries que existiram nesta vigência mas ainda não têm comparação (a
  // primeira de uma série não tem anterior). Nomeadas, nunca supostas zero.
  const { rows: snapshotsHere } = await db.execute<{
    entity_type_set: string;
    source_label: string;
    fleet: number;
  }>(sql`
    SELECT t AS entity_type_set,
           s.source_label,
           (
             SELECT count(DISTINCT f.entity_id)::int
               FROM fact f
               JOIN entity e ON e.id = f.entity_id
              WHERE f.snapshot_id = s.id AND e.entity_type = t
           ) AS fleet
      FROM snapshot s
      CROSS JOIN LATERAL unnest(string_to_array(s.entity_type_set, '+')) AS t
     WHERE s.effective_date = ${target.effective_date}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     ORDER BY t
  `);

  const withSet = new Set(seriesRows.map((s) => s.entity_type));
  const series: GroupedSeries[] = [
    ...seriesRows.map((s) => ({
      entityTypeSet: s.entity_type,
      equipment: equipmentLabel(s.entity_type),
      snapshotLabel: s.snapshot_label,
      previousLabel: s.previous_label,
      previousPeriod: s.previous_date,
      previousPeriodLabel: s.previous_date ? periodLabel(s.previous_date) : null,
      fleet: s.fleet,
      changeSetId: s.change_set_id,
      reason: null,
    })),
    ...snapshotsHere
      .filter((s) => !withSet.has(s.entity_type_set))
      .map((s) => ({
        entityTypeSet: s.entity_type_set,
        equipment: equipmentLabel(s.entity_type_set),
        snapshotLabel: s.source_label,
        previousLabel: null,
        previousPeriod: null,
        previousPeriodLabel: null,
        fleet: s.fleet,
        changeSetId: null,
        reason:
          "Primeira vigência desta série, ou comparação ainda não calculada. " +
          "Não há anterior com que comparar, e a ausência não está contada como zero.",
      })),
  ];

  const allSeries = (target.series ?? []) as string[];
  const missingSeries = allSeries.filter(
    (s) => !series.some((p) => p.entityTypeSet === s),
  );

  const changeSetIds = sets.map((s) => s.change_set_id);
  // Indexada por (comparação, equipamento): a frota de um grupo é a do
  // equipamento a que o atributo pertence.
  const fleetByChangeSet = new Map(
    seriesRows.map((s) => [`${s.change_set_id}\u001f${s.entity_type}`, s.fleet]),
  );
  const rows = await loadChanges(db, changeSetIds);

  const changedByEntity = indexChangedAttributesByEntity(
    rows.map((r) => ({ entityId: r.entity_id, attributeCode: r.attribute_code })),
  );

  const buckets = new Map<string, RawChange[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const groups = [...buckets.values()]
    .map((bucket) => buildGroup(bucket, fleetByChangeSet, changedByEntity))
    .sort(compareGroups);

  const vehiclesTouched = new Set(
    rows.map((r) => r.entity_id).filter((v): v is string => v !== null),
  ).size;

  /*
    `NAO_MATERIALIZADA` exige as duas metades: nenhuma comparação termina nesta
    vigência **e** existe anterior com que comparar. A primeira entrega de uma
    série não tem anterior, e isso é condição normal do domínio, não estado
    derivado faltando — marcá-la como pendente faria o aviso aparecer para
    sempre no começo de todo histórico, e um aviso que sempre aparece deixa de
    ser lido. Ela cai em `SEM_ALTERACOES`, que é o que ela é: não há movimento a
    relatar, e não há cálculo faltando.
  */
  const comparacao: EstadoDaComparacao =
    sets.length === 0 && periods.some((p) => p.effective_date < target.effective_date)
      ? "NAO_MATERIALIZADA"
      : rows.length > 0
        ? "COM_ALTERACOES"
        : "SEM_ALTERACOES";

  const base = {
    context,
    otherContexts,
    period: target.effective_date,
    periodLabel: periodLabel(target.effective_date),
    periods: periods.map((p) => ({
      date: p.effective_date,
      label: periodLabel(p.effective_date),
      series: p.series ?? [],
    })),
    series,
    missingSeries,
    complete: missingSeries.length === 0,
    comparacao,
    totals: {
      changes: rows.length,
      formatOnlyChanges: groups
        .filter((g) => g.formatOnly)
        .reduce((total, g) => total + g.changes, 0),
      byCategory: contarPorEixo(rows),
      groups: groups.length,
      vehiclesTouched,
      entitiesAdded: sets.reduce((s, r) => s + r.entities_added, 0),
      entitiesRemoved: sets.reduce((s, r) => s + r.entities_removed, 0),
      unchanged: sets.reduce((s, r) => s + r.unchanged, 0),
      inconclusive: sets.reduce((s, r) => s + r.inconclusive, 0),
    },
    impact: summariseImpact(rows),
    accumulated: await getAccumulatedImpact(db, context),
    groups,
  };

  return { ...base, cockpit: buildCockpit(base) };
}

/**
 * As `changes` separadas pelo eixo do motor que as produziu.
 *
 * Uma passada sobre as mesmas linhas que deram o total, para que as parcelas
 * não possam divergir dele por construção. O que não cair nos quatro eixos
 * conhecidos vai para `outras` em vez de sumir: um eixo novo aparecendo na
 * tela como resto visível é um aviso; sumindo em silêncio, é um total que
 * deixou de fechar sem que ninguém soubesse.
 */
function contarPorEixo(rows: RawChange[]): GroupedView["totals"]["byCategory"] {
  const contagem = {
    valueChanges: 0,
    fleetChanges: 0,
    layoutChanges: 0,
    semanticsChanges: 0,
    outras: 0,
  };
  for (const row of rows) {
    if (row.category === "SOURCE_CHANGE") contagem.valueChanges++;
    else if (row.category === "FLEET_CHANGE") contagem.fleetChanges++;
    else if (row.category === "LAYOUT_CHANGE") contagem.layoutChanges++;
    else if (row.category === "SEMANTICS_CHANGE") contagem.semanticsChanges++;
    else contagem.outras++;
  }
  return contagem;
}

export function compareGroups(a: ChangeGroup, b: ChangeGroup): number {
  const rank = BADGE_ORDER.indexOf(a.badge) - BADGE_ORDER.indexOf(b.badge);
  if (rank !== 0) return rank;
  const impact = Math.abs(b.impact.amount ?? 0) - Math.abs(a.impact.amount ?? 0);
  if (impact !== 0) return impact;
  if (b.vehicles !== a.vehicles) return b.vehicles - a.vehicles;
  const movement =
    Math.abs(b.aggregate.deltaPercent ?? 0) - Math.abs(a.aggregate.deltaPercent ?? 0);
  if (movement !== 0) return movement;
  return (a.attributeCode ?? "").localeCompare(b.attributeCode ?? "");
}

/**
 * O acumulado de todas as comparações já feitas — com a mesma regra de dupla
 * contagem aplicada, para que o número histórico e o da vigência sejam
 * comparáveis entre si.
 */
export async function getAccumulatedImpact(
  db: Database,
  requestedContext?: RequestedContext,
): Promise<ImpactSummary & { comparisons: number; from: string | null; to: string | null }> {
  const context = await resolveContext(db, requestedContext);
  if (!context) {
    return {
      byPeriodicity: {},
      excludedByPeriodicity: {},
      excludedChanges: 0,
      notCalculable: 0,
      calculatedChanges: 0,
      comparisons: 0,
      from: null,
      to: null,
    };
  }

  // O acumulado é o desta unidade e deste canal. Somar o histórico de todas as
  // unidades sob o título de uma delas seria a mesma confusão entre vigência e
  // histórico que este campo existe para desfazer, um nível acima.
  // Uma comparação por (vigência, equipamento): é assim que a tela conta, e é o
  // que mantém o número comparável com o de antes de CAVALO e CARRETA passarem
  // a dividir um snapshot. Os ids saem distintos para `loadChanges`, senão cada
  // alteração seria carregada — e somada — duas vezes.
  const { rows: sets } = await db.execute<{ id: string; entity_type: string }>(sql`
    SELECT cs.id, t AS entity_type
      FROM change_set cs
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
      CROSS JOIN LATERAL unnest(string_to_array(sb.entity_type_set, '+')) AS t
     WHERE ${contextFilter("sb", context)}
  `);
  const { rows: span } = await db.execute<{ from: string | null; to: string | null }>(sql`
    SELECT min(sb.effective_date)::text AS from, max(sb.effective_date)::text AS to
      FROM change_set cs JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE ${contextFilter("sb", context)}
  `);
  const rows = await loadChanges(db, [...new Set(sets.map((s) => s.id))]);
  return {
    ...summariseImpact(rows),
    comparisons: sets.length,
    from: span[0]?.from ?? null,
    to: span[0]?.to ?? null,
  };
}

// ---------------------------------------------------------------------------
// Nível 2 — o que está dentro de um grupo
// ---------------------------------------------------------------------------

export interface GroupVehicle {
  changeId: number;
  plate: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  numericBefore: number | null;
  numericAfter: number | null;
  deltaPercent: number | null;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  impactConfidence: string;
  /** Se este ativo está fora da soma por já estar contado nas parcelas. */
  excludedFromTotal: boolean;
  inconclusiveReason: string | null;
  anomaly: Anomaly | null;
  /**
   * As duas vigências desta linha — de onde saiu o "Antes" e de onde saiu o
   * "Agora".
   *
   * Vem por linha, e não uma vez por resposta, porque a comparação é da
   * **série**: a comparação do cavalo e a da carreta terminam na mesma
   * vigência e podem começar em vigências diferentes, e uma série que pulou um
   * mês compara contra o que entregou por último. Cada linha carrega o
   * `change_set` a que pertence, então carrega também as duas pontas dele — e
   * o cabeçalho da tabela deixa de ser um palpite sobre o calendário.
   */
  periodBefore: string;
  periodAfter: string;
  /** As mesmas duas datas escritas para leitura: `julho/2026`, `agosto/2026`. */
  periodBeforeLabel: string;
  periodAfterLabel: string;
}

export interface GroupSelector {
  period: string;
  attributeCode: string;
  entityType: string;
  changeType?: string;
  comparability?: string;
  impactConfidence?: string;
  /** O contexto do cartão que abriu esta lista. Sem ele, o mais recente. */
  scopeHash?: string;
  channel?: string | null;
}

/** Os veículos de um grupo, com o valor de cada um e o motivo de exclusão quando houver. */
export async function getGroupVehicles(
  db: Database,
  selector: GroupSelector,
): Promise<GroupVehicle[]> {
  const context = await resolveContext(db, {
    scopeHash: selector.scopeHash,
    ...(selector.channel !== undefined ? { channel: selector.channel } : {}),
  });
  if (!context) return [];

  const { rows: sets } = await db.execute<{
    id: string;
    period_before: string;
    period_after: string;
  }>(sql`
    SELECT cs.id,
           -- As duas pontas da comparação, uma por change_set. Uma vigência
           -- pode ter mais de uma comparação terminando nela (cavalo e carreta
           -- chegam em snapshots separados), e cada uma tem o seu próprio
           -- começo.
           sa.effective_date::text AS period_before,
           sb.effective_date::text AS period_after
      FROM change_set cs
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
     WHERE sb.effective_date = ${selector.period}::date
       AND sb.status <> 'SUPERSEDED'
       AND ${contextFilter("sb", context)}
  `);
  const ids = sets.map((s) => s.id);
  const vigencias = new Map(sets.map((s) => [s.id, s]));
  const all = await loadChanges(db, ids);
  const changedByEntity = indexChangedAttributesByEntity(
    all.map((r) => ({ entityId: r.entity_id, attributeCode: r.attribute_code })),
  );

  const rows = all.filter(
    (r) =>
      r.attribute_code === selector.attributeCode &&
      (r.entity_type ?? "") === selector.entityType &&
      (!selector.changeType || r.change_type === selector.changeType) &&
      (!selector.comparability || r.comparability === selector.comparability) &&
      (!selector.impactConfidence || r.impact_confidence === selector.impactConfidence),
  );

  return rows
    .map((r) => {
      // `loadChanges` só recebeu os ids de `sets`, então toda linha tem o seu
      // par aqui. O `??` existe para o tipo, não para um caso conhecido.
      const vigencia = vigencias.get(r.change_set_id);
      const antes = vigencia?.period_before ?? selector.period;
      const agora = vigencia?.period_after ?? selector.period;
      return {
        changeId: r.id,
        plate: r.entity_label,
        valueBefore: r.value_before,
        valueAfter: r.value_after,
        numericBefore: num(r.numeric_before),
        numericAfter: num(r.numeric_after),
        deltaPercent: num(r.delta_percent),
        impactAmount: num(r.impact_amount),
        impactPeriodicity: r.impact_periodicity,
        impactConfidence: r.impact_confidence,
        excludedFromTotal: isCoveredByParts(r.attribute_code, r.entity_id, changedByEntity),
        inconclusiveReason: r.inconclusive_reason,
        anomaly: detectFormatAnomaly(
          { numeric: num(r.numeric_before), text: r.value_before, date: null, display: r.value_before },
          { numeric: num(r.numeric_after), text: r.value_after, date: null, display: r.value_after },
        ),
        periodBefore: antes,
        periodAfter: agora,
        periodBeforeLabel: periodLabel(antes),
        periodAfterLabel: periodLabel(agora),
      };
    })
    .sort((a, b) => {
      const impact = Math.abs(b.impactAmount ?? 0) - Math.abs(a.impactAmount ?? 0);
      if (impact !== 0) return impact;
      return (a.plate ?? "").localeCompare(b.plate ?? "");
    });
}

// ---------------------------------------------------------------------------
// Nível 2 — a série histórica de um atributo
// ---------------------------------------------------------------------------

export interface AttributeSeriesPoint {
  effectiveDate: string;
  periodLabel: string;
  sourceLabel: string;
  /**
   * Quantos ativos tinham **algum** valor nesta vigência, de qualquer tipo.
   *
   * Contava só os numéricos, e para uma coluna de data isso devolvia zero em
   * oito das nove vigências — a série dizia que ninguém tinha data de fim de
   * contrato até agosto, quando todos tinham. Contar por tipo era a pergunta
   * errada: o denominador é "quem tem valor", não "quem tem número".
   */
  vehicles: number;
  /** Destes, quantos são numéricos — o denominador real de soma e média. */
  numericVehicles: number;
  /** Numerador. Só existe quando a semântica autoriza somar. */
  total: number | null;
  /** total ÷ veículos. Só existe quando somar ou tirar média é legítimo. */
  average: number | null;
  min: number | null;
  max: number | null;
}

export interface AttributeSeries {
  attributeCode: string;
  title: string;
  aggregation: string | null;
  summable: boolean;
  /** Se a média por veículo é uma leitura legítima para este atributo. */
  averageable: boolean;
  unit: string | null;
  periodicity: string | null;
  semanticsStatus: string;
  /** Por que a série mostra o que mostra — e o que ela deliberadamente não mostra. */
  note: string;
  points: AttributeSeriesPoint[];
}

/**
 * A linha do tempo de um atributo nas vigências.
 *
 * O cuidado que define esta função: **a soma da frota não é o preço.** O IPVA
 * dos cavalos sobe de R$ 399.406 para R$ 413.826 entre jan e fev/2026 e nada
 * encareceu — entraram dois cavalos. Por isso a série devolve sempre o
 * numerador, o denominador e a média, e a tela é obrigada a mostrar os três.
 *
 * Para atributos não somáveis não existe total, e dizer isso é a resposta certa.
 */
export async function getAttributeSeries(
  db: Database,
  attributeCode: string,
  requestedContext?: RequestedContext,
): Promise<AttributeSeries | null> {
  // A série é de uma unidade e de um canal. Sem o filtro, duas unidades com a
  // mesma vigência produziriam um ponto só, com a soma das duas frotas — e a
  // média por veículo, que é justamente a defesa contra ler entrada de ativo
  // como aumento de preço, passaria a descrever um universo que não existe.
  const context = await resolveContext(db, requestedContext);
  if (!context) return null;
  const { rows: meta } = await db.execute<{
    code: string;
    source_name: string;
    display_name: string | null;
    aggregation: string | null;
    unit: string | null;
    periodicity: string | null;
    semantics_status: string;
  }>(sql`
    SELECT code, source_name, display_name, aggregation, unit, periodicity,
           semantics_status::text AS semantics_status
      FROM attribute WHERE code = ${attributeCode}
  `);
  if (meta.length === 0) return null;
  const attribute = meta[0];

  // A série tinha a sua própria terceira definição, e era a única que aceitava
  // WEIGHTED_AVG — publicando `total ÷ veículos` sob o nome de média ponderada.
  // `podeTirarMedia` recusa isso enquanto o peso não existir no modelo.
  const semantica = {
    unit: attribute.unit,
    aggregation: attribute.aggregation,
    isMonetary: null,
    semanticsStatus: attribute.semantics_status,
  };
  const summable = podeSomar(semantica).ok;
  const averageable = podeTirarMedia(semantica).ok;

  const { rows: points } = await db.execute<{
    effective_date: string;
    source_label: string;
    vehicles: number;
    numeric_vehicles: number;
    total: string | null;
    min: string | null;
    max: string | null;
  }>(sql`
    SELECT s.effective_date::text AS effective_date,
           s.source_label,
           count(*) FILTER (WHERE NOT f.is_null)::int AS vehicles,
           count(*) FILTER (WHERE NOT f.is_null AND f.value_numeric IS NOT NULL)::int AS numeric_vehicles,
           sum(f.value_numeric)::text AS total,
           min(f.value_numeric)::text AS min,
           max(f.value_numeric)::text AS max
      FROM fact f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN attribute a ON a.id = f.attribute_id
     WHERE a.code = ${attributeCode}
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     GROUP BY 1, 2
     ORDER BY 1
  `);

  return {
    attributeCode,
    title: attributeLabel(attribute.code, attribute.source_name, attribute.display_name),
    aggregation: attribute.aggregation,
    summable,
    averageable,
    unit: attribute.unit,
    periodicity: attribute.periodicity,
    semanticsStatus: attribute.semantics_status,
    note: summable
      ? "A soma da frota muda quando entram ou saem veículos. Compare a média por " +
        "veículo antes de concluir que o preço mudou."
      : averageable
        ? `Este atributo não é somável (agregação ${attribute.aggregation}); a série mostra ` +
          `a média por veículo e a faixa, nunca um total.`
        : "Este atributo não admite soma nem média — a série mostra apenas a faixa " +
          "de valores e quantos ativos tinham valor em cada vigência.",
    points: points.map((p) => {
      const vehicles = Number(p.vehicles);
      const numericVehicles = Number(p.numeric_vehicles);
      const total = p.total === null ? null : Number(Number(p.total).toFixed(2));
      return {
        effectiveDate: p.effective_date,
        periodLabel: periodLabel(p.effective_date),
        sourceLabel: p.source_label,
        vehicles,
        numericVehicles,
        total: summable ? total : null,
        // O denominador da média é o número de ativos com valor **numérico**,
        // que é o mesmo conjunto que formou o numerador. Dividir a soma dos
        // numéricos pelo total de ativos daria uma média de um universo que
        // não produziu aquele total.
        average:
          averageable && total !== null && numericVehicles > 0
            ? Number((total / numericVehicles).toFixed(2))
            : null,
        min: p.min === null ? null : Number(Number(p.min).toFixed(2)),
        max: p.max === null ? null : Number(Number(p.max).toFixed(2)),
      };
    }),
  };
}

/**
 * Os valores distintos de um atributo numa vigência, e quantos ativos em cada.
 *
 * **Por que isto existe.** Boa parte das telas do Freightech não é uma lista de
 * mudanças: é um *cadastro* — PADRÃO mostra 6X4, 6X2, 4X2, 6X6, 8X2; TIPO
 * CARROCERIA mostra os tipos; REGIÃO mostra as regiões. Uma linha por valor
 * registrado, e nada mais.
 *
 * O FreightCheck não recebe esses cadastros; recebe o export de equipamento,
 * onde o mesmo dado aparece de outra forma: uma coluna por ativo. O domínio é a
 * ponte entre as duas formas — **os valores que de fato existem na frota**, que
 * é o que aquelas telas listam, reconstruído do dado que temos.
 *
 * E é mais do que o Freightech mostra, por um detalhe que muda a leitura: junto
 * de cada valor vai **quantos ativos estão nele**. A tela de lá diz que 8X2
 * está cadastrado; esta diz que 8X2 está cadastrado e que nenhum caminhão o
 * usa — que é a diferença entre uma opção viva e uma que sobrou.
 *
 * **Ausência não é um valor.** Ativo sem valor nesta coluna entra numa linha
 * própria, com o motivo que o `fact` registrou, e nunca é misturado com quem
 * tem valor vazio de verdade. Somar os dois faria "sem informação" parecer uma
 * categoria do cadastro.
 */
export interface AttributeDomain {
  attributeCode: string;
  title: string;
  /** A vigência lida: o domínio é de uma data, não do histórico inteiro. */
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  /** Ativos com valor nesta coluna nesta vigência. */
  entities: number;
  values: {
    value: string | null;
    /** Quantos ativos estão neste valor. */
    entities: number;
    /** Fatia da frota, em pontos percentuais, já arredondada. */
    share: number;
    /** Quando é ausência: o motivo que a importação registrou. */
    nullReason: string | null;
  }[];
}

export async function getAttributeDomain(
  db: Database,
  attributeCode: string,
  requestedContext?: RequestedContext,
  period?: string,
): Promise<AttributeDomain | null> {
  const context = await resolveContext(db, requestedContext);
  if (!context) return null;

  const { rows: meta } = await db.execute<{
    code: string;
    source_name: string;
    display_name: string | null;
  }>(sql`
    SELECT code, source_name, display_name FROM attribute WHERE code = ${attributeCode}
  `);
  if (meta.length === 0) return null;

  /*
   * Uma data, e todos os snapshots dela.
   *
   * Cavalo e carreta são snapshots separados na mesma vigência; ler só um
   * devolveria o domínio de metade da frota sem dizer que é metade. E quando a
   * data pedida não existe naquele contexto, a resposta é vazia em vez de cair
   * na vigência mais próxima — silenciosamente responder por outra data é o
   * tipo de gentileza que faz alguém decidir sobre o mês errado.
   */
  const { rows: datas } = await db.execute<{ effective_date: string }>(sql`
    SELECT max(s.effective_date)::text AS effective_date
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
       AND (${period ?? null}::date IS NULL OR s.effective_date = ${period ?? null}::date)
  `);
  const effectiveDate = datas[0]?.effective_date ?? null;
  if (!effectiveDate) return null;

  const { rows } = await db.execute<{
    valor: string | null;
    is_null: boolean;
    null_reason: string | null;
    entities: number;
    source_labels: string[];
  }>(sql`
    SELECT CASE WHEN f.is_null THEN NULL
                ELSE coalesce(
                  f.value_text,
                  f.value_numeric::text,
                  f.value_boolean::text,
                  f.value_date::text
                )
           END                                   AS valor,
           f.is_null,
           f.null_reason,
           count(DISTINCT f.entity_id)::int      AS entities,
           array_agg(DISTINCT s.source_label)    AS source_labels
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE a.code = ${attributeCode}
       AND s.status <> 'SUPERSEDED'
       AND s.effective_date = ${effectiveDate}::date
       AND ${contextFilter("s", context)}
     GROUP BY 1, 2, 3
     ORDER BY 4 DESC, 1
  `);

  const entities = rows.reduce((soma, r) => soma + Number(r.entities), 0);
  const rotulos = new Set<string>();
  for (const r of rows) for (const rotulo of r.source_labels ?? []) rotulos.add(rotulo);

  return {
    attributeCode,
    title: attributeLabel(meta[0].code, meta[0].source_name, meta[0].display_name),
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    sourceLabels: [...rotulos].sort(),
    entities,
    values: rows.map((r) => ({
      value: r.is_null ? null : r.valor,
      entities: Number(r.entities),
      share: entities === 0 ? 0 : Math.round((Number(r.entities) / entities) * 1000) / 10,
      nullReason: r.is_null ? (r.null_reason ?? "sem motivo registrado") : null,
    })),
  };
}

/**
 * A tabela de ativos: uma linha por veículo, uma coluna por atributo.
 *
 * **A terceira forma de tela do Freightech**, e a que mais custa a montar do
 * nosso lado. As outras duas já existiam aqui: *movimento* (o que mudou num
 * ponto) e *domínio* (os valores distintos de uma coluna). Esta é o inventário
 * — CARRETA abre com uma linha por placa e cinquenta colunas ao lado, da placa
 * ao ICMS, e é assim que o operador confere um ativo específico.
 *
 * O nosso modelo guarda isso deitado: um fato por (snapshot, entidade,
 * atributo). Levantar de volta é um pivô, e ele é feito aqui em vez de no SQL
 * de propósito — `crosstab` exigiria a lista de colunas fixa na consulta, e a
 * lista muda por cartão. Com 62 ativos e 50 colunas são 3.100 fatos, que é
 * pouco; se um dia forem 300 mil, o lugar de resolver é o índice
 * `fact_snapshot_attribute_idx`, que já existe e já é o caminho usado.
 *
 * **Ausência tem lugar próprio.** Uma célula sem valor devolve `null` com o
 * motivo que a importação registrou, e nunca zero: numa tabela de custo, "não
 * informado" e "zero" são a diferença entre um ativo sem contrato e um ativo de
 * graça.
 */
export interface EntityTable {
  /**
   * Se esta vigência trouxe a série deste equipamento.
   *
   * Existe porque a resposta "0 ativos, 38 colunas desconhecidas" tem duas
   * causas com conserto oposto: ou o cartão pede colunas que o dicionário não
   * tem, ou **o arquivo daquele equipamento nunca foi importado**. A segunda
   * manda importar uma planilha; a primeira manda conferir o cartão. Sem este
   * campo a tela só sabe dizer a primeira, e culpa o cartão por um arquivo que
   * falta.
   */
  seriesDelivered: boolean;
  /** Quantas colunas deste equipamento o dicionário conhece, ao todo. */
  attributesKnown: number;
  /**
   * Quando não há nada aqui: **onde a série está**, se estiver em algum lugar.
   *
   * "Nenhum arquivo de CARRETA foi importado" é uma frase que o operador que
   * acabou de importar `Modelo_Carreta.xlsx` lê como mentira — e ele tem razão:
   * o arquivo chegou, o que não chegou foi a *identidade* que a tela procura.
   * Três coisas mandam o dado para longe do cartão sem que a importação falhe:
   *
   * - **Outro nome no dicionário.** Antes da correção de `deriveEntityType`, a
   *   aba `Modelo_Carreta` virava o tipo `MODELOCARRETA`, com 65 colunas
   *   paralelas às de carreta. Importações antigas continuam com essa
   *   identidade no banco — corrigir a regra não reescreve o que já entrou, e
   *   reimportar tampouco: o ativo é reconhecido pela placa, então a
   *   reimportação reaproveita a mesma linha de `entity` com o tipo antigo e
   *   só duplica dicionário e vigências. Quem conserta é
   *   `freightcheck_correct_entity_type` (migration 0009).
   * - **Outro contexto ou outra vigência.** O arquivo entrou, mas em outra
   *   unidade, outro canal ou outro mês, e a tela está filtrando por este.
   * - **A importação parou antes de promover.** A aba está no RAW, recusada
   *   pelo classificador ou aguardando a promoção, e nada dela é canônico.
   *
   * As três mandam fazer coisas diferentes — reimportar, trocar o filtro, ler
   * o motivo da recusa — e nenhuma delas é "importe o arquivo que falta".
   * Preenchido só quando a tabela volta vazia; caro demais para o caso feliz.
   */
  elsewhere: EntityElsewhere;
  entityType: string;
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  /** Só as colunas pedidas que existem no dicionário, na ordem pedida. */
  columns: { code: string; title: string }[];
  /** As colunas pedidas que o dicionário não conhece — ditas, não engolidas. */
  missingColumns: string[];
  rows: {
    entityId: string;
    /** A placa, quando o ativo tem uma. */
    label: string | null;
    values: Record<string, { value: string | null; nullReason: string | null }>;
  }[];
}

/** Onde a série está, quando não está no contexto pedido. */
export interface EntityElsewhere {
  /**
   * Tipos do dicionário que parecem ser o mesmo equipamento com outro nome —
   * `MODELOCARRETA` para quem pediu `CARRETA`. Vizinhança por conter/estar
   * contido, e não por lista de sinônimos: a regra que produziu esses nomes
   * era "o nome da aba é o tipo", então o desvio sempre carrega o nome dentro.
   */
  aliasTypes: { entityType: string; attributes: number }[];
  /**
   * Entregas desta série (ou de uma identidade vizinha) fora do que a tela
   * está olhando: outra vigência, outra unidade, outro canal.
   */
  otherDeliveries: {
    entityType: string;
    /** "CAMAÇARI · EMPURRADA" — o mesmo rótulo do seletor de contexto. */
    contextLabel: string;
    effectiveDate: string;
    periodLabel: string;
    sourceLabel: string;
    /** Mesma unidade e canal, outra vigência: trocar o mês basta. */
    sameContext: boolean;
  }[];
  /**
   * Arquivos deste equipamento que **chegaram e não viraram vigência**.
   *
   * O terceiro jeito de o dado sumir sem ninguém errar nada: a aba entra no
   * RAW, o classificador a recusa — falta a coluna `vigencia` ou `placa`, e a
   * recusa fica escrita em `role_reason` — ou a importação para antes de
   * promover. Nada foi perdido e nada foi promovido; a tela precisa mostrar o
   * motivo em vez de mandar importar de novo o mesmo arquivo.
   */
  receivedNotPromoted: {
    filename: string;
    sheetName: string;
    /** SOURCE | PIVOT | UNKNOWN — o veredito do classificador. */
    sheetRole: string;
    roleReason: string;
    /** PENDING | STAGED | PROMOTED | FAILED… — onde a importação parou. */
    importStatus: string;
    receivedAt: string;
  }[];
}

const SEM_DIAGNOSTICO: EntityElsewhere = {
  aliasTypes: [],
  otherDeliveries: [],
  receivedNotPromoted: [],
};

/**
 * A pergunta "então onde foi parar?", respondida com o banco e não com um
 * palpite. Só roda quando a tabela volta vazia — nenhum custo no caso feliz.
 */
async function findElsewhere(
  db: Database,
  entityType: string,
  context: ContextInfo,
  effectiveDate: string,
): Promise<EntityElsewhere> {
  const { rows: vizinhos } = await db.execute<{ entity_type: string; n: number }>(sql`
    SELECT entity_type, count(*)::int AS n
      FROM attribute
     WHERE entity_type <> ${entityType}
       AND (position(${entityType} IN entity_type) > 0
            OR position(entity_type IN ${entityType}) > 0)
     GROUP BY entity_type
     ORDER BY count(*) DESC, entity_type
  `);

  const procurados = [entityType, ...vizinhos.map((v) => v.entity_type)];
  const lista = sql.join(
    procurados.map((t) => sql`${t}`),
    sql`, `,
  );

  /*
    `entity_type_set` é o conjunto de equipamentos da vigência, ordenado e
    unido por `+`: um arquivo só de carreta dá `CARRETA`, o export combinado dá
    `CARRETA+CAVALO`. Comparar a coluna inteira com o tipo daria "não entregou"
    para toda vigência que trouxe os dois equipamentos juntos, que é o formato
    em que a Ambev mandou primeiro. Aqui e no `seriesDelivered`, a pergunta é de
    pertinência ao conjunto, nunca de igualdade com ele.
  */
  const { rows: entregas } = await db.execute<{
    entity_type: string;
    scope_hash: string;
    channel: string | null;
    effective_date: string;
    source_label: string;
  }>(sql`
    SELECT t              AS entity_type,
           s.scope_hash,
           ${channelSql("s.source_label")} AS channel,
           s.effective_date::text AS effective_date,
           s.source_label
      FROM snapshot s
      CROSS JOIN LATERAL unnest(string_to_array(s.entity_type_set, '+')) AS t
     WHERE s.status <> 'SUPERSEDED'
       AND t IN (${lista})
     ORDER BY s.effective_date DESC, s.source_label, t
  `);

  /*
    O arquivo que chegou e não virou vigência.

    O nome da aba é comparado sem separadores — `Modelo_Carreta` vira
    `modelocarreta`, que contém `carreta` — porque é assim que a entrega por
    equipamento nomeia as abas. Sem `unaccent` no banco isto não resolve
    acentos, e os nomes de equipamento não têm nenhum; um dia que tiverem, a
    consulta erra para menos (deixa de achar), nunca para mais.
  */
  const { rows: recebidos } = await db.execute<{
    filename: string;
    sheet_name: string;
    role: string;
    role_reason: string;
    status: string;
    received_at: string;
  }>(sql`
    SELECT sf.filename,
           rs.sheet_name,
           rs.role,
           rs.role_reason,
           ir.status,
           sf.received_at::text AS received_at
      FROM raw_sheet rs
      JOIN import_run ir  ON ir.id = rs.import_run_id
      JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE position(lower(${entityType}) IN regexp_replace(lower(rs.sheet_name), '[^a-z0-9]', '', 'g')) > 0
       AND NOT EXISTS (
             SELECT 1
               FROM snapshot s
              WHERE s.import_run_id = ir.id
                AND s.status <> 'SUPERSEDED'
                AND ${entityType} = ANY(string_to_array(s.entity_type_set, '+'))
           )
     ORDER BY ir.started_at DESC, rs.sheet_index
     LIMIT 10
  `);

  const contextos = await listContexts(db);
  const rotuloDe = (scopeHash: string, channel: string | null) =>
    contextos.find((c) => c.scopeHash === scopeHash && c.channel === channel)?.label ??
    scopeHash;

  return {
    aliasTypes: vizinhos.map((v) => ({ entityType: v.entity_type, attributes: v.n })),
    otherDeliveries: entregas
      // O que a tela já está olhando não é "outro lugar".
      .filter(
        (e) =>
          !(
            e.entity_type === entityType &&
            e.scope_hash === context.scopeHash &&
            e.channel === context.channel &&
            e.effective_date === effectiveDate
          ),
      )
      .map((e) => ({
        entityType: e.entity_type,
        contextLabel: rotuloDe(e.scope_hash, e.channel),
        effectiveDate: e.effective_date,
        periodLabel: periodLabel(e.effective_date),
        sourceLabel: e.source_label,
        sameContext: e.scope_hash === context.scopeHash && e.channel === context.channel,
      })),
    receivedNotPromoted: recebidos.map((r) => ({
      filename: r.filename,
      sheetName: r.sheet_name,
      sheetRole: r.role,
      roleReason: r.role_reason,
      importStatus: r.status,
      receivedAt: r.received_at,
    })),
  };
}

export async function getEntityTable(
  db: Database,
  entityType: string,
  attributeCodes: string[],
  requestedContext?: RequestedContext,
  period?: string,
): Promise<EntityTable | null> {
  const context = await resolveContext(db, requestedContext);
  if (!context || attributeCodes.length === 0) return null;

  const { rows: datas } = await db.execute<{ effective_date: string }>(sql`
    SELECT max(s.effective_date)::text AS effective_date
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
       AND (${period ?? null}::date IS NULL OR s.effective_date = ${period ?? null}::date)
  `);
  const effectiveDate = datas[0]?.effective_date ?? null;
  if (!effectiveDate) return null;

  const lista = sql.join(
    attributeCodes.map((code) => sql`${code}`),
    sql`, `,
  );

  const { rows: meta } = await db.execute<{
    code: string;
    source_name: string;
    display_name: string | null;
  }>(sql`
    SELECT code, source_name, display_name FROM attribute WHERE code IN (${lista})
  `);
  const conhecidos = new Map(meta.map((m) => [m.code, m]));

  const { rows: fatos } = await db.execute<{
    entity_id: string;
    code: string;
    valor: string | null;
    is_null: boolean;
    null_reason: string | null;
    source_label: string;
  }>(sql`
    SELECT f.entity_id::text AS entity_id,
           a.code,
           CASE WHEN f.is_null THEN NULL
                ELSE coalesce(
                  f.value_text,
                  f.value_numeric::text,
                  f.value_boolean::text,
                  f.value_date::text
                )
           END AS valor,
           f.is_null,
           f.null_reason,
           s.source_label
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN entity e    ON e.id = f.entity_id
     WHERE a.code IN (${lista})
       AND e.entity_type = ${entityType}
       AND s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
  `);

  const { rows: placas } = await db.execute<{ entity_id: string; valor: string }>(sql`
    SELECT ei.entity_id::text AS entity_id, ei.identifier_value AS valor
      FROM entity_identifier ei
      JOIN entity e ON e.id = ei.entity_id
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND e.entity_type = ${entityType}
  `);
  const placaDe = new Map(placas.map((p) => [p.entity_id, p.valor]));

  /*
    O diagnóstico, e não só o resultado.

    Uma tabela vazia com todas as colunas desconhecidas tem duas causas
    diferentes, e a tela não consegue distingui-las olhando só para o que
    voltou. Estas duas perguntas separam: **esta vigência entregou o arquivo
    deste equipamento?** e **o dicionário conhece alguma coluna dele?**
  */
  const { rows: entregues } = await db.execute<{ entity_type_set: string }>(sql`
    SELECT s.entity_type_set
      FROM snapshot s
     WHERE s.effective_date = ${effectiveDate}::date
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
  `);
  const { rows: conhecidasDoTipo } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM attribute WHERE entity_type = ${entityType}
  `);

  const porEntidade = new Map<string, EntityTable["rows"][number]>();
  const rotulos = new Set<string>();
  for (const fato of fatos) {
    rotulos.add(fato.source_label);
    let linha = porEntidade.get(fato.entity_id);
    if (!linha) {
      linha = {
        entityId: fato.entity_id,
        label: placaDe.get(fato.entity_id) ?? null,
        values: {},
      };
      porEntidade.set(fato.entity_id, linha);
    }
    linha.values[fato.code] = {
      value: fato.is_null ? null : fato.valor,
      nullReason: fato.is_null ? (fato.null_reason ?? "sem motivo registrado") : null,
    };
  }

  const rows = [...porEntidade.values()].sort((a, b) =>
    (a.label ?? "").localeCompare(b.label ?? "", "pt-BR", { numeric: true }),
  );

  return {
    seriesDelivered: entregues.some((s) =>
      s.entity_type_set.split("+").includes(entityType),
    ),
    attributesKnown: conhecidasDoTipo[0]?.n ?? 0,
    elsewhere:
      rows.length === 0
        ? await findElsewhere(db, entityType, context, effectiveDate)
        : SEM_DIAGNOSTICO,
    entityType,
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    sourceLabels: [...rotulos].sort(),
    columns: attributeCodes
      .filter((code) => conhecidos.has(code))
      .map((code) => ({
        code,
        title: attributeLabel(
          code,
          conhecidos.get(code)?.source_name ?? code,
          conhecidos.get(code)?.display_name,
        ),
      })),
    missingColumns: attributeCodes.filter((code) => !conhecidos.has(code)),
    rows,
  };
}
