/**
 * Como um número deste produto se escreve — e o que nunca se omite ao lado dele.
 *
 * Duas regras, e as duas são recusas do FreightCheck, não preferências de
 * formatação. Valor em dinheiro **nunca** aparece sem a periodicidade: R$ 100
 * por mês e R$ 100 por ano não são o mesmo dinheiro, e escrever "R$ 100" deixa
 * quem lê escolher qual dos dois entendeu. E a contagem de alterações **nunca**
 * aparece sem a fatia que tem preço: "267 alterações" ao lado de "+R$ 28 mil"
 * sugere que os dois números falam do mesmo conjunto, quando o segundo cobre 19
 * das 267.
 */

import type { ImpactSummary } from "@workspace/comparison";

export const REAIS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

export const INTEIRO = new Intl.NumberFormat("pt-BR");

/** "/mês", "/ano" — nunca omitido ao lado de um valor. */
export function sufixo(periodicidade: string): string {
  const mapa: Record<string, string> = {
    MENSAL: "/mês",
    ANUAL: "/ano",
    PONTUAL: " (valor único)",
  };
  return mapa[periodicidade] ?? ` (${periodicidade.toLowerCase()})`;
}

export function dinheiro(valor: number, periodicidade: string): string {
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return `${sinal}${REAIS.format(Math.abs(valor))}${sufixo(periodicidade)}`;
}

/**
 * O impacto como o produto o exibe: uma linha por periodicidade.
 *
 * `null` quando não há nenhuma apurada — e quem chama é obrigado a tratar esse
 * `null`, porque é ele que separa "não mudou nada em dinheiro" de "mudou e não
 * sabemos quanto".
 */
export function impactoEmTexto(impacto: ImpactSummary): string | null {
  const linhas = Object.entries(impacto.byPeriodicity)
    .filter(([, valor]) => valor !== 0)
    .map(([periodicidade, valor]) => dinheiro(valor, periodicidade));
  return linhas.length > 0 ? linhas.join(" · ") : null;
}

/** Os números crus de um impacto, para a validação conferir. */
export function numerosDoImpacto(impacto: ImpactSummary): number[] {
  return Object.values(impacto.byPeriodicity).filter((v) => v !== 0);
}

export function cobertura(calculadas: number, total: number): string {
  if (total === 0) return "sem alterações neste recorte";
  const pct = Math.round((calculadas / total) * 100);
  return `${pct}% do que mudou tem impacto calculável (${INTEIRO.format(calculadas)} de ${INTEIRO.format(total)})`;
}

/** Um trecho legível, sem cortar no meio de uma palavra. */
export function trecho(texto: string, limite = 600): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  return `${corte.slice(0, espaco > 0 ? espaco : limite)}…`;
}

/** "2026-08-01" → "agosto/2026" */
export function rotuloDoPeriodo(data: string): string {
  const [ano, mes] = data.split("-");
  const nomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const nome = nomes[Number(mes) - 1];
  return nome ? `${nome}/${ano}` : data;
}
