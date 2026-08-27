/**
 * As duas leituras do intervalo, e as regras que transformam uma delas em fato.
 *
 * Este arquivo não desenha nada. Está separado da tela porque as regras de
 * "o que merece sua atenção" precisam ser lidas e conferidas sem passar por
 * JSX — uma regra de priorização escondida no meio de um componente é uma regra
 * que ninguém audita.
 *
 * **Nenhuma delas explica causa.** Elas dizem *o que* aconteceu e *onde*, com o
 * número que o motor apurou. "Por que" é conversa com a Ambev, não dedução de
 * planilha, e um produto de auditoria que chuta causa perde o direito de ser
 * levado a sério quando acerta.
 */

export interface RangeEntry {
  key: string;
  period: string;
  periodLabel: string;
  parameterKey: string;
  parameterName: string;
  family: string;
  attributeCode: string | null;
  title: string;
  equipment: string;
  entityType: string | null;
  vehicles: number;
  unit: string | null;
  amount: number | null;
  periodicity: string | null;
  confidence: string;
  reason: string | null;
  badge: string;
  badgeLabel: string;
  group: ChangeGroupLite;
}

/** O que a tela precisa do grupo. O objeto inteiro vai para o cartão de detalhe. */
export interface ChangeGroupLite {
  key: string;
  attributeCode: string | null;
  entityType: string | null;
  changeType: string;
  comparability: string;
  /** Ativos do grupo e o tamanho da série de onde ele veio. */
  vehicles: number;
  fleet: number;
  coverage: string;
  coverageLabel: string;
  /** Quantos pares antes→depois distintos existem dentro do grupo. */
  patterns: number;
  dominantPattern: {
    before: string | null;
    after: string | null;
    vehicles: number;
  } | null;
  aggregate: {
    summable: boolean;
    aggregation: string | null;
    totalBefore: number | null;
    totalAfter: number | null;
    rowsInTotal: number;
    deltaPercent: number | null;
    minPercent: number | null;
    maxPercent: number | null;
  };
  impact: { confidence: string };
  semanticsStatus: string | null;
  semanticsLabel: string;
  [outros: string]: unknown;
}

export interface RangeMovement {
  period: string;
  label: string;
  comparisons: number;
  changes: number;
  vehicles: number;
  impact: { byPeriodicity: Record<string, number>; notCalculable: number };
}

/** Um parâmetro somado no intervalo — o degrau entre a visão geral e o cartão. */
export interface ParameterRollup {
  parameterKey: string;
  parameterName: string;
  family: string;
  familyName: string;
  changes: number;
  vehicles: number;
  impact: { byPeriodicity: Record<string, number>; notCalculable: number };
  periods: number;
  notCalculable: number;
}

export interface Movimentos {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  periods: { date: string; label: string }[];
  movements: RangeMovement[];
  gaps: { period: string; label: string; reason: string }[];
  impact: { byPeriodicity: Record<string, number>; notCalculable: number };
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  totals: { changes: number; vehiclesTouched: number; comparisons: number };
  byParameter: ParameterRollup[];
  entries: RangeEntry[];
}

/** Uma unidade dentro da Visão Geral do intervalo — ver `RangeOverview`. */
export interface RangeOverviewUnit {
  unidade: string;
  label: string;
  contexts: { scopeHash: string; channel: string | null; latestPeriod: string }[];
  impact: { byPeriodicity: Record<string, number> };
  gainsByPeriodicity: Record<string, number>;
  lossesByPeriodicity: Record<string, number>;
  changes: number;
  vehiclesTouched: number;
}

export interface RangeOverviewUnitExcluded {
  unidade: string;
  label: string;
  reason: string;
}

/**
 * A soma de todas as unidades, para o mesmo intervalo que `Movimentos` lê —
 * o que sustenta "Onde está o impacto?" na linha do tempo.
 */
/**
 * Um ponto da série consolidada do intervalo — espelha `RangeOverviewPoint` em
 * `lib/comparison/src/families-view-overview.ts`. `losses` vem negativo.
 */
export interface RangeOverviewPoint {
  period: string;
  label: string;
  byPeriodicity: Record<string, { gains: number; losses: number }>;
}

export interface RangeOverview {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  unitsIncluded: RangeOverviewUnit[];
  unitsExcluded: RangeOverviewUnitExcluded[];
  /** A série do intervalo somada entre as unidades incluídas — o gráfico do Dashboard em Visão Geral. */
  serie: RangeOverviewPoint[];
}

export interface EndToEndEntry {
  key: string;
  parameterKey: string;
  parameterName: string;
  attributeCode: string | null;
  title: string;
  equipment: string;
  entityType: string | null;
  vehicles: number;
  unit: string | null;
  amount: number | null;
  periodicity: string | null;
  confidence: string;
  reason: string | null;
  badge: string;
  badgeLabel: string;
  group: ChangeGroupLite;
  vehiclesDetail: {
    plate: string | null;
    valueBefore: string | null;
    valueAfter: string | null;
    deltaPercent: number | null;
    impactAmount: number | null;
    impactPeriodicity: string | null;
    impactConfidence: string;
    inconclusiveReason: string | null;
  }[];
}

export interface PontaAPonta {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  series: {
    entityTypeSet: string;
    fromLabel: string;
    toLabel: string;
    fleetFrom: number;
    fleetTo: number;
  }[];
  missingSeries: { entityTypeSet: string; reason: string }[];
  fleet: { added: number; removed: number };
  reverted: {
    attributeCode: string;
    title: string;
    equipment: string;
    parameterKey: string;
    entities: number;
    periods: number;
  }[];
  entitiesCompared: number;
  impact: { byPeriodicity: Record<string, number>; notCalculable: number };
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  totals: { changes: number; vehiclesTouched: number };
  byParameter: ParameterRollup[];
  entries: EndToEndEntry[];
}

/** Uma linha do resumo executivo, sempre com a periodicidade colada ao número. */
export interface ValorPorPeriodicidade {
  periodicity: string;
  amount: number;
}

export function porPeriodicidade(
  buckets: Record<string, number>,
): ValorPorPeriodicidade[] {
  return Object.entries(buckets)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    // Ordem estável: o mensal antes do anual, e o resto em seguida por nome.
    .sort((a, b) => ORDEM_PERIODICIDADE(a.periodicity) - ORDEM_PERIODICIDADE(b.periodicity));
}

const ORDEM = ["MENSAL", "ANUAL", "PONTUAL"];
const ORDEM_PERIODICIDADE = (p: string) => {
  const i = ORDEM.indexOf(p);
  return i === -1 ? ORDEM.length : i;
};

/* ------------------------------------------------------------------ */
/* O que merece sua atenção                                            */
/* ------------------------------------------------------------------ */

export type TipoFato =
  | "prejuizo"
  | "ganho"
  | "concentracao"
  | "recorrencia"
  | "reversao"
  | "sem-valor"
  | "variacao";

export interface Fato {
  tipo: TipoFato;
  /** O parâmetro de que o fato fala. Duas regras nunca falam do mesmo. */
  attributeCode: string | null;
  titulo: string;
  /** A medida, já formatada pela tela — aqui só o número e a unidade. */
  valor: string | null;
  /** A frase do fato. Curta, factual, sem causa. */
  detalhe: string;
  /** A chave da entrada que a tela abre ao clicar. Nula quando não há uma só. */
  entrada: string | null;
}

interface Formatadores {
  dinheiro: (valor: number, periodicidade: string | null) => string;
  percentual: (valor: number) => string;
}

/**
 * Os fatos do intervalo, por regras fixas.
 *
 * **Quatro, no máximo, e nunca dois sobre o mesmo parâmetro.** Uma lista de
 * quinze itens não é uma lista de prioridades; é a mesma tabela outra vez, com
 * mais palavras. O corte é por ordem de regra, e a ordem é a da pergunta que o
 * gestor faz primeiro: quanto me custou, quanto me rendeu, onde se concentrou,
 * o que vem se repetindo, o que voltou atrás, e o que mudou sem que se saiba
 * quanto vale.
 */
export function fatosDoIntervalo(
  /** Já recortado pelo cartão no servidor — aqui não se filtra nada de novo. */
  movimentos: Movimentos,
  ponta: PontaAPonta | null,
  fmt: Formatadores,
): Fato[] {
  const doCartao = movimentos.entries;
  const comPreco = doCartao.filter(
    (e) => e.confidence === "CALCULATED" && e.amount !== null && e.amount !== 0,
  );

  const candidatos: Fato[] = [];

  // ---- 1 e 2: maior prejuízo e maior ganho --------------------------------
  const maior = (sinal: 1 | -1) =>
    comPreco
      .filter((e) => Math.sign(e.amount ?? 0) === sinal)
      .sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0))[0];

  const prejuizo = maior(-1);
  if (prejuizo) {
    candidatos.push({
      tipo: "prejuizo",
      attributeCode: prejuizo.attributeCode,
      titulo: prejuizo.title,
      valor: fmt.dinheiro(prejuizo.amount ?? 0, prejuizo.periodicity),
      detalhe: `${prejuizo.vehicles} ${plural(prejuizo.vehicles, "veículo", "veículos")} · maior alteração em ${prejuizo.periodLabel}`,
      entrada: prejuizo.key,
    });
  }

  const ganho = maior(1);
  if (ganho) {
    candidatos.push({
      tipo: "ganho",
      attributeCode: ganho.attributeCode,
      titulo: ganho.title,
      valor: fmt.dinheiro(ganho.amount ?? 0, ganho.periodicity),
      detalhe: `${ganho.vehicles} ${plural(ganho.vehicles, "veículo", "veículos")} · maior alteração em ${ganho.periodLabel}`,
      entrada: ganho.key,
    });
  }

  // ---- 3: concentração numa vigência --------------------------------------
  /*
    Um parâmetro cujo impacto do intervalo saiu quase todo de uma vigência só.
    O corte é 60% e é arbitrário no valor, não no critério: abaixo disso a
    palavra "concentrado" deixa de descrever o que se vê no gráfico.
  */
  for (const [codigo, linhas] of agrupar(comPreco)) {
    if (linhas.length < 2) continue;
    const total = linhas.reduce((s, e) => s + Math.abs(e.amount ?? 0), 0);
    const maiorLinha = linhas.sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0))[0];
    const fatia = total === 0 ? 0 : Math.abs(maiorLinha.amount ?? 0) / total;
    if (fatia < 0.6) continue;
    candidatos.push({
      tipo: "concentracao",
      attributeCode: codigo,
      titulo: maiorLinha.title,
      valor: fmt.dinheiro(maiorLinha.amount ?? 0, maiorLinha.periodicity),
      detalhe: `${Math.round(fatia * 100)}% do impacto do intervalo veio de ${maiorLinha.periodLabel}, entre ${linhas.length} vigências que mexeram`,
      entrada: maiorLinha.key,
    });
  }

  // ---- 4: o mesmo sentido, vigência após vigência --------------------------
  for (const [codigo, linhas] of agrupar(comPreco)) {
    if (linhas.length < 3) continue;
    const sinais = new Set(linhas.map((e) => Math.sign(e.amount ?? 0)));
    if (sinais.size !== 1) continue;
    const soma = linhas.reduce((s, e) => s + (e.amount ?? 0), 0);
    const periodicidades = new Set(linhas.map((e) => e.periodicity ?? "SEM_PERIODICIDADE"));
    candidatos.push({
      tipo: "recorrencia",
      attributeCode: codigo,
      titulo: linhas[0].title,
      // Só há total quando a periodicidade é uma só: somar mensal com anual
      // para produzir um "acumulado" seria a mentira que este produto caça.
      valor:
        periodicidades.size === 1
          ? fmt.dinheiro(soma, linhas[0].periodicity)
          : null,
      detalhe:
        `mexeu em ${linhas.length} vigências, sempre ${soma < 0 ? "reduzindo" : "aumentando"}` +
        (periodicidades.size === 1
          ? ""
          : " — em periodicidades diferentes, que não se somam"),
      entrada: linhas[0].key,
    });
  }

  // ---- 5: mexeu e voltou ---------------------------------------------------
  const revertido = [...(ponta?.reverted ?? [])].sort((a, b) => b.entities - a.entities)[0];
  if (revertido) {
    candidatos.push({
      tipo: "reversao",
      attributeCode: revertido.attributeCode,
      titulo: revertido.title,
      valor: null,
      detalhe: `${revertido.entities} ${plural(revertido.entities, "ativo mexeu", "ativos mexeram")} em até ${revertido.periods} ${plural(revertido.periods, "vigência", "vigências")} e ${plural(revertido.entities, "está", "estão")} hoje como ${plural(revertido.entities, "estava", "estavam")} em ${ponta?.fromLabel ?? "a ponta inicial"}`,
      entrada: null,
    });
  }

  // ---- 6: mudou e não se sabe quanto vale ---------------------------------
  const semPreco = doCartao.filter((e) => e.confidence !== "CALCULATED" || e.amount === null);
  const porAtributo = [...agrupar(semPreco)]
    .map(([codigo, linhas]) => ({
      codigo,
      linhas,
      veiculos: Math.max(...linhas.map((e) => e.vehicles)),
    }))
    .sort((a, b) => b.veiculos - a.veiculos)[0];
  if (porAtributo) {
    candidatos.push({
      tipo: "sem-valor",
      attributeCode: porAtributo.codigo,
      titulo: porAtributo.linhas[0].title,
      valor: null,
      detalhe: `${porAtributo.veiculos} ${plural(porAtributo.veiculos, "veículo teve", "veículos tiveram")} alteração · impacto financeiro ainda não calculável`,
      entrada: porAtributo.linhas[0].key,
    });
  }

  // ---- 7: variação percentual grande, quando a semântica autoriza ---------
  /*
    Só para o que é somável: uma variação percentual sobre uma média de km/l de
    62 cavalos é um número que existe e não significa nada.
  */
  const variacao = doCartao
    .filter(
      (e) =>
        e.group.aggregate.summable &&
        e.group.aggregate.deltaPercent !== null &&
        Math.abs(e.group.aggregate.deltaPercent) >= 20,
    )
    .sort(
      (a, b) =>
        Math.abs(b.group.aggregate.deltaPercent ?? 0) -
        Math.abs(a.group.aggregate.deltaPercent ?? 0),
    )[0];
  if (variacao) {
    candidatos.push({
      tipo: "variacao",
      attributeCode: variacao.attributeCode,
      titulo: variacao.title,
      valor: fmt.percentual(variacao.group.aggregate.deltaPercent ?? 0),
      detalhe: `variação do total do grupo em ${variacao.periodLabel} · ${variacao.vehicles} ${plural(variacao.vehicles, "veículo", "veículos")}`,
      entrada: variacao.key,
    });
  }

  /*
    O corte.

    Quatro fatos, e nunca dois dizendo a mesma coisa sobre o mesmo parâmetro —
    com uma exceção que o dado real cobrou: **prejuízo e ganho convivem**. Num
    cartão como Financiamento, o maior corte e o maior ganho saem os dois do
    FINAME, em vigências diferentes e em sentidos opostos. Deduplicar os dois
    apagaria justamente a informação de que o mesmo parâmetro foi mexido para
    os dois lados — que é o fato mais interessante da tela.
  */
  const cabecalho = new Set<TipoFato>(["prejuizo", "ganho"]);
  const vistos = new Set<string>();
  const escolhidos: Fato[] = [];
  for (const fato of candidatos) {
    const chave = fato.attributeCode ?? fato.titulo;
    if (!cabecalho.has(fato.tipo) && vistos.has(chave)) continue;
    vistos.add(chave);
    escolhidos.push(fato);
    if (escolhidos.length === 4) break;
  }
  return escolhidos;
}

/* ------------------------------------------------------------------ */
/* O placar gerencial                                                  */
/* ------------------------------------------------------------------ */

export type Entrada = RangeEntry | EndToEndEntry;

/** Tem preço apurado e o preço não é zero. A convenção da tela inteira. */
export function precificada(entrada: Entrada): boolean {
  return (
    entrada.confidence === "CALCULATED" &&
    entrada.amount !== null &&
    entrada.amount !== 0
  );
}

/** Não tem preço — que é diferente de ter preço zero, e sempre foi. */
export function semPreco(entrada: Entrada): boolean {
  return entrada.confidence !== "CALCULATED" || entrada.amount === null;
}

/**
 * Os números que a tela mostra antes de qualquer detalhe.
 *
 * Existe porque o resumo era tudo-ou-nada: com uma alteração precificada
 * apareciam quatro blocos; com nenhuma, uma frase. Num cartão como CAVALO, em
 * que **nada** é precificável enquanto a curadoria não confirmar a semântica,
 * o gestor ficava sem número nenhum — quando os números que não dependem de
 * dinheiro (quantos ativos, que fatia da frota, em quantas vigências, quanto do
 * que mudou este export consegue precificar) continuam todos de pé e são
 * exatamente o que dimensiona o trabalho.
 *
 * O que este placar **não** faz é o de sempre: não soma periodicidades, e não
 * cruza prejuízo com ganho. `movimentado` é a soma dos módulos e está nomeada
 * como bruta na tela — é "quanto passou pela mesa", nunca "quanto sobrou".
 */
export interface Placar {
  alteracoes: number;
  precificadas: number;
  semPreco: number;
  /** Fatia do que mudou que este export consegue precificar. 0..1. */
  cobertura: number | null;
  perdas: Record<string, number>;
  ganhos: Record<string, number>;
  /** |perdas| + |ganhos| por periodicidade. Bruto, e nunca um líquido. */
  movimentado: Record<string, number>;
  veiculos: number;
  /** Ativos da série inteira, para dar denominador aos afetados. */
  frota: number | null;
  colunas: number;
  parametros: number;
  /** Só nos movimentos: a ponta a ponta é um salto só. */
  vigenciasComAlteracao: number | null;
  vigenciasNoIntervalo: number | null;
}

export function placarDosMovimentos(movimentos: Movimentos): Placar {
  return {
    ...placar(movimentos.entries, {
      veiculos: movimentos.totals.vehiclesTouched,
      parametros: movimentos.byParameter.length,
      perdas: movimentos.lossesByPeriodicity,
      ganhos: movimentos.gainsByPeriodicity,
    }),
    vigenciasComAlteracao: new Set(movimentos.entries.map((e) => e.period)).size,
    vigenciasNoIntervalo: movimentos.movements.length,
  };
}

export function placarDaPonta(ponta: PontaAPonta): Placar {
  return {
    ...placar(ponta.entries, {
      veiculos: ponta.totals.vehiclesTouched,
      parametros: ponta.byParameter.length,
      perdas: ponta.lossesByPeriodicity,
      ganhos: ponta.gainsByPeriodicity,
      // Aqui a frota é declarada pelas séries comparadas, e não inferida dos
      // grupos: a ponta a ponta já sabe quantos ativos tem cada uma.
      frota: ponta.series.reduce((soma, s) => soma + s.fleetTo, 0) || null,
    }),
    vigenciasComAlteracao: null,
    vigenciasNoIntervalo: null,
  };
}

function placar(
  entradas: Entrada[],
  dados: {
    veiculos: number;
    parametros: number;
    perdas: Record<string, number>;
    ganhos: Record<string, number>;
    frota?: number | null;
  },
): Placar {
  const comPreco = entradas.filter(precificada);
  const sem = entradas.filter(semPreco);

  const movimentado: Record<string, number> = {};
  for (const entrada of comPreco) {
    const balde = entrada.periodicity ?? "SEM_PERIODICIDADE";
    movimentado[balde] = (movimentado[balde] ?? 0) + Math.abs(entrada.amount ?? 0);
  }

  return {
    alteracoes: entradas.length,
    precificadas: comPreco.length,
    semPreco: sem.length,
    cobertura: entradas.length === 0 ? null : comPreco.length / entradas.length,
    perdas: dados.perdas,
    ganhos: dados.ganhos,
    movimentado,
    veiculos: dados.veiculos,
    frota: dados.frota ?? frotaDe(entradas),
    colunas: new Set(entradas.map((e) => e.attributeCode ?? e.title)).size,
    parametros: dados.parametros,
    vigenciasComAlteracao: null,
    vigenciasNoIntervalo: null,
  };
}

/**
 * A frota por trás das alterações.
 *
 * Uma por série, e só então somadas. Cada grupo carrega a frota da série de
 * onde veio, e a mesma série aparece em dezenas de grupos: somar grupo a grupo
 * daria uma frota de milhares numa de 144 — o mesmo erro que a tela já corrige
 * na contagem de veículos.
 */
function frotaDe(entradas: Entrada[]): number | null {
  const porSerie = new Map<string, number>();
  for (const entrada of entradas) {
    const serie = entrada.entityType ?? entrada.equipment;
    porSerie.set(serie, Math.max(porSerie.get(serie) ?? 0, entrada.group.fleet ?? 0));
  }
  const total = [...porSerie.values()].reduce((soma, v) => soma + v, 0);
  return total === 0 ? null : total;
}

/* ------------------------------------------------------------------ */
/* Movimento × posição — as duas leituras lado a lado                  */
/* ------------------------------------------------------------------ */

/**
 * O comparativo que só existe com as duas contas na mão.
 *
 * A aba já tinha as duas leituras, e trocar entre elas por uma pílula obrigava
 * quem lê a guardar quatro números de cabeça para responder a pergunta
 * executiva: *do que a Ambev mexeu no caminho, quanto continua valendo hoje?*
 *
 * Prejuízo e ganho continuam em linhas separadas — a diferença entre as duas
 * leituras é calculada **dentro de cada lado**, e nunca cruzando um com o
 * outro. E a diferença é nomeada pelo que ela é: o que não sobreviveu ao
 * caminho, seja porque voltou atrás, seja porque outro movimento no sentido
 * oposto o compensou. Quem voltou atrás está listado, um a um, em `reverted` —
 * lá é subtração de conjuntos, e aí sim é afirmação.
 */
export interface LinhaComparativa {
  periodicidade: string;
  movimento: number;
  posicao: number;
  /** movimento − posição, dentro do mesmo lado. */
  diferenca: number;
}

export interface Comparativo {
  perdas: LinhaComparativa[];
  ganhos: LinhaComparativa[];
  alteracoesMovimento: number;
  alteracoesPosicao: number;
  vigencias: number;
  atributosRevertidos: number;
  ativosRevertidos: number;
}

export function comparativoDeLeituras(
  movimentos: Movimentos,
  ponta: PontaAPonta | null,
): Comparativo | null {
  if (!ponta) return null;

  const lado = (
    doCaminho: Record<string, number>,
    daPosicao: Record<string, number>,
  ): LinhaComparativa[] =>
    [...new Set([...Object.keys(doCaminho), ...Object.keys(daPosicao)])]
      .map((periodicidade) => {
        const movimento = doCaminho[periodicidade] ?? 0;
        const posicao = daPosicao[periodicidade] ?? 0;
        return {
          periodicidade,
          movimento,
          posicao,
          diferenca: movimento - posicao,
        };
      })
      .sort(
        (a, b) =>
          ORDEM_PERIODICIDADE(a.periodicidade) - ORDEM_PERIODICIDADE(b.periodicidade),
      );

  return {
    perdas: lado(movimentos.lossesByPeriodicity, ponta.lossesByPeriodicity),
    ganhos: lado(movimentos.gainsByPeriodicity, ponta.gainsByPeriodicity),
    alteracoesMovimento: movimentos.entries.length,
    alteracoesPosicao: ponta.entries.length,
    vigencias: movimentos.movements.length,
    atributosRevertidos: ponta.reverted.length,
    ativosRevertidos: ponta.reverted.reduce((soma, r) => soma + r.entities, 0),
  };
}

/* ------------------------------------------------------------------ */
/* O que mudou, em número — sem passar por dinheiro                    */
/* ------------------------------------------------------------------ */

/**
 * A variação nominal de quem ainda não tem preço.
 *
 * O bloco que faltava na tela. Uma alteração sem impacto calculável não é uma
 * alteração sem informação: o total do grupo foi de 500 para 600, ou o par
 * antes→depois mais comum foi "ATIVO → INATIVO" em dez veículos. Isso é
 * gerencial, é auditável, e sai do mesmo grupo que a tela já recebe — sem
 * inventar dinheiro em nenhum ponto.
 *
 * Duas formas, porque a semântica manda: **somável** ganha total antes, total
 * depois e variação; **não somável** ganha o par de valores dominante e a
 * contagem de padrões, porque somar km/l de 62 cavalos produz um número que
 * existe e não significa nada.
 */
export interface VariacaoNominal {
  chave: string;
  attributeCode: string | null;
  titulo: string;
  equipamento: string;
  periodo: string | null;
  veiculos: number;
  frota: number;
  unidade: string | null;
  somavel: boolean;
  totalAntes: number | null;
  totalDepois: number | null;
  deltaPercent: number | null;
  padrao: { antes: string | null; depois: string | null; veiculos: number } | null;
  padroes: number;
  motivo: string | null;
}

export function variacoesNominais(entradas: Entrada[]): VariacaoNominal[] {
  return entradas
    .map((entrada): VariacaoNominal => {
      const agregado = entrada.group.aggregate;
      return {
        chave: entrada.key,
        attributeCode: entrada.attributeCode,
        titulo: entrada.title,
        equipamento: entrada.equipment,
        periodo: "periodLabel" in entrada ? entrada.periodLabel : null,
        veiculos: entrada.vehicles,
        frota: entrada.group.fleet ?? 0,
        unidade: entrada.unit,
        somavel: agregado.summable && agregado.totalBefore !== null,
        totalAntes: agregado.totalBefore,
        totalDepois: agregado.totalAfter,
        deltaPercent: agregado.deltaPercent,
        padrao: entrada.group.dominantPattern
          ? {
              antes: entrada.group.dominantPattern.before,
              depois: entrada.group.dominantPattern.after,
              veiculos: entrada.group.dominantPattern.vehicles,
            }
          : null,
        padroes: entrada.group.patterns ?? 0,
        motivo: entrada.reason,
      };
    })
    /*
      A ordem é a da materialidade que ainda existe sem dinheiro: primeiro o
      que variou mais em percentual, depois o que pegou mais veículos. Sem isto
      a lista sairia na ordem do agrupamento, que não é ordem nenhuma.
    */
    .sort((a, b) => {
      const peso = (v: VariacaoNominal) => Math.abs(v.deltaPercent ?? 0);
      const diferenca = peso(b) - peso(a);
      if (diferenca !== 0) return diferenca;
      return b.veiculos - a.veiculos;
    });
}

/* ------------------------------------------------------------------ */
/* O que trava a apuração                                              */
/* ------------------------------------------------------------------ */

/**
 * Por que o dinheiro não fecha, agrupado pelo motivo, com o tamanho de cada um.
 *
 * É a fila de trabalho da curadoria, lida da própria tela de análise: "89% do
 * que mudou não tem preço" é diagnóstico; "e o motivo de 71 delas é semântica
 * não confirmada, em 12 colunas" é a próxima ação.
 *
 * **Não soma veículos entre grupos.** O mesmo caminhão aparece em cada coluna
 * que se mexeu, e somá-los deu "2.974 veículos" numa frota de 144 uma vez.
 * O que dimensiona aqui é quantas colunas estão paradas, e qual é o maior
 * grupo parado por aquele motivo.
 */
export interface Bloqueio {
  motivo: string;
  alteracoes: number;
  colunas: number;
  maiorGrupo: { titulo: string; veiculos: number };
}

export function bloqueiosDaApuracao(entradas: Entrada[]): Bloqueio[] {
  const porMotivo = new Map<string, Entrada[]>();
  for (const entrada of entradas) {
    const motivo = entrada.reason ?? "Sem motivo registrado.";
    const lista = porMotivo.get(motivo) ?? [];
    lista.push(entrada);
    porMotivo.set(motivo, lista);
  }

  return [...porMotivo.entries()]
    .map(([motivo, linhas]) => {
      const maior = linhas.reduce((a, b) => (b.vehicles > a.vehicles ? b : a));
      return {
        motivo,
        alteracoes: linhas.length,
        colunas: new Set(linhas.map((l) => l.attributeCode ?? l.title)).size,
        maiorGrupo: { titulo: maior.title, veiculos: maior.vehicles },
      };
    })
    .sort((a, b) => b.alteracoes - a.alteracoes);
}

function agrupar(entradas: RangeEntry[]): Map<string, RangeEntry[]> {
  const mapa = new Map<string, RangeEntry[]>();
  for (const entrada of entradas) {
    const chave = entrada.attributeCode ?? entrada.title;
    const lista = mapa.get(chave) ?? [];
    lista.push(entrada);
    mapa.set(chave, lista);
  }
  return mapa;
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? um : muitos;
}
