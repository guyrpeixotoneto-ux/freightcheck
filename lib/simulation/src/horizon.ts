import {
  MESES_NO_ANO,
  convertPeriodicity,
  formatFactor,
  type Periodicity,
  type Refused,
  type ResultNature,
} from "./periodicity";

/**
 * O horizonte da simulação, e o que cada quantia contribui para ele.
 *
 * O horizonte é de quem opera — "Jan a Dez/2026", "os próximos seis meses" — e
 * é para ele que tudo é convertido. Converter para um "anual" fixo esconderia a
 * premissa dentro do código; convertendo para o horizonte declarado, o fator
 * fica à vista de quem lê o resultado.
 */

/** Semiaberto: `from` entra, `until` não. Igual ao daterange das vigências. */
export interface Horizon {
  from: string;
  until: string;
}

interface YMD {
  y: number;
  m: number;
  d: number;
}

function parse(iso: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

/** Ordem cronológica, sem passar por fuso horário. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * O tamanho do horizonte, em meses inteiros.
 *
 * Horizonte que não fecha em meses inteiros é recusado, em vez de rateado por
 * dia. Ratear por dia exigiria decidir quantos dias tem um mês, e essa decisão
 * inventaria precisão que a fonte não tem: as vigências do Freightec são
 * mensais. Recusar é a resposta honesta; dividir por 30,44 não é.
 */
export function monthsInHorizon(horizon: Horizon): number | Refused {
  const from = parse(horizon.from);
  const until = parse(horizon.until);

  if (!from || !until) {
    return {
      allowed: false,
      code: "HORIZONTE_NAO_FECHA_EM_MESES",
      explanation: `Datas inválidas: "${horizon.from}" a "${horizon.until}". Use AAAA-MM-DD.`,
    };
  }

  if (from.d !== until.d) {
    return {
      allowed: false,
      code: "HORIZONTE_NAO_FECHA_EM_MESES",
      explanation:
        `O horizonte ${horizon.from} → ${horizon.until} não fecha em meses ` +
        `inteiros. As vigências do Freightec são mensais, e ratear por dia ` +
        `inventaria uma precisão que a fonte não tem. Escolha um intervalo que ` +
        `comece e termine no mesmo dia do mês.`,
    };
  }

  const months = (until.y - from.y) * MESES_NO_ANO + (until.m - from.m);
  if (months <= 0) {
    return {
      allowed: false,
      code: "HORIZONTE_NAO_FECHA_EM_MESES",
      explanation:
        `O horizonte ${horizon.from} → ${horizon.until} não avança no tempo. ` +
        `O fim é exclusivo e precisa ser posterior ao início.`,
    };
  }
  return months;
}

/** O que entra na simulação, com o significado que o torna interpretável. */
export interface SimulationValue {
  value: number;
  periodicity: Periodicity | null;
  /** Falso para alíquotas: um percentual não se acumula no tempo. */
  isMonetary: boolean;
  /** Obrigatório quando PONTUAL: quando o evento ocorre. */
  eventDate?: string | null;
}

export interface Contribution {
  included: boolean;
  amount: number;
  factor: number;
  nature: ResultNature;
  explanation: string;
}

function isRefused(v: unknown): v is Refused {
  return typeof v === "object" && v !== null && (v as Refused).allowed === false;
}

/**
 * Quanto esta quantia contribui para o horizonte.
 *
 * Recorrentes são esticados pelo número de meses; pontuais entram pelo valor
 * cheio se a data cair dentro, e por nada se cair fora. Um pontual nunca é
 * dividido pelo horizonte — é a recusa central deste domínio.
 */
export function contributionOverHorizon(
  input: SimulationValue,
  horizon: Horizon,
): Contribution | Refused {
  if (input.periodicity === null) {
    return input.isMonetary
      ? {
          allowed: false,
          code: "PERIODICIDADE_NAO_CONFIRMADA",
          explanation:
            "Este valor é monetário mas ninguém confirmou se é mensal, anual " +
            "ou pontual. Fica fora do total, nomeado, até a curadoria decidir.",
        }
      : {
          allowed: false,
          code: "TAXA_NAO_TEM_PERIODICIDADE",
          explanation:
            "Alíquota não é dinheiro acumulado no tempo: ela multiplica uma " +
            "base, e o resultado herda a periodicidade da base.",
        };
  }

  const months = monthsInHorizon(horizon);
  if (isRefused(months)) return months;

  if (input.periodicity === "PONTUAL") {
    if (!input.eventDate) {
      return {
        allowed: false,
        code: "PONTUAL_SEM_DATA",
        explanation:
          "Um valor pontual sem data não pode ser situado no horizonte: não há " +
          "como saber se o evento cai dentro dele.",
      };
    }
    const dentro =
      compare(input.eventDate, horizon.from) >= 0 &&
      compare(input.eventDate, horizon.until) < 0;
    return dentro
      ? {
          included: true,
          amount: input.value,
          factor: 1,
          nature: "PONTUAL_INTEGRAL",
          explanation:
            `Evento em ${input.eventDate}, dentro do horizonte. Entra pelo valor ` +
            `cheio, sem rateio: não é custo recorrente do período.`,
        }
      : {
          included: false,
          amount: 0,
          factor: 0,
          nature: "PONTUAL_INTEGRAL",
          explanation:
            `Evento em ${input.eventDate}, fora do horizonte ${horizon.from} → ` +
            `${horizon.until}. Não contribui, e não foi rateado para dentro.`,
        };
  }

  const factor =
    input.periodicity === "MENSAL" ? months : months / MESES_NO_ANO;
  const exata = factor === 1;

  return {
    included: true,
    amount: input.value * factor,
    factor,
    nature: exata ? "EXATA" : "PROJECAO_LINEAR",
    explanation: exata
      ? `O horizonte tem exatamente um período ${input.periodicity === "MENSAL" ? "mensal" : "anual"}; nada foi projetado.`
      : `Projeção linear: valor ${input.periodicity === "MENSAL" ? "mensal" : "anual"} ` +
        `estendido por ${months} ${months === 1 ? "mês" : "meses"} (×${formatFactor(factor)}), ` +
        `assumindo incidência constante. É premissa, não custo apurado.`,
  };
}

/** Uma versão da semântica, com a janela em que valeu. */
export interface SemanticsWindow {
  version: number;
  /** Inclusivo. */
  from: string;
  /** Exclusivo. `null` quando é a versão em vigor. */
  until: string | null;
  periodicity: Periodicity | null;
  isMonetary: boolean;
  calculationBasis?: string | null;
}

export interface Segment {
  horizon: Horizon;
  months: number;
  semantics: SemanticsWindow;
}

/**
 * Recorta o horizonte nas vigências da semântica.
 *
 * Um horizonte pode atravessar uma mudança de significado — `ipvaLicenciamento`
 * mudou de regra duas vezes em nove vigências. Aplicar a semântica de hoje ao
 * período inteiro produziria um total com cara de apurado e conteúdo de
 * suposição, que é a classe de erro que já custou a leitura de R$ 720 mil.
 *
 * Um trecho sem versão que o cubra é recusa, não silêncio: simular um período
 * cujo significado não se conhece é inventar.
 */
export function splitHorizonBySemantics(
  horizon: Horizon,
  windows: SemanticsWindow[],
): Segment[] | Refused {
  const months = monthsInHorizon(horizon);
  if (isRefused(months)) return months;

  const ordered = [...windows].sort((a, b) => compare(a.from, b.from));
  const segments: Segment[] = [];
  let cursor = horizon.from;

  while (compare(cursor, horizon.until) < 0) {
    const covering = ordered.find(
      (w) =>
        compare(w.from, cursor) <= 0 &&
        (w.until === null || compare(cursor, w.until) < 0),
    );

    if (!covering) {
      return {
        allowed: false,
        code: "SEMANTICA_AUSENTE_NO_TRECHO",
        explanation:
          `Nenhuma versão de semântica cobre ${cursor}. O horizonte atravessa um ` +
          `período cujo significado não está registrado, e simular esse trecho ` +
          `seria inventá-lo.`,
      };
    }

    const end =
      covering.until !== null && compare(covering.until, horizon.until) < 0
        ? covering.until
        : horizon.until;

    const slice = { from: cursor, until: end };
    const sliceMonths = monthsInHorizon(slice);
    if (isRefused(sliceMonths)) {
      return {
        allowed: false,
        code: "HORIZONTE_NAO_FECHA_EM_MESES",
        explanation:
          `A vigência da versão ${covering.version} corta o horizonte em ` +
          `${end}, e o trecho ${cursor} → ${end} não fecha em meses inteiros. ` +
          `${sliceMonths.explanation}`,
      };
    }

    segments.push({ horizon: slice, months: sliceMonths, semantics: covering });
    cursor = end;
  }

  return segments;
}

export interface VersionedContribution {
  total: number;
  nature: ResultNature;
  segments: { segment: Segment; contribution: Contribution }[];
  explanation: string;
}

/**
 * A contribuição ao longo do horizonte, calculada trecho a trecho.
 *
 * Se qualquer trecho for recusado, o atributo inteiro fica fora do total: um
 * total parcial apresentado como total é pior do que nenhum total.
 */
export function contributionAcrossSemantics(
  value: number,
  horizon: Horizon,
  windows: SemanticsWindow[],
  eventDate?: string | null,
): VersionedContribution | Refused {
  const segments = splitHorizonBySemantics(horizon, windows);
  if (isRefused(segments)) return segments;

  const parts: { segment: Segment; contribution: Contribution }[] = [];
  let total = 0;
  let projetou = false;
  let pontual = false;

  for (const segment of segments) {
    const contribution = contributionOverHorizon(
      {
        value,
        periodicity: segment.semantics.periodicity,
        isMonetary: segment.semantics.isMonetary,
        eventDate: eventDate ?? null,
      },
      segment.horizon,
    );
    if (isRefused(contribution)) {
      return {
        allowed: false,
        code: contribution.code,
        explanation:
          `No trecho ${segment.horizon.from} → ${segment.horizon.until} ` +
          `(versão ${segment.semantics.version}): ${contribution.explanation}`,
      };
    }
    parts.push({ segment, contribution });
    total += contribution.amount;
    if (contribution.nature === "PROJECAO_LINEAR") projetou = true;
    if (contribution.nature === "PONTUAL_INTEGRAL") pontual = true;
  }

  const nature: ResultNature = projetou
    ? "PROJECAO_LINEAR"
    : pontual
      ? "PONTUAL_INTEGRAL"
      : "EXATA";

  return {
    total,
    nature,
    segments: parts,
    explanation:
      parts.length === 1
        ? parts[0]!.contribution.explanation
        : `Calculado em ${parts.length} trechos, porque a semântica mudou dentro ` +
          `do horizonte: ${parts
            .map(
              (p) =>
                `${p.segment.horizon.from}→${p.segment.horizon.until} pela versão ` +
                `${p.segment.semantics.version}`,
            )
            .join("; ")}.`,
  };
}

export { convertPeriodicity };
