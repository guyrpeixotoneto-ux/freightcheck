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
 * Dinheiro na escala de quem lê de longe — `R$ 38,4 mil`, `R$ 1,2 mi`.
 *
 * Existe para os ladrilhos e para os cartões de pauta, onde o número compete
 * com o rótulo pelo mesmo espaço e `R$ 38.412` gasta a largura inteira dizendo
 * uma precisão que ninguém leva para a reunião. Abaixo de mil sai por extenso,
 * porque `R$ 0,8 mil` seria pior do que o número que ele resume.
 *
 * O sinal é o menos tipográfico (−), o mesmo que o resto da tela usa: o hífen
 * some ao lado do cifrão em corpo grande, e uma perda lida como ganho é o erro
 * mais caro que uma formatação pode produzir.
 */
export function formatBrlCompacto(value: number): string {
  const abs = Math.abs(value);
  const sinal = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sinal}R$ ${formatNumber(abs / 1_000_000, 1)} mi`;
  if (abs >= 1_000) return `${sinal}R$ ${formatNumber(abs / 1_000, 1)} mil`;
  // Montado à mão como os dois acima, e não por `formatBrlShort`: o cifrão do
  // `toLocaleString` vem com espaço fino, e a mistura das duas larguras num
  // ladrilho com várias linhas aparece como desalinhamento sem causa visível.
  return `${sinal}R$ ${formatNumber(abs, 0)}`;
}

/**
 * Um valor com a sua unidade. Sem unidade declarada, sai como número puro —
 * que é a resposta honesta quando não se sabe o que a coluna mede.
 */
export function formatValue(value: number | null, unit: string | null): string {
  if (value === null) return "—";
  if (unit === "BRL") return formatBrl(value);
  /*
    As unidades de taxa são derivadas do significado econômico, então a lista
    acima não pode ser fechada: `R$ por litro` produz `BRL_LITRO`, `R$ por
    viagem` produz `BRL_VIAGEM`, e amanhã a operação cadastra `R$ por pallet`.
    Sem esta regra, `BRL_LITRO` sairia na tela como "3,66 brl_litro" — o
    fallback genérico —, que é pior do que não formatar.

    `BRL_KM` continua nomeado acima porque a abreviação dele é a que se usa;
    a regra abaixo cobre todas as outras com a mesma forma.
  */
  if (unit !== null && unit.startsWith("BRL_")) {
    const base = unit.slice("BRL_".length).toLowerCase().replace(/_/g, " ");
    return `${formatNumber(value)} R$/${base}`;
  }
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

const PERIODICITY_ADJECTIVE: Record<string, string> = {
  MENSAL: "mensal",
  ANUAL: "anual",
  PONTUAL: "pontual",
  SEM_PERIODICIDADE: "sem periodicidade",
};

/**
 * O adjetivo da grandeza — "mensal", "anual" —, para quem a escreve num rótulo
 * em vez de num sufixo.
 *
 * `periodicitySuffix` serve ao número ("−R$ 144.875/ano"); este serve ao nome do
 * cartão que o contém ("Impacto líquido anual"). O que não estiver na lista sai
 * pelo próprio código em minúsculas, e não por um traço: "SEM_PERIODICIDADE"
 * escrito como veio do banco, num rótulo, se lê como defeito da tela.
 */
export function periodicityAdjective(periodicity: string): string {
  return (
    PERIODICITY_ADJECTIVE[periodicity] ??
    periodicity.toLowerCase().replace(/_/g, " ")
  );
}

/**
 * A ordem em que as periodicidades se escrevem: mensal, anual, pontual.
 *
 * É a mesma de `panorama.ts`, e existe porque `Object.entries` devolve os baldes
 * na ordem em que foram preenchidos — que é a ordem das linhas do arquivo, e
 * muda de uma vigência para a outra. Enquanto as periodicidades dividiam duas
 * linhas de um cartão só, isso passava despercebido; num cartão por
 * periodicidade, o mesmo número trocaria de lugar na régua entre uma visita e a
 * seguinte, e ninguém compara o que se move.
 */
const PERIODICITY_ORDER = ["MENSAL", "ANUAL", "PONTUAL"];

/** Os baldes na ordem canônica. O que não estiver na lista vai para o fim. */
export function sortByPeriodicity<T extends { periodicity: string }>(
  entries: T[],
): T[] {
  const posicao = (p: string) => {
    const i = PERIODICITY_ORDER.indexOf(p);
    return i === -1 ? PERIODICITY_ORDER.length : i;
  };
  return [...entries].sort(
    (a, b) => posicao(a.periodicity) - posicao(b.periodicity),
  );
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
