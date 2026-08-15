/**
 * O contrato das rotas `/dre`, do lado da tela.
 *
 * Espelha `@workspace/dre` sem importá-lo, pelo mesmo motivo de
 * `components/composicao/tipos.ts`: o pacote é de servidor e carrega o driver do
 * Postgres junto. Um `import type` atravessaria o `tsconfig` mas não o bundler.
 */

export type EscopoApuravel = "CAVALO" | "CARRETA" | "CONJUNTO";

export type NaturezaDoValor = "OBSERVADO" | "CALCULADO" | "PRESUMIDO" | "NAO_DISPONIVEL";

export type MotivoDeAusencia =
  | "SEM_COLUNA_NA_FONTE"
  | "COLUNA_SEM_DADO"
  | "SEMANTICA_NAO_CONFIRMADA"
  | "BASE_OPERACIONAL_AUSENTE"
  | "GRANDEZA_DE_AQUISICAO";

export type SecaoId =
  | "RECEITA_BRUTA"
  | "DEDUCOES"
  | "CUSTO_VARIAVEL"
  | "CUSTO_FIXO"
  | "DEPRECIACAO_FINANCEIRO";

export type SubtotalId =
  | "RECEITA_BRUTA"
  | "RECEITA_LIQUIDA"
  | "MARGEM_CONTRIBUICAO"
  | "EBITDA"
  | "RESULTADO_ECONOMICO";

export type EstadoDaDRE = "COMPLETA" | "PARCIALMENTE_APURADA" | "INCONCLUSIVA";

export interface Transformacao {
  valorOriginal: number;
  periodicidadeOriginal: string;
  competencia: string;
  fator: number;
  natureza: "EXATA" | "PROJECAO_LINEAR" | "PONTUAL_INTEGRAL";
  explicacao: string;
  formula: string | null;
}

export interface OrigemDoValor {
  attributeCode: string;
  titulo: string;
  entityType: string;
  entityId: string;
  placa: string | null;
  valorNaFonte: number;
  valorNaDRE: number;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  semanticsStatus: string;
  semanticsVersion: number | null;
  calculationBasis: string | null;
  costClass: string | null;
  taxonomyPath: string | null;
  transformacao: Transformacao;
  celula: {
    sourceLabel: string;
    sheetName: string | null;
    rowIndex: number | null;
    columnLetter: string | null;
    columnHeader: string | null;
    rawValue: string | null;
  } | null;
  excluidoDaComposicaoPor: string | null;
}

export interface LinhaDaDRE {
  code: string;
  titulo: string;
  secao: SecaoId;
  sinal: 1 | -1;
  escopo: string;
  valor: number | null;
  natureza: NaturezaDoValor;
  contribuicao: number | null;
  percentualDaReceita: number | null;
  origens: OrigemDoValor[];
  ausencia: { motivo: MotivoDeAusencia; rotulo: string; oQueFalta: string } | null;
  essencial: boolean;
  evidencia: string;
}

export interface SubtotalDaDRE {
  id: SubtotalId;
  titulo: string;
  valor: number | null;
  conclusivo: boolean;
  bloqueadoPor: {
    code: string;
    titulo: string;
    motivo: MotivoDeAusencia;
    rotulo: string;
    oQueFalta: string;
  }[];
  percentualDaReceita: number | null;
  valorParcial: number | null;
}

export interface SecaoDaDRE {
  id: SecaoId;
  titulo: string;
  nota: string;
  linhas: LinhaDaDRE[];
  total: number | null;
  fecha: SubtotalId;
}

export interface CoberturaDaDRE {
  aplicaveis: number;
  apurados: number;
  percentual: number;
  essenciaisAplicaveis: number;
  essenciaisApurados: number;
  percentualEssencial: number;
  itens: {
    code: string;
    titulo: string;
    secao: SecaoId;
    essencial: boolean;
    apurado: boolean;
    motivo: MotivoDeAusencia | null;
    rotulo: string | null;
  }[];
  metodo: string;
}

export interface ApuracaoDaDRE {
  escopo: string;
  competencia: string;
  effectiveDate: string;
  periodLabel: string;
  identidade: { entityId: string; entityType: string; placa: string | null }[];
  secoes: SecaoDaDRE[];
  subtotais: SubtotalDaDRE[];
  cobertura: CoberturaDaDRE;
  estado: EstadoDaDRE;
  aguardandoCuradoria: { code: string; titulo: string; oQueFalta: string }[];
}

export interface ConsolidadoDaDRE extends Omit<ApuracaoDaDRE, "identidade" | "competencia"> {
  unidades: number;
  ativos: number;
  distribuicao: {
    comResultado: number;
    positivas: number;
    negativas: number;
    neutras: number;
    semResultado: number;
  };
}

export interface LinhaDoRanking {
  id: string;
  rotulo: string;
  escopo: string;
  entityIds: string[];
  orfa: boolean;
  receita: number | null;
  resultado: number | null;
  margemPercentual: number | null;
  custo: number | null;
  cobertura: number;
  estado: EstadoDaDRE;
  variacaoResultado: number | null;
  variacaoResultadoPercentual: number | null;
  variacaoReceita: number | null;
}

export interface Alerta {
  id: string;
  rotulo: string;
  entityIds: string[];
  motivo: "RESULTADO_NEGATIVO" | "RESULTADO_DETERIOROU" | "MARGEM_BAIXA" | "RECEITA_CAIU" | "SEM_APURACAO";
  severidade: "CRITICO" | "ATENCAO";
  mensagem: string;
  numeros: Record<string, number>;
}

export interface Vigencias {
  todas: { effectiveDate: string; periodLabel: string }[];
  alvo: { effectiveDate: string; periodLabel: string };
  anterior: { effectiveDate: string; periodLabel: string } | null;
}

export interface DREDaFrota {
  escopo: EscopoApuravel;
  contexto: { label: string; scopeHash: string; canal: string | null; unidade: string | null };
  vigencias: Vigencias;
  consolidado: ConsolidadoDaDRE;
  consolidadoAnterior: ConsolidadoDaDRE | null;
  ranking: LinhaDoRanking[];
  atencao: Alerta[];
  totalSemFiltro: number;
  aviso: string;
}

export interface DREDoVeiculo {
  unidade: {
    id: string;
    escopo: EscopoApuravel;
    rotulo: string;
    lados: { entityId: string; entityType: string; placa: string | null; chassi: string | null }[];
    orfa: boolean;
  };
  contexto: { label: string; scopeHash: string; canal: string | null; unidade: string | null };
  vigencias: Vigencias;
  atual: ApuracaoDaDRE;
  anterior: ApuracaoDaDRE | null;
  aviso: string;
}

export interface AlteracaoNaDRE {
  changeId: number;
  attributeCode: string | null;
  attributeName: string | null;
  entityId: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valorAntes: string | null;
  valorDepois: string | null;
  impacto: number | null;
  impactoPeriodicidade: string | null;
  impactoConfianca: string;
  impactoMotivo: string | null;
  linhaDaDRE: { code: string; titulo: string; secao: string; sinal: 1 | -1 } | null;
  efeitoNoResultado: number | null;
  transformacao: Transformacao | null;
  motivoDaExclusao: string | null;
}

export interface PonteDaDRE {
  entityId: string;
  escopo: EscopoApuravel;
  competencia: string;
  de: { effectiveDate: string; periodLabel: string } | null;
  para: { effectiveDate: string; periodLabel: string };
  alteracoes: AlteracaoNaDRE[];
  queMexeramNaDRE: AlteracaoNaDRE[];
  saldo: number | null;
  variacaoDoResultado: number | null;
  naoAtribuido: number | null;
  porLinha: { code: string; titulo: string; secao: string; efeito: number; alteracoes: number }[];
  explicacao: {
    resumo: string;
    responsaveis: { titulo: string; efeito: number; frase: string }[];
    ressalva: string | null;
  } | null;
}

export interface HistoricoDaDRE {
  escopo: EscopoApuravel;
  entityId: string | null;
  rotulo: string;
  pontos: {
    effectiveDate: string;
    periodLabel: string;
    presente: boolean;
    receita: number | null;
    resultado: number | null;
    margemPercentual: number | null;
    cobertura: number;
  }[];
  componentes: { code: string; titulo: string; valores: (number | null)[] }[];
}

// ---------------------------------------------------------------------------

export const ROTULO_DO_ESCOPO: Record<EscopoApuravel, string> = {
  CAVALO: "Cavalo",
  CARRETA: "Carreta",
  CONJUNTO: "Conjunto",
};

export const ROTULO_DO_ESTADO: Record<EstadoDaDRE, string> = {
  COMPLETA: "DRE completa",
  PARCIALMENTE_APURADA: "DRE parcialmente apurada",
  INCONCLUSIVA: "DRE inconclusiva",
};

export const CRITERIOS = [
  { id: "MENOR_RESULTADO", rotulo: "Menor resultado" },
  { id: "MAIOR_RESULTADO", rotulo: "Maior resultado" },
  { id: "MENOR_MARGEM", rotulo: "Menor margem" },
  { id: "MAIOR_MARGEM", rotulo: "Maior margem" },
  { id: "MAIOR_RECEITA", rotulo: "Maior receita" },
  { id: "MAIOR_CUSTO", rotulo: "Maior custo" },
  { id: "MAIOR_DETERIORACAO", rotulo: "Maior deterioração" },
  { id: "MAIOR_MELHORA", rotulo: "Maior melhora" },
] as const;
