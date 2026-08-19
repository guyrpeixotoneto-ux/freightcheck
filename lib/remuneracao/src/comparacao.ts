import type { Medida, Preenchimento } from "./catalogo";
import type { CadastroMontado, LinhaApurada } from "./montagem";

/**
 * As duas quinzenas lado a lado — a planilha como ela de fato é.
 *
 * A aba de cadastro do Excel traz **dois blocos idênticos, um ao lado do
 * outro**: as duas quinzenas do mês. As alíquotas e a frota repetem entre eles;
 * o que se move são as parcelas e as proporções — na aba de CDD Belém, a frota
 * fixa ativa vai de R$ 1.424,91 para R$ 1.038,03 e a fatia de documentos dentro
 * do município cai de 3,16% para 2,38%. Quem confere lê as duas colunas juntas,
 * de olho na diferença; uma tela que mostrasse uma de cada vez devolveria essa
 * comparação para a memória de quem está olhando.
 *
 * Função pura, como o resto da aritmética deste módulo: recebe dois cadastros
 * já montados e devolve o par. Quem os lê do banco é `leitura.ts`.
 *
 * **A recusa que este arquivo existe para fazer: lastro que aparece ou some não
 * é dinheiro que se moveu.** Uma linha sem lastro na quinzena passada e apurada
 * nesta subiu de coisa nenhuma — subiu de *não sabíamos*. Tratá-la como uma
 * variação a partir de zero produziria o número mais perigoso que esta tela
 * poderia mostrar: um aumento de 100% que descreve uma coluna que passou a ser
 * importada, e não um centavo a mais na conta da transportadora. Por isso
 * {@link Movimento} tem seis valores e não três, e por isso `variacao` é nula
 * em quatro deles.
 */

/** Quanto a linha se moveu entre as duas pontas. */
export interface Variacao {
  absoluta: number;
  /** Nulo quando a base é zero — dividir por zero não é "infinito%". */
  percentual: number | null;
}

/**
 * O que aconteceu com a linha entre uma quinzena e a outra.
 *
 * Os quatro últimos valores são sobre o **acervo**, não sobre o dinheiro, e
 * ficam separados dos dois primeiros exatamente por isso.
 */
export type Movimento =
  /** As duas pontas têm número, e é o mesmo. */
  | "IGUAL"
  /** As duas pontas têm número, e o da direita é maior. */
  | "SUBIU"
  /** As duas pontas têm número, e o da direita é menor. */
  | "DESCEU"
  /** A esquerda não tinha lastro e a direita tem. Não é aumento — é cobertura. */
  | "GANHOU_LASTRO"
  /** A esquerda tinha lastro e a direita não. É o movimento que pede alarme. */
  | "PERDEU_LASTRO"
  /** Nenhuma das duas sustenta a linha, ou as duas não são comparáveis entre si. */
  | "SEM_COMPARACAO";

export interface LinhaComparada {
  chave: string;
  rotulo: string;
  medida: Medida;
  preenchimento: Preenchimento;
  esquerda: LinhaApurada;
  direita: LinhaApurada;
  movimento: Movimento;
  /** Só existe quando as duas pontas têm número comparável entre si. */
  variacao: Variacao | null;
}

export interface BlocoComparado {
  titulo: string;
  resumo: string;
  linhas: LinhaComparada[];
}

export interface ResumoDaComparacao {
  linhas: number;
  iguais: number;
  /** Linhas com número dos dois lados e valores diferentes. */
  mudaram: number;
  ganharamLastro: number;
  perderamLastro: number;
  semComparacao: number;
}

export interface CadastroComparado {
  blocos: BlocoComparado[];
  resumo: ResumoDaComparacao;
}

/**
 * O número que a linha oferece para comparação, ou nulo.
 *
 * A linha medida em par (PIS e COFINS) devolve o valor do par: é o único número
 * que o acervo sustenta para ela, e é ele que se compara de uma quinzena para a
 * outra.
 */
function comparavel(linha: LinhaApurada): number | null {
  if (linha.estado === "APURADO") return linha.valor;
  if (linha.estado === "EM_CONJUNTO") return linha.conjunto?.valor ?? null;
  return null;
}

/*
  As duas pontas já chegam arredondadas por `medicao.ts` — quatro casas em
  percentual, duas em dinheiro, inteiro em quantidade. A folga aqui é contra o
  resíduo binário de somas iguais feitas em ordens diferentes, não contra
  diferença de verdade: nenhuma diferença que importe a esta tela é menor que
  um bilionésimo.
*/
const FOLGA = 1e-9;

export function compararCadastros(
  esquerda: CadastroMontado,
  direita: CadastroMontado,
): CadastroComparado {
  const daDireita = new Map(
    direita.blocos.flatMap((b) => b.linhas).map((l) => [l.chave, l]),
  );

  const blocos: BlocoComparado[] = esquerda.blocos.map((bloco) => ({
    titulo: bloco.titulo,
    resumo: bloco.resumo,
    linhas: bloco.linhas.map((linhaEsquerda) => {
      /*
        As duas pontas saem do mesmo catálogo, então a chave sempre existe do
        outro lado. O `??` não é defesa contra dado — é o que faz o tipo fechar
        sem um `!`, e se um dia o catálogo passar a variar por vigência, o lado
        ausente vira `SEM_COMPARACAO` em vez de derrubar a tela.
      */
      const linhaDireita = daDireita.get(linhaEsquerda.chave) ?? linhaEsquerda;
      return comparar(linhaEsquerda, linhaDireita);
    }),
  }));

  return { blocos, resumo: contarResumo(blocos) };
}

function comparar(esquerda: LinhaApurada, direita: LinhaApurada): LinhaComparada {
  const base = {
    chave: esquerda.chave,
    rotulo: esquerda.rotulo,
    medida: esquerda.medida,
    preenchimento: esquerda.preenchimento,
    esquerda,
    direita,
  };

  const a = comparavel(esquerda);
  const b = comparavel(direita);

  if (a === null && b === null) {
    return { ...base, movimento: "SEM_COMPARACAO", variacao: null };
  }
  if (a === null) return { ...base, movimento: "GANHOU_LASTRO", variacao: null };
  if (b === null) return { ...base, movimento: "PERDEU_LASTRO", variacao: null };

  /*
    Os dois lados têm número, e ainda assim podem não ser o mesmo número.
    `APURADO` contra `EM_CONJUNTO` compararia a alíquota isolada de um lado com
    o par PIS + COFINS do outro — dois nomes para grandezas diferentes. Não
    acontece hoje (o estado nasce do tipo de origem, que é fixo por linha), e é
    justamente por isso que precisa estar escrito: no dia em que uma linha
    ganhar origem própria, a comparação não pode passar a subtrair maçã de
    laranja em silêncio.
  */
  if (esquerda.estado !== direita.estado) {
    return { ...base, movimento: "SEM_COMPARACAO", variacao: null };
  }

  const absoluta = b - a;
  if (Math.abs(absoluta) < FOLGA) {
    return { ...base, movimento: "IGUAL", variacao: { absoluta: 0, percentual: 0 } };
  }

  return {
    ...base,
    movimento: absoluta > 0 ? "SUBIU" : "DESCEU",
    variacao: {
      absoluta,
      percentual: Math.abs(a) < FOLGA ? null : (absoluta / a) * 100,
    },
  };
}

function contarResumo(blocos: BlocoComparado[]): ResumoDaComparacao {
  const linhas = blocos.flatMap((b) => b.linhas);
  const quantas = (m: Movimento) => linhas.filter((l) => l.movimento === m).length;

  return {
    linhas: linhas.length,
    iguais: quantas("IGUAL"),
    mudaram: quantas("SUBIU") + quantas("DESCEU"),
    ganharamLastro: quantas("GANHOU_LASTRO"),
    perderamLastro: quantas("PERDEU_LASTRO"),
    semComparacao: quantas("SEM_COMPARACAO"),
  };
}
