/**
 * As colunas do export que o cadastro lê, pelo código canônico delas.
 *
 * O código de um atributo é `<tipo da entidade em minúsculas>.<slug do
 * cabeçalho>` — quem o monta é `slugifyColumn` em `@workspace/ingest`, e o
 * slug separa camelCase em palavras antes de juntar com sublinhado:
 * `icmsIss` vira `icms_iss`, `previsaoViagens` vira `previsao_viagens`.
 *
 * Ficam num arquivo só porque três lugares precisam concordar sobre elas — a
 * consulta que as busca, a procedência que as cita na tela e o teste que
 * prende as duas. Espalhadas, a primeira renomeação de coluna acertaria a
 * consulta e deixaria a tela citando um nome que não existe mais.
 *
 * O nome de origem (o cabeçalho como a planilha o escreve) vem junto porque é
 * ele que quem opera reconhece: ninguém procura `trecho.icms_iss` no arquivo,
 * procura `icmsIss`.
 */

export interface ColunaDoExport {
  /** O código canônico — o que está em `attribute.code`. */
  code: string;
  /** O cabeçalho como a planilha o escreve. */
  cabecalho: string;
  /** O que a coluna é, na frase do dicionário do export. */
  papel: string;
}

/** O tipo de entidade dos trechos no modelo canônico. */
export const TIPO_TRECHO = "TRECHO";
/** O tipo de entidade dos veículos de frota fixa. */
export const TIPO_CAVALO = "CAVALO";

export const COLUNA: Record<
  | "ativo"
  | "tributo"
  | "percentualDeclarado"
  | "freteCtrc"
  | "imposto"
  | "pisCofins"
  | "previsaoViagens",
  ColunaDoExport
> = {
  ativo: {
    code: "cavalo.ativo",
    cabecalho: "ativo",
    papel: "Se o veículo está ativo na operação da vigência.",
  },
  tributo: {
    code: "trecho.icms_iss",
    cabecalho: "icmsIss",
    papel: "Tributo aplicável ao trecho — ICMS quando sai do município, ISS quando não sai.",
  },
  percentualDeclarado: {
    code: "trecho.percentual_icms_iss",
    cabecalho: "percentualIcmsIss",
    papel: "A alíquota que o próprio trecho declara para o tributo aplicável.",
  },
  freteCtrc: {
    code: "trecho.frete_ctrc",
    cabecalho: "freteCtrc",
    papel: "O valor do documento fiscal do trecho — a base de toda razão de alíquota.",
  },
  imposto: {
    code: "trecho.impostos_icms_iss",
    cabecalho: "impostosIcmsIss",
    papel: "Quanto de ICMS ou de ISS o trecho carrega, em reais.",
  },
  pisCofins: {
    code: "trecho.frete_pis_cofins",
    cabecalho: "fretePisCofins",
    papel: "PIS e COFINS somados numa coluna só, como o export os traz.",
  },
  previsaoViagens: {
    code: "trecho.previsao_viagens",
    cabecalho: "previsaoViagens",
    papel: "Quantas viagens o trecho prevê no mês — e, portanto, quantos documentos emite.",
  },
};

/** Os códigos que a consulta de trechos busca. */
export const CODIGOS_DO_TRECHO: string[] = [
  COLUNA.tributo.code,
  COLUNA.percentualDeclarado.code,
  COLUNA.freteCtrc.code,
  COLUNA.imposto.code,
  COLUNA.pisCofins.code,
  COLUNA.previsaoViagens.code,
];

/** Os códigos que a consulta de frota busca. */
export const CODIGOS_DO_CAVALO: string[] = [COLUNA.ativo.code];
