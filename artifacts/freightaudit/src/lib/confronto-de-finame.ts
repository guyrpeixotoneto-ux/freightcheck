import type {
  Confronto,
  CoberturaDoConfronto,
  ResultadoDoConfronto,
} from "@workspace/comparison/confronto-de-finame";
import type { Competencia } from "@workspace/comparison/competencia-de-finame";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela do confronto — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/confronto-de-finame`, que o
 * servidor importa: diferença, variação, resultado, cobertura e totais saem de
 * lá, e a tela nunca refaz nenhum deles. Aqui ficam as três coisas que são
 * genuinamente de apresentação — **como se escreve um número que pode não
 * existir**, que cor cada resultado recebe, e como a tabela vira arquivo.
 *
 * A separação é a mesma de `lib/finame.ts`, e pela mesma razão: enquanto a soma
 * morava no JSX, o cartão somava a página e a tabela somava o recorte.
 */

/** O que `GET /finame/confronto` devolve. */
export interface RespostaDoConfronto {
  competencia: Competencia;
  rotulo: string;
  /** O lado remunerado do mês — existe mesmo quando o realizado não existe. */
  remunerado: {
    veiculos: number;
    consolidados: number;
    /** Σ da parcela mensal dos consolidados — a evidência de que o lado foi lido. */
    totalConsolidado: number;
    divergencias: number;
    coberturaParcial: number;
    semValor: number;
    semPlaca: number;
    vigencias: { id: string; effectiveDate: string; sourceLabel: string | null }[];
  };
  realizado:
    | { disponivel: true; fonte: string }
    | {
        disponivel: false;
        fonte: string;
        motivo: string;
        frase: string;
        oQueFalta?: string;
      };
  /** `null` quando não há fonte do realizado. Nunca um confronto zerado. */
  confronto: Confronto | null;
}

/** O que `GET /finame/competencias` devolve. */
export interface RespostaDasCompetencias {
  competencias: {
    competencia: Competencia;
    rotulo: string;
    vigencias: { id: string; effectiveDate: string; sourceLabel: string | null }[];
    temRealizado: boolean;
  }[];
  realizado:
    | { disponivel: true; fonte: string }
    | { disponivel: false; fonte: string; motivo: string; frase: string; oQueFalta?: string };
}

/**
 * O traço — como se escreve o que não pôde ser calculado.
 *
 * Uma constante, e não um literal repetido, porque a regra é uma só e vale em
 * toda a tela: **nunca R$ 0,00 onde não há número**. Zero é uma afirmação sobre
 * dinheiro; o traço é a ausência de afirmação, e as duas coisas aparecem na
 * mesma coluna, uma linha abaixo da outra.
 */
export const TRACO = "—";

/** Dinheiro, ou o traço. Nunca zero no lugar de ausência. */
export function escreverDinheiro(valor: number | null): string {
  return valor === null ? TRACO : formatBrl(valor);
}

/**
 * Percentual, ou o traço.
 *
 * O sinal é explícito no positivo (`+12,5%`): numa coluna em que metade das
 * linhas é negativa, um número sem sinal se lê como negativo por contágio.
 */
export function escreverVariacao(variacao: number | null): string {
  if (variacao === null) return TRACO;
  const pontos = variacao * 100;
  return `${pontos > 0 ? "+" : ""}${formatNumber(pontos, 1)}%`;
}

export const ROTULO_DO_RESULTADO: Record<ResultadoDoConfronto, string> = {
  SOBRA: "Sobra de remuneração",
  DEFICIT: "Déficit de remuneração",
  EQUILIBRIO: "Equilíbrio",
  NAO_CALCULAVEL: "Não calculável",
};

/** O mesmo, curto — para caber na célula da tabela. */
export const ROTULO_CURTO_DO_RESULTADO: Record<ResultadoDoConfronto, string> = {
  SOBRA: "Sobra",
  DEFICIT: "Déficit",
  EQUILIBRIO: "Equilíbrio",
  NAO_CALCULAVEL: "Não calculável",
};

export const ROTULO_DA_COBERTURA: Record<CoberturaDoConfronto, string> = {
  COMPLETA: "Completa",
  SEM_REALIZADO: "Sem realizado",
  SEM_REMUNERADO: "Sem remunerado",
  NAO_CONCILIADO: "Não conciliado",
};

/**
 * A cor de cada resultado — e a razão de ela **não** ser verde para sobra.
 *
 * A tentação é óbvia: positivo é verde, negativo é vermelho. Ela está errada
 * aqui. Uma sobra de remuneração pode ser um ativo que saiu da operação e
 * continuou sendo pago — um achado de auditoria, não uma boa notícia —, e pintá-la
 * de verde diria a quem lê que está tudo bem justamente na linha que precisa
 * ser olhada.
 *
 * Então a paleta é **descritiva**: azul para sobra (dinheiro acima), âmbar para
 * déficit (dinheiro abaixo, que é o que costuma exigir ação), neutro para
 * equilíbrio e para o que não deu para calcular. Nenhuma das duas cores diz
 * "bom" ou "ruim"; quem diz isso é quem conhece o contrato.
 */
export const COR_DO_RESULTADO: Record<ResultadoDoConfronto, string> = {
  SOBRA: "text-brand",
  DEFICIT: "text-warning-foreground",
  EQUILIBRIO: "text-muted-foreground",
  NAO_CALCULAVEL: "text-muted-foreground",
};

/**
 * A frase de cobertura que a tela mostra — "98 de 104 veículos conciliados".
 *
 * Uma linha de texto, e não um sétimo cartão: a fileira principal já tem seis, e
 * um cartão a mais empurraria os números para baixo da dobra para dizer algo que
 * cabe numa frase. Quando está tudo conciliado a frase não aparece — um aviso
 * que aparece sempre deixa de ser aviso.
 */
export function frasesDaCobertura(resposta: RespostaDoConfronto): string[] {
  const frases: string[] = [];
  const c = resposta.confronto?.resumo.cobertura;
  if (c && c.total > 0 && c.conciliados < c.total) {
    frases.push(`${c.conciliados} de ${c.total} veículos conciliados`);
  }
  if (c && c.semRealizado > 0) {
    frases.push(
      `${c.semRealizado} ${c.semRealizado === 1 ? "placa" : "placas"} sem realizado correspondente`,
    );
  }
  if (c && c.semRemunerado > 0) {
    frases.push(
      `${c.semRemunerado} ${c.semRemunerado === 1 ? "placa" : "placas"} sem remunerado correspondente`,
    );
  }
  if (c && c.naoConciliados > 0) {
    frases.push(`${c.naoConciliados} não ${c.naoConciliados === 1 ? "conciliada" : "conciliadas"}`);
  }

  /* O que a consolidação do mês recusou é dito mesmo sem confronto: é a
     resposta para "por que esta placa não está na tabela?". */
  const r = resposta.remunerado;
  if (r.divergencias > 0) {
    frases.push(
      `${r.divergencias} com parcela divergente entre as vigências do mês`,
    );
  }
  if (r.coberturaParcial > 0) {
    frases.push(`${r.coberturaParcial} presentes em parte do mês apenas`);
  }
  if (r.semPlaca > 0) {
    frases.push(`${r.semPlaca} sem placa no acervo`);
  }
  return frases;
}

/** As colunas do CSV do confronto — por placa, como a tabela. */
export const COLUNAS_DO_CSV_DO_CONFRONTO = [
  "Competência",
  "Veículo",
  "Tipo",
  "Remunerado",
  "Realizado",
  "Diferença",
  "Variação",
  "Resultado",
  "Cobertura",
  "Motivo",
] as const;

export function linhasDoCsvDoConfronto(confronto: Confronto): string[][] {
  return [
    [...COLUNAS_DO_CSV_DO_CONFRONTO],
    ...confronto.linhas.map((l) => [
      l.competencia,
      l.entityLabel,
      l.entityType,
      /* Vazio, e não "0": o CSV é conferido em planilha, e um zero ali entra em
         soma. A ausência tem de atravessar o arquivo como ausência. */
      l.remunerado === null ? "" : String(l.remunerado),
      l.realizado === null ? "" : String(l.realizado),
      l.diferenca === null ? "" : String(l.diferenca),
      l.variacao === null ? "" : String(l.variacao),
      ROTULO_DO_RESULTADO[l.resultado],
      ROTULO_DA_COBERTURA[l.cobertura],
      l.motivo ?? "",
    ]),
  ];
}
