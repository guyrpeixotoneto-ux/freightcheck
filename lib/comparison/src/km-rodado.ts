/**
 * A AUDITORIA DE KM RODADO — o quilômetro contratado de cada trecho, e as duas
 * contas que o próprio acervo permite conferir.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e sobretudo o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada**, pela mesma razão que `finame.ts`, `ipva.ts`,
 * `lucro-fixo.ts` e `impostos.ts` não comparam: comparar duas vigências linha a
 * linha, atributo a atributo, é o que `engine.ts` faz desde sempre.
 *
 * E ele **não traduz o motor de novo**: os seis estados, a forma da alteração e
 * a ordem de gravidade vêm de `recorte-de-rubrica.ts`, o mesmo módulo dos quatro
 * recortes anteriores.
 *
 * O que muda aqui, e muda tudo o que vem depois, é o **grão**. As quatro
 * auditorias de custo fixo são por placa; esta é por **trecho** — a linha da
 * tabela de frete, identificada pela chave do trecho e não por um ativo. Custo
 * variável é provocado por rodar, e o que roda é um percurso, não um cavalo
 * parado no pátio. Por isso o catálogo desta rubrica tem um `codigo` só por
 * variável, e não um por tipo de equipamento: `TRECHO` é o único tipo que
 * declara qualquer uma destas colunas.
 *
 * ---------------------------------------------------------------------------
 * A recusa que atravessa a tela inteira: o realizado não existe
 * ---------------------------------------------------------------------------
 * O verbete desta rota pedia **quantos quilômetros cada ativo rodou na
 * vigência**. Esse dado não está no acervo, e não passa a estar porque a tela
 * foi escrita: o export que abastece este banco traz a tabela de frete —
 * **preço contratado por trecho** — e não o apontamento de viagens.
 *
 * Então esta tela não diz o que a operação custou. Ela diz **quanto custa o
 * quilômetro contratado**, e é uma pergunta diferente que o acervo responde
 * inteira. Multiplicar R$/km por uma quilometragem que ninguém importou seria
 * inventar exatamente o número que a tela existiria para mostrar — o mesmo
 * argumento que já está escrito no verbete, e que continua valendo depois de a
 * tela existir.
 *
 * ---------------------------------------------------------------------------
 * As quatro decisões que o dicionário da tabela de frete obrigou a escrever
 * ---------------------------------------------------------------------------
 * Todas as quatro estão em `docs/ACHADO-KM-RODADO.md`, e as três primeiras vêm
 * dos avisos que o próprio `docs/DICIONARIO-TABELA-DE-FRETE.md` publica:
 *
 * 1. **R$/km e R$/viagem são o mesmo dinheiro contado duas vezes.** Cada grupo
 *    de custo aparece nas duas formas, e a segunda é a primeira multiplicada
 *    pelo km do ciclo. Somar as duas numa apuração dobra o custo. As nove
 *    colunas de R$/viagem ficam **fora da tabela e de toda soma**, aparecem no
 *    detalhe, e servem para uma coisa só: conferir o km.
 *
 * 2. **Razão não é montante.** R$/km é uma taxa: ela vira dinheiro multiplicada
 *    por uma quilometragem do período, que este export não traz. É a mesma
 *    distinção que a Auditoria de Impostos faz entre alíquota e montante, e aqui
 *    ela é ainda mais dura, porque nesta rubrica **nenhuma** coluna é dinheiro
 *    do período.
 *
 * 3. **Lucro variável não é custo.** `freteReaisKMLucroVariavel` é a margem que
 *    o contrato embute no preço; somá-la às oito parcelas de custo dobraria o
 *    resultado. Ela entra no preço por km e fica **fora** do custo por km, e as
 *    duas leituras aparecem separadas.
 *
 * 4. **O pedágio tem duas vias de cálculo, e por isso não confere o km.** O
 *    dicionário diz: `freteReaisViagemPedagio` sai do R$/km quando há tabela
 *    própria, e do pedágio por eixo da tabela ANTT quando não há. Dividir um
 *    pelo outro nesse caso não produz quilometragem nenhuma — produz a razão
 *    entre duas contas diferentes. Ele é o único componente excluído do km
 *    implícito, e está excluído por um motivo publicado, não por conveniência.
 */

import {
  chaveDoVeiculo,
  ehEntradaOuSaidaDoGrao,
  estadoDaAlteracao,
  GRAVIDADE,
  numero,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "./recorte-de-rubrica";

export {
  estadoDaAlteracao,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type MedidaDaVariavel,
};

/** Os seis estados de uma linha de km. O mesmo tipo dos demais recortes. */
export type EstadoDaLinhaDeKm = EstadoDaLinha;

/** O tipo de entidade desta rubrica. Um só, e é o que a distingue das outras. */
export const TIPO_DO_KM_RODADO = "TRECHO";

// ---------------------------------------------------------------------------
// Os componentes do preço — a lista de onde saem os dois catálogos
// ---------------------------------------------------------------------------

/**
 * Um componente do preço do trecho, nas duas formas em que ele existe.
 *
 * As duas formas saem daqui **juntas**, e não de duas listas paralelas, porque é
 * o pareamento entre elas que sustenta a conferência do km: `R$/viagem ÷ R$/km`
 * tem de dar o km do ciclo. Duas listas escritas à mão divergiriam no primeiro
 * componente acrescentado a uma e esquecido na outra, e a conferência passaria a
 * comparar diesel com lavagem sem que ninguém percebesse.
 */
export interface ComponenteDoPreco {
  /** A chave estável na tela e na API. */
  chave: string;
  rotulo: string;
  /** O código da coluna de R$/km. */
  codigoRazao: string;
  /** O código da coluna de R$/viagem correspondente. */
  codigoViagem: string;
  /**
   * Margem, e não custo.
   *
   * Só o lucro variável. Ele entra no **preço** por km e fica fora do **custo**
   * por km: somá-lo às parcelas de custo contaria como despesa a remuneração do
   * transportador, e o resultado não seria nem uma coisa nem outra.
   */
  margem?: boolean;
  /**
   * Por que este componente não confere o km, quando é o caso.
   *
   * Só o pedágio, e a razão é do dicionário: quando o trecho não tem R$/km de
   * pedágio, o valor por viagem vem do pedágio por eixo da tabela ANTT. A
   * divisão entre os dois deixa de ser uma quilometragem e passa a ser a razão
   * entre duas contas diferentes.
   */
  foraDaConferencia?: string;
}

/**
 * Os nove componentes, na ordem em que a tela os lê: do que mais pesa ao que
 * menos pesa num trecho típico, com a margem por último — separada de propósito,
 * porque ela não é custo.
 *
 * O par `pneu` / `pneus` não é erro de digitação: a coluna de R$/km é
 * `freteReaisKMPneu` e a de R$/viagem é `freteReaisViagemPneus`, no singular e
 * no plural. É como a fonte as entrega, e corrigir a grafia aqui quebraria o
 * vínculo com o acervo — o lugar de consertar isso é a origem, não o catálogo.
 */
export const COMPONENTES_DO_PRECO: readonly ComponenteDoPreco[] = [
  {
    chave: "diesel",
    rotulo: "Diesel",
    codigoRazao: "trecho.frete_reais_km_diesel",
    codigoViagem: "trecho.frete_reais_viagem_diesel",
  },
  {
    chave: "manutencao_cavalo",
    rotulo: "Manutenção do cavalo",
    codigoRazao: "trecho.frete_reais_km_manutencao_cavalo",
    codigoViagem: "trecho.frete_reais_viagem_manutencao_cavalo",
  },
  {
    chave: "manutencao_carreta",
    rotulo: "Manutenção do implemento",
    codigoRazao: "trecho.frete_reais_km_manutencao_carreta",
    codigoViagem: "trecho.frete_reais_viagem_manutencao_carreta",
  },
  {
    chave: "pneu",
    rotulo: "Pneus",
    codigoRazao: "trecho.frete_reais_km_pneu",
    codigoViagem: "trecho.frete_reais_viagem_pneus",
  },
  {
    chave: "pedagio",
    rotulo: "Pedágio",
    codigoRazao: "trecho.frete_reais_km_pedagio",
    codigoViagem: "trecho.frete_reais_viagem_pedagio",
    foraDaConferencia:
      "O pedágio tem duas vias de cálculo: pelo R$/km quando o trecho tem tabela " +
      "própria, e pelo pedágio por eixo da tabela de frete mínimo (ANTT) quando não " +
      "tem. Dividir um pelo outro não produz quilometragem — produz a razão entre " +
      "duas contas diferentes.",
  },
  {
    chave: "lavagem",
    rotulo: "Lavagem",
    codigoRazao: "trecho.frete_reais_km_lavagem",
    codigoViagem: "trecho.frete_reais_viagem_lavagem",
  },
  {
    chave: "seguro",
    rotulo: "Seguro de carga",
    codigoRazao: "trecho.frete_reais_km_seguro",
    codigoViagem: "trecho.frete_reais_viagem_seguro",
  },
  {
    chave: "salario_variavel",
    rotulo: "Prêmio de produtividade",
    codigoRazao: "trecho.frete_reais_km_salario_variavel",
    codigoViagem: "trecho.frete_reais_viagem_salario_variavel",
  },
  {
    chave: "lucro_variavel",
    rotulo: "Lucro variável",
    codigoRazao: "trecho.frete_reais_km_lucro_variavel",
    codigoViagem: "trecho.frete_reais_viagem_lucro_variavel",
    margem: true,
  },
] as const;

const POR_COMPONENTE = new Map(COMPONENTES_DO_PRECO.map((c) => [c.chave, c]));

/** As oito parcelas de custo — tudo menos a margem. */
export const COMPONENTES_DE_CUSTO = COMPONENTES_DO_PRECO.filter((c) => !c.margem);

/** Os componentes que conferem o km: os que têm uma via de cálculo só. */
export const COMPONENTES_QUE_CONFEREM = COMPONENTES_DO_PRECO.filter(
  (c) => !c.foraDaConferencia,
);

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * O que a coluna é dentro da conta do trecho.
 *
 * É a distinção que decide todo o resto, e é a mesma ideia que a Auditoria de
 * Impostos usa para separar alíquota de montante — aqui com uma diferença que
 * torna a régua mais dura: **nenhum** destes papéis é dinheiro do período.
 *
 * - `DISTANCIA` — quilômetros. O denominador de todo R$/km e o multiplicador de
 *   todo R$/viagem.
 * - `RAZAO` — R$/km. Vira dinheiro multiplicada por uma quilometragem; sozinha,
 *   não soma com nada.
 * - `POR_VIAGEM` — reais por ciclo. É a `RAZAO` já multiplicada pelo km, então
 *   somá-la ao lado dela conta o mesmo dinheiro duas vezes.
 * - `VOLUME` — quantos ciclos. Previsão, e não realizado.
 * - `CONTEXTO` — origem, destino e o que mais situa o trecho sem medir nada.
 */
export type PapelDaColunaDeKm =
  | "DISTANCIA"
  | "RAZAO"
  | "POR_VIAGEM"
  | "VOLUME"
  | "CONTEXTO";

/** Uma variável de km rodado, com o código único que o trecho usa. */
export interface VariavelDeKm {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDeKm;
  /** O código do atributo. Um só: `TRECHO` é o único tipo que o declara. */
  codigo: string;
  /** O componente do preço a que esta variável pertence, quando há um. */
  componente?: string;
  /** Margem, e não custo — só o lucro variável. */
  margem?: boolean;
  /**
   * Uma coluna que **não entra em soma nenhuma**, e a razão disso.
   *
   * São as nove de R$/viagem, e o motivo é o aviso que o dicionário da tabela de
   * frete publica em letra grande: cada uma delas é o R$/km do mesmo componente
   * multiplicado pelo km do ciclo. Somar as duas formas dobra o custo. Elas
   * aparecem no detalhe, com o aviso, e servem para conferir o km — que é o
   * único uso que não as conta duas vezes.
   */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/** A variável de R$/km de um componente. */
function razaoDoComponente(c: ComponenteDoPreco): VariavelDeKm {
  return {
    chave: `reais_km_${c.chave}`,
    rotulo: `R$/km · ${c.rotulo}`,
    medida: "REAIS_POR_KM",
    papel: "RAZAO",
    codigo: c.codigoRazao,
    componente: c.chave,
    margem: c.margem,
    ajuda: c.margem
      ? "É a margem que o contrato embute no preço, não um custo. Entra no preço por km e fica fora do custo por km."
      : undefined,
  };
}

/** A variável de R$/viagem de um componente — sempre fora da soma. */
function viagemDoComponente(c: ComponenteDoPreco): VariavelDeKm {
  return {
    chave: `reais_viagem_${c.chave}`,
    rotulo: `R$/viagem · ${c.rotulo}`,
    medida: "DINHEIRO",
    papel: "POR_VIAGEM",
    codigo: c.codigoViagem,
    componente: c.chave,
    margem: c.margem,
    foraDaSoma:
      "É o R$/km deste mesmo componente multiplicado pelo km do ciclo — o dicionário " +
      "da tabela de frete avisa que somar as duas formas conta o mesmo dinheiro duas " +
      "vezes. Ela aparece aqui para conferir o km, nunca para somar.",
    ajuda: c.foraDaConferencia,
  };
}

/**
 * As variáveis do km rodado, na ordem em que a tela as lê.
 *
 * Começa na distância — que é o eixo da rubrica inteira —, segue pelas nove
 * parcelas do preço por quilômetro e termina no volume previsto, que é o que
 * transformaria R$/viagem em valor do período se o realizado existisse.
 */
export const VARIAVEIS_DE_KM: readonly VariavelDeKm[] = [
  {
    chave: "km_ciclo",
    rotulo: "Km do ciclo",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    codigo: "trecho.km_rodado",
    ajuda:
      "Ida mais volta. É o denominador de todos os R$/km e o multiplicador de todos " +
      "os R$/viagem — por isso ele, e não uma quilometragem realizada, é o eixo desta tela.",
  },
  {
    chave: "km_ida",
    rotulo: "Km de ida",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    codigo: "trecho.km_ida",
  },
  {
    chave: "km_volta",
    rotulo: "Km de volta",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    codigo: "trecho.km_volta",
    ajuda:
      "Pode diferir da ida por rota, por sinergia (F-MOV) ou por retorno vazio — " +
      "diferença não é erro aqui.",
  },
  ...COMPONENTES_DO_PRECO.map(razaoDoComponente),
  {
    chave: "previsao_viagens",
    rotulo: "Viagens previstas",
    medida: "VIAGENS",
    papel: "VOLUME",
    codigo: "trecho.previsao_viagens",
    ajuda:
      "Previsão, não realizado. É o volume que transformaria R$/viagem em valor do " +
      "período — e é justamente por ser previsão que esta tela não faz essa conta.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * As nove de R$/viagem, que não somam com nada por serem o mesmo dinheiro noutra
 * forma; as duas projeções mensais de quilometragem, que são previsão e não
 * medição; e a origem e o destino, que não medem nada e existem para que a
 * gaveta seja legível — a chave do trecho identifica, mas não se lê.
 */
export const VARIAVEIS_DE_DETALHE_DE_KM: readonly VariavelDeKm[] = [
  ...COMPONENTES_DO_PRECO.map(viagemDoComponente),
  {
    chave: "km_mes_por_equipe",
    rotulo: "Projeção de km no mês, por equipe",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    codigo: "trecho.km_rodado_mes_por_equipe",
    foraDaSoma:
      "É projeção — ciclos por dia × dias úteis —, e não quilometragem rodada. " +
      "Somá-la a um km de ciclo misturaria o que se espera com o que o trecho mede.",
  },
  {
    chave: "km_mes_por_equipe_lucro",
    rotulo: "Projeção de km no mês, versão “lucro”",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    codigo: "trecho.km_rodado_mes_por_equipe_lucro",
    foraDaSoma:
      "A mesma projeção calculada com os tempos da versão “lucro” — é a base de km " +
      "que remunera, e não a operacional. As duas existem porque podem divergir, e é " +
      "na diferença entre elas que a conversa comercial acontece: escolher uma delas " +
      "para somar apagaria exatamente isso.",
  },
  {
    chave: "origem",
    rotulo: "Origem",
    medida: "TEXTO",
    papel: "CONTEXTO",
    codigo: "trecho.origem",
  },
  {
    chave: "destino",
    rotulo: "Destino",
    medida: "TEXTO",
    papel: "CONTEXTO",
    codigo: "trecho.destino",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_KM, ...VARIAVEIS_DE_DETALHE_DE_KM];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeKm(variaveis: readonly VariavelDeKm[]): string[] {
  return [...new Set(variaveis.map((v) => v.codigo))].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_KM = codigosDeKm(VARIAVEIS_DE_KM);

/** O recorte do detalhe: tudo, inclusive o que não soma. */
export const CODIGOS_DO_DETALHE_DE_KM = codigosDeKm(TODAS);

const POR_CODIGO = new Map(TODAS.map((v) => [v.codigo, v]));

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeKmDoCodigo(code: string | null): VariavelDeKm | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela: um trecho, uma variável, os dois lados. */
export interface LinhaDeKm {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  /** A chave do trecho, como o motor a gravou. Identifica, mas não se lê. */
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDeKm;
  /** O componente do preço desta linha, quando ela é de um. */
  componente: string | null;
  attributeCode: string | null;
  /** O texto do valor na vigência base. Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na vigência comparada. Nulo quando não há. */
  comparada: string | null;
  /** `comparada − base`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeKm;
  /** A frase da recusa, quando há. Vem do motor, não é escrita aqui. */
  motivo: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
  /** O aviso da coluna que não soma, quando esta linha é de uma delas. */
  foraDaSoma: string | null;
}

/**
 * Uma alteração do motor virando linha da tabela.
 *
 * Devolve `null` para o que não é de km rodado — a função é o filtro e o tradutor
 * ao mesmo tempo, de modo que nenhuma tela precise saber quais são os códigos.
 */
export function linhaDeKmDaAlteracao(a: AlteracaoDoMotor): LinhaDeKm | null {
  const variavel = variavelDeKmDoCodigo(a.attributeCode);
  /*
    Entrada e saída não citam atributo: o motor as grava uma vez por entidade.
    Num recorte de trecho isso é mais frequente do que numa frota — um trecho
    entra e sai da tabela conforme a malha muda —, e é a metade mais visível do
    que aconteceu entre duas vigências.
  */
  if (!variavel) {
    if (!ehEntradaOuSaidaDoGrao(a, [TIPO_DO_KM_RODADO])) return null;
    return {
      id: a.id ?? null,
      entityLabel: a.entityLabel,
      entityType: a.entityType ?? "",
      variavel: "trecho",
      rotuloDaVariavel: "Trecho na tabela",
      medida: "TEXTO",
      papel: "CONTEXTO",
      componente: null,
      attributeCode: null,
      base: a.valueBefore,
      comparada: a.valueAfter,
      diferenca: null,
      variacao: null,
      estado: estadoDaAlteracao(a),
      motivo: a.inconclusiveReason ?? null,
      impactoAmount: null,
      impactoPeriodicidade: null,
      impactoCalculado: false,
      foraDaSoma: null,
    };
  }

  return {
    id: a.id ?? null,
    entityLabel: a.entityLabel,
    entityType: a.entityType ?? "",
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    componente: variavel.componente ?? null,
    attributeCode: a.attributeCode,
    base: a.valueBefore,
    comparada: a.valueAfter,
    diferenca: numero(a.deltaAbsolute),
    variacao: numero(a.deltaPercent),
    estado: estadoDaAlteracao(a),
    motivo: a.inconclusiveReason ?? null,
    impactoAmount: numero(a.impactAmount),
    impactoPeriodicidade: a.impactPeriodicity ?? null,
    impactoCalculado: a.impactConfidence === "CALCULATED",
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

/** As linhas de km de uma lista de alterações, na ordem em que vieram. */
export function linhasDeKm(alteracoes: readonly AlteracaoDoMotor[]): LinhaDeKm[] {
  const linhas: LinhaDeKm[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeKmDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Estas linhas **não vêm do motor**: o `change_set` só guarda o que mudou. Elas
 * são montadas a partir das duas leituras de `getEntityTable`, uma por vigência,
 * e por isso carregam `id: null`.
 */
export function linhaDeKmSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeKm | null {
  const variavel = variavelDeKmDoCodigo(par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: par.entityType,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    componente: variavel.componente ?? null,
    attributeCode: par.attributeCode,
    base: par.valor,
    comparada: par.valor,
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
    motivo: null,
    impactoAmount: null,
    impactoPeriodicidade: null,
    impactoCalculado: false,
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

// ---------------------------------------------------------------------------
// O impacto — e por que ele é, nesta rubrica, quase todo recusa
// ---------------------------------------------------------------------------

/** O que o recorte moveu, separado pelo que cada coluna é. */
export interface ImpactoDeKm {
  /**
   * Um número por periodicidade, **nunca um total único** — e, nesta rubrica,
   * quase sempre vazio.
   *
   * Vazio não é defeito: é a consequência de nenhuma coluna desta tela ser
   * dinheiro do período. R$/km é razão, R$/viagem é o mesmo dinheiro noutra
   * forma e fora de toda soma, km é distância e viagem prevista é previsão. O
   * que ficaria aqui é o que o motor tiver conseguido precificar com semântica
   * confirmada — e a tela diz por extenso por que o número costuma não existir.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Parcelas de R$/km que se moveram.
   *
   * É o indicador mais acionável desta tela, e ele não é dinheiro: é quantas
   * vezes o preço do quilômetro contratado mudou. Contá-las à parte é o que
   * impede que "sem impacto precificável" seja lido como "nada mudou no preço".
   */
  razoesAlteradas: number;
  /** Quilometragens que se moveram — o eixo da rubrica mudando de lugar. */
  distanciasAlteradas: number;
}

/**
 * O impacto do recorte de km, e as quatro coisas que ele se recusa a fazer.
 *
 * **Não multiplica razão por quilometragem inventada.** R$/km × km do ciclo dá o
 * custo de **uma viagem**, não o do período; para o período faltaria o número de
 * viagens realizadas, que o acervo não tem.
 *
 * **Não soma R$/km com R$/viagem.** É o mesmo dinheiro em duas formas, e o
 * dicionário da tabela de frete avisa disso na primeira página.
 *
 * **Não soma margem com custo.** O lucro variável é o que o contrato remunera ao
 * transportador; juntá-lo às oito parcelas de custo dobra o resultado.
 *
 * **Não soma periodicidades diferentes**, como os quatro recortes anteriores.
 */
export function impactoDeKm(linhas: readonly LinhaDeKm[]): ImpactoDeKm {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let razoesAlteradas = 0;
  let distanciasAlteradas = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    if (l.papel === "RAZAO") {
      razoesAlteradas++;
      continue;
    }
    if (l.papel === "DISTANCIA") {
      distanciasAlteradas++;
      continue;
    }
    if (l.papel === "VOLUME" || l.papel === "CONTEXTO") continue;

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      if (l.medida === "DINHEIRO") naoCalculavel++;
      continue;
    }

    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return {
    porPeriodicidade,
    naoCalculavel,
    foraDaSoma,
    razoesAlteradas,
    distanciasAlteradas,
  };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos trechos cada vigência entregou — vem da contagem do motor. */
export interface TrechosDoPar {
  /** Trechos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeKm {
  trechosComparados: number;
  /** Comparados que não tiveram nenhuma variável de km alterada. */
  semAlteracao: number;
  trechosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  /** Quantas variáveis se moveram, somando todos os trechos. */
  variaveisAlteradas: number;
  trechosComDadoIncompleto: number;
  trechosComConflito: number;
  impacto: ImpactoDeKm;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `trechos` vem do motor porque **esta lista não sabe** quantos trechos não
 * mudaram: um trecho sem nenhuma alteração não produz linha nenhuma.
 */
export function resumirKm(
  linhas: readonly LinhaDeKm[],
  trechos: TrechosDoPar,
): ResumoDeKm {
  const comAlteracao = new Set<string>();
  const comIncompleto = new Set<string>();
  const comConflito = new Set<string>();
  let variaveisAlteradas = 0;

  for (const l of linhas) {
    if (l.variavel === "trecho") continue;
    switch (l.estado) {
      case "ALTERADO":
        variaveisAlteradas++;
        comAlteracao.add(chaveDoVeiculo(l));
        break;
      case "DADO_INCOMPLETO":
        comIncompleto.add(chaveDoVeiculo(l));
        break;
      case "CONFLITO":
        comConflito.add(chaveDoVeiculo(l));
        break;
      default:
        break;
    }
  }

  /* "Sem alteração" é o que **nenhuma** linha tocou — a mesma regra dos quatro
     recortes anteriores, nascida do cartão que contava os mesmos 62 duas vezes. */
  const tocados = new Set([...comAlteracao, ...comIncompleto, ...comConflito]);
  return {
    trechosComparados: trechos.comparados,
    semAlteracao: Math.max(0, trechos.comparados - tocados.size),
    trechosComAlteracao: comAlteracao.size,
    novosNaVigencia: trechos.novos,
    ausentesNaComparada: trechos.ausentes,
    variaveisAlteradas,
    trechosComDadoIncompleto: comIncompleto.size,
    trechosComConflito: comConflito.size,
    impacto: impactoDeKm(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeKm {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDeKm;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeKm(
  linhas: readonly LinhaDeKm[],
): AlteracoesDaVariavelDeKm[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.variavel === "trecho") continue;
    contagem.set(l.variavel, (contagem.get(l.variavel) ?? 0) + 1);
  }
  return TODAS.filter((v) => contagem.has(v.chave))
    .map((v) => ({
      variavel: v.chave,
      rotulo: v.rotulo,
      medida: v.medida,
      papel: v.papel,
      alteracoes: contagem.get(v.chave)!,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo));
}

/** Uma fatia do gráfico de status. */
export interface FatiaDeEstadoDeKm {
  estado: EstadoDaLinhaDeKm;
  rotulo: string;
  trechos: number;
  /** A fração sobre o total de trechos do recorte. `0.852` para 85,2%. */
  fracao: number;
}

/**
 * Os trechos por estado — a rosca.
 *
 * Um trecho tem um estado só, e a ordem de gravidade (`GRAVIDADE`, no módulo
 * comum) decide qual. Sem essa regra a soma das fatias passaria do total.
 */
export function distribuicaoPorEstadoDeKm(
  linhas: readonly LinhaDeKm[],
  trechos: TrechosDoPar,
): FatiaDeEstadoDeKm[] {
  const pior = new Map<string, EstadoDaLinhaDeKm>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeKm, number>();
  for (const estado of pior.values()) {
    contagem.set(estado, (contagem.get(estado) ?? 0) + 1);
  }
  const tocados = [...pior.keys()].filter(
    (k) => pior.get(k) !== "NOVO_NA_VIGENCIA" && pior.get(k) !== "AUSENTE_NA_COMPARADA",
  ).length;
  contagem.set("SEM_ALTERACAO", Math.max(0, trechos.comparados - tocados));
  contagem.set("NOVO_NA_VIGENCIA", trechos.novos);
  contagem.set("AUSENTE_NA_COMPARADA", trechos.ausentes);

  const total = trechos.comparados + trechos.novos + trechos.ausentes;
  return GRAVIDADE.filter((e) => (contagem.get(e) ?? 0) > 0)
    .map((estado) => ({
      estado,
      rotulo: ROTULO_DO_ESTADO[estado],
      trechos: contagem.get(estado)!,
      fracao: total === 0 ? 0 : contagem.get(estado)! / total,
    }))
    .sort((a, b) => b.trechos - a.trechos);
}

// ---------------------------------------------------------------------------
// O preço do quilômetro, e as duas conferências
// ---------------------------------------------------------------------------

/** Um trecho lido de uma das duas vigências. */
export interface ValorDeKm {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  /** A chave do trecho. */
  entityLabel: string | null;
  origem: string | null;
  destino: string | null;
  kmCiclo: number | null;
  kmIda: number | null;
  kmVolta: number | null;
  viagensPrevistas: number | null;
  /** R$/km por componente, pela chave de {@link COMPONENTES_DO_PRECO}. */
  razoes: Record<string, number | null>;
  /** R$/viagem por componente, pela mesma chave. */
  viagens: Record<string, number | null>;
}

/**
 * O preço por quilômetro de um trecho: as nove parcelas somadas.
 *
 * `null` quando **nenhuma** parcela veio — um trecho sem preço nenhum não tem
 * preço zero, tem ausência. As parcelas que faltam não viram zero na soma: elas
 * saem contadas em `parcelasAusentes`, e quem lê decide se um preço montado com
 * seis das nove parcelas responde a pergunta dele.
 *
 * O custo e a margem saem separados porque **margem não é custo**: somá-los é o
 * terceiro aviso do dicionário da tabela de frete, e o resultado não descreveria
 * nem o que a operação gasta nem o que o transportador ganha.
 */
export interface PrecoDoTrecho {
  /** A soma das nove parcelas. `null` quando nenhuma veio. */
  preco: number | null;
  /** A soma das oito parcelas de custo — sem a margem. */
  custo: number | null;
  /** A parcela de lucro variável, sozinha. */
  margem: number | null;
  /** Quantas das nove parcelas o trecho declarou. */
  parcelas: number;
  /** Quantas faltaram — e que **não** foram lidas como zero. */
  parcelasAusentes: number;
}

/** O preço por km de um trecho, somando só o que ele de fato declarou. */
export function precoPorKmDoTrecho(valor: ValorDeKm): PrecoDoTrecho {
  let preco: number | null = null;
  let custo: number | null = null;
  let margem: number | null = null;
  let parcelas = 0;

  for (const c of COMPONENTES_DO_PRECO) {
    const v = valor.razoes[c.chave];
    if (v === null || v === undefined) continue;
    parcelas++;
    preco = (preco ?? 0) + v;
    if (c.margem) margem = (margem ?? 0) + v;
    else custo = (custo ?? 0) + v;
  }

  const arredondar = (n: number | null) => (n === null ? null : Number(n.toFixed(6)));
  return {
    preco: arredondar(preco),
    custo: arredondar(custo),
    margem: arredondar(margem),
    parcelas,
    parcelasAusentes: COMPONENTES_DO_PRECO.length - parcelas,
  };
}

/** O preço por km de uma ponta, lido sobre os trechos dela. */
export interface PrecoPorKmDaVigencia {
  ponta: "BASE" | "COMPARADA";
  /** Trechos com ao menos uma parcela de preço. */
  trechos: number;
  /** Quantos deles não declararam as nove parcelas. */
  trechosIncompletos: number;
  /** Em R$/km — a média **simples entre trechos**. Ver o aviso abaixo. */
  media: number | null;
  minimo: number | null;
  maximo: number | null;
  desvio: number | null;
  /** A média simples do custo por km, sem a margem. */
  custoMedio: number | null;
  /** A média simples da margem por km. */
  margemMedia: number | null;
}

/**
 * O preço por quilômetro de cada ponta — e a única forma honesta de agregá-lo.
 *
 * **É média simples entre trechos, e a tela diz isso.** O R$/km da operação
 * seria o dinheiro total dividido pela quilometragem total, e nenhum dos dois
 * existe no acervo: o dinheiro depende das viagens realizadas e a quilometragem
 * também. Uma média ponderada pelo km do ciclo pesaria um trecho de 900 km nove
 * vezes mais do que um de 100 km **como se os dois rodassem o mesmo número de
 * viagens** — que é a suposição que esta tela inteira recusa. Média simples
 * entre trechos é uma afirmação sobre a tabela de preço, que é o que o acervo
 * tem, e não sobre a operação, que é o que ele não tem.
 */
export function precoPorKmPorVigencia(
  valores: readonly ValorDeKm[],
): PrecoPorKmDaVigencia[] {
  const porPonta = new Map<
    "BASE" | "COMPARADA",
    { precos: number[]; custos: number[]; margens: number[]; incompletos: number }
  >();

  for (const v of valores) {
    const p = precoPorKmDoTrecho(v);
    if (p.preco === null) continue;
    const atual =
      porPonta.get(v.ponta) ?? { precos: [], custos: [], margens: [], incompletos: 0 };
    atual.precos.push(p.preco);
    if (p.custo !== null) atual.custos.push(p.custo);
    if (p.margem !== null) atual.margens.push(p.margem);
    if (p.parcelasAusentes > 0) atual.incompletos++;
    porPonta.set(v.ponta, atual);
  }

  const media = (xs: number[]) =>
    xs.length === 0 ? null : Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4));

  return [...porPonta.entries()]
    .map(([ponta, a]) => {
      const m = media(a.precos);
      const desvio =
        m === null
          ? null
          : Number(
              Math.sqrt(
                a.precos.reduce((acc, p) => acc + (p - m) ** 2, 0) / a.precos.length,
              ).toFixed(4),
            );
      return {
        ponta,
        trechos: a.precos.length,
        trechosIncompletos: a.incompletos,
        media: m,
        minimo: a.precos.length === 0 ? null : Number(Math.min(...a.precos).toFixed(4)),
        maximo: a.precos.length === 0 ? null : Number(Math.max(...a.precos).toFixed(4)),
        desvio,
        custoMedio: media(a.custos),
        margemMedia: media(a.margens),
      };
    })
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

/** Uma fatia da composição do preço por km. */
export interface ParcelaDoPrecoPorKm {
  ponta: "BASE" | "COMPARADA";
  componente: string;
  rotulo: string;
  margem: boolean;
  /** Trechos que declararam esta parcela. */
  trechos: number;
  /** A média simples desta parcela, em R$/km. */
  media: number | null;
}

/**
 * A composição do preço por km, parcela a parcela.
 *
 * Cada parcela é a média **sobre os trechos que a declararam** — e é por isso
 * que a contagem viaja junto. Uma parcela declarada por dez trechos e outra por
 * duzentos não são comparáveis sem esse número, e somar as médias de populações
 * diferentes não reconstrói o preço médio: ele sai de
 * {@link precoPorKmPorVigencia}, que soma trecho a trecho antes de tirar a média.
 */
export function composicaoDoPrecoPorKm(
  valores: readonly ValorDeKm[],
): ParcelaDoPrecoPorKm[] {
  const acumulado = new Map<string, { soma: number; n: number }>();
  for (const v of valores) {
    for (const c of COMPONENTES_DO_PRECO) {
      const valorDaParcela = v.razoes[c.chave];
      if (valorDaParcela === null || valorDaParcela === undefined) continue;
      const chave = `${v.ponta}${c.chave}`;
      const atual = acumulado.get(chave) ?? { soma: 0, n: 0 };
      atual.soma += valorDaParcela;
      atual.n += 1;
      acumulado.set(chave, atual);
    }
  }

  const fatias: ParcelaDoPrecoPorKm[] = [];
  for (const ponta of ["BASE", "COMPARADA"] as const) {
    for (const c of COMPONENTES_DO_PRECO) {
      const atual = acumulado.get(`${ponta}${c.chave}`);
      if (!atual) continue;
      fatias.push({
        ponta,
        componente: c.chave,
        rotulo: c.rotulo,
        margem: Boolean(c.margem),
        trechos: atual.n,
        media: Number((atual.soma / atual.n).toFixed(4)),
      });
    }
  }
  return fatias;
}

// ---------------------------------------------------------------------------
// A conferência do km — a leitura própria desta tela
// ---------------------------------------------------------------------------

/**
 * O que a conferência de um trecho revelou.
 *
 * `CICLO_NAO_FECHA` é a primeira das duas contas: ida mais volta tem de dar o km
 * do ciclo, e quando não dá é a própria linha que se contradiz sobre a distância
 * que ela declara.
 *
 * `PRECO_USA_OUTRO_KM` é a segunda, e é a que só existe porque o dicionário da
 * tabela de frete publica a identidade: `R$/viagem = R$/km × km do ciclo`.
 * Dividindo de volta, o quilômetro embutido no preço aparece — e quando ele não
 * é o km declarado, o preço daquele trecho foi montado sobre outra distância.
 */
export type VereditoDoTrecho =
  | "CONFERE"
  | "CICLO_NAO_FECHA"
  | "PRECO_USA_OUTRO_KM"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DO_KM: Record<VereditoDoTrecho, string> = {
  CONFERE: "As duas contas fecham",
  CICLO_NAO_FECHA: "Ida + volta ≠ km do ciclo",
  PRECO_USA_OUTRO_KM: "O preço foi montado sobre outro km",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/**
 * Meio quilômetro de folga entre ida + volta e o km do ciclo.
 *
 * As três colunas são distâncias declaradas na mesma linha e na mesma unidade, e
 * a soma entre elas é aritmética exata — a única folga que ela precisa é a do
 * arredondamento com que a fonte escreve cada uma. Meio quilômetro cobre
 * qualquer arredondamento de casa decimal e está muito abaixo de qualquer
 * diferença que signifique alguma coisa: um retorno por outra rota, uma perna de
 * sinergia, um trecho que mudou de destino.
 */
export const TOLERANCIA_DO_CICLO_EM_KM = 0.5;

/**
 * Um por cento de folga entre o km implícito no preço e o km declarado.
 *
 * Aqui a tolerância é **relativa**, e não absoluta, porque o km implícito sai de
 * uma divisão entre dois valores arredondados: um R$/km publicado com duas casas
 * carrega até meio centésimo de erro relativo, que num trecho de 900 km vira
 * vários quilômetros sem que nada esteja errado. Um por cento absorve o
 * arredondamento em qualquer distância e continua acusando o que importa — um
 * preço montado sobre a projeção mensal, sobre o km de ida ou sobre a versão
 * "lucro" erra por muito mais do que um por cento.
 */
export const TOLERANCIA_DO_PRECO = 0.01;

/** A conferência das duas contas, para um trecho numa ponta. */
export interface ConferenciaDoTrecho {
  kmDeclarado: number | null;
  /** `km_ida + km_volta`, quando as duas vieram. */
  kmDasPontas: number | null;
  /** `kmDasPontas − kmDeclarado`, em km. */
  diferencaDoCiclo: number | null;
  /** O km que o preço embute — a mediana entre os componentes que conferem. */
  kmImplicito: number | null;
  /** Quantos componentes tinham as duas formas e puderam conferir. */
  componentesConferidos: number;
  /** Quantos deles apontaram uma distância diferente da declarada. */
  componentesDivergentes: number;
  veredito: VereditoDoTrecho;
}

/** A mediana de uma lista não vazia, já ordenada internamente. */
function mediana(xs: readonly number[]): number {
  const ordenados = [...xs].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? (ordenados[meio - 1] + ordenados[meio]) / 2
    : ordenados[meio];
}

/**
 * As duas contas do km, para um trecho.
 *
 * ---------------------------------------------------------------------------
 * Por que a mediana, e não a média
 * ---------------------------------------------------------------------------
 * O km implícito é lido de até oito componentes independentes, e basta **um**
 * deles ter sido montado sobre outra distância para a média sair no meio do
 * caminho entre duas respostas certas — um número que não é o de nenhum dos dois
 * grupos. A mediana devolve a distância que a maioria dos componentes concorda em
 * usar, que é a pergunta: *sobre que quilômetro este preço foi montado?* Os
 * divergentes continuam contados ao lado, que é onde eles informam.
 *
 * ---------------------------------------------------------------------------
 * A ordem dos testes é o que os torna verdadeiros
 * ---------------------------------------------------------------------------
 * 1. **Sem km declarado** → `BASE_INSUFICIENTE`. Sem o eixo, não há o que
 *    conferir, e afirmar qualquer coisa seria afirmar sobre nada.
 * 2. **Ida + volta ≠ ciclo** → `CICLO_NAO_FECHA`, e decide antes do preço: a
 *    linha se contradiz sobre a própria distância, e um preço conferido contra
 *    um km que já é duvidoso confere contra nada.
 * 3. **O preço embute outro km** → `PRECO_USA_OUTRO_KM`.
 * 4. Caso contrário, `CONFERE`.
 */
export function conferenciaDoTrecho(valor: ValorDeKm): ConferenciaDoTrecho {
  const kmDeclarado = valor.kmCiclo;
  const kmDasPontas =
    valor.kmIda === null || valor.kmVolta === null ? null : valor.kmIda + valor.kmVolta;
  const diferencaDoCiclo =
    kmDasPontas === null || kmDeclarado === null
      ? null
      : Number((kmDasPontas - kmDeclarado).toFixed(4));

  const implicitos: number[] = [];
  for (const c of COMPONENTES_QUE_CONFEREM) {
    const razao = valor.razoes[c.chave];
    const viagem = valor.viagens[c.chave];
    /*
      Zero de um lado não confere nada: um componente que o trecho não cobra
      (R$ 0,00 por km, R$ 0,00 por viagem) é coerente com qualquer distância, e
      dividir zero por zero não produz quilometragem. Ele sai da conta em vez de
      entrar como uma concordância que não existe.
    */
    if (razao === null || razao === undefined || razao === 0) continue;
    if (viagem === null || viagem === undefined || viagem === 0) continue;
    implicitos.push(viagem / razao);
  }

  const kmImplicito = implicitos.length === 0 ? null : Number(mediana(implicitos).toFixed(4));
  const divergentes =
    kmDeclarado === null || kmDeclarado === 0
      ? 0
      : implicitos.filter(
          (km) => Math.abs(km - kmDeclarado) / kmDeclarado > TOLERANCIA_DO_PRECO,
        ).length;

  const cicloNaoFecha =
    diferencaDoCiclo !== null && Math.abs(diferencaDoCiclo) > TOLERANCIA_DO_CICLO_EM_KM;
  const precoUsaOutroKm =
    kmDeclarado !== null &&
    kmDeclarado !== 0 &&
    kmImplicito !== null &&
    Math.abs(kmImplicito - kmDeclarado) / kmDeclarado > TOLERANCIA_DO_PRECO;

  const veredito: VereditoDoTrecho =
    kmDeclarado === null || kmDeclarado === 0
      ? "BASE_INSUFICIENTE"
      : cicloNaoFecha
        ? "CICLO_NAO_FECHA"
        : precoUsaOutroKm
          ? "PRECO_USA_OUTRO_KM"
          : "CONFERE";

  return {
    kmDeclarado,
    kmDasPontas,
    diferencaDoCiclo,
    kmImplicito,
    componentesConferidos: implicitos.length,
    componentesDivergentes: divergentes,
    veredito,
  };
}

/** A conferência de uma ponta inteira — quantos trechos caem em cada veredito. */
export interface ConferenciaDaVigencia {
  ponta: "BASE" | "COMPARADA";
  trechos: number;
  confere: number;
  cicloNaoFecha: number;
  precoUsaOutroKm: number;
  baseInsuficiente: number;
  /** A maior diferença entre ida + volta e o ciclo, em km. */
  maiorDiferencaDoCiclo: number | null;
  /** A maior distância entre o km implícito e o declarado, em km. */
  maiorDiferencaDoPreco: number | null;
}

/**
 * A conferência de cada ponta, trecho a trecho.
 *
 * Nunca um veredito único da vigência: o que interessa é **quantos** trechos
 * caem em cada leitura, porque cinco trechos com o preço montado sobre outro km
 * num universo de quatrocentos é uma fila de trabalho, e não um diagnóstico da
 * tabela inteira.
 */
export function conferenciaDoKm(
  valores: readonly ValorDeKm[],
): ConferenciaDaVigencia[] {
  const porPonta = new Map<"BASE" | "COMPARADA", ConferenciaDaVigencia>();

  for (const v of valores) {
    const c = conferenciaDoTrecho(v);
    const atual =
      porPonta.get(v.ponta) ??
      ({
        ponta: v.ponta,
        trechos: 0,
        confere: 0,
        cicloNaoFecha: 0,
        precoUsaOutroKm: 0,
        baseInsuficiente: 0,
        maiorDiferencaDoCiclo: null,
        maiorDiferencaDoPreco: null,
      } as ConferenciaDaVigencia);

    atual.trechos += 1;
    if (c.veredito === "CONFERE") atual.confere += 1;
    if (c.veredito === "CICLO_NAO_FECHA") atual.cicloNaoFecha += 1;
    if (c.veredito === "PRECO_USA_OUTRO_KM") atual.precoUsaOutroKm += 1;
    if (c.veredito === "BASE_INSUFICIENTE") atual.baseInsuficiente += 1;

    if (c.diferencaDoCiclo !== null) {
      const d = Math.abs(c.diferencaDoCiclo);
      if (atual.maiorDiferencaDoCiclo === null || d > atual.maiorDiferencaDoCiclo) {
        atual.maiorDiferencaDoCiclo = Number(d.toFixed(4));
      }
    }
    if (c.kmImplicito !== null && c.kmDeclarado !== null) {
      const d = Math.abs(c.kmImplicito - c.kmDeclarado);
      if (atual.maiorDiferencaDoPreco === null || d > atual.maiorDiferencaDoPreco) {
        atual.maiorDiferencaDoPreco = Number(d.toFixed(4));
      }
    }

    porPonta.set(v.ponta, atual);
  }

  return [...porPonta.values()].sort((a, b) => a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_KM = [
  "Trecho",
  "Variável",
  "Unidade",
  "De",
  "Para",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
  "Fora da soma",
  "Justificativa",
] as const;

/**
 * Como o CSV escreve a unidade de cada coluna, por extenso.
 *
 * A coluna existe por causa do arquivo, e não da tela. Na tela, `1,84` sob o
 * rótulo "R$/km · Diesel" é inequívoco; num CSV aberto na planilha de outra
 * pessoa, `1,84`, `412` e `758,08` são três células numéricas na mesma coluna, e
 * uma soma de coluna junta razão, distância e reais sem avisar. Dizer o que cada
 * linha é custa uma coluna e evita o total que não é de nada.
 */
const UNIDADE_NO_CSV: Record<PapelDaColunaDeKm, string> = {
  DISTANCIA: "km",
  RAZAO: "R$/km",
  POR_VIAGEM: "R$/viagem",
  VOLUME: "viagens",
  CONTEXTO: "texto",
};
/** Uma linha da tabela como as células do CSV. *
 * A justificativa entra por parâmetro porque **não é da linha**: ela é do
 * gestor, mora em `justificativa` e é lida por `change_id` numa segunda
 * consulta. Guardá-la dentro da linha faria a comparação carregar um texto que o
 * motor não produziu — e que muda sem a comparação mudar. É a mesma escolha de
 * `celulasDoCsv`, no FINAME. No arquivo ela é a última coluna, e é boa parte do
 * motivo de o CSV existir para além da tela: quem recebe a planilha lê o que
 * mudou e, na mesma linha, por que mudou.
 */
export function celulasDoCsvDeKm(
  l: LinhaDeKm,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.rotuloDaVariavel,
    UNIDADE_NO_CSV[l.papel],
    l.base,
    l.comparada,
    l.diferenca,
    l.variacao,
    ROTULO_DO_ESTADO[l.estado],
    l.motivo,
    l.foraDaSoma,
    justificativa ?? null,
  ];
}

/** O componente do preço de uma chave, quando existe. */
export function componenteDoPreco(chave: string): ComponenteDoPreco | undefined {
  return POR_COMPONENTE.get(chave);
}
