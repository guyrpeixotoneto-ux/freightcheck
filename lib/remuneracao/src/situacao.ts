import type { CadastroMontado, LinhaApurada } from "./montagem";

/**
 * A situação do cadastro de uma unidade — a resposta antes de abrir a unidade.
 *
 * O módulo inteiro responde "qual é o cadastro **desta** unidade nesta
 * vigência". Falta a pergunta que vem antes dela, e que é a primeira que quem
 * opera faz na virada da quinzena: **quais unidades já têm cadastro, e quais
 * ainda não têm.** Sem ela, a única forma de descobrir que um CDD entregou a
 * frota e não entregou os trechos é abrir o CDD — o que, com trinta unidades,
 * é abrir trinta telas para achar as duas que faltam.
 *
 * Esta medição é pura, como o resto da aritmética do módulo: recebe o cadastro
 * já montado e devolve o que ele cobre. Nada aqui vai ao banco, e nada aqui
 * conta linha por conta própria — os números saem de `CadastroMontado.resumo`,
 * que é o mesmo que a tela do cadastro mostra. Recontá-los seria criar uma
 * segunda verdade sobre a mesma tela.
 *
 * **Por que o estado é sobre as duas metades, e não sobre "quantos por cento
 * do cadastro está pronto".** Hoje, sobre um acervo completo, onze das trinta
 * linhas têm lastro — as outras dezenove dependem de decisões de negócio que
 * ninguém registrou, e não de arquivo que alguém deixou de mandar. Um
 * percentual sobre as trinta diria "37% cadastrado" para a unidade que entregou
 * tudo o que tinha para entregar, e a leitura natural disso é que falta
 * importar alguma coisa. O que de fato separa uma unidade da outra são as duas
 * metades que dependem do que ela mandou: a **frota**, que vem do export de
 * equipamento, e as **alíquotas**, que vêm do de frete. É por elas que o estado
 * responde, e é sobre elas que quem opera pode agir hoje.
 */

/**
 * O que o acervo sustenta no cadastro daquela unidade.
 *
 * Os quatro são exaustivos e nenhum deles é um juízo sobre a unidade: dizem o
 * que os arquivos entregues alcançam, e a diferença aparece no rótulo — nenhum
 * se chama "incompleto", porque incompleto em relação a quê é justamente o que
 * a frase acima recusa a fingir que sabe.
 */
export type EstadoDoCadastro =
  /** As duas metades: o cadastro mede a frota e mede as alíquotas. */
  | "FROTA_E_ALIQUOTAS"
  /** Só a frota. Sem os trechos não há alíquota, proporção nem resumo de impostos. */
  | "SO_FROTA"
  /** Só as alíquotas. A vigência não entregou cavalos, e a frota fixa fica sem número. */
  | "SO_ALIQUOTAS"
  /** Nenhuma das duas: a unidade entregou vigência, mas não o que o cadastro lê. */
  | "SEM_LASTRO";

export interface SituacaoDoCadastro {
  /** Quantas linhas o cadastro tem — as trinta do catálogo. */
  linhas: number;
  /** Quantas têm número, contando as que o têm em par (PIS + COFINS). */
  comLastro: number;
  semLastro: number;
  /** Se o acervo sustenta a contagem de frota fixa. */
  frota: boolean;
  /** Se o acervo sustenta as alíquotas — ICMS, ISS ou o par PIS + COFINS. */
  aliquotas: boolean;
  estado: EstadoDoCadastro;
}

/** Linha com número, seja sozinha ou em par. */
function temLastro(linha: LinhaApurada): boolean {
  return linha.estado === "APURADO" || linha.estado === "EM_CONJUNTO";
}

/**
 * A situação de um cadastro montado.
 *
 * As duas metades são medidas por `origem.tipo`, e não por título de bloco: o
 * título é texto da planilha e pode ser reescrito; a origem é o que a linha
 * declara sobre de onde o número sai, e é ela que decide se o acervo a
 * sustenta.
 *
 * **`some` e não `every`, de propósito.** Uma vigência pode ter só trechos de
 * ICMS — nenhum documento saiu por dentro do município naquela quinzena — e
 * então a alíquota de ISS não tem o que medir. Exigir as três alíquotas diria
 * "esta unidade não entregou frete", que é falso e manda procurar um arquivo
 * que está lá. Uma alíquota medida já prova que a série chegou e que as colunas
 * em reais vieram com ela, que é o que este estado existe para dizer.
 */
export function medirSituacao(montado: CadastroMontado): SituacaoDoCadastro {
  const linhas = montado.blocos.flatMap((bloco) => bloco.linhas);

  const frota = linhas.some(
    (linha) => linha.origem.tipo === "CONTAGEM_DE_FROTA" && temLastro(linha),
  );
  const aliquotas = linhas.some(
    (linha) =>
      (linha.origem.tipo === "ALIQUOTA_DECLARADA" ||
        linha.origem.tipo === "ALIQUOTA_CONJUNTA_PIS_COFINS") &&
      temLastro(linha),
  );

  return {
    linhas: montado.resumo.linhas,
    comLastro: montado.resumo.apuradas + montado.resumo.emConjunto,
    semLastro: montado.resumo.semLastro,
    frota,
    aliquotas,
    estado: frota && aliquotas
      ? "FROTA_E_ALIQUOTAS"
      : frota
        ? "SO_FROTA"
        : aliquotas
          ? "SO_ALIQUOTAS"
          : "SEM_LASTRO",
  };
}
