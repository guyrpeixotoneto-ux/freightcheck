/**
 * Que valor da remuneração cada parâmetro mexe.
 *
 * **O que este módulo responde.** A aba Chamados lista uma alteração por
 * parâmetro, e a primeira pergunta de quem confere um mês inteiro de chamados
 * não é "quais foram" — é *o que isso mexeu*. A remuneração da Ambev tem
 * componentes que se leem separados: o **valor fixo** (o que se recebe por ter
 * o ativo disponível), o **valor variável** (o que se recebe por rodar) e o
 * **variável diesel** (o combustível, que tem regra própria). Um chamado que
 * mexe em `seguro` e outro que mexe em `kmIda` mudam dinheiros diferentes, e
 * somá-los numa lista só esconde exatamente a distinção que importa.
 *
 * **De onde vem esta tabela.** Do time, e está escrito entrada por entrada em
 * `origem`. A maior parte veio da planilha de classificação que o operador
 * mantém à mão — três tabelas dinâmicas, uma por componente, com os parâmetros
 * que ele já viu mexer em cada um. Essa planilha é a fonte de maior força de
 * prova que existe aqui: é a classificação de quem opera, e onde ela fala este
 * módulo repete sem discutir. O resto vem de identidade medida neste próprio
 * repositório (`lib/composition/src/regras.ts`) ou do catálogo do Freightech
 * (`catalogo.ts`), e nunca de semelhança de nome.
 *
 * **Um parâmetro pode mexer em mais de um valor, e isso não é defeito.**
 * `cavaloEmpurrada` está nas duas tabelas da planilha do time — troca de placa
 * mexe no fixo do conjunto e no variável da rota ao mesmo tempo. Por isso
 * `classes` é lista e não campo único, e por isso **as contagens por classe não
 * somam o total**: quem exibe precisa dizer isso em voz alta, e a tela diz.
 *
 * **O que não se conhece fica visível.** Um parâmetro fora desta tabela cai em
 * "não classificado" *com o nome à mostra*. É o contrário de um `else` que
 * escolhe uma caixa: a lista de não classificados é a fila de trabalho de quem
 * mantém este arquivo, e escondê-la faria a tela afirmar uma cobertura que ela
 * não tem. Uma entrada com `classes: []` é a mesma coisa dita de propósito —
 * conhecemos o parâmetro e ele deliberadamente não mexe em nenhum dos três.
 *
 * **Por que aqui, e não no banco.** Mesma razão do `catalogo.ts` ao lado: isto
 * é o mapa do modelo de remuneração, não uma projeção dos nossos fatos.
 * Precisa existir com o banco vazio, que é justamente quando alguém está
 * subindo o primeiro export de chamados para entender o que tem em mãos.
 */

/** Os três valores que a remuneração paga, e que um chamado pode mexer. */
export type ClasseDeValor = "FIXO" | "VARIAVEL" | "VARIAVEL_DIESEL";

/** A caixa de quem não está na tabela — ou está, e não mexe em nenhum valor. */
export const NAO_CLASSIFICADO = "NAO_CLASSIFICADO";

/** As quatro caixas que a tela mostra: as três de valor e a dos que faltam. */
export type ClasseNaTela = ClasseDeValor | typeof NAO_CLASSIFICADO;

export interface DescricaoDeClasse {
  codigo: ClasseNaTela;
  /** Nome curto, o mesmo que a planilha do time usa. */
  nome: string;
  /** A frase que a tela põe embaixo do nome. Sem jargão. */
  descricao: string;
}

/**
 * A ordem é a da conta, e não a da contagem.
 *
 * Fixo, variável, diesel é como a remuneração se lê e como a planilha do time
 * está montada. Ordenar por tamanho jogaria o diesel — que costuma ter zero
 * alteração no mês — para uma posição diferente a cada envio, e uma tela cuja
 * ordem muda sozinha obriga a reler tudo antes de comparar com o mês passado.
 */
export const CLASSES_DE_VALOR: DescricaoDeClasse[] = [
  {
    codigo: "FIXO",
    nome: "Valor fixo",
    descricao:
      "O que se recebe por ter o ativo disponível: financiamento, seguro, " +
      "tributos do veículo, dimensionamento da frota.",
  },
  {
    codigo: "VARIAVEL",
    nome: "Valor variável",
    descricao:
      "O que se recebe por rodar: frete por viagem, quilometragem, tempo " +
      "interno, empurrada.",
  },
  {
    codigo: "VARIAVEL_DIESEL",
    nome: "Variável diesel",
    descricao:
      "O combustível, que tem regra própria: consumo negociado, benchmark e " +
      "perda de eficiência ao longo da vida do cavalo.",
  },
  {
    codigo: NAO_CLASSIFICADO,
    nome: "Não classificado",
    descricao:
      "Parâmetros que esta tabela ainda não conhece. Aparecem pelo nome para " +
      "poderem ser classificados — não são um resto descartado.",
  },
];

/** De onde saiu cada linha da tabela. É o que se lê no lugar de confiar. */
export type OrigemDaClassificacao =
  /** Da planilha de classificação do time. A palavra final. */
  | "PLANILHA"
  /** De identidade aritmética medida sobre o export real, neste repositório. */
  | "IDENTIDADE"
  /** Do catálogo do Freightech: o que o cartão de origem diz que o campo é. */
  | "CATALOGO";

export interface ParametroClassificado {
  /** O nome como o export de chamados o escreve. */
  parametro: string;
  /**
   * Em que valores ele mexe. Vazio é uma afirmação, não uma lacuna: o
   * parâmetro é conhecido e não mexe em nenhum dos três.
   */
  classes: ClasseDeValor[];
  origem: OrigemDaClassificacao;
  /** Por quê. A tela mostra isto quando alguém pergunta de onde veio a caixa. */
  porque: string;
}

const DA_PLANILHA =
  "Classificado na planilha de classificação do time, que é a leitura de quem " +
  "opera os chamados.";

/**
 * A tabela.
 *
 * As entradas `PLANILHA` estão na ordem em que a planilha do time as lista;
 * as demais vêm agrupadas pela evidência que as sustenta, para que somem ou
 * saiam juntas quando a evidência mudar.
 */
export const CLASSIFICACAO_DE_PARAMETROS: ParametroClassificado[] = [
  // ── O que a planilha do time classifica como fixo ─────────────────────────
  { parametro: "ativo", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "quantidadeOrdenado", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "quantidadePorCaminhao", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "amortizacaoImplemento", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "jurosFinameImplemento", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "finameCavalo", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "taxaFiname", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "lucroFixomodeloNovoCicloCarreta", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "ipvaLicenciamento", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "seguro", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "rastreador", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "tacografo", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "faixaReflexiva", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "revestimento", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "despesaOperacionalEmpurrada", classes: ["FIXO"], origem: "PLANILHA", porque: DA_PLANILHA },
  {
    parametro: "dataFimContrato",
    classes: ["FIXO"],
    origem: "PLANILHA",
    porque:
      DA_PLANILHA +
      " Não é montante: mexer no fim do contrato muda a janela em que o " +
      "financiamento é amortizado, e por isso o valor do fixo muda junto.",
  },

  // ── O que a planilha do time classifica como variável ─────────────────────
  { parametro: "freteReaisViagemPedagio", classes: ["VARIAVEL"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "freteReaisViagemSalarioVariavel", classes: ["VARIAVEL"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "tempoInternoOrigemLucro", classes: ["VARIAVEL"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "tempoInternoDestinoLucro", classes: ["VARIAVEL"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "trechoEmpurrada", classes: ["VARIAVEL"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "kmIda", classes: ["VARIAVEL"], origem: "PLANILHA", porque: DA_PLANILHA },
  { parametro: "kmVolta", classes: ["VARIAVEL"], origem: "PLANILHA", porque: DA_PLANILHA },

  /**
   * O parâmetro que prova que a classificação não é uma partição.
   *
   * `cavaloEmpurrada` está nas duas tabelas da planilha do time, com a mesma
   * contagem: transferência de placa mexe no fixo do conjunto e no variável da
   * rota. Se um dia alguém "corrigir" isto para uma classe só, as somas por
   * classe passam a fechar com o total — e passam a estar erradas.
   */
  {
    parametro: "cavaloEmpurrada",
    classes: ["FIXO", "VARIAVEL"],
    origem: "PLANILHA",
    porque:
      "Aparece nas duas tabelas da planilha do time, com a mesma contagem: " +
      "trocar o cavalo de uma empurrada mexe no fixo do conjunto e no variável " +
      "da rota ao mesmo tempo.",
  },

  // ── A cadeia do FINAME, medida neste repositório ──────────────────────────
  /*
    A planilha do time classifica `finameCavalo`, `amortizacaoImplemento`,
    `jurosFinameImplemento` e `taxaFiname` como fixo. As linhas abaixo são as
    outras pontas da mesma identidade, medida em 14/08/2026 sobre as 9 vigências
    do export real, 558 de 558 pares cavalo–carreta, tolerância de R$ 0,01:

        (finameImplemento + lucroFixomodeloNovoCiclo) + finameCavalo = custoFixo

    Uma parcela e o total de que ela faz parte não podem cair em classes
    diferentes — seria dizer que a soma muda de dinheiro no meio do caminho.
  */
  {
    parametro: "amortizacaoCavalo",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Parcela de finameCavalo, que a planilha do time classifica como fixo.",
  },
  {
    parametro: "jurosFinameCavalo",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Parcela de finameCavalo, que a planilha do time classifica como fixo.",
  },
  {
    parametro: "lucroFixomodeloNovoCicloCavalo",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Parcela de finameCavalo, que a planilha do time classifica como fixo.",
  },
  {
    parametro: "finameImplemento",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque:
      "É amortizacaoImplemento + jurosFinameImplemento, os dois classificados " +
      "como fixo na planilha do time.",
  },
  {
    parametro: "lucroFixomodeloNovoCiclo",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Parcela de custoFixo, ao lado de finame, na identidade medida em 14/08/2026.",
  },
  {
    parametro: "finame",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque:
      "Medido: finame − finameImplemento = finameCavalo em 558 de 558 pares. " +
      "É o financiamento do conjunto, e o conjunto é fixo.",
  },
  {
    parametro: "custoFixo",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque:
      "Medido: custoFixo = finame + lucroFixomodeloNovoCiclo em 657 de 657 " +
      "linhas. É o custo fixo do conjunto cavalo + carreta.",
  },
  {
    parametro: "ipvaLicenciamentoMensal",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque:
      "O mesmo tributo de ipvaLicenciamento, mensalizado — ver docs/ACHADO-IPVA.md.",
  },

  // ── O que alimenta o cálculo do FINAME ────────────────────────────────────
  /*
    Estes são os campos que o Freightech usa para chegar na parcela: entrada,
    prazo, carência e as três taxas. `taxaFiname` — que é a soma de TJLP com os
    dois spreads — já está classificado como fixo pela planilha do time, e
    separar os componentes do resultado deles não teria sentido nenhum.
  */
  {
    parametro: "percentualEntrada",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Entra no cálculo da parcela do FINAME, como taxaFiname — que a planilha classifica como fixo.",
  },
  {
    parametro: "periodoFiname",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "É o prazo em meses do FINAME, o divisor da amortização.",
  },
  {
    parametro: "carencia",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Adia o início da amortização do FINAME e desloca o valor do fixo no tempo.",
  },
  {
    parametro: "tjlp",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Componente de taxaFiname, que a planilha do time classifica como fixo.",
  },
  {
    parametro: "spreadBndes",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Componente de taxaFiname, que a planilha do time classifica como fixo.",
  },
  {
    parametro: "spreadBanco",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque: "Componente de taxaFiname, que a planilha do time classifica como fixo.",
  },
  {
    parametro: "valorNfCompra",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque:
      "É a base do financiamento e, medido em 10/08/2026, também a do IPVA " +
      "(1,000% ao ano) e a do PIS/COFINS de aquisição (9,250%).",
  },
  {
    parametro: "custoAluguel",
    classes: ["FIXO"],
    origem: "IDENTIDADE",
    porque:
      "Terceira parcela de finameImplemento — é o implemento alugado no lugar " +
      "do financiado, e ocupa o mesmo lugar na conta do fixo.",
  },

  // ── Combustível ───────────────────────────────────────────────────────────
  /*
    A planilha do time tem a tabela do variável diesel e ela veio vazia neste
    envio: nenhum chamado do mês mexeu em combustível. Vazia não é inexistente,
    e por isso a classe existe aqui — com os parâmetros que o cartão
    Combustível do catálogo nomeia, e só eles.
  */
  {
    parametro: "combustivelConsumoNeg",
    classes: ["VARIAVEL_DIESEL"],
    origem: "CATALOGO",
    porque: "Consumo negociado (km/l): é a régua com que o diesel é remunerado.",
  },
  {
    parametro: "combustivelConsumoNegInteiro",
    classes: ["VARIAVEL_DIESEL"],
    origem: "CATALOGO",
    porque: "A mesma régua do consumo negociado, arredondada.",
  },
  {
    parametro: "combustivelConsumoBenchmark",
    classes: ["VARIAVEL_DIESEL"],
    origem: "CATALOGO",
    porque: "Consumo de referência (km/l) contra o qual o negociado é comparado.",
  },
  {
    parametro: "combustivelVidaCavalo",
    classes: ["VARIAVEL_DIESEL"],
    origem: "CATALOGO",
    porque: "Vida do cavalo, que é o eixo da perda de eficiência do consumo.",
  },
  {
    parametro: "combustivelPercentualPerdaVida",
    classes: ["VARIAVEL_DIESEL"],
    origem: "CATALOGO",
    porque: "Quanto o consumo piora ao longo da vida — mexe direto no diesel remunerado.",
  },
  {
    parametro: "tipoCombustivelEmpurrada",
    classes: ["VARIAVEL_DIESEL"],
    origem: "CATALOGO",
    porque: "Qual combustível a empurrada usa. Troca a tabela de preço aplicada.",
  },
  /**
   * Conhecido e sem classe, de propósito.
   *
   * Capacidade do tanque é especificação do veículo: não entra em nenhuma
   * conta de remuneração. Sem esta linha ele cairia em "não classificado" por
   * omissão, e ficaria para sempre na fila de trabalho de quem mantém a tabela
   * — dizendo "falta classificar" sobre algo que já foi visto e resolvido.
   */
  {
    parametro: "combustivelCapacidade",
    classes: [],
    origem: "CATALOGO",
    porque:
      "Capacidade do tanque, em litros. É especificação do veículo, não " +
      "consumo — não mexe em valor nenhum da remuneração.",
  },
];

/**
 * A chave de busca de um parâmetro.
 *
 * Come tudo o que não é letra ou dígito, e o acento junto. O mesmo conceito
 * chega escrito de três jeitos no export — `taxaFiname` no formato largo,
 * `Taxa Finame (%)` no cabeçalho de exibição, `TAXA_FINAME` num export de fila
 * — e os três precisam achar a mesma linha desta tabela. Nomes que só diferem
 * por caixa ou pontuação são o mesmo parâmetro; nomes que diferem por letra
 * não são, e continuam sem se encontrar.
 */
export function chaveDeParametro(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const POR_CHAVE = new Map<string, ParametroClassificado>(
  CLASSIFICACAO_DE_PARAMETROS.map((p) => [chaveDeParametro(p.parametro), p]),
);

/** A linha da tabela, ou `null` quando o parâmetro não está nela. */
export function classificarParametro(nome: string): ParametroClassificado | null {
  return POR_CHAVE.get(chaveDeParametro(nome)) ?? null;
}

/**
 * As caixas em que um parâmetro entra na tela — sempre pelo menos uma.
 *
 * Desconhecido e conhecido-sem-classe caem os dois em `NAO_CLASSIFICADO`, e é
 * `classificarParametro` que distingue os dois casos para quem quiser dizer
 * *por que* nenhum valor foi apontado.
 */
export function classesDoParametro(nome: string): ClasseNaTela[] {
  const encontrado = classificarParametro(nome);
  if (!encontrado || encontrado.classes.length === 0) return [NAO_CLASSIFICADO];
  return encontrado.classes;
}
