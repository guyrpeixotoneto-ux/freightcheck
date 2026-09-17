/**
 * O contrato das rotas `/agente-compras`, do lado da tela.
 *
 * Espelha `@workspace/compras/agente` sem importá-lo, pela mesma razão de
 * `components/compras/tipos.ts`: o pacote é de servidor e carrega o driver do
 * Postgres junto — e, desde o Agente, também o SDK do modelo. Um `import type`
 * atravessaria o `tsconfig` mas não o bundler.
 */

import type { Gaveta } from "@/components/composicao/tipos";
import type { ProdutoDeCompra } from "@/components/compras/tipos";

export type Intencao =
  | "PESQUISAR_MERCADO"
  | "REMUNERADO_VERSUS_MERCADO"
  | "PRECO_ALVO"
  | "TETO"
  | "AVALIAR_COTACAO"
  | "COMPARAR"
  | "FORNECEDORES"
  | "ACIMA_DO_TETO"
  | "MARGEM"
  | "OPORTUNIDADES"
  | "SIMULAR"
  | "EVIDENCIA";

export type Veredito = "NO_ALVO" | "ENTRE_ALVO_E_TETO" | "ACIMA_DO_TETO";

/** O selo curto do veredito. A frase longa vem no texto da resposta. */
export const ROTULO_DO_VEREDITO: Record<Veredito, string> = {
  NO_ALVO: "No alvo",
  ENTRE_ALVO_E_TETO: "Dentro do teto",
  ACIMA_DO_TETO: "Acima do teto",
};

/**
 * A cor de cada veredito — verde, âmbar, vermelho.
 *
 * Três estados e três cores, e a do meio não é neutra de propósito: uma
 * proposta que cabe no teto e passa da meta **tem** negociação pendente, e
 * pintá-la de cinza a deixaria indistinguível da que já está no alvo.
 */
export const COR_DO_VEREDITO: Record<Veredito, string> = {
  NO_ALVO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ENTRE_ALVO_E_TETO: "bg-amber-50 text-amber-800 border-amber-200",
  ACIMA_DO_TETO: "bg-rose-50 text-rose-700 border-rose-200",
};

export type Confiabilidade = "ALTA" | "MEDIA" | "BAIXA";

export const ROTULO_DA_CONFIABILIDADE: Record<Confiabilidade, string> = {
  ALTA: "Confiabilidade alta",
  MEDIA: "Confiabilidade média",
  BAIXA: "Confiabilidade baixa",
};

export type SituacaoDaCotacao =
  "AGUARDANDO" | "EM_NEGOCIACAO" | "APROVADA" | "RECUSADA";

export const ROTULO_DA_SITUACAO: Record<SituacaoDaCotacao, string> = {
  AGUARDANDO: "Aguardando análise",
  EM_NEGOCIACAO: "Em negociação",
  APROVADA: "Aprovada",
  RECUSADA: "Recusada",
};

export type MotivoSemAlvo =
  "SEM_REMUNERACAO" | "SEM_GAVETA" | "SEM_VIDA_UTIL" | "SEM_UNIDADES";

export const ROTULO_SEM_ALVO: Record<MotivoSemAlvo, string> = {
  SEM_REMUNERACAO: "Sem remuneração apurada nesta vigência",
  SEM_GAVETA: "Periodicidade não confirmada",
  SEM_VIDA_UTIL: "Vida útil não informada",
  SEM_UNIDADES: "Unidades por ativo não informadas",
};

export type TipoDeAtalho =
  | "REMUNERACAO"
  | "ITEM"
  | "COMPOSICAO"
  | "HISTORICO"
  | "ALTERACAO"
  | "VIGENCIA"
  | "FORNECEDOR"
  | "COTACAO";

export interface Atalho {
  tipo: TipoDeAtalho;
  rotulo: string;
  href: string;
  porque: string;
}

export interface PoliticaDeCompra {
  margemAlvo: number;
  margemMinima: number;
}

export interface DadoDaAvaliacao {
  chave: string;
  rotulo: string;
  valor: number | null;
  unidade: string;
  confirmado: boolean;
  fonte: string;
}

export interface BaseRemunerada {
  valor: number | null;
  gaveta: Gaveta | null;
  escopo: string;
  fonte: string;
  vigencia: string;
  ressalva: string | null;
  porUnidade?: boolean;
}

export interface AvaliacaoDeCompra {
  produto: ProdutoDeCompra | null;
  chave: string;
  base: BaseRemunerada;
  politica: PoliticaDeCompra;
  premissas: {
    precoUnitario?: number | null;
    quantidade?: number | null;
    precoHistorico?: number | null;
    vidaUtilMeses?: number | null;
    unidadesPorAtivo?: number | null;
    fornecedor?: string | null;
  };
  valorRemunerado: number | null;
  valorEconomicoUnitario: number | null;
  semAlvo: MotivoSemAlvo | null;
  precoHistorico: number | null;
  precoCotado: number | null;
  precoAlvo: number | null;
  precoTeto: number | null;
  diferencaParaAlvo: number | null;
  diferencaParaTeto: number | null;
  margemAbsoluta: number | null;
  margemPercentual: number | null;
  impactoPelaQuantidade: number | null;
  impactoMensal: number | null;
  impactoAnual: number | null;
  veredito: Veredito | null;
  confiabilidade: Confiabilidade;
  dados: DadoDaAvaliacao[];
  lacunas: string[];
}

export interface Cotacao {
  id: string;
  item: string;
  descricao: string | null;
  fornecedor: string;
  precoUnitario: number;
  quantidade: number | null;
  operacao: string | null;
  unidade: string | null;
  situacao: SituacaoDaCotacao;
  evidencia: string | null;
  validaAte: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CotacaoAvaliada {
  cotacao: Cotacao;
  avaliacao: AvaliacaoDeCompra;
  atalhos: Atalho[];
}

export interface BaseDoItem {
  base: BaseRemunerada;
  effectiveDate: string | null;
  veiculos: number | null;
  placa: string | null;
  /** A unidade do recorte — um lugar, e é ela que vira região de entrega. */
  unidade: string | null;
}

export interface PremissaDoItem {
  item: string;
  operacao: string | null;
  vidaUtilMeses: number | null;
  unidadesPorAtivo: number | null;
  margemAlvo: number | null;
  margemMinima: number | null;
  justificativa: string | null;
  updatedAt: string;
}

export interface AnaliseDoItem {
  produto: ProdutoDeCompra;
  leitura: BaseDoItem;
  avaliacao: AvaliacaoDeCompra;
  cotacoes: CotacaoAvaliada[];
  premissaConfigurada: PremissaDoItem | null;
  atalhos: Atalho[];
}

export interface LinhaDaCarteira {
  produto: ProdutoDeCompra;
  leitura: BaseDoItem;
  melhor: CotacaoAvaliada | null;
  propostas: CotacaoAvaliada[];
  atalhos: Atalho[];
}

export interface DesempenhoDoFornecedor {
  fornecedor: string;
  propostas: number;
  noAlvo: number;
  dentroDoTeto: number;
  acimaDoTeto: number;
  margemMedia: number | null;
  impactoTotal: number;
  atalho: Atalho;
}

export interface Indicador {
  chave: string;
  rotulo: string;
  valor: number | null;
  formato: "BRL" | "PERCENTUAL" | "CONTAGEM";
  porque: string;
  atalho: Atalho | null;
}

export interface PanoramaDeCompras {
  indicadores: Indicador[];
  linhas: LinhaDaCarteira[];
  politica: PoliticaDeCompra | null;
  cotacoes: number;
  vigencia: string | null;
}

export interface SugestaoRapida {
  rotulo: string;
  exemplo: string;
  intencao: Intencao;
}

export interface Capacidades {
  ia: boolean;
  modelo: string | null;
  /** Se o agente pode sair para a internet. Separado de `ia` — ver a rota. */
  mercado: boolean;
  politica: PoliticaDeCompra;
  sugestoes: SugestaoRapida[];
}

export interface RespostaDoAgente {
  /** A pesquisa de mercado, quando a pergunta pediu uma. */
  pesquisa: PesquisaDeMercado | null;
  texto: string;
  redacao: "IA" | "DETERMINISTICA";
  porqueDeterministica: string | null;
  intencao: Intencao;
  rotuloDaIntencao: string;
  item: ProdutoDeCompra | null;
  analise: AnaliseDoItem | null;
  carteira: LinhaDaCarteira[];
  fornecedores: DesempenhoDoFornecedor[];
  atalhos: Atalho[];
  leitura: {
    precos: number[];
    quantidade: number | null;
    placa: string | null;
  };
  lacunas: string[];
}

/** Um turno da conversa, como a tela a guarda. */
export interface Turno {
  papel: "PERGUNTA" | "RESPOSTA";
  texto: string;
  /** A resposta inteira, para os cartões abaixo do texto. Só nas respostas. */
  resposta?: RespostaDoAgente;
}

// ---------------------------------------------------------------------------
// Pesquisa de mercado
// ---------------------------------------------------------------------------

export type ClasseDeMatch =
  "EXATO" | "COMPATIVEL" | "PARCIAL" | "NAO_COMPARAVEL";

export const ROTULO_DO_MATCH: Record<ClasseDeMatch, string> = {
  EXATO: "Exato",
  COMPATIVEL: "Compatível",
  PARCIAL: "Parcial",
  NAO_COMPARAVEL: "Não comparável",
};

/**
 * A cor de cada classe de match.
 *
 * `NAO_COMPARAVEL` é vermelho e não cinza de propósito: ela aparece na lista
 * junto das outras, e a oferta mais barata costuma ser justamente essa. Cinza a
 * faria parecer uma linha secundária; vermelho diz que ela foi recusada.
 */
export const COR_DO_MATCH: Record<ClasseDeMatch, string> = {
  EXATO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  COMPATIVEL: "bg-sky-50 text-sky-700 border-sky-200",
  PARCIAL: "bg-amber-50 text-amber-800 border-amber-200",
  NAO_COMPARAVEL: "bg-rose-50 text-rose-700 border-rose-200",
};

export type Frescor = "AGORA" | "RECENTE" | "ENVELHECIDA" | "VELHA";

export const ROTULO_DO_FRESCOR: Record<Frescor, string> = {
  AGORA: "Capturada agora",
  RECENTE: "Últimas 24 h",
  ENVELHECIDA: "Mais de um dia",
  VELHA: "Mais de uma semana",
};

export type ConfiancaDeMercado = "ALTA" | "MEDIA" | "BAIXA";

export const ROTULO_DA_CONFIANCA_DE_MERCADO: Record<
  ConfiancaDeMercado,
  string
> = {
  ALTA: "Alta",
  MEDIA: "Média",
  BAIXA: "Baixa",
};

export type UnidadeDoPreco =
  | "UNIDADE"
  | "CAIXA"
  | "PACOTE"
  | "KG"
  | "LITRO"
  | "METRO"
  | "MES"
  | "DESCONHECIDA";

export interface Proveniencia {
  url: string;
  titulo: string | null;
  fonte: string;
  capturadoEm: string;
  idadeDaPagina: string | null;
}

export interface OfertaCapturada {
  fornecedor: string | null;
  produto: string | null;
  marca: string | null;
  especificacao: string | null;
  preco: number;
  unidadeDoPreco: UnidadeDoPreco;
  unidadesPorEmbalagem: number | null;
  quantidadeMinima: number | null;
  disponibilidade: string | null;
  frete: number | null;
  freteIncluso: boolean | null;
  impostos: number | null;
  prazoEmDias: number | null;
  condicaoComercial: string | null;
  trecho: string;
  proveniencia: Proveniencia;
}

export interface CustoComparavel {
  precoAnunciado: number;
  unidadeDoPreco: UnidadeDoPreco;
  precoPorUnidade: number | null;
  fretePorUnidade: number | null;
  impostoPorUnidade: number | null;
  custoTotal: number | null;
  completo: boolean;
  semCusto: string | null;
  abaixoDoMinimo: boolean;
  conta: string;
}

export interface MatchDaOferta {
  classe: ClasseDeMatch;
  atributos: {
    tipo: string;
    esperado: string;
    encontrado: string | null;
    desfecho: "BATE" | "DIVERGE" | "NAO_DECLARADO";
  }[];
  porque: string;
  comparavel: boolean;
}

export interface OfertaAnalisada {
  oferta: OfertaCapturada;
  match: MatchDaOferta;
  custo: CustoComparavel;
  frescor: Frescor;
  entrouNaConta: boolean;
  foraPorque: string | null;
  fonteDuvidosa: boolean;
}

export interface LeituraDeMercado {
  ofertas: number;
  menor: number;
  maior: number;
  mediana: number;
  media: number;
  dispersao: number;
}

export interface FaixaAlvo {
  piso: number;
  teto: number;
  evidencias: { tipo: string; valor: number | null; efeito: string }[];
  derivacao: string;
}

export interface SemAlvoDeMercado {
  porque: string;
  evidencias: { tipo: string; valor: number | null; efeito: string }[];
}

export interface AvaliacaoDeConfianca {
  confianca: ConfiancaDeMercado;
  pontos: number;
  fatores: { fator: string; observado: string; penalidade: number }[];
}

export interface PesquisaDeMercado {
  especificacao: {
    item: string;
    titulo: string;
    descricao: string | null;
    atributos: {
      tipo: string;
      bruto: string;
      canonico: string;
      origem: string;
    }[];
    quantidade: number | null;
    regiao: string | null;
    consulta: string;
    lacunas: string[];
  };
  buscador: string;
  consultas: string[];
  indisponivel: string | null;
  paginas: {
    url: string;
    titulo: string | null;
    capturadoEm: string;
    frescor: Frescor;
  }[];
  ofertas: OfertaAnalisada[];
  descartadas: {
    motivo: string;
    url: string;
    preco: number | null;
    trecho: string;
  }[];
  leitura: LeituraDeMercado | null;
  melhor: OfertaAnalisada | null;
  alvo: FaixaAlvo | SemAlvoDeMercado;
  confianca: AvaliacaoDeConfianca;
  economia: {
    precoAtual: number;
    precoRecomendado: number;
    economiaUnitaria: number;
    quantidade: number | null;
    economiaTotal: number | null;
  } | null;
  margem: {
    remuneracaoUnitaria: number;
    custoDeCompra: number;
    margemUnitaria: number;
    quantidade: number | null;
    margemTotal: number | null;
  } | null;
  frescor: Frescor | null;
  medicao: {
    latenciaMs: number;
    paginasBaixadas: number;
    modelo: string | null;
    tokensEntrada: number;
    tokensSaida: number;
    buscasServidor: number;
    fetchesServidor: number;
  };
  errosDeFerramenta: { ferramenta: string; codigo: string }[];
}

/** Distingue os dois desfechos do alvo sem `in`, como no servidor. */
export function temFaixa(a: FaixaAlvo | SemAlvoDeMercado): a is FaixaAlvo {
  return (a as FaixaAlvo).piso !== undefined;
}
