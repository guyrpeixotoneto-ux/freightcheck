import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO_DO_CONSUMO,
  celulasDoCsvDeConsumo,
  COLUNAS_DO_CSV_DE_CONSUMO,
  type ConferenciaDaVigenciaDeConsumo,
  type EstadoDaLinhaDeConsumo,
  type LinhaDeConsumo,
  type MedidaDaVariavel,
  type PapelDaColunaDeConsumo,
  type RendimentoDaVigencia,
} from "@workspace/comparison/consumo";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Consumo — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/consumo`, que o servidor também
 * importa: estado, diferença, variação, impacto, rendimento por vigência, o preço
 * do litro e as três conferências saem de lá.
 *
 * **A decisão de apresentação que mais pesa nesta tela é a cor.** Aqui, e em
 * nenhuma outra deste produto, uma coluna sobe quando o custo desce: um km/l
 * maior é menos diesel por quilômetro. Pintar rendimento com a régua do custo
 * diria o contrário do que aconteceu, numa tela cuja pergunta é exatamente essa —
 * e é por isso que `RENDIMENTO` é papel próprio no núcleo, e não mais uma razão.
 */

/** O que a API de `/consumo/comparacao` devolve. */
export interface ComparacaoDeConsumo {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  resumo: {
    trechosComparados: number;
    semAlteracao: number;
    trechosComAlteracao: number;
    novosNaVigencia: number;
    ausentesNaComparada: number;
    variaveisAlteradas: number;
    trechosComDadoIncompleto: number;
    trechosComConflito: number;
    impacto: {
      porPeriodicidade: Record<string, number>;
      naoCalculavel: number;
      foraDaSoma: number;
      razoesAlteradas: number;
      rendimentosAlterados: number;
      perdasAlteradas: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    papel: PapelDaColunaDeConsumo;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeConsumo;
    rotulo: string;
    trechos: number;
    fracao: number;
  }[];
  linhas: LinhaDeConsumo[];
}

/** O que a API de `/consumo/totais` devolve: as duas séries da mesma leitura. */
export interface TotaisDeConsumo {
  rendimento: RendimentoDaVigencia[];
  conferencias: ConferenciaDaVigenciaDeConsumo[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * `RENDIMENTO` sai com duas casas e a unidade colada: `2,50 km/l`. Sem a unidade,
 * `2,50` na mesma coluna que um `2,40` que é R$/km são dois números idênticos que
 * significam coisas opostas.
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
  if (valor === null || valor === "") return "—";
  if (medida === "TEXTO") return valor;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "DINHEIRO":
      return formatBrl(numero);
    case "REAIS_POR_KM":
      return `${formatNumber(numero, 4)} R$/km`;
    case "RENDIMENTO":
      return `${formatNumber(numero, 2)} km/l`;
    case "DISTANCIA":
      return `${formatNumber(numero, 1)} km`;
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    default:
      return valor;
  }
}

/** A diferença, com sinal explícito e na unidade certa. */
export function escreverDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null) return "—";
  const sinal = diferenca > 0 ? "+" : diferenca < 0 ? "−" : "";
  const absoluto = Math.abs(diferenca);
  switch (medida) {
    case "DINHEIRO":
      return `${sinal}${formatBrl(absoluto)}`;
    case "REAIS_POR_KM":
      return `${sinal}${formatNumber(absoluto, 4)} R$/km`;
    case "RENDIMENTO":
      return `${sinal}${formatNumber(absoluto, 2)} km/l`;
    case "DISTANCIA":
      return `${sinal}${formatNumber(absoluto, 1)} km`;
    case "PERCENTUAL":
      return `${sinal}${formatNumber(absoluto, 2)} p.p.`;
    default:
      return `${sinal}${formatNumber(absoluto, 0)}`;
  }
}

/** A variação em pontos percentuais. Nula quando a base é zero. */
export function escreverVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const sinal = variacao > 0 ? "+" : variacao < 0 ? "−" : "";
  return `${sinal}${formatNumber(Math.abs(variacao), 2)}%`;
}

/** Um R$/km escrito, sempre com quatro casas. */
export function escreverReaisPorKm(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor, 4)} R$/km`;
}

/** Um rendimento escrito, com duas casas. */
export function escreverRendimento(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor, 2)} km/l`;
}

/**
 * Um preço do litro escrito — e o `/l` é parte do número, não enfeite.
 *
 * Este é o único número deste produto que **não vem de coluna nenhuma**: ele é o
 * produto de duas. Escrito como "R$ 6,00", ele se confundiria com qualquer outro
 * valor em reais da tela; escrito como "R$ 6,00/l", ele diz o que é.
 */
export function escreverPrecoDoLitro(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatBrl(valor)}/l`;
}

/**
 * A cor de um número que subiu ou desceu — **e as duas réguas, que são duas**.
 *
 * Em **dinheiro** vale a régua do produto inteiro: positivo é ganho e sai em
 * verde, negativo é perda e sai em vermelho. Houve aqui a régua inversa ("R$/km
 * que sobe é vermelho, como em toda tela de custo"), e ela saiu com a mesma
 * leitura no Monitor, no Aluguel e nos Impostos — ver
 * `docs/PROVA-DA-EVOLUCAO-DE-FINAME.md`.
 *
 * Em **grandeza física** a régua é outra, e continua sendo, porque ali não há
 * sinal de dinheiro para ler:
 *
 * - **rendimento que sobe é verde** — um conjunto que passou de 2,4 para 2,6 km
 *   por litro gasta menos diesel no mesmo percurso, e pintá-lo de vermelho
 *   porque "o número subiu" seria a tela contradizendo a própria pergunta;
 * - **perda que sobe é vermelha**, pelo motivo simétrico: mais perda é menos
 *   rendimento.
 *
 * Misturar as duas é o erro que esta função existe para não cometer: km/l não é
 * um valor em reais, e a régua do sinal não fala sobre ele.
 */
export function corDaDiferenca(
  diferenca: number | null,
  papel: PapelDaColunaDeConsumo,
): string {
  if (diferenca === null || diferenca === 0) return "";
  /* As duas grandezas físicas, com a régua própria de cada uma. */
  if (papel === "RENDIMENTO") return diferenca > 0 ? "text-success" : "text-destructive";
  if (papel === "PERDA") return diferenca > 0 ? "text-destructive" : "text-success";
  if (papel !== "RAZAO" && papel !== "POR_VIAGEM") return "";
  /* Dinheiro: positivo é ganho. */
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeConsumo, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/** Como a tela escreve a unidade de cada papel, curto. */
export const UNIDADE_DO_PAPEL: Record<PapelDaColunaDeConsumo, string> = {
  RENDIMENTO: "km/l",
  RAZAO: "R$/km",
  POR_VIAGEM: "R$/viagem",
  PERDA: "%",
  CONTEXTO: "—",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_VEREDITO_DO_CONSUMO };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeConsumo;
  rotulo: string;
}[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

export interface FiltrosDeConsumo {
  busca: string;
  papel: "TODOS" | PapelDaColunaDeConsumo;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeConsumo;
  /** Só os dois rendimentos — o eixo da rubrica, sem o dinheiro. */
  soRendimento: boolean;
}

export const FILTROS_VAZIOS: FiltrosDeConsumo = {
  busca: "",
  papel: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soRendimento: false,
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar de
 * ser reutilizado.
 */
export function filtrar(
  linhas: readonly LinhaDeConsumo[],
  filtros: FiltrosDeConsumo,
): LinhaDeConsumo[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.papel !== "TODOS" && l.papel !== filtros.papel) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soRendimento && l.papel !== "RENDIMENTO") return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeConsumo[],
  filtros: FiltrosDeConsumo,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = filtrar(linhas, { ...filtros, estado: aba.chave }).length;
  }
  contagem.TODAS = filtrar(linhas, { ...filtros, estado: "TODAS" }).length;
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsvDeConsumo`), e aqui só se converte
 * número em texto do Excel brasileiro.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeConsumo[],
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_CONSUMO],
    ...linhas.map((l) =>
      celulasDoCsvDeConsumo(
        l,
        l.id === null ? null : (justificadaPor?.get(l.id)?.texto ?? null),
      ).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}

/**
 * O impacto por periodicidade, escrito — e quase sempre vazio.
 *
 * Vazio não é defeito nesta rubrica: nenhuma coluna desta tela é dinheiro do
 * período. Quem diz isso por extenso é o cartão; esta função só escreve o que
 * houver.
 */
export function escreverImpacto(
  porPeriodicidade: Record<string, number>,
): { rotulo: string; valor: string; bruto: number }[] {
  return Object.entries(porPeriodicidade)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodicidade, valor]) => ({
      rotulo: periodicidade.toLowerCase(),
      valor: `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${formatBrl(Math.abs(valor))}`,
      bruto: valor,
    }));
}
