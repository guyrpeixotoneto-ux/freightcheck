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
  aggregate: { summable: boolean; deltaPercent: number | null };
  impact: { confidence: string };
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
  entries: RangeEntry[];
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
