/**
 * O contrato das rotas `/composition`, do lado da tela.
 *
 * Espelha `@workspace/composition` sem importá-lo: o pacote é de servidor e
 * carrega o driver do Postgres junto. Um `import type` atravessaria o
 * `tsconfig` mas não o bundler, e o custo de manter estes tipos à mão é menor
 * que o de arrastar o banco para dentro do navegador.
 */

export type Farol = "NORMAL" | "ATENCAO" | "CRITICO" | "INCOMPLETO";
export type Gaveta = "MENSAL" | "ANUAL" | "AQUISICAO";

export type MotivoDeExclusao =
  | "SEMANTICA_NAO_CONFIRMADA"
  | "NAO_MONETARIO"
  | "NAO_SOMAVEL"
  | "SEM_PERIODICIDADE"
  | "PERIODICIDADE_NAO_MENSAL"
  | "PARCELA_DE_TOTAL"
  | "ESCOPO_DE_CONJUNTO"
  | "BASE_AUSENTE"
  | "VALOR_AUSENTE"
  | "VALOR_NAO_NUMERICO";

/**
 * Por que não há remuneração apurada — o espelho de `MotivoDaNaoApuracao`, em
 * `@workspace/composition`.
 *
 * Três lacunas de donos diferentes que a tela chamava igual: curadoria por
 * fazer, produção não medida, e célula vazia na vigência.
 */
export type MotivoDaNaoApuracao =
  | "SEMANTICA_NAO_CONFIRMADA"
  | "PRODUCAO_AUSENTE"
  | "VALOR_AUSENTE"
  | "SEM_COMPONENTE_MENSAL";

/** O rótulo curto, onde antes se lia "não apurado". */
export const ROTULO_DA_NAO_APURACAO: Record<MotivoDaNaoApuracao, string> = {
  SEMANTICA_NAO_CONFIRMADA: "aguardando curadoria",
  PRODUCAO_AUSENTE: "aguardando produção",
  VALOR_AUSENTE: "sem valor na vigência",
  SEM_COMPONENTE_MENSAL: "nada mensal nesta vigência",
};

export interface Status {
  farol: Farol;
  motivos: string[];
  alertas: number;
  naoApuradoPor: MotivoDaNaoApuracao | null;
}

export interface Variacao {
  absoluta: number;
  percentual: number | null;
}

export interface LinhaDaFrota {
  entityId: string;
  placa: string | null;
  chassi: string | null;
  entityType: string;
  rotuloDoTipo: string;
  unidade: string | null;
  operacao: string | null;
  effectiveDate: string;
  periodLabel: string;
  /* Sem `presente`: toda linha desta lista veio na vigência — ver `lib/composition/src/frota.ts`. */
  mensal: number | null;
  componentes: number;
  semRegraFinanceira: number;
  /** Números deste equipamento que a curadoria ainda não classificou. */
  semClassificacao: number;
  variacao: Variacao | null;
  status: Status;
}

export interface VisaoDeFrota {
  entityType: string;
  rotuloDoTipo: string;
  context: {
    scopeHash: string;
    channel: string | null;
    label: string;
    unidade: string | null;
  };
  effectiveDate: string;
  periodLabel: string;
  anterior: { effectiveDate: string; periodLabel: string } | null;
  vigencias: { effectiveDate: string; periodLabel: string }[];
  serieEntregue: boolean;
  resumo: {
    equipamentos: number;
    comValorApurado: number;
    mensalTotal: number;
    variacaoTotal: number | null;
    comAumento: number;
    comReducao: number;
    semVariacao: number;
    incompletos: number;
    componentesSemRegra: number;
    componentesSemClassificacao: number;
    equipamentosComPendencia: number;
    /**
     * A única resposta autorizada a "a frota está apurada?". Nenhuma tela pode
     * afirmar completude sem consultar este campo — ver `ResumoDaFrota` em
     * `@workspace/composition`.
     */
    apuracaoCompleta: boolean;
    porFarol: Record<Farol, number>;
  };
  linhas: LinhaDaFrota[];
  totalSemFiltro: number;
}

// ---------------------------------------------------------------------------
// Conjuntos — o cavalo e a carreta lidos como uma unidade só
// ---------------------------------------------------------------------------

/** Como o conjunto se formou, ou por que não se formou. */
export type NaturezaDoVinculo =
  | "PAREADO"
  | "CAVALO_SEM_VINCULO"
  | "PLACA_SEM_CARRETA"
  | "PLACA_DISPUTADA"
  | "CARRETA_ORFA";

export const ROTULO_DA_NATUREZA: Record<NaturezaDoVinculo, string> = {
  PAREADO: "Cavalo + carreta",
  CAVALO_SEM_VINCULO: "Cavalo sem carreta",
  PLACA_SEM_CARRETA: "Placa sem carreta",
  PLACA_DISPUTADA: "Placa disputada",
  CARRETA_ORFA: "Carreta sem cavalo",
};

export interface ComponenteDoLado {
  code: string;
  titulo: string;
  valor: number;
}

export interface LadoDoConjunto {
  entityId: string;
  entityType: string;
  placa: string | null;
  chassi: string | null;
  mensal: number | null;
  componentes: ComponenteDoLado[];
  semRegraFinanceira: number;
  naoApuradoPor: MotivoDaNaoApuracao | null;
}

export interface LinhaDoConjunto {
  id: string;
  rotulo: string;
  natureza: NaturezaDoVinculo;
  explicacaoDoVinculo: string;
  placaApontada: string | null;
  /* Sem `presente`, pela mesma razão de `LinhaDaFrota`. */
  cavalo: LadoDoConjunto | null;
  carreta: LadoDoConjunto | null;
  apurado: number | null;
  declarado: number | null;
  declaradoCode: string | null;
  declaradoTitulo: string | null;
  fonte: string | null;
  divergencia: number | null;
  fecha: boolean | null;
  variacao: Variacao | null;
  carretaAnterior: string | null;
  status: { farol: Farol; motivos: string[]; alertas: number };
}

export interface VisaoDeConjuntos {
  context: {
    scopeHash: string;
    channel: string | null;
    label: string;
    unidade: string | null;
  };
  effectiveDate: string;
  periodLabel: string;
  anterior: { effectiveDate: string; periodLabel: string } | null;
  vigencias: { effectiveDate: string; periodLabel: string }[];
  seriesEntregues: { CAVALO: boolean; CARRETA: boolean };
  toleranciaDaConferencia: number;
  resumo: {
    conjuntos: number;
    pareados: number;
    carretasOrfas: number;
    cavalosSemCarreta: number;
    vinculosQuebrados: number;
    comDeclarado: number;
    declaradoTotal: number | null;
    apuradoTotal: number | null;
    conferidos: number;
    fecham: number;
    divergem: number;
    divergenciaTotal: number | null;
    variacaoTotal: number | null;
    comAumento: number;
    comReducao: number;
    trocaramDeCarreta: number;
    porFarol: Record<Farol, number>;
  };
  linhas: LinhaDoConjunto[];
  totalSemFiltro: number;
}

// ---------------------------------------------------------------------------
// Rastreio — do arquivo até esta tela
// ---------------------------------------------------------------------------

/** O espelho de `DestinoDaCelula`, em `@workspace/composition`. */
export type DestinoDaCelula =
  | "VIROU_FATO"
  | "ENDERECO"
  | "COLUNA_SEM_CABECALHO"
  | "COLUNA_AMBIGUA"
  | "SEM_DESTINO";

export const ROTULO_DO_DESTINO: Record<DestinoDaCelula, string> = {
  VIROU_FATO: "Virou fato e está nesta ficha",
  ENDERECO: "Endereço do fato (placa e vigência)",
  COLUNA_SEM_CABECALHO: "Coluna sem cabeçalho",
  COLUNA_AMBIGUA: "Coluna ambígua",
  SEM_DESTINO: "Sem destino declarado",
};

export interface RastreioDoEquipamento {
  linhasDoArquivo: number;
  celulas: number;
  viraramFato: number;
  endereco: number;
  colunaSemCabecalho: number;
  colunaAmbigua: number;
  semDestino: number;
  fatos: number;
  fatosSemCelula: number;
  /** A única resposta autorizada a "não falta nada desta placa nesta ficha?". */
  fecha: boolean;
  amostras: {
    destino: DestinoDaCelula;
    columnLetter: string | null;
    columnHeader: string | null;
    valor: string | null;
  }[];
}

export interface Parcela {
  code: string;
  titulo: string;
  valor: number | null;
  ausencia: string | null;
}

export interface Origem {
  sourceLabel: string;
  sheetName: string | null;
  rowIndex: number | null;
  columnLetter: string | null;
  columnHeader: string | null;
  rawValue: string | null;
}

export interface LinhaCalculavel {
  code: string;
  titulo: string;
  sourceName: string;
  gaveta: Gaveta;
  valor: number;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  semanticsStatus: string;
  semanticsVersion: number | null;
  calculationBasis: string | null;
  costClass: string | null;
  taxonomyName: string | null;
  taxonomyPath: string | null;
  familia: string;
  parametro: string;
  explicacao: {
    regra: string;
    formula: string | null;
    parcelas: Parcela[];
    divergencia: number | null;
  };
  origem: Origem | null;
}

export interface ComponenteNaoApurado {
  code: string;
  titulo: string;
  sourceName: string;
  valorExibido: string | null;
  valorNumerico: number | null;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  semanticsStatus: string;
  taxonomyName: string | null;
  familia: string;
  parametro: string;
  motivo: MotivoDeExclusao;
  motivoRotulo: string;
  explicacao: string;
  baseQueFalta: string | null;
  contidoEm: string | null;
  monetarioPotencial: boolean;
  /** Número que a curadoria ainda não classificou — nem como dinheiro, nem como não-dinheiro. */
  semClassificacao: boolean;
}

export interface Composicao {
  entityId: string;
  entityType: string;
  rotuloDoTipo: string;
  placa: string | null;
  chassi: string | null;
  unidade: string | null;
  operacao: string | null;
  contextLabel: string;
  scopeHash: string;
  channel: string | null;
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  presente: boolean;
  totais: { gaveta: Gaveta; valor: number; componentes: number }[];
  linhas: LinhaCalculavel[];
  naoApurados: ComponenteNaoApurado[];
  integridade: {
    code: string;
    titulo: string;
    tipo: "TOTAL_NAO_FECHA" | "SEMANTICA_MUDOU";
    mensagem: string;
  }[];
  anterior: {
    effectiveDate: string;
    periodLabel: string;
    presente: boolean;
    mensal: number | null;
  } | null;
  variacaoMensal: Variacao | null;
  completude: {
    calculaveis: number;
    semRegraFinanceira: number;
    semClassificacao: number;
    parcial: boolean;
  };
  /** A conta de conservação desta placa nesta vigência — ver `rastreio.ts`. */
  rastreio: RastreioDoEquipamento;
  status: Status;
  vinculo: {
    placaCarreta: string;
    carretaEntityId: string | null;
    totalDoConjunto: number | null;
    /**
     * Mais de uma carreta corrente com esta placa — estado que o banco não
     * deveria permitir. Quando vem preenchido, `carretaEntityId` é nulo e o
     * atalho aparece sem destino, que é o que a tela já faz quando a carreta
     * não existe.
     */
    ambiguidade: { entityIds: string[] } | null;
  } | null;
}

export interface Historico {
  entityId: string;
  entityType: string;
  placa: string | null;
  pontos: {
    effectiveDate: string;
    periodLabel: string;
    presente: boolean;
    mensal: number | null;
    componentes: number;
    semRegraFinanceira: number;
    semClassificacao: number;
    variacao: Variacao | null;
    componentesAlterados: number;
    naoApuradoPor: MotivoDaNaoApuracao | null;
  }[];
  componentes: {
    code: string;
    titulo: string;
    unit: string | null;
    periodicity: string | null;
    financeiro: boolean;
    pontos: {
      effectiveDate: string;
      periodLabel: string;
      valor: number | null;
      exibicao: string | null;
    }[];
  }[];
}

export interface Alteracao {
  id: number;
  changeType: string;
  nature: string | null;
  attributeCode: string | null;
  attributeName: string | null;
  entityLabel: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  isNullBefore: boolean | null;
  isNullAfter: boolean | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  comparability: string;
  inconclusiveReason: string | null;
  impactConfidence: string;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  impactReason: string | null;
  semanticsStatus: string | null;
  taxonomyName: string | null;
  entraNoTotal: boolean;
  motivo: MotivoDeExclusao | null;
  motivoRotulo: string | null;
  explicacao: string | null;
  familia: string;
  parametro: string;
}

export interface Alteracoes {
  entityId: string;
  placa: string | null;
  de: { effectiveDate: string; periodLabel: string; sourceLabel: string } | null;
  para: { effectiveDate: string; periodLabel: string; sourceLabel: string };
  changeSetId: string | null;
  alteracoes: Alteracao[];
  variacaoMensal: Variacao | null;
  explicado: number | null;
  naoAtribuido: number | null;
}

// ---------------------------------------------------------------------------
// Vocabulário de tela
// ---------------------------------------------------------------------------

export const ROTULO_DA_GAVETA: Record<Gaveta, string> = {
  MENSAL: "Remuneração mensal",
  ANUAL: "Componentes anuais",
  AQUISICAO: "Valores de aquisição",
};

export const NOTA_DA_GAVETA: Record<Gaveta, string> = {
  MENSAL: "O que o equipamento recebe por mês nesta vigência.",
  ANUAL:
    "Confirmados como anuais. Não são divididos por doze — converter exigiria " +
    "uma regra de rateio que ninguém confirmou.",
  AQUISICAO:
    "O valor da nota e os tributos sobre ela. Dizem quanto o ativo custou, " +
    "não quanto ele recebe.",
};

export const SUFIXO_DA_GAVETA: Record<Gaveta, string> = {
  MENSAL: "/mês",
  ANUAL: "/ano",
  AQUISICAO: "",
};

export const ROTULO_DO_FAROL: Record<Farol, string> = {
  NORMAL: "Normal",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
  INCOMPLETO: "Incompleto",
};
