/**
 * O contrato das rotas `/compras`, do lado da tela.
 *
 * Espelha `@workspace/compras` sem importá-lo, pela mesma razão de
 * `components/composicao/tipos.ts`: o pacote é de servidor e carrega o driver
 * do Postgres junto. Um `import type` atravessaria o `tsconfig` mas não o
 * bundler, e o custo de manter estes tipos à mão é menor que o de arrastar o
 * banco para dentro do navegador.
 */

import type { Gaveta, Origem } from "@/components/composicao/tipos";

export type Balcao = "FROTA" | "QLP_ADMINISTRATIVO" | "QLP_OPERACIONAL";
export type Natureza = "INSUMO" | "ATIVO" | "ESTRUTURA";
export type Papel = "UNITARIO" | "QUANTIDADE" | "DESPESA";

export type MotivoDaRessalva =
  | "COLUNA_ZERADA_NA_SERIE"
  | "RAZAO_SEM_BASE"
  | "PARAMETRO_NAO_GASTO"
  | "OUTRA_PERIODICIDADE"
  | "ESCOPO_DE_CONJUNTO"
  | "SEM_COLUNA_NA_FONTE";

/** O selo curto da ressalva — o rótulo longo é o `texto` que vem da rota. */
export const ROTULO_DA_RESSALVA: Record<MotivoDaRessalva, string> = {
  COLUNA_ZERADA_NA_SERIE: "Coluna zerada na série",
  RAZAO_SEM_BASE: "Razão sem base",
  PARAMETRO_NAO_GASTO: "Parâmetro, não gasto",
  OUTRA_PERIODICIDADE: "Outra periodicidade",
  ESCOPO_DE_CONJUNTO: "Remunera o conjunto",
  SEM_COLUNA_NA_FONTE: "Sem coluna na fonte",
};

export const ROTULO_DA_NATUREZA: Record<Natureza, string> = {
  INSUMO: "Insumo",
  ATIVO: "Ativo",
  ESTRUTURA: "Estrutura",
};

export const ROTULO_DO_PAPEL: Record<Papel, string> = {
  UNITARIO: "Valor unitário",
  QUANTIDADE: "Quantidade remunerada",
  DESPESA: "Despesa",
};

export interface Ressalva {
  motivo: MotivoDaRessalva;
  texto: string;
  evidencia: string;
}

export interface ProdutoDeCompra {
  chave: string;
  rotulo: string;
  balcao: Balcao;
  natureza: Natureza;
  compra: string;
  parametros: string[];
  ressalva?: Ressalva;
}

export interface BalcaoSemDado {
  balcao: Balcao;
  falta: string;
  hoje: string;
}

export interface Catalogo {
  produtos: ProdutoDeCompra[];
  operacional: BalcaoSemDado;
}

// --- balcão da frota -------------------------------------------------------

export interface PlacaEncontrada {
  entityId: string;
  entityType: string;
  placa: string;
  placaLegivel: string;
  corrente: boolean;
}

export interface LinhaDoProduto {
  code: string;
  titulo: string;
  sourceName: string;
  exibicao: string | null;
  valor: number | null;
  unit: string | null;
  periodicity: string | null;
  gaveta: Gaveta | null;
  apurado: boolean;
  motivo: string | null;
  origem: Origem | null;
}

export interface ProdutoConsultado {
  produto: ProdutoDeCompra;
  linhas: LinhaDoProduto[];
  destaque: LinhaDoProduto | null;
  semNumero: boolean;
}

export interface ForaDoCatalogo {
  rubrica: string;
  familia: string;
  colunas: number;
}

export interface ConsultaDaPlaca {
  placa: PlacaEncontrada;
  entityType: string;
  rotuloDoTipo: string;
  chassi: string | null;
  unidade: string | null;
  operacao: string | null;
  contextLabel: string;
  effectiveDate: string;
  periodLabel: string;
  presente: boolean;
  produtos: ProdutoConsultado[];
  foraDoCatalogo: ForaDoCatalogo[];
  vinculo: { placa: string; entityId: string } | null;
}

// --- balcão do QLP ---------------------------------------------------------

export interface SemanticaDaColuna {
  status: string;
  isMonetary: boolean | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
}

export interface CelulaDoProduto {
  code: string;
  titulo: string;
  papel: Papel;
  valor: number | string | boolean | null;
  semantica: SemanticaDaColuna;
}

export interface Conferencia {
  esperado: number;
  declarado: number;
  diferenca: number;
  fecha: boolean;
}

export interface LinhaDoQuadro {
  entityId: string;
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
  unidadeNome: string | null;
  celulas: CelulaDoProduto[];
  conferencia: Conferencia | null;
}

export interface ProdutoDoQlp {
  produto: ProdutoDeCompra;
  colunas: { code: string; titulo: string; papel: Papel }[];
  linhas: LinhaDoQuadro[];
  semColuna: boolean;
}

export interface ConsultaDoQlp {
  effectiveDate: string;
  periodLabel: string;
  contextLabel: string;
  produtos: ProdutoDoQlp[];
  operacional: BalcaoSemDado;
  registrosFaltando: number;
}
