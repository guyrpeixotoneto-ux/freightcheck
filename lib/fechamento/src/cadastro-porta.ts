import type { Canal } from "./dominio";
import type { ParametrosDoCadastro } from "./mapa-rota";

/**
 * A PORTA DO CADASTRO — onde o contrato entra no fechamento.
 *
 * O motor (`mapa-rota.ts`) sabe calcular a remuneração devida a partir dos
 * parâmetros do contrato. O que ele não sabe — e não deve saber — é **de onde
 * esses parâmetros vêm**: de uma tabela versionada, de uma aba de planilha, de
 * uma rota de API. Esta interface é a costura entre as duas coisas.
 *
 * **Por que uma porta, e não uma consulta direta.** O módulo de cadastro está
 * sendo escrito agora, e a forma dele ainda vai mudar. Um `select` no meio de
 * `lerResumoDoMes` amarraria o fechamento ao esquema do cadastro no dia em que
 * ele nascesse, e cada mudança lá viraria uma mudança aqui. Com a porta, o
 * fechamento depende de uma pergunta — *quais eram os parâmetros deste trio
 * neste período?* — e quem responde é problema de quem implementa.
 *
 * **A pergunta é sempre sobre um período, nunca sobre "agora".** É esta
 * assinatura que impede um cadastro futuro de recalcular o passado: quem
 * resolve recebe o início e o fim da quinzena, e não a data de hoje. Ver
 * `docs/CADASTRO-COMO-FONTE.md`.
 */

/** O que o fechamento pergunta ao cadastro. */
export interface PerguntaAoCadastro {
  unidadeCodigo: string;
  transportadoraCodigo: string;
  canal: Canal;
  /** O primeiro dia da quinzena, `YYYY-MM-DD`. */
  inicio: string;
  /** O último dia da quinzena, `YYYY-MM-DD`. */
  fim: string;
}

/**
 * O que o cadastro responde.
 *
 * `null` é uma resposta legítima e comum — significa "não há cadastro vigente
 * que cubra este período", que é o estado de toda competência antes de alguém
 * subir o contrato. Quem chama trata a ausência nomeando-a, nunca preenchendo.
 */
export interface RespostaDoCadastro {
  parametros: ParametrosDoCadastro;
  /**
   * `Custo Variável (para 25 viagens previstas)` mais o lucro previsto — o que
   * o motor divide por 25 para achar o valor padrão de um veículo.
   */
  custoVariavelPrevistoPor25Viagens: number;
  /**
   * A identidade do cadastro usado, para a apuração fixá-la.
   *
   * É o que permite reler um fechamento apurado e obter os mesmos números,
   * mesmo depois de uma correção retroativa entrar. Ver o mecanismo 3 em
   * `docs/CADASTRO-COMO-FONTE.md`.
   */
  cadastroId: string;
  /** Desde quando este cadastro vale, `YYYY-MM-DD`. Para a tela dizer qual usou. */
  vigenteDe: string;
}

/**
 * Quem sabe responder pelo contrato de um período.
 *
 * O módulo de cadastro implementa isto. Enquanto ele não existe,
 * {@link SEM_CADASTRO} responde `null` a tudo — e o fechamento se comporta
 * exatamente como se comportava antes desta porta existir.
 */
export interface FonteDeCadastro {
  resolver(pergunta: PerguntaAoCadastro): Promise<RespostaDoCadastro | null>;
}

/**
 * A fonte que ainda não existe.
 *
 * Não é um placeholder a ser removido: é o comportamento correto de um
 * ambiente que ainda não cadastrou contrato nenhum, e continuará sendo depois
 * — para a unidade cujo contrato ninguém subiu. Por isso ela responde `null` em
 * vez de lançar: a ausência de cadastro é um estado do negócio, não um defeito
 * de instalação.
 */
export const SEM_CADASTRO: FonteDeCadastro = {
  async resolver() {
    return null;
  },
};

/**
 * Uma fonte que responde de uma lista em memória — para teste e para a
 * conferência contra a planilha.
 *
 * A resolução é a mesma regra que o módulo de verdade terá de seguir: **a
 * vigência precisa cobrir a quinzena inteira**. Uma vigência que começa no meio
 * não serve, e aqui ela é simplesmente ignorada em vez de rateada — ratear
 * inventaria um contrato que ninguém assinou.
 */
export function cadastroEmMemoria(
  registros: (RespostaDoCadastro & {
    unidadeCodigo: string;
    transportadoraCodigo: string;
    canal: Canal;
    vigenteAte: string | null;
  })[],
): FonteDeCadastro {
  return {
    async resolver(pergunta) {
      const cobre = registros.filter(
        (r) =>
          r.unidadeCodigo === pergunta.unidadeCodigo &&
          r.transportadoraCodigo === pergunta.transportadoraCodigo &&
          r.canal === pergunta.canal &&
          r.vigenteDe <= pergunta.inicio &&
          (r.vigenteAte === null || r.vigenteAte >= pergunta.fim),
      );
      /* A mais recente que cobre — vigências sobrepostas são erro de escrita. */
      const escolhida = cobre.sort((a, b) => b.vigenteDe.localeCompare(a.vigenteDe))[0];
      if (!escolhida) return null;
      return {
        parametros: escolhida.parametros,
        custoVariavelPrevistoPor25Viagens: escolhida.custoVariavelPrevistoPor25Viagens,
        cadastroId: escolhida.cadastroId,
        vigenteDe: escolhida.vigenteDe,
      };
    },
  };
}
