import { equipmentLabel } from "./labels";
import type { Badge, ChangeGroup, GroupedSeries, GroupedView, ImpactSummary } from "./grouped";

/**
 * O cockpit da vigência — a leitura executiva sobre os grupos que já existem.
 *
 * Este módulo **não** compara nada, **não** consulta o banco e **não**
 * reclassifica atributo nenhum. Ele é uma projeção pura sobre o que
 * `getGroupedView` já apurou: recebe grupos e totais, devolve a ordem de
 * investigação, a composição do risco e a frase que descreve a vigência.
 *
 * Ser puro é o que permite testá-lo sem banco, e é também o que impede o pior
 * defeito possível aqui: um painel bonito cujo número não corresponde à lista
 * que ele encima. Nada abaixo inventa contagem — cada campo é uma soma, uma
 * contagem ou uma classificação determinística sobre campos que já vinham na
 * resposta.
 *
 * Três recusas herdadas continuam valendo, e uma nova entra:
 *
 * 1. **Nunca somar periodicidades.** O impacto continua por periodicidade.
 * 2. **Nunca converter "não calculável" em zero.** São campos diferentes,
 *    contados em lugares diferentes, e a tela é obrigada a dizer os dois.
 * 3. **Nunca confundir alteração, ponto e veículo.** Os três aparecem com nome
 *    próprio em `kpis`, e há teste para cada um.
 * 4. **Nenhum score oculto.** A prioridade é um número, e o número vem com a
 *    lista de motivos que o formaram — ver `PriorityItem.reasons`.
 */

// ---------------------------------------------------------------------------
// Criticidade — a proposta, escrita
// ---------------------------------------------------------------------------

/**
 * A criticidade **não existia** no domínio antes deste módulo.
 *
 * O que existia era o selo (`badge`), que responde *que tipo de sinal é este*,
 * e a abrangência (`coverage`), que responde *em quanto da frota*. Nenhum dos
 * dois ordena a fila de trabalho de quem abre a tela: "Ruptura" não diz se vem
 * antes de "Dinheiro", e 100% da frota num atributo sem preço não se compara
 * sozinho a 5 veículos que custam R$ 17 mil por mês.
 *
 * A criticidade é essa composição, e ela é deliberadamente **aditiva e
 * explicável**: cada critério vale pontos, cada ponto atribuído vira uma frase
 * em `reasons`, e a tela pode mostrar a conta inteira. Não há multiplicação,
 * não há peso escondido, não há normalização — um score que ninguém consegue
 * refazer de cabeça é indistinguível de um palpite.
 *
 * | critério | pontos | por quê |
 * | --- | --- | --- |
 * | selo RUPTURA | 35 | o valor trocou de estado, não apenas de tamanho |
 * | natureza dura (zerou, sumiu, mudou de tipo…) | 10 | dentro da ruptura, estas são as que quebram a série |
 * | anomalia de formato | 10 | há indício de que a fonte mudou a forma do dado |
 * | impacto financeiro apurado | 35 | é dinheiro medido, com célula de origem |
 * | valor apurado e fora do total (dupla contagem) | 20 | é dinheiro real, mas já contado nas parcelas |
 * | abrangência TOTAL | 30 | atinge a frota inteira |
 * | abrangência MAIORIA | 18 | atinge mais da metade |
 * | abrangência PARCIAL | fatia × 20 | proporcional, sem degrau artificial |
 * | variação ≥ 100% / ≥ 50% / ≥ 20% | 20 / 12 / 6 | magnitude do movimento |
 * | preço travado (monetário sem semântica confirmada) | 5 | há dinheiro atrás, e ele não pôde ser apurado |
 *
 * Uma exceção, e ela **substitui** a tabela em vez de somar-se a ela: um grupo
 * de troca de formato pura (`ChangeGroup.formatOnly`) vale 5 pontos fixos. Ver
 * `scoreGroup` para o porquê — em resumo, nenhum critério acima descreve algo
 * que aconteceu com o valor, porque o valor não mudou.
 *
 * Os cortes: **≥ 70 crítico, ≥ 45 alto, ≥ 25 médio, abaixo disso baixo.** Eles
 * são convenção, e é por isso que o score e os motivos viajam junto na
 * resposta: quem discordar do corte consegue ver exatamente o que o produziu.
 *
 * O que a criticidade **não** faz: filtrar. Todo grupo recebe uma, todo grupo
 * continua na lista, e "baixo" nunca é sinônimo de escondido.
 */
export type Severity = "CRITICO" | "ALTO" | "MEDIO" | "BAIXO";

export const SEVERITY_ORDER: Severity[] = ["CRITICO", "ALTO", "MEDIO", "BAIXO"];

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICO: "Crítico",
  ALTO: "Alto",
  MEDIO: "Médio",
  BAIXO: "Baixo",
};

/** Os cortes do score. Ficam exportados porque o teste afere por eles. */
export const SEVERITY_THRESHOLDS: { severity: Severity; from: number }[] = [
  { severity: "CRITICO", from: 70 },
  { severity: "ALTO", from: 45 },
  { severity: "MEDIO", from: 25 },
  { severity: "BAIXO", from: 0 },
];

/** Naturezas que quebram a série do valor — as mesmas que o selo já usa. */
const HARD_NATURES = new Set([
  "ZEROING",
  "FROM_ZERO",
  "TYPE_CHANGE",
  "APPEARED",
  "DISAPPEARED",
  "NULL_REASON",
  "SEMANTICS_DRIFT",
]);

export interface PriorityReason {
  /** A frase que a tela mostra: "atinge toda a frota". */
  label: string;
  points: number;
}

export interface PriorityItem {
  /** Posição na fila, 1-based. */
  rank: number;
  /** A chave do grupo — a mesma de `ChangeGroup.key`. */
  key: string;
  severity: Severity;
  score: number;
  reasons: PriorityReason[];
  /** O que aconteceu, em uma frase, sem jargão de banco. */
  diagnosis: string;
  /**
   * Os padrões do grupo ditos em português, ou `null` quando há um só.
   *
   * "2 padrões antes → depois distintos" é a informação certa na camada
   * errada. Aqui ela vira "Encontramos 2 comportamentos diferentes; 54 dos 62
   * cavalos seguem o mesmo".
   */
  patternsSummary: string | null;
  /** Abrangência já em linguagem de painel. */
  sharePercent: number | null;
  shareLabel: string;
  /** Se este ponto tem dinheiro apurado — a tela nunca deduz isto sozinha. */
  hasImpact: boolean;
  /** Se há indício de troca de formato. */
  hasAnomaly: boolean;
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** A magnitude do movimento do grupo, em pontos percentuais absolutos. */
function movementOf(group: ChangeGroup): number | null {
  const { deltaPercent, minPercent, maxPercent } = group.aggregate;
  if (deltaPercent !== null) return Math.abs(deltaPercent);
  if (minPercent === null && maxPercent === null) return null;
  return Math.max(Math.abs(minPercent ?? 0), Math.abs(maxPercent ?? 0));
}

/** A fatia da frota atingida, de 0 a 1, ou `null` quando a frota é desconhecida. */
export function shareOf(group: ChangeGroup): number | null {
  if (group.fleet <= 0) return null;
  return Math.min(group.vehicles / group.fleet, 1);
}

/**
 * Quanto vale uma troca de formato pura.
 *
 * Baixo por definição — mas não zero: zero produziria um item sem nenhum motivo
 * escrito, e um score sem motivo é o palpite que este módulo recusa.
 */
export const FORMAT_ONLY_SCORE = 5;

/**
 * O score de um grupo e a conta que o produziu.
 *
 * Determinístico: mesma entrada, mesmo número, mesma lista de motivos. Nenhum
 * critério depende de outro grupo — ordenar não pode mudar o valor de ninguém.
 */
export function scoreGroup(group: ChangeGroup): {
  score: number;
  reasons: PriorityReason[];
} {
  /*
    A troca de formato pura sai antes da tabela porque nenhuma parcela dela
    descreve o que aconteceu aqui. "Ruptura no valor" mede o valor trocando de
    estado, e o valor é o mesmo instante dos dois lados; "atinge toda a frota"
    mede o alcance de uma mudança que não houve; "indício de troca de formato"
    somava mais 10 por confirmar justamente que não era mudança contratual.
    Somadas, davam 85 pontos ao `data_fim_contrato` de agosto/2026 — primeiro
    lugar da fila, acima do IPVA que custou R$ 145 mil de verdade.

    Continua na fila, com motivo escrito e posição no fim. Ser irrelevante para
    o risco não é ser inexistente: quem cuida da importação precisa saber que a
    fonte mudou o jeito de exportar a coluna.
  */
  if (group.formatOnly) {
    return {
      score: FORMAT_ONLY_SCORE,
      reasons: [
        {
          label: "troca de formato na fonte, sem mudança de valor",
          points: FORMAT_ONLY_SCORE,
        },
      ],
    };
  }

  const reasons: PriorityReason[] = [];
  const add = (label: string, points: number) => {
    if (points > 0) reasons.push({ label, points });
  };

  if (group.badge === "RUPTURA") add("ruptura no valor", 35);
  if (group.natureCodes.some((n) => HARD_NATURES.has(n))) {
    add("o valor trocou de estado (zerou, sumiu ou mudou de tipo)", 10);
  }
  if (group.anomalies.length > 0) add("indício de troca de formato", 10);

  if (group.impact.amount !== null && group.impact.amount !== 0) {
    add("impacto financeiro apurado", 35);
  } else if (group.impact.excludedVehicles > 0) {
    add("valor apurado, já contado nas parcelas", 20);
  }

  const share = shareOf(group);
  if (group.coverage === "TOTAL") add("atinge toda a frota", 30);
  else if (group.coverage === "MAIORIA") add("atinge a maioria da frota", 18);
  else if (share !== null) {
    add(`atinge ${Math.round(share * 100)}% da frota`, Math.round(share * 20));
  }

  const movement = movementOf(group);
  if (movement !== null) {
    if (movement >= 100) add("variação de 100% ou mais", 20);
    else if (movement >= 50) add("variação de 50% ou mais", 12);
    else if (movement >= 20) add("variação de 20% ou mais", 6);
  }

  if (group.badge === "TRAVADO") add("é dinheiro e o preço está travado", 5);

  return { score: reasons.reduce((total, r) => total + r.points, 0), reasons };
}

export function severityOf(score: number): Severity {
  return (
    SEVERITY_THRESHOLDS.find((t) => score >= t.from)?.severity ?? "BAIXO"
  );
}

// ---------------------------------------------------------------------------
// Diagnóstico — a primeira camada, em português
// ---------------------------------------------------------------------------

const pt = (value: number) => value.toLocaleString("pt-BR");

function percent(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * O substantivo do equipamento — e o gênero dele.
 *
 * O gênero não é enfeite gramatical: sem ele, `summarisePatterns` escrevia
 * "3 dos 10 carretas" na investigação de uma frota inteira de carretas. Quem
 * lê um diagnóstico que erra a concordância na primeira frase passa a conferir
 * o resto com desconfiança — e o resto, aqui, é a conta que ordena a fila.
 */
const SUBSTANTIVOS: Record<
  string,
  { singular: string; plural: string; feminino: boolean }
> = {
  CAVALO: { singular: "cavalo", plural: "cavalos", feminino: false },
  CARRETA: { singular: "carreta", plural: "carretas", feminino: true },
};

const SUBSTANTIVO_PADRAO = {
  singular: "veículo",
  plural: "veículos",
  feminino: false,
};

function substantivoDe(entityType: string | null) {
  return SUBSTANTIVOS[entityType ?? ""] ?? SUBSTANTIVO_PADRAO;
}

function vehicleNoun(entityType: string | null, count: number): string {
  const s = substantivoDe(entityType);
  return count === 1 ? s.singular : s.plural;
}

/**
 * O que aconteceu neste ponto, em uma frase.
 *
 * A ordem das regras é a ordem da notícia: primeiro o que desmente uma leitura
 * alarmante (troca de formato), depois o que quebra a série (zerou, sumiu),
 * depois o dinheiro, e por último o movimento numérico. A primeira que casar é
 * a que sai — encadear todas produziria um parágrafo, e parágrafo não é
 * diagnóstico.
 *
 * **Nada aqui afirma o que é apenas indício.** A frase de formato diz
 * "aparenta", "indício", "compatível com", porque é isso o que o detector
 * sustenta: um número na faixa de serial do Excel do lado de uma data.
 */
export function diagnose(group: ChangeGroup): string {
  const noun = vehicleNoun(group.entityType, group.vehicles);
  const veiculos = `${pt(group.vehicles)} ${noun}`;

  /*
    Quando o grupo é troca de formato pura, a frase afirma — e isso não
    contradiz a regra de "nada aqui afirma o que é apenas indício" logo acima,
    porque aqui não é indício. Cada linha foi conferida: o número, lido como
    serial do Excel, cai no mesmo instante da data do outro lado, ao
    milissegundo. Coincidência dessa ordem não acontece por acaso em 62 linhas.
    Hesitar aqui teria o custo oposto ao que a hesitação protege: manda alguém
    conferir 62 contratos que não mudaram.
  */
  if (group.formatOnly) {
    const ehPrecisaoDeData = group.anomalies.every(
      (a) => a.kind === "DATA_HORA_COMO_SOMENTE_DATA" || a.kind === "SOMENTE_DATA_COMO_DATA_HORA",
    );

    /*
      Grupo cujo formato mudou de data-e-hora para só-data (ou o inverso) — o
      gêmeo do caso do serial, só que os dois lados já são datas. Aqui não faz
      sentido falar em "mesmo instante" nem em fração de segundo: o que se
      perdeu foi a hora inteira, e o que se preservou foi o dia.
    */
    if (ehPrecisaoDeData) {
      const direcao = group.anomalies.every((a) => a.kind === "DATA_HORA_COMO_SOMENTE_DATA")
        ? "deixou de vir com hora e passou a vir só com a data"
        : "deixou de vir só com a data e passou a vir com hora";
      return (
        `A coluna ${direcao} em ${veiculos}, e os dois lados continuam no mesmo dia. A hora que ` +
        `um dos dois lados não guarda é o que o formato date-only não representa, não uma data ` +
        `nova. Mudou o formato do arquivo, não o contrato: não há aqui alteração contratual a ` +
        `cobrar do cliente.`
      );
    }

    const precision = group.anomalies
      .filter((a) => !a.sameInstant)
      .reduce((total, a) => total + a.vehicles, 0);
    const direcao = group.anomalies.every((a) => a.kind === "SERIAL_EXCEL_COMO_DATA")
      ? "deixou de vir como número e passou a vir como data"
      : "deixou de vir como data e passou a vir como número";
    const ressalva =
      precision > 0
        ? ` Em ${pt(precision)}, os dois lados diferem por menos de um segundo — é a fração ` +
          `de segundo que um serial do Excel não representa, e não uma data nova.`
        : "";
    return (
      `A coluna ${direcao} em ${veiculos}, e os dois lados são o mesmo ` +
      `instante.${ressalva} Mudou o formato do arquivo, não o contrato: não há aqui ` +
      `alteração contratual a cobrar do cliente.`
    );
  }

  /*
    Grupo misto: parte é formato, parte é data que mudou de verdade. Aqui a
    hesitação é a leitura correta, porque a frase precisa cobrir as duas coisas
    ao mesmo tempo — e a parte que sobra é justamente a que alguém tem de abrir.
  */
  if (group.anomalies.length > 0) {
    const formatVehicles = group.anomalies
      .filter((a) => a.formatOnly)
      .reduce((total, a) => total + a.vehicles, 0);
    const driftVehicles = group.anomalies
      .filter((a) => !a.formatOnly)
      .reduce((total, a) => total + a.vehicles, 0);
    const ehPrecisaoDeData = group.anomalies.every(
      (a) => a.kind === "DATA_HORA_COMO_SOMENTE_DATA" || a.kind === "SOMENTE_DATA_COMO_DATA_HORA",
    );
    const base = ehPrecisaoDeData
      ? `A coluna mudou de precisão em ${veiculos}: um lado tem hora, o outro só tem a data. ` +
        `A hora que falta é indício de mudança de formato no arquivo e não necessariamente de ` +
        `alteração contratual.`
      : `O valor deixou de vir como data e passou a vir como número em ${veiculos}. ` +
        `O número é compatível com o formato serial que o Excel usa para datas, ` +
        `o que é indício de mudança de formato no arquivo e não necessariamente ` +
        `de alteração contratual.`;
    if (formatVehicles > 0 && driftVehicles > 0) {
      const detalhe = ehPrecisaoDeData
        ? `Em ${pt(formatVehicles)}, é o mesmo dia da data anterior; ` +
          `em ${pt(driftVehicles)} o dia por trás dele é outro, e é essa parte que ` +
          `precisa ser conferida.`
        : `Em ${pt(formatVehicles)}, o número é o mesmo instante da data anterior; ` +
          `em ${pt(driftVehicles)} a data por trás dele é outra, e é essa parte que ` +
          `precisa ser conferida.`;
      return `${base} ${detalhe}`;
    }
    return base;
  }

  /*
    A contagem é **da natureza**, não do grupo.

    Dizer "saiu de zero em 4 carretas" porque o grupo tem 4 carretas e uma
    delas saiu de zero é afirmar um fato que o banco desmente — foi o que
    aconteceu com `lucro_variavel_previsto` em 02/08/2026, onde só 2 das 4
    saíram de zero. `ativosPorNatureza` traz o número certo; quando ele não
    cobre o grupo inteiro, a frase diz isso, porque o resto do grupo mudou
    de outro jeito e quem investiga precisa saber.
  */
  const quantosDe = (codigo: string): number =>
    group.ativosPorNatureza?.[codigo] ?? group.vehicles;
  const comSubstantivo = (quantos: number): string =>
    `${pt(quantos)} ${vehicleNoun(group.entityType, quantos)}`;
  const daNatureza = (codigo: string): string => comSubstantivo(quantosDe(codigo));
  const ressalva = (codigo: string): string => {
    const resto = group.vehicles - quantosDe(codigo);
    return resto > 0 ? ` Os demais ${comSubstantivo(resto)} do grupo mudaram de outra forma.` : "";
  };

  if (group.natureCodes.includes("ZEROING")) {
    return `O valor foi zerado em ${daNatureza("ZEROING")} nesta vigência.${ressalva("ZEROING")}`;
  }
  if (group.natureCodes.includes("FROM_ZERO")) {
    return `O valor saiu de zero em ${daNatureza("FROM_ZERO")} nesta vigência.${ressalva("FROM_ZERO")}`;
  }
  if (group.natureCodes.includes("DISAPPEARED")) {
    return `O valor deixou de existir em ${daNatureza("DISAPPEARED")}.${ressalva("DISAPPEARED")}`;
  }
  if (group.natureCodes.includes("APPEARED")) {
    return `O valor passou a existir em ${daNatureza("APPEARED")}.${ressalva("APPEARED")}`;
  }
  if (group.natureCodes.includes("TYPE_CHANGE")) {
    return `O tipo do valor mudou em ${veiculos} — a fonte passou a entregar outra forma de dado.`;
  }
  if (group.comparability === "INCONCLUSIVE") {
    return (
      group.inconclusiveReason ??
      `A comparação de ${veiculos} ficou inconclusiva, e o motivo está no detalhe.`
    );
  }

  const movement = movementOf(group);
  const a = group.aggregate;
  if (a.summable && a.totalBefore !== null && a.totalAfter !== null) {
    const delta = a.deltaPercent === null ? "" : ` (${percent(a.deltaPercent)})`;
    return `O total da frota foi de ${pt(a.totalBefore)} para ${pt(a.totalAfter)}${delta}, em ${veiculos}.`;
  }
  if (a.minPercent !== null && a.maxPercent !== null) {
    return a.minPercent === a.maxPercent
      ? `Variação de ${percent(a.minPercent)} por veículo, em ${veiculos}.`
      : `Variação de ${percent(a.minPercent)} a ${percent(a.maxPercent)} por veículo, em ${veiculos}.`;
  }
  if (movement !== null) {
    return `Movimento de ${percent(movement)} em ${veiculos}.`;
  }
  return `Alteração registrada em ${veiculos}, sem variação numérica a comparar.`;
}

/** "Encontramos 2 comportamentos diferentes; 54 dos 62 cavalos seguem o mesmo." */
export function summarisePatterns(group: ChangeGroup): string | null {
  if (group.patterns <= 1) return null;
  const noun = vehicleNoun(group.entityType, group.vehicles);
  const de = substantivoDe(group.entityType).feminino ? "das" : "dos";
  const base = `Encontramos ${pt(group.patterns)} comportamentos diferentes nesta alteração`;
  if (!group.dominantPattern) return `${base}.`;
  return (
    `${base}; ${pt(group.dominantPattern.vehicles)} ${de} ${pt(group.vehicles)} ${noun} ` +
    `seguem o mesmo padrão.`
  );
}

// ---------------------------------------------------------------------------
// Panorama
// ---------------------------------------------------------------------------

export interface SeverityBucket {
  severity: Severity;
  label: string;
  /** Pontos da remuneração nesta criticidade. */
  groups: number;
  /** Linhas de alteração nesses pontos. */
  changes: number;
}

export interface BadgeBucket {
  badge: Badge;
  label: string;
  groups: number;
  changes: number;
}

export interface EquipmentBucket {
  entityType: string | null;
  equipment: string;
  groups: number;
  changes: number;
  /**
   * A frota da série na vigência nova, quando esta vigência a trouxe.
   *
   * Não há contagem de "veículos deste equipamento" neste bloco de propósito:
   * somar os veículos dos grupos contaria o mesmo caminhão uma vez por
   * parâmetro em que ele mudou. O número honesto de ativos distintos é
   * `kpis.vehicles`, e ele é da vigência inteira.
   */
  fleet: number | null;
}

export interface PricingSummary {
  /** Alterações com valor apurado que **entram** no total. */
  calculatedChanges: number;
  /** Apuradas e deixadas de fora por já estarem contadas nas parcelas. */
  excludedChanges: number;
  /** Sem preço — nunca zero, nunca somadas com as de cima. */
  notCalculableChanges: number;
  /** Pontos monetários cuja semântica ainda trava o preço. */
  lockedGroups: number;
  /** Por que não há preço, agrupado pelo motivo que o motor registrou. */
  reasons: { reason: string; groups: number; changes: number }[];
}

export interface CockpitPanorama {
  bySeverity: SeverityBucket[];
  byBadge: BadgeBucket[];
  byEquipment: EquipmentBucket[];
  pricing: PricingSummary;
}

export interface CockpitKpis {
  /** Linhas de alteração — uma por (veículo, parâmetro). */
  changes: number;
  /** Pontos da remuneração tocados — os grupos. */
  parameters: number;
  /** Pontos classificados como crítico ou alto. */
  attention: number;
  /** Ativos distintos com alguma alteração. */
  vehicles: number;
  /** A frota das séries que esta vigência trouxe. */
  fleet: number;
  impact: ImpactSummary;
  /** Se alguma periodicidade tem valor apurado nesta vigência. */
  hasImpact: boolean;
  /**
   * Os pontos com indício de troca de formato, e dentro deles os que são **só**
   * isso.
   *
   * Os dois números viajam juntos porque respondem perguntas diferentes:
   * `groups` é "onde a fonte mexeu no formato" — trabalho de quem cuida da
   * importação —, e `formatOnlyGroups` é "onde isso não é alteração nenhuma".
   * A diferença entre eles é o que tem formato **e** mudança de valor na mesma
   * célula, que é o caso que ninguém pode arquivar sem abrir.
   */
  anomalies: {
    groups: number;
    changes: number;
    formatOnlyGroups: number;
    formatOnlyChanges: number;
  };
}

export interface CockpitNarrative {
  headline: string;
  sentences: string[];
}

export interface CockpitHistory {
  comparisons: number;
  from: string | null;
  to: string | null;
  byPeriodicity: Record<string, number>;
  /**
   * Se há histórico suficiente para a leitura ser dita.
   *
   * Uma comparação só é a própria vigência com outro nome; mostrar "acumulado"
   * ali é repetir o mesmo número com um rótulo que promete outra coisa.
   */
  sufficient: boolean;
}

export interface CockpitBaseline {
  /** Se ao menos uma série desta vigência tem vigência anterior para comparar. */
  hasBaseline: boolean;
  /** Séries que chegaram sem anterior — nomeadas, nunca contadas como zero. */
  seriesWithoutBaseline: string[];
}

export interface CockpitView {
  kpis: CockpitKpis;
  /**
   * Se esta vigência tem contra o que ser comparada.
   *
   * Sem isto, "zero alterações" tem duas causas com significados opostos:
   * *nada mudou* e *não há anterior com que comparar*. A primeira é uma boa
   * notícia; a segunda não é notícia nenhuma — e apresentá-las com a mesma
   * frase é o tipo de silêncio que faz alguém concluir que a vigência está
   * limpa quando ela sequer foi comparada.
   */
  baseline: CockpitBaseline;
  narrative: CockpitNarrative;
  panorama: CockpitPanorama;
  /** A fila de investigação, na ordem em que deve ser atacada. */
  priorities: PriorityItem[];
  history: CockpitHistory;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export type CockpitInput = Pick<
  GroupedView,
  "groups" | "totals" | "impact" | "accumulated" | "series" | "periodLabel"
>;

/**
 * A ordem da fila.
 *
 * Score primeiro; empate resolvido por veículos, depois por valor absoluto do
 * impacto, depois pela chave — que é estável e única. Nenhum desempate depende
 * da ordem em que o Postgres devolveu as linhas: uma tela de auditoria que
 * troca de primeiro colocado a cada recarga não é uma tela de auditoria.
 */
export function comparePriorities(
  a: { score: number; group: ChangeGroup },
  b: { score: number; group: ChangeGroup },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.group.vehicles !== a.group.vehicles) return b.group.vehicles - a.group.vehicles;
  const impact = Math.abs(b.group.impact.amount ?? 0) - Math.abs(a.group.impact.amount ?? 0);
  if (impact !== 0) return impact;
  return a.group.key.localeCompare(b.group.key);
}

function fleetOf(series: GroupedSeries[], entityType: string | null): number | null {
  const match = series.find((s) => s.entityTypeSet === entityType);
  return match ? match.fleet : null;
}

function buildPricing(groups: ChangeGroup[], impact: ImpactSummary): PricingSummary {
  const reasons = new Map<string, { groups: number; changes: number }>();
  let lockedGroups = 0;
  for (const group of groups) {
    if (group.badge === "TRAVADO") lockedGroups++;
    if (group.impact.amount !== null && group.impact.amount !== 0) continue;
    const reason = group.impact.reason;
    if (!reason) continue;
    const entry = reasons.get(reason) ?? { groups: 0, changes: 0 };
    entry.groups++;
    entry.changes += group.changes;
    reasons.set(reason, entry);
  }
  return {
    calculatedChanges: impact.calculatedChanges - impact.excludedChanges,
    excludedChanges: impact.excludedChanges,
    notCalculableChanges: impact.notCalculable,
    lockedGroups,
    reasons: [...reasons.entries()]
      .map(([reason, counts]) => ({ reason, ...counts }))
      // Determinístico: o motivo que explica mais alterações primeiro, e o
      // texto como desempate — nunca a ordem de inserção do Map.
      .sort((a, b) => b.changes - a.changes || a.reason.localeCompare(b.reason)),
  };
}

/**
 * A frase da vigência, montada por regra.
 *
 * **Nada aqui é gerado por modelo.** É composição determinística sobre as
 * contagens que já existem; o mesmo conjunto de números produz sempre o mesmo
 * texto, e é por isso que ele pode ser testado.
 *
 * A regra de tom, que é a razão desta função existir: **o risco encontrado é o
 * protagonista, e a ausência de preço é contexto dele.** "Nenhum valor
 * apurável" no lugar mais nobre da tela dizia que o produto não conseguiu fazer
 * nada, quando ele acabara de encontrar 244 alterações em 15 pontos.
 */
export function narrate(input: {
  periodLabel: string;
  totals: CockpitInput["totals"];
  kpis: Pick<CockpitKpis, "attention" | "vehicles" | "anomalies" | "impact" | "hasImpact">;
  bySeverity: SeverityBucket[];
  pricing: PricingSummary;
  baseline: CockpitBaseline;
}): CockpitNarrative {
  const { periodLabel, totals, kpis, bySeverity, pricing, baseline } = input;
  const period = periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1);
  const critical = bySeverity.find((b) => b.severity === "CRITICO")?.groups ?? 0;
  const high = bySeverity.find((b) => b.severity === "ALTO")?.groups ?? 0;

  if (!baseline.hasBaseline) {
    return {
      headline: `${period} é a primeira vigência disponível.`,
      sentences: [
        `Ainda não existe vigência anterior com que comparar ${listar(
          baseline.seriesWithoutBaseline.map((s) => s.toLowerCase()),
        )}.`,
        "Nada nesta tela está contado como zero: a comparação passa a existir quando a próxima vigência for importada.",
      ],
    };
  }

  if (totals.changes === 0) {
    return {
      headline: `${period} não teve alterações.`,
      sentences: [
        "Nenhum valor mudou entre esta vigência e a anterior nas séries comparadas.",
      ],
    };
  }

  const headline =
    critical > 0
      ? `${period} exige atenção.`
      : kpis.attention > 0
        ? `${period} tem pontos para revisar.`
        : `${period} não trouxe alterações críticas.`;

  const sentences: string[] = [];

  sentences.push(
    `Foram identificadas ${pt(totals.changes)} ${
      totals.changes === 1 ? "alteração" : "alterações"
    } em ${pt(totals.groups)} ${
      totals.groups === 1 ? "ponto" : "pontos"
    } da remuneração, atingindo ${pt(kpis.vehicles)} ${
      kpis.vehicles === 1 ? "veículo" : "veículos"
    }.`,
  );

  /*
    A ressalva vem colada no total, e não no fim: quem lê "244 alterações"
    precisa saber na frase seguinte que 62 delas são o mesmo valor escrito de
    outro jeito. Dito só lá embaixo, o número grande já teria virado a notícia.
  */
  if (kpis.anomalies.formatOnlyChanges > 0) {
    const c = kpis.anomalies.formatOnlyChanges;
    const g = kpis.anomalies.formatOnlyGroups;
    sentences.push(
      `Destas, ${pt(c)} ${c === 1 ? "está" : "estão"} em ${pt(g)} ${
        g === 1 ? "ponto que apenas trocou" : "pontos que apenas trocaram"
      } de formato no arquivo — o valor dos dois lados é o mesmo, e ${
        c === 1 ? "ela não é alteração contratual" : "elas não são alteração contratual"
      }.`,
    );
  }

  if (kpis.attention > 0) {
    const partes: string[] = [];
    if (critical > 0) partes.push(`${pt(critical)} ${critical === 1 ? "crítico" : "críticos"}`);
    if (high > 0) partes.push(`${pt(high)} ${high === 1 ? "alto" : "altos"}`);
    sentences.push(
      `${pt(kpis.attention)} ${
        kpis.attention === 1 ? "ponto merece" : "pontos merecem"
      } análise prioritária (${partes.join(" e ")}).`,
    );
  } else {
    sentences.push("Nenhum ponto foi classificado como crítico ou alto.");
  }

  if (kpis.hasImpact) {
    const valores = Object.entries(kpis.impact.byPeriodicity)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodicity, amount]) => `${formatBrl(amount)}${suffix(periodicity)}`);
    sentences.push(
      `O impacto financeiro apurado é de ${valores.join(" e ")}` +
        (valores.length > 1 ? " — grandezas diferentes, nunca somadas." : "."),
    );
    if (pricing.notCalculableChanges > 0) {
      sentences.push(
        `Outras ${pt(pricing.notCalculableChanges)} alterações continuam sem impacto ` +
          `financeiro calculado.`,
      );
    }
  } else {
    sentences.push(
      `Nenhuma destas alterações teve impacto financeiro calculado: ` +
        `${pt(pricing.notCalculableChanges)} ${
          pricing.notCalculableChanges === 1 ? "delas não tem" : "delas não têm"
        } regra de precificação suficiente. Isso não as torna menores — apenas ` +
        `não precificadas.`,
    );
  }

  if (pricing.excludedChanges > 0) {
    sentences.push(
      `${pt(pricing.excludedChanges)} ${
        pricing.excludedChanges === 1 ? "alteração ficou" : "alterações ficaram"
      } fora do total por já estarem contadas nas parcelas do mesmo veículo.`,
    );
  }

  // Só os pontos em que formato e valor mudaram juntos. Os de formato puro já
  // foram ditos junto do total, e repeti-los aqui com "pode não ser mudança"
  // devolveria a dúvida que a frase de cima acabou de resolver.
  const mistos = kpis.anomalies.groups - kpis.anomalies.formatOnlyGroups;
  if (mistos > 0) {
    sentences.push(
      `${pt(mistos)} ${
        mistos === 1 ? "ponto apresenta" : "pontos apresentam"
      } troca de formato e mudança de valor na mesma célula — confira o ` +
        `diagnóstico antes de acionar o cliente.`,
    );
  }

  return { headline, sentences };
}

/** `["carreta","cavalo"]` → `carreta e cavalo`. Frase, não lista de banco. */
function listar(itens: string[]): string {
  if (itens.length === 0) return "esta série";
  if (itens.length === 1) return itens[0];
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function suffix(periodicity: string): string {
  const map: Record<string, string> = {
    MENSAL: "/mês",
    ANUAL: "/ano",
    PONTUAL: " (valor único)",
  };
  return map[periodicity] ?? "";
}

/**
 * O cockpit inteiro, a partir da visão agrupada.
 *
 * Uma passada sobre os grupos; nenhuma consulta, nenhum efeito. O custo é
 * proporcional ao número de grupos (dezenas), não ao de alterações (centenas).
 */
export function buildCockpit(view: CockpitInput): CockpitView {
  const scored = view.groups.map((group) => {
    const { score, reasons } = scoreGroup(group);
    return { group, score, reasons };
  });

  const ordered = [...scored].sort(comparePriorities);

  const priorities: PriorityItem[] = ordered.map((entry, index) => {
    const share = shareOf(entry.group);
    return {
      rank: index + 1,
      key: entry.group.key,
      severity: severityOf(entry.score),
      score: entry.score,
      reasons: entry.reasons,
      diagnosis: diagnose(entry.group),
      patternsSummary: summarisePatterns(entry.group),
      sharePercent: share === null ? null : Math.round(share * 1000) / 10,
      shareLabel: entry.group.coverageLabel,
      hasImpact: entry.group.impact.amount !== null && entry.group.impact.amount !== 0,
      hasAnomaly: entry.group.anomalies.length > 0,
    };
  });

  const severityOfKey = new Map(priorities.map((p) => [p.key, p.severity]));

  const bySeverity: SeverityBucket[] = SEVERITY_ORDER.map((severity) => {
    const groups = view.groups.filter((g) => severityOfKey.get(g.key) === severity);
    return {
      severity,
      label: SEVERITY_LABELS[severity],
      groups: groups.length,
      changes: groups.reduce((total, g) => total + g.changes, 0),
    };
  });

  const badgeIndex = new Map<Badge, BadgeBucket>();
  for (const group of view.groups) {
    const entry = badgeIndex.get(group.badge) ?? {
      badge: group.badge,
      label: group.badgeLabel,
      groups: 0,
      changes: 0,
    };
    entry.groups++;
    entry.changes += group.changes;
    badgeIndex.set(group.badge, entry);
  }

  const equipmentIndex = new Map<string, EquipmentBucket>();
  for (const group of view.groups) {
    const key = group.entityType ?? "(sem equipamento)";
    const entry = equipmentIndex.get(key) ?? {
      entityType: group.entityType,
      equipment: equipmentLabel(group.entityType),
      groups: 0,
      changes: 0,
      fleet: fleetOf(view.series, group.entityType),
    };
    entry.groups++;
    entry.changes += group.changes;
    equipmentIndex.set(key, entry);
  }

  const pricing = buildPricing(view.groups, view.impact);

  const anomalyGroups = view.groups.filter((g) => g.anomalies.length > 0);
  const formatOnlyGroups = anomalyGroups.filter((g) => g.formatOnly);
  const kpis: CockpitKpis = {
    changes: view.totals.changes,
    parameters: view.totals.groups,
    attention: bySeverity
      .filter((b) => b.severity === "CRITICO" || b.severity === "ALTO")
      .reduce((total, b) => total + b.groups, 0),
    vehicles: view.totals.vehiclesTouched,
    fleet: view.series.reduce((total, s) => total + s.fleet, 0),
    impact: view.impact,
    hasImpact: Object.keys(view.impact.byPeriodicity).length > 0,
    anomalies: {
      groups: anomalyGroups.length,
      changes: anomalyGroups.reduce(
        (total, g) => total + g.anomalies.reduce((sum, a) => sum + a.vehicles, 0),
        0,
      ),
      formatOnlyGroups: formatOnlyGroups.length,
      formatOnlyChanges: formatOnlyGroups.reduce((total, g) => total + g.changes, 0),
    },
  };

  const baseline: CockpitBaseline = {
    hasBaseline: view.series.some((s) => s.changeSetId !== null),
    seriesWithoutBaseline: view.series
      .filter((s) => s.changeSetId === null)
      .map((s) => s.equipment),
  };

  return {
    kpis,
    baseline,
    narrative: narrate({
      periodLabel: view.periodLabel,
      totals: view.totals,
      kpis,
      bySeverity,
      pricing,
      baseline,
    }),
    panorama: {
      bySeverity,
      byBadge: [...badgeIndex.values()].sort(
        (a, b) => b.groups - a.groups || a.badge.localeCompare(b.badge),
      ),
      byEquipment: [...equipmentIndex.values()].sort(
        (a, b) => b.changes - a.changes || a.equipment.localeCompare(b.equipment),
      ),
      pricing,
    },
    priorities,
    history: {
      comparisons: view.accumulated.comparisons,
      from: view.accumulated.from,
      to: view.accumulated.to,
      byPeriodicity: view.accumulated.byPeriodicity,
      sufficient:
        view.accumulated.comparisons > 1 &&
        Object.keys(view.accumulated.byPeriodicity).length > 0,
    },
  };
}
