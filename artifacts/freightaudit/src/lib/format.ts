/**
 * Formatação de valores — por unidade declarada, nunca por aparência.
 *
 * A regra que este arquivo existe para impedir: um número ser exibido como
 * dinheiro só por ser numérico. `manutencaoVidaMeses` vale 50,64 e é uma
 * quantidade de meses; imprimi-lo como "R$ 50,64" seria inventar uma grandeza
 * que a fonte nunca entregou. A unidade vem do banco, e é ela que decide.
 */

const UNIT_SUFFIX: Record<string, string> = {
  PERCENT: "%",
  KM_L: " km/l",
  BRL_KM: " R$/km",
  MESES: " meses",
  KM: " km",
  LITROS: " l",
  ANO: " anos",
  QTD: "",
};

export function formatBrl(value: number, digits = 2): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Dinheiro sem centavos, para os números grandes do cabeçalho. */
export function formatBrlShort(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

/**
 * Um valor com a sua unidade. Sem unidade declarada, sai como número puro —
 * que é a resposta honesta quando não se sabe o que a coluna mede.
 */
export function formatValue(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  if (unit === "BRL") return formatBrl(value);
  const suffix = unit === null ? "" : (UNIT_SUFFIX[unit] ?? ` ${unit.toLowerCase()}`);
  return `${formatNumber(value)}${suffix}`;
}

/** "+12,4%" / "−35,0%". O sinal explícito evita ler queda como alta. */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

const PERIODICITY_SUFFIX: Record<string, string> = {
  MENSAL: "/mês",
  ANUAL: "/ano",
  PONTUAL: " (valor único)",
};

export function periodicitySuffix(periodicity: string | null): string {
  return PERIODICITY_SUFFIX[periodicity ?? ""] ?? "";
}

/**
 * O impacto de uma vigência, por periodicidade.
 *
 * Devolve uma lista, e nunca um número só: R$/mês e R$/ano são grandezas
 * diferentes, e juntá-las é o erro que este produto existe para pegar.
 */
export function impactEntries(
  buckets: Record<string, number>,
): { periodicity: string; amount: number; label: string }[] {
  return Object.entries(buckets).map(([periodicity, amount]) => ({
    periodicity,
    amount,
    label: `${formatBrlShort(amount)}${periodicitySuffix(periodicity)}`,
  }));
}
