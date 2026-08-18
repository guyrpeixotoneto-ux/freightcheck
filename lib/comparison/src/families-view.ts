import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  criarDeduplicador,
  daLinhaDoBanco,
  type Deduplicador,
} from "./deduplicacao";
import { carregarVinculosDeConjunto, snapshotsDosChangeSets } from "./vinculos";
import {
  FAMILIES,
  FAMILY_ORDER,
  placementOf,
  type FamilyCode,
} from "./families";
import { periodLabel } from "./labels";
import {
  buildGroup,
  compareGroups,
  getGroupedView,
  groupKey,
  loadChanges,
  summariseImpact,
  type Badge,
  type ChangeGroup,
  type GroupedView,
  type ImpactSummary,
} from "./grouped";
import { listPeriods } from "./consolidated";
import {
  contextFilter,
  listContexts,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
  type SeriesContext,
} from "./series";

/**
 * A vigência lida como o usuário do Freightech pensa: por família e parâmetro.
 *
 * Isto é **projeção**, e nada além disso. Não calcula comparação, não toca no
 * canônico, não reclassifica atributo nenhum: pega os grupos que a visão
 * agrupada já produz e os arruma nas gavetas que o cliente já conhece.
 *
 * Três regras herdadas, e nenhuma delas afrouxa aqui:
 *
 * 1. **Nunca somar entre periodicidades.** Uma família com R$/mês e R$/ano tem
 *    dois números, sempre.
 * 2. **Nunca ressuscitar a dupla contagem.** O índice de composição é montado
 *    sobre o conjunto **inteiro** da vigência e passado para cada fatia — ver
 *    `summariseImpact`.
 * 3. **Nada some.** Família sem alteração aparece dizendo "sem alterações";
 *    atributo que o mapa não conhece aparece em "Sem família".
 *
 * E uma regra nova, que é a razão de a tela existir: **a soma das famílias tem
 * de bater com o total da vigência, dentro de cada periodicidade.** Um
 * agrupamento cujas partes não fecham com o todo passa confiança falsa; há
 * teste para isso.
 */

export interface ParameterView {
  key: string;
  name: string;
  family: FamilyCode;
  /** Aviso quando a gaveta ainda depende de resposta do cliente. */
  pending: string | null;
  changes: number;
  vehicles: number;
  impact: ImpactSummary;
  /** Os cartões de grupo — o nível 3, reaproveitado como está. */
  groups: ChangeGroup[];
}

export interface FamilyView {
  code: FamilyCode;
  name: string;
  origin: "FREIGHTECH" | "FREIGHTCHECK";
  note: string;
  /** Parâmetros desta família que o dicionário conhece, tenham mudado ou não. */
  parametersWithData: number;
  /** Destes, quantos mudaram nesta vigência. */
  parametersChanged: number;
  changes: number;
  vehicles: number;
  impact: ImpactSummary;
  /** Grupos com selo DINHEIRO ou RUPTURA — o que a tela chama de crítico. */
  critical: number;
  /** Grupos monetários e somáveis travados por semântica não confirmada. */
  locked: number;
  parameters: ParameterView[];
}

export interface ExecutiveSummary {
  /** Já sem dupla contagem, e separado por periodicidade. */
  impact: ImpactSummary;
  /** Só o que reduz a remuneração, por periodicidade. Nunca somado ao ganho. */
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  changes: number;
  groups: number;
  critical: number;
  locked: number;
  notCalculable: number;
  vehiclesTouched: number;
  /** Parâmetros ordenados pelo maior impacto absoluto numa só periodicidade. */
  topParameters: {
    key: string;
    name: string;
    family: FamilyCode;
    familyName: string;
    changes: number;
    byPeriodicity: Record<string, number>;
  }[];
  /**
   * Veículos ordenados pelo mesmo critério.
   *
   * A ordenação usa o **maior valor absoluto dentro de uma periodicidade**, e
   * não uma soma entre elas — somar R$/mês com R$/ano para produzir um ranking
   * daria uma ordem que nenhuma das duas grandezas justifica.
   */
  topVehicles: {
    plate: string;
    entityType: string | null;
    changes: number;
    byPeriodicity: Record<string, number>;
  }[];
}

export interface FamiliesView extends GroupedView {
  summary: ExecutiveSummary;
  families: FamilyView[];
}

const round = (v: number) => Number(v.toFixed(2));

/**
 * O impacto de um recorte vazio.
 *
 * Vive aqui e não na autoridade porque é resposta de tela — "esta família não
 * tem nada" —, e não uma leitura de dinheiro. O rastro vem vazio pelo mesmo
 * motivo: sem linha nenhuma não há degrau a explicar.
 */
function emptyImpact(): ImpactSummary {
  return {
    byPeriodicity: {},
    brutoByPeriodicity: {},
    rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
    excludedChanges: 0,
    notCalculable: 0,
    calculatedChanges: 0,
  };
}

/**
 * Quantos parâmetros cada família tem **com atributo no dicionário**.
 *
 * É o denominador de "4 de 10 parâmetros", e é o que impede uma família vazia
 * de virar cartão: se o export não traz nenhum atributo dela, ela não existe
 * nesta tela — a nota de rodapé (`FREIGHTECH_SEM_DADO`) é onde ela é dita.
 */
async function parametersWithData(
  db: Database,
): Promise<Map<FamilyCode, Set<string>>> {
  const { rows } = await db.execute<{ code: string }>(sql`
    SELECT code FROM attribute
  `);
  const byFamily = new Map<FamilyCode, Set<string>>();
  for (const row of rows) {
    const placement = placementOf(row.code);
    const set = byFamily.get(placement.family) ?? new Set<string>();
    set.add(placement.parameterKey);
    byFamily.set(placement.family, set);
  }
  return byFamily;
}

export async function getFamiliesView(
  db: Database,
  period?: string,
  requestedContext?: RequestedContext,
): Promise<FamiliesView | null> {
  const view = await getGroupedView(db, period, requestedContext);
  if (!view) return null;

  const changeSetIds = view.series
    .map((s) => s.changeSetId)
    .filter((id): id is string => id !== null);
  const rows = await loadChanges(db, changeSetIds);

  // Sobre o conjunto inteiro, uma vez só. Cada fatia recebe este índice.
  const dedup = criarDeduplicador(
    rows.map(daLinhaDoBanco),
    await carregarVinculosDeConjunto(db, await snapshotsDosChangeSets(db, changeSetIds)),
  );

  const inventory = await parametersWithData(db);

  // ---- grupos e linhas, arrumados por parâmetro ----------------------------
  const groupsByParameter = new Map<string, ChangeGroup[]>();
  for (const group of view.groups) {
    const key = placementOf(group.attributeCode).parameterKey;
    const list = groupsByParameter.get(key) ?? [];
    list.push(group);
    groupsByParameter.set(key, list);
  }

  const rowsByParameter = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = placementOf(row.attribute_code).parameterKey;
    const list = rowsByParameter.get(key) ?? [];
    list.push(row);
    rowsByParameter.set(key, list);
  }

  // ---- famílias -------------------------------------------------------------
  const families: FamilyView[] = [];
  for (const code of FAMILY_ORDER) {
    const definition = FAMILIES[code];
    const known = inventory.get(code);
    const touchedKeys = [...groupsByParameter.keys()].filter((k) => k.startsWith(`${code}|`));

    // Família sem atributo nenhum no dicionário e sem alteração nesta vigência
    // não é exibida: seria um cartão que promete um assunto que este export não
    // cobre. O que o Freightech publica e não vem aqui está em FREIGHTECH_SEM_DADO.
    if (!known && touchedKeys.length === 0) continue;

    const parameters: ParameterView[] = touchedKeys
      .map((key) => {
        const groups = groupsByParameter.get(key) ?? [];
        const parameterRows = rowsByParameter.get(key) ?? [];
        const placement = placementOf(groups[0]?.attributeCode ?? null);
        const vehicles = new Set(
          parameterRows.map((r) => r.entity_id).filter((v): v is string => v !== null),
        ).size;
        return {
          key,
          name: key.split("|").slice(1).join("|"),
          family: code,
          pending: placement.pending,
          changes: parameterRows.length,
          vehicles,
          impact: summariseImpact(parameterRows, dedup),
          groups,
        };
      })
      .sort(compareParameters);

    const familyRows = touchedKeys.flatMap((k) => rowsByParameter.get(k) ?? []);
    const familyGroups = parameters.flatMap((p) => p.groups);

    families.push({
      code,
      name: definition.name,
      origin: definition.origin,
      note: definition.note,
      parametersWithData: known?.size ?? 0,
      parametersChanged: parameters.length,
      changes: familyRows.length,
      vehicles: new Set(
        familyRows.map((r) => r.entity_id).filter((v): v is string => v !== null),
      ).size,
      impact: familyRows.length > 0 ? summariseImpact(familyRows, dedup) : emptyImpact(),
      critical: familyGroups.filter((g) => g.badge === "DINHEIRO" || g.badge === "RUPTURA").length,
      locked: familyGroups.filter((g) => g.badge === "TRAVADO").length,
      parameters,
    });
  }

  return { ...view, summary: buildSummary(view, families, rows, dedup), families };
}

// ---------------------------------------------------------------------------
// O intervalo — várias vigências lidas juntas
// ---------------------------------------------------------------------------

/**
 * O que aconteceu entre duas vigências escolhidas.
 *
 * **O que este intervalo é, e o que ele não é.** Uma vigência aqui já é uma
 * comparação: agosto/2026 é "agosto contra julho". Escolher *de abril até
 * agosto* soma os movimentos de maio, junho, julho e agosto — quatro
 * comparações, as que **saem** de abril e chegam em agosto — e **não** é a
 * mesma coisa que abrir a planilha de abril ao lado da de agosto e olhar as
 * duas pontas.
 *
 * A diferença importa e é visível: um valor que foi de 10 para 20 e voltou para
 * 10 dá zero na leitura das duas pontas e dá duas alterações aqui. As duas
 * respostas estão certas para perguntas diferentes — "como está hoje contra
 * como estava" e "o que o cliente mexeu no caminho" — e este produto responde a
 * segunda, porque é a que a auditoria precisa e a que ninguém consegue fazer à
 * mão. A tela diz isso; o número sozinho enganaria.
 *
 * Comparar continua sendo ato de importação: aqui só se **lê** o que já foi
 * comparado. Nenhuma comparação nova é calculada ao abrir a tela.
 */
export interface RangeMovement {
  period: string;
  label: string;
  /** Comparações que terminam nesta vigência — uma por série. */
  comparisons: number;
  changes: number;
  vehicles: number;
  impact: ImpactSummary;
}

/**
 * Uma linha do ranking: um grupo de alteração **dentro de uma vigência**.
 *
 * A vigência entra na chave de propósito. Juntar num só item o que mudou em
 * abril com o que mudou em agosto produziria um "antes → depois" que nunca
 * existiu em lugar nenhum, e esconderia justamente o que se quer ver: quando o
 * cliente mexeu.
 */
export interface RangeEntry {
  key: string;
  period: string;
  periodLabel: string;
  parameterKey: string;
  parameterName: string;
  family: FamilyCode;
  attributeCode: string | null;
  title: string;
  equipment: string;
  vehicles: number;
  unit: string | null;
  /** O impacto do grupo. Sempre acompanhado da periodicidade. */
  amount: number | null;
  periodicity: string | null;
  confidence: string;
  /** Por que não há valor, quando não há. */
  reason: string | null;
  badge: Badge;
  badgeLabel: string;
  /**
   * O grupo inteiro, para a tela abrir o cartão de detalhe de sempre — com os
   * veículos, a série do atributo e a célula da planilha que originou o
   * número. Sem ele, a análise seria um beco: números sem caminho até a
   * evidência.
   */
  group: ChangeGroup;
}

export interface RangeAnalysis {
  context: ContextInfo;
  /**
   * As pontas escolhidas. `from` é o **ponto de partida** e não entra na soma:
   * o intervalo são as transições que vão dele até `to`. Julho → agosto é uma
   * comparação, e não duas.
   */
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  /** Tudo o que existe no histórico deste contexto, para o seletor. */
  periods: { date: string; label: string }[];
  movements: RangeMovement[];
  /** Vigências dentro do intervalo sem comparação nenhuma. Nomeadas, nunca zero. */
  gaps: { period: string; label: string; reason: string }[];
  /** O impacto do intervalo inteiro, já sem dupla contagem, por periodicidade. */
  impact: ImpactSummary;
  /** Só o que reduz a remuneração. Nunca somado ao ganho, nem entre periodicidades. */
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  totals: { changes: number; vehiclesTouched: number; comparisons: number };
  /**
   * O intervalo somado por parâmetro — o degrau entre a visão geral e o cartão.
   *
   * Vem do servidor, e não de uma soma na tela, por dois motivos. O primeiro é
   * o de sempre: `vehicles` aqui são ativos **distintos**, e somar os grupos
   * daria mais caminhões do que a frota tem. O segundo é a dupla contagem — o
   * impacto de cada parâmetro sai do mesmo `summariseImpact` com o mesmo índice
   * de composição do total, o que garante que as partes fechem com o todo
   * dentro de cada periodicidade. Uma tela que soma sozinha pode não fechar, e
   * ninguém descobre olhando.
   */
  byParameter: ParameterRollup[];
  entries: RangeEntry[];
}

export interface ParameterRollup {
  parameterKey: string;
  parameterName: string;
  family: FamilyCode;
  familyName: string;
  changes: number;
  /** Ativos distintos tocados por este parâmetro no intervalo. */
  vehicles: number;
  impact: ImpactSummary;
  /** Vigências do intervalo em que este parâmetro se mexeu. */
  periods: number;
  /** Alterações dele sem impacto apurado. Nunca zero disfarçado. */
  notCalculable: number;
}

export async function getRangeAnalysis(
  db: Database,
  from?: string,
  to?: string,
  requestedContext?: RequestedContext,
  /**
   * Recorte do cartão: só estes parâmetros.
   *
   * Filtrar aqui e não na tela não é economia de tráfego — é a única forma de
   * `vehiclesTouched` significar o que o rótulo promete. A tela sabe quantos
   * veículos cada grupo tocou, mas não *quais*; somar os grupos dá 182 numa
   * frota de 144, porque o mesmo caminhão conta em cada parâmetro que mudou.
   * O conjunto de ativos distintos só existe aqui.
   */
  parameterKeys?: string[],
): Promise<RangeAnalysis | null> {
  const contexts = await listContexts(db);
  const context = await resolveContext(db, requestedContext, contexts);
  if (!context) return null;

  const periods = await listPeriods(db, context); // mais recente primeiro
  if (periods.length === 0) return null;
  const datas = periods.map((p) => p.effective_date);

  /*
    Uma ponta que não existe no histórico deste contexto não vira erro nem some
    calada: cai no padrão — a vigência mais recente, e a anterior a ela. É o
    intervalo mais curto que ainda mostra movimento, e é o que a tela abre.
  */
  const alvoFim = to && datas.includes(to) ? to : datas[0];
  /*
    Sem `from` escolhido, a ponta inicial é a vigência **imediatamente anterior
    à final** — e não a segunda mais recente do histórico.

    A diferença aparece quando a ponta final não é a mais recente: com `to` em
    junho, "a segunda do histórico" é julho, que vem *depois*. O intervalo
    acabava invertido, o código dava a volta com um swap, e a tela mostrava
    junho → julho para quem tinha pedido junho. O padrão certo é o mais curto
    que ainda mostra movimento a partir da ponta escolhida.
  */
  const anteriorAoFim = datas.find((d) => d < alvoFim);
  const alvoInicio =
    from && datas.includes(from) ? from : (anteriorAoFim ?? alvoFim);
  const [inicio, fim] =
    alvoInicio <= alvoFim ? [alvoInicio, alvoFim] : [alvoFim, alvoInicio];

  const { rows: sets } = await db.execute<{
    change_set_id: string;
    period: string;
    entity_type_set: string;
    fleet: number;
  }>(sql`
    SELECT cs.id AS change_set_id,
           sb.effective_date::text AS period,
           sb.entity_type_set,
           sb.entity_count AS fleet
      FROM change_set cs
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE sb.effective_date > ${inicio}::date
       AND sb.effective_date <= ${fim}::date
       AND sb.status <> 'SUPERSEDED'
       AND ${contextFilter("sb", context)}
     ORDER BY sb.effective_date DESC, sb.entity_type_set
  `);

  const changeSetIds = sets.map((s) => s.change_set_id);
  const todasAsLinhas = await loadChanges(db, changeSetIds);

  /*
    O índice de composição é montado sobre **todas** as linhas do intervalo, e
    não sobre o recorte do cartão: `carreta.custo_fixo` mora num cartão e a sua
    parcela `lucro_fixomodelo_novo_ciclo` mora noutro. Um índice só do recorte
    não veria a parcela mudar, o titular voltaria para dentro da soma, e o
    cartão mostraria o mesmo dinheiro duas vezes.

    O que ele **não** faz é atravessar vigências. Este comentário já disse o
    contrário — "é do intervalo inteiro, e não por vigência" —, e a afirmação
    ficou de pé depois de o código mudar: `criarDeduplicador` indexa por
    (comparação, ativo), então as regras decidem dentro de cada comparação e
    nunca entre duas.

    A mudança foi deliberada, e o motivo é que a leitura antiga perdia dinheiro:
    um total que se moveu **sozinho** em junho sairia da soma porque uma parcela
    dele se moveu em julho — uma dupla contagem que não existe em nenhum dos dois
    meses, descontada mesmo assim. As duas regras são internas a um par de
    vigências (um total e as parcelas dele, um cavalo e a carreta dele), e é
    nesse grão que elas fecham.
  */
  const dedup = criarDeduplicador(
    todasAsLinhas.map(daLinhaDoBanco),
    await carregarVinculosDeConjunto(db, await snapshotsDosChangeSets(db, changeSetIds)),
  );

  const rows =
    parameterKeys && parameterKeys.length > 0
      ? todasAsLinhas.filter((r) =>
          parameterKeys.includes(placementOf(r.attribute_code).parameterKey),
        )
      : todasAsLinhas;

  const periodoDoSet = new Map(sets.map((s) => [s.change_set_id, s.period]));
  const fleetByChangeSet = new Map(sets.map((s) => [s.change_set_id, s.fleet]));

  // ---- movimento por vigência ---------------------------------------------
  /*
    O intervalo são as transições que **vão** de `inicio` até `fim` — a ponta
    inicial é o ponto de partida, não um período cujo movimento se soma.

    Era o contrário, e a tela mostrou o preço: escolher "de julho até agosto"
    somava também a transição que produziu julho (junho→julho), e ainda
    acusava julho de "vigência que ficou de fora" quando ela era justamente a
    referência escolhida. O texto dizia "1 comparação" e o alerta dizia que
    faltava uma — as duas frases descreviam semânticas diferentes na mesma
    tela.

    Agora a seta do seletor quer dizer o que parece: julho → agosto é uma
    comparação. E as duas leituras passam a cobrir o mesmo trecho, que é o que
    permite subtrair uma da outra para dizer o que foi revertido.
  */
  const noIntervalo = datas.filter((d) => d > inicio && d <= fim).sort().reverse();
  const rowsPorPeriodo = new Map<string, typeof rows>();
  for (const row of rows) {
    const periodo = periodoDoSet.get(row.change_set_id);
    if (!periodo) continue;
    const lista = rowsPorPeriodo.get(periodo) ?? [];
    lista.push(row);
    rowsPorPeriodo.set(periodo, lista);
  }

  const movements: RangeMovement[] = noIntervalo
    .filter((periodo) => sets.some((s) => s.period === periodo))
    .map((periodo) => {
      const linhas = rowsPorPeriodo.get(periodo) ?? [];
      return {
        period: periodo,
        label: periodLabel(periodo),
        comparisons: sets.filter((s) => s.period === periodo).length,
        changes: linhas.length,
        vehicles: new Set(
          linhas.map((r) => r.entity_id).filter((v): v is string => v !== null),
        ).size,
        impact: summariseImpact(linhas, dedup),
      };
    });

  const gaps = noIntervalo
    .filter((periodo) => !sets.some((s) => s.period === periodo))
    .map((periodo) => ({
      period: periodo,
      label: periodLabel(periodo),
      reason:
        "Vigência importada sem comparação: é a primeira da série, ou a " +
        "comparação ainda não foi calculada. O que houve aqui não está " +
        "somado — e não está contado como zero.",
    }));

  // ---- ranking, um item por grupo dentro de cada vigência ------------------
  const baldes = new Map<string, typeof rows>();
  for (const row of rows) {
    const periodo = periodoDoSet.get(row.change_set_id) ?? "";
    const chave = `${periodo}|${groupKey(row)}`;
    const balde = baldes.get(chave);
    if (balde) balde.push(row);
    else baldes.set(chave, [row]);
  }

  const entries: RangeEntry[] = [...baldes.entries()]
    .map(([chave, linhas]) => {
      const grupo = buildGroup(linhas, fleetByChangeSet, dedup);
      const periodo = chave.split("|")[0];
      const placement = placementOf(grupo.attributeCode);
      return {
        key: chave,
        period: periodo,
        periodLabel: periodLabel(periodo),
        parameterKey: placement.parameterKey,
        parameterName: placement.parameterKey.split("|").slice(1).join("|"),
        family: placement.family,
        attributeCode: grupo.attributeCode,
        title: grupo.title,
        equipment: grupo.equipment,
        vehicles: grupo.vehicles,
        unit: grupo.unit,
        amount: grupo.impact.amount,
        periodicity: grupo.impact.periodicity,
        confidence: grupo.impact.confidence,
        reason: grupo.impact.reason,
        badge: grupo.badge,
        badgeLabel: grupo.badgeLabel,
        group: grupo,
      };
    })
    // Mais recente primeiro; dentro da vigência, o critério de sempre.
    .sort((a, b) =>
      a.period === b.period
        ? compareGroups(a.group, b.group)
        : b.period.localeCompare(a.period),
    );

  /*
    ---- o intervalo somado por parâmetro ------------------------------------

    É o degrau entre a visão geral e o cartão: dali se vê *qual gaveta* pesou,
    e daqui se salta para ela. Cada fatia recebe o **mesmo** índice de
    composição do total — é o que faz as partes fecharem com o todo dentro de
    cada periodicidade, e é a única forma de a visão geral e o cartão não se
    contradizerem.
  */
  const linhasPorParametro = new Map<string, typeof rows>();
  for (const row of rows) {
    const chave = placementOf(row.attribute_code).parameterKey;
    const lista = linhasPorParametro.get(chave) ?? [];
    lista.push(row);
    linhasPorParametro.set(chave, lista);
  }

  const byParameter: ParameterRollup[] = [...linhasPorParametro.entries()]
    .map(([chave, linhas]) => {
      const impact = summariseImpact(linhas, dedup);
      const family = placementOf(linhas[0]?.attribute_code ?? null).family;
      return {
        parameterKey: chave,
        parameterName: chave.split("|").slice(1).join("|"),
        family,
        familyName: FAMILIES[family]?.name ?? family,
        changes: linhas.length,
        vehicles: new Set(
          linhas.map((l) => l.entity_id).filter((v): v is string => v !== null),
        ).size,
        impact,
        periods: new Set(
          linhas.map((l) => periodoDoSet.get(l.change_set_id)).filter(Boolean),
        ).size,
        notCalculable: impact.notCalculable,
      };
    })
    // O maior impacto absoluto **dentro de uma periodicidade**, nunca a soma
    // entre elas: R$/mês e R$/ano não formam uma fila.
    .sort((a, b) => {
      const peso = (r: ParameterRollup) => {
        const valores = Object.values(r.impact.byPeriodicity).map(Math.abs);
        return valores.length === 0 ? 0 : Math.max(...valores);
      };
      const diferenca = peso(b) - peso(a);
      if (diferenca !== 0) return diferenca;
      if (b.changes !== a.changes) return b.changes - a.changes;
      return a.parameterName.localeCompare(b.parameterName, "pt-BR");
    });

  // ---- perdas e ganhos, separados e por periodicidade ----------------------
  const losses: Record<string, number> = {};
  const gains: Record<string, number> = {};
  for (const row of rows) {
    if (row.impact_confidence !== "CALCULATED" || row.impact_amount === null) continue;
    if (dedup.foraDoTotal(daLinhaDoBanco(row)) !== null) continue;
    const balde = row.impact_periodicity ?? "SEM_PERIODICIDADE";
    const valor = Number(row.impact_amount);
    if (valor < 0) losses[balde] = (losses[balde] ?? 0) + valor;
    else if (valor > 0) gains[balde] = (gains[balde] ?? 0) + valor;
  }

  return {
    context,
    from: inicio,
    fromLabel: periodLabel(inicio),
    to: fim,
    toLabel: periodLabel(fim),
    periods: datas.map((d) => ({ date: d, label: periodLabel(d) })),
    movements,
    gaps,
    impact: summariseImpact(rows, dedup),
    lossesByPeriodicity: Object.fromEntries(
      Object.entries(losses).map(([k, v]) => [k, round(v)]),
    ),
    gainsByPeriodicity: Object.fromEntries(
      Object.entries(gains).map(([k, v]) => [k, round(v)]),
    ),
    totals: {
      changes: rows.length,
      vehiclesTouched: new Set(
        rows.map((r) => r.entity_id).filter((v): v is string => v !== null),
      ).size,
      comparisons: sets.length,
    },
    byParameter,
    entries,
  };
}

/** Maior impacto absoluto primeiro; sem impacto, mais alterações primeiro. */
function largestAbsolute(byPeriodicity: Record<string, number>): number {
  const values = Object.values(byPeriodicity).map(Math.abs);
  return values.length === 0 ? 0 : Math.max(...values);
}

function compareParameters(a: ParameterView, b: ParameterView): number {
  const impact =
    largestAbsolute(b.impact.byPeriodicity) - largestAbsolute(a.impact.byPeriodicity);
  if (impact !== 0) return impact;
  if (b.changes !== a.changes) return b.changes - a.changes;
  return a.name.localeCompare(b.name);
}

type Rows = Awaited<ReturnType<typeof loadChanges>>;

function buildSummary(
  view: GroupedView,
  families: FamilyView[],
  rows: Rows,
  dedup: Deduplicador,
): ExecutiveSummary {
  const losses: Record<string, number> = {};
  const gains: Record<string, number> = {};
  const byVehicle = new Map<
    string,
    { plate: string; entityType: string | null; changes: number; byPeriodicity: Record<string, number> }
  >();

  for (const row of rows) {
    const key = row.entity_id ?? `linha-${row.id}`;
    const entry =
      byVehicle.get(key) ??
      {
        plate: row.entity_label ?? "(sem placa)",
        entityType: row.entity_type,
        changes: 0,
        byPeriodicity: {} as Record<string, number>,
      };
    entry.changes++;
    byVehicle.set(key, entry);

    if (row.impact_confidence !== "CALCULATED" || row.impact_amount === null) continue;
    // A mesma exclusão da soma da vigência: um total já contado nas parcelas
    // não entra em perdas, em ganhos, nem no ranking de veículos.
    if (dedup.foraDoTotal(daLinhaDoBanco(row)) !== null) continue;

    const bucket = row.impact_periodicity ?? "SEM_PERIODICIDADE";
    const amount = Number(row.impact_amount);
    if (amount < 0) losses[bucket] = (losses[bucket] ?? 0) + amount;
    else if (amount > 0) gains[bucket] = (gains[bucket] ?? 0) + amount;
    entry.byPeriodicity[bucket] = (entry.byPeriodicity[bucket] ?? 0) + amount;
  }

  const parameters = families.flatMap((f) =>
    f.parameters.map((p) => ({
      key: p.key,
      name: p.name,
      family: f.code,
      familyName: f.name,
      changes: p.changes,
      byPeriodicity: p.impact.byPeriodicity,
    })),
  );

  return {
    impact: view.impact,
    lossesByPeriodicity: Object.fromEntries(
      Object.entries(losses).map(([k, v]) => [k, round(v)]),
    ),
    gainsByPeriodicity: Object.fromEntries(
      Object.entries(gains).map(([k, v]) => [k, round(v)]),
    ),
    changes: view.totals.changes,
    groups: view.totals.groups,
    critical: families.reduce((sum, f) => sum + f.critical, 0),
    locked: families.reduce((sum, f) => sum + f.locked, 0),
    notCalculable: view.impact.notCalculable,
    vehiclesTouched: view.totals.vehiclesTouched,
    topParameters: parameters
      .filter((p) => largestAbsolute(p.byPeriodicity) > 0)
      .sort((a, b) => largestAbsolute(b.byPeriodicity) - largestAbsolute(a.byPeriodicity))
      .slice(0, 5),
    topVehicles: [...byVehicle.values()]
      .filter((v) => largestAbsolute(v.byPeriodicity) > 0)
      .sort((a, b) => largestAbsolute(b.byPeriodicity) - largestAbsolute(a.byPeriodicity))
      .slice(0, 5)
      .map((v) => ({
        ...v,
        byPeriodicity: Object.fromEntries(
          Object.entries(v.byPeriodicity).map(([k, amount]) => [k, round(amount)]),
        ),
      })),
  };
}
