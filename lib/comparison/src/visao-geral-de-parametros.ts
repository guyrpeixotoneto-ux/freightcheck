import type { ContextInfo } from "./series";
import { somarResumos, resumoVazio, type ResumoDeImpacto } from "./deduplicacao";
import {
  BADGE_ORDER,
  coverageLabel,
  type Badge,
  type ChangeGroup,
  type Coverage,
  type EstadoDaComparacao,
  type GroupedSeries,
  type GroupAggregate,
  type GroupImpact,
} from "./grouped";
import { buildCockpit } from "./cockpit";
import type { ExecutiveSummary, FamiliesView, FamilyView, ParameterView } from "./families-view";
import {
  FAMILIES,
  FAMILY_ORDER,
  FREIGHTECH_SEM_DADO,
  placementOf,
  type FamilyCode,
} from "./families";

/**
 * A tela de Parâmetros somada entre as unidades — a Visão Geral dela.
 *
 * `getFamiliesOverview` já lia a vigência de cada unidade inteira
 * (`getFamiliesView`) e depois **descartava** a árvore: o consolidado guardava
 * o resumo executivo, as famílias como totais rasos e uma fila de alterações
 * cortada em quarenta. Era o bastante para o Dashboard e para a Linha do Tempo,
 * e não para Parâmetros — que é grade de atributo e de gaveta, e não de total.
 * Sem a árvore, escolher "Visão Geral" estando em Parâmetros não tinha para
 * onde ir: o seletor da lateral mandava para o Resumo executivo, e quem só
 * queria trocar de recorte perdia a tela.
 *
 * Este módulo fecha isso montando, a partir das mesmas leituras que já estão
 * na memória, **uma `FamiliesView`** — a mesma forma que a tela consome quando
 * está numa unidade só. Nada de novo é lido do banco, nenhuma comparação é
 * calculada: é projeção sobre o que `getFamiliesOverview` já tinha.
 *
 * ## O que soma, e como
 *
 * A régua é a mesma do resto do produto, e ela é mais estrita do que "somar
 * tudo":
 *
 * - **Alterações somam.** São contagens de eventos distintos.
 * - **Veículos nunca somam** — são a **união** dos `entityIds`. `entity.id` é
 *   global e casado por placa/chassi, então o mesmo cavalo exportado por duas
 *   unidades é um veículo, não dois.
 * - **Impacto soma dentro de cada periodicidade, nunca entre elas.** Um mesmo
 *   atributo que veio mensal numa unidade e anual noutra não vira um número: o
 *   grupo consolidado fica sem `amount` e diz o porquê, do mesmo jeito que uma
 *   linha sem preço já dizia.
 * - **Frota soma**, porque são séries diferentes de unidades diferentes: a
 *   frota de PERNAMBUCO mais a de CAMAÇARI é a frota das duas.
 *
 * ## O que não soma, e por que ainda assim aparece
 *
 * `patterns`, `dominantPattern` e o `aggregate` não somável são leituras sobre
 * as **linhas** de um grupo, e as linhas ficaram no servidor de cada unidade.
 * Inventar um "par antes → depois dominante" entre duas unidades produziria uma
 * transição que nunca existiu em lugar nenhum — o mesmo defeito que
 * `RangeEntry` já se recusa a cometer entre vigências. Então, com mais de uma
 * unidade no grupo, esses campos vêm neutros (`null`, `0`) e o detalhe do
 * atributo mostra **cada unidade separada**, via {@link GrupoConsolidado.porUnidade}.
 * Com uma unidade só eles passam intactos, porque aí não há mistura nenhuma.
 *
 * O que é somável dentro do `aggregate` continua somando: totais, linhas na
 * soma, numerador e denominador por veículo, e a faixa de variação. O que sai
 * disso é recomputado (médias, `deltaPercent`), nunca herdado de uma unidade.
 */

/** De qual unidade veio um pedaço do grupo consolidado. */
export interface OrigemDoGrupo {
  /** O código do escopo `UNIDADE` — a mesma chave de `agruparPorUnidade`. */
  unidade: string;
  /** "CAMAÇARI · EMPURRADA" — o rótulo da tela. */
  label: string;
  scopeHash: string;
  channel: string | null;
  /** O grupo como aquela unidade o leu, intacto. */
  group: ChangeGroup;
}

/**
 * Um grupo de alteração somado entre unidades, com a origem preservada.
 *
 * Estende `ChangeGroup` em vez de substituí-lo: toda a tela de Parâmetros
 * (grade de atributos, cartões do catálogo, busca, ordenação) continua lendo
 * os mesmos campos de sempre, e só o detalhe — que precisa abrir os veículos, e
 * veículo se abre dentro de um contexto — olha `porUnidade`.
 */
export interface GrupoConsolidado extends ChangeGroup {
  /** Uma entrada por (unidade, canal) que trouxe este atributo. Nunca vazia. */
  porUnidade: OrigemDoGrupo[];
}

/** Uma leitura de unidade pronta para entrar na soma. */
export interface LeituraDaUnidade {
  unidade: string;
  label: string;
  contexto: ContextInfo;
  view: FamiliesView;
}

/**
 * A `FamiliesView` consolidada, mais o que só a Visão Geral sabe dizer.
 *
 * `visaoGeral` viaja junto porque a tela precisa se anunciar como soma: sem
 * isso ela desenharia o cabeçalho de uma unidade — com nome de unidade e
 * seletor de unidade — sobre números que são de todas.
 */
export interface FamiliesViewConsolidada extends FamiliesView {
  groups: GrupoConsolidado[];
  /**
   * A nota de rodapé do catálogo — o que o Freightech publica e este export não
   * traz.
   *
   * Vai daqui, e não da rota, porque esta leitura não passa por
   * `/changes/families` (que a acrescenta na resposta): sem ela a aba do
   * catálogo perderia a nota exatamente onde ela mais importa, que é a tela que
   * promete mostrar **todas** as gavetas de lá. É a mesma constante, não uma
   * segunda lista.
   */
  freightechSemDado: { family: string; parameters: string[] }[];
  visaoGeral: {
    /** Quantas unidades entraram na soma. */
    unidades: number;
    /** Uma entrada por (unidade, canal) incluído — a legenda do recorte. */
    contextos: { unidade: string; label: string; scopeHash: string; channel: string | null }[];
  };
}

const arredondar = (v: number) => Number(v.toFixed(2));

/** O selo mais forte entre os das unidades — `BADGE_ORDER` é a régua de gravidade. */
function badgeMaisForte(badges: Badge[]): Badge {
  return badges.reduce((forte, atual) =>
    BADGE_ORDER.indexOf(atual) < BADGE_ORDER.indexOf(forte) ? atual : forte,
  );
}

const primeiroNaoNulo = <T>(valores: (T | null)[]): T | null =>
  valores.find((v): v is T => v !== null) ?? null;

/**
 * O impacto do grupo consolidado.
 *
 * A periodicidade é a trava: só há um número quando todas as unidades que
 * trouxeram o atributo o precificaram na mesma unidade de tempo. Periodicidades
 * diferentes não somam — nem aqui, nem em lugar nenhum deste produto —, e o
 * caso vira o que ele é: sem valor apurado, com o motivo escrito.
 */
function mesclarImpacto(grupos: ChangeGroup[]): GroupImpact {
  const periodicidades = new Set(
    grupos.map((g) => g.impact.periodicity).filter((p): p is string => p !== null),
  );
  const misturado = periodicidades.size > 1;
  const comValor = grupos.filter((g) => g.impact.amount !== null);
  const excluidos = grupos.filter((g) => g.impact.excludedAmount !== null);
  const excludedVehicles = grupos.reduce((s, g) => s + g.impact.excludedVehicles, 0);

  return {
    // `impact_confidence` entra na chave do grupo (`groupKey`), então todas as
    // unidades deste grupo têm a mesma — não há o que escolher.
    confidence: grupos[0].impact.confidence,
    amount:
      misturado || comValor.length === 0
        ? null
        : arredondar(comValor.reduce((s, g) => s + (g.impact.amount as number), 0)),
    periodicity: misturado ? null : ([...periodicidades][0] ?? null),
    reason: misturado
      ? `As unidades precificaram este ponto em periodicidades diferentes ` +
        `(${[...periodicidades].join(", ")}). Somá-las daria um número que não existe — ` +
        `o valor de cada unidade está no detalhe, separado.`
      : primeiroNaoNulo(grupos.map((g) => g.impact.reason)),
    countedVehicles: grupos.reduce((s, g) => s + g.impact.countedVehicles, 0),
    excludedVehicles,
    excludedAmount:
      misturado || excluidos.length === 0
        ? null
        : arredondar(excluidos.reduce((s, g) => s + (g.impact.excludedAmount as number), 0)),
    excludedMotivo: primeiroNaoNulo(grupos.map((g) => g.impact.excludedMotivo)),
    excludedReason:
      excludedVehicles === 0
        ? null
        : (primeiroNaoNulo(grupos.map((g) => g.impact.excludedReason))?.replace(
            /Vale para \d+ veículos? deste grupo\.$/,
            `Vale para ${excludedVehicles} ` +
              `${excludedVehicles === 1 ? "veículo" : "veículos"} deste grupo.`,
          ) ?? null),
  };
}

/**
 * O agregado consolidado — o que soma, somado; o que não soma, recusado.
 *
 * `summable` só sobrevive quando **todas** as unidades somavam pela mesma
 * regra: `SUM` numa e `AVG` noutra não tem total comum, e produzir um seria
 * apresentar como "antes → depois" duas contas de naturezas diferentes.
 */
function mesclarAgregado(grupos: ChangeGroup[]): GroupAggregate {
  if (grupos.length === 1) return grupos[0].aggregate;

  const agregados = grupos.map((g) => g.aggregate);
  const agregacoes = new Set(agregados.map((a) => a.aggregation));
  const somavel = agregados.every((a) => a.summable) && agregacoes.size === 1;

  const percentuais = agregados
    .flatMap((a) => [a.minPercent, a.maxPercent])
    .filter((v): v is number => v !== null);
  const minPercent = percentuais.length > 0 ? Math.min(...percentuais) : null;
  const maxPercent = percentuais.length > 0 ? Math.max(...percentuais) : null;

  if (!somavel) {
    return {
      summable: false,
      aggregation: agregacoes.size === 1 ? [...agregacoes][0] : null,
      totalBefore: null,
      totalAfter: null,
      rowsInTotal: agregados.reduce((s, a) => s + a.rowsInTotal, 0),
      perVehicle: null,
      deltaPercent: null,
      minPercent,
      maxPercent,
    };
  }

  const somarPontas = (lado: "totalBefore" | "totalAfter"): number | null => {
    const valores = agregados.map((a) => a[lado]);
    return valores.some((v) => v === null)
      ? null
      : arredondar((valores as number[]).reduce((s, v) => s + v, 0));
  };
  const totalBefore = somarPontas("totalBefore");
  const totalAfter = somarPontas("totalAfter");

  const porVeiculo = agregados.map((a) => a.perVehicle);
  const denominador = porVeiculo.reduce((s, p) => s + (p?.denominator ?? 0), 0);
  const numerador = (lado: "numeratorBefore" | "numeratorAfter"): number | null => {
    const valores = porVeiculo.map((p) => p?.[lado] ?? null);
    return valores.some((v) => v === null)
      ? null
      : arredondar((valores as number[]).reduce((s, v) => s + v, 0));
  };
  const numeratorBefore = numerador("numeratorBefore");
  const numeratorAfter = numerador("numeratorAfter");
  const media = (numerador: number | null) =>
    numerador === null || denominador === 0 ? null : arredondar(numerador / denominador);

  return {
    summable: true,
    aggregation: [...agregacoes][0],
    totalBefore,
    totalAfter,
    rowsInTotal: agregados.reduce((s, a) => s + a.rowsInTotal, 0),
    perVehicle:
      porVeiculo.every((p) => p === null) || denominador === 0
        ? null
        : {
            numeratorBefore,
            numeratorAfter,
            denominator: denominador,
            averageBefore: media(numeratorBefore),
            averageAfter: media(numeratorAfter),
          },
    // Recomputado sobre os totais somados, nunca herdado de uma unidade: a
    // variação do conjunto não é a variação de nenhuma das partes.
    deltaPercent:
      totalBefore === null || totalAfter === null || totalBefore === 0
        ? null
        : arredondar(((totalAfter - totalBefore) / Math.abs(totalBefore)) * 100),
    minPercent,
    maxPercent,
  };
}

/** As anomalias de formato somadas por tipo — a mesma chave que `buildGroup` usa. */
function mesclarAnomalias(grupos: ChangeGroup[]): ChangeGroup["anomalies"] {
  const indice = new Map<string, ChangeGroup["anomalies"][number]>();
  for (const grupo of grupos) {
    for (const anomalia of grupo.anomalies) {
      const chave = `${anomalia.kind}|${anomalia.sameInstant}|${anomalia.differenceMs}`;
      const atual = indice.get(chave);
      if (atual) atual.vehicles += anomalia.vehicles;
      else indice.set(chave, { ...anomalia });
    }
  }
  return [...indice.values()];
}

/**
 * Um atributo, somado entre as unidades que o trouxeram.
 *
 * `origens` chega na ordem das leituras e sai preservada em `porUnidade`: é
 * ela que o detalhe percorre para abrir os veículos de cada unidade no recorte
 * certo.
 */
function mesclarGrupos(origens: OrigemDoGrupo[]): GrupoConsolidado {
  const grupos = origens.map((o) => o.group);
  const primeiro = grupos[0];

  if (grupos.length === 1) return { ...primeiro, porUnidade: origens };

  const entityIds = [...new Set(grupos.flatMap((g) => g.entityIds))];
  const vehicles = entityIds.length;
  const fleet = grupos.reduce((s, g) => s + g.fleet, 0);
  const share = fleet > 0 ? vehicles / fleet : 0;
  const coverage: Coverage = share >= 1 ? "TOTAL" : share >= 0.5 ? "MAIORIA" : "PARCIAL";
  const anomalies = mesclarAnomalias(grupos);

  return {
    // Identidade: vem da chave do grupo, igual em todas as unidades por
    // construção (`groupKey` é atributo + equipamento + tipo + comparabilidade
    // + confiança, e nada de contexto).
    key: primeiro.key,
    attributeCode: primeiro.attributeCode,
    title: primeiro.title,
    entityType: primeiro.entityType,
    equipment: primeiro.equipment,
    changeType: primeiro.changeType,
    category: primeiro.category,
    comparability: primeiro.comparability,

    changes: grupos.reduce((s, g) => s + g.changes, 0),
    vehicles,
    entityIds,
    fleet,
    coverage,
    coverageLabel: coverageLabel(coverage, vehicles, fleet, primeiro.entityType),

    // As leituras sobre as linhas ficaram em cada unidade — ver o cabeçalho
    // deste módulo. Neutro é a resposta honesta; o detalhe abre por unidade.
    patterns: 0,
    dominantPattern: null,

    aggregate: mesclarAgregado(grupos),
    impact: mesclarImpacto(grupos),

    natures: [...new Set(grupos.flatMap((g) => g.natures))],
    natureCodes: [...new Set(grupos.flatMap((g) => g.natureCodes))],
    semanticsStatus: primeiro.semanticsStatus,
    semanticsLabel: primeiro.semanticsLabel,
    unit: primeiro.unit,
    isMonetary: primeiro.isMonetary,
    costClass: primeiro.costClass,
    taxonomyName: primeiro.taxonomyName,
    inconclusiveReason: primeiroNaoNulo(grupos.map((g) => g.inconclusiveReason)),
    anomalies,
    // Só é troca de formato pura quando é pura em **todas** as unidades: uma
    // única unidade com mudança de valor de verdade faz do consolidado uma
    // alteração, pela mesma razão que uma única linha faz dentro de uma.
    formatOnly: grupos.every((g) => g.formatOnly),
    composition: primeiroNaoNulo(grupos.map((g) => g.composition)),
    // O selo mais grave entre as unidades: um ponto que é DINHEIRO em Camaçari
    // não pode se anunciar como SEM_SINAL porque em Pernambuco não mexeu preço.
    badge: badgeMaisForte(grupos.map((g) => g.badge)),
    badgeLabel: "",

    porUnidade: origens,
  };
}

/** Os rótulos dos selos, para reescrever `badgeLabel` depois da eleição acima. */
function comRotuloDoSelo(grupo: GrupoConsolidado, origens: OrigemDoGrupo[]): GrupoConsolidado {
  const doSelo = origens.find((o) => o.group.badge === grupo.badge);
  return { ...grupo, badgeLabel: doSelo?.group.badgeLabel ?? origens[0].group.badgeLabel };
}

/**
 * As séries das unidades, uma linha por equipamento.
 *
 * A frota soma; os rótulos de arquivo não. "PERNAMBUCO-ago.xlsx" e
 * "CAMAÇARI-ago.xlsx" não viram um rótulo só — quando as unidades divergem, o
 * campo diz de quantas entregas se trata em vez de eleger uma delas.
 */
function mesclarSeries(views: FamiliesView[]): GroupedSeries[] {
  const porEquipamento = new Map<string, GroupedSeries[]>();
  for (const view of views) {
    for (const serie of view.series) {
      const lista = porEquipamento.get(serie.entityTypeSet) ?? [];
      lista.push(serie);
      porEquipamento.set(serie.entityTypeSet, lista);
    }
  }

  const umOuMuitos = (valores: (string | null)[], sufixo: string): string | null => {
    const distintos = [...new Set(valores.filter((v): v is string => v !== null))];
    if (distintos.length === 0) return null;
    return distintos.length === 1 ? distintos[0] : `${distintos.length} ${sufixo}`;
  };

  return [...porEquipamento.values()].map((series) => ({
    ...series[0],
    fleet: series.reduce((s, x) => s + x.fleet, 0),
    snapshotLabel: umOuMuitos(series.map((s) => s.snapshotLabel), "entregas") ?? "",
    previousLabel: umOuMuitos(series.map((s) => s.previousLabel), "entregas anteriores"),
    previousPeriod: umOuMuitos(series.map((s) => s.previousPeriod), "vigências"),
    previousPeriodLabel: umOuMuitos(series.map((s) => s.previousPeriodLabel), "vigências"),
    // `changeSetId` é de uma comparação só e não tem consolidado: quem precisa
    // de rastro até a célula desce por `porUnidade`, onde a comparação existe.
    changeSetId: null,
    reason: primeiroNaoNulo(series.map((s) => s.reason)),
  }));
}

/**
 * A composição da vigência somada — os mesmos seis tipos, com as entidades de
 * todas as unidades.
 *
 * `ultimaVigenciaComDado` sai como `null` de propósito, e não herdado da
 * primeira unidade: ele é o convite "este tipo está na vigência X", e a
 * vigência X de uma unidade não é a das outras. Herdá-lo mandaria quem lê para
 * um mês em que só uma das unidades tem o tipo — a tela então diz "não há nesta
 * vigência", que é verdade sobre o conjunto, em vez de um convite que engana.
 */
function mesclarComposicao(views: FamiliesView[]): FamiliesView["composicao"] {
  const primeira = views[0].composicao;
  const entidadesPorTipo = new Map<string, number>();
  for (const view of views) {
    for (const tipo of view.composicao.tipos) {
      entidadesPorTipo.set(tipo.code, (entidadesPorTipo.get(tipo.code) ?? 0) + tipo.entidades);
    }
  }
  const tipos = primeira.tipos.map((tipo) => ({
    ...tipo,
    entidades: entidadesPorTipo.get(tipo.code) ?? 0,
    presente: (entidadesPorTipo.get(tipo.code) ?? 0) > 0,
    ultimaVigenciaComDado:
      views.length === 1 ? tipo.ultimaVigenciaComDado : null,
  }));
  const presentes = tipos.filter((t) => t.presente);
  return { tipos, presentes, vazia: presentes.length === 0 };
}

/** O seletor de vigência: a união das datas, com os tipos de todas as unidades. */
function mesclarPeriodos(views: FamiliesView[]): FamiliesView["periods"] {
  const porData = new Map<string, FamiliesView["periods"]>();
  for (const view of views) {
    for (const periodo of view.periods) {
      const lista = porData.get(periodo.date) ?? [];
      lista.push(periodo);
      porData.set(periodo.date, lista);
    }
  }
  return [...porData.entries()]
    .map(([date, entradas]) => {
      const entidadesPorTipo = new Map<string, { rotulo: string; entidades: number }>();
      for (const entrada of entradas) {
        for (const tipo of entrada.tipos) {
          const atual = entidadesPorTipo.get(tipo.code);
          if (atual) atual.entidades += tipo.entidades;
          else entidadesPorTipo.set(tipo.code, { rotulo: tipo.rotulo, entidades: tipo.entidades });
        }
      }
      return {
        date,
        label: entradas[0].label,
        series: [...new Set(entradas.flatMap((e) => e.series))],
        tipos: [...entidadesPorTipo.entries()].map(([code, t]) => ({ code, ...t })),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * O contexto sintético da Visão Geral.
 *
 * `scopeHash` vazio é a afirmação de que **não há** unidade aberta, e não uma
 * unidade sem nome: quem lê `context.scopeHash` para montar um link cai num
 * endereço sem recorte, que é exatamente o que a Visão Geral é. O escopo
 * `UNIDADE` recebe o nome que a tela mostra, porque é dele que sai o rótulo em
 * toda a Auditoria (`nomeDaUnidade`, `Rastro`, o cabeçalho da tabela).
 */
function contextoDaVisaoGeral(leituras: LeituraDaUnidade[], period: string): ContextInfo {
  const unidades = new Set(leituras.map((l) => l.unidade)).size;
  const canais = [...new Set(leituras.map((l) => l.contexto.channel).filter((c) => c !== null))];
  const periodosDisponiveis = [
    ...new Set(leituras.flatMap((l) => l.contexto.periodosDisponiveis)),
  ].sort();

  return {
    scopeHash: "",
    channel: canais.length === 1 ? canais[0] : null,
    operacao: leituras[0].contexto.operacao,
    datasetFamily: leituras[0].contexto.datasetFamily,
    label: `Visão Geral · ${unidades} ${unidades === 1 ? "unidade" : "unidades"}`,
    scopes: [
      {
        scopeType: "UNIDADE",
        code: "",
        name: `Visão Geral · ${unidades} ${unidades === 1 ? "unidade" : "unidades"}`,
      },
    ],
    latestPeriod: period,
    periods: periodosDisponiveis.length,
    periodosDisponiveis,
    periodosNaJanela: periodosDisponiveis.length,
  };
}

/**
 * Monta a `FamiliesView` da Visão Geral a partir das leituras por unidade.
 *
 * `summary` entra pronto — é o mesmo `mergeSummaries` que já alimenta o resto
 * da Visão Geral, e recalculá-lo aqui abriria a porta para dois números com o
 * mesmo nome na mesma resposta.
 */
export function consolidarParametros(
  leituras: LeituraDaUnidade[],
  period: string,
  summary: ExecutiveSummary,
): FamiliesViewConsolidada | null {
  if (leituras.length === 0) return null;

  const views = leituras.map((l) => l.view);

  // ---- grupos, por chave de atributo ---------------------------------------
  const porChave = new Map<string, OrigemDoGrupo[]>();
  for (const leitura of leituras) {
    for (const group of leitura.view.groups) {
      const lista = porChave.get(group.key) ?? [];
      lista.push({
        unidade: leitura.unidade,
        label: leitura.label,
        scopeHash: leitura.contexto.scopeHash,
        channel: leitura.contexto.channel,
        group,
      });
      porChave.set(group.key, lista);
    }
  }
  const grupos = [...porChave.values()].map((origens) =>
    comRotuloDoSelo(mesclarGrupos(origens), origens),
  );

  // ---- árvore de famílias --------------------------------------------------
  const gruposPorParametro = new Map<string, GrupoConsolidado[]>();
  for (const grupo of grupos) {
    const chave = placementOf(grupo.attributeCode).parameterKey;
    const lista = gruposPorParametro.get(chave) ?? [];
    lista.push(grupo);
    gruposPorParametro.set(chave, lista);
  }

  /* Os parâmetros de cada unidade, para herdar o que a árvore já sabia — nome,
     aviso de pendência — sem redescobri-lo a partir da chave. */
  const parametrosDasUnidades = new Map<string, ParameterView[]>();
  for (const view of views) {
    for (const familia of view.families) {
      for (const parametro of familia.parameters) {
        const lista = parametrosDasUnidades.get(parametro.key) ?? [];
        lista.push(parametro);
        parametrosDasUnidades.set(parametro.key, lista);
      }
    }
  }

  const families: FamilyView[] = [];
  for (const code of FAMILY_ORDER) {
    const definition = FAMILIES[code];
    const chaves = [...gruposPorParametro.keys()].filter((k) => k.startsWith(`${code}|`));
    const daFamilia = views.map((v) => v.families.find((f) => f.code === code));
    const parametersWithData = Math.max(0, ...daFamilia.map((f) => f?.parametersWithData ?? 0));
    if (chaves.length === 0 && parametersWithData === 0) continue;

    const parameters: ParameterView[] = chaves.map((chave) => {
      const gruposDoParametro = gruposPorParametro.get(chave) ?? [];
      const originais = parametrosDasUnidades.get(chave) ?? [];
      return {
        key: chave,
        name: originais[0]?.name ?? chave.split("|").slice(1).join("|"),
        family: code,
        pending: originais[0]?.pending ?? placementOf(gruposDoParametro[0]?.attributeCode ?? null).pending,
        changes: gruposDoParametro.reduce((s, g) => s + g.changes, 0),
        // União, nunca soma: o mesmo ativo aparece em vários atributos do
        // mesmo parâmetro, e em unidades diferentes ele é o mesmo `entity.id`.
        vehicles: new Set(gruposDoParametro.flatMap((g) => g.entityIds)).size,
        impact:
          originais.length > 0
            ? somarResumos(originais.map((p) => p.impact as ResumoDeImpacto))
            : resumoVazio(),
        groups: gruposDoParametro,
      };
    });

    const gruposDaFamilia = parameters.flatMap((p) => p.groups as GrupoConsolidado[]);
    families.push({
      code,
      name: definition.name,
      origin: definition.origin,
      note: definition.note,
      parametersWithData,
      parametersChanged: parameters.length,
      changes: parameters.reduce((s, p) => s + p.changes, 0),
      vehicles: new Set(gruposDaFamilia.flatMap((g) => g.entityIds)).size,
      impact: somarResumos(
        daFamilia
          .filter((f): f is FamilyView => f !== undefined)
          .map((f) => f.impact as ResumoDeImpacto),
      ),
      critical: gruposDaFamilia.filter((g) => g.badge === "DINHEIRO" || g.badge === "RUPTURA")
        .length,
      locked: gruposDaFamilia.filter((g) => g.badge === "TRAVADO").length,
      parameters,
    });
  }

  // ---- o corpo da leitura --------------------------------------------------
  const entityIdsTouched = [...new Set(views.flatMap((v) => v.entityIdsTouched))];
  const impact = somarResumos(views.map((v) => v.impact as ResumoDeImpacto));
  const series = mesclarSeries(views);
  const periodLabel = views[0].periodLabel;

  const totals = {
    changes: views.reduce((s, v) => s + v.totals.changes, 0),
    formatOnlyChanges: views.reduce((s, v) => s + v.totals.formatOnlyChanges, 0),
    groups: grupos.length,
    // Contagem de ativos distintos, e por isso a união — a mesma razão pela
    // qual `entityIdsTouched` existe. Somar daria mais caminhões que a frota.
    vehiclesTouched: entityIdsTouched.length,
    entitiesAdded: views.reduce((s, v) => s + v.totals.entitiesAdded, 0),
    entitiesRemoved: views.reduce((s, v) => s + v.totals.entitiesRemoved, 0),
    unchanged: views.reduce((s, v) => s + v.totals.unchanged, 0),
    inconclusive: views.reduce((s, v) => s + v.totals.inconclusive, 0),
  };

  const accumulated = {
    ...somarResumos(views.map((v) => v.accumulated as ResumoDeImpacto)),
    comparisons: views.reduce((s, v) => s + v.accumulated.comparisons, 0),
    from: views.map((v) => v.accumulated.from).filter((d): d is string => d !== null).sort()[0] ?? null,
    to:
      views
        .map((v) => v.accumulated.to)
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null,
  };

  /*
    Três estados, e a soma preserva os três. Uma unidade com alteração faz o
    consolidado ter alteração; sem nenhuma alteração em lugar nenhum, a
    diferença entre "nada mudou" e "ninguém calculou" continua importando — e
    ela só é `SEM_ALTERACOES` quando **toda** unidade foi de fato comparada.
  */
  const comparacao: EstadoDaComparacao = views.some((v) => v.comparacao === "COM_ALTERACOES")
    ? "COM_ALTERACOES"
    : views.every((v) => v.comparacao === "SEM_ALTERACOES")
      ? "SEM_ALTERACOES"
      : "NAO_MATERIALIZADA";

  const corpo = {
    context: contextoDaVisaoGeral(leituras, period),
    // Não há "outras unidades" para onde ir a partir de todas elas.
    otherContexts: [],
    period,
    periodLabel,
    periods: mesclarPeriodos(views),
    composicao: mesclarComposicao(views),
    series,
    missingSeries: [...new Set(views.flatMap((v) => v.missingSeries))],
    complete: views.every((v) => v.complete),
    comparacao,
    totals,
    entityIdsTouched,
    impact,
    accumulated,
    groups: grupos,
  };

  return {
    ...corpo,
    freightechSemDado: FREIGHTECH_SEM_DADO,
    // O cockpit é projeção pura sobre o que já está acima — refazê-lo com o
    // construtor de sempre é o que garante que a fila da Visão Geral obedeça à
    // mesma régua da fila de uma unidade, em vez de a uma segunda redação.
    cockpit: buildCockpit(corpo),
    summary,
    families,
    visaoGeral: {
      unidades: new Set(leituras.map((l) => l.unidade)).size,
      contextos: leituras.map((l) => ({
        unidade: l.unidade,
        label: l.label,
        scopeHash: l.contexto.scopeHash,
        channel: l.contexto.channel,
      })),
    },
  };
}
