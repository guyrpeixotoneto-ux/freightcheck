import { excluidoDaSoma } from "@workspace/comparison/deduplicacao";
import type { BalancoResumo } from "@/components/balanco/tipos";
import type {
  ChangeGroup,
  ExecutiveSummary,
  FamiliesView,
  GroupedView,
  ImpactSide,
  PriorityItem,
} from "@/components/inicio/types";
import { juntarPrioridades } from "@/lib/cockpit";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  linkDeAlteracoes,
  paramsDoRecorte,
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
// Os dois lados do impacto
// ---------------------------------------------------------------------------

export type Lado = "ganhos" | "perdas";

/**
 * O impacto de uma periodicidade e os dois movimentos que o formam.
 *
 * O líquido é uma subtração, e uma subtração esconde as duas parcelas. Medido
 * em CAMAÇARI · EMPURRADA, agosto/2026: o cartão dizia "R$ 11.917/mês
 * favorável", e o que aconteceu foi R$ 21.764 entrando e R$ 9.847 saindo. As
 * duas frases descrevem a mesma vigência, e pedem conversas diferentes — os
 * dois lados ficam ao lado do saldo para que a segunda não seja lida como a
 * primeira.
 *
 * `ganhos + perdas = liquido`, sempre, porque os três saem da mesma varredura
 * de linhas no servidor (`ExecutiveSummary.sides`). A soma acontece lá; aqui só
 * se lê.
 */
export interface LadosDoImpacto {
  periodicity: string;
  liquido: number;
  /** O que somou. Sempre ≥ 0. */
  ganhos: number;
  /** O que tirou. Sempre ≤ 0 — o sinal fica, porque é ele que diz o que faz. */
  perdas: number;
  /**
   * A fatia verde da barra, de 0 a 1 — `ganhos ÷ (ganhos + |perdas|)`.
   *
   * É proporção de **movimento**, e não de saldo: mede quanto do dinheiro que
   * se mexeu nesta vigência foi para cima. `null` quando não se mexeu nada, e
   * aí não há barra a desenhar — meia barra cinza seria a figura de um empate
   * que não aconteceu.
   */
  fatiaDeGanho: number | null;
}

/**
 * Cada periodicidade da vigência com os seus dois lados, a maior em módulo
 * primeiro — a mesma ordem de `impactosDaVigencia`, e pela mesma razão.
 *
 * Vazio quando não há impacto apurado. Nunca uma linha com três zeros: um lado
 * zerado que não existe e um lado zerado que existe são coisas diferentes, e o
 * cartão que recebe a lista vazia diz "nenhum valor apurável" em vez de
 * desenhar uma balança equilibrada.
 *
 * O parâmetro pede só `summary`, e não `FamiliesView` inteiro — `FamiliesOverview`
 * também tem um `summary` (`ExecutiveSummary`) na mesma forma, e o Dashboard em
 * modo Geral lê os dois lados de lá com a mesma função, em vez de duplicar a
 * conta para a soma de unidades.
 */
export function ladosDoImpacto(
  view: Pick<FamiliesView, "summary"> | null | undefined,
): LadosDoImpacto[] {
  return (view?.summary.sides ?? []).map((lado) => {
    const movimento = lado.gains.total + Math.abs(lado.losses.total);
    return {
      periodicity: lado.periodicity,
      liquido: lado.net,
      ganhos: lado.gains.total,
      perdas: lado.losses.total,
      fatiaDeGanho: movimento === 0 ? null : lado.gains.total / movimento,
    };
  });
}

/** Uma linha da lista de um lado — um parâmetro e o que ele pôs ali. */
export interface LinhaDeLado {
  key: string;
  name: string;
  familyName: string;
  /** Alterações com preço deste parâmetro **deste lado**. */
  changes: number;
  vehicles: number;
  amount: number;
  /**
   * O comprimento da barra: 0 a 1 do maior valor **das duas listas**.
   *
   * A escala é única porque as duas listas são da mesma periodicidade, e ali a
   * comparação é legítima. Uma escala por lado faria a maior perda e o maior
   * ganho terminarem no mesmo lugar, dizendo com a figura que os dois pesam
   * igual.
   */
  proporcao: number;
  /**
   * O que este mesmo parâmetro pôs no **outro** lado — `null` quando não pôs.
   *
   * Não é detalhe raro: em CAMAÇARI · EMPURRADA, agosto/2026, `Financiamento`
   * subiu R$ 17.086,20 em quatro cavalos e caiu R$ 2.147,19 num quinto, e está
   * nas duas listas com os dois números.
   */
  noOutroLado: number | null;
  /**
   * O saldo do parâmetro nesta periodicidade — `amount + noOutroLado`.
   *
   * É o número que o painel do parâmetro abre, e é por isso que ele viaja
   * junto: quem clica em "+R$ 17.086 Financiamento" e cai num painel escrito
   * "R$ 14.939" precisa ter lido antes por que os dois existem. Igual a
   * `amount` quando o parâmetro está num lado só, e aí a linha não diz nada.
   */
  liquido: number;
}

export interface LadoDetalhado {
  lado: Lado;
  /** A soma exata das linhas abaixo — positiva no ganho, negativa na perda. */
  total: number;
  alteracoes: number;
  veiculos: number;
  linhas: LinhaDeLado[];
}

/**
 * O impacto de uma periodicidade aberto nos dois lados, com o que produziu cada
 * um — o painel que o cartão de Impacto líquido abre.
 *
 * Sai da mesma resposta que desenhou o cartão (`summary.sides`), e não de um
 * pedido novo: o número lido no cartão e o número lido na gaveta têm de ser o
 * mesmo número, e dois pedidos a vigências diferentes é exatamente como eles
 * deixariam de ser.
 *
 * `null` quando a vigência não tem impacto apurado — o endereço com
 * `?composicao=` continua colável, e um colado depois de trocar a vigência não
 * abre uma balança vazia.
 */
export interface ComposicaoDoImpacto {
  periodicity: string;
  liquido: number;
  ganhos: LadoDetalhado;
  perdas: LadoDetalhado;
  /** O lado que abre primeiro: o que foi clicado, ou o maior em módulo. */
  primeiro: Lado;
  /** A fatia verde da barra da gaveta — a mesma conta do cartão. */
  fatiaDeGanho: number | null;
  /**
   * As outras periodicidades desta vigência, com os seus lados.
   *
   * Em linha própria e sempre: R$/mês e R$/ano não somam, aqui nem em lugar
   * nenhum do produto. Elas aparecem como troca de assunto — cada uma abre a
   * sua própria balança — em vez de sumirem.
   */
  outras: LadosDoImpacto[];
  /**
   * Alterações da vigência que ficaram sem preço.
   *
   * Não estão em lado nenhum, e é por isso que precisam ser ditas aqui: quem
   * lê "R$ 21.764 somaram e R$ 9.847 tiraram" conclui que viu a vigência
   * inteira, e o que ficou sem preço é justamente o que pode virar um terceiro
   * número depois da curadoria.
   */
  semPreco: number;
  /** O que saiu da soma por já estar contado nas parcelas, nesta periodicidade. */
  excluido: { alteracoes: number; valor: number | null };
}

/** `ganhos` e `perdas` são os dois valores que a URL aceita em `?lado=`. */
function ladoValido(valor: string | null): valor is Lado {
  return valor === "ganhos" || valor === "perdas";
}

export function composicaoDoImpacto(
  view: FamiliesView | null | undefined,
  periodicidade: string | null,
  lado: string | null = null,
): ComposicaoDoImpacto | null {
  const sides = view?.summary.sides ?? [];
  /*
    Sem periodicidade pedida não há balança — é o `?composicao=` ausente da URL,
    e a gaveta fica fechada.

    A régua é a mesma de `detalheDoImpacto`, e a razão é a mesma: a chave da URL
    **é** o estado da gaveta. Sem esta linha, a balança nascia aberta em toda
    visita à Visão geral, escondendo a tela atrás de um painel que ninguém pediu.
  */
  if (!view || periodicidade === null || sides.length === 0) return null;

  /*
    Qual periodicidade esta balança explica.

    A pedida, quando a vigência de fato tem essa periodicidade — é a que estava
    escrita ao lado do número que alguém clicou. Quando não tem, vale a régua do
    cartão, a de maior módulo: um endereço com `?composicao=ANUAL` colado depois
    de trocar de vigência ainda cai numa balança que existe, e a gaveta escreve
    a periodicidade em cima do valor, então a troca aparece em vez de passar.
  */
  const escolhido = sides.find((s) => s.periodicity === periodicidade) ?? sides[0];

  const teto = Math.max(
    ...escolhido.gains.parameters.map((p) => Math.abs(p.amount)),
    ...escolhido.losses.parameters.map((p) => Math.abs(p.amount)),
    0,
  );
  const detalhar = (nome: Lado, origem: ImpactSide, oposto: ImpactSide): LadoDetalhado => ({
    lado: nome,
    total: origem.total,
    alteracoes: origem.changes,
    veiculos: origem.vehicles,
    linhas: origem.parameters.map((p) => {
      const noOutroLado =
        oposto.parameters.find((o) => o.key === p.key)?.amount ?? null;
      return {
        key: p.key,
        name: p.name,
        familyName: p.familyName,
        changes: p.changes,
        vehicles: p.vehicles,
        amount: p.amount,
        proporcao: teto === 0 ? 0 : Math.abs(p.amount) / teto,
        noOutroLado,
        liquido: Number((p.amount + (noOutroLado ?? 0)).toFixed(2)),
      };
    }),
  });

  const movimento = escolhido.gains.total + Math.abs(escolhido.losses.total);

  return {
    periodicity: escolhido.periodicity,
    liquido: escolhido.net,
    ganhos: detalhar("ganhos", escolhido.gains, escolhido.losses),
    perdas: detalhar("perdas", escolhido.losses, escolhido.gains),
    // Sem lado pedido, abre o que mais mexeu — é ele que a pessoa veio ver.
    primeiro: ladoValido(lado)
      ? lado
      : Math.abs(escolhido.losses.total) > escolhido.gains.total
        ? "perdas"
        : "ganhos",
    fatiaDeGanho: movimento === 0 ? null : escolhido.gains.total / movimento,
    outras: ladosDoImpacto(view).filter((l) => l.periodicity !== escolhido.periodicity),
    semPreco: view.impact.notCalculable,
    excluido: {
      alteracoes: view.impact.excludedChanges,
      valor: excluidoDaSoma(view.impact)[escolhido.periodicity] ?? null,
    },
  };
}


// ---------------------------------------------------------------------------
// De onde vêm as alterações detectadas
// ---------------------------------------------------------------------------

/**
 * Qual recorte da composição está em foco. `todas` é o painel inteiro.
 *
 * Mora na URL como o lado da balança mora: quem clicou em "62 só formato" veio
 * perguntar *quais*, e o painel precisa abrir já com a resposta em cima.
 */
export type FocoDeAlteracoes = "todas" | "valor" | "formato";

export function focoValido(valor: string | null): valor is FocoDeAlteracoes {
  return valor === "todas" || valor === "valor" || valor === "formato";
}

/**
 * Uma fatia de uma das partições — **sempre em alterações**, nunca em pontos.
 *
 * A unidade única é a regra deste painel inteiro. O Acompanhamento publica o
 * mesmo panorama em pontos, porque lá a pergunta é "por onde começo" e a fila é
 * de pontos; aqui o número que se abriu conta alterações, e uma seção que
 * trocasse de unidade no meio faria as três partições pararem de fechar com ele.
 * `pontos` viaja junto como contexto da fatia, e nunca como o número dela.
 */
export interface FatiaDeAlteracoes {
  chave: string;
  rotulo: string;
  alteracoes: number;
  /** Quantos pontos da remuneração produziram esta fatia. `null` quando não se aplica. */
  pontos: number | null;
  /** 0 a 1 do total da vigência — o comprimento da barra. */
  proporcao: number;
  /**
   * As linhas desta fatia em Alterações — `null` quando **não existe** filtro
   * que reproduza exatamente esta contagem.
   *
   * Não é omissão: um atalho que abre um total diferente do que foi clicado
   * gasta mais confiança do que economiza cliques, e é o que aconteceria com
   * "viraram dinheiro: 7" apontando para `impactConfidence=CALCULATED`, que
   * devolve as 19 — as 7 mais as 12 que saíram por dupla contagem.
   */
  href: string | null;
  /** O que a fatia quer dizer, ou por que ela não abre nada. */
  nota: string | null;
}

/** Um ponto da remuneração tocado nesta vigência, na conta das alterações. */
export interface PontoTocado {
  /** A chave do grupo — a mesma que `?alteracao=` abre. */
  chave: string;
  titulo: string;
  equipamento: string;
  badgeLabel: string;
  alteracoes: number;
  veiculos: number;
  /** Do ponto com mais alterações da vigência: 0 a 1. É o comprimento da barra. */
  proporcao: number;
  formatOnly: boolean;
}

/**
 * As alterações detectadas, abertas nas partições que as explicam.
 *
 * O cartão publicava "267" e uma frase que o contradiz: *"cada valor que mudou
 * entre a vigência anterior e esta"*. Em agosto/2026, **62 das 267 não são
 * valor que mudou** — são troca de formato pura, onde os dois lados valem o
 * mesmo e só a forma de exportar a coluna mudou. Um quarto do número mais lido
 * da tela descrevia outra coisa, e nada na tela dizia isso.
 *
 * Daí as três partições, e a regra que vale para as três: **cada uma soma
 * exatamente o total**, e todas contam alterações. Elas respondem perguntas
 * diferentes sobre o mesmo conjunto:
 *
 * - **o que aconteceu com o valor** — mexeu, ou só a forma mudou;
 * - **de que tipo foi o sinal** — o selo que o motor já atribuiu ao ponto;
 * - **o que a apuração fez** — virou dinheiro, saiu por dupla contagem, ou
 *   ficou sem preço.
 *
 * Nada aqui pede dado novo ao servidor: as três saem da mesma resposta que
 * desenhou o cartão. Dois pedidos seriam duas vigências possíveis, e duas
 * vigências é exatamente como o número do painel deixaria de bater com o de
 * cima.
 *
 * `null` quando a gaveta não foi pedida (`?detectadas=` ausente) ou quando a
 * vigência não detectou alteração nenhuma — um painel de composição sobre zero
 * é três barras vazias dizendo o que a tela já disse.
 */
export interface ComposicaoDasAlteracoes {
  total: number;
  /** `totals.groups` — os "pontos da remuneração tocados" que o cartão anuncia. */
  pontos: number;
  foco: FocoDeAlteracoes;
  /**
   * Mexeu no valor, ou só o formato mudou.
   *
   * Vazia quando não há troca de formato nenhuma, e isso é uma afirmação: quer
   * dizer que as 267 são 267 valores que mudaram. Uma partição de uma fatia só
   * não parte nada, e ocuparia a tela para dizer "100%".
   */
  porEfeito: FatiaDeAlteracoes[];
  /** O selo do motor, o de mais alterações primeiro. */
  porNatureza: FatiaDeAlteracoes[];
  /** O desfecho da apuração: dinheiro, dupla contagem, sem preço. */
  porApuracao: FatiaDeAlteracoes[];
  /** Os pontos tocados, o de mais alterações primeiro — já recortados pelo foco. */
  tocados: PontoTocado[];
  /** Quantos pontos existem sem o foco, para a lista dizer o que ela recortou. */
  tocadosNoTotal: number;
}

export function composicaoDasAlteracoes(
  view: GroupedView | null | undefined,
  foco: string | null,
  recorte: Recorte = RECORTE_VAZIO,
): ComposicaoDasAlteracoes | null {
  /*
    Sem `?detectadas=` na URL não há gaveta, e sem alteração não há composição.

    A mesma régua de `composicaoDoImpacto`, pela mesma razão: a chave da URL
    **é** o estado da gaveta, e um painel que nascesse aberto esconderia a tela
    atrás de algo que ninguém pediu.
  */
  if (!view || foco === null) return null;
  const total = view.totals.changes;
  if (total === 0) return null;

  const escolhido: FocoDeAlteracoes = focoValido(foco) ? foco : "todas";
  const daVigencia: Recorte = { ...recorte, period: view.period };
  const fatia = (valor: number) => (total === 0 ? 0 : valor / total);

  const formato = view.totals.formatOnlyChanges;
  const porEfeito: FatiaDeAlteracoes[] =
    formato === 0
      ? []
      : [
          {
            chave: "valor",
            rotulo: "Mexeram no valor",
            alteracoes: total - formato,
            pontos: null,
            proporcao: fatia(total - formato),
            href: null,
            nota: "O número dos dois lados é diferente. Só daqui pode sair impacto — troca de formato nunca vira dinheiro.",
          },
          {
            chave: "formato",
            rotulo: "Só o formato mudou",
            alteracoes: formato,
            pontos: null,
            proporcao: fatia(formato),
            href: null,
            /*
              Sem link, e não por falta de vontade: Alterações não tem filtro de
              formato. O caminho existe e é o de baixo — o foco recorta a lista
              de pontos, e de lá cada ponto abre as suas linhas.
            */
            nota: "A coluna mudou de forma; o valor dos dois lados é o mesmo, e nada disto vira dinheiro.",
          },
        ];

  const porNatureza: FatiaDeAlteracoes[] = [...view.cockpit.panorama.byBadge]
    /*
      Ordenado por alteração, e não por ponto como no Acompanhamento.

      As duas telas leem a mesma tabela e publicam colunas diferentes dela: lá a
      fila é de pontos, aqui o número que se abriu conta alterações. Cada uma
      ordena pelo que publica; ordenar por uma coluna e mostrar a outra é que
      faria a barra mais longa aparecer no meio da lista.
    */
    .sort((a, b) => b.changes - a.changes || a.label.localeCompare(b.label, "pt-BR"))
    .map((balde) => ({
      chave: balde.badge,
      rotulo: balde.label,
      alteracoes: balde.changes,
      pontos: balde.groups,
      proporcao: fatia(balde.changes),
      href: null,
      nota: null,
    }));

  const pricing = view.cockpit.panorama.pricing;
  /*
    Os três rótulos são os do Panorama do Acompanhamento, letra por letra.

    São os mesmos três números, lidos da mesma `pricing`. Dar-lhes nomes
    diferentes em duas telas do mesmo produto obrigaria quem visse as duas a
    descobrir sozinho que "viraram dinheiro" e "com valor apurado" são a mesma
    coisa — e a desconfiar quando descobrisse.
  */
  const porApuracao: FatiaDeAlteracoes[] = [
    {
      chave: "apurado",
      rotulo: "Com valor apurado",
      alteracoes: pricing.calculatedChanges,
      pontos: null,
      proporcao: fatia(pricing.calculatedChanges),
      href: null,
      nota: "Entraram no impacto líquido da vigência.",
    },
    {
      chave: "excluido",
      rotulo: "Fora do total (parcelas)",
      alteracoes: pricing.excludedChanges,
      pontos: null,
      proporcao: fatia(pricing.excludedChanges),
      href: null,
      nota: "Têm preço apurado, mas já estão contadas dentro de outro parâmetro — somá-las contaria o mesmo dinheiro duas vezes.",
    },
    {
      chave: "sem-preco",
      rotulo: "Sem preço",
      alteracoes: pricing.notCalculableChanges,
      pontos: null,
      proporcao: fatia(pricing.notCalculableChanges),
      href:
        pricing.notCalculableChanges === 0
          ? null
          : linkDeAlteracoes({
              recorte: daVigencia,
              filtros: { impactConfidence: "NOT_CALCULABLE" },
            }),
      /*
        O motivo sai do motor, e não de uma frase escrita aqui.

        A frase que morava neste lugar dizia "falta semântica confirmada", e ela
        é falsa para 62 das 248 de agosto/2026: aquelas não têm preço porque os
        dois lados não são comparáveis, que é outra coisa e manda procurar noutro
        lugar. `pricing.reasons` traz as sentenças que o motor de fato registrou,
        já ordenadas pela que explica mais alterações — é a mesma leitura que o
        Panorama do Acompanhamento publica.
      */
      nota: motivoDoPreco(pricing.reasons),
    },
  ].filter((f) => f.alteracoes > 0);

  const teto = view.groups.reduce((maior, g) => Math.max(maior, g.changes), 0);
  const tocados = view.groups
    .filter((grupo) =>
      escolhido === "valor"
        ? !grupo.formatOnly
        : escolhido === "formato"
          ? grupo.formatOnly
          : true,
    )
    .map((grupo) => ({
      chave: grupo.key,
      titulo: grupo.title,
      equipamento: grupo.equipment,
      badgeLabel: grupo.badgeLabel,
      alteracoes: grupo.changes,
      veiculos: grupo.vehicles,
      proporcao: teto === 0 ? 0 : grupo.changes / teto,
      formatOnly: grupo.formatOnly,
    }))
    .sort(
      (a, b) =>
        b.alteracoes - a.alteracoes ||
        b.veiculos - a.veiculos ||
        a.titulo.localeCompare(b.titulo, "pt-BR"),
    );

  return {
    total,
    pontos: view.totals.groups,
    foco: escolhido,
    porEfeito,
    porNatureza,
    porApuracao,
    tocados,
    tocadosNoTotal: view.groups.length,
  };
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
      valor: excluidoDaSoma(parametro.impact)[escolhida] ?? null,
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
   * O recorte deste grupo em Alterações — o mesmo que `detalheDaAlteracao`
   * monta para o mesmo grupo (`href` lá dentro).
   *
   * Existe para quem lista estas linhas fora da Visão geral (o Dashboard e a
   * Gestão à Vista): lá não há gaveta para abrir, e a linha precisa de um
   * destino que a mesma disciplina de recorte já garante.
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
 * A linha não carrega endereço nenhum, e é decisão e não esquecimento: ela abre
 * a gaveta de `detalheDaAlteracao`, que é quem sabe montar os endereços deste
 * item — a Planilha filtrada, a fila do Acompanhamento e a Curadoria da coluna.
 * Um `href` aqui seria um segundo destino para o mesmo clique, e o primeiro a
 * divergir seria o que ninguém está olhando.
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
// De onde vem uma alteração em destaque
// ---------------------------------------------------------------------------

/**
 * O que sustenta uma linha das Alterações em destaque.
 *
 * A lista afirma "Mudança sem preço — lucroVariavelPrevisto — Carreta, 10
 * ativos" e mandava para fora da tela: o clique trocava a Visão geral pela
 * Planilha filtrada, e quem só queria saber *por que aquilo está em destaque*
 * pagava uma navegação inteira — e voltava sem a resposta, porque a Planilha
 * lista linhas, não explica posições.
 *
 * Este detalhe é a mesma gaveta que os Maiores impactos abrem, sobre o mesmo
 * princípio: o item continua atrás, e o painel é a conta dele. A ordem das
 * seções é a ordem em que a pergunta chega — *por que está aqui em cima*, *o
 * que mudou de fato*, *o que falta para isto virar dinheiro*, e só então as
 * portas para as telas que continuam o assunto.
 */
export interface DetalheDeAlteracao {
  chave: string;
  tipo: TipoDeLinha;
  /** O mesmo título da linha da lista — o painel não renomeia o que abriu. */
  titulo: string;
  grupo: ChangeGroup;
  /**
   * A posição desta alteração na fila do cockpit, e a conta que a produziu.
   *
   * `null` quando o grupo não está na fila — não deveria acontecer, já que as
   * duas listas nascem da mesma resposta, e o painel simplesmente cala a seção
   * em vez de inventar uma criticidade.
   */
  prioridade: PriorityItem | null;
  /** O impacto escrito, quando o motor apurou preço. `null` quando não apurou. */
  valor: string | null;
  /**
   * Por que não há preço, na frase do motor.
   *
   * Sai de `impact.reason` ou de `inconclusiveReason` — as mesmas que a lista
   * mostra em letra pequena —, e existe só quando não há valor apurado: um
   * campo com "sem preço" ao lado de um número seria a tela discordando de si.
   */
  semPreco: string | null;
  /** As linhas desta alteração em Alterações, no recorte que ela sustenta. */
  href: string;
  /**
   * A fila de investigação desta vigência, no Acompanhamento.
   *
   * Leva a vigência e a unidade, e não o item: a investigação de um ponto abre
   * por clique dentro da tabela de lá, e não tem endereço próprio. Prometer um
   * na gaveta faria a tela abrir no lugar certo e no assunto errado.
   */
  hrefFila: string;
  /**
   * A fila da Curadoria já aberta nesta coluna — só quando falta confirmá-la.
   *
   * É a porta que responde à pergunta seguinte de toda mudança sem preço:
   * *como isto ganha preço?* Sem `attributeCode` não há o que abrir, e com a
   * semântica já confirmada a Curadoria não tem nada a dizer sobre esta linha.
   */
  hrefCuradoria: string | null;
  /**
   * As outras alterações da mesma coluna nesta vigência.
   *
   * A linha em destaque fala de um equipamento; a mesma coluna costuma ter
   * mudado no outro. Dizer quantas ficaram de fora — e abrir todas de uma vez —
   * evita que a gaveta se leia como "foi só isto".
   */
  mesmoAtributo: { grupos: number; veiculos: number; href: string } | null;
}

/**
 * O detalhe de uma alteração em destaque — o grupo, a sua posição na fila e as
 * portas que continuam o assunto.
 *
 * Sai da mesma resposta que desenhou a lista, e não de um pedido novo: o item
 * lido na Visão geral e o item lido na gaveta têm de ser o mesmo item, e dois
 * pedidos a vigências diferentes é exatamente como eles deixariam de ser.
 *
 * `null` quando a chave não está nesta vigência — o endereço com `?alteracao=`
 * continua colável, e um colado depois de trocar a vigência não abre um painel
 * vazio, do mesmo jeito que `?impacto=` não abre.
 */
export function detalheDaAlteracao(
  view: GroupedView | null | undefined,
  chave: string | null,
  recorte: Recorte = RECORTE_VAZIO,
): DetalheDeAlteracao | null {
  if (!view || !chave) return null;

  const grupo = view.groups.find((g) => g.key === chave);
  if (!grupo) return null;

  const daVigencia: Recorte = { ...recorte, period: view.period };
  const comPreco =
    grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null;

  /*
    As irmãs desta coluna, e só as desta vigência.

    Grupo sem `attributeCode` — um ativo que entrou, uma coluna que sumiu — não
    tem irmãs a apontar: agrupar por `null` juntaria coisas que não têm relação
    nenhuma entre si além de não terem código.
  */
  const irmas =
    grupo.attributeCode === null
      ? []
      : view.groups.filter(
          (g) => g.key !== grupo.key && g.attributeCode === grupo.attributeCode,
        );

  return {
    chave: grupo.key,
    tipo: tipoDaLinha(grupo),
    titulo: tituloDaLinha(grupo),
    grupo,
    prioridade: view.cockpit.priorities.find((p) => p.key === grupo.key) ?? null,
    valor: comPreco
      ? escreverImpacto({
          periodicity: grupo.impact.periodicity,
          amount: grupo.impact.amount as number,
        })
      : null,
    semPreco: comPreco ? null : (grupo.impact.reason ?? grupo.inconclusiveReason),
    href: linkDaAlteracao(grupo, daVigencia),
    hrefFila: `/vigencia?${paramsDoRecorte(daVigencia)}`,
    hrefCuradoria:
      grupo.attributeCode !== null && grupo.semanticsStatus !== "CONFIRMED"
        ? linkDeCuradoria(grupo)
        : null,
    mesmoAtributo:
      irmas.length > 0
        ? {
            grupos: irmas.length,
            veiculos: irmas.reduce((total, g) => total + g.vehicles, 0),
            /*
              Sem `entityType`: o que este link promete é a coluna inteira, nos
              equipamentos todos. Levar o equipamento da linha aberta devolveria
              a própria linha e nada mais, sob um rótulo que promete o resto.
            */
            href: linkDeAlteracoes({
              recorte: daVigencia,
              filtros: { attributeCode: grupo.attributeCode as string },
            }),
          }
        : null,
  };
}

/** A fila da Curadoria aberta na coluna — e na aba do equipamento dela. */
function linkDeCuradoria(grupo: ChangeGroup): string {
  const params = new URLSearchParams({ atributo: grupo.attributeCode as string });
  if (grupo.entityType !== null) params.set("equipamento", grupo.entityType);
  return `/curadoria?${params}`;
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

/**
 * Por que falta preço, na frase do motor — e quantas outras razões existem.
 *
 * `null` quando o motor não registrou motivo nenhum: um "sem preço" sem
 * explicação é honesto, e inventar uma explicação para ele não é.
 */
function motivoDoPreco(
  reasons: { reason: string; groups: number; changes: number }[],
): string | null {
  if (reasons.length === 0) return null;
  const extras =
    reasons.length > 1
      ? ` (+${reasons.length - 1} ${reasons.length === 2 ? "outro motivo" : "outros motivos"})`
      : "";
  return `${reasons[0].reason}${extras}`;
}

function inteiro(valor: number): string {
  return valor.toLocaleString("pt-BR");
}
