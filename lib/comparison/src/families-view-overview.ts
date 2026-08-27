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
import { comparePriorities } from "./cockpit";
import type { ChangeGroup } from "./grouped";
import { listContexts, type ContextInfo, type Operacao } from "./series";

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
  /**
   * Veículos distintos no consolidado inteiro — a **união** dos ativos das
   * unidades incluídas, não a soma delas.
   *
   * Existe ao lado de `summary.vehiclesTouched`, e não no lugar dele, porque
   * os dois respondem perguntas diferentes e o produto publica os dois:
   * `summary.vehiclesTouched` é a soma por unidade (ver a nota em
   * `mergeSummaries`), útil para conferir unidade a unidade e contratada por
   * quem já a lê; este é a cardinalidade global, que é o que a palavra
   * "veículos" promete quando aparece sozinha numa faixa de abertura.
   *
   * A união é deduplicação de verdade, e não de rótulo: `entity.id` é global
   * e casado por placa/chassi (`entity_identifier`), então o mesmo caminhão
   * exportado por duas unidades é o mesmo id nas duas. Quando nenhuma unidade
   * compartilha ativo com outra, este número é igual à soma — e é assim que
   * se sabe que não havia sobreposição.
   */
  vehiclesTouchedDistinct: number;
  unitsIncluded: OverviewUnitIncluded[];
  unitsExcluded: OverviewUnitExcluded[];
  /**
   * O corpo de tela consolidado — famílias, fila de alterações e frota.
   *
   * Nasceu para o Dashboard: em Visão Geral ele mostrava quatro cartões e o
   * ranking de unidades, e o resto da tela — gráfico, pódio, tabela,
   * movimentação — só existia dentro de uma unidade. Ver `OverviewConsolidado`
   * para o que cada peça soma e o que ela deliberadamente não soma.
   */
  consolidado: OverviewConsolidado;
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

      A cardinalidade global existe, e mora um nível acima:
      `FamiliesOverview.vehiclesTouchedDistinct` une os `entityIdsTouched` das
      unidades. Ela não substitui esta soma — quem lê `summary` unidade a
      unidade continua contratando a soma —, mas é ela que a tela publica
      quando escreve "veículos" sem qualificar.
    */
    vehiclesTouched: summaries.reduce((soma, s) => soma + s.vehiclesTouched, 0),
    topParameters: mergeTopParameters(summaries.flatMap((s) => s.sides)),
    // Mesclar placas exigiria uma estratégia de identidade entre unidades que
    // nada no produto pede hoje — omitido de propósito nesta v1.
    topVehicles: [],
  };
}

// ---------------------------------------------------------------------------
// O consolidado da competência — o mesmo corpo de tela que uma unidade tem
// ---------------------------------------------------------------------------

/**
 * Uma família somada entre as unidades incluídas.
 *
 * Não é um `FamilyView`: `parametersWithData`/`parametersChanged` e a árvore de
 * parâmetros ficam de fora de propósito — "4 de 10 parâmetros" é uma fração de
 * uma unidade, e somá-la entre unidades produziria um denominador que não
 * existe em lugar nenhum. O que entra aqui é o que a soma sustenta: quantas
 * alterações, quantos veículos, e quanto de impacto por periodicidade.
 */
export interface OverviewFamilyTotal {
  code: FamilyCode;
  name: string;
  changes: number;
  vehicles: number;
  impact: { byPeriodicity: Record<string, number> };
}

/**
 * Um grupo de alteração de uma unidade, dentro da fila consolidada.
 *
 * O grupo **não é mesclado** com o de outra unidade, e nem poderia ser: a
 * mesma alteração de `carreta.custo_fixo` em PERNAMBUCO e em CAMAÇARI são dois
 * fatos, sobre duas frotas, com dois valores. O que a Visão Geral faz é
 * enfileirar os grupos das unidades numa lista só, na mesma ordem de
 * prioridade que o Acompanhamento usa dentro de uma unidade — e cada linha
 * carrega de quem ela é, para a tela nomear a unidade e para o link de
 * detalhe abrir no recorte certo.
 */
export interface OverviewGroup {
  unidade: string;
  label: string;
  scopeHash: string;
  channel: string | null;
  /** O score da fila do Acompanhamento (`cockpit.priorities`), ou `0` para um grupo fora dela. */
  score: number;
  group: ChangeGroup;
}

/**
 * O que o Dashboard precisa para desenhar, em Visão Geral, o mesmo corpo de
 * tela que desenha para uma unidade: o pódio de famílias, a fila de
 * alterações e a movimentação de frota.
 *
 * Vive num campo próprio, e não espalhado por `FamiliesOverview`, porque cada
 * peça daqui tem uma régua de soma diferente da do `summary` — e a diferença
 * precisa ficar legível: `families` soma, `groups` **enfileira sem somar**, e
 * `totals` soma o que é contagem de unidade disjunta (frota, entradas e
 * saídas de ativo), nunca cardinalidade que pediria deduplicação por placa.
 */
export interface OverviewConsolidado {
  families: OverviewFamilyTotal[];
  totals: {
    changes: number;
    vehiclesTouched: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    inconclusive: number;
    /** A frota das séries de todas as unidades incluídas — `cockpit.kpis.fleet` somado. */
    fleet: number;
  };
  /** Os primeiros `LIMITE_DE_GRUPOS` da fila consolidada. */
  groups: OverviewGroup[];
  /** Quantos grupos existem ao todo, antes do corte — para a tela nunca dizer "todos" sobre uma fatia. */
  gruposNoTotal: number;
}

/**
 * Quantos grupos a fila consolidada carrega.
 *
 * O Dashboard mostra oito por aba de equipamento; o teto aqui é folgado o
 * bastante para as abas terem o que mostrar e apertado o bastante para a
 * resposta não crescer com o número de unidades cadastradas — um `ChangeGroup`
 * carrega a lista de veículos dele, e enviar a fila inteira de N unidades
 * seria N vezes o corpo de uma tela de unidade.
 */
const LIMITE_DE_GRUPOS = 40;

function mergeFamilies(views: FamiliesView[]): OverviewFamilyTotal[] {
  const acumulado = new Map<FamilyCode, OverviewFamilyTotal>();
  for (const view of views) {
    for (const familia of view.families) {
      const atual = acumulado.get(familia.code);
      if (atual) {
        atual.changes += familia.changes;
        // Mesma aproximação de `vehiclesTouched`: soma simples, sem `Set`
        // cruzado entre unidades.
        atual.vehicles += familia.vehicles;
        atual.impact.byPeriodicity = somarRecords([
          atual.impact.byPeriodicity,
          familia.impact.byPeriodicity,
        ]);
      } else {
        acumulado.set(familia.code, {
          code: familia.code,
          name: familia.name,
          changes: familia.changes,
          vehicles: familia.vehicles,
          impact: { byPeriodicity: { ...familia.impact.byPeriodicity } },
        });
      }
    }
  }
  return [...acumulado.values()];
}

/**
 * A fila consolidada — a fila do Acompanhamento de cada unidade, numa lista só.
 *
 * A ordem é `comparePriorities`, a mesma que ordena a fila dentro de uma
 * unidade: score, veículos, módulo do impacto, chave. Uma unidade cuja
 * vigência não produziu fila (sem cockpit de prioridades) ainda entra, com os
 * seus grupos em `score: 0` — é o mesmo degrau que a tela já fazia sozinha
 * quando `juntarPrioridades` voltava vazia.
 */
function filaConsolidada(
  leituras: { unidade: string; label: string; contexto: ContextInfo; view: FamiliesView }[],
): { groups: OverviewGroup[]; gruposNoTotal: number } {
  const fila: OverviewGroup[] = [];
  for (const leitura of leituras) {
    const porChave = new Map(leitura.view.groups.map((g) => [g.key, g]));
    const daUnidade =
      leitura.view.cockpit.priorities.length > 0
        ? leitura.view.cockpit.priorities.flatMap((item) => {
            const group = porChave.get(item.key);
            return group ? [{ score: item.score, group }] : [];
          })
        : leitura.view.groups.map((group) => ({ score: 0, group }));
    for (const { score, group } of daUnidade) {
      fila.push({
        unidade: leitura.unidade,
        label: leitura.label,
        scopeHash: leitura.contexto.scopeHash,
        channel: leitura.contexto.channel,
        score,
        group,
      });
    }
  }
  fila.sort(comparePriorities);
  return { groups: fila.slice(0, LIMITE_DE_GRUPOS), gruposNoTotal: fila.length };
}

function consolidar(
  leituras: { unidade: string; label: string; contexto: ContextInfo; view: FamiliesView }[],
): OverviewConsolidado {
  const views = leituras.map((l) => l.view);
  const { groups, gruposNoTotal } = filaConsolidada(leituras);
  return {
    families: mergeFamilies(views),
    totals: {
      changes: views.reduce((soma, v) => soma + v.totals.changes, 0),
      vehiclesTouched: views.reduce((soma, v) => soma + v.totals.vehiclesTouched, 0),
      entitiesAdded: views.reduce((soma, v) => soma + v.totals.entitiesAdded, 0),
      entitiesRemoved: views.reduce((soma, v) => soma + v.totals.entitiesRemoved, 0),
      inconclusive: views.reduce((soma, v) => soma + v.totals.inconclusive, 0),
      fleet: views.reduce((soma, v) => soma + v.cockpit.kpis.fleet, 0),
    },
    groups,
    gruposNoTotal,
  };
}

export async function getFamiliesOverview(
  db: Database,
  period: string,
  opts?: { datasetFamily?: string; operacao?: Operacao | null },
): Promise<FamiliesOverview | null> {
  /*
    A Visão Geral soma todas as unidades da competência, e é por `listContexts`
    que ela sabe quais são: recortada a lista pela operação, tudo o que vem
    depois — as leituras por unidade, os grupos, os totais — já nasce dela.
  */
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
                {
                  scopeHash: contexto.scopeHash,
                  channel: contexto.channel,
                  operacao: opts?.operacao ?? null,
                },
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
  // As mesmas leituras de `views`, sem perder de quem elas são — é o que o
  // consolidado precisa para nomear a unidade de cada grupo da fila e para o
  // link de detalhe abrir no recorte certo.
  const consolidaveis: {
    unidade: string;
    label: string;
    contexto: ContextInfo;
    view: FamiliesView;
  }[] = [];

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

    for (const s of sucesso) {
      views.push(s.view as FamiliesView);
      consolidaveis.push({
        unidade: cand.unidade,
        label: cand.label,
        contexto: s.contexto,
        view: s.view as FamiliesView,
      });
    }

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
    vehiclesTouchedDistinct: new Set(views.flatMap((v) => v.entityIdsTouched)).size,
    unitsIncluded,
    unitsExcluded,
    consolidado: consolidar(consolidaveis),
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

/**
 * Um ponto da série consolidada — uma competência, os dois lados do impacto
 * somados entre as unidades incluídas.
 *
 * Existe para o gráfico "Impacto das alterações por competência" do Dashboard
 * poder ser desenhado em Visão Geral. A conta é a mesma que a tela faz para
 * uma unidade (`seriesDoIntervalo`, em `linha-do-tempo-de-alteracoes.tsx`): só
 * entra alteração com sinal apurado (`CALCULATED`, valor diferente de zero), e
 * os dois lados nunca se misturam entre periodicidades. `losses` vem negativo,
 * como em toda parte do produto.
 *
 * Vem somado do servidor em vez de a tela somar as `entries` de cada unidade
 * porque a alternativa era despejar a lista de alterações de N unidades no
 * navegador para desenhar seis pontos.
 */
export interface RangeOverviewPoint {
  period: string;
  label: string;
  byPeriodicity: Record<string, { gains: number; losses: number }>;
  /**
   * Quantas alterações a competência trouxe, somadas entre as unidades
   * incluídas — a mesma contagem que `movements[].changes` dá por unidade.
   *
   * Vem junto da série porque o seletor de vigência da Visão Geral faz a
   * mesma pergunta que o da unidade responde há tempos: entre seis datas
   * iguais, é a contagem que diz onde algo aconteceu. Sem ela, a soma entre
   * unidades exigiria uma segunda varredura do intervalo inteiro para
   * escrever seis números que esta já tem em mãos.
   */
  changes: number;
}

export interface RangeOverview {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  unitsIncluded: RangeOverviewUnit[];
  unitsExcluded: RangeOverviewUnitExcluded[];
  /** A série do intervalo, competência a competência, somada entre as unidades incluídas. */
  serie: RangeOverviewPoint[];
}

/** A mesma régua de `comSinal` na tela: sem sinal apurado, a linha não é ganho nem perda. */
function comSinalApurado(analysis: RangeAnalysis) {
  return analysis.entries.filter(
    (e) => e.confidence === "CALCULATED" && e.amount !== null && e.amount !== 0,
  );
}

function serieConsolidada(analises: RangeAnalysis[]): RangeOverviewPoint[] {
  const rotulos = new Map<string, string>();
  for (const analysis of analises) {
    for (const m of analysis.movements) if (!rotulos.has(m.period)) rotulos.set(m.period, m.label);
    for (const e of analysis.entries) if (!rotulos.has(e.period)) rotulos.set(e.period, e.periodLabel);
  }

  const pontos = new Map<string, RangeOverviewPoint>();
  for (const [period, label] of rotulos) {
    pontos.set(period, { period, label, byPeriodicity: {}, changes: 0 });
  }
  /*
    A contagem sai de `movements` e não das `entries` filtradas por sinal: uma
    alteração sem impacto apurado continua sendo uma alteração, e é a mesma
    régua que a unidade usa no seu próprio seletor.
  */
  for (const analysis of analises) {
    for (const m of analysis.movements) {
      const ponto = pontos.get(m.period);
      if (ponto) ponto.changes += m.changes;
    }
  }
  for (const analysis of analises) {
    for (const e of comSinalApurado(analysis)) {
      const ponto = pontos.get(e.period);
      if (!ponto) continue;
      const chave = e.periodicity ?? "SEM_PERIODICIDADE";
      const lado = (ponto.byPeriodicity[chave] ??= { gains: 0, losses: 0 });
      const valor = e.amount as number;
      if (valor > 0) lado.gains = round(lado.gains + valor);
      else lado.losses = round(lado.losses + valor);
    }
  }

  return [...pontos.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export async function getRangeOverview(
  db: Database,
  from?: string,
  to?: string,
  opts?: { operacao?: Operacao | null },
): Promise<RangeOverview | null> {
  const contexts = await listContexts(db, opts);
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
          {
            scopeHash: contexto.scopeHash,
            channel: contexto.channel,
            operacao: opts?.operacao ?? null,
          },
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
  // As leituras que entraram na soma — a série consolidada sai delas, e nunca
  // de uma unidade que ficou de fora do ranking acima.
  const analisesIncluidas: RangeAnalysis[] = [];
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
      analisesIncluidas.push(a);
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
    serie: serieConsolidada(analisesIncluidas),
  };
}
