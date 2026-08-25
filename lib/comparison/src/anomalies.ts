import {
  excelSerialToDate,
  isPlausibleDateSerial,
  toIsoDate,
  toIsoDateTime,
} from "@workspace/ingest/excel-dates";

/**
 * Anomalias de formato — quando a fonte troca a **forma** do valor, e não o valor.
 *
 * O caso que forçou este módulo: em Ago/2026, `cavalo.data_fim_contrato` deixou
 * de vir como data e passou a vir como número em todos os 62 cavalos —
 * `2028-07-01T12:00:00.000Z` virou `46935.5`. O motor classificou as 62 linhas
 * como incomparáveis, corretamente, e a tela as listou como 62 alterações.
 *
 * Mas 46935.5 **é** 2028-07-01T12:00:00.000Z: é o serial do Excel para o mesmo
 * instante. Nada mudou no contrato. Uma ferramenta de auditoria que apresenta
 * isso como 62 mudanças contratuais está errada tanto quanto uma que apaga o
 * fato.
 *
 * A saída é nomear o que aconteceu, sem tocar no dado. Nada é convertido, nada
 * é corrigido, nada é escondido: o valor bruto dos dois lados continua na
 * `raw_cell`, a alteração continua na lista, e a anomalia é dita em português
 * ao lado dela — inclusive quando a data por trás do serial é **outra**, que é
 * o caso em que existe mudança real embrulhada numa troca de formato.
 *
 * Nomear, porém, não bastou. Nomeada e mantida entre as alterações comuns, a
 * troca de formato ainda era **classificada** como uma: selo de ruptura, 85
 * pontos de criticidade, primeiro lugar da fila de investigação de agosto. A
 * tela dizia "62 veículos afetados, crítico" no cabeçalho e "nada mudou"
 * embaixo de cada uma das 62 linhas. `formatOnly` é o campo que desfaz essa
 * contradição na origem — ver `grouped.ts` (selo `FORMATO`) e `cockpit.ts`
 * (score), que é onde ele produz efeito.
 *
 * Um segundo caso chegou depois, e é o gêmeo deste: `@workspace/ingest`
 * passou a converter um serial cru numa coluna de data conhecida direto em
 * data (ver `values.ts`), e por design essa conversão é *date-only* — a
 * fração vira só o dia, sem hora. Isso resolve o problema deste módulo (o
 * serial nunca mais chega numérico numa coluna de data conhecida), mas cria
 * outro exatamente da mesma família: um lado com hora (o formato antigo,
 * legado nas vigências anteriores) contra um lado só com o dia (o formato
 * novo). Mesma pergunta — "isso é o mesmo dia, ou o contrato mudou de fato?"
 * —, e por isso a resposta mora aqui, não num segundo detector paralelo.
 */

export type AnomalyKind =
  | "DATA_COMO_SERIAL_EXCEL"
  | "SERIAL_EXCEL_COMO_DATA"
  | "DATA_HORA_COMO_SOMENTE_DATA"
  | "SOMENTE_DATA_COMO_DATA_HORA";

export interface Anomaly {
  kind: AnomalyKind;
  /**
   * Se as duas formas representam o mesmo instante. Quando true, não houve
   * mudança de valor nenhuma — só de formato. Quando false, houve as duas
   * coisas, e o tamanho da diferença está em `differenceMs`.
   */
  sameInstant: boolean;
  /**
   * Diferença absoluta entre os dois instantes, em milissegundos.
   *
   * Existe porque "instantes diferentes" não é uma informação suficiente. Nos
   * 8 cavalos de Ago/2026 a diferença é de **um milissegundo**:
   * `2028-07-01T23:59:59.999Z` não cabe num serial do Excel, que arredonda para
   * `2028-07-02T00:00:00Z`. Chamar isso de "mudança de valor" sem dizer o
   * tamanho faria uma perda de precisão passar por alteração de contrato.
   */
  differenceMs: number;
  /**
   * Se esta linha é **só** troca de formato: o mesmo instante dos dois lados,
   * ou uma diferença menor que a precisão que o serial do Excel não carrega.
   *
   * É o campo que decide classificação, e por isso ele nasce aqui e viaja na
   * resposta em vez de ser recalculado por quem consome. O critério já existia
   * três vezes — nesta função, no diagnóstico do cockpit e na tabela de
   * veículos, com um `1000` escrito à mão. Três cópias de um limiar são três
   * chances de a tela dizer "troca de formato" enquanto o score diz "ruptura".
   */
  formatOnly: boolean;
  /** O que o número representa quando lido como serial do Excel. */
  interpretation: string;
  /** Frase para a tela. Explica, não rotula. */
  explanation: string;
}

/** Abaixo disto, a diferença é perda de precisão do formato, não data nova. */
export const PRECISION_TOLERANCE_MS = 1000;

function describeDifference(ms: number): string {
  if (ms < 1000) return `${ms} ${ms === 1 ? "milissegundo" : "milissegundos"}`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds)} segundos`;
  const hours = seconds / 3600;
  if (hours < 24) return `${hours.toFixed(1)} horas`;
  return `${Math.round(hours / 24)} dias`;
}

/** Um lado da comparação, como o motor já o descreve. */
export interface AnomalySide {
  numeric: number | null;
  text: string | null;
  date: string | null;
  /** O valor exibido, que é o que a lista mostra hoje. */
  display: string | null;
}

/** `2028-07-01T12:00:00.000Z` e `2028-07-01` são ambos aceitos. */
function parseInstant(value: string | null): Date | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value)) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Lê um lado como número, venha ele da coluna numérica ou de um texto que é só
 * um número — a fonte já entregou as duas formas para a mesma coluna.
 */
function asNumber(side: AnomalySide): number | null {
  if (side.numeric !== null) return side.numeric;
  if (side.text !== null && /^-?\d+(\.\d+)?$/.test(side.text.trim())) {
    return Number(side.text);
  }
  return null;
}

/** Um instante resolvido de um lado, e a precisão com que a fonte o escreveu. */
interface ResolvedInstant {
  instant: Date;
  /** `"dia"` quando a fonte só tinha o dia para dar (10 caracteres, sem hora). */
  precision: "dia" | "instante";
}

function resolveInstant(side: AnomalySide): ResolvedInstant | null {
  for (const raw of [side.date, side.text, side.display]) {
    const parsed = parseInstant(raw);
    if (parsed !== null) {
      return { instant: parsed, precision: raw!.length === 10 ? "dia" : "instante" };
    }
  }
  return null;
}

function asInstant(side: AnomalySide): Date | null {
  return resolveInstant(side)?.instant ?? null;
}

/**
 * A anomalia de uma alteração, ou `null` quando não há nenhuma.
 *
 * Deliberadamente conservador: só acusa quando um lado é reconhecidamente uma
 * data e o outro é um número dentro da faixa que `@workspace/ingest` já
 * considera plausível para serial (1990–2100) — ou quando os dois lados já são
 * datas, mas com precisões diferentes (uma tem hora, a outra só o dia). Um
 * número fora da faixa plausível não vira suspeita, porque adivinhar aqui
 * produziria alarme falso numa tela cuja função é ser confiável.
 */
export function detectFormatAnomaly(
  before: AnomalySide,
  after: AnomalySide,
): Anomaly | null {
  const beforeResolved = resolveInstant(before);
  const afterResolved = resolveInstant(after);
  const beforeInstant = beforeResolved?.instant ?? null;
  const afterInstant = afterResolved?.instant ?? null;
  const beforeNumber = asNumber(before);
  const afterNumber = asNumber(after);

  // Data → número
  if (beforeInstant !== null && afterInstant === null && afterNumber !== null) {
    return describeSerial("DATA_COMO_SERIAL_EXCEL", beforeInstant, afterNumber);
  }
  // Número → data
  if (afterInstant !== null && beforeInstant === null && beforeNumber !== null) {
    return describeSerial("SERIAL_EXCEL_COMO_DATA", afterInstant, beforeNumber);
  }
  // Data-e-hora → só o dia, ou o inverso: os dois lados já são datas, mas um
  // guarda hora e o outro nunca teve hora para guardar.
  if (
    beforeResolved !== null &&
    afterResolved !== null &&
    beforeResolved.precision !== afterResolved.precision
  ) {
    return describePrecisionChange(beforeResolved, afterResolved);
  }
  return null;
}

function describePrecisionChange(
  before: ResolvedInstant,
  after: ResolvedInstant,
): Anomaly {
  const beforeDay = toIsoDate(before.instant);
  const afterDay = toIsoDate(after.instant);
  const differenceMs = Math.abs(after.instant.getTime() - before.instant.getTime());
  const sameInstant = differenceMs === 0;
  // O dia é o que sobra quando um dos dois lados nunca teve hora para
  // guardar: um lado com 23:59:59 e o outro sem hora nenhuma diferem por quase
  // um dia inteiro em milissegundos, e isso não é uma data nova — é a hora que
  // o formato date-only não representa.
  const formatOnly = beforeDay === afterDay;

  const kind: AnomalyKind =
    before.precision === "instante" ? "DATA_HORA_COMO_SOMENTE_DATA" : "SOMENTE_DATA_COMO_DATA_HORA";
  const direction =
    kind === "DATA_HORA_COMO_SOMENTE_DATA"
      ? "Esta coluna vinha com data e hora e passou a vir só com a data"
      : "Esta coluna vinha só com a data e passou a vir com data e hora";

  const tail = formatOnly
    ? `${toIsoDateTime(before.instant)} e ${toIsoDateTime(after.instant)} são o mesmo dia ` +
      `(${beforeDay}). A hora que um dos dois lados não guarda é o que o formato date-only não ` +
      `representa, e não uma data nova. Continua sendo troca de formato.`
    : `${toIsoDateTime(before.instant)} é ${beforeDay}, contra ${toIsoDateTime(after.instant)} ` +
      `(${afterDay}) do outro lado — dias diferentes. Há troca de formato e mudança de data na ` +
      `mesma célula; confira o original antes de concluir qual das duas importa.`;

  return {
    kind,
    sameInstant,
    differenceMs,
    formatOnly,
    interpretation: `${beforeDay} e ${afterDay} lidos com precisões diferentes`,
    explanation:
      `${direction}. ${tail} O valor original de cada lado continua guardado como veio.`,
  };
}

function describeSerial(kind: AnomalyKind, instant: Date, serial: number): Anomaly | null {
  if (!isPlausibleDateSerial(serial)) return null;
  const asDate = excelSerialToDate(serial);
  if (asDate === null) return null;

  const differenceMs = Math.abs(asDate.getTime() - instant.getTime());
  const sameInstant = differenceMs === 0;
  const formatOnly = differenceMs < PRECISION_TOLERANCE_MS;
  const interpretation = `${serial} lido como serial do Excel é ${toIsoDateTime(asDate)}`;

  const direction =
    kind === "DATA_COMO_SERIAL_EXCEL"
      ? "Esta coluna vinha como data e passou a vir como número"
      : "Esta coluna vinha como número e passou a vir como data";

  const tail = sameInstant
    ? `${interpretation} — exatamente o mesmo instante do outro lado. É troca de formato ` +
      `na exportação, não mudança de contrato.`
    : formatOnly
      ? `${interpretation}, contra ${toIsoDateTime(instant)} do outro lado — uma diferença de ` +
        `${describeDifference(differenceMs)}. Um serial do Excel não representa fração de ` +
        `segundo, então a diferença é a precisão que o formato perdeu, e não uma data nova. ` +
        `Continua sendo troca de formato.`
      : `${interpretation}, contra ${toIsoDateTime(instant)} do outro lado — uma diferença de ` +
        `${describeDifference(differenceMs)}. Há troca de formato e mudança de data na mesma ` +
        `célula; confira o original antes de concluir qual das duas importa.`;

  return {
    kind,
    sameInstant,
    differenceMs,
    formatOnly,
    interpretation,
    explanation:
      `${direction}. ${tail} O valor original de cada lado continua guardado como veio.`,
  };
}
