/**
 * As formas que a API de cobertura devolve.
 *
 * Espelham `lib/coverage/src/*` e nada mais: **nenhum destes tipos carrega
 * regra**. A tela não decide o que é lacuna, o que é crítico, nem quanto é a
 * cobertura — ela recebe tudo isso pronto e desenha. A versão anterior desta
 * tela fazia o contrário, e por isso a definição de cobertura do produto morava
 * dentro de um componente React, onde nenhuma outra superfície podia
 * alcançá-la.
 */

export type EstadoDeCobertura =
  | "COMPLETO"
  | "PARCIAL"
  | "AUSENTE"
  | "NOVO"
  | "ALTERADO"
  | "NAO_APLICAVEL";

export type Criticidade = "CRITICO" | "RELEVANTE" | "INFORMATIVO";

export interface Contagem {
  entidadesEsperadas: number;
  entidadesEncontradas: number;
  atributosEsperados: number;
  atributosEncontrados: number;
  combinacoesEsperadas: number;
  combinacoesEncontradas: number;
  combinacoesNaoAplicaveis: number;
  percentual: number;
}

export interface Justificativa {
  origem: "CONTRATO" | "CATALOGO" | "CURADORIA" | "HISTORICO" | "ESTRUTURA";
  declarado: boolean;
  motivo: string;
  medicao: Record<string, number | string | null>;
}

export interface Lacuna {
  attributeCode: string;
  attributeLabel: string;
  entityType: string;
  estado: EstadoDeCobertura;
  criticidade: Criticidade;
  entidadesEsperadas: number;
  entidadesPresentes: number;
  entidadesFaltando: number;
  justificativa: Justificativa;
  possivelSucessor: { attributeCode: string; confianca: number } | null;
  snapshotId: string;
  effectiveDate: string;
  periodo: string;
  datasetFamily: string;
  scopeLabel: string;
}

export interface CelulaDaMatriz {
  vigencia: {
    snapshotId: string;
    effectiveDate: string;
    sourceLabel: string;
    periodo: string;
    revision: number;
  };
  datasetFamily: string;
  entityType: string;
  scopeHash: string;
  scopeLabel: string;
  canal: string;
  estado: EstadoDeCobertura;
  conta: Contagem;
  contaCritica: Contagem;
  lacunas: { critico: number; relevante: number; informativo: number };
  entidadesAusentes: EntidadeAusente[];
  novos: number;
}

/** Um equipamento que era esperado numa vigência e não veio. */
export interface EntidadeAusente {
  entityId: string;
  entityType: string;
  /** A placa ou chassi corrente. */
  rotulo: string;
  /** A última vigência deste recorte em que ela apareceu. */
  ultimaVigencia: string;
  /** Em quantas vigências anteriores deste recorte ela apareceu. */
  vigenciasComDado: number;
}

export interface LinhaDaMatriz {
  chave: string;
  datasetFamily: string;
  entityType: string;
  scopeHash: string;
  scopeLabel: string;
  canal: string;
  rotulo: string;
  celulas: Record<string, CelulaDaMatriz>;
}

export interface ColunaDaMatriz {
  chave: string;
  effectiveDate: string;
  periodo: string;
  rotulos: string[];
}

/**
 * A linha da matriz aberta por dentro: um atributo, ao longo das vigências.
 *
 * Espelha `lib/coverage/src/atributos.ts`. Como todo o resto deste arquivo, não
 * carrega regra: `estado`, `percentual` e `entidadesFaltando` chegam medidos —
 * pela mesma função que a célula da matriz usa para somar o seu percentual —, e
 * a tela só desenha.
 */
export interface CelulaDoAtributo {
  snapshotId: string;
  effectiveDate: string;
  periodo: string;
  sourceLabel: string;
  criticidade: Criticidade;
  justificativa: Justificativa | null;
  entidadesEsperadas: number;
  entidadesPresentes: number;
  entidadesVazias: number;
  naoAplicaveis: number;
  entidadesFaltando: number;
  percentual: number;
  estado: EstadoDeCobertura;
  /** Alguma origem cobra este atributo nesta vigência? */
  esperado: boolean;
  /** A coluna veio no layout desta vigência? */
  noLayout: boolean;
  dispensado: boolean;
  novo: boolean;
}

export interface LinhaDeAtributo {
  attributeCode: string;
  attributeLabel: string;
  sourceName: string | null;
  entityType: string;
  secaoDaDRE: string | null;
  criticidade: Criticidade;
  origem: Justificativa["origem"] | null;
  declarado: boolean;
  motivo: string | null;
  pior: EstadoDeCobertura;
  vigenciasEsperado: number;
  vigenciasComFalta: number;
  entidadesFaltando: number;
  celulas: Record<string, CelulaDoAtributo>;
}

/**
 * A coluna da tabela de atributos: um período, e a vigência que o conjunto teve
 * nele. `snapshotId` nulo é "esta vigência não trouxe este conjunto".
 */
export interface ColunaDoConjunto extends ColunaDaMatriz {
  snapshotId: string | null;
  sourceLabel: string | null;
  revision: number | null;
}

export interface MatrizDeAtributos {
  conjunto: {
    datasetFamily: string;
    familiaLabel: string;
    entityType: string;
    equipamentoLabel: string;
    scopeHash: string;
    scopeLabel: string;
    canal: string;
    rotulo: string;
  };
  colunas: ColunaDoConjunto[];
  linhas: LinhaDeAtributo[];
  resumo: {
    atributos: number;
    comFalta: number;
    criticosComFalta: number;
    nuncaChegaram: number;
    semExpectativa: number;
  };
}

export interface Descoberta {
  attributeCode: string;
  attributeLabel: string;
  sourceName: string;
  entityType: string;
  dataType: string;
  primeiraVigencia: string;
  primeiroRotulo: string;
  importRunId: string | null;
  arquivo: string | null;
  entidadesAfetadas: number;
  datasetFamily: string;
  possivelSucessaoDe: {
    attributeCode: string;
    confianca: number;
    motivos: string[];
  } | null;
  statusDeCuradoria: "PENDENTE" | "DECIDIDO";
}

export interface ResumoDaCobertura {
  geral: Contagem;
  critica: Contagem;
  lacunas: { total: number; critico: number; relevante: number; informativo: number };
  conjuntosParciais: number;
  conjuntosAusentes: number;
  novos: number;
  veredito: { estado: "CONFIAVEL" | "COMPROMETIDA" | "SEM_DADO"; frase: string };
}

export interface VisaoDaCobertura {
  resumo: ResumoDaCobertura;
  colunas: ColunaDaMatriz[];
  linhas: LinhaDaMatriz[];
  lacunas: Lacuna[];
  descobertas: Descoberta[];
  incompleto: { vigencia: string; motivo: string }[];
}

export interface DetalheDaCelula {
  vigencia: {
    snapshotId: string;
    sourceLabel: string;
    effectiveDate: string;
    periodo: string;
    revision: number;
  };
  datasetFamily: string;
  familiaLabel: string;
  entityType: string;
  equipamentoLabel: string;
  scopeLabel: string;
  canal: string;
  estado: EstadoDeCobertura;
  conta: Contagem;
  contaCritica: Contagem;
  lacunas: Lacuna[];
  entidadesAusentes: EntidadeAusente[];
  contribuintes: {
    importRunId: string;
    arquivo: string;
    contentSha256: string;
    recebidoEm: string;
    fatos: number;
    herdados: number;
    equipamentos: string[];
  }[];
  inesperados: { attributeCode: string; attributeLabel: string; entidades: number }[];
}

export interface EntidadeDaLacuna {
  entityId: string;
  identificador: string;
  entityType: string;
  estado: "PRESENTE" | "VAZIO" | "NAO_APLICAVEL" | "AUSENTE";
  nullReason: string | null;
  valor: string | null;
  factId: number | null;
}

/**
 * O que a gaveta precisa saber para abrir — e nada além disso.
 *
 * Identidade, e não conteúdo: os números vêm do servidor, pela mesma função que
 * mediu a célula clicada. A alternativa seria a tela levar consigo o que já
 * tinha na célula e completar com uma chamada, e aí a gaveta exibiria uma
 * medida montada em dois lugares — metade da tabela, metade da resposta.
 */
export interface AberturaDoAtributo {
  /** A vigência do conjunto naquele período. `null`: ele não veio nela. */
  snapshotId: string | null;
  attributeCode: string;
  /** Só para pintar o cabeçalho enquanto a resposta não chega. */
  attributeLabel: string;
  periodo: string;
}

/** A conta de um atributo numa vigência. Espelha `MedidaDoAtributo`. */
export interface MedidaDoAtributo {
  entidadesEsperadas: number;
  entidadesPresentes: number;
  entidadesVazias: number;
  naoAplicaveis: number;
  entidadesFaltando: number;
  percentual: number;
  estado: EstadoDeCobertura;
  esperado: boolean;
  noLayout: boolean;
  dispensado: boolean;
  novo: boolean;
}

export interface DetalheDaLacuna {
  attributeCode: string;
  attributeLabel: string;
  sourceName: string | null;
  entityType: string;
  equipamentoLabel: string;
  criticidade: Criticidade;
  secaoDaDRE: string | null;
  vigencia: {
    snapshotId: string;
    sourceLabel: string;
    effectiveDate: string;
    periodo: string;
    revision: number;
    datasetFamily: string;
    familiaLabel: string;
    scopeHash: string;
    scopeLabel: string;
    canal: string;
  };
  medida: MedidaDoAtributo;
  justificativa: Justificativa | null;
  entidadesNaVigencia: number;
  /** Esperados nesta vigência que não vieram nela. Contam como falta. */
  entidadesAusentes: EntidadeAusente[];
  /** Vieram na vigência e estão sem o dado. */
  entidades: EntidadeDaLacuna[];
  naoListadas: number;
}

export interface PontoDoHistorico {
  effectiveDate: string;
  periodo: string;
  sourceLabel: string;
  snapshotId: string;
  entidadesNaVigencia: number;
  comValor: number;
  vazias: number;
  naoAplicaveis: number;
  noLayout: boolean;
  percentual: number;
}

export interface Proveniencia {
  factId: number;
  valor: string | null;
  isNull: boolean;
  nullReason: string | null;
  atributo: { code: string; label: string; sourceName: string; entityType: string };
  entidade: { id: string; identificador: string; entityType: string };
  vigencia: {
    snapshotId: string;
    sourceLabel: string;
    effectiveDate: string;
    datasetFamily: string;
    canal: string;
    revision: number;
    scopeLabel: string;
  };
  herdadoDe: { snapshotId: string; sourceLabel: string; effectiveDate: string } | null;
  celula: {
    rawCellId: number;
    aba: string;
    linha: number;
    coluna: string;
    cabecalho: string | null;
    valorBruto: string | null;
    textoFormatado: string | null;
  };
  importacao: {
    importRunId: string;
    status: string;
    startedAt: string;
    arquivo: string;
    contentSha256: string;
    recebidoEm: string;
    recebidoPor: string | null;
  };
}

/**
 * A aparência de cada estado.
 *
 * **Nunca só a cor.** Cada estado carrega uma sigla e um rótulo por extenso,
 * e a célula da matriz mostra os dois: quem não distingue verde de vermelho
 * lê a mesma informação, e quem imprime a tela em preto e branco também.
 */
export const APARENCIA: Record<
  EstadoDeCobertura,
  { rotulo: string; sigla: string; classe: string; ponto: string }
> = {
  COMPLETO: {
    rotulo: "Completo",
    sigla: "OK",
    classe: "bg-success/10 text-success border-success/30",
    ponto: "bg-success",
  },
  PARCIAL: {
    rotulo: "Parcial",
    sigla: "PAR",
    classe: "bg-warning/10 text-warning-foreground border-warning/40",
    ponto: "bg-warning",
  },
  AUSENTE: {
    rotulo: "Ausente",
    sigla: "AUS",
    classe: "bg-brand-red/10 text-brand-red border-brand-red/40",
    ponto: "bg-brand-red",
  },
  NOVO: {
    rotulo: "Novo",
    sigla: "NOVO",
    classe: "bg-brand/10 text-brand border-brand/40",
    ponto: "bg-brand",
  },
  ALTERADO: {
    rotulo: "Alterado",
    sigla: "ALT",
    classe: "bg-warning/10 text-warning-foreground border-warning/40",
    ponto: "bg-warning",
  },
  NAO_APLICAVEL: {
    rotulo: "Não aplicável",
    sigla: "N/A",
    classe: "bg-muted text-muted-foreground border-border",
    ponto: "bg-muted-foreground/40",
  },
};

export const APARENCIA_DA_CRITICIDADE: Record<
  Criticidade,
  { rotulo: string; classe: string }
> = {
  CRITICO: { rotulo: "Crítica", classe: "text-brand-red border-brand-red/40 bg-brand-red/10" },
  RELEVANTE: { rotulo: "Relevante", classe: "text-warning-foreground border-warning/40 bg-warning/10" },
  INFORMATIVO: { rotulo: "Informativa", classe: "text-muted-foreground border-border" },
};

/**
 * De onde a expectativa veio, dito em uma palavra para caber num selo.
 *
 * Só o nome da origem. **Declaração ou inferência é o outro eixo**, e ele mora
 * em `justificativa.declarado` — cada lugar que mostra a origem mostra também
 * esse eixo, do jeito que couber ali. Enquanto o rótulo carregava um
 * "(inferido)" embutido, a gaveta o exibia ao lado do seu próprio selo e saía
 * "Inferência · Estrutura (inferido)": a mesma informação duas vezes, numa tela
 * cuja regra é justamente não repetir canal por acidente.
 */
export const ORIGEM_DO_ESPERADO: Record<Justificativa["origem"], string> = {
  CONTRATO: "Contrato",
  CATALOGO: "Catálogo",
  CURADORIA: "Curadoria",
  HISTORICO: "Histórico",
  ESTRUTURA: "Estrutura",
};

export function percentual(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function numero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}
