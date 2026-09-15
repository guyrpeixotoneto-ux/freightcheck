import {
  DIRECAO_ECONOMICA,
  ROTULO_DO_ESTADO,
  celulasDoCsvDeLucroFixo,
  COLUNAS_DO_CSV_DE_LUCRO_FIXO,
  type Coexistencia,
  type EstadoDaLinhaDeLucroFixo,
  type LinhaDeLucroFixo,
  type MedidaDaVariavel,
  type ViradaDeCiclo,
} from "@workspace/comparison/lucro-fixo";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de Lucro Fixo — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/lucro-fixo`, que o servidor
 * também importa: estado, diferença, variação, impacto, viradas de ciclo,
 * coexistências e agregados saem de lá, e a tela nunca refaz nenhum deles.
 *
 * O que este arquivo acrescenta é apresentação — e, nesta rubrica, uma decisão
 * que não é só apresentação disfarçada: **a cor.** Ver {@link corDaDiferenca}.
 */

/** O que a API de `/lucro-fixo/comparacao` devolve. */
export interface ComparacaoDeLucroFixo {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  resumo: {
    veiculosComparados: number;
    semAlteracao: number;
    veiculosComAlteracao: number;
    novosNaVigencia: number;
    ausentesNaComparada: number;
    variaveisAlteradas: number;
    veiculosComDadoIncompleto: number;
    veiculosComConflito: number;
    entraramNoSegundoCiclo: number;
    voltaramAoPrimeiroCiclo: number;
    impacto: {
      porPeriodicidade: Record<string, number>;
      naoCalculavel: number;
      foraDaSoma: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeLucroFixo;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
  linhas: LinhaDeLucroFixo[];
}

/** O que a API de `/lucro-fixo/totais` devolve: as duas séries da mesma leitura. */
export interface TotaisDeLucroFixo {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    total: number;
    veiculos: number;
    noSegundoCiclo: number;
  }[];
  coexistencias: Coexistencia[];
}

export type { ViradaDeCiclo };

/**
 * Um valor escrito na unidade da própria variável.
 *
 * O ciclo sai como "Ciclo 2", e não como "2": o número sozinho, numa coluna ao
 * lado de reais e de anos, não diz o que é. É a razão de `CICLO` existir como
 * medida em vez de o ciclo pegar carona em `ANO` — que daria o número certo sob
 * o rótulo errado.
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
  if (valor === null || valor === "") return "—";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "DINHEIRO":
      return formatBrl(numero);
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    case "MESES":
      return `${formatNumber(numero, 0)} ${numero === 1 ? "mês" : "meses"}`;
    case "ANO":
      return formatNumber(numero, 0);
    case "CICLO":
      return `Ciclo ${formatNumber(Math.trunc(numero), 0)}`;
    case "DATA":
      return valor;
    default:
      return valor;
  }
}

/**
 * A diferença, com sinal explícito e na unidade certa.
 *
 * O ciclo não ganha diferença escrita como número: "+1 ciclo" é uma frase que
 * ninguém diz, e o que interessa numa troca de ciclo é **de onde para onde**,
 * que a tabela já mostra nas duas colunas ao lado.
 */
export function escreverDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null) return "—";
  if (medida === "CICLO") return "—";
  const sinal = diferenca > 0 ? "+" : diferenca < 0 ? "−" : "";
  const absoluto = Math.abs(diferenca);
  switch (medida) {
    case "DINHEIRO":
      return `${sinal}${formatBrl(absoluto)}`;
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

/**
 * A cor de um número que subiu ou desceu — a mesma régua de FINAME e IPVA.
 *
 * A rubrica é `Receita bruta` (`DIRECAO_ECONOMICA`), e subir é **verde**: um
 * lucro fixo que cresceu é mais dinheiro entrando.
 *
 * **A amortização segue a mesma direção**, e não a régua de custo que esta
 * função já usou. Ela também é linha remunerada na tabela de frete, não a
 * prestação que a transportadora paga ao banco: uma amortização que cai é
 * rubrica deixando de ser paga — piora, e sai em vermelho. Decidir por variável
 * pintava de verde a pior notícia da tabela.
 *
 * Ciclo, ano e data continuam sem cor: eles não têm lado bom, e pintá-los
 * afirmaria um juízo que esta tela não tem como sustentar.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeLucroFixo, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/**
 * O selo do sentido de uma virada de ciclo.
 *
 * `ENTROU_NO_SEGUNDO` é verde: é o ativo que terminou de amortizar e passou a
 * ser remunerado — a virada que o modelo prevê e a boa notícia da tela.
 * `VOLTOU_AO_PRIMEIRO` é aviso, e não erro: um ativo não desamortiza, então ou
 * houve reclassificação ou houve defeito de cadastro. Chamar de erro afirmaria
 * qual dos dois, e a tela não sabe.
 */
export const SELO_DO_SENTIDO: Record<ViradaDeCiclo["sentido"], string> = {
  ENTROU_NO_SEGUNDO: "bg-success/12 text-success border border-success/25",
  VOLTOU_AO_PRIMEIRO: "bg-warning/15 text-warning-foreground border border-warning/40",
  OUTRO: "bg-muted text-muted-foreground border border-border",
};

export const ROTULO_DO_SENTIDO: Record<ViradaDeCiclo["sentido"], string> = {
  ENTROU_NO_SEGUNDO: "Terminou de amortizar",
  VOLTOU_AO_PRIMEIRO: "Voltou ao primeiro ciclo",
  OUTRO: "Outro ciclo",
};

export { ROTULO_DO_ESTADO, DIRECAO_ECONOMICA };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: {
  chave: "TODAS" | EstadoDaLinhaDeLucroFixo;
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

export interface FiltrosDeLucroFixo {
  busca: string;
  tipo: string;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeLucroFixo;
  /** Só os veículos que trocaram de ciclo — a pergunta própria desta tela. */
  soViradas: boolean;
}

export const FILTROS_VAZIOS: FiltrosDeLucroFixo = {
  busca: "",
  tipo: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soViradas: false,
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * `soViradas` recorta por **veículo**, e não por linha: quem pede as viradas
 * quer as quatro linhas daquele ativo — o ciclo, o lucro fixo que entrou, a
 * amortização que saiu e o ano —, não só a linha do ciclo. Filtrar por linha
 * deixaria na tela a virada sem o dinheiro que a explica.
 */
export function filtrar(
  linhas: readonly LinhaDeLucroFixo[],
  filtros: FiltrosDeLucroFixo,
  viradas: readonly ViradaDeCiclo[] = [],
): LinhaDeLucroFixo[] {
  const busca = filtros.busca.trim().toLowerCase();
  const comVirada = new Set(viradas.map((v) => `${v.entityLabel}${v.entityType}`));
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.tipo !== "TODOS" && l.entityType !== filtros.tipo) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soViradas && !comVirada.has(`${l.entityLabel}${l.entityType}`)) {
      return false;
    }
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeLucroFixo[],
  filtros: FiltrosDeLucroFixo,
  viradas: readonly ViradaDeCiclo[] = [],
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = filtrar(linhas, { ...filtros, estado: aba.chave }, viradas).length;
  }
  contagem.TODAS = filtrar(linhas, { ...filtros, estado: "TODAS" }, viradas).length;
  return contagem;
}

/** A tabela virando as linhas do CSV. */
export function linhasDoCsv(linhas: readonly LinhaDeLucroFixo[]): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_LUCRO_FIXO],
    ...linhas.map((l) =>
      celulasDoCsvDeLucroFixo(l).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}

/**
 * O impacto por periodicidade, escrito.
 *
 * Nunca um total único. E o sinal aqui é de receita: `+` é mais dinheiro
 * entrando — o mesmo que o `+` significa nas telas de FINAME e IPVA.
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
