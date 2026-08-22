import { centavos, emReais, type Canal } from "./dominio";

/**
 * AS INCONSISTÊNCIAS — o que as duas leituras não conseguem conciliar, dito.
 *
 * O painel do fechamento pergunta a mesma coisa a duas fontes independentes: o
 * **devido**, que sai do contrato e do diário, e o **demonstrado**, que sai do
 * 03.08.20. Quando elas concordam, não há o que dizer. Quando discordam, a
 * diferença aparece numa coluna — e some no meio de vinte linhas, sem nome,
 * sem tamanho relativo e sem dizer o que a resolveria.
 *
 * Este módulo é essa coluna virada do avesso: uma lista de **afirmações
 * nomeadas**, ordenada por quanto vale cada uma.
 *
 * **A regra que faz este módulo valer alguma coisa: nada aqui soma.** Não
 * existe, e nunca deve existir, uma linha "Ajustes" ou "Outros" com o valor que
 * falta para o painel fechar. Uma lista que fecha a conta faz o painel
 * concordar consigo mesmo por construção, e um painel que não pode discordar
 * não confere nada — é o mesmo argumento que criou a coluna `Diferença`.
 *
 * E há uma segunda razão, aritmética: **os itens se sobrepõem**. A diferença do
 * total de um quadro *é*, em parte, a soma das diferenças das linhas dele.
 * Somar a lista contaria a mesma divergência duas vezes. Por isso o que se
 * devolve é uma lista, não um total, e cada item traz o seu próprio valor.
 *
 * **Cada item é uma afirmação que alguém consegue derrubar sozinho.** Traz o
 * que discorda (as duas fontes, nomeadas), quanto vale, por que ainda não se
 * resolve e o que a destrava — sempre um dado ou uma decisão, nunca um prazo.
 * É a mesma disciplina de `SEM_ORIGEM` no de-para, num lugar só.
 *
 * **Uma lista vazia é uma afirmação forte**, e é o estado que se persegue: as
 * duas leituras chegaram ao mesmo número em todas as linhas do canal.
 */

/** O que há de errado, em três formas que pedem trabalhos diferentes. */
export type TipoDeInconsistencia =
  /** As duas fontes têm número para a linha, e os números não batem. */
  | "FONTES_DISCORDAM"
  /** O contrato manda pagar e o demonstrativo não traz nada nesta linha. */
  | "SEM_DEMONSTRADO"
  /** O demonstrativo paga e o contrato não sustenta a linha. */
  | "SEM_DEVIDO";

export interface Inconsistencia {
  /** Identifica o item — `linha:quinzena`, estável entre leituras. */
  chave: string;
  canal: Canal;
  quinzena: 1 | 2;
  /** A chave da linha da planilha a que o item se refere. */
  linha: string;
  /** O rótulo literal da planilha, para achar a linha no arquivo. */
  rotulo: string;
  quadro: string;
  tipo: TipoDeInconsistencia;
  /**
   * Quanto vale a discordância, com sinal — `devido − demonstrado`.
   *
   * Positivo: o contrato manda pagar mais do que o demonstrativo demonstra.
   * O sinal importa e por isso não é módulo: uma linha em que se paga a menos e
   * outra em que se paga a mais são conversas opostas com o mesmo tamanho.
   */
  valor: number;
  /** As duas fontes que discordam, nomeadas. */
  entre: [string, string];
  /** Por que os dois números são diferentes, em português. */
  porque: string;
  /** O que resolveria — um dado ou uma decisão, nunca um prazo. */
  destrava: string;
}

/* ---------------------------------------------------------------------------
   A entrada: o mínimo do painel comparado que este levantamento lê
   ------------------------------------------------------------------------ */

/**
 * As duas colunas de uma linha do painel.
 *
 * Escrito aqui, e não importado de `resumo.ts`, porque é `resumo.ts` que chama
 * este módulo — importar de volta fecharia um ciclo. Os dois formatos são
 * compatíveis por estrutura, e é o compilador que garante que continuem.
 */
export interface ColunasDaLinha {
  primeira: number | null;
  segunda: number | null;
}

/** O mínimo de uma linha comparada que este levantamento lê. */
export interface LinhaParaLevantar {
  chave: string;
  rotulo: string;
  papel: string;
  devido: ColunasDaLinha;
  demonstrado: ColunasDaLinha;
  /** O que falta para o devido existir. `null` quando ele existe. */
  falta: string | null;
}

/** O mínimo de um quadro comparado que este levantamento lê. */
export interface QuadroParaLevantar {
  quadro: string;
  titulo: string;
  linhas: LinhaParaLevantar[];
}

/**
 * Um centavo — abaixo disso a diferença é resíduo de arredondamento.
 *
 * É a mesma tolerância de `informado.ts` para dinheiro, e pela mesma razão: os
 * dois lados chegam arredondados de lugares diferentes, e exigir igualdade bit
 * a bit encheria a lista de itens de R$ 0,01 que ninguém pode resolver.
 */
const UM_CENTAVO = 0.005;

const O_CONTRATO = "o contrato (cadastro e diário)";
const O_DEMONSTRATIVO = "o 03.08.20";

function textoDe(
  tipo: TipoDeInconsistencia,
  devido: number | null,
  demonstrado: number | null,
  falta: string | null,
): { porque: string; destrava: string } {
  switch (tipo) {
    case "FONTES_DISCORDAM":
      return {
        porque:
          `O contrato manda pagar ${emReais(devido ?? 0)} e o demonstrativo traz ` +
          `${emReais(demonstrado ?? 0)}. As duas leituras são independentes — uma vem do ` +
          "que foi contratado, a outra do que a Ambev assinou —, e é a diferença entre elas " +
          "que se discute na mesa.",
        destrava:
          "Conferir a linha nas duas fontes: ou o cadastro não está na vigência da quinzena, " +
          "ou o demonstrativo enquadrou a verba noutra linha.",
      };
    case "SEM_DEMONSTRADO":
      return {
        porque:
          `O contrato manda pagar ${emReais(devido ?? 0)} e o 03.08.20 não tem verba nenhuma ` +
          "nesta linha. Não é o mesmo que ter pago zero: é o demonstrativo não nomear o que " +
          "o contrato nomeia.",
        destrava:
          "Uma VBZ do demonstrativo que corresponda a esta linha — ou a confirmação de que " +
          "ela não é remunerada nesta quinzena, que também é resposta.",
      };
    case "SEM_DEVIDO":
      return {
        porque:
          `O 03.08.20 demonstra ${emReais(demonstrado ?? 0)} e o contrato não sustenta esta ` +
          "linha, então não há contra o que conferir.",
        destrava:
          falta ??
          "O parâmetro do cadastro ou o documento de que esta linha depende — a linha diz " +
          "qual quando sabe.",
      };
  }
}

/** O item de uma quinzena, quando ela tem o que dizer. `null` quando não tem. */
function daQuinzena(
  canal: Canal,
  quadro: QuadroParaLevantar,
  linha: LinhaParaLevantar,
  quinzena: 1 | 2,
): Inconsistencia | null {
  const coluna = quinzena === 1 ? "primeira" : "segunda";
  const devido = linha.devido[coluna];
  const demonstrado = linha.demonstrado[coluna];

  /* Nenhum dos dois lados respondeu: a quinzena não foi importada. Não é achado. */
  if (devido === null && demonstrado === null) return null;

  let tipo: TipoDeInconsistencia;
  let valor: number;
  if (devido !== null && demonstrado !== null) {
    valor = centavos(devido - demonstrado);
    if (Math.abs(valor) < UM_CENTAVO) return null;
    tipo = "FONTES_DISCORDAM";
  } else if (devido !== null) {
    /*
      Zero devido sem demonstrado não é discordância: é a linha que o contrato
      calculou como vazia e o relatório também não trouxe. Anunciá-la encheria a
      lista de linhas em que os dois lados concordam que não há nada.
    */
    if (Math.abs(devido) < UM_CENTAVO) return null;
    valor = centavos(devido);
    tipo = "SEM_DEMONSTRADO";
  } else {
    if (Math.abs(demonstrado ?? 0) < UM_CENTAVO) return null;
    valor = centavos(-(demonstrado ?? 0));
    tipo = "SEM_DEVIDO";
  }

  const { porque, destrava } = textoDe(tipo, devido, demonstrado, linha.falta);
  return {
    chave: `${linha.chave}:${quinzena}`,
    canal,
    quinzena,
    linha: linha.chave,
    rotulo: linha.rotulo,
    quadro: quadro.quadro,
    tipo,
    valor,
    entre: tipo === "SEM_DEVIDO" ? [O_DEMONSTRATIVO, O_CONTRATO] : [O_CONTRATO, O_DEMONSTRATIVO],
    porque,
    destrava,
  };
}

/**
 * O levantamento: uma linha da lista para cada quinzena que discorda.
 *
 * **Por linha e por quinzena, e não por linha.** Uma linha pode bater na 2ª
 * quinzena e não bater na 1ª — é o caso mais comum quando um desconto muda de
 * lugar entre as duas —, e um item só, com as duas colunas, obrigaria a
 * escrever um motivo que vale para metade dele.
 *
 * **A linha de `TOTAL` fica de fora.** Ela é o fecho do quadro, e a diferença
 * dela é a soma das diferenças das linhas que já estão na lista. Incluí-la
 * contaria tudo duas vezes — que é exatamente o que a nota de abertura recusa.
 *
 * A ordem é por tamanho, do maior para o menor: quem abre esta lista tem um
 * tempo finito, e o que ela responde primeiro é *por onde começar*.
 */
export function levantarInconsistencias(
  canal: Canal,
  quadros: readonly QuadroParaLevantar[],
): Inconsistencia[] {
  const achados: Inconsistencia[] = [];
  for (const quadro of quadros) {
    for (const linha of quadro.linhas) {
      if (linha.papel === "TOTAL") continue;
      for (const quinzena of [1, 2] as const) {
        const item = daQuinzena(canal, quadro, linha, quinzena);
        if (item) achados.push(item);
      }
    }
  }
  return achados.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
}
