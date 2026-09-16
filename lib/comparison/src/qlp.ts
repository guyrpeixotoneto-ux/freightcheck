/**
 * A AUDITORIA DO QLP — as contas que o próprio quadro declara, conferidas
 * dentro de uma vigência.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e por que ele não compara vigências
 * ---------------------------------------------------------------------------
 * As cinco auditorias de rubrica anteriores comparam duas vigências: é a
 * pergunta "o que mudou". Esta não, e a razão é que **a pergunta já tem tela**.
 * O QLP Administrativo tem uma aba de Alterações desde que existe, e ela usa o
 * motor canônico — o mesmo de Comparar Vigências. Um segundo recorte comparativo
 * aqui seria a mesma resposta em dois lugares, livre para divergir.
 *
 * O que não tinha tela é **a conta que o quadro declara sobre si mesmo**, dentro
 * de uma vigência só:
 *
 * - no **administrativo**, `Quantidade × Valor = Despesa`, seis vezes — uma por
 *   rubrica. O dicionário abre dizendo que essa forma resolve 21 das 37 colunas
 *   da tabela;
 * - no **operacional**, a **cadeia dos subtotais**: piso e adicionais somam no
 *   salário fixo, o contracheque com encargos soma na remuneração fixa, e esta
 *   com benefícios e EPI soma no total. Nove colunas são subtotais, e somá-las
 *   junto das parcelas dobra a folha.
 *
 * Conferir isso não exige semântica confirmada, e é o que torna esta tela
 * possível numa rubrica em que **nada soma**: o produto não pode dizer o custo
 * da estrutura administrativa sem curadoria, mas pode dizer se a multiplicação
 * que a própria planilha declara fecha. São duas coisas diferentes, e só a
 * segunda depende apenas de aritmética.
 *
 * ---------------------------------------------------------------------------
 * O grão é o cargo
 * ---------------------------------------------------------------------------
 * Nem placa nem trecho: **um cargo por unidade** no administrativo, **um cargo
 * por unidade e turno** no operacional. O dicionário é explícito — "cada linha é
 * um cargo do quadro, e não uma pessoa. Quem diz quantas pessoas há é a coluna
 * Quantidade correspondente" —, e essa distinção atravessa a tela inteira: a
 * quantidade é o efetivo reconhecido, e não o número de linhas.
 *
 * ---------------------------------------------------------------------------
 * As quatro decisões que os dicionários obrigaram a escrever
 * ---------------------------------------------------------------------------
 * Todas em `docs/ACHADO-QLP.md`:
 *
 * 1. **Quantidade, valor unitário e despesa nunca somam entre si.** São três
 *    naturezas na mesma linha, e somar duas delas conta a mesma estrutura duas
 *    vezes. O `papel` de cada coluna é campo do catálogo, não comentário.
 * 2. **O benchmark é régua, não custo.** `QLP Benchmark Quantidade` e
 *    `QLP Benchmark Salário` são a referência que a auditoria bimestral do QLP
 *    ADM confronta — o Book chama o resultado disso de DESCONTO QLP ADM. Elas
 *    ficam fora de qualquer total e ganham a conferência própria.
 * 3. **O vale-transporte pode já estar dentro da despesa de benefício.** Os
 *    rótulos admitem as duas leituras, e a diferença entre elas é o valor
 *    inteiro do VT. Enquanto a Ambev não responder, ele fica fora de toda soma —
 *    dito, e não escondido.
 * 4. **`outro` é uma coluna sem nome dentro de um total.** No quadro
 *    operacional, ela é a forma mais silenciosa de duplicar ou esconder um
 *    custo. Não soma, e a tela diz por quê.
 */

import type { MedidaDaVariavel } from "./recorte-de-rubrica";

export type { MedidaDaVariavel };

// ---------------------------------------------------------------------------
// Os dois quadros
// ---------------------------------------------------------------------------

/** Os dois quadros de pessoal que o modelo remunera. */
export type QuadroDeQlp = "ADMINISTRATIVO" | "OPERACIONAL";

export const ROTULO_DO_QUADRO: Record<QuadroDeQlp, string> = {
  ADMINISTRATIVO: "QLP Administrativo",
  OPERACIONAL: "QLP Operacional",
};

/** O tipo de entidade de cada quadro, como a importação o grava. */
export const TIPO_DO_QUADRO: Record<QuadroDeQlp, string> = {
  ADMINISTRATIVO: "QLP_ADMINISTRATIVO",
  OPERACIONAL: "QLP_OPERACIONAL",
};

/** O grão de cada quadro, dito como a tela o escreve. */
export const GRAO_DO_QUADRO: Record<QuadroDeQlp, string> = {
  ADMINISTRATIVO: "um cargo por unidade",
  OPERACIONAL: "um cargo por unidade e turno",
};

/**
 * O que a coluna é dentro do quadro — a distinção que decide todo o resto.
 *
 * - `MONTANTE` — dinheiro. É o único papel que poderia somar, e mesmo ele só
 *   soma depois que a curadoria confirmar a semântica.
 * - `PARAMETRO` — preço de **uma** unidade. Vira dinheiro multiplicado pela
 *   quantidade; somá-lo com a despesa conta o mesmo salário duas vezes.
 * - `QUANTIDADE` — efetivo, linhas de telefone, uniformes. Não é dinheiro.
 * - `SUBTOTAL` — um montante que **já contém** outros. Somá-lo às parcelas
 *   dobra a folha, e é o aviso mais caro do dicionário da tabela de equipe.
 * - `BENCHMARK` — a referência da auditoria. Régua, não custo.
 * - `CONTEXTO` — unidade, operador, turno e o que mais situa sem medir.
 */
export type PapelNoQuadro =
  | "MONTANTE"
  | "PARAMETRO"
  | "QUANTIDADE"
  | "SUBTOTAL"
  | "BENCHMARK"
  | "CONTEXTO";

export const ROTULO_DO_PAPEL: Record<PapelNoQuadro, string> = {
  MONTANTE: "Montante",
  PARAMETRO: "Parâmetro unitário",
  QUANTIDADE: "Quantidade",
  SUBTOTAL: "Subtotal",
  BENCHMARK: "Benchmark",
  CONTEXTO: "Cadastro",
};

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/** Uma variável de um quadro de QLP. */
export interface VariavelDoQuadro {
  /** A chave estável desta variável na tela e na API. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelNoQuadro;
  /** O código do atributo, já com o prefixo do tipo. */
  codigo: string;
  /** A rubrica a que ela pertence, quando há uma. */
  rubrica?: string;
  /**
   * Uma coluna que **não entra em soma nenhuma**, e a razão disso.
   *
   * Três famílias: os subtotais, que já contêm as parcelas; o vale-transporte,
   * que pode já estar dentro da despesa de benefício; e `outro`, que é uma
   * rubrica sem nome.
   */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

const ADM = (slug: string) => `qlp_administrativo.${slug}`;
const OPER = (slug: string) => `qlp_operacional.${slug}`;

/**
 * As variáveis do quadro administrativo, na ordem em que a tela as lê.
 *
 * Começa nos ordenados — a maior das seis despesas, e a que o benchmark audita —
 * e segue pelas outras cinco rubricas, cada uma com o trio inteiro: quantas,
 * quanto vale cada uma, quanto dá. Termina no benchmark e no vale-transporte.
 */
/*
  A rubrica dos ordenados chama-se `salario`, e é o nome que o operacional usa.

  A **conta** continua sendo "Ordenados", que é como o dicionário do QLP ADM a
  declara. O que se unificou foi a **rubrica**, que é o eixo por onde a leitura
  por assunto recorta: salário administrativo e piso operacional são a mesma
  pergunta feita nas duas alturas do quadro, e um recorte que mudasse de nome
  conforme o quadro obrigaria quem lê a traduzir entre os dois — o mesmo motivo
  que já valia para `transporte`.
*/
export const VARIAVEIS_ADMINISTRATIVO: readonly VariavelDoQuadro[] = [
  {
    chave: "quantidade_ordenados",
    rotulo: "Efetivo remunerado",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: ADM("quantidade_ordenados"),
    rubrica: "salario",
    ajuda:
      "Quantas posições do cargo o QLP remunera — o efetivo reconhecido. É esta " +
      "quantidade que o benchmark confronta, e ela não é o número de linhas do quadro: " +
      "cada linha é um cargo, não uma pessoa.",
  },
  {
    chave: "salario_ordenados",
    rotulo: "Salário unitário",
    medida: "DINHEIRO",
    papel: "PARAMETRO",
    codigo: ADM("salario_ordenados"),
    rubrica: "salario",
    ajuda: "Salário de uma posição, sem encargos. Multiplicado pelo efetivo, dá a despesa.",
  },
  {
    chave: "despesa_ordenados",
    rotulo: "Despesa de ordenados",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: ADM("despesa_ordenados"),
    rubrica: "salario",
  },
  {
    chave: "quantidade_encargos",
    rotulo: "Quantidade de encargos",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: ADM("quantidade_encargos"),
    rubrica: "encargos",
    ajuda:
      "O rótulo veio como “QUANTIDADE DE BENEFICIO ENCARGO REMUNERADO”, aparentemente " +
      "herdando a palavra da linha de cima. Vale confirmar se a base dos encargos é a " +
      "dos benefícios ou a dos ordenados — ver docs/ACHADO-QLP.md.",
  },
  {
    chave: "salario_encargos",
    rotulo: "Salário com encargos",
    medida: "DINHEIRO",
    papel: "PARAMETRO",
    codigo: ADM("salario_encargos"),
    rubrica: "encargos",
    ajuda: "O custo unitário para quem paga, e não o que a pessoa recebe.",
  },
  {
    chave: "despesa_encargos",
    rotulo: "Despesa de encargos",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: ADM("despesa_encargos"),
    rubrica: "encargos",
  },
  {
    chave: "quantidade_beneficio",
    rotulo: "Quantidade de benefícios",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: ADM("quantidade_beneficio"),
    rubrica: "beneficio",
  },
  {
    chave: "valor_beneficio",
    rotulo: "Valor do benefício",
    medida: "DINHEIRO",
    papel: "PARAMETRO",
    codigo: ADM("valor_beneficio"),
    rubrica: "beneficio",
  },
  {
    chave: "despesa_beneficio",
    rotulo: "Despesa de benefícios",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: ADM("despesa_beneficio"),
    rubrica: "beneficio",
  },
  {
    chave: "quantidade_frota_leve",
    rotulo: "Quantidade de frota leve",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: ADM("quantidade_frota_leve"),
    rubrica: "frota_leve",
    ajuda:
      "Os veículos de apoio da estrutura administrativa — carro do supervisor, " +
      "utilitário da operação —, nunca o cavalo nem a carreta.",
  },
  {
    chave: "valor_frota_leve",
    rotulo: "Valor da frota leve",
    medida: "DINHEIRO",
    papel: "PARAMETRO",
    codigo: ADM("valor_frota_leve"),
    rubrica: "frota_leve",
  },
  {
    chave: "despesa_frota_leve",
    rotulo: "Despesa de frota leve",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: ADM("despesa_frota_leve"),
    rubrica: "frota_leve",
  },
  {
    chave: "quantidade_telefonia",
    rotulo: "Quantidade de telefonia",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: ADM("quantidade_telefonia"),
    rubrica: "telefonia",
  },
  {
    chave: "valor_telefonia",
    rotulo: "Valor da telefonia",
    medida: "DINHEIRO",
    papel: "PARAMETRO",
    codigo: ADM("valor_telefonia"),
    rubrica: "telefonia",
  },
  {
    chave: "despesa_telefonia",
    rotulo: "Despesa de telefonia",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: ADM("despesa_telefonia"),
    rubrica: "telefonia",
  },
  {
    chave: "quantidade_uniformes",
    rotulo: "Quantidade de uniformes",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: ADM("quantidade_uniformes"),
    rubrica: "uniformes",
  },
  {
    chave: "valor_uniformes",
    rotulo: "Valor do uniforme",
    medida: "DINHEIRO",
    papel: "PARAMETRO",
    codigo: ADM("valor_uniformes"),
    rubrica: "uniformes",
  },
  {
    chave: "despesa_uniformes",
    rotulo: "Despesa de uniformes",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: ADM("despesa_uniformes"),
    rubrica: "uniformes",
  },
  {
    chave: "benchmark_quantidade",
    rotulo: "Quadro de referência",
    medida: "QUANTIDADE",
    papel: "BENCHMARK",
    codigo: ADM("qlp_benchmark_quantidade"),
    rubrica: "benchmark",
    ajuda:
      "Quantas posições o padrão da operação prevê para este cargo. É a régua da " +
      "auditoria bimestral do QLP ADM, e a diferença para o efetivo é o que vira não " +
      "conformidade — a consequência financeira dela está no bloco DESCONTO QLP ADM.",
  },
  {
    chave: "benchmark_salario",
    rotulo: "Salário de referência",
    medida: "DINHEIRO",
    papel: "BENCHMARK",
    codigo: ADM("qlp_benchmark_salario"),
    rubrica: "benchmark",
    ajuda:
      "O salário de referência do cargo, já resolvido pela matriz de faixas do " +
      "Freightech. Régua, não custo: não entra em soma nenhuma.",
  },
  {
    chave: "vale_transporte",
    rotulo: "Vale-transporte",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: ADM("vale_transporte"),
    rubrica: "transporte",
    foraDaSoma:
      "Pode já estar dentro da despesa de benefício: os rótulos admitem as duas " +
      "leituras, e elas diferem pelo valor inteiro do vale-transporte do quadro. " +
      "Enquanto a Ambev não responder qual é, ele fica fora de toda soma — é a " +
      "primeira pergunta a fazer sobre esta tabela.",
  },
] as const;

/**
 * As variáveis do quadro operacional, na ordem em que a tela as lê.
 *
 * Começa na raiz — o piso salarial, de onde saem adicionais, DSR e encargos —,
 * sobe a cadeia dos subtotais até o total do cargo, e termina no dimensionamento,
 * que é o que leva o custo de uma pessoa ao custo de um caminhão.
 *
 * **Os nove subtotais estão todos marcados**, e é a decisão mais cara deste
 * quadro: eles convivem na mesma tabela com as parcelas que os compõem, e o
 * dicionário avisa que somá-los junto dobra a folha.
 */
export const VARIAVEIS_OPERACIONAL: readonly VariavelDoQuadro[] = [
  {
    chave: "piso_salarial",
    rotulo: "Piso salarial",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("piso_salarial"),
    rubrica: "salario",
    ajuda:
      "O piso da convenção coletiva da categoria. É a raiz de quase toda a tabela — " +
      "adicionais, DSR, encargos e provisões saem daqui, e um centavo de erro se " +
      "propaga por todas as linhas abaixo.",
  },
  {
    chave: "adicional_noturno",
    rotulo: "Adicional noturno",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("adicional_noturno"),
    rubrica: "salario",
    ajuda: "Só existe onde o turno alcança a madrugada — por isso anda junto do turno.",
  },
  {
    chave: "dsr_adicional_noturno",
    rotulo: "DSR sobre o adicional",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("dsr_adicional_noturno"),
    rubrica: "salario",
    ajuda: "O reflexo legal do adicional nos dias de descanso. Mexer no adicional mexe aqui.",
  },
  {
    chave: "valor_abono",
    rotulo: "Abono acordado",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("valor_abono"),
    rubrica: "abono",
    ajuda:
      "Parcela sem natureza salarial: fica fora da base de encargos, e é por isso que " +
      "o abono tem duas colunas de total só para si.",
  },
  {
    chave: "valor_abono_aplicado",
    rotulo: "Abono aplicado",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("valor_abono_aplicado"),
    rubrica: "abono",
    ajuda:
      "O abono efetivamente aplicado nesta vigência. Quando a janela de duração se " +
      "encerra, ele deixa de acompanhar o acordado — e a diferença entre os dois é o " +
      "que explica remuneração caindo sem ninguém ter mexido em salário.",
  },
  {
    chave: "duracao_abono",
    rotulo: "Duração do abono",
    medida: "MESES",
    papel: "QUANTIDADE",
    codigo: OPER("duracao_abono"),
    rubrica: "abono",
    ajuda: "Por quantos meses o abono se aplica. Não é dinheiro: é a janela.",
  },
  {
    chave: "salario_fixo",
    rotulo: "Salário fixo do cargo",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("salario_fixo"),
    rubrica: "subtotais",
    foraDaSoma:
      "Subtotal: piso + adicional noturno + DSR + abono. É o primeiro degrau da cadeia, " +
      "e somá-lo às parcelas que o compõem dobra a folha.",
  },
  {
    chave: "premiacao_produtividade",
    rotulo: "Premiação por produtividade",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("premiacao_produtividade"),
    rubrica: "variavel",
    ajuda:
      "O que o cargo recebe por resultado, ao lado do salário fixo. É a parcela que " +
      "separa o contracheque do salário fixo — nos arquivos recebidos, salário fixo mais " +
      "premiação dá exatamente o contracheque declarado.",
  },
  {
    chave: "remuneracao_variavel",
    rotulo: "Remuneração variável",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("remuneracao_variavel"),
    rubrica: "variavel",
    foraDaSoma:
      "Subtotal: a premiação já acrescida dos encargos que incidem sobre ela — nos " +
      "arquivos recebidos ela é a premiação multiplicada por 1 + o percentual de " +
      "encargo, a menos de centavos. O dicionário não declara a composição, então a " +
      "tela não a confere; o que ela faz é manter a coluna fora de toda soma, porque " +
      "somá-la junto da premiação conta o mesmo prêmio duas vezes.",
  },
  {
    chave: "remuneracao_contra_cheque",
    rotulo: "Remuneração do contracheque",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("remuneracao_contra_cheque"),
    rubrica: "subtotais",
    foraDaSoma:
      "Subtotal: o que a pessoa recebe, antes dos encargos do empregador. O dicionário " +
      "diz que ele é o salário fixo mais “parcelas de folha”, sem nomeá-las — por isso " +
      "esta é a única ligação da cadeia que a tela não confere.",
  },
  {
    chave: "percentual_encargo",
    rotulo: "Percentual de encargos e provisões",
    medida: "PERCENTUAL",
    papel: "PARAMETRO",
    codigo: OPER("percentual_encargo_e_provisao"),
    rubrica: "encargos",
    ajuda: "Alíquota, não montante: quem vira dinheiro é o total de encargo e provisão.",
  },
  {
    chave: "total_encargo_provisao",
    rotulo: "Encargos e provisões",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("total_encargo_provisao"),
    rubrica: "encargos",
    ajuda:
      "Aplicados sobre o salário **já descontado o abono** — o abono não é base de " +
      "encargo, e é essa exclusão que a fórmula registra.",
  },
  {
    chave: "remuneracao_fixa",
    rotulo: "Remuneração fixa",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("remuneracao_fixa"),
    rubrica: "subtotais",
    foraDaSoma:
      "Subtotal: o contracheque acrescido de encargos e provisões — o custo do cargo " +
      "para quem paga, e não o que a pessoa recebe.",
  },
  /*
    As nove parcelas que compõem os benefícios fixos.

    **Elas não são uma rubrica só.** A rubrica é o eixo por onde se lê a tabela
    por assunto — quem pergunta "o que mudou no vale-transporte" não quer as
    outras oito no caminho —, então saúde, refeição, transporte e o resto se
    separam. A conta do subtotal continua somando as nove, porque somar é outro
    eixo: a rubrica diz de que assunto a coluna fala, e a conta diz o que ela
    compõe.
    
    `transporte` é de propósito o mesmo nome da rubrica do administrativo: é a
    mesma pergunta nos dois quadros, e um recorte por assunto que mudasse de
    nome conforme o quadro obrigaria quem lê a traduzir entre os dois.

    Elas chegam em toda linha do export desde o primeiro arquivo, e ficavam fora
    do catálogo — os valores entravam no acervo e não apareciam em tela nenhuma,
    porque a do operacional é só a auditoria e a auditoria só mostra o que uma
    conta usa. Enquanto estiveram de fora, o subtotal que elas compõem era um
    número sem partes: dava para dizer que os benefícios custam R$ 3.159,86 e não
    dava para dizer de quê.

    Duas delas surpreendem e por isso estão anotadas: a **diária** e a **PLR**
    entram no subtotal de benefícios, e não na remuneração. Não é leitura de
    nome — é o que fecha a conta, ver `CONTAS_OPERACIONAL`.
  */
  {
    chave: "assistencia_medica",
    rotulo: "Assistência médica",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("assistencia_medica"),
    rubrica: "saude",
  },
  {
    chave: "cafe_da_manha",
    rotulo: "Café da manhã",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("cafe_da_manha"),
    rubrica: "refeicao",
  },
  {
    chave: "cesta_basica",
    rotulo: "Cesta básica",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("cesta_basica"),
    rubrica: "refeicao",
  },
  {
    chave: "ticket_refeicao_liquido",
    rotulo: "Ticket-refeição, líquido",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("ticket_refeicao_liquido"),
    rubrica: "refeicao",
    ajuda:
      "Líquido: já descontada a parte que o empregado paga. É o custo do empregador, " +
      "que é o que o subtotal de benefícios soma.",
  },
  {
    chave: "vale_transporte_liquido",
    rotulo: "Vale-transporte, líquido",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("vale_transporte_liquido"),
    rubrica: "transporte",
    ajuda:
      "Líquido da coparticipação legal do empregado. **Não é o mesmo caso do " +
      "vale-transporte do quadro administrativo**, onde a dúvida é se ele já está " +
      "dentro da despesa de benefício: aqui a composição do subtotal fecha com ele " +
      "dentro, e a pergunta não se repete.",
  },
  {
    chave: "seguro_de_vida",
    rotulo: "Seguro de vida",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("seguro_de_vida"),
    rubrica: "seguro",
  },
  {
    chave: "pcmso_por_mes",
    rotulo: "PCMSO, por mês",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("pcmso_por_mes"),
    rubrica: "saude",
    ajuda:
      "O Programa de Controle Médico de Saúde Ocupacional — exames admissional, " +
      "periódico e demissional — rateado no custo mensal do cargo. É obrigação de " +
      "saúde ocupacional, e entra no subtotal de benefícios.",
  },
  {
    chave: "diaria",
    rotulo: "Diária",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("diaria"),
    rubrica: "outros_beneficios",
    ajuda:
      "O que o cargo recebe por dia fora da base. Ela varia com o turno — o mesmo " +
      "motorista custa diárias diferentes em 8x16 e em 12x36 —, e **entra no subtotal " +
      "de benefícios**, não na remuneração: é o que fecha a conta dos benefícios fixos.",
  },
  {
    chave: "plr",
    rotulo: "PLR",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("plr"),
    rubrica: "outros_beneficios",
    ajuda:
      "A participação nos lucros e resultados, rateada no mês. Sem natureza salarial, " +
      "e — como a diária — dentro do subtotal de benefícios, não da remuneração.",
  },
  {
    chave: "total_beneficio_fixo",
    rotulo: "Benefícios fixos",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("total_beneficio_fixo"),
    rubrica: "subtotais",
    foraDaSoma:
      "Subtotal: alimentação, saúde, transporte e seguro de vida somados, mais a " +
      "diária e a PLR. Somá-lo às parcelas conta os mesmos benefícios duas vezes.",
  },
  {
    chave: "total_uniforme_epi",
    rotulo: "Uniforme e EPI",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("total_uniforme_epi"),
    rubrica: "epi",
    ajuda:
      "Botina, luva, colete, camisa — rateados no custo mensal do cargo. É obrigação de " +
      "segurança do trabalho, não benefício.",
  },
  {
    chave: "total",
    rotulo: "Custo total do cargo",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("total"),
    rubrica: "subtotais",
    foraDaSoma:
      "Subtotal do topo da cadeia: remuneração fixa + benefícios fixos + uniforme e EPI. " +
      "Somá-lo com qualquer parcela abaixo dobra o custo.",
  },
  {
    chave: "total_da_remuneracao",
    rotulo: "Total da remuneração, sem o abono",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("total_da_remuneracao"),
    rubrica: "subtotais",
    foraDaSoma:
      "Subtotal com o abono **subtraído**. Existe ao lado do de baixo porque o abono " +
      "entra e sai da base em momentos diferentes — os dois nomes quase iguais são essa " +
      "diferença, e não uma duplicidade.",
  },
  {
    chave: "total_remuneracao",
    rotulo: "Total da remuneração, com o abono de volta",
    medida: "DINHEIRO",
    papel: "SUBTOTAL",
    codigo: OPER("total_remuneracao"),
    rubrica: "subtotais",
    foraDaSoma:
      "Subtotal com o abono somado de volta depois dos encargos. A ordem é o conteúdo: " +
      "subtrair antes e somar depois é o que mantém o abono fora da base de encargos e " +
      "dentro do total pago. Trocar um pelo outro muda o custo sem mudar nada visível.",
  },
  {
    chave: "outro",
    rotulo: "Outros",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: OPER("outro"),
    rubrica: "nao_identificado",
    foraDaSoma:
      "Rubrica sem rótulo na origem. Enquanto ninguém disser o que ela recebe, não soma: " +
      "uma coluna sem nome dentro de um total é a forma mais silenciosa de dobrar um " +
      "custo. É pergunta para a Ambev.",
  },
  {
    chave: "quantidade_por_caminhao",
    rotulo: "Fator de profissionais por caminhão",
    medida: "FATOR",
    papel: "QUANTIDADE",
    codigo: OPER("quantidade_por_caminhao"),
    rubrica: "dimensionamento",
    ajuda:
      "Quantos profissionais deste cargo cada caminhão exige. É o fator que transforma o " +
      "custo de uma pessoa no custo de um veículo — sem ele, a folha não vira custo por ativo.",
  },
  {
    chave: "quantidade_total_caminhao_ativo",
    rotulo: "Efetivo total da unidade",
    medida: "QUANTIDADE",
    papel: "QUANTIDADE",
    codigo: OPER("quantidade_totalx_caminhao_ativo"),
    rubrica: "dimensionamento",
    ajuda: "Caminhões ativos multiplicados pelo fator do cargo.",
  },
] as const;

/** O catálogo de um quadro. */
export const VARIAVEIS_DO_QUADRO: Record<QuadroDeQlp, readonly VariavelDoQuadro[]> = {
  ADMINISTRATIVO: VARIAVEIS_ADMINISTRATIVO,
  OPERACIONAL: VARIAVEIS_OPERACIONAL,
};

/** Os códigos que a leitura de um quadro pede. Sem repetição, ordenados. */
export function codigosDoQuadro(quadro: QuadroDeQlp): string[] {
  return [...new Set(VARIAVEIS_DO_QUADRO[quadro].map((v) => v.codigo))].sort();
}

/** A variável de um código, dentro de um quadro. */
export function variavelDoQuadroDoCodigo(
  quadro: QuadroDeQlp,
  codigo: string,
): VariavelDoQuadro | undefined {
  return VARIAVEIS_DO_QUADRO[quadro].find((v) => v.codigo === codigo);
}

// ---------------------------------------------------------------------------
// As contas que o quadro declara sobre si mesmo
// ---------------------------------------------------------------------------

/**
 * Uma conta que a própria tabela declara — e que, por isso, se confere.
 *
 * `PRODUTO` é o trio do administrativo: quantidade × valor = despesa. `SOMA` é
 * cada degrau da cadeia do operacional.
 *
 * `fonte` não é enfeite: é de onde a conta veio. Nenhuma delas foi deduzida da
 * aparência dos nomes — todas estão escritas no dicionário da tabela, e quem ler
 * um veredito de divergência precisa poder conferir contra o que foi declarado.
 */
export interface ContaDoQuadro {
  chave: string;
  rotulo: string;
  forma: "PRODUTO" | "SOMA";
  /** O código da coluna que declara o resultado. */
  resultado: string;
  /** Os códigos que, pela forma, produzem o resultado. */
  parcelas: string[];
  /** O que o dicionário diz, e que autoriza a conta. */
  fonte: string;
}

/** O trio de uma rubrica administrativa: quantidade × valor = despesa. */
function trio(
  chave: string,
  rotulo: string,
  quantidade: string,
  valor: string,
  despesa: string,
): ContaDoQuadro {
  return {
    chave,
    rotulo,
    forma: "PRODUTO",
    resultado: ADM(despesa),
    parcelas: [ADM(quantidade), ADM(valor)],
    fonte:
      "O dicionário do QLP ADM abre declarando a forma da tabela inteira: " +
      "“Quantidade <rubrica> × Valor <rubrica> = Despesa <rubrica>”, para seis rubricas.",
  };
}

/**
 * As contas do quadro administrativo: os seis trios.
 *
 * Nos ordenados e nos encargos o par muda de nome mas não de natureza — o
 * "valor" se chama salário —, e é por isso que o trio é uma função e não uma
 * convenção de sufixo: emparelhar por nome quebraria nas duas rubricas que mais
 * importam.
 */
export const CONTAS_ADMINISTRATIVO: readonly ContaDoQuadro[] = [
  trio("ordenados", "Ordenados", "quantidade_ordenados", "salario_ordenados", "despesa_ordenados"),
  trio("encargos", "Encargos e provisões", "quantidade_encargos", "salario_encargos", "despesa_encargos"),
  trio("beneficio", "Benefícios", "quantidade_beneficio", "valor_beneficio", "despesa_beneficio"),
  trio("frota_leve", "Frota leve", "quantidade_frota_leve", "valor_frota_leve", "despesa_frota_leve"),
  trio("telefonia", "Telefonia", "quantidade_telefonia", "valor_telefonia", "despesa_telefonia"),
  trio("uniformes", "Uniformes", "quantidade_uniformes", "valor_uniformes", "despesa_uniformes"),
] as const;

/**
 * As contas do quadro operacional: a cadeia dos subtotais, e os benefícios.
 *
 * **Três degraus vêm do dicionário e um vem do arquivo**, e a diferença entre
 * os dois está escrita em cada `fonte` de propósito.
 *
 * Os três primeiros o dicionário da tabela de equipe declara. O quarto —
 * `total_beneficio_fixo` — ele **não** declara: diz que a coluna é um subtotal e
 * não nomeia as parcelas. A composição foi medida nos exports recebidos, fecha
 * ao centavo em todas as linhas de todas as vigências, e é a única leitura
 * possível das nove colunas de benefício que o arquivo traz. Ela entra por isso,
 * e entra **dita como medida**: se um export futuro trouxer uma décima parcela,
 * a conta deixa de fechar e a tela diz onde — que é o comportamento certo para
 * uma leitura que não veio da fonte.
 *
 * Um degrau continua fora, e é o que separa as duas coisas: o dicionário
 * descreve `salarioFixo + parcelas de folha → remuneracaoContraCheque`, e
 * "parcelas de folha" não nomeia colunas. Nos arquivos recebidos essa parcela é
 * a premiação por produtividade, e fecha nas 36 linhas — mas uma parcela só que
 * fecha não prova que é *a* regra, e sim que nenhuma outra apareceu ainda.
 * Declarar a conta dos benefícios, onde nove colunas do arquivo não têm outro
 * lugar possível, é diferente de declarar esta, onde a fonte pode ter uma
 * parcela que a unidade de Camaçari não usa.
 */
export const CONTAS_OPERACIONAL: readonly ContaDoQuadro[] = [
  {
    chave: "salario_fixo",
    rotulo: "Salário fixo do cargo",
    forma: "SOMA",
    resultado: OPER("salario_fixo"),
    parcelas: [
      OPER("piso_salarial"),
      OPER("adicional_noturno"),
      OPER("dsr_adicional_noturno"),
      OPER("valor_abono_aplicado"),
    ],
    fonte:
      "O dicionário da tabela de equipe declara: “piso + adicional noturno + DSR + " +
      "abono → salarioFixo”. O abono que entra é o **aplicado**, e não o acordado: é o " +
      "que a vigência de fato pagou.",
  },
  {
    chave: "remuneracao_fixa",
    rotulo: "Remuneração fixa",
    forma: "SOMA",
    resultado: OPER("remuneracao_fixa"),
    parcelas: [OPER("remuneracao_contra_cheque"), OPER("total_encargo_provisao")],
    fonte:
      "“remuneracaoContraCheque + encargos e provisões → remuneracaoFixa”, do dicionário " +
      "da tabela de equipe.",
  },
  {
    chave: "total_beneficio_fixo",
    rotulo: "Benefícios fixos",
    forma: "SOMA",
    resultado: OPER("total_beneficio_fixo"),
    parcelas: [
      OPER("assistencia_medica"),
      OPER("cafe_da_manha"),
      OPER("cesta_basica"),
      OPER("ticket_refeicao_liquido"),
      OPER("vale_transporte_liquido"),
      OPER("seguro_de_vida"),
      OPER("pcmso_por_mes"),
      OPER("diaria"),
      OPER("plr"),
    ],
    fonte:
      "**Medida, e não declarada.** O dicionário da tabela de equipe diz que " +
      "totalBeneficioFixo é subtotal e não nomeia as parcelas. Estas nove são as " +
      "colunas de benefício que o export traz, e a soma delas dá o subtotal declarado " +
      "ao centavo em todas as linhas de todas as vigências recebidas. A diária e a PLR " +
      "entram aqui — é o arquivo que as põe neste subtotal, e não a leitura do nome.",
  },
  {
    chave: "total",
    rotulo: "Custo total do cargo",
    forma: "SOMA",
    resultado: OPER("total"),
    parcelas: [
      OPER("remuneracao_fixa"),
      OPER("total_beneficio_fixo"),
      OPER("total_uniforme_epi"),
    ],
    fonte:
      "“remuneracaoFixa + totalBeneficioFixo + uniforme/EPI → total”, do dicionário da " +
      "tabela de equipe. É o topo da cadeia.",
  },
] as const;

export const CONTAS_DO_QUADRO: Record<QuadroDeQlp, readonly ContaDoQuadro[]> = {
  ADMINISTRATIVO: CONTAS_ADMINISTRATIVO,
  OPERACIONAL: CONTAS_OPERACIONAL,
};

// ---------------------------------------------------------------------------
// A conferência de uma linha
// ---------------------------------------------------------------------------

/** Uma linha do quadro, lida de uma vigência. */
export interface LinhaDoQuadro {
  /** A chave da entidade — normalizada, como o acervo a guarda. */
  chave: string;
  /** O mesmo identificador como se lê, quando a fonte guardou os dois. */
  nome: string | null;
  /** O valor de cada código pedido. Ausência é `null`, nunca zero. */
  valores: Record<string, number | null>;
}

/**
 * Meio por cento de folga entre o declarado e o recalculado.
 *
 * As colunas chegam arredondadas a centavos, e um produto de dois valores
 * arredondados carrega no máximo a soma dos erros relativos dos dois — muito
 * abaixo de meio por cento para qualquer salário ou quantidade realista. A folga
 * continua acusando o que importa: uma despesa montada sobre outra quantidade,
 * um subtotal que esqueceu uma parcela, um trio que trocou o valor unitário pelo
 * salário com encargos.
 */
export const TOLERANCIA_DA_CONTA = 0.005;

/**
 * Um centavo de piso absoluto, para que valores pequenos não gerem falso achado.
 *
 * Meio por cento de R$ 1,20 é menos de um centavo, e uma diferença de
 * arredondamento de um centavo apareceria como divergência numa rubrica de valor
 * baixo. O piso é a menor unidade em que a fonte escreve dinheiro.
 */
export const PISO_DA_CONTA = 0.01;

/** O que a conferência de uma conta, numa linha, revelou. */
export interface ResultadoDaConta {
  conta: string;
  rotulo: string;
  /** `PRODUTO` ou `SOMA` — a forma da conta, que o CSV escreve por extenso. */
  forma: "PRODUTO" | "SOMA";
  /** O que as parcelas produzem. */
  esperado: number | null;
  /** O que a coluna de resultado declara. */
  declarado: number | null;
  /** `declarado − esperado`. */
  diferenca: number | null;
  /** `true` quando fecha, `false` quando diverge, `null` quando falta base. */
  confere: boolean | null;
}

/** A soma ou o produto de uma lista em que um nulo contamina tudo. */
function combinar(
  valores: readonly (number | null)[],
  forma: "PRODUTO" | "SOMA",
): number | null {
  let acumulado = forma === "PRODUTO" ? 1 : 0;
  for (const v of valores) {
    if (v === null) return null;
    acumulado = forma === "PRODUTO" ? acumulado * v : acumulado + v;
  }
  return acumulado;
}

/**
 * A conferência de uma conta numa linha do quadro.
 *
 * **Uma parcela ausente não vira zero**, e aqui isso vale um veredito: uma
 * despesa conferida contra uma quantidade que não veio daria "esperado zero,
 * declarado R$ 48 mil" e acusaria de divergência uma linha que só está
 * incompleta. Falta base é uma resposta, e é diferente de divergir.
 */
export function conferirConta(
  linha: LinhaDoQuadro,
  conta: ContaDoQuadro,
): ResultadoDaConta {
  const esperado = combinar(
    conta.parcelas.map((c) => linha.valores[c] ?? null),
    conta.forma,
  );
  const declarado = linha.valores[conta.resultado] ?? null;

  if (esperado === null || declarado === null) {
    return {
      conta: conta.chave,
      rotulo: conta.rotulo,
      forma: conta.forma,
      esperado: esperado === null ? null : Number(esperado.toFixed(2)),
      declarado,
      diferenca: null,
      confere: null,
    };
  }

  const diferenca = declarado - esperado;
  const limite = Math.max(PISO_DA_CONTA, Math.abs(esperado) * TOLERANCIA_DA_CONTA);
  return {
    conta: conta.chave,
    rotulo: conta.rotulo,
    forma: conta.forma,
    esperado: Number(esperado.toFixed(2)),
    declarado,
    diferenca: Number(diferenca.toFixed(2)),
    confere: Math.abs(diferenca) <= limite,
  };
}

/** O veredito de uma linha inteira do quadro. */
export type VereditoDaLinha = "CONFERE" | "DIVERGE" | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DA_LINHA: Record<VereditoDaLinha, string> = {
  CONFERE: "As contas fecham",
  DIVERGE: "Alguma conta não fecha",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** A leitura completa de uma linha: cada conta e o veredito do conjunto. */
export interface ConferenciaDaLinha {
  chave: string;
  nome: string | null;
  contas: ResultadoDaConta[];
  /** Quantas contas fecharam, divergiram e ficaram sem base. */
  conferem: number;
  divergem: number;
  semBase: number;
  veredito: VereditoDaLinha;
}

/**
 * A conferência de uma linha: todas as contas do quadro.
 *
 * **Divergir decide antes de faltar base**, e é deliberado: uma linha em que
 * cinco contas fecham e uma não é uma linha que diverge, não uma linha
 * incompleta — e chamá-la de incompleta esconderia a única conta que importa
 * ali.
 */
export function conferirLinha(
  linha: LinhaDoQuadro,
  quadro: QuadroDeQlp,
): ConferenciaDaLinha {
  const contas = CONTAS_DO_QUADRO[quadro].map((c) => conferirConta(linha, c));
  const conferem = contas.filter((c) => c.confere === true).length;
  const divergem = contas.filter((c) => c.confere === false).length;
  const semBase = contas.filter((c) => c.confere === null).length;
  return {
    chave: linha.chave,
    nome: linha.nome,
    contas,
    conferem,
    divergem,
    semBase,
    veredito: divergem > 0 ? "DIVERGE" : conferem > 0 ? "CONFERE" : "BASE_INSUFICIENTE",
  };
}

// ---------------------------------------------------------------------------
// As séries da vigência
// ---------------------------------------------------------------------------

/** O que uma conta produziu sobre o quadro inteiro. */
export interface ResumoDaConta {
  conta: string;
  rotulo: string;
  forma: "PRODUTO" | "SOMA";
  fonte: string;
  linhas: number;
  conferem: number;
  divergem: number;
  semBase: number;
  /** A maior diferença observada, em reais, com sinal. */
  maiorDiferenca: number | null;
  /** A soma das diferenças, em reais — o tamanho do que não fecha. */
  somaDasDiferencas: number;
}

/**
 * O que cada conta do quadro produziu, sobre todas as linhas da vigência.
 *
 * Nunca um veredito único do quadro: o que interessa é **quantas** linhas caem
 * em cada leitura. Três cargos com a despesa de telefonia fora da conta, num
 * quadro de duzentas linhas, é uma fila de trabalho — e não um diagnóstico da
 * tabela inteira.
 *
 * `somaDasDiferencas` soma **com sinal**, e não em módulo: duas linhas que erram
 * R$ 500 para lados opostos não são um erro de R$ 1.000 na estrutura, e o que se
 * quer saber aqui é o quanto o quadro declarado se afasta do que ele mesmo
 * calcula.
 */
export function resumoDasContas(
  linhas: readonly LinhaDoQuadro[],
  quadro: QuadroDeQlp,
): ResumoDaConta[] {
  return CONTAS_DO_QUADRO[quadro].map((conta) => {
    let conferem = 0;
    let divergem = 0;
    let semBase = 0;
    let maiorDiferenca: number | null = null;
    let somaDasDiferencas = 0;

    for (const linha of linhas) {
      const r = conferirConta(linha, conta);
      if (r.confere === true) conferem++;
      else if (r.confere === false) divergem++;
      else semBase++;

      if (r.diferenca !== null && r.confere === false) {
        somaDasDiferencas += r.diferenca;
        if (maiorDiferenca === null || Math.abs(r.diferenca) > Math.abs(maiorDiferenca)) {
          maiorDiferenca = r.diferenca;
        }
      }
    }

    return {
      conta: conta.chave,
      rotulo: conta.rotulo,
      forma: conta.forma,
      fonte: conta.fonte,
      linhas: linhas.length,
      conferem,
      divergem,
      semBase,
      maiorDiferenca,
      somaDasDiferencas: Number(somaDasDiferencas.toFixed(2)),
    };
  });
}

/** O quadro contra a régua do benchmark — só o administrativo tem uma. */
export interface ConferenciaDoBenchmark {
  /** Linhas com efetivo e referência declarados. */
  linhas: number;
  acimaDaReferencia: number;
  abaixoDaReferencia: number;
  iguais: number;
  /** A soma das posições acima da referência, com sinal. */
  posicoesDeDiferenca: number;
  /** Linhas em que o salário declarado passa o de referência. */
  salarioAcima: number;
  /** A maior distância entre salário declarado e de referência, em reais. */
  maiorDistanciaDeSalario: number | null;
}

/**
 * O efetivo contra o quadro de referência, e o salário contra o de referência.
 *
 * É a régua da **auditoria bimestral do QLP ADM**, e não uma invenção da tela: o
 * dicionário diz que a diferença entre benchmark e realizado é o que vira não
 * conformidade, e o Book registra a consequência financeira dela no bloco
 * DESCONTO QLP ADM.
 *
 * **A tela não calcula desconto nenhum.** A regra que transforma diferença em
 * dinheiro não está em fonte alguma deste repositório; o que ela mostra é a
 * diferença, que é o insumo dessa conversa.
 */
export function conferirBenchmark(
  linhas: readonly LinhaDoQuadro[],
): ConferenciaDoBenchmark {
  const efetivo = ADM("quantidade_ordenados");
  const referencia = ADM("qlp_benchmark_quantidade");
  const salario = ADM("salario_ordenados");
  const salarioReferencia = ADM("qlp_benchmark_salario");

  const resumo: ConferenciaDoBenchmark = {
    linhas: 0,
    acimaDaReferencia: 0,
    abaixoDaReferencia: 0,
    iguais: 0,
    posicoesDeDiferenca: 0,
    salarioAcima: 0,
    maiorDistanciaDeSalario: null,
  };

  for (const linha of linhas) {
    const tem = linha.valores[efetivo] ?? null;
    const prevê = linha.valores[referencia] ?? null;
    if (tem !== null && prevê !== null) {
      resumo.linhas += 1;
      const diferenca = tem - prevê;
      resumo.posicoesDeDiferenca += diferenca;
      if (diferenca > 0) resumo.acimaDaReferencia += 1;
      else if (diferenca < 0) resumo.abaixoDaReferencia += 1;
      else resumo.iguais += 1;
    }

    const pago = linha.valores[salario] ?? null;
    const referido = linha.valores[salarioReferencia] ?? null;
    if (pago !== null && referido !== null) {
      if (pago > referido) resumo.salarioAcima += 1;
      const distancia = pago - referido;
      if (
        resumo.maiorDistanciaDeSalario === null ||
        Math.abs(distancia) > Math.abs(resumo.maiorDistanciaDeSalario)
      ) {
        resumo.maiorDistanciaDeSalario = Number(distancia.toFixed(2));
      }
    }
  }

  resumo.posicoesDeDiferenca = Number(resumo.posicoesDeDiferenca.toFixed(4));
  return resumo;
}

/** O abono acordado contra o abono aplicado — só o operacional o tem. */
export interface ConferenciaDoAbono {
  /** Linhas com abono acordado maior que zero. */
  comAbono: number;
  /** Linhas em que o aplicado é menor que o acordado. */
  aplicadoMenor: number;
  /** Linhas em que a janela parece encerrada: acordado maior que zero, aplicado zero. */
  janelaEncerrada: number;
  /** A soma do que foi acordado e não aplicado, em reais. */
  naoAplicado: number;
}

/**
 * O abono acordado contra o aplicado — a queda que ninguém negociou.
 *
 * O dicionário da tabela de equipe explica por que estas duas colunas existem:
 * *"quando a janela do abono se encerra, `valorAbonoAplicado` deixa de
 * acompanhar `valorAbono` e o total cai sozinho. É o tipo de movimento que, sem
 * estas duas colunas à vista, vira um chamado procurando erro onde há regra."*
 *
 * Esta série é essa leitura: quantos cargos têm abono acordado, em quantos ele
 * já não é aplicado por inteiro, e quanto dinheiro está nessa diferença. É
 * **regra, não achado** — e é justamente por isso que ela precisa estar visível:
 * para que a queda no total não seja investigada como erro.
 */
export function conferirAbono(linhas: readonly LinhaDoQuadro[]): ConferenciaDoAbono {
  const acordado = OPER("valor_abono");
  const aplicado = OPER("valor_abono_aplicado");

  const resumo: ConferenciaDoAbono = {
    comAbono: 0,
    aplicadoMenor: 0,
    janelaEncerrada: 0,
    naoAplicado: 0,
  };

  for (const linha of linhas) {
    const a = linha.valores[acordado] ?? null;
    const b = linha.valores[aplicado] ?? null;
    if (a === null || a <= 0) continue;
    resumo.comAbono += 1;
    if (b === null) continue;
    if (b < a) {
      resumo.aplicadoMenor += 1;
      resumo.naoAplicado += a - b;
      if (b === 0) resumo.janelaEncerrada += 1;
    }
  }

  resumo.naoAplicado = Number(resumo.naoAplicado.toFixed(2));
  return resumo;
}

/** Os indicadores do topo da tela. */
export interface ResumoDoQuadro {
  quadro: QuadroDeQlp;
  /** Linhas — cargos, não pessoas. */
  cargos: number;
  /** Cargos cujas contas todas fecham. */
  conferem: number;
  /** Cargos com ao menos uma conta que não fecha. */
  divergem: number;
  /** Cargos sem base para conferir conta nenhuma. */
  semBase: number;
  /** A soma do efetivo declarado, quando o quadro o traz. */
  efetivo: number | null;
  /** Quantas colunas do catálogo ficam fora de toda soma, e por quê. */
  foraDaSoma: number;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * **`cargos` conta linhas, e `efetivo` soma quantidades** — e a distinção é a
 * primeira coisa que o dicionário do QLP ADM ensina: cada linha é um cargo, não
 * uma pessoa. Um quadro de 30 cargos pode remunerar 96 posições, e trocar um
 * número pelo outro é o erro mais fácil de cometer nesta tela.
 *
 * O efetivo é a **única** soma que esta tela faz, e ela é de gente, não de
 * dinheiro: somar quantidade não depende de curadoria de semântica monetária.
 * Custo da estrutura continua travado, como na tela do quadro — e pelo mesmo
 * motivo.
 */
export function resumirQuadro(
  linhas: readonly LinhaDoQuadro[],
  quadro: QuadroDeQlp,
): ResumoDoQuadro {
  let conferem = 0;
  let divergem = 0;
  let semBase = 0;

  for (const linha of linhas) {
    const c = conferirLinha(linha, quadro);
    if (c.veredito === "CONFERE") conferem++;
    else if (c.veredito === "DIVERGE") divergem++;
    else semBase++;
  }

  const codigoDoEfetivo =
    quadro === "ADMINISTRATIVO"
      ? ADM("quantidade_ordenados")
      : OPER("quantidade_totalx_caminhao_ativo");
  let efetivo: number | null = null;
  for (const linha of linhas) {
    const v = linha.valores[codigoDoEfetivo] ?? null;
    if (v === null) continue;
    efetivo = (efetivo ?? 0) + v;
  }

  return {
    quadro,
    cargos: linhas.length,
    conferem,
    divergem,
    semBase,
    efetivo: efetivo === null ? null : Number(efetivo.toFixed(4)),
    foraDaSoma: VARIAVEIS_DO_QUADRO[quadro].filter((v) => v.foraDaSoma).length,
  };
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/**
 * A identidade de uma linha do quadro, repartida como a chave legível a traz.
 *
 * A chave legível é a emenda das colunas de identidade do tipo, na ordem em que
 * elas compõem a chave (`lib/ingest/src/tipos.ts`): unidade + cargo no
 * administrativo, unidade + cargo + turno no operacional. Repartir aqui — e não
 * na tela — é o que deixa a tabela e o CSV usarem a **mesma** regra: um arquivo
 * exportado com uma divisão e uma tela com outra seriam duas verdades sobre a
 * mesma linha.
 *
 * Um quarto pedaço (um tipo novo, ou uma versão da chave com mais colunas) fica
 * junto do turno em vez de sumir: esconder parte da identidade é pior do que
 * escrevê-la sem nome próprio. E a chave **normalizada** nunca se reparte: ela é
 * uma coisa só, o que o resto do produto usa para se referir à linha.
 */
export function partesDaChaveLegivel(legivel: string): {
  unidade: string;
  cargo: string;
  turno: string;
} {
  const partes = legivel.split(" · ");
  if (partes.length === 1) return { unidade: "", cargo: legivel, turno: "" };
  return { unidade: partes[0], cargo: partes[1], turno: partes.slice(2).join(" · ") };
}

/** As colunas do CSV que valem para qualquer quadro. */
const COLUNAS_FIXAS_DO_CSV_DE_QLP = [
  "Chave",
  "Conta",
  "Forma",
  "Esperado",
  "Declarado",
  "Diferença",
  "Leitura",
] as const;

/** Quais colunas de identidade este recorte tem para escrever. */
export interface FormatoDoCsvDeQlp {
  comUnidade: boolean;
  comTurno: boolean;
}

/**
 * O cabeçalho do CSV, decidido pelas linhas que ele vai escrever.
 *
 * Unidade e turno só entram quando alguma linha os traz. O QLP Administrativo
 * não tem turno, e uma coluna "Turno" vazia em toda linha convidaria quem abre a
 * planilha a procurar o dado que falta — quando o que existe é um quadro cuja
 * identidade tem duas partes, e não três.
 */
export function formatoDoCsvDeQlp(
  linhas: readonly ConferenciaDaLinha[],
): FormatoDoCsvDeQlp {
  const partes = linhas.map((l) => partesDaChaveLegivel(l.nome ?? l.chave));
  return {
    comUnidade: partes.some((p) => p.unidade !== ""),
    comTurno: partes.some((p) => p.turno !== ""),
  };
}

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export function colunasDoCsvDeQlp(formato: FormatoDoCsvDeQlp): string[] {
  return [
    ...(formato.comUnidade ? ["Unidade"] : []),
    "Cargo",
    ...(formato.comTurno ? ["Turno"] : []),
    ...COLUNAS_FIXAS_DO_CSV_DE_QLP,
  ];
}

/** Como o CSV escreve o veredito de cada conta, por extenso. */
function leituraNoCsv(confere: boolean | null): string {
  if (confere === null) return "Base insuficiente";
  return confere ? "Fecha" : "Não fecha";
}

/**
 * A conferência de uma linha como as linhas do CSV — uma por conta.
 *
 * Uma linha de arquivo por **conta**, e não por cargo, porque é a conta que tem
 * veredito. Um CSV com uma linha por cargo teria de espremer seis vereditos numa
 * célula, e ninguém filtra uma planilha por texto concatenado.
 */
export function celulasDoCsvDeQlp(
  conferencia: ConferenciaDaLinha,
  formato: FormatoDoCsvDeQlp,
): (string | number | null)[][] {
  /*
    A identidade em colunas, e a chave inteira ao lado.

    O CSV escreve o valor **como o arquivo o trouxe**, prefixo e tudo: a planilha
    exportada é evidência do que foi importado, e é por ela que se confere a
    origem. Quem aparou o `Cargo:` foi a tela, que é onde o prefixo atrapalha a
    leitura — e lá ele não muda nem o dado nem a chave.
  */
  const { unidade, cargo, turno } = partesDaChaveLegivel(
    conferencia.nome ?? conferencia.chave,
  );
  return conferencia.contas.map((c) => [
    ...(formato.comUnidade ? [unidade] : []),
    cargo,
    ...(formato.comTurno ? [turno] : []),
    conferencia.chave,
    c.rotulo,
    c.forma === "PRODUTO" ? "quantidade × valor" : "soma das parcelas",
    c.esperado,
    c.declarado,
    c.diferenca,
    leituraNoCsv(c.confere),
  ]);
}
