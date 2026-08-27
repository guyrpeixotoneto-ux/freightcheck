import type { Database } from "@workspace/db";
import type { FamilyCode } from "./families";
import {
  getFamiliesView,
  getRangeAnalysis,
  parametersWithData,
  type ExecutiveSummary,
  type FamiliesView,
  type ImpactContributor,
  type ImpactSide,
  type ImpactSides,
  type RangeAnalysis,
} from "./families-view";
import { listContexts, type ContextInfo } from "./series";

/**
 * A soma de todas as unidades, para uma única competência — a "Visão Geral".
 *
 * Camada nova por cima de `getFamiliesView`: não toca no motor de comparação,
 * não muda como uma unidade sozinha é lida. Cada unidade entra na soma pela
 * competência **exata** — nunca a mais recente que ela tem — e a unidade que
 * não entregou aquela competência fica de fora, nomeada em `unitsExcluded`,
 * nunca silenciosamente ignorada.
 *
 * "Unidade" aqui é o código do escopo `UNIDADE`, não `scopeHash`: o mesmo
 * `scopeHash` mistura REGIONAL/OPERADOR/canal, e uma unidade pode ter mais de
 * um `ContextInfo` na mesma competência (dois canais, ou um recorte de
 * operador ao lado do recorte sem operador). Ver `chaveDaUnidade`.
 */

const round = (v: number) => Number(v.toFixed(2));

function largestAbsolute(byPeriodicity: Record<string, number>): number {
  const values = Object.values(byPeriodicity).map(Math.abs);
  return values.length === 0 ? 0 : Math.max(...values);
}

export type MotivoExclusao =
  | "sem_vigencia_na_competencia"
  | "contextos_sobrepostos_ambiguos"
  | "vigencia_indisponivel_na_leitura";

export interface OverviewContextRef {
  scopeHash: string;
  channel: string | null;
  latestPeriod: string;
}

export interface OverviewUnitIncluded {
  unidade: string;
  label: string;
  contexts: OverviewContextRef[];
  /**
   * Presente só quando algum contexto elegível da unidade não pôde ser lido
   * (corrida: a vigência foi removida entre `listContexts` e a leitura). A
   * unidade continua incluída, somada com o que respondeu — mas nunca deve
   * ser reportada como cobertura completa quando isto está preenchido.
   */
  coberturaParcial?: {
    scopeHash: string;
    channel: string | null;
    motivo: "vigencia_indisponivel_na_leitura";
  }[];
  /**
   * O mesmo `ExecutiveSummary` que compõe `FamiliesOverview.summary`, mas
   * restrito aos contextos desta unidade — soma de canais quando a unidade
   * tem mais de um contexto elegível na competência.
   *
   * Existe para a comparação por unidade na tela: os dados já são lidos e
   * mesclados por unidade dentro deste laço (ver `leiturasPorUnidade`) antes
   * de irem para `mergeSummaries` no total geral; expor o intermediário aqui
   * não custa uma leitura a mais, só para de descartá-lo.
   */
  summary: ExecutiveSummary;
}

export interface OverviewUnitExcluded {
  unidade: string;
  label: string;
  reason: MotivoExclusao;
  contexts: OverviewContextRef[];
  /**
   * Só quando `reason === "contextos_sobrepostos_ambiguos"`. `entradas` é o
   * conjunto `scopeType:code` de cada contexto em conflito — não só os tipos
   * de escopo — para o diagnóstico não confundir "dois operadores diferentes"
   * (irmãos, não aninhados) com "um contexto é fatia do outro".
   */
  conflito?: { scopeHash: string; entradas: string[] }[];
}

export interface FamiliesOverview {
  period: string;
  summary: ExecutiveSummary;
  unitsIncluded: OverviewUnitIncluded[];
  unitsExcluded: OverviewUnitExcluded[];
}

/**
 * A identidade real de uma unidade — o código do escopo `UNIDADE`, não o
 * `scopeHash` (que já mistura REGIONAL/OPERADOR/canal). Mesmo fallback de
 * `contextLabel` em `series.ts`, para nunca ficar sem chave.
 */
function chaveDaUnidade(c: ContextInfo): string {
  return c.scopes.find((s) => s.scopeType === "UNIDADE")?.code ?? c.scopeHash;
}

function agruparPorUnidade(contexts: ContextInfo[]): Map<string, ContextInfo[]> {
  const porUnidade = new Map<string, ContextInfo[]>();
  for (const c of contexts) {
    const chave = chaveDaUnidade(c);
    const grupo = porUnidade.get(chave) ?? [];
    grupo.push(c);
    porUnidade.set(chave, grupo);
  }
  return porUnidade;
}

function refDe(c: ContextInfo): OverviewContextRef {
  return { scopeHash: c.scopeHash, channel: c.channel, latestPeriod: c.latestPeriod };
}

/**
 * `scopeType:code` de cada entrada do contexto — não só o tipo. Dois
 * contextos com o mesmo conjunto de *tipos* de escopo (ex. `{UNIDADE,
 * OPERADOR}` e `{UNIDADE, OPERADOR}`) mas códigos de operador diferentes são
 * irmãos, não um a fatia do outro; comparar só por tipo confundiria os dois
 * casos.
 */
function conjuntoDeEntradas(c: ContextInfo): Set<string> {
  return new Set(c.scopes.map((s) => `${s.scopeType}:${s.code}`));
}

/**
 * Se dois ou mais contextos elegíveis da mesma unidade caem no **mesmo
 * canal**, a unidade é recusada — mesmo sem aninhamento visível entre os
 * conjuntos de escopo.
 *
 * Confirmado por investigação de `lib/ingest/src/pipeline.ts`
 * (`groupFactsByEntityScope`): o agrupamento de escopo na importação é feito
 * por linha, conforme quais colunas (unidade/operador/regional) aquela linha
 * trouxe preenchidas, **dentro de um mesmo canal**. Nada no pipeline garante
 * que os contextos resultantes particionam a frota sem sobreposição — "não
 * detectei aninhamento" não é o mesmo que "provei que são disjuntos". Por
 * isso a régua aqui não tenta provar disjunção (exigiria comparar frota
 * total, fora do escopo desta v1): qualquer canal com mais de um contexto
 * elegível é tratado como ambíguo, ponto. Contextos de **canais diferentes**
 * continuam somáveis entre si — cada `(scopeHash, channel)` já é a partição
 * que o resto do produto usa para tratar séries como distintas (`series.ts`),
 * e nada na investigação apontou risco de sobreposição *entre* canais.
 */
function agruparPorCanal(matched: ContextInfo[]): Map<string, ContextInfo[]> {
  const porCanal = new Map<string, ContextInfo[]>();
  for (const c of matched) {
    const canal = c.channel ?? "";
    const lista = porCanal.get(canal) ?? [];
    lista.push(c);
    porCanal.set(canal, lista);
  }
  return porCanal;
}

function somarRecords(records: Record<string, number>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      total[key] = round((total[key] ?? 0) + value);
    }
  }
  return total;
}

/**
 * Soma `amount`/`changes`/`vehicles` por `(family, key)` entre contribuidores
 * de unidades diferentes, e reordena pelo mesmo critério de `ladoDe` em
 * `families-view.ts` (maior módulo primeiro).
 */
function mergerDeContribuidores(listas: ImpactContributor[][]): ImpactContributor[] {
  const acumulado = new Map<string, ImpactContributor>();
  for (const lista of listas) {
    for (const c of lista) {
      const chave = `${c.family}|${c.key}`;
      const atual = acumulado.get(chave);
      if (atual) {
        atual.changes += c.changes;
        // Aproximação: veículo é por unidade, sem `Set` cruzado nesta fase —
        // mesma nota de `vehiclesTouched` mais abaixo.
        atual.vehicles += c.vehicles;
        atual.amount = round(atual.amount + c.amount);
      } else {
        acumulado.set(chave, { ...c });
      }
    }
  }
  return [...acumulado.values()].sort(
    (a, b) =>
      Math.abs(b.amount) - Math.abs(a.amount) ||
      b.changes - a.changes ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

function mergerLado(lados: ImpactSide[]): ImpactSide {
  return {
    total: round(lados.reduce((soma, l) => soma + l.total, 0)),
    changes: lados.reduce((soma, l) => soma + l.changes, 0),
    // Mesma aproximação de `vehiclesTouched`: soma simples, não deduplicação
    // por placa entre unidades.
    vehicles: lados.reduce((soma, l) => soma + l.vehicles, 0),
    parameters: mergerDeContribuidores(lados.map((l) => l.parameters)),
  };
}

function mergeSides(allSides: ImpactSides[]): ImpactSides[] {
  const porPeriodicidade = new Map<string, ImpactSides[]>();
  for (const s of allSides) {
    const lista = porPeriodicidade.get(s.periodicity) ?? [];
    lista.push(s);
    porPeriodicidade.set(s.periodicity, lista);
  }
  const resultado: ImpactSides[] = [];
  for (const [periodicity, lista] of porPeriodicidade) {
    const gains = mergerLado(lista.map((s) => s.gains));
    const losses = mergerLado(lista.map((s) => s.losses));
    resultado.push({ periodicity, net: round(gains.total + losses.total), gains, losses });
  }
  return resultado.sort(
    (a, b) => Math.abs(b.net) - Math.abs(a.net) || a.periodicity.localeCompare(b.periodicity),
  );
}

/**
 * Reconstrói `topParameters` a partir de `sides[].gains/losses.parameters` —
 * lista completa, sem `.slice`, confirmado lendo `ladoDe` em
 * `families-view.ts`. Não é o caso de "lista já truncada" que exigiria
 * devolver `topParameters: []`: soma por `(family, key, periodicity)` entre
 * todos os contextos incluídos, monta o mesmo `byPeriodicity` que
 * `buildSummary` usa, e aplica o mesmo critério de corte (maior módulo numa
 * periodicidade, top 5).
 */
function mergeTopParameters(allSides: ImpactSides[]): ExecutiveSummary["topParameters"] {
  const acumulado = new Map<
    string,
    {
      key: string;
      name: string;
      family: FamilyCode;
      familyName: string;
      changes: number;
      byPeriodicity: Record<string, number>;
    }
  >();
  for (const lado of allSides) {
    for (const contribuidor of [...lado.gains.parameters, ...lado.losses.parameters]) {
      const chave = `${contribuidor.family}|${contribuidor.key}`;
      const atual = acumulado.get(chave) ?? {
        key: contribuidor.key,
        name: contribuidor.name,
        family: contribuidor.family,
        familyName: contribuidor.familyName,
        changes: 0,
        byPeriodicity: {},
      };
      atual.changes += contribuidor.changes;
      atual.byPeriodicity[lado.periodicity] = round(
        (atual.byPeriodicity[lado.periodicity] ?? 0) + contribuidor.amount,
      );
      acumulado.set(chave, atual);
    }
  }
  return [...acumulado.values()]
    .filter((p) => largestAbsolute(p.byPeriodicity) > 0)
    .sort((a, b) => largestAbsolute(b.byPeriodicity) - largestAbsolute(a.byPeriodicity))
    .slice(0, 5);
}

function mergeSummaries(summaries: ExecutiveSummary[]): ExecutiveSummary {
  const sides = mergeSides(summaries.flatMap((s) => s.sides));
  return {
    impact: {
      byPeriodicity: somarRecords(summaries.map((s) => s.impact.byPeriodicity)),
      brutoByPeriodicity: somarRecords(summaries.map((s) => s.impact.brutoByPeriodicity)),
      // O rastro explica a distância entre bruto e oficial de UMA leitura; não
      // é um valor consumível (ver `deduplicacao.ts`) e não faz sentido
      // mesclado entre unidades. Vazio de propósito.
      rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
      excludedChanges: summaries.reduce((soma, s) => soma + s.impact.excludedChanges, 0),
      calculatedChanges: summaries.reduce((soma, s) => soma + s.impact.calculatedChanges, 0),
      notCalculable: summaries.reduce((soma, s) => soma + s.impact.notCalculable, 0),
    },
    lossesByPeriodicity: somarRecords(summaries.map((s) => s.lossesByPeriodicity)),
    gainsByPeriodicity: somarRecords(summaries.map((s) => s.gainsByPeriodicity)),
    sides,
    changes: summaries.reduce((soma, s) => soma + s.changes, 0),
    groups: summaries.reduce((soma, s) => soma + s.groups, 0),
    critical: summaries.reduce((soma, s) => soma + s.critical, 0),
    locked: summaries.reduce((soma, s) => soma + s.locked, 0),
    notCalculable: summaries.reduce((soma, s) => soma + s.notCalculable, 0),
    /*
      Soma simples, deliberadamente. `entity_id` é por unidade, e nada aqui
      constrói um `Set` cruzado para deduplicar entre unidades: a regra de
      "no máximo um contexto por canal" (`agruparPorCanal`) já recusa o caso
      mais arriscado de dupla contagem dentro de uma unidade, mas não prova
      que dois contextos irmãos de canais diferentes nunca compartilham o
      mesmo veículo físico. Este número é uma aproximação, não uma
      cardinalidade global deduplicada — ver teste dedicado.
    */
    vehiclesTouched: summaries.reduce((soma, s) => soma + s.vehiclesTouched, 0),
    topParameters: mergeTopParameters(summaries.flatMap((s) => s.sides)),
    // Mesclar placas exigiria uma estratégia de identidade entre unidades que
    // nada no produto pede hoje — omitido de propósito nesta v1.
    topVehicles: [],
  };
}

export async function getFamiliesOverview(
  db: Database,
  period: string,
  opts?: { datasetFamily?: string },
): Promise<FamiliesOverview | null> {
  const contexts = await listContexts(db, opts);
  const porUnidade = agruparPorUnidade(contexts);

  const unitsExcluded: OverviewUnitExcluded[] = [];
  // Unidades que passaram no filtro de competência e de canal-único — ainda
  // sujeitas a virar exclusão se `getFamiliesView` falhar para todos os seus
  // contextos elegíveis (passo seguinte).
  const candidatas: { unidade: string; label: string; matched: ContextInfo[] }[] = [];
  // Distingue "ninguém tem essa competência" (404 de verdade) de "existe
  // competência, mas nada pôde ser consolidado com segurança" (200 com
  // unitsIncluded vazio) — a mensagem de erro não pode confundir as duas.
  let existeVigenciaParaAlgumaUnidade = false;

  for (const [unidade, grupo] of porUnidade) {
    const matched = grupo.filter((c) => c.periodosDisponiveis.includes(period));
    if (matched.length === 0) {
      unitsExcluded.push({
        unidade,
        label: grupo[0].label,
        reason: "sem_vigencia_na_competencia",
        contexts: grupo.map(refDe),
      });
      continue;
    }
    existeVigenciaParaAlgumaUnidade = true;

    const porCanal = agruparPorCanal(matched);
    const canalAmbiguo = [...porCanal.values()].find((lista) => lista.length > 1);
    if (canalAmbiguo) {
      unitsExcluded.push({
        unidade,
        label: matched[0].label,
        reason: "contextos_sobrepostos_ambiguos",
        contexts: matched.map(refDe),
        conflito: canalAmbiguo.map((c) => ({
          scopeHash: c.scopeHash,
          entradas: [...conjuntoDeEntradas(c)],
        })),
      });
      continue;
    }

    candidatas.push({ unidade, label: matched[0].label, matched });
  }

  if (!existeVigenciaParaAlgumaUnidade) return null;

  // Uma vez para todo o fan-out abaixo, e não uma vez por unidade: os dois são
  // iguais para qualquer unidade e canal (o inventário é `SELECT code FROM
  // attribute`, sem filtro de escopo; `contexts` já foi carregado acima).
  // Repeti-los por unidade multiplicava por unidade um custo que não muda por
  // unidade — quanto mais unidades cadastradas, mais lenta a Visão Geral.
  const inventory = candidatas.length > 0 ? await parametersWithData(db) : null;

  const leituras =
    candidatas.length > 0
      ? await Promise.all(
          candidatas.flatMap((cand) =>
            cand.matched.map(async (contexto) => ({
              unidade: cand.unidade,
              contexto,
              view: await getFamiliesView(
                db,
                period,
                { scopeHash: contexto.scopeHash, channel: contexto.channel },
                { contexts, inventory: inventory ?? undefined },
              ),
            })),
          ),
        )
      : [];

  const leiturasPorUnidade = new Map<string, typeof leituras>();
  for (const leitura of leituras) {
    const lista = leiturasPorUnidade.get(leitura.unidade) ?? [];
    lista.push(leitura);
    leiturasPorUnidade.set(leitura.unidade, lista);
  }

  const unitsIncluded: OverviewUnitIncluded[] = [];
  const views: FamiliesView[] = [];

  for (const cand of candidatas) {
    const leiturasDaUnidade = leiturasPorUnidade.get(cand.unidade) ?? [];
    const sucesso = leiturasDaUnidade.filter((l) => l.view !== null);
    const falha = leiturasDaUnidade.filter((l) => l.view === null);

    if (sucesso.length === 0) {
      unitsExcluded.push({
        unidade: cand.unidade,
        label: cand.label,
        reason: "vigencia_indisponivel_na_leitura",
        contexts: cand.matched.map(refDe),
      });
      continue;
    }

    for (const s of sucesso) views.push(s.view as FamiliesView);

    unitsIncluded.push({
      unidade: cand.unidade,
      label: cand.label,
      contexts: cand.matched.map(refDe),
      coberturaParcial:
        falha.length > 0
          ? falha.map((f) => ({
              scopeHash: f.contexto.scopeHash,
              channel: f.contexto.channel,
              motivo: "vigencia_indisponivel_na_leitura" as const,
            }))
          : undefined,
      summary: mergeSummaries(sucesso.map((s) => (s.view as FamiliesView).summary)),
    });
  }

  /*
    Nunca `return null` daqui pra baixo: `existeVigenciaParaAlgumaUnidade`
    já garante que a competência existe em algum lugar. Se `unitsIncluded`
    ficar vazio (tudo excluído por ambiguidade, ou toda leitura falhou), a
    resposta ainda é um `FamiliesOverview` válido — com `summary` zerado por
    construção (`mergeSummaries([])`) e `unitsExcluded` explicando por quê.
    A tela decide o que fazer com "0 de N"; a rota não inventa um 404 que
    diria "não existe" quando na verdade existe, só não foi consolidável.
  */
  return {
    period,
    summary: mergeSummaries(views.map((v) => v.summary)),
    unitsIncluded,
    unitsExcluded,
  };
}

// ---------------------------------------------------------------------------
// A Visão Geral do intervalo — soma de todas as unidades, entre duas vigências
// ---------------------------------------------------------------------------

/**
 * `getFamiliesOverview` acima soma unidades numa única competência.  Esta é a
 * mesma pergunta para um intervalo: quem entrou, quem ficou de fora, e quanto
 * cada unidade somou de líquido, ganho e perda entre `from` e `to`.
 *
 * Nasce mais simples do que a irmã de competência única: aqui o consumo é o
 * ranking "onde está o impacto", que só precisa do total por unidade — não da
 * árvore de famílias, do `topParameters` nem dos `entries` linha a linha que
 * `RangeAnalysis` carrega por unidade. Somar esses campos entre unidades é
 * trabalho que ninguém pediu ainda; se pedir, é aqui que ele entra.
 *
 * A régua de agrupamento é a mesma de `getFamiliesOverview`
 * (`agruparPorUnidade`, `agruparPorCanal`) — o que muda é a leitura por
 * contexto, que aqui é `getRangeAnalysis` em vez de `getFamiliesView`, sem
 * filtro de competência: uma unidade sem contexto elegível só é excluída por
 * ambiguidade de canal, nunca por não ter a competência exata (que não existe
 * como conceito num intervalo).
 */

export type MotivoExclusaoRange = "contextos_sobrepostos_ambiguos" | "sem_leitura_no_intervalo";

export interface RangeOverviewUnitExcluded {
  unidade: string;
  label: string;
  reason: MotivoExclusaoRange;
  contexts: OverviewContextRef[];
  /** Só quando `reason === "contextos_sobrepostos_ambiguos"`. Ver `agruparPorCanal`. */
  conflito?: { scopeHash: string; entradas: string[] }[];
}

export interface RangeOverviewUnit {
  unidade: string;
  label: string;
  contexts: OverviewContextRef[];
  /** Já sem dupla contagem, por periodicidade — soma dos contextos desta unidade. */
  impact: { byPeriodicity: Record<string, number> };
  gainsByPeriodicity: Record<string, number>;
  lossesByPeriodicity: Record<string, number>;
  changes: number;
  vehiclesTouched: number;
}

export interface RangeOverview {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  unitsIncluded: RangeOverviewUnit[];
  unitsExcluded: RangeOverviewUnitExcluded[];
}

export async function getRangeOverview(
  db: Database,
  from?: string,
  to?: string,
): Promise<RangeOverview | null> {
  const contexts = await listContexts(db);
  const porUnidade = agruparPorUnidade(contexts);

  const unitsExcluded: RangeOverviewUnitExcluded[] = [];
  const candidatas: { unidade: string; label: string; matched: ContextInfo[] }[] = [];

  for (const [unidade, grupo] of porUnidade) {
    const porCanal = agruparPorCanal(grupo);
    const canalAmbiguo = [...porCanal.values()].find((lista) => lista.length > 1);
    if (canalAmbiguo) {
      unitsExcluded.push({
        unidade,
        label: grupo[0].label,
        reason: "contextos_sobrepostos_ambiguos",
        contexts: grupo.map(refDe),
        conflito: canalAmbiguo.map((c) => ({
          scopeHash: c.scopeHash,
          entradas: [...conjuntoDeEntradas(c)],
        })),
      });
      continue;
    }
    candidatas.push({ unidade, label: grupo[0].label, matched: grupo });
  }

  if (candidatas.length === 0) return null;

  const leituras = await Promise.all(
    candidatas.flatMap((cand) =>
      cand.matched.map(async (contexto) => ({
        unidade: cand.unidade,
        /*
          `contexts` vai junto de propósito: sem ele, cada uma destas leituras
          recomeça por `listContexts` — a mesma pergunta sobre o banco inteiro,
          repetida uma vez por unidade × contexto, todas em paralelo contra o
          mesmo pool. A lista já está aqui em cima, e não muda entre uma
          unidade e outra.
        */
        analysis: await getRangeAnalysis(
          db,
          from,
          to,
          { scopeHash: contexto.scopeHash, channel: contexto.channel },
          undefined,
          contexts,
        ),
      })),
    ),
  );

  const leiturasPorUnidade = new Map<string, typeof leituras>();
  for (const leitura of leituras) {
    const lista = leiturasPorUnidade.get(leitura.unidade) ?? [];
    lista.push(leitura);
    leiturasPorUnidade.set(leitura.unidade, lista);
  }

  const unitsIncluded: RangeOverviewUnit[] = [];
  // As pontas do intervalo que a resposta anuncia — a primeira unidade que
  // conseguiu ler. Cada unidade resolve `from`/`to` contra o próprio
  // histórico (mesmo padrão de `getRangeAnalysis`), e pode divergir de uma
  // unidade para outra quando uma das pontas falta no histórico dela; a
  // resposta anuncia a leitura de quem respondeu primeiro, e não finge uma
  // ponta única onde ela pode não existir para todo mundo.
  let referencia: RangeAnalysis | null = null;

  for (const cand of candidatas) {
    const leiturasDaUnidade = leiturasPorUnidade.get(cand.unidade) ?? [];
    const sucesso = leiturasDaUnidade
      .map((l) => l.analysis)
      .filter((a): a is RangeAnalysis => a !== null);

    if (sucesso.length === 0) {
      unitsExcluded.push({
        unidade: cand.unidade,
        label: cand.label,
        reason: "sem_leitura_no_intervalo",
        contexts: cand.matched.map(refDe),
      });
      continue;
    }

    for (const a of sucesso) {
      if (!referencia) referencia = a;
    }

    unitsIncluded.push({
      unidade: cand.unidade,
      label: cand.label,
      contexts: cand.matched.map(refDe),
      impact: { byPeriodicity: somarRecords(sucesso.map((a) => a.impact.byPeriodicity)) },
      gainsByPeriodicity: somarRecords(sucesso.map((a) => a.gainsByPeriodicity)),
      lossesByPeriodicity: somarRecords(sucesso.map((a) => a.lossesByPeriodicity)),
      changes: sucesso.reduce((soma, a) => soma + a.totals.changes, 0),
      vehiclesTouched: sucesso.reduce((soma, a) => soma + a.totals.vehiclesTouched, 0),
    });
  }

  if (!referencia) return null;
  const ref: RangeAnalysis = referencia;

  return {
    from: ref.from,
    fromLabel: ref.fromLabel,
    to: ref.to,
    toLabel: ref.toLabel,
    unitsIncluded,
    unitsExcluded,
  };
}
