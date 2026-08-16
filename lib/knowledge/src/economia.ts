/**
 * O comportamento econômico de cada parâmetro — **para que lado a remuneração
 * vai quando ele se move**.
 *
 * **O que este módulo responde, e o que ele deliberadamente não responde.** O
 * produto já sabe dizer *o que uma coluna é* (unidade, periodicidade,
 * agregação, se é monetária, em que classe de custo cai, em que valor da
 * remuneração ela mexe). Nada disso responde à pergunta que precede qualquer
 * conversa com o cliente: **essa mudança me prejudicou ou me beneficiou, e por
 * quê?** Duas colunas com a mesma unidade podem empurrar a remuneração para
 * lados opostos — `taxaFiname` e `percentualEntrada` são as duas PERCENT, e
 * taxa maior aumenta os juros que recebo enquanto entrada maior reduz a
 * parcela. Nenhuma régua atual distingue as duas.
 *
 * **A modelagem: um sentido declarado, dois efeitos derivados.** O pedido
 * original era `efeitoQuandoAumenta` e `efeitoQuandoDiminui`. Dois campos
 * independentes podem se contradizer — alguém escreve "aumenta → aumenta" e
 * "diminui → aumenta" e a tabela passa a afirmar que o parâmetro só melhora.
 * Aqui se declara o {@link SentidoEconomico} e os dois efeitos saem dele por
 * {@link efeitoQuandoAumenta} e {@link efeitoQuandoDiminui}. É a mesma
 * informação, sem o estado impossível.
 *
 * **Três eixos decidem se cabe pedir alguma coisa**, e eles são independentes
 * do sentido:
 *
 * - {@link PapelEconomico} separa *o dinheiro* de *o que empurra o dinheiro*.
 *   Sem ele, `TJLP` e `jurosFinameCavalo` viram duas linhas e a mesma perda é
 *   levada duas vezes à mesa.
 * - {@link Acionavel} responde se o cliente **pode** mudar aquilo. A idade do
 *   cavalo sobe sozinha; a TJLP é publicada por terceiro; o lucro fixo do novo
 *   ciclo é parametrizado. Os três podem custar o mesmo dinheiro e pedem
 *   conversas diferentes.
 * - {@link FonteDeReferencia} diz de onde sairia o valor a propor. **Sem fonte
 *   declarada não existe proposta** — existe investigação.
 *
 * **Por que aqui, e não no banco.** Mesma razão de `catalogo.ts` e
 * `classificacao.ts` ao lado, e de `CONFIRMED_SEMANTICS` em
 * `@workspace/curation`: isto é o mapa do modelo de remuneração, não uma
 * projeção dos nossos fatos. Precisa existir com o banco vazio, cada linha
 * carrega a evidência que a sustenta, e uma evidência revista num pull request
 * é auditável de um jeito que um `UPDATE` não é.
 *
 * **Ausência é uma resposta.** Um parâmetro fora desta tabela não recebe um
 * comportamento padrão: ele fica sem leitura econômica, e a aba Cliente diz
 * isso em vez de recomendar no escuro. Uma entrada com `sentido: "NULO"` é o
 * contrário — é a afirmação deliberada de que a coluna não remunera nada.
 */

/**
 * Para que lado a remuneração vai quando o parâmetro se move.
 *
 * `NAO_MONOTONICO` e `DEPENDE_DE_FORMULA` não são o mesmo caso, e a diferença
 * importa para a tela: o primeiro tem efeito conhecido que muda de sinal em
 * alguma faixa; o segundo tem efeito desconhecido até que a fórmula da fonte —
 * ou a base que falta — apareça.
 */
export type SentidoEconomico =
  /** Parâmetro ↑ ⇒ remuneração ↑. Parâmetro ↓ ⇒ remuneração ↓. */
  | "DIRETO"
  /** Parâmetro ↑ ⇒ remuneração ↓. Parâmetro ↓ ⇒ remuneração ↑. */
  | "INVERSO"
  /** Não entra em conta de remuneração nenhuma. */
  | "NULO"
  /** O sinal muda conforme a faixa do valor. */
  | "NAO_MONOTONICO"
  /** Há efeito, e o sinal depende de fórmula ou base que não temos. */
  | "DEPENDE_DE_FORMULA"
  /** Ninguém levantou. Diferente de `NULO`, que é uma afirmação. */
  | "DESCONHECIDO";

/** O que a mudança fez com o nosso lado da conta. */
export type EfeitoNaRemuneracao =
  | "AUMENTA"
  | "REDUZ"
  | "SEM_EFEITO"
  | "INDETERMINADO";

/**
 * O papel do parâmetro na conta.
 *
 * `RELOGIO` é a categoria que o dado real obrigou a criar: `combustivelVidaCavalo`
 * sobe em 494 das 494 transições do export, +0,083 por vigência, e é a idade do
 * cavalo em anos. Tratá-lo como premissa alterável faria a aba propor
 * rejuvenescer a frota.
 */
export type PapelEconomico =
  /** É o dinheiro em si — R$ por ativo. */
  | "MONTANTE"
  /** Percentual que entra numa fórmula de dinheiro. */
  | "TAXA"
  /** Prazo em meses que divide ou desloca um montante. */
  | "PRAZO"
  /** Avança sozinho com o tempo. Ninguém "mexeu" nele. */
  | "RELOGIO"
  /** Grandeza física que multiplica preço — km/l, R$/km, litros. */
  | "DRIVER_FISICO"
  /** Descreve o ativo. Não remunera. */
  | "ESPECIFICACAO"
  /** Identifica o ativo ou o contrato. */
  | "IDENTIFICACAO";

/** Se faz sentido pedir ao cliente que mude isto. */
export type Acionavel =
  /** O cliente parametriza no Freightec. Cabe proposta. */
  | "NEGOCIAVEL"
  /** Índice publicado por terceiro. Cabe conferência, não proposta. */
  | "INDEXADO_EXTERNO"
  /** Muda por mecanismo próprio: o relógio, o fim do financiamento. */
  | "AUTOMATICO"
  /** Cadastro do ativo. Corrigir é erro de cadastro, não negociação. */
  | "CADASTRAL"
  /** Não levantado. */
  | "DESCONHECIDO";

/**
 * De onde sairia o valor a propor.
 *
 * A ordem da lista é a da força de prova, e `VIGENCIA_ANTERIOR` está no fim de
 * propósito: o valor anterior é uma **referência**, não um valor correto. Ele
 * só sustenta proposta quando o parâmetro é negociável e nada explica a
 * mudança — e mesmo aí a frase da tela diz que é o último valor praticado, e
 * não o valor devido.
 */
export type FonteDeReferencia =
  | "CONTRATO"
  | "BOOK_OPERADOR"
  | "PARAMETRO_CONFIRMADO"
  | "REGRA_ECONOMICA"
  | "DOCUMENTO_CLIENTE"
  | "BENCHMARK"
  | "HISTORICO"
  | "VIGENCIA_ANTERIOR";

export interface ComportamentoEconomico {
  /** O código do atributo, como `lib/comparison` o escreve. */
  code: string;
  papel: PapelEconomico;
  sentido: SentidoEconomico;
  acionavel: Acionavel;
  /**
   * Como o parâmetro mexe no dinheiro, em português de reunião. Vai para a
   * tela inteiro — é a frase que transforma uma coluna em argumento.
   */
  mecanismo: string;
  /**
   * A coluna que carrega o dinheiro deste parâmetro, quando ele é driver.
   *
   * É o que impede a dupla contagem: a TJLP não tem impacto próprio, o impacto
   * dela está em `jurosFinameCavalo`. A tela nomeia a coluna em vez de somar
   * duas perdas pela mesma causa.
   */
  alimenta?: string[];
  /** Parâmetros de que este depende para virar dinheiro. */
  dependeDe?: string[];
  /** De onde sairia o valor a propor. Ausente ⇒ nunca vira proposta. */
  fonteDoValorRecomendado?: FonteDeReferencia;
  /** A medição ou o documento que sustenta a linha. Sem isto, é palpite. */
  evidencia: string;
}

const MEDIDO_16_08 = "Medido em 16/08/2026 sobre as 9 vigências do export real";

/**
 * A tabela.
 *
 * Agrupada pela evidência que sustenta cada bloco, e não em ordem alfabética:
 * quando uma medição cair, o bloco inteiro dela sai junto.
 */
export const COMPORTAMENTO_ECONOMICO: ComportamentoEconomico[] = [
  // ── Os montantes do custo fixo ────────────────────────────────────────────
  /*
    Montante é o caso simples do sentido: mais reais na coluna é mais
    remuneração, porque a coluna *é* a remuneração. O que não é simples é o
    `acionavel` — e é ele que separa estas cinco linhas.
  */
  {
    code: "cavalo.finame_cavalo",
    papel: "MONTANTE",
    sentido: "DIRETO",
    acionavel: "AUTOMATICO",
    mecanismo:
      "É o custo fixo do cavalo. Sobe e desce com o ciclo do financiamento: " +
      "quando o FINAME encerra, o valor migra para o lucro fixo do novo ciclo " +
      "dentro do mesmo total.",
    evidencia:
      "COMPOSITIONS: finameCavalo = amortização + juros + lucro fixo do novo ciclo, " +
      "532 de 533 linhas não nulas. A hipótese de que seria só amortização + juros " +
      "foi testada e rejeitada (falha em 30 linhas).",
  },
  {
    code: "carreta.finame_implemento",
    papel: "MONTANTE",
    sentido: "DIRETO",
    acionavel: "AUTOMATICO",
    mecanismo:
      "É o financiamento do implemento. Mesma mecânica do cavalo: encerra e o " +
      "lucro fixo do novo ciclo entra no lugar.",
    evidencia:
      "COMPOSITIONS: finameImplemento = amortização + juros + custo de aluguel, " +
      "651 de 651 linhas.",
  },
  ...([
    ["cavalo.amortizacao_cavalo", "cavalo.finame_cavalo"],
    ["cavalo.juros_finame_cavalo", "cavalo.finame_cavalo"],
    ["carreta.amortizacao_implemento", "carreta.finame_implemento"],
    ["carreta.juros_finame_implemento", "carreta.finame_implemento"],
  ] as const).map(([code, total]) => ({
    code,
    papel: "MONTANTE" as const,
    sentido: "DIRETO" as const,
    acionavel: "AUTOMATICO" as const,
    mecanismo:
      `Parcela de ${total}. O total já responde pelo dinheiro; esta linha ` +
      `explica de onde ele veio.`,
    evidencia: "Parcela declarada em COMPOSITIONS, com a identidade medida.",
  })),
  ...([
    "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    "carreta.lucro_fixomodelo_novo_ciclo",
    "carreta.lucro_fixomodelo_novo_ciclo_carreta",
  ] as const).map((code) => ({
    code,
    papel: "MONTANTE" as const,
    sentido: "DIRETO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "É o que se recebe depois de quitado o financiamento. O valor é " +
      "parametrizado no Freightec, e não sai de prazo nem de taxa — por isso é " +
      "o que se discute quando o novo ciclo entra por menos do que o " +
      "financiamento que saiu.",
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      `${MEDIDO_16_08}: nos cavalos o novo ciclo entra a R$ 3.318,01 contra ` +
      `parcelas de R$ 7.937,22 que saíram; nas carretas ele entra acima do que ` +
      `saiu. O tamanho do que entra não é derivável de nenhuma coluna do export.`,
  })),
  {
    code: "cavalo.ipva_licenciamento",
    papel: "MONTANTE",
    sentido: "DIRETO",
    acionavel: "NEGOCIAVEL",
    mecanismo:
      "Tributo do veículo reembolsado no valor fixo. A base de cálculo é " +
      "parametrizada e mudou duas vezes na série.",
    dependeDe: ["cavalo.valor_nf_compra"],
    fonteDoValorRecomendado: "CONTRATO",
    evidencia:
      "docs/ACHADO-IPVA.md: de Jan a Jun/2026 o valor é exatamente 1,000% de " +
      "valorNfCompra nas 62 placas, desvio 0,0000. Antes era o valor real por " +
      "veículo (2,52% médio); a partir de Jul/2026 passou a 0,651% médio.",
  },
  ...([
    "carreta.seguro",
    "carreta.tacografo",
    "carreta.faixa_reflexiva",
    "carreta.revestimento",
    "carreta.rastreador",
  ] as const).map((code) => ({
    code,
    papel: "MONTANTE" as const,
    sentido: "DIRETO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Item de valor fixo do implemento: entra na remuneração pelo valor " +
      "cadastrado, e mudar o cadastro muda o que se recebe.",
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      "Planilha de classificação do time (ver classificacao.ts) e valores em R$ " +
      "com dois decimais no export.",
  })),
  ...([
    ["carreta.custo_fixo", "cavalo.finame_cavalo"],
    ["carreta.finame", "cavalo.finame_cavalo"],
  ] as const).map(([code, contem]) => ({
    code,
    papel: "MONTANTE" as const,
    sentido: "DIRETO" as const,
    acionavel: "AUTOMATICO" as const,
    mecanismo:
      `Coluna do conjunto: já embute ${contem}. Discutir esta linha e a do ` +
      `cavalo é discutir o mesmo real duas vezes.`,
    evidencia:
      "ESCOPOS_DE_CONJUNTO: medido em 558 de 558 pares cavalo–carreta, " +
      "tolerância R$ 0,01.",
  })),
  ...([
    ["carreta.valor_nf_compra", "carreta"],
    ["cavalo.valor_nf_compra", "cavalo"],
  ] as const).map(([code]) => ({
    code,
    papel: "MONTANTE" as const,
    sentido: "DIRETO" as const,
    acionavel: "CADASTRAL" as const,
    mecanismo:
      "Valor da nota de compra. Não é remuneração: é a base sobre a qual o " +
      "financiamento, o IPVA (1,000% a.a.) e o PIS/COFINS (9,250%) são " +
      "calculados. Mudar a nota muda tudo o que pende dela.",
    alimenta: ["financiamento", "IPVA", "PIS/COFINS"],
    evidencia:
      "Medido em 10/08/2026: valorPisCofins é 9,250% da NF com desvio 0,0000 " +
      "nos 132 ativos, e o IPVA do cavalo foi 1,000% dela em 6 vigências.",
  })),

  // ── As taxas do financiamento ─────────────────────────────────────────────
  /*
    O bloco que prova que o sinal matemático não é o sinal econômico. A TJLP
    caiu 0,44 ponto e a remuneração caiu junto — e o efeito não está na coluna
    da taxa, está nos juros. Por isso `alimenta` existe: a taxa entra na lista
    nomeando onde o dinheiro dela foi parar, em vez de carregar um impacto
    próprio que somaria em dobro com o dos juros.
  */
  ...([
    ["cavalo.taxa_finame", "cavalo.juros_finame_cavalo"],
    ["carreta.taxa_finame", "carreta.juros_finame_implemento"],
  ] as const).map(([code, alimenta]) => ({
    code,
    papel: "TAXA" as const,
    sentido: "DIRETO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Taxa do FINAME. Taxa maior significa juros maiores dentro da parcela, e " +
      "portanto mais remuneração — quando ela cai, recebemos menos.",
    alimenta: [alimenta],
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      `${MEDIDO_16_08}: a taxa é a composição das três — ` +
      `(1+TJLP)(1+spreadBNDES)(1+spreadBanco) − 1 = 13,16% para 7,26/1,15/4,30, ` +
      `conferida ao centésimo. No cavalo QYW2F98 a queda de 13,62% para 13,16% ` +
      `derrubou os juros de R$ 2.623,49 para R$ 2.538,34 por mês.`,
  })),
  ...([
    ["cavalo.tjlp", "cavalo.taxa_finame"],
    ["carreta.tjlp", "carreta.taxa_finame"],
  ] as const).map(([code, alimenta]) => ({
    code,
    papel: "TAXA" as const,
    sentido: "DIRETO" as const,
    acionavel: "INDEXADO_EXTERNO" as const,
    mecanismo:
      "Componente da taxa do FINAME. É índice publicado, não parâmetro nosso: " +
      "o que cabe é conferir se o valor aplicado é o publicado na data da " +
      "vigência, não pedir outro número.",
    alimenta: [alimenta],
    evidencia:
      `${MEDIDO_16_08}: na virada de Jan para Fev/2026 dez cavalos mudaram de ` +
      `TJLP — seis para baixo e quatro para cima —, com efeito líquido de ` +
      `+R$ 128,52 nos juros. O líquido esconde as seis placas que perderam.`,
  })),
  ...([
    "cavalo.spread_bndes",
    "cavalo.spread_banco",
    "carreta.spread_bndes",
    "carreta.spread_banco",
  ] as const).map((code) => ({
    code,
    papel: "TAXA" as const,
    sentido: "DIRETO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Spread que compõe a taxa do FINAME. Spread maior, juros maiores, mais " +
      "remuneração.",
    alimenta: ["taxa_finame"],
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia: "Componente medido da composição da taxa (ver taxa_finame).",
  })),
  ...([
    "cavalo.percentual_entrada",
    "carreta.percentual_entrada",
  ] as const).map((code) => ({
    code,
    papel: "TAXA" as const,
    sentido: "INVERSO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Percentual de entrada do financiamento. Entrada maior significa menos " +
      "valor financiado, e portanto parcela menor — aumentar este número " +
      "**reduz** o que recebemos.",
    alimenta: ["amortizacao", "juros"],
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      "Medido em 10/08/2026: amortização ÷ (valorNF × (1 − entrada%) ÷ prazo) = " +
      "1,081 nos cavalos e 1,108 nas carretas. A entrada entra dividindo a base.",
  })),
  ...([
    "cavalo.periodo_finame",
    "carreta.periodo_finame",
  ] as const).map((code) => ({
    code,
    papel: "PRAZO" as const,
    sentido: "INVERSO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Prazo do FINAME, em meses. É o divisor da amortização: prazo maior " +
      "significa parcela mensal menor — esticar o prazo **reduz** a " +
      "remuneração de cada mês.",
    alimenta: ["amortizacao"],
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      "Mesma medição da entrada: a razão 1,081/1,108 só fecha com o prazo em " +
      "meses. Lido como anos, erraria por um fator de 13.",
  })),
  ...(["cavalo.carencia", "carreta.carencia"] as const).map((code) => ({
    code,
    papel: "PRAZO" as const,
    sentido: "DEPENDE_DE_FORMULA" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Carência do FINAME. Adia o início da amortização: desloca a " +
      "remuneração no tempo em vez de aumentá-la ou reduzi-la, e o efeito num " +
      "mês depende de onde o mês cai em relação à carência.",
    alimenta: ["amortizacao"],
    evidencia:
      "Classificada como componente do cálculo da parcela em " +
      "classificacao.ts. O deslocamento no tempo não foi medido neste export.",
  })),

  // ── O relógio ─────────────────────────────────────────────────────────────
  /*
    O achado que obrigou a existir o papel RELOGIO.

    O enunciado deste trabalho supôs que `combustivelVidaCavalo` fosse km/l. Os
    dados dizem que não: ela sobe em 494 das 494 transições, nunca desce, avança
    +0,083 por vigência — um doze avos de ano por mês — e vale exatamente
    `manutencaoVidaMeses ÷ 12,17`. É a idade do cavalo em anos.

    A consequência para o produto é grande: uma regra "subiu ⇒ peça para
    baixar" teria proposto rejuvenescer 64 caminhões. Quem carrega dinheiro no
    combustível é o consumo negociado e o percentual de perda, não o eixo em que
    eles são medidos.
  */
  ...([
    ["cavalo.combustivel_vida_cavalo", "anos"],
    ["cavalo.manutencao_vida_meses", "meses"],
  ] as const).map(([code, unidade]) => ({
    code,
    papel: "RELOGIO" as const,
    sentido: "NULO" as const,
    acionavel: "AUTOMATICO" as const,
    mecanismo:
      `Idade do cavalo, em ${unidade}. Avança com o calendário — não é uma ` +
      `premissa que alguém alterou, e não remunera por si: serve de eixo para ` +
      `as curvas de perda de eficiência e de manutenção.`,
    alimenta: [
      "cavalo.combustivel_percentual_perda_vida",
      "cavalo.manutencao_reais_km",
    ],
    evidencia:
      `${MEDIDO_16_08}: 494 transições, todas para cima, nenhuma para baixo e ` +
      `nenhuma igual; delta mediano de +0,080 por vigência; e a razão ` +
      `manutencaoVidaMeses ÷ combustivelVidaCavalo fica entre 12,07 e 12,50 ` +
      `(mediana 12,17). São o mesmo relógio em duas unidades.`,
  })),
  {
    code: "cavalo.odometro_entrada",
    papel: "DRIVER_FISICO",
    sentido: "NULO",
    acionavel: "CADASTRAL",
    mecanismo:
      "Leitura do hodômetro na entrada. Descreve o ativo; nenhuma coluna de " +
      "remuneração deste export depende dela.",
    evidencia:
      `${MEDIDO_16_08}: muda uma vez por placa, em 62 das 62, sem alterar ` +
      `nenhum valor monetário na mesma transição.`,
  },
  ...(["cavalo.ciclo", "carreta.ciclo"] as const).map((code) => ({
    code,
    papel: "ESPECIFICACAO" as const,
    sentido: "NULO" as const,
    acionavel: "AUTOMATICO" as const,
    mecanismo:
      "Numera o ciclo do ativo. Muda **porque** o financiamento terminou — é a " +
      "consequência do fim do FINAME, não a causa da mudança de valor.",
    evidencia:
      `${MEDIDO_16_08}: as 10 transições de ciclo do cavalo coincidem com as ` +
      `10 do lucro fixo do novo ciclo, nas mesmas placas e nas mesmas vigências.`,
  })),

  // ── Combustível ───────────────────────────────────────────────────────────
  /*
    Aqui mora o sentido INVERSO do enunciado, e ele vale para o consumo — não
    para a vida. Consumo negociado maior significa que o Freightec reconhece que
    o caminhão anda mais com o mesmo litro, e portanto reconhece menos litros na
    remuneração.

    O impacto continua não calculável: falta o volume e o preço do litro, que
    `BASE_QUE_FALTA` já nomeia do outro lado do produto. Sentido conhecido com
    impacto não calculável é exatamente o caso de INVESTIGAR — e é por isso que
    ele existe como categoria.
  */
  ...([
    "cavalo.combustivel_consumo_neg",
    "cavalo.combustivel_consumo_neg_inteiro",
    "cavalo.combustivel_consumo_benchmark",
  ] as const).map((code) => ({
    code,
    papel: "DRIVER_FISICO" as const,
    sentido: "INVERSO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Consumo em km/l com que o diesel é remunerado. Quanto maior o consumo " +
      "considerado, menos litros são reconhecidos na remuneração — subir esta " +
      "régua **reduz** o que recebemos de combustível.",
    dependeDe: ["quilometragem rodada no período", "preço do litro"],
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      `${MEDIDO_16_08}: mediana de 2,03 km/l entre os valores não nulos, ` +
      `compatível com cavalo mecânico carregado. 77 das 558 células vêm zeradas, ` +
      `e zero não é consumo — é ausência escrita como número.`,
  })),
  {
    code: "cavalo.combustivel_percentual_perda_vida",
    papel: "DRIVER_FISICO",
    sentido: "DEPENDE_DE_FORMULA",
    acionavel: "NEGOCIAVEL",
    mecanismo:
      "Quanto o consumo piora ao longo da vida do cavalo. O sinal do efeito " +
      "depende de a fórmula do Freightec aplicar a perda sobre litros ou sobre " +
      "km/l, e essa fórmula não vem no export.",
    dependeDe: ["cavalo.combustivel_vida_cavalo", "cavalo.combustivel_consumo_neg"],
    evidencia:
      `${MEDIDO_16_08}: foi de −1,5% para −2,0% em 15 cavalos, na virada de ` +
      `Dez/2025 para Jan/2026. Nenhuma coluna monetária do export se move junto, ` +
      `então o caminho do dinheiro não é observável daqui.`,
  },
  {
    code: "cavalo.combustivel_capacidade",
    papel: "ESPECIFICACAO",
    sentido: "NULO",
    acionavel: "CADASTRAL",
    mecanismo:
      "Capacidade do tanque. É especificação do veículo, não consumo — não " +
      "mexe em valor nenhum da remuneração.",
    evidencia:
      "Mesma leitura de classificacao.ts, que a registra como conhecida e sem " +
      "classe de valor.",
  },

  // ── Manutenção e razões por quilômetro ────────────────────────────────────
  ...([
    "cavalo.manutencao_reais_km",
    "cavalo.manutencao_reais_km_inteiro",
    "cavalo.manutencao_bid",
    "cavalo.custo_variavel_simulado",
    "cavalo.reaiskm",
    "cavalo.valor_reajustado",
  ] as const).map((code) => ({
    code,
    papel: "DRIVER_FISICO" as const,
    sentido: "DIRETO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Valor por quilômetro. Vira dinheiro multiplicado pela quilometragem do " +
      "período — maior a régua, maior a remuneração —, mas a quilometragem não " +
      "vem neste export.",
    dependeDe: ["quilometragem rodada no período"],
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      "BASE_QUE_FALTA (lib/composition/src/regras.ts) nomeia a base ausente: " +
      "quilometragem rodada por ativo no período.",
  })),
  ...([
    "cavalo.percentual_reajuste_aplicado",
  ] as const).map((code) => ({
    code,
    papel: "TAXA" as const,
    sentido: "DIRETO" as const,
    acionavel: "NEGOCIAVEL" as const,
    mecanismo:
      "Reajuste aplicado ao valor do ativo. Reajuste maior, valor maior, mais " +
      "remuneração.",
    fonteDoValorRecomendado: "CONTRATO" as const,
    evidencia:
      `${MEDIDO_16_08}: subiu em 4 cavalos (16,85% → 20,56% e 7,03% → 7,48%), ` +
      `sempre para cima.`,
  })),

  // ── Alíquotas ─────────────────────────────────────────────────────────────
  ...([
    ["carreta.icms", "carreta.valor_icms"],
    ["carreta.pis_cofins", "carreta.valor_pis_cofins"],
    ["cavalo.percentual_icms", "cavalo.valor_icms"],
    ["carreta.percentual_icms", "carreta.valor_icms"],
  ] as const).map(([code, alimenta]) => ({
    code,
    papel: "TAXA" as const,
    sentido: "DIRETO" as const,
    acionavel: "CADASTRAL" as const,
    mecanismo:
      "Alíquota, não montante. O dinheiro correspondente está na coluna de " +
      "valor ao lado.",
    alimenta: [alimenta],
    evidencia:
      "Confirmado pelo transportador em 10/08/2026: a coluna é alíquota e o " +
      "montante correspondente é a coluna de valor.",
  })),

  // ── O que a fonte ainda não deixa ler ─────────────────────────────────────
  /*
    Três colunas com dinheiro visível e semântica que ninguém sustenta. Elas
    entram na tabela — em vez de ficarem de fora — porque a ausência de entrada
    significaria "não levantado", e estas foram levantadas: o que se sabe delas
    é que não se sabe o suficiente, e a razão está escrita.
  */
  ...([
    "cavalo.lucro_variavel_previsto_cavalo",
    "carreta.lucro_variavel_previsto",
    "carreta.lucro_variavel_previsto_carreta",
  ] as const).map((code) => ({
    code,
    papel: "MONTANTE" as const,
    sentido: "DESCONHECIDO" as const,
    acionavel: "DESCONHECIDO" as const,
    mecanismo:
      "Lucro variável previsto. A série é intermitente — a coluna alterna entre " +
      "um valor e zero —, então a variação entre duas vigências não é preço: é " +
      "a coluna aparecendo e sumindo.",
    evidencia:
      `${MEDIDO_16_08}: no cavalo, 107 das 107 transições têm um zero de um dos ` +
      `lados, e 34 placas nunca assumem outro valor além de um único número e ` +
      `zero. Na carreta, 47 de 47.`,
  })),
  {
    code: "carreta.ipva_licenciamento_mensal",
    papel: "MONTANTE",
    sentido: "DESCONHECIDO",
    acionavel: "DESCONHECIDO",
    mecanismo:
      "Coluna chamada de mensal que não é um doze avos da anual nem percentual " +
      "da nota. Ninguém sabe o que ela é, e propor mexer no que não se entende " +
      "é pior do que não propor.",
    evidencia:
      "docs/ACHADO-IPVA.md: a razão por ativo entre as duas colunas varia de " +
      "−3,01× a 5,23×, dispersão de 63%. São grandezas diferentes que " +
      "compartilham o prefixo do nome.",
  },
  {
    code: "carreta.ipva_licenciamento",
    papel: "MONTANTE",
    sentido: "DIRETO",
    acionavel: "NEGOCIAVEL",
    mecanismo:
      "Taxa fixa de licenciamento do implemento — R$ 140 a R$ 152 por carreta, " +
      "independente do valor do bem. Reembolsada no valor fixo.",
    fonteDoValorRecomendado: "CONTRATO",
    evidencia:
      "docs/ACHADO-IPVA.md: 438 das 657 linhas são exatamente R$ 150,00, e o " +
      "valor não acompanha a nota (R$ 140,34 tanto para um implemento de " +
      "R$ 156 mil quanto para um de R$ 283 mil). Comportamento de taxa fixa, " +
      "coerente com semirreboque isento de IPVA.",
  },
];

/** O sufixo do código, sem o equipamento: `cavalo.tjlp` → `tjlp`. */
const semEquipamento = (code: string) => code.split(".").slice(1).join(".");

const POR_CODIGO = new Map(COMPORTAMENTO_ECONOMICO.map((c) => [c.code, c]));

/**
 * O comportamento declarado de um atributo, ou `null`.
 *
 * `null` é uma resposta e a aba Cliente a trata como tal: sem leitura
 * econômica não há recomendação, e a tela diz isso em vez de escolher um
 * padrão. Não existe fallback por nome parecido aqui — foi assim que a
 * taxonomia mandou cinco colunas de dinheiro para a gaveta errada, e o mesmo
 * erro nesta tabela produziria uma proposta com o sinal trocado.
 */
export function comportamentoDe(code: string): ComportamentoEconomico | null {
  return POR_CODIGO.get(code) ?? null;
}

/** Todos os códigos com comportamento declarado. Para diagnósticos e testes. */
export function codigosComComportamento(): string[] {
  return COMPORTAMENTO_ECONOMICO.map((c) => c.code);
}

/**
 * O efeito de um aumento do parâmetro sobre a remuneração.
 *
 * Derivado, e não declarado: dois campos independentes podem se contradizer, e
 * uma tabela que afirme "aumenta → aumenta" e "diminui → aumenta" faz a tela
 * dizer que o parâmetro só melhora.
 */
export function efeitoQuandoAumenta(sentido: SentidoEconomico): EfeitoNaRemuneracao {
  switch (sentido) {
    case "DIRETO":
      return "AUMENTA";
    case "INVERSO":
      return "REDUZ";
    case "NULO":
      return "SEM_EFEITO";
    default:
      return "INDETERMINADO";
  }
}

/** O espelho de {@link efeitoQuandoAumenta}. */
export function efeitoQuandoDiminui(sentido: SentidoEconomico): EfeitoNaRemuneracao {
  switch (sentido) {
    case "DIRETO":
      return "REDUZ";
    case "INVERSO":
      return "AUMENTA";
    case "NULO":
      return "SEM_EFEITO";
    default:
      return "INDETERMINADO";
  }
}

/**
 * O efeito de uma variação observada, dado o sentido declarado.
 *
 * Recebe o delta em vez do sinal para que a decisão de o que é "sem variação"
 * fique num lugar só: zero é sem efeito, e não um aumento de tamanho nulo.
 */
export function efeitoDaVariacao(
  sentido: SentidoEconomico,
  delta: number,
): EfeitoNaRemuneracao {
  if (delta === 0) return "SEM_EFEITO";
  return delta > 0 ? efeitoQuandoAumenta(sentido) : efeitoQuandoDiminui(sentido);
}

/** A frase de leitura de um efeito, para a tela não traduzir enum. */
export const EFEITO_EM_PALAVRAS: Record<EfeitoNaRemuneracao, string> = {
  AUMENTA: "aumenta a nossa remuneração",
  REDUZ: "reduz a nossa remuneração",
  SEM_EFEITO: "não mexe na remuneração",
  INDETERMINADO: "efeito ainda não determinado",
};

export const PAPEL_EM_PALAVRAS: Record<PapelEconomico, string> = {
  MONTANTE: "montante",
  TAXA: "taxa",
  PRAZO: "prazo",
  RELOGIO: "relógio",
  DRIVER_FISICO: "grandeza física",
  ESPECIFICACAO: "especificação",
  IDENTIFICACAO: "identificação",
};

export const ACIONAVEL_EM_PALAVRAS: Record<Acionavel, string> = {
  NEGOCIAVEL: "parametrizado pelo cliente",
  INDEXADO_EXTERNO: "índice publicado por terceiro",
  AUTOMATICO: "muda por mecanismo próprio",
  CADASTRAL: "cadastro do ativo",
  DESCONHECIDO: "não levantado",
};

export const FONTE_EM_PALAVRAS: Record<FonteDeReferencia, string> = {
  CONTRATO: "contrato",
  BOOK_OPERADOR: "Book do Operador",
  PARAMETRO_CONFIRMADO: "parâmetro confirmado na curadoria",
  REGRA_ECONOMICA: "regra econômica medida",
  DOCUMENTO_CLIENTE: "documento do cliente",
  BENCHMARK: "benchmark",
  HISTORICO: "histórico da série",
  VIGENCIA_ANTERIOR: "vigência anterior",
};

/**
 * Se o parâmetro é um driver — algo que empurra dinheiro que está em outra
 * coluna.
 *
 * É o que impede a dupla contagem na aba Cliente: a TJLP não carrega impacto
 * próprio, ela nomeia a coluna onde o impacto dela aparece.
 */
export function ehDriver(c: ComportamentoEconomico): boolean {
  return c.papel !== "MONTANTE" && (c.alimenta?.length ?? 0) > 0;
}

/** Um índice auxiliar por sufixo, para diagnósticos que só têm o nome curto. */
export function comportamentoPorSufixo(sufixo: string): ComportamentoEconomico[] {
  return COMPORTAMENTO_ECONOMICO.filter((c) => semEquipamento(c.code) === sufixo);
}
