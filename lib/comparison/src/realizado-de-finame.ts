/**
 * A PORTA DO REALIZADO — declarada aberta, e hoje sem nada do outro lado.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e o que ele não é
 * ---------------------------------------------------------------------------
 * É o **contrato** que a Auditoria de FINAME usa para perguntar pelo custo
 * realizado: quais competências existem, e quanto cada placa custou em cada
 * uma. Não é o leitor desse dado — nenhum leitor existe.
 *
 * Esta ausência foi medida, não presumida. Varredura no repositório inteiro
 * (código, schema, as 102 migrations, fixtures e documentação) por `VLRREA`,
 * `ORIGEM=FIN`, `TIPO=REALIZADO` e por qualquer custo contábil por placa:
 * **zero ocorrências**. O que o produto chama de "real" em outros pontos é
 * outra coisa e está nomeada assim por acidente de vocabulário:
 *
 * - `evolucao-de-finame-real.test.ts` é "contra a base real curada" — ou seja,
 *   contra as planilhas **remuneradas** de verdade, em oposição a fixtures;
 * - `impacto-apurado.ts` é o impacto de uma mudança entre vigências, não custo
 *   incorrido;
 * - `lib/fechamento` é a única família de dado realizado do produto, e ela é
 *   **de trecho** — viagens, CT-e, pagamento por rota. Está explicitamente
 *   fora do custo fixo: nada dela entra aqui, hoje ou depois.
 *
 * ---------------------------------------------------------------------------
 * Por que a porta existe antes da fonte
 * ---------------------------------------------------------------------------
 * Porque a alternativa era pior das duas maneiras possíveis. Fabricar números
 * — derivar o realizado do remunerado, ou do trecho — entregaria uma tela que
 * parece funcionar e mente. Não construir nada deixaria a decisão de arquitetura
 * para o dia em que o arquivo chegar, que é o pior dia para tomá-la.
 *
 * Com a porta declarada, o que falta é **um** arquivo: um adaptador que
 * implemente {@link FonteDoRealizado}. Tudo o mais — consolidação mensal,
 * confronto, cartões, tabela, gráficos, rotas, permissões — já está escrito,
 * testado, e não sabe de onde o número vem.
 *
 * Enquanto o adaptador não existe, quem responde é {@link SEM_FONTE_DO_REALIZADO},
 * e ela responde a verdade: *não há fonte*. A tela então mostra o estado "fonte
 * sem dados", que é diferente de R$ 0,00 e diferente de erro.
 */

import type { Competencia } from "./competencia-de-finame";

/**
 * O custo realizado de uma placa numa competência.
 *
 * `bruto` e `valor` existem os dois de propósito — ver {@link normalizarSinal}.
 */
export interface ValorRealizado {
  competencia: Competencia;
  /** A placa. É a chave da conciliação com o remunerado. */
  entityLabel: string;
  /** `CAVALO` | `CARRETA`. Ver a recusa de conciliar tipos diferentes no confronto. */
  entityType: string;
  /**
   * O custo já normalizado para leitura — positivo significa custo incorrido.
   *
   * `null` é ausência, e nunca zero. Um zero aqui afirma que a operação
   * incorreu zero de FINAME naquele mês, que é uma afirmação forte e às vezes
   * verdadeira (ativo quitado); ausência afirma só que não sabemos.
   */
  valor: number | null;
  /**
   * O número como a origem o entregou, antes de qualquer normalização.
   *
   * Guardado porque a regra de sinal é uma **decisão de apresentação**, e uma
   * decisão de apresentação não pode apagar o fato. Quem for conferir contra o
   * razão contábil precisa ver o que estava lá.
   */
  bruto: number | null;
}

/**
 * Como a origem escreve o sinal de um custo.
 *
 * O razão contábil costuma lançar custo a crédito e entregá-lo **negativo**;
 * uma exportação de sistema de gestão costuma entregá-lo positivo. As duas
 * convenções existem, e adivinhar entre elas inverte o resultado inteiro: um
 * déficit de remuneração viraria sobra, com o número certo e o sinal trocado.
 *
 * Por isso a convenção é **declarada pelo adaptador**, nunca inferida do dado.
 * Inferir ("se a maioria é negativa, então…") funcionaria até o mês em que a
 * operação tivesse um estorno.
 */
export type ConvencaoDeSinal =
  /** A origem entrega custo como número positivo. */
  | "CUSTO_POSITIVO"
  /** A origem entrega custo como número negativo — convenção contábil de crédito. */
  | "CUSTO_NEGATIVO";

/**
 * O custo em leitura de custo, a partir do que a origem entregou.
 *
 * A regra, por inteiro: **normaliza-se para apresentação e para os cálculos de
 * custo, e não se altera o dado bruto.** `ValorRealizado.bruto` continua com o
 * número da origem, e é ele que confere contra o razão.
 *
 * O que esta função **não** faz é tomar valor absoluto. `Math.abs` esconderia
 * justamente o que precisa aparecer: sob `CUSTO_NEGATIVO`, um valor positivo na
 * origem é um estorno — dinheiro que voltou —, e ele tem de chegar à tela como
 * custo negativo, não como custo. Trocar o sinal é reversível e honesto; o
 * módulo não é.
 */
export function normalizarSinal(
  bruto: number | null,
  convencao: ConvencaoDeSinal,
): number | null {
  if (bruto === null || !Number.isFinite(bruto)) return null;
  return convencao === "CUSTO_NEGATIVO" ? -bruto : bruto;
}

/** Por que uma fonte não pôde responder. A tela escreve isto, literal. */
export interface IndisponibilidadeDoRealizado {
  motivo: "SEM_FONTE" | "SEM_COMPETENCIA" | "FALHA_NA_LEITURA";
  /** Uma frase para quem lê a tela — não um código. */
  frase: string;
  /** O que precisa existir para a fonte responder. */
  oQueFalta?: string;
}

/**
 * A fonte do custo realizado de FINAME.
 *
 * Duas perguntas, e nada mais: **que meses existem** e **quanto cada placa
 * custou num deles**. O confronto, a conciliação e a apresentação não são
 * problema da fonte — é o que permite trocar a fonte sem tocar em mais nada.
 *
 * O `escopo` é passado em toda pergunta, e não guardado na fonte, porque a
 * autorização é por requisição: a mesma instância responde a duas pessoas com
 * acesso a unidades diferentes, e uma fonte que lembrasse do escopo da última
 * pergunta é a forma exata do vazamento entre unidades.
 */
export interface EscopoDoRealizado {
  /** A unidade autorizada, já resolvida pelo portão de acesso. Nunca a pedida. */
  scopeHash: string | null;
  /** `EMPURRADA`, `ROTA` — o mesmo eixo do remunerado. */
  canal?: string | null;
  /** Os tipos de ativo que a leitura alcança. */
  entityTypes: readonly string[];
}

export interface FonteDoRealizado {
  /** Como a fonte se identifica no rastreio e nas mensagens. */
  readonly nome: string;
  /** A convenção de sinal desta origem — declarada, nunca inferida. */
  readonly convencaoDeSinal: ConvencaoDeSinal;
  /** As competências que esta fonte tem, da mais antiga para a mais nova. */
  competenciasDisponiveis(
    escopo: EscopoDoRealizado,
  ): Promise<{ competencias: Competencia[] } | { indisponivel: IndisponibilidadeDoRealizado }>;
  /** O custo por placa numa competência. */
  valoresDaCompetencia(
    escopo: EscopoDoRealizado,
    competencia: Competencia,
  ): Promise<{ valores: ValorRealizado[] } | { indisponivel: IndisponibilidadeDoRealizado }>;
}

/**
 * A fonte que diz a verdade sobre não existir.
 *
 * É a implementação em vigor. Ela não devolve lista vazia — lista vazia é
 * "procurei e não achei nada", que a tela desenharia como um mês sem
 * movimento. Ela devolve **indisponibilidade**, com a frase que a tela escreve
 * e com o que falta para a porta ter algo do outro lado.
 */
export const SEM_FONTE_DO_REALIZADO: FonteDoRealizado = {
  nome: "sem-fonte",
  /*
    Declarada mesmo sem fonte, e não deixada indefinida: o dia em que alguém
    plugar um adaptador sem pensar no sinal, o padrão tem de ser o que não
    inverte nada. `CUSTO_POSITIVO` é esse padrão.
  */
  convencaoDeSinal: "CUSTO_POSITIVO",

  async competenciasDisponiveis() {
    return { indisponivel: INDISPONIVEL_POR_FALTA_DE_FONTE };
  },

  async valoresDaCompetencia() {
    return { indisponivel: INDISPONIVEL_POR_FALTA_DE_FONTE };
  },
};

export const INDISPONIVEL_POR_FALTA_DE_FONTE: IndisponibilidadeDoRealizado = {
  motivo: "SEM_FONTE",
  frase:
    "Não há fonte de FINAME realizado conectada a esta instalação. " +
    "A comparação Remunerado × Realizado fica indisponível até que exista uma.",
  oQueFalta:
    "Uma origem com custo de FINAME por placa e competência mensal — o registro " +
    "contábil do tipo ORIGEM=FIN / TIPO=REALIZADO / VLRREA, ou equivalente. Ela " +
    "entra implementando FonteDoRealizado, sem mudar mais nada desta auditoria. " +
    "Dado de trecho (viagem, CT-e, pagamento por rota) não serve e não entra: é " +
    "custo variável, e este módulo é de custo fixo.",
};

/**
 * A fonte em uso.
 *
 * Um ponto só de troca, e é o que faz a promessa do cabeçalho ser verdade:
 * quando o adaptador existir, esta linha é o que muda.
 */
export function fonteDoRealizadoEmUso(): FonteDoRealizado {
  return SEM_FONTE_DO_REALIZADO;
}
