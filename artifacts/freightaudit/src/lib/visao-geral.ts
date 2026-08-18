import type { BalancoResumo } from "@/components/balanco/tipos";
import type {
  ChangeGroup,
  ExecutiveSummary,
  FamiliesView,
  GroupedView,
} from "@/components/inicio/types";
import { juntarPrioridades } from "@/lib/cockpit";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  linkDeAlteracoes,
  RECORTE_VAZIO,
  type FiltrosDeLinha,
  type Recorte,
} from "@/lib/recorte";

/**
 * A aritmética da Visão geral, fora do JSX.
 *
 * Esta tela é a única do produto que responde antes de perguntar: quem abre não
 * escolheu nada ainda, e mesmo assim recebe cinco números grandes. Isso a torna
 * a tela onde um número errado custa mais caro — ele será lido primeiro, por
 * quem tem menos contexto, e repetido numa reunião antes de alguém abrir o
 * detalhe.
 *
 * Daí duas decisões que valem para tudo o que está aqui:
 *
 * 1. **Toda função devolve `null` quando o dado não existe**, e nunca zero. Um
 *    "0%" de cobertura num banco sem importação nenhuma é a descrição de uma
 *    conferência catastrófica; a verdade é que conferência nenhuma aconteceu, e
 *    o cartão que recebe `null` some em vez de mentir.
 * 2. **Periodicidade nunca soma.** R$/mês e R$/ano saem em linhas próprias, e
 *    o ranking de impacto acontece *dentro* de uma periodicidade — nunca entre
 *    elas. É a mesma recusa do Acompanhamento e dos Parâmetros; se ela cair
 *    aqui, cai no lugar mais visível do produto.
 * 3. **Número que se abre leva o recorte junto.** Cada endereço que sai daqui
 *    carrega a unidade e a vigência que produziram o número, e o filtro que
 *    reproduz exatamente a população contada. Um "244 alterações sem preço" que
 *    abrisse uma lista de 1.100 na vigência errada não seria um atalho: seria
 *    uma contradição entre duas telas do mesmo produto, e quem visse as duas não
 *    teria como saber qual acreditar. A gramática desses endereços mora em
 *    `lib/recorte.ts`; o que cada número tem a dizer nela, aqui.
 *
 * Nada neste arquivo lê a rede. As entradas são exatamente os JSON que as rotas
 * devolvem, o que deixa cada conta legível ao lado do contrato que a alimenta.
 */

// ---------------------------------------------------------------------------
// Impacto
// ---------------------------------------------------------------------------

export interface Impacto {
  /** `null` quando a fonte não declarou periodicidade — o sufixo some, o valor fica. */
  periodicity: string | null;
  amount: number;
}

/**
 * O impacto da vigência, por periodicidade, o maior em módulo primeiro.
 *
 * A ordem é por módulo e não por sinal: o que decide a atenção de quem lê é o
 * tamanho do número, e uma vigência pode muito bem ter o maior movimento a
 * favor.
 */
export function impactosDaVigencia(view: GroupedView): Impacto[] {
  return Object.entries(view.impact.byPeriodicity)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** `- R$ 39.936/mês` — o valor com a periodicidade colada, como as outras telas escrevem. */
export function escreverImpacto(impacto: Impacto): string {
  return `${formatBrlShort(impacto.amount)}${periodicitySuffix(impacto.periodicity)}`;
}

/**
 * O mesmo valor, partido em dois — para quando o dinheiro é grande e a
 * periodicidade precisa ficar menor ao lado dele.
 *
 * A periodicidade nunca some nessa redução de corpo: é ela que diz se aquele
 * número acontece toda vez ou uma vez só, e um "R$ 39.936" sem o "/mês" é a
 * mesma frase com outro significado.
 */
export function partesDoImpacto(impacto: Impacto): { valor: string; sufixo: string } {
  return {
    valor: formatBrlShort(impacto.amount),
    sufixo: periodicitySuffix(impacto.periodicity),
  };
}

/**
 * A vigência imediatamente anterior à aberta — `null` quando ela é a primeira.
 *
 * Sai da lista de vigências que a própria resposta traz, e não de um segundo
 * pedido ao servidor: a comparação "vs vigência anterior" só existe quando há
 * anterior, e descobrir isso antes de perguntar evita um 404 que a tela teria
 * de esconder.
 */
export function vigenciaAnterior(
  view: GroupedView | null | undefined,
): { date: string; label: string } | null {
  if (!view) return null;
  const anteriores = view.periods
    .filter((p) => p.date < view.period)
    .sort((a, b) => a.date.localeCompare(b.date));
  return anteriores.length === 0 ? null : anteriores[anteriores.length - 1];
}

/**
 * Quanto um número cresceu em relação ao de antes, em porcento.
 *
 * `null` quando não há base: sem vigência anterior não há variação, e com
 * anterior igual a zero a divisão daria infinito — que na tela vira um "+∞%"
 * que ninguém sabe ler. Nos dois casos a linha some.
 */
export function variacao(atual: number, anterior: number | null | undefined): number | null {
  if (anterior === null || anterior === undefined || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

/** `+23%` / `−12%`. Sem casas decimais: é comparação de grandeza, não medição. */
export function escreverVariacao(percentual: number): string {
  const sinal = percentual > 0 ? "+" : percentual < 0 ? "−" : "";
  return `${sinal}${Math.abs(percentual).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  })}%`;
}

/** A parte de um todo, em porcento. `null` sem denominador — nunca 0%. */
export function participacao(parte: number, todo: number): number | null {
  if (todo <= 0) return null;
  return (parte / todo) * 100;
}

/** `32%` — arredondado ao inteiro, que é a precisão que uma proporção destas tem. */
export function escreverPercentual(percentual: number, casas = 0): string {
  return `${percentual.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

/**
 * A frota que a vigência entregou.
 *
 * Sai do cockpit, e não de uma soma das séries feita aqui: o Acompanhamento lê
 * esse mesmo campo, e duas telas do mesmo produto dizendo frotas diferentes
 * para a mesma vigência é o defeito que custa a confiança nas duas.
 */
export function frotaTotal(view: GroupedView): number {
  return view.cockpit.kpis.fleet;
}

// ---------------------------------------------------------------------------
// Cobertura e integridade — o que vem do Balanço de Massa
// ---------------------------------------------------------------------------

export interface Cobertura {
  /** Quanto do que os arquivos trouxeram a auditoria de fato cobre. */
  percentual: number;
  celulas: number;
  foraDaAuditoria: number;
  importacoes: number;
}

/**
 * Cobertura auditada: **as células que o arquivo trouxe e a auditoria alcança**.
 *
 * A conta é `1 − (perda + resíduo) ÷ entrada`, e cada termo tem um motivo:
 *
 * - **Perda declarada** é o que o arquivo trazia e o sistema não aproveitou.
 *   Está declarada, mas continua sendo dado que a auditoria não enxerga — então
 *   não conta como coberto.
 * - **Resíduo** é massa que sumiu sem destino conhecido. Se o resíduo entrasse
 *   na cobertura, o defeito mais grave que este produto sabe encontrar seria o
 *   que mais aumentaria o número de qualidade.
 * - **Descarte declarado e outro papel** contam como cobertos: a célula saiu por
 *   regra escrita, ou virou cabeçalho, vigência e identidade do equipamento —
 *   ela foi usada, e nenhuma informação se perdeu no caminho.
 *
 * Não é percentual de dinheiro, e o rótulo da tela diz isso: é percentual de
 * célula de planilha. Chamar de "% do valor importado" seria dar a um número de
 * massa a autoridade de um número de remuneração.
 */
export function cobertura(balancos: BalancoResumo[] | null | undefined): Cobertura | null {
  if (!balancos || balancos.length === 0) return null;

  const celulas = balancos.reduce((total, b) => total + b.entrada, 0);
  if (celulas === 0) return null;

  const foraDaAuditoria = balancos.reduce(
    (total, b) => total + b.porNatureza.PERDA + b.porNatureza.RESIDUO,
    0,
  );

  return {
    percentual: ((celulas - foraDaAuditoria) / celulas) * 100,
    celulas,
    foraDaAuditoria,
    importacoes: balancos.length,
  };
}

export interface Integridade {
  ok: boolean;
  titulo: string;
  detalhe: string;
}

/**
 * A conservação da importação, reduzida a uma linha.
 *
 * Os três desfechos são os mesmos do Balanço de Massa, na mesma ordem de
 * gravidade: célula sem destino, importação que não fecha, e a conta fechada.
 * Reduzir os três a "ok / não ok" seria perder justamente a distinção entre
 * "sumiu massa" e "o que está gravado não é o que a importação disse ter
 * capturado" — que mandam procurar em lugares diferentes.
 */
export function integridade(balancos: BalancoResumo[] | null | undefined): Integridade | null {
  if (!balancos || balancos.length === 0) return null;

  const residuo = balancos.reduce((total, b) => total + b.residuo, 0);
  if (residuo > 0) {
    return {
      ok: false,
      titulo: "Massa sem destino",
      detalhe: `${inteiro(residuo)} ${residuo === 1 ? "célula" : "células"} sem destino`,
    };
  }

  const naoFecham = balancos.filter((b) => !b.fecha).length;
  if (naoFecham > 0) {
    return {
      ok: false,
      titulo: "Importação não fecha",
      detalhe: `${inteiro(naoFecham)} ${
        naoFecham === 1 ? "importação não fecha" : "importações não fecham"
      }`,
    };
  }

  return {
    ok: true,
    titulo: "Integridade dos dados",
    detalhe: "Nenhuma célula sem destino",
  };
}

// ---------------------------------------------------------------------------
// A última importação
// ---------------------------------------------------------------------------

/** O que a Visão geral lê de `GET /imports`. O resto da linha é da tela de Importações. */
export interface ExecucaoDeImportacao {
  importRunId: string;
  status: string;
  filename: string;
  receivedAt: string;
}

export interface UltimaImportacao {
  quando: Date;
  /** `há 2h` — a distância até agora, escrita como se fala. */
  relativo: string;
  /** `10:42` — a hora do relógio, que é o que se procura ao conferir um envio. */
  hora: string;
  filename: string;
  status: string;
}

/**
 * A importação mais recente que chegou ao canônico.
 *
 * Só entram execuções promovidas. Um arquivo recebido às 10h e recusada a
 * promoção às 10h02 não é "a última importação" de nada — nenhum número desta
 * tela veio dele —, e anunciá-lo faria a pessoa concluir que os dados já
 * incluem o que ela acabou de mandar.
 */
export function ultimaImportacao(
  execucoes: ExecucaoDeImportacao[] | null | undefined,
  agora: Date = new Date(),
): UltimaImportacao | null {
  const promovidas = (execucoes ?? []).filter((e) => e.status === "PROMOTED");
  if (promovidas.length === 0) return null;

  const ultima = promovidas.reduce((maior, atual) =>
    atual.receivedAt > maior.receivedAt ? atual : maior,
  );
  const quando = new Date(ultima.receivedAt);
  if (Number.isNaN(quando.getTime())) return null;

  return {
    quando,
    relativo: tempoRelativo(quando, agora),
    hora: quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    filename: ultima.filename,
    status: ultima.status,
  };
}

/**
 * Quanto tempo faz, em português de conversa.
 *
 * Passa de uma semana e vira data: "há 43 dias" obriga quem lê a fazer a conta
 * de volta para saber de que mês se trata, que é justamente a pergunta.
 */
export function tempoRelativo(quando: Date, agora: Date = new Date()): string {
  const minutos = Math.floor((agora.getTime() - quando.getTime()) / 60_000);
  if (minutos < 0) return "agora há pouco";
  if (minutos < 2) return "agora há pouco";
  if (minutos < 60) return `há ${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "ontem";
  if (dias <= 7) return `há ${dias} dias`;
  return `em ${quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
}

// ---------------------------------------------------------------------------
// Maiores impactos
// ---------------------------------------------------------------------------

export interface LinhaDeImpacto {
  key: string;
  name: string;
  familyName: string;
  amount: number;
  /** Do maior do ranking: 0 a 1. É o comprimento da barra, e nada mais. */
  proporcao: number;
}

export interface RankingDeImpacto {
  periodicity: string;
  linhas: LinhaDeImpacto[];
  /** As periodicidades que ficaram de fora, e que a tela precisa nomear. */
  outras: string[];
}

/**
 * Os parâmetros que mais mexeram na remuneração — **dentro de uma
 * periodicidade só**.
 *
 * Uma barra ao lado da outra é uma afirmação de comparabilidade. Enfileirar
 * "−R$ 18.420/mês" e "+R$ 5.240/ano" na mesma escala diria que o segundo é
 * pequeno perto do primeiro, quando a verdade é que os dois não se comparam sem
 * uma conversão que este produto se recusa a fazer no escuro.
 *
 * Então o ranking escolhe a periodicidade que contém o maior movimento da
 * vigência, ordena dentro dela, e devolve em `outras` o nome das que ficaram de
 * fora — para que a tela diga que elas existem em vez de deixá-las sumir.
 */
export function maioresImpactos(
  summary: ExecutiveSummary | null | undefined,
  limite = 3,
): RankingDeImpacto | null {
  const parametros = summary?.topParameters ?? [];
  if (parametros.length === 0) return null;

  const porPeriodicidade = new Map<string, number>();
  for (const parametro of parametros) {
    for (const [periodicidade, valor] of Object.entries(parametro.byPeriodicity)) {
      const maior = porPeriodicidade.get(periodicidade) ?? 0;
      porPeriodicidade.set(periodicidade, Math.max(maior, Math.abs(valor)));
    }
  }
  if (porPeriodicidade.size === 0) return null;

  const [dominante] = [...porPeriodicidade.entries()].sort((a, b) => b[1] - a[1])[0];
  const teto = porPeriodicidade.get(dominante) ?? 0;
  if (teto === 0) return null;

  const linhas = parametros
    .filter((p) => p.byPeriodicity[dominante] !== undefined)
    .map((p) => ({
      key: p.key,
      name: p.name,
      familyName: p.familyName,
      amount: p.byPeriodicity[dominante],
      proporcao: Math.abs(p.byPeriodicity[dominante]) / teto,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, limite);

  return {
    periodicity: dominante,
    linhas,
    outras: [...porPeriodicidade.keys()].filter((p) => p !== dominante),
  };
}

// ---------------------------------------------------------------------------
// De onde vem um número do pódio
// ---------------------------------------------------------------------------

/**
 * O que sustenta uma linha dos Maiores impactos.
 *
 * O pódio afirma "Financiamento: R$ 26.856/mês" e para aí. Quem lê tem de
 * acreditar ou sair da tela — e sair da tela custava reencontrar o parâmetro
 * numa grade de sessenta cartões, com o risco de chegar lá noutro recorte e ver
 * outro número. Este detalhe é o caminho que faltava: o mesmo número, partido
 * nos grupos de alteração que o produziram, com o que **não** entrou nele dito
 * ao lado em vez de omitido.
 */
export interface DetalheDeImpacto {
  key: string;
  name: string;
  familyName: string;
  /** A periodicidade do número — a mesma em que o pódio ranqueou. */
  periodicity: string;
  /** O número do pódio, tal como o resumo executivo o publicou. */
  amount: number;
  /** Alterações do parâmetro nesta vigência: as com preço e as sem. */
  changes: number;
  vehicles: number;
  /** Os grupos que somam neste número, o maior em módulo primeiro. */
  grupos: ChangeGroup[];
  /** Veículos cujo impacto entrou na soma, contados grupo a grupo. */
  veiculosContados: number;
  /**
   * O que a soma dos grupos não explica.
   *
   * É zero em vigência sadia — grupo é partição de linha, e a soma dos grupos
   * de uma periodicidade *é* o número dela. Fica exposto porque um detalhe que
   * silencia a diferença entre a sua conta e o número que ele explica é pior do
   * que não ter detalhe: quem somasse as linhas na mão descobriria sozinho, e
   * sem saber qual dos dois acreditar.
   */
  resto: number;
  /** Alterações do parâmetro que ficaram sem preço. Nunca entram no número. */
  semPreco: number;
  /**
   * O que saiu da soma por já estar contado nas parcelas.
   *
   * `custo_fixo` mudou porque `lucro_fixo_novo_ciclo` mudou; somar os dois
   * contaria o mesmo dinheiro duas vezes. O titular fica de fora, e aqui ele é
   * dito pelo nome em vez de sumir na diferença entre dois totais.
   */
  excluido: { alteracoes: number; valor: number | null };
  /** As outras periodicidades deste mesmo parâmetro. Em linha própria, sempre. */
  outras: Impacto[];
  /**
   * O código de atributo do parâmetro — `null` quando ele tem mais de um.
   *
   * É o que deixa o detalhe abrir em Alterações exatamente a população que ele
   * acabou de descrever. Com dois códigos no mesmo parâmetro o filtro mostraria
   * uma fatia e diria o nome do todo, então o link sai sem ele e leva só a
   * vigência.
   */
  attributeCode: string | null;
}

/**
 * O detalhe de um parâmetro do pódio — a conta por trás do número.
 *
 * Sai da mesma resposta que alimentou o pódio (`/changes/families`), e não de
 * um pedido novo: o número da tela e o número do detalhe têm de ser o mesmo
 * número, e dois pedidos a vigências diferentes é justamente como eles
 * deixariam de ser.
 *
 * `null` quando o parâmetro não está nesta vigência ou não tem valor na
 * periodicidade pedida — o endereço com `?impacto=` continua colável, e um
 * colado depois de trocar a vigência não inventa um painel vazio.
 */
export function detalheDoImpacto(
  view: FamiliesView | null | undefined,
  key: string | null,
  periodicity: string | null = null,
): DetalheDeImpacto | null {
  if (!view || !key) return null;

  const familia = view.families.find((f) => f.parameters.some((p) => p.key === key));
  const parametro = familia?.parameters.find((p) => p.key === key);
  if (!familia || !parametro) return null;

  /*
    Qual periodicidade este painel explica.

    A pedida, quando o parâmetro de fato tem valor nela — é a do pódio, e é a
    que estava escrita ao lado do número que alguém clicou. Quando não tem,
    vale a mesma régua do pódio, a de maior módulo: um endereço com `?impacto=`
    colado depois de trocar de vigência ainda cai num parâmetro que existe, e
    dizer o número que ele tem é melhor do que não abrir nada. O painel escreve
    a periodicidade em cima do valor, então a troca aparece em vez de passar.
  */
  const buckets = parametro.impact.byPeriodicity;
  const escolhida =
    periodicity !== null && buckets[periodicity] !== undefined
      ? periodicity
      : (Object.entries(buckets).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ??
        null);
  if (escolhida === null) return null;

  const grupos = parametro.groups
    .filter((g) => g.impact.periodicity === escolhida && g.impact.amount !== null)
    .sort((a, b) => Math.abs(b.impact.amount ?? 0) - Math.abs(a.impact.amount ?? 0));

  const soma = grupos.reduce((total, g) => total + (g.impact.amount ?? 0), 0);
  const codigos = new Set(
    parametro.groups.map((g) => g.attributeCode).filter((c): c is string => c !== null),
  );

  return {
    key: parametro.key,
    name: parametro.name,
    familyName: familia.name,
    periodicity: escolhida,
    amount: buckets[escolhida],
    changes: parametro.changes,
    vehicles: parametro.vehicles,
    grupos,
    veiculosContados: grupos.reduce((total, g) => total + g.impact.countedVehicles, 0),
    resto: Number((buckets[escolhida] - soma).toFixed(2)),
    semPreco: parametro.impact.notCalculable,
    excluido: {
      alteracoes: parametro.impact.excludedChanges,
      valor: parametro.impact.excludedByPeriodicity[escolhida] ?? null,
    },
    outras: Object.entries(buckets)
      .filter(([p]) => p !== escolhida)
      .map(([periodicity, amount]) => ({ periodicity, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    attributeCode: codigos.size === 1 ? [...codigos][0] : null,
  };
}

// ---------------------------------------------------------------------------
// O que merece sua atenção
// ---------------------------------------------------------------------------

export type Tom = "grave" | "atencao" | "ok";

export interface PontoDeAtencao {
  chave: string;
  tom: Tom;
  titulo: string;
  detalhe: string;
  /** A segunda linha, quando há um número para pôr nela. */
  valor: string | null;
  href: string;
}

/**
 * Os quatro pontos do topo da tela.
 *
 * A régua é sempre a mesma: **o ponto existe porque o dado existe**, e o tom
 * sai do dado — não de uma lista fixa de "coisas ruins". Uma vigência em que
 * nada travou mostra o quarto ponto em verde dizendo isso; uma vigência sem
 * impacto apurável não mostra o primeiro ponto de forma alguma, porque não há
 * maior impacto quando não há impacto.
 *
 * Cada ponto leva a uma tela que responde a ele. Um alerta que não abre nada é
 * um alerta que a pessoa aprende a ignorar.
 */
export function pontosDeAtencao(
  view: FamiliesView,
  ranking: RankingDeImpacto | null,
  integridadeDosDados: Integridade | null,
  recorte: Recorte = RECORTE_VAZIO,
): PontoDeAtencao[] {
  const pontos: PontoDeAtencao[] = [];
  const daVigencia: Recorte = { ...recorte, period: view.period };

  const negativos = (ranking?.linhas ?? []).filter((l) => l.amount < 0);
  const maior = negativos[0] ?? ranking?.linhas[0];
  if (maior && ranking) {
    pontos.push({
      chave: "maior-impacto",
      tom: maior.amount < 0 ? "grave" : "ok",
      titulo: maior.amount < 0 ? "Maior impacto negativo" : "Maior impacto",
      detalhe: maior.name,
      valor: escreverImpacto({ periodicity: ranking.periodicity, amount: maior.amount }),
      href: `/parametros?period=${view.period}`,
    });
  }

  /*
    "Sem preço" leva às alterações, e não mais à Curadoria.

    O ponto conta **alterações** — "244 alterações requerem análise" —, e um
    número de alterações que abre uma tela de atributos obriga quem clicou a
    refazer sozinho a ligação entre as duas contagens. As 244 estão listadas em
    Alterações, filtradas por este mesmo `NOT_CALCULABLE`, e a Curadoria continua
    a um clique de lá: é ela que aparece dentro do painel "sem preço", que é
    onde a pergunta seguinte — *como isto ganha preço?* — de fato nasce.
  */
  const semPreco = view.impact.notCalculable;
  pontos.push({
    chave: "sem-preco",
    tom: semPreco > 0 ? "atencao" : "ok",
    titulo: semPreco > 0 ? "Mudanças sem preço" : "Toda mudança tem preço",
    detalhe:
      semPreco > 0
        ? `${inteiro(semPreco)} ${semPreco === 1 ? "alteração requer" : "alterações requerem"} análise`
        : "Nenhuma alteração ficou sem valor apurado",
    valor: null,
    href:
      semPreco > 0
        ? linkDeAlteracoes({
            recorte: daVigencia,
            filtros: { impactConfidence: "NOT_CALCULABLE" },
          })
        : "/curadoria",
  });

  const equipamento = equipamentoMaisTocado(view);
  if (equipamento) {
    pontos.push({
      chave: "equipamento",
      tom: "atencao",
      titulo: equipamento.nome,
      detalhe: `${inteiro(equipamento.mudancas)} ${
        equipamento.mudancas === 1 ? "mudança detectada" : "mudanças detectadas"
      }`,
      valor: null,
      /*
        `entityType` e não a pastilha de série: a pastilha troca a comparação
        por "a mais recente do cavalo", que pode ser outro mês. Este ponto fala
        das mudanças **desta** vigência, e é dentro dela que o equipamento
        precisa recortar.
      */
      href: linkDeAlteracoes({
        recorte: daVigencia,
        filtros: equipamento.entityType ? { entityType: equipamento.entityType } : {},
      }),
    });
  }

  if (integridadeDosDados) {
    pontos.push({
      chave: "integridade",
      tom: integridadeDosDados.ok ? "ok" : "grave",
      titulo: integridadeDosDados.titulo,
      detalhe: integridadeDosDados.detalhe,
      valor: null,
      href: "/balanco-massa",
    });
  }

  return pontos;
}

/**
 * O equipamento com mais mudanças na vigência.
 *
 * A contagem vem pronta do cockpit — `panorama.byEquipment` —, e não de uma
 * soma dos grupos feita aqui. A diferença não é de esforço: somar `vehicles`
 * conta ativos, e o que a frase promete são **mudanças**, que é outro número
 * sempre que um ativo muda em dois parâmetros. O painel do Acompanhamento lê
 * exatamente este campo, e as duas telas precisam dizer o mesmo.
 */
export function equipamentoMaisTocado(
  view: GroupedView,
): { nome: string; entityType: string | null; mudancas: number } | null {
  const baldes = view.cockpit.panorama.byEquipment.filter((b) => b.changes > 0);
  if (baldes.length === 0) return null;

  const maior = [...baldes].sort(
    (a, b) => b.changes - a.changes || a.equipment.localeCompare(b.equipment, "pt-BR"),
  )[0];
  // `entityType` sai junto com o nome porque é ele que viaja no link: "Cavalo" é
  // como se lê, `CAVALO` é como o servidor filtra, e traduzir um no outro na
  // tela seria uma terceira tabela de nomes para manter igual às outras duas.
  return {
    nome: maior.equipment,
    entityType: maior.entityType,
    mudancas: maior.changes,
  };
}

// ---------------------------------------------------------------------------
// A lista de alterações
// ---------------------------------------------------------------------------

export type TipoDeLinha = "queda" | "alta" | "sem-preco" | "neutro";

export interface LinhaDeAlteracao {
  chave: string;
  tipo: TipoDeLinha;
  titulo: string;
  detalhe: string;
  direita: string;
  /**
   * A lista de Alterações recortada nesta linha — a vigência, o parâmetro e o
   * equipamento de que ela fala.
   *
   * Existe porque um item de destaque que não abre nada é um beco: a tela diz
   * "combustivelConsumoBenchmark mudou em 10 ativos" e deixa quem quer ver os 10
   * refazer o filtro à mão do outro lado. Sai daqui, e não do JSX, para que o
   * endereço seja testável — `recorte.ts` guarda a gramática; este arquivo diz o
   * que cada linha tem a dizer nela.
   */
  href: string;
}

/**
 * As alterações da vigência, as mais relevantes primeiro.
 *
 * A ordem é **a fila de prioridade do cockpit**, a mesma que o Acompanhamento
 * abre: a criticidade e o lugar de cada item são calculados em
 * `lib/comparison/src/cockpit.ts` e testados lá contra o export real. Reordenar
 * aqui por conta própria faria o primeiro item desta tela discordar do primeiro
 * item da tela seguinte, e não há resposta boa para quem perguntasse qual das
 * duas está certa.
 *
 * Sem coluna de relógio, e é decisão de verdade e não de espaço: as alterações
 * desta vigência foram todas apuradas na mesma comparação, no mesmo instante.
 * Uma lista com quatro horários diferentes ao lado — "hoje, 10:32", "hoje,
 * 09:58" — inventaria uma cronologia que o dado não tem. O que existe de
 * verdadeiro para pôr à direita é o tamanho do fato: em quantos ativos ele
 * aconteceu.
 */
export function ultimasAlteracoes(
  view: GroupedView,
  limite = 4,
  recorte: Recorte = RECORTE_VAZIO,
): LinhaDeAlteracao[] {
  const fila = juntarPrioridades(view);
  /*
    A fila vazia com grupos na mão não deveria acontecer — as duas listas nascem
    da mesma resposta. Se acontecer, o painel mostra os grupos na ordem que
    vieram em vez de ficar vazio: perder a ordem é menos grave do que sumir com
    as alterações da vigência.
  */
  const grupos = fila.length > 0 ? fila.map((entrada) => entrada.group) : view.groups;
  const daVigencia: Recorte = { ...recorte, period: view.period };

  return grupos.slice(0, limite).map((grupo) => ({
    chave: grupo.key,
    tipo: tipoDaLinha(grupo),
    titulo: tituloDaLinha(grupo),
    detalhe: detalheDaLinha(grupo),
    direita: `${inteiro(grupo.vehicles)} ${grupo.vehicles === 1 ? "ativo" : "ativos"}`,
    href: linkDaAlteracao(grupo, daVigencia),
  }));
}

/**
 * O endereço das linhas de um grupo.
 *
 * O recorte é o mais estreito que o grupo sustenta, e nem um passo além. Grupo
 * sem `attributeCode` — um ativo que entrou, uma coluna que sumiu — não vira um
 * `attributeCode=null` na URL: ele leva à vigência inteira, e a lista ordenada
 * por materialidade põe o assunto por perto. Um filtro inventado devolveria zero
 * linhas, e zero linhas depois de um clique se lê como defeito da tela.
 */
function linkDaAlteracao(grupo: ChangeGroup, recorte: Recorte): string {
  const filtros: FiltrosDeLinha = {};
  if (grupo.attributeCode) filtros.attributeCode = grupo.attributeCode;
  if (grupo.entityType) filtros.entityType = grupo.entityType;
  return linkDeAlteracoes({ recorte, filtros });
}

function tipoDaLinha(grupo: ChangeGroup): TipoDeLinha {
  /*
    Troca de formato pura não é queda, alta nem "mudança sem preço" — é neutra,
    e precisa vir antes das outras regras: como o motor não apura valor para uma
    coluna de data, ela cairia em "sem-preco" e o painel anunciaria uma mudança
    que não existe.
  */
  if (grupo.formatOnly) return "neutro";
  if (grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null) {
    return grupo.impact.amount < 0 ? "queda" : "alta";
  }
  return grupo.impact.reason !== null || grupo.inconclusiveReason !== null
    ? "sem-preco"
    : "neutro";
}

function tituloDaLinha(grupo: ChangeGroup): string {
  const onde = `${grupo.title} — ${grupo.equipment}`;
  if (grupo.formatOnly) return `Formato do arquivo mudou — ${onde}`;
  if (grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null) {
    return `Valor ${grupo.impact.amount < 0 ? "reduzido" : "aumentado"} em ${onde}`;
  }
  if (tipoDaLinha(grupo) === "sem-preco") return `Mudança sem preço — ${onde}`;
  return onde;
}

function detalheDaLinha(grupo: ChangeGroup): string {
  if (grupo.formatOnly) {
    return "a coluna mudou de forma; o valor dos dois lados é o mesmo";
  }
  if (grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null) {
    return escreverImpacto({
      periodicity: grupo.impact.periodicity,
      amount: grupo.impact.amount,
    });
  }
  return grupo.impact.reason ?? grupo.inconclusiveReason ?? grupo.badgeLabel;
}

// ---------------------------------------------------------------------------
// Qualidade da auditoria
// ---------------------------------------------------------------------------

/**
 * O adjetivo da cobertura.
 *
 * Os cortes estão escritos aqui, num lugar só, porque um adjetivo é a coisa
 * mais fácil de mentir numa tela: "Excelente" a 60% seria um elogio que o dado
 * não sustenta, e ninguém conferiria. A palavra vem sempre acompanhada do
 * número, e nunca no lugar dele.
 */
export function qualidadeDaCobertura(percentual: number): { palavra: string; tom: Tom } {
  if (percentual >= 99) return { palavra: "Excelente", tom: "ok" };
  if (percentual >= 95) return { palavra: "Alta", tom: "ok" };
  if (percentual >= 85) return { palavra: "Parcial", tom: "atencao" };
  return { palavra: "Baixa", tom: "grave" };
}

function inteiro(valor: number): string {
  return valor.toLocaleString("pt-BR");
}
