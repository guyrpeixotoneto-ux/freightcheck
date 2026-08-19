/**
 * Os tipos das respostas de `/qlp/administrativo*` — espelho manual de
 * `lib/qlp/src`, como os demais domínios (`components/composicao/tipos.ts`).
 */

export interface ContextoDaResposta {
  scopeHash: string;
  channel: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  latestPeriod: string;
  periods: number;
  periodosDisponiveis: string[];
  periodosNaJanela: number;
  janela: { de: string; ate: string } | null;
}

export interface VigenciaDoQuadro {
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
}

export interface SemanticaDaColuna {
  status: string;
  isMonetary: boolean | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
}

export interface AtributoDoQuadro {
  code: string;
  sourceName: string;
  displayName: string | null;
  dataType: string;
  semantica: SemanticaDaColuna;
}

export type ValorDeFato = number | string | boolean | null;

export interface CargoDoQuadro {
  entityId: string;
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
  valores: Record<string, ValorDeFato>;
}

export interface UnidadeDoQuadro {
  cnpj: string;
  cnpjLegivel: string;
  nome: string | null;
  cargos: CargoDoQuadro[];
}

export interface MetricaApuravel {
  valor: number | null;
  motivo: string | null;
}

export interface ResumoDoQuadro {
  unidades: number;
  cargos: number;
  efetivo: MetricaApuravel;
  custo: MetricaApuravel;
  numericosPendentes: number;
  apuracaoCompleta: boolean;
  curadoria: { confirmados: number; total: number };
}

export interface VisaoDoQuadro {
  context: ContextoDaResposta;
  effectiveDate: string;
  periodLabel: string;
  anterior: string | null;
  vigencias: VigenciaDoQuadro[];
  resumo: ResumoDoQuadro;
  atributos: AtributoDoQuadro[];
  unidades: UnidadeDoQuadro[];
  filtros: { busca?: string; unidade?: string };
}

export interface OrigemDoFato {
  arquivo: string | null;
  aba: string | null;
  linha: number | null;
  coluna: string | null;
  cabecalho: string | null;
  valorBruto: string | null;
}

export interface FatoDoCargo {
  code: string;
  sourceName: string;
  displayName: string | null;
  dataType: string;
  valor: ValorDeFato;
  isNull: boolean;
  nullReason: string | null;
  semantica: SemanticaDaColuna;
  herdadoDe: string | null;
  origem: OrigemDoFato;
}

export interface DetalheDoCargo {
  context: ContextoDaResposta;
  effectiveDate: string;
  periodLabel: string;
  anterior: string | null;
  vigencias: VigenciaDoQuadro[];
  entityId: string;
  cargo: string;
  unidadeCnpjLegivel: string;
  chaveLegivel: string;
  presente: boolean;
  atributos: FatoDoCargo[];
  vigenciasDoCargo: { effectiveDate: string; periodLabel: string }[];
}

export interface VigenciaDaEvolucao {
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  cargos: number;
  unidades: number;
  fatos: number;
  valores: number;
  nulos: number;
  herdados: number;
}

export interface CargoNaSerie {
  entityId: string;
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
  presencas: boolean[];
}

export interface EvolucaoDoQuadro {
  context: ContextoDaResposta;
  vigencias: VigenciaDaEvolucao[];
  quadro: CargoNaSerie[];
}
