import type { AlertaDoConfronto } from "@workspace/comparison/alertas-do-confronto";
import type {
  Confronto,
  CoberturaDoConfronto,
  ResultadoDoConfronto,
  SituacaoDoFinanciamento,
  UniversoSemRealizado,
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
  /**
   * Os três universos da competência, nomeados pelo servidor.
   *
   * A tela **não os monta**: cada número já existe dentro de `confronto.resumo`
   * ou das filas da importação, e deixar a composição aqui seria deixá-la
   * mudar de tela para tela. Ausente quando não há fonte do realizado.
   */
  universos?: {
    conciliados: {
      veiculos: number;
      /** O denominador da cobertura — veículos remunerados no mês. */
      de: number;
      remunerado: number;
      realizado: number;
      saldo: number;
    };
    semRealizado: UniversoSemRealizado;
    pendenteDeClassificacao: {
      naCompetencia: { placas: number; valor: number };
      noExtrato: { placas: number; valor: number };
    };
  };
  alertas?: AlertaDoConfronto[];
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

/**
 * A cobertura por extenso — "17 de 64 veículos".
 *
 * Uma função, e não um template no JSX, porque esta frase acompanha o saldo em
 * todo lugar onde o saldo aparece: cartão, bloco do universo 1 e CSV. Três
 * escritas dela seriam três chances de uma delas usar o denominador errado, que
 * é precisamente o defeito que esta tela teve.
 */
export function escreverCobertura(conciliados: number, de: number): string {
  return `${formatNumber(conciliados, 0)} de ${formatNumber(de, 0)} ${
    de === 1 ? "veículo" : "veículos"
  }`;
}

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

/**
 * A situação do financiamento, escrita.
 *
 * `INDEFINIDO` vira "Não declarada", e não "—": o traço desta tela significa
 * *não calculável*, e aqui não há cálculo nenhum — há uma coluna que a base não
 * preencheu. São coisas diferentes e não podem compartilhar o mesmo glifo.
 */
export const ROTULO_DA_SITUACAO_DO_FINANCIAMENTO: Record<SituacaoDoFinanciamento, string> = {
  FINANCIADO: "Financiado",
  QUITADO: "Quitado",
  INDEFINIDO: "Não declarada",
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
 * O que **mais** ficou de fora, em uma linha — o que os três universos não
 * nomeiam.
 *
 * As placas que só o realizado tem, as não conciliadas por ambiguidade e o que a
 * consolidação do mês recusou. São avisos de verdade — aparecem quando há o que
 * avisar —, e por isso continuam numa linha de texto em vez de virarem cartão.
 */
export function frasesDaCobertura(resposta: RespostaDoConfronto): string[] {
  const frases: string[] = [];
  const c = resposta.confronto?.resumo.cobertura;
  /*
    O "X de Y" **não** sai mais daqui.

    Ele passou a viver na nota do cartão do saldo, onde aparece em toda
    renderização, inclusive quando X = Y. Era esta função que o escondia quando
    a cobertura estava completa — regra razoável para um aviso, e errada para
    este número: ele não é um aviso, é a metade do significado do saldo. Mantê-lo
    nos dois lugares o faria aparecer duas vezes na mesma tela.
  */
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
  /* A situação declarada entra no arquivo porque é ela que separa, no universo
     "sem realizado", o veículo coerente do achado — e o painel da tela mostra
     só os maiores. Quem precisa dos 32 inteiros abre o CSV. */
  "Situação do financiamento",
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
      l.statusDeclarado ?? ROTULO_DA_SITUACAO_DO_FINANCIAMENTO[l.situacaoDoFinanciamento],
      l.motivo ?? "",
    ]),
  ];
}
