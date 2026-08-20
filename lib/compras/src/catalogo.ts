/**
 * O CATÁLOGO DE COMPRA — o que se compra, e a rubrica do modelo que remunera.
 *
 * Este módulo existe por causa de um gesto que acontece antes de o dinheiro
 * sair: alguém está com um pedido de compra na mão — pneu, uniforme, aparelho
 * de telefonia, contrato de manutenção — e precisa saber **quanto a Ambev
 * remunera aquilo** antes de liberar. Hoje essa conferência é feita abrindo o
 * export e procurando a coluna; o que falta não é o número, que já está no
 * banco, mas o caminho até ele na velocidade de quem tem um pedido parado.
 *
 * **O que este catálogo faz, e o que ele deliberadamente não faz.** Ele traduz
 * *produto* — a língua de quem assina o pedido — para *rubrica* — a língua do
 * modelo de remuneração. Nada mais. Não compara com o preço do pedido, não
 * aprova, não sugere. O usuário pediu o remunerado, e é o remunerado que sai:
 * comparar é decisão de quem assina, e uma tela que dissesse "pode comprar"
 * estaria opinando sobre um preço que ela não conhece.
 *
 * **Por que um catálogo em código, e não uma tabela editável.** Pela mesma
 * razão de `PLANO_DA_DRE` em `@workspace/dre` e de `MAP` em
 * `@workspace/comparison/families`: cada entrada carrega a evidência que a
 * sustenta, e uma evidência revista num pull request é auditável de um jeito
 * que um `UPDATE` não é. O vínculo produto → rubrica é leitura do modelo de
 * remuneração, não preferência de usuário.
 *
 * **A regra que rege o módulo inteiro: zero não é resposta até que alguém
 * tenha olhado.** Três colunas deste catálogo vêm zeradas na série inteira do
 * export — pneu do cavalo, pneu da carreta, crédito de ICMS —, e uma tela que
 * escrevesse "R$ 0,00" ao lado de *Pneus* faria quem está com pressa concluir
 * que a Ambev não remunera pneu. Ela remunera ou não; o que o export diz é que
 * a coluna não é preenchida. A diferença está em {@link Ressalva}, que viaja
 * junto do produto e aparece na tela **antes** do número.
 */

/**
 * O contexto que os dois balcões aceitam: o escopo, e nada mais.
 *
 * Existe porque as duas leituras de que este módulo se alimenta pedem tipos
 * diferentes — `montarComposicao` quer `Partial<SeriesContext>` e o quadro de
 * QLP quer `RequestedContext` —, e a diferença entre eles é inteiramente a
 * janela de vigências. **Nenhum balcão de compra tem janela**: a pergunta é
 * sobre uma vigência só, a corrente, porque é a que vale no dia em que o pedido
 * está na mesa. Um recorte de série aqui não recortaria nada e daria à tela um
 * parâmetro que ela não sabe usar.
 *
 * Declarar a interseção uma vez é o que mantém a superfície do módulo com uma
 * língua só. A alternativa — cada função pedindo o tipo do seu fornecedor —
 * faria a rota ter de escolher, a cada chamada, qual dos dois contextos montar.
 */
export interface EscopoDaConsulta {
  scopeHash?: string;
  /** Nulo é um canal, e não a ausência de um: ver `SeriesContext.channel`. */
  channel?: string | null;
}

/**
 * Onde se consulta o produto — e, por consequência, qual leitura o responde.
 *
 * Não é uma categoria de produto: é o balcão de atendimento. `FROTA` responde
 * por placa e sai da composição do ativo; os dois de QLP respondem por unidade
 * e cargo e saem do quadro de pessoal. Um uniforme não tem placa, e um pneu
 * não tem cargo — misturar os dois num seletor só faria a tela pedir um dado
 * que metade dos produtos não tem.
 */
export type Balcao = "FROTA" | "QLP_ADMINISTRATIVO" | "QLP_OPERACIONAL";

export const ROTULO_DO_BALCAO: Record<Balcao, string> = {
  FROTA: "Frota",
  QLP_ADMINISTRATIVO: "QLP administrativo",
  QLP_OPERACIONAL: "QLP operacional",
};

/**
 * A natureza do gasto, do ponto de vista de quem compra.
 *
 * Serve à ordem da tela, e só a ela: quem abre com um pedido na mão procura
 * primeiro o que se compra toda semana (`INSUMO`), depois o que se compra uma
 * vez por ativo (`ATIVO`), e por último o que é folha e não passa por pedido de
 * compra (`ESTRUTURA`). A ordem foi escolhida pela frequência do gesto, não
 * pelo tamanho do número.
 */
export type Natureza = "INSUMO" | "ATIVO" | "ESTRUTURA";

export const ROTULO_DA_NATUREZA: Record<Natureza, string> = {
  INSUMO: "Insumo",
  ATIVO: "Ativo",
  ESTRUTURA: "Estrutura",
};

/**
 * Por que o número deste produto merece uma frase antes de ser lido.
 *
 * Vocabulário fechado, pela mesma razão de `MotivoDeExclusao` em
 * `@workspace/composition`: uma ressalva escrita à mão em cada entrada vira, em
 * seis meses, dez maneiras de dizer a mesma coisa, e a tela não consegue
 * ordenar nem filtrar por nenhuma delas.
 */
export type MotivoDaRessalva =
  /** A coluna existe e vem zerada em toda a série. Coluna vazia, não preço zero. */
  | "COLUNA_ZERADA_NA_SERIE"
  /** O valor é razão (R$/km) e falta o denominador para virar montante. */
  | "RAZAO_SEM_BASE"
  /** O export não traz o gasto, só o parâmetro que o contrato usa para calculá-lo. */
  | "PARAMETRO_NAO_GASTO"
  /** O número é anual e a leitura corrente é mensal — dividir aqui seria projetar. */
  | "OUTRA_PERIODICIDADE"
  /** O valor cobre cavalo e carreta juntos: somá-lo aos dois conta duas vezes. */
  | "ESCOPO_DE_CONJUNTO"
  /** Nenhuma coluna do export alimenta este produto. */
  | "SEM_COLUNA_NA_FONTE";

export const ROTULO_DA_RESSALVA: Record<MotivoDaRessalva, string> = {
  COLUNA_ZERADA_NA_SERIE: "Coluna zerada na série",
  RAZAO_SEM_BASE: "Razão sem base",
  PARAMETRO_NAO_GASTO: "Parâmetro, não gasto",
  OUTRA_PERIODICIDADE: "Outra periodicidade",
  ESCOPO_DE_CONJUNTO: "Remunera o conjunto",
  SEM_COLUNA_NA_FONTE: "Sem coluna na fonte",
};

/**
 * A frase que precede o número — e a medição que a sustenta.
 *
 * `texto` vai para a tela como está, escrito para quem confere o pedido.
 * `evidencia` é para quem revisa o catálogo, e responde "como você sabe disso?".
 * Nenhuma entrada deste arquivo tem ressalva sem evidência: uma advertência sem
 * medição é palpite com cara de regra.
 */
export interface Ressalva {
  motivo: MotivoDaRessalva;
  texto: string;
  evidencia: string;
}

export interface ProdutoDeCompra {
  /** A chave estável — o que a API, a URL e os testes usam. */
  chave: string;
  /** O nome do produto na língua de quem assina o pedido. */
  rotulo: string;
  balcao: Balcao;
  natureza: Natureza;
  /**
   * O pedido de compra típico, em uma frase.
   *
   * Existe para o reconhecimento, que é o trabalho inteiro desta tela: quem
   * chega com uma nota de "recapagem" precisa achar *Pneus* sem saber que a
   * coluna se chama `valorPneu`.
   */
  compra: string;
  /**
   * As rubricas do modelo que remuneram este produto — o `parameter` que
   * `placementOf` devolve em `@workspace/comparison`.
   *
   * É por aqui que o catálogo se mantém honesto sem duplicar conhecimento:
   * quem decide que `cavalo.valor_pneu` é da rubrica *Pneu* continua sendo o
   * mapa de famílias, e este arquivo só diz que *Pneu* é o que se compra
   * quando se compra pneu. Uma coluna nova que a fonte mande cai na rubrica
   * pelo mapa e aparece aqui sem que ninguém edite este arquivo.
   */
  parametros: string[];
  ressalva?: Ressalva;
}

/*
  ---------------------------------------------------------------------------
  BALCÃO DA FROTA — o que se compra para um veículo, consultado por placa
  ---------------------------------------------------------------------------

  As rubricas abaixo são as de `lib/comparison/src/families.ts`, escritas letra
  por letra. Um erro de digitação aqui não quebra nada: produz um produto que
  nunca encontra rubrica, silenciosamente. É o que `catalogo.test.ts` reprova,
  cruzando cada `parametros` deste arquivo contra as rubricas que o mapa de
  famílias de fato produz.
*/
const PRODUTOS_DA_FROTA: ProdutoDeCompra[] = [
  {
    chave: "pneu",
    rotulo: "Pneus",
    balcao: "FROTA",
    natureza: "INSUMO",
    compra: "Pneu novo, recapagem, rodízio — qualquer nota que entre pela medida do pneu.",
    parametros: ["Pneu"],
    ressalva: {
      motivo: "COLUNA_ZERADA_NA_SERIE",
      texto:
        "A fonte não preenche o valor de pneu. As duas colunas existem e vêm zeradas em " +
        "toda a série — o que está escrito é 'coluna vazia', e não 'a Ambev paga zero'. " +
        "A medida do pneu, essa sim, vem preenchida, e é ela que diz qual preço se aplica.",
      evidencia:
        "docs/DICIONARIO-TABELA-DE-CAVALO.md e lib/dre/src/plano.ts (variavel.pneus): " +
        "cavalo.valorPneu — 558 valores, 558 zeros; carreta.valorPneus — 657 valores, " +
        "657 zeros. Um valor distinto em cada uma.",
    },
  },
  {
    chave: "manutencao-contrato",
    rotulo: "Manutenção — contrato",
    balcao: "FROTA",
    natureza: "INSUMO",
    compra: "Renovação ou reajuste do contrato de manutenção do veículo.",
    parametros: ["Contrato de manutenção"],
  },
  {
    chave: "manutencao-avulsa",
    rotulo: "Manutenção — R$/km",
    balcao: "FROTA",
    natureza: "INSUMO",
    compra: "Peça, serviço de oficina, revisão — o que se compra fora do contrato.",
    parametros: ["Manutenção cavalo", "Manutenção carroceria", "Manutenção BID"],
    ressalva: {
      motivo: "RAZAO_SEM_BASE",
      texto:
        "A manutenção é remunerada por quilômetro rodado, não por mês. O que a fonte " +
        "entrega é a taxa — quanto vale cada quilômetro deste veículo —, e sem a " +
        "quilometragem do período ela não vira um valor em reais. Multiplicar por uma " +
        "quilometragem estimada seria inventar o número.",
      evidencia:
        "lib/dre/src/plano.ts (variavel.manutencao): manutencaoReaisKm e manutencaoBid " +
        "são BRL_KM, agregação NONE — média R$ 0,26/km e R$ 0,38/km respectivamente. " +
        "A base que falta é a quilometragem rodada por ativo no período.",
    },
  },
  {
    chave: "combustivel",
    rotulo: "Combustível",
    balcao: "FROTA",
    natureza: "INSUMO",
    compra: "Diesel, S10, Arla — o abastecimento do veículo.",
    parametros: ["Combustível", "Consumo benchmark"],
    ressalva: {
      motivo: "PARAMETRO_NAO_GASTO",
      texto:
        "O export não traz o gasto com combustível: traz o consumo de referência em " +
        "km/l e a capacidade usada na conta. São os dois parâmetros com que o contrato " +
        "calcula o combustível reconhecido — e a régua anda ao contrário do bolso: " +
        "consumo de referência maior significa menos litros reconhecidos.",
      evidencia:
        "lib/dre/src/plano.ts (variavel.diesel): combustivelConsumoBenchmark (KM_L, " +
        "média 1,70), combustivelConsumoNeg (KM_L, média 1,68) e combustivelCapacidade " +
        "(capacidade, não consumo). Nenhuma é montante. Nenhuma coluna de Arla existe " +
        "no export — varredura das 138 colunas.",
    },
  },
  {
    chave: "ipva-licenciamento",
    rotulo: "IPVA e licenciamento",
    balcao: "FROTA",
    natureza: "ATIVO",
    compra: "Guia de IPVA, licenciamento anual, taxa de emplacamento.",
    parametros: ["IPVA e licenciamento"],
    ressalva: {
      motivo: "OUTRA_PERIODICIDADE",
      texto:
        "O valor é anual, e a leitura da tela é a da vigência. Ele aparece como a fonte " +
        "o entrega — o ano inteiro —, e não dividido por doze: quem confere uma guia " +
        "compara com o ano, e a divisão apareceria como se fosse número da fonte.",
      evidencia:
        "docs/ACHADO-IPVA.md e lib/dre/src/plano.ts (fixo.ipva_licenciamento): " +
        "confirmado ANUAL em 10/08/2026 — de Jan a Jun/2026 o valor é exatamente 1,000% " +
        "de valorNfCompra nas 62 placas, desvio 0,0000.",
    },
  },
  {
    chave: "seguro",
    rotulo: "Seguro",
    balcao: "FROTA",
    natureza: "ATIVO",
    compra: "Apólice do veículo — renovação, endosso, franquia.",
    parametros: ["Seguro"],
  },
  {
    chave: "aquisicao",
    rotulo: "Aquisição do veículo",
    balcao: "FROTA",
    natureza: "ATIVO",
    compra: "Compra do cavalo ou do implemento — a nota fiscal e os tributos dela.",
    parametros: ["Aquisição", "Tributos sobre a aquisição"],
  },
  {
    chave: "financiamento",
    rotulo: "Financiamento e custo fixo",
    balcao: "FROTA",
    natureza: "ATIVO",
    compra:
      "Não se compra: é o que a Ambev paga por o veículo existir na frota — " +
      "FINAME, juros, amortização e o lucro fixo do ciclo.",
    parametros: ["Financiamento", "Custo fixo (total)", "Depreciação", "Lucro fixo (novo ciclo)"],
  },
  {
    chave: "aluguel",
    rotulo: "Aluguel do veículo",
    balcao: "FROTA",
    natureza: "ATIVO",
    compra: "Mensalidade de locação, quando o veículo é alugado em vez de financiado.",
    parametros: ["Caminhão aluguel"],
  },
];

/*
  ---------------------------------------------------------------------------
  BALCÃO DO QLP ADMINISTRATIVO — o que se compra para a estrutura
  ---------------------------------------------------------------------------

  Este é o balcão que o pedido de compra visita mais: uniforme, telefone e
  frota leve são compra recorrente, e as três têm no export a forma exata de
  que um pedido precisa — **valor unitário, quantidade remunerada e a despesa
  que as duas produzem**. É a única parte do modelo em que a fonte entrega o
  preço unitário do que se compra, e é por isso que o balcão existe separado.

  As rubricas vêm de `lib/comparison/src/families.ts`, seção ESTRUTURA_ADM, e os
  três papéis de cada uma estão nomeados em `docs/tabela-de-qlp-adm-dicionario.csv`.
*/
const PRODUTOS_DO_QLP_ADMINISTRATIVO: ProdutoDeCompra[] = [
  {
    chave: "uniformes",
    rotulo: "Uniformes",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "INSUMO",
    compra: "Camisa, calça, calçado, EPI — o enxoval do quadro administrativo.",
    parametros: ["Uniformes"],
  },
  {
    chave: "telefonia",
    rotulo: "Telefonia",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "INSUMO",
    compra: "Aparelho, linha, plano de dados.",
    parametros: ["Telefonia"],
  },
  {
    chave: "frota-leve",
    rotulo: "Frota leve",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "ATIVO",
    compra: "Carro de apoio, moto, van administrativa — compra ou locação.",
    parametros: ["Frota leve"],
  },
  {
    chave: "beneficios",
    rotulo: "Benefícios",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "ESTRUTURA",
    compra: "Vale-refeição, plano de saúde, seguro de vida.",
    parametros: ["Benefícios"],
  },
  {
    chave: "vale-transporte",
    rotulo: "Vale-transporte",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "ESTRUTURA",
    compra: "Recarga de vale-transporte do quadro.",
    parametros: ["Vale-transporte"],
  },
  {
    chave: "ordenados",
    rotulo: "Ordenados",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "ESTRUTURA",
    compra: "Não passa por pedido de compra: é a folha do quadro remunerado.",
    parametros: ["Ordenados"],
  },
  {
    chave: "encargos",
    rotulo: "Encargos e provisões",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "ESTRUTURA",
    compra: "Não passa por pedido de compra: é o que incide sobre a folha.",
    parametros: ["Encargos e provisões"],
  },
  {
    chave: "benchmark",
    rotulo: "Benchmark do QLP",
    balcao: "QLP_ADMINISTRATIVO",
    natureza: "ESTRUTURA",
    compra:
      "Não se compra: é a régua contra a qual a auditoria confronta a quantidade " +
      "e o salário do quadro.",
    parametros: ["Benchmark QLP"],
  },
];

/**
 * O balcão que ainda não abriu — e por quê.
 *
 * O QLP operacional foi pedido junto com o administrativo, e a resposta honesta
 * é que o export que abastece este banco não traz as linhas dele. A alternativa
 * seria omitir o balcão da tela, e ela é pior: quem procurasse o uniforme do
 * motorista concluiria que o produto não existe, quando o que não existe é o
 * dado. O balcão aparece, vazio, dizendo o que falta.
 *
 * A frase é a mesma de `pages/telas-em-preparo.ts` para `/qlp-operacional`,
 * deliberadamente: duas telas que descrevem a mesma lacuna com palavras
 * diferentes fazem parecer que são duas lacunas.
 */
export const BALCAO_SEM_DADO: { balcao: Balcao; falta: string; hoje: string } = {
  balcao: "QLP_OPERACIONAL",
  falta:
    "As linhas de QLP operacional dentro da importação: o Freightech publica cargo, " +
    "quantidade e valor por faixa, e o export que chega a este banco não traz nenhuma " +
    "delas. Sem essas linhas não há quadro, e portanto não há remunerado a consultar.",
  hoje:
    "A regra do quadro de gente está escrita nos blocos de Gente do Book do Operador — " +
    "é a metade da resposta que não depende de importação.",
};

/** O catálogo inteiro, na ordem em que a tela o apresenta. */
export const CATALOGO: ProdutoDeCompra[] = [
  ...PRODUTOS_DA_FROTA,
  ...PRODUTOS_DO_QLP_ADMINISTRATIVO,
];

/** Os produtos de um balcão, preservando a ordem do catálogo. */
export function produtosDoBalcao(balcao: Balcao): ProdutoDeCompra[] {
  return CATALOGO.filter((p) => p.balcao === balcao);
}

/** O produto de uma chave, ou `undefined` quando a chave não existe. */
export function produtoDe(chave: string): ProdutoDeCompra | undefined {
  return CATALOGO.find((p) => p.chave === chave);
}

/**
 * `rubrica → produto`, para a leitura classificar um atributo em uma passada.
 *
 * Construído uma vez, e não a cada consulta: a leitura da frota percorre até
 * uma centena de atributos por placa, e uma busca linear no catálogo dentro
 * desse laço seria quadrática sem precisar.
 */
const PRODUTO_POR_RUBRICA: Map<string, ProdutoDeCompra> = new Map(
  CATALOGO.flatMap((produto) => produto.parametros.map((p) => [p, produto] as const)),
);

/**
 * A que produto pertence uma rubrica — `null` quando a nenhum.
 *
 * `null` é resposta, e não falha: a maior parte das rubricas do modelo descreve
 * o ativo (região, ciclo, dimensões) e não corresponde a nada que se compre.
 * O que a tela faz com elas é o assunto de `frota.ts`, não deste arquivo.
 */
export function produtoDaRubrica(rubrica: string): ProdutoDeCompra | null {
  return PRODUTO_POR_RUBRICA.get(rubrica) ?? null;
}
