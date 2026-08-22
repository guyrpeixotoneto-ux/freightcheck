import { LINHAS_VERIFICAVEIS_NO_ACERVO } from "./catalogo";
import { CHAVES_DO_CONTRATO, CHAVES_OBRIGATORIAS, CHAVES_OPCIONAIS } from "./contrato";
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
  /**
   * Quantas linhas têm número **porque alguém as informou**, e não porque o
   * acervo as sustenta.
   *
   * Fica fora de `comLastro` de propósito, e é a decisão mais importante deste
   * arquivo depois da que separa as duas metades. Somá-las faria uma unidade
   * que não importou nada e teve a planilha digitada aparecer na lista do mesmo
   * jeito que uma que entregou os dois exports — e as duas pedem coisas
   * opostas de quem opera: a primeira precisa de arquivo, a segunda não precisa
   * de nada.
   */
  informadas: number;
  /** Quantas linhas o acervo e a planilha respondem — as conferíveis. */
  conferidas: number;
  /** Destas, quantas discordam. É o que faz alguém abrir a unidade. */
  divergentes: number;

  /* --- o que a tela precisa para não confundir três perguntas ----------- */

  /**
   * Quantas linhas **podem** ter lastro documental — o denominador honesto.
   *
   * Onze das trinta. As outras dezenove não esperam arquivo: são decisão de
   * negócio digitada ou conta que o cadastro refaz. `0 de 30` dizia à pessoa
   * que faltavam trinta arquivos; `0 de 11` diz quantos itens o acervo poderia
   * confirmar. Ver `procedenciaPossivel`, em `catalogo.ts`.
   */
  verificaveis: number;
  /** Quantas linhas o **contrato** exige para produzir devido — as vinte. */
  obrigatorias: number;
  /** Destas, quantas foram informadas. `obrigatorias` é o alvo. */
  obrigatoriasInformadas: number;
  /**
   * Opcionais não informadas — a premissa, não um erro.
   *
   * A `.xlsb` deixa `Marketing` e `Lucro Operacional` em branco e as soma como
   * zero; uma célula que a própria aba deixa vazia e trata como zero não é
   * ausência de informação. A tela diz a premissa em vez de contar uma falta.
   */
  opcionaisAssumidasComoZero: number;
  /** Linhas que o motor refaz — digitá-las é conferência, não entrada. */
  calculadas: number;
  /**
   * **A resposta que o indicador principal deve dar.** O cadastro basta para
   * calcular o devido desta vigência?
   *
   * É `true` quando as vinte obrigatórias têm número informado — exatamente a
   * regra de `contratoDaPlanilha`, que é quem monta o contrato. Não depende de
   * lastro, e não pode passar a depender: o devido sai do que foi contratado,
   * e a prova de que ele é independente do acervo está em
   * `cadastro-a-mao-sem-lastro.test.ts`.
   */
  suficienteParaCalcular: boolean;
  /** Conferências entre o digitado e o acervo — evidência externa. */
  conferenciasComAcervo: number;
  /** Conferências da aba contra ela mesma — coerência de transcrição. */
  conferenciasInternas: number;
  /** Das conferências com o acervo, quantas discordam. */
  divergenciasComAcervo: number;
  /** Das internas, quantas discordam — erro de transcrição, não de fonte. */
  divergenciasInternas: number;
}

/**
 * Linha que o **acervo** sustenta, sozinha ou em par.
 *
 * Lê `lastroDoAcervo`, e não o estado, e a diferença é a linha mais importante
 * deste arquivo. Duas razões, e as duas são defeitos que ela previne:
 *
 * - um número **digitado** é lastro da planilha, não do acervo, e os quatro
 *   estados abaixo respondem sobre o que a unidade **entregou**. Contá-lo faria
 *   uma unidade sem nenhum arquivo importado, mas com a aba de Excel
 *   transcrita, aparecer como "Frota e alíquotas" — mandando quem opera parar
 *   de procurar exatamente o arquivo que falta;
 * - e o inverso: uma linha do par PIS + COFINS que alguém informou deixa de ser
 *   `EM_CONJUNTO` e continua sendo sustentada pelo export. Ler o estado faria a
 *   unidade **perder** lastro por alguém ter preenchido a planilha.
 */
function temLastro(linha: LinhaApurada): boolean {
  return linha.lastroDoAcervo;
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

  /*
    A suficiência é medida sobre o **declarado**, e não sobre o valor da linha.

    É a mesma base que `contratoDaPlanilha` usa: o contrato sai da aba digitada
    e só dela. Medir sobre `valor` diria "suficiente" para uma unidade cujas
    alíquotas o acervo mede e ninguém digitou — e o contrato continuaria sem
    sair, com a tela dizendo o contrário.
  */
  const declaradas = new Set(
    linhas.filter((linha) => linha.declarado !== null).map((linha) => linha.chave),
  );
  const obrigatoriasInformadas = CHAVES_OBRIGATORIAS.filter((c) => declaradas.has(c)).length;

  return {
    linhas: montado.resumo.linhas,
    comLastro: montado.resumo.comLastro,
    verificaveis: LINHAS_VERIFICAVEIS_NO_ACERVO.length,
    obrigatorias: CHAVES_OBRIGATORIAS.length,
    obrigatoriasInformadas,
    opcionaisAssumidasComoZero: CHAVES_OPCIONAIS.filter((c) => !declaradas.has(c)).length,
    calculadas: montado.resumo.linhas - CHAVES_DO_CONTRATO.length,
    suficienteParaCalcular: obrigatoriasInformadas === CHAVES_OBRIGATORIAS.length,
    conferenciasComAcervo: montado.resumo.conferenciasComAcervo,
    conferenciasInternas: montado.resumo.conferenciasInternas,
    divergenciasComAcervo: montado.resumo.divergenciasComAcervo,
    divergenciasInternas: montado.resumo.divergenciasInternas,
    /*
      O que o acervo não sustenta — e não "o que não tem número". Os dois
      diferiam no dia em que a planilha passou a ser informável: uma linha
      digitada tem número e continua sem lastro nenhum do acervo, que é o que
      esta lista responde. Somados, os dois dão as trinta.
    */
    semLastro: montado.resumo.linhas - montado.resumo.comLastro,
    informadas: montado.resumo.informadas,
    conferidas: montado.resumo.conferidas,
    divergentes: montado.resumo.divergentes,
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
