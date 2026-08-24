import type { TipoDeFonte } from "@/lib/fechamento";

/**
 * O ROTEIRO DO FECHAMENTO — as etapas do processo, na ordem em que ele é feito.
 *
 * **Este é um segundo eixo sobre as mesmas fontes, não uma substituição do
 * primeiro.** `LADOS_DA_CONFERENCIA` (no domínio) classifica cada relatório
 * pelo *papel que ele tem no cálculo*: o que forma o devido, o que a Ambev
 * demonstrou, o que é faturamento. Isso é do motor, e continua mandando na
 * apuração. O roteiro classifica os mesmos relatórios pela *ordem em que
 * alguém os confere* — e as duas coisas não coincidem: o 03.08.18 forma o
 * devido e é conferido na etapa 3; o 03.08.20 demonstra o pagamento e é
 * conferido na 4.
 *
 * Misturar os dois eixos numa lista só foi a tentação óbvia, e teria quebrado
 * o agrupamento que a apuração consome. Por isso o roteiro mora aqui, na
 * página, e é uma leitura *sobre* o catálogo de fontes — nunca a fonte da
 * verdade sobre o que uma fonte é.
 *
 * **O que este arquivo não faz.** Não inventa conferência: cada etapa declara,
 * em `confere`, o que o sistema **de fato** verifica hoje, e em `aindaNao` o
 * que o processo exige e o sistema ainda não sustenta. Uma etapa sem nenhuma
 * conferência automática é uma etapa honesta — ela organiza os arquivos e diz
 * que o resto é conferência humana. Escrever ali uma promessa que o motor não
 * cumpre seria pior do que não ter a etapa.
 */

/** Uma etapa do roteiro — o que se confere, com que arquivos, e o que falta. */
export interface EtapaDoRoteiro {
  /** `1`…`8` — a ordem é do processo, e é ela que a trilha do topo mostra. */
  numero: number;
  /** O nome curto, para a trilha. Cabe em uma ou duas palavras. */
  curto: string;
  /** O nome da etapa, na linguagem de quem fecha. */
  titulo: string;
  /**
   * O que se está conferindo, em uma frase — na língua do processo, não no
   * nome do arquivo. É a primeira coisa que a etapa diz.
   */
  confere: string;
  /** As fontes que esta etapa recebe. Vazio quando a etapa não recebe arquivo. */
  fontes: TipoDeFonte[];
  /**
   * O que o sistema **realmente** verifica nesta etapa, hoje. Cada item é uma
   * afirmação que se pode apontar no código — não uma intenção.
   *
   * Uma `string` é a frase inteira, para quando ela já é curta. Um objeto
   * separa a frase (`texto`) do porquê ou da ressalva (`detalhe`) — a tela
   * mostra só o texto, e o detalhe fica atrás do ícone de informação, para
   * quem quiser o resto sem que todo mundo tenha que ler tudo de cara.
   */
  verifica: (string | { texto: string; detalhe: string })[];
  /**
   * O que o processo pede aqui e o sistema **ainda não** sustenta, com o motivo.
   *
   * Aparece na tela como pendência declarada, e não como falha: a diferença
   * entre "o sistema não confere isto" e "isto está certo" é a coisa mais cara
   * de se perder num fechamento.
   */
  aindaNao: { o_que: string; porque: string }[];
  /**
   * Um aviso operacional desta etapa — o que quem envia precisa saber **antes**
   * de clicar, e que não cabe em nenhum dos campos acima.
   *
   * Existe para uma etapa só hoje (a do 03.08.18, que tem duas casinhas para o
   * que muita gente exporta como um arquivo de duas abas). Ficava no topo da
   * tela, valendo para todas; no roteiro ele desce para a etapa a que se
   * refere, que é onde alguém está olhando quando precisa dele.
   */
  nota?: string;
}

/**
 * As oito etapas.
 *
 * A ordem é a do fechamento como ele é executado: a base contratual primeiro
 * (é ela que diz quanto *deveria* ser pago), depois as conferências de
 * quantidade e disponibilidade, depois o que foi de fato emitido, e a
 * conciliação por último — que é onde as três respostas se encontram.
 */
export const ROTEIRO: EtapaDoRoteiro[] = [
  {
    numero: 1,
    curto: "Base FT",
    titulo: "Base FT / Contrato",
    confere:
      "A base do que deveria ser pago: frota contratada, valores, custo fixo, equipe de entrega, " +
      "impostos e custo variável — o cadastro que o fechamento usa como régua.",
    fontes: [],
    verifica: [
      "Se existe cadastro de Remuneração para esta unidade, transportadora e operação na vigência da quinzena.",
      {
        texto: "Se a competência está associada a uma unidade canônica.",
        detalhe: "Sem isso, o cadastro não é encontrado.",
      },
      "Os valores do contrato — frota, custo fixo, equipe de entrega, custos indiretos, alíquotas e custo variável —, por categoria de veículo.",
    ],
    aindaNao: [
      {
        o_que: "Conferir a quantidade de veículos ativos contra o Resumo SR Trans do FT.",
        porque:
          "Esta fonte não existe no sistema — não há leitor, tabela nem tela para ela. É preciso " +
          "definir com a operação o que exatamente é o Resumo SR Trans antes de construí-la.",
      },
    ],
  },
  {
    numero: 2,
    curto: "Frota",
    titulo: "Frota Promax",
    confere:
      "Se a quantidade de veículos considerada no FT corresponde à frota ativa e inativa que o " +
      "Promax informa, por unidade e por modelo.",
    fontes: ["FROTA_PROMAX_ATIVA", "FROTA_PROMAX_INATIVA"],
    verifica: [
      "Quantos veículos o Promax traz, agrupados por unidade, modelo/categoria e situação.",
      "A diferença contra a frota do cadastro do contrato, com o movimento de cada grupo.",
      {
        texto: "Placas em conflito dentro do mesmo agrupamento.",
        detalhe: "Não são resolvidas por escolha automática.",
      },
    ],
    aindaNao: [
      {
        o_que: "Conferir os valores por equipamento/equipe do 01.22.02.00.",
        porque:
          "O leitor extrai a identificação do veículo, não os valores por equipamento. O layout real " +
          "do relatório ainda não foi confirmado com a operação.",
      },
    ],
  },
  {
    numero: 3,
    curto: "Disponibilidade",
    titulo: "Disponibilidade",
    confere:
      "Quantos veículos deveriam estar disponíveis, quantos ficaram, e quanto isso desconta da " +
      "remuneração — frota fixa e vans, que descontam coisas diferentes.",
    fontes: ["DISPONIBILIDADE_FF", "DISPONIBILIDADE_VAN"],
    nota:
      "O 03.08.18 vem em dois — FF e Vans —, e cada um tem a sua casinha: são frotas diferentes e " +
      "descontos diferentes. Se a sua exportação vier com as duas abas num arquivo só, mande o " +
      "mesmo arquivo nas duas: cada casinha lê a frota dela e ignora a outra, e por isso mandá-lo " +
      "duas vezes não dobra a conta.",
    verifica: [
      {
        texto: "O desconto de disponibilidade do período.",
        detalhe:
          "Somado dos dias dentro da competência, e em quantos dias houve desconto.",
      },
      "Se o desconto do 03.08.18 bate com o que o 03.08.20 declara como Desconto FF — Equipe Entrega.",
    ],
    aindaNao: [
      {
        o_que: "O acompanhamento dia a dia — contratada contra realizada, com histórico.",
        porque:
          "O dado é gravado com grão diário (frota contratada, real da 1ª e da 2ª viagem, percentual " +
          "de disponibilidade), mas nenhuma rota o lê: hoje só o desconto consolidado do período sai " +
          "para a tela. Mostrar o diário exige uma leitura nova.",
      },
      {
        o_que: "Separar o gap da Ambev do gap da transportadora.",
        porque:
          "Os campos são lidos e gravados, mas nenhum cálculo os usa — a apuração soma o desconto " +
          "total sem olhar de quem é a responsabilidade.",
      },
    ],
  },
  {
    numero: 4,
    curto: "Remuneração",
    titulo: "Remuneração — o que a Ambev demonstrou pagar",
    confere:
      "O demonstrativo verba a verba: o que foi emitido, os descontos, as devoluções, e se o total " +
      "que o relatório assina bate com a soma das próprias linhas.",
    fontes: ["PAGAMENTO"],
    verifica: [
      {
        texto: "Quantas verbas o documento sustenta.",
        detalhe:
          "Um 03.08.20 que não sustenta nenhuma é apontado, com diagnóstico linha a linha.",
      },
      "O Total Remuneração declarado no rodapé contra o total calculado somando as verbas, por canal.",
      "Descontos de devolução, disponibilidade e frete mínimo, com a verba de que cada um já foi subtraído.",
      {
        texto: "Linhas de desconto com valor que o leitor não reconheceu.",
        detalhe: "Recusadas em vez de descartadas.",
      },
      "Cada verba do demonstrativo contra o CT-e emitido na mesma VBZ.",
    ],
    aindaNao: [
      {
        o_que: "O percentual de NF e de CTC por VBZ.",
        porque:
          "Os dois valores são lidos e gravados por linha, mas nenhuma função calcula a proporção " +
          "entre eles, e os percentuais que o cabeçalho declara não são lidos.",
      },
    ],
  },
  {
    numero: 5,
    curto: "Custo variável",
    titulo: "CT-e diário e custo variável",
    confere:
      "O fecho da quinzena: o que foi emitido contra o que o SRTrans calculou, os complementares, " +
      "o freteiro e o custo variável.",
    fontes: ["CONCILIACAO"],
    verifica: [
      "O total variável calculado pelo SRTrans contra o frete que o 2Art registrou na operação.",
      "O desconto de frete mínimo e o saldo que atravessa para a próxima quinzena.",
      "Os avisos que o próprio relatório traz no rodapé.",
    ],
    aindaNao: [
      {
        o_que: "Abrir as rubricas do relatório uma a uma — freteiro, complementares, custo variável.",
        porque:
          "O motor lê essas rubricas para produzir as divergências acima, mas as linhas do relatório " +
          "não são publicadas por nenhuma rota: só o que virou divergência chega à tela.",
      },
      {
        o_que: "O CT-e emitido dia a dia.",
        porque:
          "Este relatório é um resumo de quinzena — não há data por linha. O grão diário existe no " +
          "2Art (ver Os dias da quinzena) e no 03.08.15, que traz a data de emissão de cada CT-e.",
      },
    ],
  },
  {
    numero: 6,
    curto: "CT-e VBZ",
    titulo: "CT-e por VBZ e competência",
    confere:
      "Tudo que foi faturado em CT-e, verba a verba, e se cada movimento está na competência e na " +
      "quinzena certas.",
    fontes: ["CTE"],
    verifica: [
      "O emitido por VBZ, com a contagem de documentos e a base de cálculo de cada verba.",
      "As alíquotas medidas a partir dos próprios CT-es, comparadas às do contrato.",
    ],
    aindaNao: [
      {
        o_que: "Recusar ou reclassificar CT-e lançado fora da competência.",
        porque:
          "A data de emissão é lida e gravada, mas nada a confronta com o período — a guarda de " +
          "período existe só para o 2Art e o 03.08.20, que declaram o período no próprio cabeçalho.",
      },
      {
        o_que: "Identificar movimento de outra operação (Rodpar) lançado nesta competência.",
        porque:
          "O relatório não traz coluna de operação ou filial, então não há dado que permita separar " +
          "um movimento de outra operação dos demais. Reclassificar exigiria primeiro que essa " +
          "informação chegasse no arquivo.",
      },
    ],
  },
  {
    numero: 7,
    curto: "Outros custos",
    titulo: "Outros custos",
    confere:
      "As despesas extras aprovadas — se pertencem a esta quinzena e se foram faturadas.",
    fontes: ["REQUISICOES"],
    verifica: [
      "Requisição aprovada cuja VBZ não teve nenhum CT-e emitido.",
      "O valor das requisições aprovadas entra no esperado da verba, com o imposto medido do canal.",
    ],
    aindaNao: [
      {
        o_que: "Conferir se a quinzena de pagamento da requisição é a desta competência.",
        porque:
          "A quinzena de pagamento é lida e gravada em cada requisição, mas nenhum código a compara " +
          "com o período da competência.",
      },
      {
        o_que: "Listar as requisições recebidas.",
        porque:
          "As requisições são gravadas, mas só aparecem na tela as que viraram divergência; as " +
          "reprovadas e pendentes são descartadas do cálculo sem aviso.",
      },
    ],
  },
  {
    numero: 8,
    curto: "Conciliação",
    titulo: "Conciliação final",
    confere:
      "As três respostas lado a lado: quanto deveria ser pago pelo contrato, quanto foi emitido nos " +
      "relatórios, e quanto entrou na planilha de remuneração — com a diferença explicada.",
    fontes: [],
    verifica: [
      "O devido pelo contrato contra o demonstrado pelo 03.08.20, verba a verba.",
      {
        texto: "O que a planilha da operação publica no RESUMO GERAL.",
        detalhe:
          "Com a diferença e a célula de origem, quando a planilha está anexada.",
      },
    ],
    aindaNao: [
      {
        o_que: "Classificar cada diferença por categoria — veículos, contratual, disponibilidade, competência.",
        porque:
          "As divergências são nomeadas por tipo e apontam a fonte de origem, mas não há classificação " +
          "por categoria de causa nem registro de quem conferiu e com que desfecho.",
      },
    ],
  },
];

/** A etapa a que uma fonte pertence — `undefined` se ela não estiver no roteiro. */
export function etapaDaFonte(tipo: TipoDeFonte): EtapaDoRoteiro | undefined {
  return ROTEIRO.find((e) => e.fontes.includes(tipo));
}

/**
 * As fontes que o roteiro não cobre.
 *
 * Hoje é o 2Art: ele não é uma etapa da conferência da Rebeca — é o registro da
 * operação, que a seção "Os dias da quinzena" já mostra inteiro. Fica fora do
 * roteiro e continua na tela, em vez de ganhar uma etapa que o processo não tem.
 *
 * A função existe para que **acrescentar uma fonte nova ao domínio sem colocá-la
 * no roteiro seja visível**, em vez de fazê-la sumir da tela: quem não está em
 * etapa nenhuma aparece à parte, nomeado.
 */
export function fontesForaDoRoteiro(todas: TipoDeFonte[]): TipoDeFonte[] {
  const noRoteiro = new Set(ROTEIRO.flatMap((e) => e.fontes));
  return todas.filter((t) => !noRoteiro.has(t));
}
