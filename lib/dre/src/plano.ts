/**
 * O plano da DRE — **o que a demonstração afirma, declarado como dado**.
 *
 * Este arquivo é a autoridade única de §30: a estrutura da DRE, o que alimenta
 * cada linha, a quem cada linha pertence e — o que mais importa neste produto —
 * **o que ainda não temos e o que destravaria**. A API, a tela e o Assistente
 * leem daqui; nenhum dos três decide nada sobre estrutura financeira.
 *
 * Fica em código, e não em tabela, pelo mesmo motivo que `CONFIRMED_SEMANTICS`
 * em `@workspace/curation`, `COMPOSITIONS` em `@workspace/comparison` e `REGRAS`
 * em `@workspace/composition`: cada linha carrega a medição que a sustenta, e
 * uma medição revista num pull request é auditável de um jeito que um `UPDATE`
 * não é.
 *
 * ---
 *
 * **A coisa mais importante deste arquivo, escrita antes de qualquer código.**
 *
 * O export da Freightec é uma **tarifa**, não um demonstrativo de custos. As
 * colunas chamadas "custo" — amortização, juros, IPVA — não dizem quanto o
 * transportador gastou; dizem com que parcelas a Ambev montou o preço que paga.
 * E como
 *
 * ```
 * custo_fixo = (parcelas de custo) + (lucro fixo)
 * ```
 *
 * subtrair as parcelas da receita devolve **exatamente as linhas de lucro**. O
 * resultado é uma identidade aritmética, não uma apuração.
 *
 * Isso não impede a DRE; muda o que ela afirma. O que este módulo apura é a
 * **margem que o contrato embute em cada veículo**, e a tela diz isso em
 * primeiro plano — ver `NOTA_DA_SECAO.RESULTADO` e `AVISO_DE_CIRCULARIDADE`.
 * Apresentar esse número como "o resultado econômico do caminhão" seria
 * apresentar um rearranjo da própria receita com cara de medição.
 *
 * Medições que sustentam este arquivo: `docs/DRE-DIAGNOSTICO.md`.
 */

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

/**
 * A que unidade econômica um componente pertence (§18).
 *
 * Não é enfeite taxonômico: é o que impede a mesma quantia de ser contada no
 * cavalo e de novo no conjunto. `carreta.finame` **contém** o financiamento do
 * cavalo — medido em 558 de 558 pares — e por isso é CONJUNTO, nunca CARRETA.
 */
export type EscopoDeAlocacao =
  | "CAVALO"
  | "CARRETA"
  | "CONJUNTO"
  | "UNIDADE"
  | "FROTA";

/** Os escopos que a DRE sabe apurar por unidade econômica. */
export type EscopoApuravel = "CAVALO" | "CARRETA" | "CONJUNTO";

/** Atalho para as linhas que valem nas três leituras — quase sempre as lacunas. */
export const TODOS_OS_ESCOPOS: EscopoApuravel[] = ["CAVALO", "CARRETA", "CONJUNTO"];

/**
 * De onde o número veio (§4). Quatro estados, e nenhum deles é "zero".
 *
 * - `OBSERVADO` — veio do export com semântica confirmada, sem transformação.
 * - `CALCULADO` — derivado por regra declarada: soma de parcelas, ou conversão
 *   de periodicidade. O rastro carrega a transformação.
 * - `PRESUMIDO` — há valor, a semântica não está confirmada. **Não soma.**
 * - `NAO_DISPONIVEL` — não há dado. **Não soma, e não vira zero.**
 */
export type NaturezaDoValor =
  | "OBSERVADO"
  | "CALCULADO"
  | "PRESUMIDO"
  | "NAO_DISPONIVEL";

/** Por que uma linha da DRE não tem número. Vocabulário fechado, como em `regras.ts`. */
export type MotivoDeAusencia =
  /** O export não traz coluna nenhuma que alimente esta linha. */
  | "SEM_COLUNA_NA_FONTE"
  /** A coluna existe e o valor é zero em toda a série — coluna vazia, não custo zero. */
  | "COLUNA_SEM_DADO"
  /** Existe valor, mas a curadoria ainda não confirmou o que a coluna mede. */
  | "SEMANTICA_NAO_CONFIRMADA"
  /** O valor é uma razão (R$/km) e falta o denominador para virar montante. */
  | "BASE_OPERACIONAL_AUSENTE"
  /** Grandeza de aquisição: não converte para o fluxo do período. */
  | "GRANDEZA_DE_AQUISICAO";

export const ROTULO_DA_AUSENCIA: Record<MotivoDeAusencia, string> = {
  SEM_COLUNA_NA_FONTE: "Sem coluna na fonte",
  COLUNA_SEM_DADO: "Coluna sem dado",
  SEMANTICA_NAO_CONFIRMADA: "Semântica não confirmada",
  BASE_OPERACIONAL_AUSENTE: "Base operacional ausente",
  GRANDEZA_DE_AQUISICAO: "Grandeza de aquisição",
};

/** As seções da demonstração, na ordem em que se leem. */
export type SecaoId =
  | "RECEITA_BRUTA"
  | "DEDUCOES"
  | "CUSTO_VARIAVEL"
  | "CUSTO_FIXO"
  | "DEPRECIACAO_FINANCEIRO";

/** Os subtotais, na ordem da cascata. */
export type SubtotalId =
  | "RECEITA_BRUTA"
  | "RECEITA_LIQUIDA"
  | "MARGEM_CONTRIBUICAO"
  | "EBITDA"
  | "RESULTADO_ECONOMICO";

// ---------------------------------------------------------------------------
// A forma de um componente
// ---------------------------------------------------------------------------

/** De qual atributo canônico, em qual tipo de equipamento, a linha se alimenta. */
export interface FonteDoComponente {
  entityType: "CAVALO" | "CARRETA";
  /** O código canônico, como em `attribute.code`. */
  attributeCode: string;
}

export interface ComponenteDaDRE {
  /** Identificador estável da linha. Vai para a URL e para o Assistente. */
  code: string;
  titulo: string;
  secao: SecaoId;
  /**
   * `+1` soma na seção, `-1` subtrai. Fica explícito para que a leitura da
   * cascata não dependa de saber que "toda seção de custo é negativa" — uma
   * dedução estornada é positiva dentro de DEDUCOES, e o dia em que aparecer
   * uma, o motor não precisa mudar.
   */
  sinal: 1 | -1;
  /**
   * A quem o dinheiro pertence (§18). É documentação de alocação: diz de quem é
   * o custo, e é o que a tela mostra na coluna "Escopo".
   */
  escopo: EscopoDeAlocacao;
  /**
   * Em quais DREs esta linha aparece. **Declarado, nunca derivado.**
   *
   * Derivar isto de `escopo` foi a primeira tentativa e estava errada de um jeito
   * caro: `carreta.custo_fixo` é a receita do CONJUNTO e tem fonte do lado da
   * carreta, então qualquer regra baseada em "tem fonte deste lado" o fazia
   * aparecer também na DRE de uma carreta isolada — que passaria a exibir, como
   * receita própria, o que o par inteiro recebe. Numa frota de 71 carretas isso
   * seriam R$ 1,2 milhão/mês de cavalo dentro do número das carretas.
   *
   * Com a lista explícita, a receita do conjunto aparece só no conjunto, a do
   * cavalo só no cavalo, e as lacunas — diesel, motorista — aparecem nas três,
   * porque a lacuna é a mesma nas três.
   */
  apareceEm: EscopoApuravel[];
  /** Vazio quando a linha existe no plano e não tem dado que a alimente. */
  fontes: FonteDoComponente[];
  /**
   * O que dizer quando a linha não tem valor — **haja fonte declarada ou não**.
   *
   * Obrigatório quando `fontes` é vazio, e útil quando não é. O caso que exigiu
   * a segunda metade: `carreta.custo_aluguel` está declarado como fonte do
   * aluguel de implemento e é `PRESUMED`, então o portão da semântica o recusa e
   * a linha chega vazia. Sem esta mensagem, ela dizia "coluna sem dado" — que é
   * falso e manda o leitor procurar na Ambev uma coluna que já existe. O que
   * falta é a confirmação, e é isso que a linha passa a dizer.
   */
  ausencia?: {
    motivo: MotivoDeAusencia;
    /** A pergunta a fazer à Ambev. Vai para a tela como está. */
    oQueFalta: string;
  };
  /**
   * A medição que sustenta a entrada. Sem ela, isto seria um palpite com
   * aparência de regra.
   */
  evidencia: string;
  /**
   * Se a linha é indispensável para o subtotal da sua seção fazer sentido.
   *
   * Uma DRE sem diesel não é uma DRE com o diesel em zero — é uma DRE sem
   * margem de contribuição. Componentes marcados assim, quando ausentes,
   * tornam **inconclusivo** todo subtotal abaixo deles.
   */
  essencial: boolean;
}

// ---------------------------------------------------------------------------
// As seções
// ---------------------------------------------------------------------------

export interface SecaoDoPlano {
  id: SecaoId;
  titulo: string;
  /** O subtotal que fecha esta seção. */
  fecha: SubtotalId;
}

export const SECOES: SecaoDoPlano[] = [
  { id: "RECEITA_BRUTA", titulo: "Receita bruta", fecha: "RECEITA_BRUTA" },
  { id: "DEDUCOES", titulo: "(−) Deduções", fecha: "RECEITA_LIQUIDA" },
  { id: "CUSTO_VARIAVEL", titulo: "(−) Custos variáveis", fecha: "MARGEM_CONTRIBUICAO" },
  { id: "CUSTO_FIXO", titulo: "(−) Custos fixos do veículo", fecha: "EBITDA" },
  {
    id: "DEPRECIACAO_FINANCEIRO",
    titulo: "(−) Depreciação e financeiro",
    fecha: "RESULTADO_ECONOMICO",
  },
];

export const ROTULO_DO_SUBTOTAL: Record<SubtotalId, string> = {
  RECEITA_BRUTA: "Receita bruta",
  RECEITA_LIQUIDA: "Receita líquida",
  MARGEM_CONTRIBUICAO: "Margem de contribuição",
  EBITDA: "EBITDA",
  RESULTADO_ECONOMICO: "Resultado econômico",
};

/** Quais seções entram em cada subtotal, acumulando de cima para baixo. */
export const SECOES_DO_SUBTOTAL: Record<SubtotalId, SecaoId[]> = {
  RECEITA_BRUTA: ["RECEITA_BRUTA"],
  RECEITA_LIQUIDA: ["RECEITA_BRUTA", "DEDUCOES"],
  MARGEM_CONTRIBUICAO: ["RECEITA_BRUTA", "DEDUCOES", "CUSTO_VARIAVEL"],
  EBITDA: ["RECEITA_BRUTA", "DEDUCOES", "CUSTO_VARIAVEL", "CUSTO_FIXO"],
  RESULTADO_ECONOMICO: [
    "RECEITA_BRUTA",
    "DEDUCOES",
    "CUSTO_VARIAVEL",
    "CUSTO_FIXO",
    "DEPRECIACAO_FINANCEIRO",
  ],
};

/**
 * O aviso que acompanha o resultado, e que não pode ser removido sem que o dado
 * mude.
 *
 * Ver o cabeçalho deste arquivo. É a única frase do módulo que descreve uma
 * limitação **conceitual** em vez de uma lacuna de dado, e por isso ela não sai
 * quando a curadoria avançar: ela sai quando o transportador trouxer custo
 * incorrido de verdade.
 */
export const AVISO_DE_CIRCULARIDADE =
  "Esta DRE é montada sobre a tarifa da Freightec, não sobre custo incorrido. " +
  "As parcelas subtraídas — amortização, juros, IPVA, aluguel — são os itens com " +
  "que a Ambev montou o preço, e a receita é a soma deles com o lucro contratado. " +
  "O resultado apurado é, portanto, a margem que o contrato embute neste veículo, " +
  "e não o que ele deixou depois de gastos reais.";

export const NOTA_DA_SECAO: Record<SecaoId, string> = {
  RECEITA_BRUTA: "O que a Ambev paga por este equipamento nesta vigência.",
  DEDUCOES:
    "Tributos e abatimentos sobre a prestação. O export não traz nenhum: " +
    "valorIcms é zero em toda a série e valorPisCofins incide sobre a nota de " +
    "compra do ativo, não sobre o serviço.",
  CUSTO_VARIAVEL:
    "Custo provocado pela operação. Nenhuma linha tem dado hoje — sem eles não " +
    "existe margem de contribuição, e o produto prefere dizer isso a somar zeros.",
  CUSTO_FIXO: "Custo que incide independentemente de rodar.",
  DEPRECIACAO_FINANCEIRO:
    "Amortização do principal e juros do FINAME. Não é depreciação contábil — " +
    "é a obrigação financeira reconhecida na tarifa.",
};

// ---------------------------------------------------------------------------
// O registro
// ---------------------------------------------------------------------------

/**
 * Os componentes da DRE.
 *
 * **Nenhuma entrada aqui foi deduzida de nome de coluna.** Cada `evidencia`
 * cita a medição feita sobre as 9 vigências reais em 15/08/2026, e as entradas
 * sem fonte citam a contagem que prova a ausência — que é a informação que vira
 * pergunta para a Ambev.
 */
export const PLANO_DA_DRE: ComponenteDaDRE[] = [
  // ── Receita ────────────────────────────────────────────────────────────────
  {
    code: "receita.remuneracao_fixa",
    titulo: "Remuneração fixa mensal",
    secao: "RECEITA_BRUTA",
    sinal: 1,
    escopo: "CONJUNTO",
    apareceEm: ["CONJUNTO"],
    fontes: [{ entityType: "CARRETA", attributeCode: "carreta.custo_fixo" }],
    evidencia:
      "custoFixo é confirmado MENSAL pelo transportador (10/08/2026) e contém o " +
      "conjunto: custoFixo = finame + lucroFixomodeloNovoCiclo em 657 de 657 linhas, " +
      "e finame − finameImplemento = finameCavalo em 558 de 558 pares. É o que a " +
      "Ambev paga pelo conjunto cavalo + carreta.",
    essencial: true,
  },
  {
    code: "receita.remuneracao_fixa_cavalo",
    titulo: "Remuneração fixa do cavalo",
    secao: "RECEITA_BRUTA",
    sinal: 1,
    escopo: "CAVALO",
    apareceEm: ["CAVALO"],
    fontes: [{ entityType: "CAVALO", attributeCode: "cavalo.finame_cavalo" }],
    evidencia:
      "finameCavalo é o custo fixo do cavalo, não a sua parcela de financiamento: " +
      "a hipótese 'amortização + juros' foi testada e rejeitada (falha em 30 linhas), " +
      "enquanto 'amortização + juros + lucro fixo do novo ciclo' fecha em 532 das 533 " +
      "linhas não nulas. Quando o financiamento se encerra, o valor migra para o lucro " +
      "fixo dentro do mesmo total.",
    essencial: true,
  },
  {
    code: "receita.remuneracao_fixa_carreta",
    titulo: "Remuneração fixa da carreta",
    secao: "RECEITA_BRUTA",
    sinal: 1,
    escopo: "CARRETA",
    apareceEm: ["CARRETA"],
    fontes: [
      { entityType: "CARRETA", attributeCode: "carreta.finame_implemento" },
      { entityType: "CARRETA", attributeCode: "carreta.lucro_fixomodelo_novo_ciclo" },
    ],
    evidencia:
      "O que resta da carreta depois de custoFixo e finame saírem por escopo de " +
      "conjunto: finameImplemento (= amortização + juros + aluguel, 651 de 651 linhas) " +
      "e o lucro fixo, que volta a ser raiz quando o total que o continha sai.",
    essencial: true,
  },
  {
    code: "receita.remuneracao_variavel",
    titulo: "Remuneração variável / produtividade",
    secao: "RECEITA_BRUTA",
    sinal: 1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEMANTICA_NAO_CONFIRMADA",
      oQueFalta:
        "Confirmar com a Ambev o que lucroVariavelPrevisto mede, em que " +
        "periodicidade, e se é valor previsto ou realizado. Hoje ele é uma previsão, " +
        "e uma previsão não entra numa demonstração de resultado.",
    },
    evidencia:
      "lucroVariavelPrevisto existe nas duas abas (média R$ 4.150,22 na carreta, " +
      "R$ 3.515,13 no cavalo) e está PRESUMED, sem periodicidade. O nome diz " +
      "'previsto'. O portão da semântica o recusa, e está certo em recusar.",
    essencial: false,
  },
  {
    code: "receita.adicionais",
    titulo: "Adicionais operacionais",
    secao: "RECEITA_BRUTA",
    sinal: 1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEM_COLUNA_NA_FONTE",
      oQueFalta:
        "Nenhuma coluna de adicional, prêmio ou produtividade existe no export. " +
        "Se a Ambev paga adicionais, eles chegam por outro arquivo.",
    },
    evidencia: "Varredura das 138 colunas: nenhuma corresponde a adicional ou prêmio.",
    essencial: false,
  },

  // ── Deduções ───────────────────────────────────────────────────────────────
  {
    code: "deducoes.icms",
    titulo: "ICMS sobre a prestação",
    secao: "DEDUCOES",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "COLUNA_SEM_DADO",
      oQueFalta:
        "valorIcms existe e é zero em todas as 1.215 linhas. Perguntar à Ambev se " +
        "a coluna deixou de ser preenchida ou se o ICMS não incide nesta operação.",
    },
    evidencia:
      "carreta.valorIcms: 657 valores, 657 zeros, 1 valor distinto. " +
      "cavalo.valorIcms: 558 valores, 558 zeros. As alíquotas (icms, percentualIcms) " +
      "existem, mas alíquota sem base não é montante.",
    essencial: false,
  },
  {
    code: "deducoes.pis_cofins",
    titulo: "PIS/COFINS sobre a prestação",
    secao: "DEDUCOES",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "GRANDEZA_DE_AQUISICAO",
      oQueFalta:
        "valorPisCofins é confirmado PONTUAL: incide sobre a nota de compra do " +
        "ativo (exatamente 9,250% dela, desvio 0,0000 nos 132 ativos), não sobre a " +
        "prestação mensal. Falta o PIS/COFINS do serviço.",
    },
    evidencia:
      "Confirmado em 10/08/2026: valorPisCofins = 9,250% de valorNfCompra, desvio " +
      "zero, e nunca varia ao longo das 9 vigências. É tributo de aquisição.",
    essencial: false,
  },

  // ── Custos variáveis ──────────────────────────────────────────────────────
  {
    code: "variavel.diesel",
    titulo: "Diesel",
    secao: "CUSTO_VARIAVEL",
    sinal: -1,
    escopo: "CAVALO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEM_COLUNA_NA_FONTE",
      oQueFalta:
        "Litros consumidos e preço do litro no período, ou o valor gasto. O export " +
        "traz apenas o consumo de referência (km/l) e a capacidade do tanque — " +
        "dois parâmetros do contrato, não um gasto.",
    },
    evidencia:
      "As três colunas de combustível são combustivelConsumoBenchmark (KM_L, média " +
      "1,70), combustivelConsumoNeg (KM_L, média 1,68) e combustivelCapacidade " +
      "(LITROS, média 28,68 — capacidade, não consumo). Nenhuma é montante.",
    essencial: true,
  },
  {
    code: "variavel.arla",
    titulo: "Arla",
    secao: "CUSTO_VARIAVEL",
    sinal: -1,
    escopo: "CAVALO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEM_COLUNA_NA_FONTE",
      oQueFalta: "Nenhuma coluna de Arla existe no export.",
    },
    evidencia: "Varredura das 138 colunas: nenhuma menciona arla ou ureia.",
    essencial: true,
  },
  {
    code: "variavel.pneus",
    titulo: "Pneus",
    secao: "CUSTO_VARIAVEL",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "COLUNA_SEM_DADO",
      oQueFalta:
        "valorPneus e valorPneu existem e são zero em toda a série. Perguntar à " +
        "Ambev se o custo de pneu está embutido em outra linha ou se a coluna parou " +
        "de ser preenchida.",
    },
    evidencia:
      "carreta.valorPneus: 657 valores, 657 zeros. cavalo.valorPneu: 558 valores, " +
      "558 zeros. Um valor distinto em cada uma.",
    essencial: true,
  },
  {
    code: "variavel.manutencao",
    titulo: "Manutenção",
    secao: "CUSTO_VARIAVEL",
    sinal: -1,
    escopo: "CAVALO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "BASE_OPERACIONAL_AUSENTE",
      oQueFalta:
        "Quilometragem rodada por ativo no período. A taxa existe — manutencaoReaisKm " +
        "média R$ 0,26/km, manutencaoBid média R$ 0,38/km — e sem km ela não vira " +
        "montante. Multiplicar por uma quilometragem estimada seria inventar o número.",
    },
    evidencia:
      "manutencaoReaisKm e manutencaoBid são BRL_KM, agregação NONE. É exatamente o " +
      "caso que baseQueFalta já descreve em lib/curation/src/agregacao.ts.",
    essencial: true,
  },
  {
    code: "variavel.pedagio",
    titulo: "Pedágio não reembolsado",
    secao: "CUSTO_VARIAVEL",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEM_COLUNA_NA_FONTE",
      oQueFalta: "Nenhuma coluna de pedágio existe no export.",
    },
    evidencia: "Varredura das 138 colunas: nenhuma menciona pedágio.",
    essencial: false,
  },
  {
    code: "variavel.outros",
    titulo: "Lavagem, lubrificação e peças",
    secao: "CUSTO_VARIAVEL",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEM_COLUNA_NA_FONTE",
      oQueFalta: "Nenhuma dessas despesas aparece no export.",
    },
    evidencia: "Varredura das 138 colunas: nenhuma corresponde.",
    essencial: false,
  },

  // ── Custos fixos ──────────────────────────────────────────────────────────
  {
    code: "fixo.ipva_licenciamento",
    titulo: "IPVA e licenciamento",
    secao: "CUSTO_FIXO",
    sinal: -1,
    escopo: "CAVALO",
    apareceEm: ["CAVALO", "CONJUNTO"],
    fontes: [{ entityType: "CAVALO", attributeCode: "cavalo.ipva_licenciamento" }],
    evidencia:
      "Confirmado ANUAL em 10/08/2026: de Jan a Jun/2026 o valor é exatamente 1,000% " +
      "de valorNfCompra nas 62 placas, desvio 0,0000. Um por cento do valor do veículo " +
      "ao ano é alíquota plausível; ao mês daria 12% a.a. Entra na DRE mensal dividido " +
      "por doze, e a conversão fica marcada como projeção — ver docs/ACHADO-IPVA.md, " +
      "porque a base de cálculo mudou duas vezes na série.",
    essencial: false,
  },
  {
    code: "fixo.aluguel_implemento",
    titulo: "Aluguel de implemento",
    secao: "CUSTO_FIXO",
    sinal: -1,
    escopo: "CARRETA",
    apareceEm: ["CARRETA", "CONJUNTO"],
    fontes: [{ entityType: "CARRETA", attributeCode: "carreta.custo_aluguel" }],
    ausencia: {
      motivo: "SEMANTICA_NAO_CONFIRMADA",
      oQueFalta:
        "Confirmar com a Ambev a periodicidade de carreta.custoAluguel. A coluna " +
        "existe e tem valor — R$ 11.777,92 na frota de ago/2026 —, e o portão da " +
        "semântica a recusa porque ninguém declarou se o valor é mensal ou anual. " +
        "É a única linha desta DRE que uma confirmação de curadoria destrava sozinha.",
    },
    evidencia:
      "custoAluguel é a terceira parcela de finameImplemento e explica exatamente as " +
      "18 linhas em que a identidade falharia sem ela — as placas CUL0J25 e FCW7D86 " +
      "nas 9 vigências, implementos alugados sem financiamento. Média R$ 162,83; " +
      "não nulo em 18 de 651 linhas. Está PRESUMED em 15/08/2026 e por isso não soma.",
    essencial: false,
  },
  {
    code: "fixo.motorista",
    titulo: "Motorista e encargos",
    secao: "CUSTO_FIXO",
    sinal: -1,
    escopo: "CAVALO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEM_COLUNA_NA_FONTE",
      oQueFalta:
        "Custo de mão de obra por veículo. Nenhuma coluna de pessoal existe no " +
        "export — a folha do transportador não passa pela Freightec.",
    },
    evidencia:
      "O grupo cf_pessoal da taxonomia existe e está vazio: nenhum dos 138 atributos " +
      "foi classificado nele.",
    essencial: true,
  },
  {
    code: "fixo.seguro",
    titulo: "Seguro",
    secao: "CUSTO_FIXO",
    sinal: -1,
    escopo: "CARRETA",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEMANTICA_NAO_CONFIRMADA",
      oQueFalta:
        "Confirmar com a Ambev o que carreta.seguro mede e em que periodicidade, e " +
        "se existe equivalente para o cavalo — hoje não existe.",
    },
    evidencia:
      "carreta.seguro está PRESUMED, unidade BRL, sem periodicidade, média R$ 503,01 " +
      "em 657 linhas. O cavalo não tem coluna equivalente.",
    essencial: false,
  },
  {
    code: "fixo.rastreamento",
    titulo: "Rastreamento e telemetria",
    secao: "CUSTO_FIXO",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "COLUNA_SEM_DADO",
      oQueFalta:
        "carreta.rastreador existe e é zero em 657 de 657 linhas. Perguntar se o " +
        "custo está embutido em outra linha.",
    },
    evidencia: "carreta.rastreador: 657 valores, 657 zeros, 1 valor distinto.",
    essencial: false,
  },

  // ── Depreciação e financeiro ──────────────────────────────────────────────
  {
    code: "financeiro.amortizacao",
    titulo: "Amortização do principal (FINAME)",
    secao: "DEPRECIACAO_FINANCEIRO",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [
      { entityType: "CAVALO", attributeCode: "cavalo.amortizacao_cavalo" },
      { entityType: "CARRETA", attributeCode: "carreta.amortizacao_implemento" },
    ],
    evidencia:
      "Confirmado MENSAL em 10/08/2026 por base aritmética: amortizacao ÷ " +
      "(valorNF × (1 − entrada%) ÷ periodoFiname) = 1,108 nas carretas (desvio 0,018) " +
      "e 1,081 nos cavalos (desvio 0,040) — o prazo do FINAME está em meses. Lido como " +
      "anual, a conta erraria por um fator de treze. Atenção: é amortização de " +
      "financiamento, não depreciação contábil.",
    essencial: false,
  },
  {
    code: "financeiro.juros",
    titulo: "Juros do FINAME",
    secao: "DEPRECIACAO_FINANCEIRO",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [
      { entityType: "CAVALO", attributeCode: "cavalo.juros_finame_cavalo" },
      { entityType: "CARRETA", attributeCode: "carreta.juros_finame_implemento" },
    ],
    evidencia:
      "Mesma cadeia confirmada da amortização: finameImplemento = amortizacao + juros " +
      "em 37 de 38 implementos com ambas as parcelas não nulas.",
    essencial: false,
  },
  {
    code: "financeiro.depreciacao_contabil",
    titulo: "Depreciação contábil",
    secao: "DEPRECIACAO_FINANCEIRO",
    sinal: -1,
    escopo: "CONJUNTO",
    apareceEm: TODOS_OS_ESCOPOS,
    fontes: [],
    ausencia: {
      motivo: "SEM_COLUNA_NA_FONTE",
      oQueFalta:
        "Vida útil contábil e valor residual por ativo. O export traz valorNfCompra " +
        "(o custo de aquisição) e a amortização do financiamento, que é obrigação e " +
        "não desgaste. Com vida útil declarada, a linha passa a ser calculável.",
    },
    evidencia:
      "valorNfCompra é confirmado PONTUAL e nunca varia nas 9 vigências. Dividi-lo " +
      "por um prazo não informado produziria uma depreciação com vida útil inventada.",
    essencial: false,
  },
];

// ---------------------------------------------------------------------------
// Índices
// ---------------------------------------------------------------------------

const POR_CODIGO = new Map(PLANO_DA_DRE.map((c) => [c.code, c]));

export function componenteDaDRE(code: string): ComponenteDaDRE | null {
  return POR_CODIGO.get(code) ?? null;
}

/**
 * O índice `atributo canônico → componente da DRE`, por escopo.
 *
 * A chave inclui o escopo porque o mesmo atributo alimenta linhas diferentes
 * conforme a unidade econômica: `carreta.custo_fixo` é a receita do CONJUNTO e
 * não é receita de carreta nenhuma.
 */
const POR_ATRIBUTO = new Map<string, ComponenteDaDRE[]>();
for (const componente of PLANO_DA_DRE) {
  for (const fonte of componente.fontes) {
    const chave = `${componente.escopo}|${fonte.attributeCode}`;
    const lista = POR_ATRIBUTO.get(chave) ?? [];
    lista.push(componente);
    POR_ATRIBUTO.set(chave, lista);
  }
}

/**
 * Qual linha da DRE este atributo alimenta, neste escopo.
 *
 * Devolve `null` quando o atributo não pertence à DRE deste escopo — que é o
 * caso da maioria: dos 138 atributos, 10 alimentam alguma linha.
 */
export function componenteDoAtributo(
  escopo: EscopoDeAlocacao,
  attributeCode: string,
): ComponenteDaDRE | null {
  const lista = POR_ATRIBUTO.get(`${escopo}|${attributeCode}`);
  return lista?.[0] ?? null;
}

/** Os componentes que valem para um escopo, na ordem da demonstração. */
export function componentesDoEscopo(escopo: EscopoDeAlocacao): ComponenteDaDRE[] {
  const ordem = new Map(SECOES.map((s, i) => [s.id, i]));
  return PLANO_DA_DRE.filter((c) => aplicaAoEscopo(c, escopo)).sort(
    (a, b) => ordem.get(a.secao)! - ordem.get(b.secao)!,
  );
}

/**
 * Se um componente entra na DRE de um escopo.
 *
 * Uma consulta à lista declarada, e nada mais. Ver `ComponenteDaDRE.apareceEm`
 * para por que isto não é derivado de `escopo` nem das fontes.
 *
 * Escopos de agregação (UNIDADE, FROTA) leem o plano do escopo que estão
 * consolidando; nunca são passados aqui.
 */
export function aplicaAoEscopo(
  componente: ComponenteDaDRE,
  escopo: EscopoDeAlocacao,
): boolean {
  return (componente.apareceEm as string[]).includes(escopo);
}

/**
 * Os atributos que a DRE consome, em qualquer escopo.
 *
 * É a lista que os testes usam para provar que nenhum atributo entra na
 * demonstração sem estar declarado aqui.
 */
export function atributosDaDRE(): string[] {
  return [...new Set(PLANO_DA_DRE.flatMap((c) => c.fontes.map((f) => f.attributeCode)))].sort();
}
