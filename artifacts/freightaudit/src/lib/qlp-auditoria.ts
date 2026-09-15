import {
  ROTULO_DO_PAPEL,
  ROTULO_DO_QUADRO,
  ROTULO_DO_VEREDITO_DA_LINHA,
  celulasDoCsvDeQlp,
  COLUNAS_DO_CSV_DE_QLP,
  type ConferenciaDaLinha,
  type ConferenciaDoAbono,
  type ConferenciaDoBenchmark,
  type QuadroDeQlp,
  type ResultadoDaConta,
  type ResumoDaConta,
  type ResumoDoQuadro,
  type VereditoDaLinha,
} from "@workspace/comparison/qlp";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria do QLP — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/qlp`, que o servidor também
 * importa: cada conferência, cada veredito e cada resumo saem de lá. O que este
 * arquivo acrescenta é como se **escreve** o resultado — e a decisão principal
 * aqui é de linguagem, não de formato: uma conta que não fecha não é um erro
 * provado, é uma conta que não fecha. A tela diz "não fecha", nunca "errado".
 */

/** O que a API de `/qlp/auditoria` devolve. */
export interface AuditoriaDoQuadro {
  quadro: QuadroDeQlp;
  serieEntregue: boolean;
  colunasDesconhecidas: string[];
  resumo: ResumoDoQuadro;
  contas: ResumoDaConta[];
  benchmark: ConferenciaDoBenchmark | null;
  abono: ConferenciaDoAbono | null;
  linhas: ConferenciaDaLinha[];
}

export {
  ROTULO_DO_PAPEL,
  ROTULO_DO_QUADRO,
  ROTULO_DO_VEREDITO_DA_LINHA,
  type ConferenciaDaLinha,
  type QuadroDeQlp,
  type ResultadoDaConta,
};

/** O selo de cada veredito. Cor **e** texto — nunca só a cor. */
export const SELO_DO_VEREDITO: Record<VereditoDaLinha, string> = {
  CONFERE: "bg-success/10 text-success border border-success/25",
  DIVERGE: "bg-warning/15 text-warning-foreground border border-warning/40",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground border border-dashed border-border",
};

/**
 * Um valor de conta escrito em reais.
 *
 * Todas as contas desta tela terminam em dinheiro — a despesa de uma rubrica, o
 * subtotal de um degrau —, mesmo quando uma das parcelas é uma quantidade. É por
 * isso que o esperado e o declarado saem em R$ e a quantidade não: multiplicar
 * três posições por R$ 2.400 dá reais, não posições.
 */
export function escreverConta(valor: number | null): string {
  if (valor === null) return "—";
  return formatBrl(valor);
}

/**
 * A diferença entre o declarado e o esperado, com sinal explícito.
 *
 * O sinal é a informação: positivo quer dizer que a coluna declara **mais** do
 * que a conta produz, e negativo, menos. "R$ 2.400,00" sozinho não distingue os
 * dois casos, e eles têm conversas diferentes com quem publica a tabela.
 */
export function escreverDiferenca(valor: number | null): string {
  if (valor === null) return "—";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return `${sinal}${formatBrl(Math.abs(valor))}`;
}

/**
 * Uma quantidade escrita — inteira quando é inteira.
 *
 * Efetivo costuma ser inteiro e o fator de motoristas por caminhão não; escrever
 * "3,00 posições" onde a fonte disse três é ruído, e cortar "1,4" para "1" é
 * apagar a informação. Duas casas só quando elas existem.
 */
export function escreverQuantidade(valor: number | null): string {
  if (valor === null) return "—";
  return Number.isInteger(valor) ? formatNumber(valor, 0) : formatNumber(valor, 2);
}

/** A fração de linhas que fecham, escrita como percentual. */
export function escreverCobertura(conferem: number, linhas: number): string {
  if (linhas === 0) return "—";
  return `${formatNumber((conferem / linhas) * 100, 1)}%`;
}

/** Os filtros da tabela de cargos. */
export interface FiltrosDeQlp {
  busca: string;
  veredito: "TODOS" | VereditoDaLinha;
  /** Só os cargos em que uma conta específica não fecha. */
  conta: string;
}

export const FILTROS_VAZIOS: FiltrosDeQlp = {
  busca: "",
  veredito: "TODOS",
  conta: "TODAS",
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * O filtro por conta é o que transforma esta tela numa fila de trabalho: "os
 * cargos em que a despesa de telefonia não fecha" é uma pergunta que alguém
 * leva para a transportadora, e "os 200 cargos do quadro" não é.
 */
export function filtrar(
  linhas: readonly ConferenciaDaLinha[],
  filtros: FiltrosDeQlp,
): ConferenciaDaLinha[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.veredito !== "TODOS" && l.veredito !== filtros.veredito) return false;
    if (filtros.conta !== "TODAS") {
      const conta = l.contas.find((c) => c.conta === filtros.conta);
      if (!conta || conta.confere !== false) return false;
    }
    if (busca) {
      const alvo = `${l.nome ?? ""} ${l.chave}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantos cargos caem em cada veredito, sobre o mesmo recorte da tabela. */
export function contagemPorVeredito(
  linhas: readonly ConferenciaDaLinha[],
  filtros: FiltrosDeQlp,
): Record<string, number> {
  const contagem: Record<string, number> = {
    TODOS: filtrar(linhas, { ...filtros, veredito: "TODOS" }).length,
  };
  for (const veredito of ["CONFERE", "DIVERGE", "BASE_INSUFICIENTE"] as const) {
    contagem[veredito] = filtrar(linhas, { ...filtros, veredito }).length;
  }
  return contagem;
}

/**
 * A tabela virando as linhas do CSV — uma por conta, e não por cargo.
 *
 * As células saem do núcleo (`celulasDoCsvDeQlp`), e aqui só se converte número
 * em texto do Excel brasileiro. Um arquivo com uma linha por cargo teria de
 * espremer seis vereditos numa célula, e ninguém filtra planilha por texto
 * concatenado.
 */
export function linhasDoCsv(linhas: readonly ConferenciaDaLinha[]): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_QLP],
    ...linhas.flatMap((l) =>
      celulasDoCsvDeQlp(l).map((celulas) =>
        celulas.map((celula) => {
          if (celula === null || celula === undefined) return "";
          if (typeof celula === "number") return numeroParaCsv(celula);
          return celula;
        }),
      ),
    ),
  ];
}
