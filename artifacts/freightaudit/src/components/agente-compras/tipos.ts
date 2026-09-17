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
  | "AGUARDANDO"
  | "EM_NEGOCIACAO"
  | "APROVADA"
  | "RECUSADA";

export const ROTULO_DA_SITUACAO: Record<SituacaoDaCotacao, string> = {
  AGUARDANDO: "Aguardando análise",
  EM_NEGOCIACAO: "Em negociação",
  APROVADA: "Aprovada",
  RECUSADA: "Recusada",
};

export type MotivoSemAlvo =
  | "SEM_REMUNERACAO"
  | "SEM_GAVETA"
  | "SEM_VIDA_UTIL"
  | "SEM_UNIDADES";

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
  politica: PoliticaDeCompra;
  sugestoes: SugestaoRapida[];
}

export interface RespostaDoAgente {
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
  leitura: { precos: number[]; quantidade: number | null; placa: string | null };
  lacunas: string[];
}

/** Um turno da conversa, como a tela a guarda. */
export interface Turno {
  papel: "PERGUNTA" | "RESPOSTA";
  texto: string;
  /** A resposta inteira, para os cartões abaixo do texto. Só nas respostas. */
  resposta?: RespostaDoAgente;
}
