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

// --- a matriz da frota -----------------------------------------------------

export type MotivoDaCelulaVazia =
  | "SEM_COLUNA"
  | "SEM_NUMERO"
  | "NAO_SOMAVEL"
  | "VARIAS_COLUNAS";

/**
 * O que a célula vazia escreve — curto, porque cabe numa célula de matriz.
 *
 * A frase inteira mora na legenda embaixo da tabela: um `title` seria a única
 * explicação de um símbolo, e um `title` não existe em telefone nem em leitor
 * de tela que não passe por cima do elemento.
 */
export const MARCA_DA_CELULA_VAZIA: Record<MotivoDaCelulaVazia, string> = {
  SEM_COLUNA: "—",
  SEM_NUMERO: "·",
  NAO_SOMAVEL: "∗",
  VARIAS_COLUNAS: "≠",
};

export const ROTULO_DA_CELULA_VAZIA: Record<MotivoDaCelulaVazia, string> = {
  SEM_COLUNA: "Sem coluna na fonte para este veículo",
  SEM_NUMERO: "A coluna existe e veio sem número nesta vigência",
  NAO_SOMAVEL: "Há número, e ele não é dinheiro somável deste ativo — abra a ficha",
  VARIAS_COLUNAS: "Mais de uma coluna responde, e elas medem coisas diferentes",
};

/**
 * O mesmo vazio em duas palavras — a forma que cabe numa célula de planilha.
 *
 * O CSV não pode levar nem o símbolo (que ninguém decifra fora da tela que tem
 * a legenda ao lado) nem a frase inteira (que, repetida em oitenta linhas,
 * afoga a planilha em texto e esconde os números que ela existe para mostrar).
 * Vai o rótulo curto na célula e a frase inteira na legenda, no fim do arquivo.
 */
export const ROTULO_CURTO_DA_CELULA_VAZIA: Record<MotivoDaCelulaVazia, string> = {
  SEM_COLUNA: "sem coluna",
  SEM_NUMERO: "sem número",
  NAO_SOMAVEL: "não somável",
  VARIAS_COLUNAS: "várias colunas",
};

export type MotivoSemTotal = "SEM_VALOR" | "GAVETAS_DIFERENTES";

export const ROTULO_SEM_TOTAL: Record<MotivoSemTotal, string> = {
  SEM_VALOR: "nenhum veículo com valor",
  GAVETAS_DIFERENTES: "periodicidades diferentes — não se somam",
};

export interface CelulaDaMatriz {
  valor: number | null;
  unit: string | null;
  gaveta: Gaveta | null;
  colunas: number;
  vazio: MotivoDaCelulaVazia | null;
}

export interface LinhaDaMatriz {
  entityId: string;
  placa: string | null;
  chassi: string | null;
  entityType: string;
  rotuloDoTipo: string;
  celulas: CelulaDaMatriz[];
}

export interface ColunaDaMatriz {
  produto: ProdutoDeCompra;
  gaveta: Gaveta | null;
  veiculosComValor: number;
  total: number | null;
  semTotal: MotivoSemTotal | null;
}

export interface MatrizDaFrota {
  effectiveDate: string;
  periodLabel: string;
  contextLabel: string;
  unidade: string | null;
  operacao: string | null;
  vigencias: { effectiveDate: string; periodLabel: string }[];
  colunas: ColunaDaMatriz[];
  linhas: LinhaDaMatriz[];
  resumo: {
    veiculos: number;
    comAlgumValor: number;
    porTipo: { entityType: string; rotulo: string; veiculos: number }[];
  };
  foraDoCatalogo: ForaDoCatalogo[];
}

// --- a matriz do QLP -------------------------------------------------------

export type MotivoSemTotalQlp = "SEM_VALOR" | "UNITARIO_NAO_SOMA";

export const ROTULO_SEM_TOTAL_QLP: Record<MotivoSemTotalQlp, string> = {
  SEM_VALOR: "nenhum cargo com valor",
  UNITARIO_NAO_SOMA: "preço de um — não se soma entre cargos",
};

export interface CelulaDaMatrizQlp {
  celulas: CelulaDoProduto[];
  conferencia: Conferencia | null;
}

export interface LinhaDaMatrizQlp {
  entityId: string;
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
  unidadeNome: string | null;
  celulas: CelulaDaMatrizQlp[];
}

export interface TotalDoPapel {
  papel: Papel;
  total: number | null;
  cargosComValor: number;
  semTotal: MotivoSemTotalQlp | null;
}

export interface ColunaDaMatrizQlp {
  produto: ProdutoDeCompra;
  papeis: Papel[];
  semColuna: boolean;
  totais: TotalDoPapel[];
}

export interface MatrizDoQlp {
  effectiveDate: string;
  periodLabel: string;
  contextLabel: string;
  colunas: ColunaDaMatrizQlp[];
  linhas: LinhaDaMatrizQlp[];
  resumo: { cargos: number; unidades: number; cargosComDivergencia: number };
  registrosFaltando: number;
  operacional: BalcaoSemDado;
}
