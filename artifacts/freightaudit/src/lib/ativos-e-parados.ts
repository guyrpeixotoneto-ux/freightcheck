import { MES_CURTO } from "@/lib/calendario";

/**
 * ATIVOS E PARADOS — os tipos da resposta e as funções puras que a tela usa.
 *
 * **A tela não conta nada.** Ativos, parados, total, percentual e variação
 * chegam prontos do servidor, apurados por `contarFrotaPorQuinzena`
 * (`@workspace/fechamento`). O que mora aqui é apresentação — rótulo do eixo,
 * sinal da variação, e a frase da cobertura —, e mora num arquivo próprio
 * porque é o que se pode testar sem montar componente.
 *
 * ---------------------------------------------------------------------------
 * `null` não é zero, e a tela precisa dizer isso em cada lugar
 * ---------------------------------------------------------------------------
 *
 * Uma contagem é `null` quando o relatório daquela situação não chegou na
 * quinzena. Se a tela renderizasse `0`, o gráfico desenharia uma queda a pique e
 * o cartão anunciaria uma frota que ninguém parou — o defeito exato que a
 * leitura do servidor se dá ao trabalho de evitar. Por isso:
 *
 * - o gráfico recebe `null` e **não desenha a barra** daquela situação;
 * - o número vira `—`, e não `0`;
 * - a variação some, em vez de virar `-40`;
 * - e a quinzena carrega o aviso de qual relatório faltou, com as unidades.
 */

/** As duas situações que o Promax declara. */
export type SituacaoDaFrota = "ATIVA" | "INATIVA";

export interface CoberturaDaQuinzena {
  unidades: string[];
  comFrotaAtiva: string[];
  comFrotaInativa: string[];
}

export interface VariacaoDaQuinzena {
  contra: string;
  ativos: number | null;
  parados: number | null;
  total: number | null;
  pontosDeParado: number | null;
}

export interface QuinzenaDaFrota {
  competencia: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: string;
  fim: string;
  ativos: number | null;
  parados: number | null;
  total: number | null;
  percentualParado: number | null;
  emAmbasAsSituacoes: number;
  cobertura: CoberturaDaQuinzena;
  variacao: VariacaoDaQuinzena | null;
}

export interface UnidadeComFrota {
  codigo: string;
  nome: string | null;
  quinzenas: number;
}

export interface SerieDeAtivosEParados {
  recorte: {
    tipoDeOperacao: string | null;
    unidadeCodigo: string | null;
    limite: number;
  };
  unidades: UnidadeComFrota[];
  quinzenas: QuinzenaDaFrota[];
}

/** As janelas que a tela oferece, em quinzenas. Seis é o trimestre. */
export const JANELAS = [6, 12, 24] as const;
export type JanelaDeQuinzenas = (typeof JANELAS)[number];

/**
 * O rótulo curto do eixo: `jul/26 · 2ªq`.
 *
 * Curto porque são até vinte e quatro colunas, e o mês vem 1-indexado do banco
 * enquanto `MES_CURTO` é 0-indexado — o `- 1` é o mesmo de `frotas.tsx`, e está
 * escrito numa função com teste pela mesma razão que lá: dentro do JSX ele já
 * foi esquecido uma vez.
 */
export function rotuloCurto(q: {
  mes: number;
  ano: number;
  quinzena: number;
}): string {
  return `${MES_CURTO[q.mes - 1]}/${String(q.ano).slice(2)} · ${q.quinzena}ªq`;
}

/** O rótulo por extenso, para a tabela e para o texto: `julho/2026, 2ª quinzena`. */
export function rotuloLongo(q: {
  mes: number;
  ano: number;
  quinzena: number;
}): string {
  return `${MES_CURTO[q.mes - 1]}/${q.ano}, ${q.quinzena}ª quinzena`;
}

/** O número, ou o travessão da ausência. Nunca um zero no lugar de "não sei". */
export function numeroOuTraco(valor: number | null): string {
  return valor === null ? "—" : valor.toLocaleString("pt-BR");
}

/** `12,5%`, ou travessão. */
export function percentual(valor: number | null): string {
  return valor === null
    ? "—"
    : `${(valor * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** `+3`, `-2`, `0` — com sinal, porque a leitura é de variação. */
export function comSinal(valor: number | null): string | null {
  if (valor === null) return null;
  return valor > 0
    ? `+${valor.toLocaleString("pt-BR")}`
    : valor.toLocaleString("pt-BR");
}

/**
 * O sentido de uma variação, para a cor.
 *
 * **Mais parados é atenção; mais ativos é normal — e nenhum dos dois é
 * "bom" ou "ruim" por si.** Uma frota que cresce ativa veículos, e uma operação
 * que encolheu de propósito para de usá-los. A cor aqui diz para onde o número
 * foi, e a tela não escreve juízo nenhum ao lado.
 */
export function sentido(
  valor: number | null,
): "subiu" | "desceu" | "igual" | "semDado" {
  if (valor === null) return "semDado";
  if (valor > 0) return "subiu";
  if (valor < 0) return "desceu";
  return "igual";
}

/** As unidades que abriram a quinzena e não mandaram o relatório da situação. */
export function unidadesSemRelatorio(
  quinzena: QuinzenaDaFrota,
  situacao: SituacaoDaFrota,
): string[] {
  const enviaram = new Set(
    situacao === "ATIVA"
      ? quinzena.cobertura.comFrotaAtiva
      : quinzena.cobertura.comFrotaInativa,
  );
  return quinzena.cobertura.unidades.filter((u) => !enviaram.has(u));
}

/**
 * A frase da cobertura de uma quinzena, ou `null` quando não há o que avisar.
 *
 * É o aviso que impede a leitura errada mais provável desta tela: a quinzena em
 * que uma unidade não mandou arquivo tem menos placas, e sem esta frase o
 * gráfico pareceria uma frota encolhendo.
 */
export function avisoDeCobertura(quinzena: QuinzenaDaFrota): string | null {
  const semAtiva = unidadesSemRelatorio(quinzena, "ATIVA");
  const semInativa = unidadesSemRelatorio(quinzena, "INATIVA");
  if (semAtiva.length === 0 && semInativa.length === 0) return null;

  const partes: string[] = [];
  if (semAtiva.length > 0) {
    partes.push(`a frota ativa de ${semAtiva.join(", ")}`);
  }
  if (semInativa.length > 0) {
    partes.push(`a frota parada de ${semInativa.join(", ")}`);
  }
  return `Nesta quinzena não chegou ${partes.join(" e ")}. O que falta não está contado — e não é zero.`;
}

/** A última quinzena que mediu alguma coisa — a manchete dos cartões. */
export function ultimaMedida(
  quinzenas: readonly QuinzenaDaFrota[],
): QuinzenaDaFrota | null {
  for (let i = quinzenas.length - 1; i >= 0; i -= 1) {
    const q = quinzenas[i]!;
    if (q.ativos !== null || q.parados !== null) return q;
  }
  return null;
}

/** Os pontos do gráfico, já com rótulo — a única transformação que a tela faz. */
export function pontosDoGrafico(
  quinzenas: readonly QuinzenaDaFrota[],
): {
  rotulo: string;
  competencia: string;
  ativos: number | null;
  parados: number | null;
}[] {
  return quinzenas.map((q) => ({
    rotulo: rotuloCurto(q),
    competencia: q.competencia,
    ativos: q.ativos,
    parados: q.parados,
  }));
}
