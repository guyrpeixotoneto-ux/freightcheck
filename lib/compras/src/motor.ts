/**
 * O MOTOR ECONÔMICO DA COMPRA — o sistema calcula, a IA interpreta.
 *
 * Este arquivo é a metade que **calcula**. Ele não fala com modelo nenhum, não
 * consulta banco, não lê pergunta em português: recebe a remuneração que a
 * Ambev paga por um item, as premissas da compra e a política vigente, e
 * devolve os números — preço-alvo, teto, diferenças, margens e impacto.
 *
 * A separação é a regra central do Agente de Compras, e existe por um motivo
 * que este produto inteiro repete: **um preço de compra sugerido por raciocínio
 * de modelo tem a mesma fluência de quando acerta.** Quem leva um preço-alvo
 * para a mesa de negociação precisa poder abrir a conta até a célula da
 * planilha que a sustenta. Por isso o preço-alvo nasce aqui, de uma
 * multiplicação que cabe em uma linha, e o agente só o explica.
 *
 * **Três coisas que este motor se recusa a fazer:**
 *
 * 1. **Somar gavetas diferentes.** Um valor mensal e um de aquisição não viram
 *    um número só — a mesma regra que `matriz.ts` aplica à coluna. A conversão
 *    de gaveta para valor por unidade é explícita e declara a premissa que
 *    usou; sem essa premissa ela não acontece.
 * 2. **Completar o que falta.** Sem remuneração apurada não há preço-alvo.
 *    Sem quantidade não há impacto pela quantidade. Cada número ausente sai
 *    como `null` com o motivo, e não como zero.
 * 3. **Esconder o que é premissa.** Vida útil e unidades por ativo quase nunca
 *    estão no export. Quando entram por padrão do catálogo, entram marcadas
 *    como ESTIMADO, e a confiabilidade da avaliação inteira cai por causa
 *    disso. Ver {@link DadoDaAvaliacao} e {@link Confiabilidade}.
 *
 * **A política não é um número inventado, é uma configuração declarada.** A
 * margem-alvo e a margem mínima dizem quanto da remuneração a operação quer
 * preservar; elas são escolha de quem opera, não descoberta deste código. O
 * padrão está em {@link POLITICA_PADRAO}, com a justificativa de cada valor, e
 * toda avaliação carrega de volta a política que usou — é o que permite à tela
 * escrever "limite econômico configurado" em vez de "limite econômico", que
 * seria uma afirmação sobre o mundo.
 */

import type { Gaveta } from "@workspace/composition";
import { produtoDe, type ProdutoDeCompra } from "./catalogo";

// ---------------------------------------------------------------------------
// Política
// ---------------------------------------------------------------------------

/**
 * Quanto da remuneração a operação quer preservar ao comprar.
 *
 * Duas margens, e a distância entre elas é a faixa de negociação:
 *
 * - **`margemAlvo`** é a meta — o preço com que se entra na conversa.
 * - **`margemMinima`** é o teto — o preço acima do qual a compra passa a
 *   consumir a remuneração em vez de caber dentro dela.
 *
 * As duas são frações de 0 a 1 sobre o valor econômico por unidade. Não há
 * padrão "certo" aqui: é decisão comercial, e é por isso que ela viaja em todo
 * resultado e aparece na tela com a palavra *configurado*.
 */
export interface PoliticaDeCompra {
  margemAlvo: number;
  margemMinima: number;
}

/**
 * O padrão, e o que cada número quer dizer.
 *
 * `margemAlvo` 0,12 e `margemMinima` 0,05: entra-se pedindo 12% abaixo do que a
 * remuneração cobre e recusa-se acima de 95% dela. Os dois são pontos de
 * partida conservadores para uma operação que ainda não configurou os seus —
 * **não** são um benchmark de mercado, e este comentário existe para que
 * ninguém os cite como um.
 *
 * `COMPRAS_MARGEM_ALVO` e `COMPRAS_MARGEM_MINIMA` trocam os dois sem deploy.
 * Valor fora de (0,1) é ignorado: uma margem de 120% produziria preço-alvo
 * negativo, e um teto negativo reprovaria toda compra com cara de conta.
 */
export const POLITICA_PADRAO: PoliticaDeCompra = {
  margemAlvo: fracaoDoAmbiente(process.env.COMPRAS_MARGEM_ALVO, 0.12),
  margemMinima: fracaoDoAmbiente(process.env.COMPRAS_MARGEM_MINIMA, 0.05),
};

function fracaoDoAmbiente(bruto: string | undefined, padrao: number): number {
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : padrao;
}

/** A política pedida, com o padrão preenchendo o que não veio, e sem inversão. */
export function politicaDe(
  pedida?: Partial<PoliticaDeCompra>,
): PoliticaDeCompra {
  const margemAlvo =
    fracaoValida(pedida?.margemAlvo) ?? POLITICA_PADRAO.margemAlvo;
  const margemMinima =
    fracaoValida(pedida?.margemMinima) ?? POLITICA_PADRAO.margemMinima;
  /*
    Alvo abaixo do teto é o desenho: a meta é mais ambiciosa que o limite. Se
    chegarem trocados, o menor vira o teto — recusar o pedido deixaria a tela
    sem resposta, e obedecer ao avesso produziria um "alvo" acima do "teto",
    que é a única combinação capaz de fazer a mesma compra ser aprovada e
    reprovada na mesma frase.
  */
  return margemAlvo >= margemMinima
    ? { margemAlvo, margemMinima }
    : { margemAlvo: margemMinima, margemMinima: margemAlvo };
}

function fracaoValida(n: number | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1
    ? n
    : null;
}

// ---------------------------------------------------------------------------
// O que entra
// ---------------------------------------------------------------------------

/**
 * De onde saiu um número, e se ele é confirmado ou estimado.
 *
 * Todo dado que entra na conta carrega isto, e é o que a resposta mostra sob
 * "quais dados são confirmados / quais são estimados". Sem este par a avaliação
 * seria uma lista de reais com a mesma cara — o preço da nota e a vida útil
 * chutada lado a lado, indistinguíveis.
 */
export interface DadoDaAvaliacao {
  chave: string;
  rotulo: string;
  valor: number | null;
  unidade: string;
  /** Verdadeiro quando o número veio do acervo ou de quem perguntou. */
  confirmado: boolean;
  /** Onde conferir — nome da coluna, vigência, premissa do catálogo. */
  fonte: string;
}

/**
 * A remuneração que sustenta a compra: o que a Ambev paga pelo item.
 *
 * Vem do balcão (`frota.ts`) ou da matriz (`matriz.ts`) — nunca daqui. Este
 * motor não sabe consultar remuneração, e é de propósito: existisse aqui um
 * segundo caminho até o remunerado, o preço-alvo divergiria da tela Remunerado
 * e a mesa de negociação usaria um número que a auditoria não reconhece.
 */
export interface BaseRemunerada {
  /** O valor apurado, em reais. Nulo quando a vigência não o traz. */
  valor: number | null;
  gaveta: Gaveta | null;
  /** "por veículo", "por cargo", "na frota" — o que aquele valor cobre. */
  escopo: string;
  /** A coluna do export, ou a leitura que devolveu o valor. */
  fonte: string;
  /** A vigência a que o valor pertence. */
  vigencia: string;
  /** A ressalva do catálogo, quando o produto tem uma. */
  ressalva: string | null;
  /**
   * Verdadeiro quando o valor **já é** o de uma unidade comprada.
   *
   * É o caso do QLP administrativo, em que o export declara o valor unitário
   * do uniforme e do aparelho — não um fluxo mensal por cargo. Ali não há
   * conversão a fazer, e não há premissa a estimar: o valor econômico da
   * unidade é o próprio número da fonte, e a avaliação sai com confiabilidade
   * ALTA porque nada nela foi chutado.
   *
   * Falso é o caso da frota, em que a fonte entrega um fluxo — R$/mês por
   * veículo — e chegar ao preço de um pneu exige saber quantos pneus o veículo
   * usa e por quantos meses. São essas duas premissas que derrubam a nota.
   */
  porUnidade?: boolean;
}

/**
 * As premissas da compra — o que vem do pedido, e não do acervo.
 *
 * Nenhuma é obrigatória, e a avaliação degrada campo a campo: sem
 * `precoUnitario` não há diferença para o alvo, sem `quantidade` não há impacto
 * pela quantidade, sem `vidaUtilMeses` não há conversão de mensal para unidade.
 * O que não se faz é preencher a falta com um número plausível.
 */
export interface PremissasDaCompra {
  /** O preço da cotação em análise, por unidade. */
  precoUnitario?: number | null;
  /** Quantas unidades o pedido compra. */
  quantidade?: number | null;
  /** O que se pagou da última vez, por unidade. */
  precoHistorico?: number | null;
  /** Quantos meses a unidade dura — o que converte remuneração mensal em preço. */
  vidaUtilMeses?: number | null;
  /** Quantas unidades o ativo consome por ciclo — seis pneus num cavalo. */
  unidadesPorAtivo?: number | null;
  /** Quantos ativos a compra atende, quando a base é por veículo. */
  ativos?: number | null;
  /** O fornecedor da cotação, quando declarado. */
  fornecedor?: string | null;
  /**
   * De onde vieram a vida útil e as unidades, quando não foi do pedido.
   *
   * O motor não sabe consultar `compra_premissa`: quem resolve as três camadas
   * — o que a pergunta informou, o que a operação configurou, o que o catálogo
   * estima — é `premissasDoItem`, no dossiê. O que ele precisa saber é **como
   * escrever a procedência**, e escrever "informada no pedido" para um número
   * que veio da configuração da casa é dizer a coisa errada num campo cujo
   * único trabalho é dizer de onde o número veio.
   */
  fonteDasPremissas?: { vidaUtil?: string; unidades?: string };
}

/**
 * As premissas que o catálogo oferece quando o pedido não as traz.
 *
 * **São estimativas, e o tipo não deixa esquecer:** tudo o que sai daqui entra
 * na avaliação com `confirmado: false` e derruba a confiabilidade. Elas existem
 * porque a alternativa — recusar-se a responder sem vida útil — deixaria o
 * comprador sem nenhuma referência justamente no item em que o export não traz
 * a informação. Uma ordem de grandeza declarada como estimativa é melhor do que
 * silêncio, e é pior do que um dado; a tela mostra qual dos dois está lendo.
 *
 * `porque` não é enfeite: é o que a resposta cita quando lista as premissas.
 */
export interface PremissaPadrao {
  vidaUtilMeses: number;
  unidadesPorAtivo: number;
  porque: string;
}

export const PREMISSA_DO_PRODUTO: Record<string, PremissaPadrao> = {
  pneu: {
    vidaUtilMeses: 18,
    unidadesPorAtivo: 6,
    porque:
      "Estimativa de operação: um jogo de seis pneus no cavalo, trocado a cada dezoito " +
      "meses. O export não traz vida útil nem quantidade de pneus por ativo — traz a " +
      "medida do pneu. Configure a vida útil real do seu ciclo para o número deixar de " +
      "ser estimativa.",
  },
  /*
    Contrato e aluguel se compram **por mês**, e é por isso que a vida útil
    deles é 1 e não 12. A fonte remunera um valor mensal por veículo e a
    proposta do fornecedor também é mensal: multiplicar por doze produziria um
    teto doze vezes maior que o certo, e a compra mais cara da carteira passaria
    folgada.
  */
  "manutencao-contrato": {
    vidaUtilMeses: 1,
    unidadesPorAtivo: 1,
    porque:
      "Estimativa de operação: a unidade comprada é um mês de contrato, por veículo — " +
      "que é como a fonte remunera e como o fornecedor cota. Informe outra vida útil se " +
      "a sua proposta for por período diferente.",
  },
  aluguel: {
    vidaUtilMeses: 1,
    unidadesPorAtivo: 1,
    porque:
      "Estimativa de operação: a unidade comprada é um mês de locação, por veículo. " +
      "Informe outra vida útil se a proposta cobrir um período diferente.",
  },
  /*
    IPVA e seguro se pagam por ano e por veículo — a guia e a apólice são o
    documento inteiro. Com a fonte entregando o valor anual, doze meses de vida
    útil devolvem exatamente esse valor por unidade.
  */
  "ipva-licenciamento": {
    vidaUtilMeses: 12,
    unidadesPorAtivo: 1,
    porque:
      "Estimativa de operação: uma guia por ano e por veículo. É o ciclo do documento, " +
      "não uma escolha nossa; informe outro se a sua operação parcelar diferente.",
  },
  seguro: {
    vidaUtilMeses: 12,
    unidadesPorAtivo: 1,
    porque:
      "Estimativa de operação: uma apólice por ano e por veículo. Informe outra vigência " +
      "se a sua apólice cobrir período diferente.",
  },
  aquisicao: {
    vidaUtilMeses: 1,
    unidadesPorAtivo: 1,
    porque:
      "A unidade comprada é o próprio veículo. O valor de aquisição não é fluxo, então a " +
      "vida útil não entra na conta — ver `valorEconomicoDaUnidade`.",
  },
  /*
    Três produtos da frota **não** têm premissa padrão, e a ausência é a
    resposta certa para cada um:

    - **combustível** e **manutenção avulsa** não têm valor monetário na fonte
      (ressalva de catálogo: parâmetro, não gasto; razão sem base). Uma premissa
      aqui daria vida útil a um número que não existe.
    - **financiamento** é parcela, não compra: o que a fonte remunera é o
      encargo mensal do ativo, e não há "preço por unidade" de uma parcela que
      se possa negociar com um fornecedor. Quem quiser avaliar a compra do
      veículo pergunta por *aquisição*.

    O QLP administrativo também não aparece aqui: ali a fonte declara o valor
    **unitário**, a base sai com `porUnidade` e nenhuma premissa entra na conta.
  */
};

// ---------------------------------------------------------------------------
// O que sai
// ---------------------------------------------------------------------------

/**
 * Por que a avaliação não chegou a um preço-alvo.
 *
 * Vocabulário fechado, como `MotivoDaCelulaVazia` na matriz: a tela precisa
 * pintar cada vazio de um jeito, e frases escritas à mão em cada resposta não
 * se agrupam nem se contam.
 */
export type MotivoSemAlvo =
  /** A vigência não traz valor apurado para este produto. */
  | "SEM_REMUNERACAO"
  /** O valor existe e não é mensal, anual nem de aquisição — não há como converter. */
  | "SEM_GAVETA"
  /** A base é mensal e ninguém informou por quantos meses a unidade dura. */
  | "SEM_VIDA_UTIL"
  /** Não se sabe quantas unidades o ativo consome — não há "por unidade". */
  | "SEM_UNIDADES";

export const ROTULO_SEM_ALVO: Record<MotivoSemAlvo, string> = {
  SEM_REMUNERACAO: "Sem remuneração apurada nesta vigência",
  SEM_GAVETA: "Periodicidade não confirmada",
  SEM_VIDA_UTIL: "Vida útil não informada",
  SEM_UNIDADES: "Unidades por ativo não informadas",
};

/**
 * Quanto se pode confiar no preço-alvo desta avaliação.
 *
 * Não é uma nota de qualidade do fornecedor nem uma probabilidade: é **quantas
 * das premissas da conta foram confirmadas**. ALTA quer dizer que o número saiu
 * inteiro do acervo e do pedido; BAIXA quer dizer que a maior parte dele veio
 * de estimativa do catálogo, e que a negociação deve tratá-lo como ordem de
 * grandeza.
 */
export type Confiabilidade = "ALTA" | "MEDIA" | "BAIXA";

export const ROTULO_DA_CONFIABILIDADE: Record<Confiabilidade, string> = {
  ALTA: "Alta — todos os dados da conta são confirmados",
  MEDIA: "Média — parte da conta usa premissa estimada",
  BAIXA: "Baixa — a conta depende de premissas estimadas",
};

/** O veredito sobre a cotação, quando há cotação. */
export type Veredito =
  /** Está no alvo ou abaixo dele. */
  | "NO_ALVO"
  /** Passou do alvo e cabe no teto — há o que negociar, e a compra fecha. */
  | "ENTRE_ALVO_E_TETO"
  /** Passou do teto: a compra consome remuneração que não existe. */
  | "ACIMA_DO_TETO";

export const ROTULO_DO_VEREDITO: Record<Veredito, string> = {
  NO_ALVO: "No alvo",
  ENTRE_ALVO_E_TETO: "Dentro do teto, acima da meta",
  ACIMA_DO_TETO: "Acima do teto econômico",
};

/** O resultado do motor: os conceitos, todos, com o que faltou marcado. */
export interface AvaliacaoDeCompra {
  produto: ProdutoDeCompra | null;
  /** A chave do produto do catálogo, mesmo quando ele não está catalogado. */
  chave: string;
  base: BaseRemunerada;
  politica: PoliticaDeCompra;
  premissas: PremissasDaCompra;

  /** O que a Ambev paga, como a fonte o entrega. */
  valorRemunerado: number | null;
  /** O mesmo valor levado à unidade que se compra. Nulo quando falta premissa. */
  valorEconomicoUnitario: number | null;
  /** Por que não há valor por unidade, quando não há. */
  semAlvo: MotivoSemAlvo | null;

  precoHistorico: number | null;
  precoCotado: number | null;
  precoAlvo: number | null;
  precoTeto: number | null;

  /** Cotação menos alvo. Positivo é o quanto está acima da meta. */
  diferencaParaAlvo: number | null;
  /** Cotação menos teto. Positivo é o quanto estoura o limite. */
  diferencaParaTeto: number | null;

  /** Valor econômico menos preço cotado, por unidade. */
  margemAbsoluta: number | null;
  /** A mesma margem como fração do valor econômico. */
  margemPercentual: number | null;

  /** A diferença para o teto multiplicada pela quantidade do pedido. */
  impactoPelaQuantidade: number | null;
  /** O mesmo impacto diluído na vida útil — quanto pesa por mês. */
  impactoMensal: number | null;
  /** Doze meses de impacto mensal. */
  impactoAnual: number | null;

  veredito: Veredito | null;
  confiabilidade: Confiabilidade;
  /** Todo número que entrou, com fonte e se é confirmado. */
  dados: DadoDaAvaliacao[];
  /** O que falta para a avaliação ficar inteira. Vazio quando não falta nada. */
  lacunas: string[];
}

// ---------------------------------------------------------------------------
// A conta
// ---------------------------------------------------------------------------

/**
 * De um valor remunerado e uma gaveta para o valor econômico de uma unidade.
 *
 * É aqui que mora a única conversão de periodicidade do motor, e ela é
 * explícita porque é a que mais facilmente viraria um erro invisível:
 *
 * - **AQUISIÇÃO** — o valor já é do bem. Divide-se pelas unidades e pronto;
 *   vida útil não entra, porque a remuneração não é um fluxo.
 * - **MENSAL** — o valor é por mês. O que a unidade "vale" é o que ela custa a
 *   remuneração enquanto dura: `mensal × vidaUtilMeses ÷ unidades`.
 * - **ANUAL** — o mesmo, com o ano dividido por doze antes.
 *
 * Sem vida útil, o mensal e o anual **não** viram preço. Multiplicar por doze
 * "porque é o usual" produziria um teto com cara de conta apoiado num número
 * que ninguém escolheu.
 */
export function valorEconomicoDaUnidade(
  base: BaseRemunerada,
  premissas: { vidaUtilMeses: number | null; unidadesPorAtivo: number | null },
): { valor: number | null; semAlvo: MotivoSemAlvo | null } {
  if (base.valor === null) return { valor: null, semAlvo: "SEM_REMUNERACAO" };
  /*
    O valor que já é de uma unidade não passa por conversão nenhuma — nem de
    gaveta, nem de vida útil. Exigir gaveta aqui recusaria preço-alvo para o
    uniforme, que é justamente o item em que a fonte entrega a resposta pronta.
  */
  if (base.porUnidade === true) return { valor: base.valor, semAlvo: null };
  if (base.gaveta === null) return { valor: null, semAlvo: "SEM_GAVETA" };

  const unidades = premissas.unidadesPorAtivo;
  if (unidades === null || unidades <= 0)
    return { valor: null, semAlvo: "SEM_UNIDADES" };

  if (base.gaveta === "AQUISICAO") {
    return { valor: base.valor / unidades, semAlvo: null };
  }

  const vida = premissas.vidaUtilMeses;
  if (vida === null || vida <= 0)
    return { valor: null, semAlvo: "SEM_VIDA_UTIL" };

  const mensal = base.gaveta === "ANUAL" ? base.valor / 12 : base.valor;
  return { valor: (mensal * vida) / unidades, semAlvo: null };
}

/**
 * A avaliação inteira de um item.
 *
 * Função pura: mesmos argumentos, mesmo resultado, sem banco e sem relógio. É o
 * que permite testá-la com números escritos à mão e é o que garante que a mesma
 * pergunta feita duas vezes devolva o mesmo preço-alvo — coisa que um preço
 * redigido por modelo não garante.
 */
export function avaliarCompra(
  chave: string,
  base: BaseRemunerada,
  pedidas: PremissasDaCompra = {},
  politicaPedida?: Partial<PoliticaDeCompra>,
): AvaliacaoDeCompra {
  const produto = produtoDe(chave) ?? null;
  const politica = politicaDe(politicaPedida);
  const padrao = PREMISSA_DO_PRODUTO[chave];

  const positivo = (n: number | null | undefined): number | null =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

  const vidaInformada = positivo(pedidas.vidaUtilMeses);
  const unidadesInformadas = positivo(pedidas.unidadesPorAtivo);
  const vidaUtilMeses = vidaInformada ?? padrao?.vidaUtilMeses ?? null;
  const unidadesPorAtivo =
    unidadesInformadas ?? padrao?.unidadesPorAtivo ?? null;

  const precoCotado = positivo(pedidas.precoUnitario);
  const quantidade = positivo(pedidas.quantidade);
  const precoHistorico = positivo(pedidas.precoHistorico);

  const { valor: valorEconomicoUnitario, semAlvo } = valorEconomicoDaUnidade(
    base,
    {
      vidaUtilMeses,
      unidadesPorAtivo,
    },
  );

  const precoAlvo =
    valorEconomicoUnitario === null
      ? null
      : valorEconomicoUnitario * (1 - politica.margemAlvo);
  const precoTeto =
    valorEconomicoUnitario === null
      ? null
      : valorEconomicoUnitario * (1 - politica.margemMinima);

  const diferencaParaAlvo =
    precoCotado !== null && precoAlvo !== null ? precoCotado - precoAlvo : null;
  const diferencaParaTeto =
    precoCotado !== null && precoTeto !== null ? precoCotado - precoTeto : null;

  const margemAbsoluta =
    precoCotado !== null && valorEconomicoUnitario !== null
      ? valorEconomicoUnitario - precoCotado
      : null;
  const margemPercentual =
    margemAbsoluta !== null &&
    valorEconomicoUnitario !== null &&
    valorEconomicoUnitario > 0
      ? margemAbsoluta / valorEconomicoUnitario
      : null;

  /*
    O impacto é medido contra o **teto**, e não contra o alvo, porque é o teto
    que define destruição de margem: entre o alvo e o teto a compra ainda cabe
    na remuneração, e chamar aquela diferença de "impacto" transformaria uma
    meta de negociação não atingida numa perda contábil.
  */
  const impactoPelaQuantidade =
    diferencaParaTeto !== null && quantidade !== null
      ? diferencaParaTeto * quantidade
      : null;
  const impactoMensal =
    impactoPelaQuantidade !== null &&
    vidaUtilMeses !== null &&
    vidaUtilMeses > 0
      ? impactoPelaQuantidade / vidaUtilMeses
      : null;
  const impactoAnual = impactoMensal !== null ? impactoMensal * 12 : null;

  const veredito: Veredito | null =
    precoCotado === null || precoAlvo === null || precoTeto === null
      ? null
      : precoCotado <= precoAlvo
        ? "NO_ALVO"
        : precoCotado <= precoTeto
          ? "ENTRE_ALVO_E_TETO"
          : "ACIMA_DO_TETO";

  // ---- a procedência de cada número --------------------------------------
  const dados: DadoDaAvaliacao[] = [
    {
      chave: "valorRemunerado",
      rotulo: `Valor remunerado (${base.escopo})`,
      valor: base.valor,
      unidade: "BRL",
      confirmado: base.valor !== null,
      fonte: `${base.fonte} — vigência ${base.vigencia}`,
    },
    {
      chave: "vidaUtilMeses",
      rotulo: "Vida útil",
      valor: vidaUtilMeses,
      unidade: "meses",
      confirmado: base.porUnidade === true || vidaInformada !== null,
      fonte:
        base.porUnidade === true
          ? "Não entra na conta: a fonte já declara o valor por unidade."
          : vidaInformada !== null
            ? (pedidas.fonteDasPremissas?.vidaUtil ?? "Informada no pedido")
            : (padrao?.porque ?? "Não informada e sem premissa de catálogo"),
    },
    {
      chave: "unidadesPorAtivo",
      rotulo: "Unidades por ativo",
      valor: unidadesPorAtivo,
      unidade: "un",
      confirmado: base.porUnidade === true || unidadesInformadas !== null,
      fonte:
        base.porUnidade === true
          ? "Não entra na conta: a fonte já declara o valor por unidade."
          : unidadesInformadas !== null
            ? (pedidas.fonteDasPremissas?.unidades ?? "Informada no pedido")
            : (padrao?.porque ?? "Não informada e sem premissa de catálogo"),
    },
    {
      chave: "precoCotado",
      rotulo: "Preço da cotação",
      valor: precoCotado,
      unidade: "BRL",
      confirmado: precoCotado !== null,
      fonte:
        pedidas.fornecedor != null && pedidas.fornecedor !== ""
          ? `Proposta de ${pedidas.fornecedor}`
          : "Proposta informada na pergunta",
    },
    {
      chave: "quantidade",
      rotulo: "Quantidade do pedido",
      valor: quantidade,
      unidade: "un",
      confirmado: quantidade !== null,
      fonte: "Informada no pedido",
    },
    {
      chave: "precoHistorico",
      rotulo: "Preço histórico",
      valor: precoHistorico,
      unidade: "BRL",
      confirmado: precoHistorico !== null,
      fonte:
        precoHistorico !== null
          ? "Informado no pedido"
          : "Este acervo não guarda histórico de compras — o FreightCheck importa remuneração, não notas fiscais de compra.",
    },
  ];

  // ---- o que falta --------------------------------------------------------
  const lacunas: string[] = [];
  if (base.valor === null) {
    lacunas.push(
      `A vigência ${base.vigencia} não traz valor apurado para este item${base.ressalva ? ` — ${base.ressalva}` : "."}`,
    );
  }
  if (semAlvo === "SEM_VIDA_UTIL") {
    lacunas.push(
      "Informe a vida útil em meses para o preço-alvo poder ser calculado.",
    );
  }
  if (semAlvo === "SEM_UNIDADES") {
    lacunas.push(
      "Informe quantas unidades o ativo consome para haver preço por unidade.",
    );
  }
  if (semAlvo === "SEM_GAVETA") {
    lacunas.push(
      "A periodicidade do valor não foi confirmada pela curadoria; sem ela não há conversão para preço por unidade.",
    );
  }
  if (precoCotado === null) {
    lacunas.push(
      "Sem preço cotado não há comparação — informe o valor da proposta.",
    );
  }
  if (quantidade === null) {
    lacunas.push(
      "Sem quantidade não há impacto total — informe quantas unidades o pedido compra.",
    );
  }
  if (precoHistorico === null) {
    lacunas.push(
      "Este acervo não guarda histórico de compras: o FreightCheck importa o modelo de remuneração, não as notas de compra. O preço histórico só aparece quando informado.",
    );
  }
  if (base.ressalva !== null && base.valor !== null) {
    lacunas.push(base.ressalva);
  }

  return {
    produto,
    chave,
    base,
    politica,
    premissas: {
      ...pedidas,
      vidaUtilMeses,
      unidadesPorAtivo,
    },
    valorRemunerado: base.valor,
    valorEconomicoUnitario,
    semAlvo,
    precoHistorico,
    precoCotado,
    precoAlvo,
    precoTeto,
    diferencaParaAlvo,
    diferencaParaTeto,
    margemAbsoluta,
    margemPercentual,
    impactoPelaQuantidade,
    impactoMensal,
    impactoAnual,
    veredito,
    confiabilidade: confiabilidadeDe(base, {
      /*
        Quando a fonte entrega o valor por unidade, nenhuma das duas premissas
        entrou na conta — e o que não entrou não pode derrubar a nota. Tratá-las
        como estimativas ali marcaria de BAIXA uma avaliação que não estimou
        coisa alguma.
      */
      vidaConfirmada: base.porUnidade === true || vidaInformada !== null,
      unidadesConfirmadas:
        base.porUnidade === true || unidadesInformadas !== null,
      temAlvo: valorEconomicoUnitario !== null,
    }),
    dados,
    lacunas,
  };
}

/**
 * A nota de confiança — contada, não opinada.
 *
 * Sem preço-alvo não há o que graduar: a avaliação é BAIXA, porque o que ela
 * tem a dizer é o que falta. Com alvo, cada premissa estimada e cada ressalva
 * do catálogo derruba um degrau. Duas quedas chegam ao piso.
 */
export function confiabilidadeDe(
  base: BaseRemunerada,
  sinais: {
    vidaConfirmada: boolean;
    unidadesConfirmadas: boolean;
    temAlvo: boolean;
  },
): Confiabilidade {
  if (!sinais.temAlvo) return "BAIXA";
  let quedas = 0;
  if (!sinais.vidaConfirmada) quedas += 1;
  if (!sinais.unidadesConfirmadas) quedas += 1;
  if (base.ressalva !== null) quedas += 1;
  if (quedas === 0) return "ALTA";
  return quedas === 1 ? "MEDIA" : "BAIXA";
}
