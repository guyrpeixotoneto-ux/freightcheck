import {
  escreverImpacto,
  escreverPercentual,
  impactoPorFamilia,
  ladosDoImpacto,
  qualidadeDaCobertura,
  type ImpactoDeFamilia,
  type LadosDoImpacto,
  type Tom,
} from "@/lib/visao-geral";
import { linkDeAlteracoes, type Recorte } from "@/lib/recorte";
import { formatBrlShort } from "@/lib/format";
import type { ItemCockpit } from "@/lib/cockpit";
import type { FamiliesView } from "@/components/inicio/types";
import type { PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";

/**
 * O Impacto Apurado — a leitura executiva do que o Dashboard já apurou.
 *
 * **Nada aqui apura dinheiro.** Toda função deste arquivo é uma projeção sobre
 * `ExecutiveSummary.sides`, o mesmo campo que o Impacto Líquido lê e que o
 * servidor produz numa varredura só (`lib/comparison/src/families-view.ts`).
 * Não há uma segunda soma, um segundo critério de dupla contagem, nem um
 * segundo conceito de ganho e perda: se houvesse, os dois módulos da seção
 * Dashboard publicariam dois números para a mesma vigência, e quem visse os
 * dois não teria como saber qual acreditar.
 *
 * O que este arquivo acrescenta é **ordem de leitura**, e ela é a da pergunta
 * executiva: o resultado (`mancheteApurada`), a confiança nele
 * (`coberturaApurada`), a explicação (`ponteDoImpacto`), a evolução
 * (`extremosDaSerie`), onde está o dinheiro (`mudancasRelevantes`) e o que
 * fazer agora (`ondeAgirAgora`).
 *
 * Duas regras atravessam o arquivo inteiro:
 *
 * 1. **Zero não é ausência.** Toda função devolve `null` — nunca um zero —
 *    quando a pergunta não tem resposta no dado. "Nenhuma alteração foi
 *    precificada" e "as alterações precificadas somam R$ 0,00" são fatos
 *    diferentes, e a tela precisa poder dizer os dois.
 * 2. **Uma periodicidade por vez.** R$/mês e R$/ano não somam, aqui nem em
 *    lugar nenhum do produto. Toda leitura escolhe uma periodicidade e nomeia
 *    as que ficaram de fora, em vez de deixá-las sumir.
 *
 * Nada neste arquivo lê a rede: a entrada é sempre o JSON que
 * `GET /changes/families` (ou `/changes/families/overview`) já devolveu.
 */

/** O resumo que a tela lê de `summary` — `FamiliesView` ou `FamiliesOverview`. */
type ComResumo = Pick<FamiliesView, "summary">;

// ---------------------------------------------------------------------------
// 1. Quanto já conseguimos apurar?
// ---------------------------------------------------------------------------

/**
 * A manchete — o líquido apurado da periodicidade que mais se mexeu, com os
 * dois lados que o formam.
 *
 * É `ladosDoImpacto(view)[0]`, sem uma linha de conta a mais: a ordenação por
 * módulo, a garantia de que `ganhos + perdas = liquido` e a partição por linha
 * de alteração vêm todas de lá. `null` quando a vigência não tem impacto
 * apurado em periodicidade nenhuma — e aí a tela diz isso, em vez de publicar
 * R$ 0.
 */
export function mancheteApurada(view: ComResumo | null | undefined): LadosDoImpacto | null {
  return ladosDoImpacto(view)[0] ?? null;
}

/** As outras periodicidades da vigência — as que a manchete não cobre. */
export function outrasPeriodicidades(view: ComResumo | null | undefined): LadosDoImpacto[] {
  return ladosDoImpacto(view).slice(1);
}

// ---------------------------------------------------------------------------
// 2. Posso confiar nesse número?
// ---------------------------------------------------------------------------

export interface CoberturaApurada {
  /** Alterações que já viraram dinheiro — apuradas ou excluídas por dupla contagem. */
  apurado: number;
  /** Alterações da vigência sem preço apurado. `apurado + semPreco = total`. */
  semPreco: number;
  /** Alterações elegíveis: todas as linhas de alteração da vigência. */
  total: number;
  percentual: number;
  /** O adjetivo e o tom, pela régua canônica de `qualidadeDaCobertura`. */
  qualidade: { palavra: string; tom: Tom };
  /** Se ainda há alteração sem preço — o que torna o resultado parcial. */
  parcial: boolean;
}

/**
 * Quanto desta vigência já está financeiramente coberto.
 *
 * A fração é **alterações precificadas ÷ alterações elegíveis**, a mesma que o
 * Impacto Líquido publica no anel de cobertura, e a identidade
 * `apurado + semPreco = total` é a de `porApuracao` em
 * `composicaoDasAlteracoes`. Precificada é toda linha com valor apurado em
 * qualquer periodicidade — inclusive as apuradas em R$ 0,00 e as que já contam
 * noutra parcela.
 *
 * **A régua de severidade não é nova.** `qualidadeDaCobertura` já decide, num
 * lugar só, quando uma cobertura é Excelente, Alta, Parcial ou Baixa (99 / 95 /
 * 85), e é ela que decide a cor da faixa. Inventar um segundo corte aqui faria
 * a mesma cobertura ser "parcial" numa tela e "baixa" na outra.
 *
 * `null` sem alteração nenhuma: `0/0` não é cobertura zero, é vigência sem
 * alteração — e a tela tem uma frase própria para isso.
 */
export function coberturaApurada(
  total: number,
  semPreco: number,
): CoberturaApurada | null {
  if (total <= 0) return null;
  const apurado = total - semPreco;
  const percentual = (apurado / total) * 100;
  return {
    apurado,
    semPreco,
    total,
    percentual,
    qualidade: qualidadeDaCobertura(percentual),
    parcial: semPreco > 0,
  };
}

/** A frase da faixa de cobertura — a manchete da confiança, sem número inventado. */
export function frasesDaCobertura(cobertura: CoberturaApurada): {
  titulo: string;
  detalhe: string;
} {
  if (!cobertura.parcial) {
    return {
      titulo: `Resultado completo · as ${cobertura.total.toLocaleString("pt-BR")} alterações desta vigência têm impacto financeiro apurado.`,
      detalhe: "Nenhuma alteração ficou sem preço — o valor acima cobre a vigência inteira.",
    };
  }
  const uma = cobertura.semPreco === 1;
  return {
    titulo:
      `Resultado parcial · apenas ${cobertura.apurado.toLocaleString("pt-BR")} de ` +
      `${cobertura.total.toLocaleString("pt-BR")} alterações (${escreverPercentual(cobertura.percentual)}) ` +
      "possuem impacto financeiro apurado.",
    detalhe:
      `${cobertura.semPreco.toLocaleString("pt-BR")} ${uma ? "alteração ainda não possui" : "alterações ainda não possuem"} ` +
      `preço apurado e ${uma ? "pode alterar" : "podem alterar"} o resultado final.`,
  };
}

// ---------------------------------------------------------------------------
// 3. O que explica o resultado? — a ponte
// ---------------------------------------------------------------------------

/**
 * Por qual eixo o resultado é decomposto.
 *
 * Hoje há um só — a família de remuneração, que é como o Freightech organiza a
 * própria tabela e como o resto do produto já agrupa. O tipo existe para que o
 * segundo eixo (por equipamento, por unidade) seja uma entrada neste mapa e uma
 * função ao lado de `degrausPorFamilia`, e não um `if` novo dentro do gráfico.
 */
export type Decomposicao = "familia";

export const DECOMPOSICOES: Record<Decomposicao, string> = {
  familia: "Por família",
};

export interface DegrauDaPonte {
  /** O código da família — o que a gaveta de detalhe recebe. */
  code: string;
  name: string;
  /** O líquido da família nesta periodicidade: o tamanho do degrau. */
  valor: number;
  ganhos: number;
  perdas: number;
  alteracoes: number;
  /** Onde o degrau começa no eixo — a soma dos degraus anteriores. */
  base: number;
  /** Onde ele termina: `base + valor`. */
  topo: number;
}

export interface PonteDoImpacto {
  periodicity: string;
  /** As famílias que somam no líquido: as que subiram primeiro, as que desceram depois. */
  degraus: DegrauDaPonte[];
  /** O líquido apurado da periodicidade — a autoridade, lida de `sides`. */
  total: number;
  /**
   * O que os degraus não explicam — `total − Σ degraus`.
   *
   * É zero por construção (os degraus saem do mesmo `sides` de onde sai o
   * total), e fica exposto pela mesma razão que `DetalheDeImpacto.resto`: uma
   * ponte que silencia a diferença entre a própria soma e o número que ela
   * explica é pior do que não ter ponte.
   */
  resto: number;
  /** As periodicidades que esta ponte não desenha. Nomeadas, nunca somadas. */
  outras: string[];
}

/**
 * De onde veio o líquido — o gráfico de ponte da tela.
 *
 * Lê `impactoPorFamilia`, que abre `summary.sides` por família com os dois
 * lados separados; o degrau é o **líquido** de cada família, e é por isso que a
 * soma dos degraus é o líquido da vigência. Os ganhos e as perdas de cada
 * família viajam junto para que uma barra verde de saldo pequeno possa dizer
 * que houve R$ 40 mil dos dois lados dentro dela.
 *
 * A ordem é a da leitura executiva: o que somou, do maior para o menor, e
 * depois o que tirou — assim o eixo sobe e desce uma vez só, em vez de
 * serrilhar. Famílias com líquido exatamente zero ficam de fora do desenho:
 * um degrau de altura nenhuma não explica nada e ocupa a largura de um que
 * explicaria.
 *
 * `null` quando a periodicidade pedida não existe na vigência.
 */
export function ponteDoImpacto(
  view: ComResumo | null | undefined,
  periodicidade: string | null,
): PonteDoImpacto | null {
  if (!view || periodicidade === null) return null;
  const lados = ladosDoImpacto(view);
  const lado = lados.find((l) => l.periodicity === periodicidade);
  if (!lado) return null;

  const familias = impactoPorFamilia(view, periodicidade);
  const positivas = familias.filter((f) => f.liquido > 0).sort((a, b) => b.liquido - a.liquido);
  const negativas = familias.filter((f) => f.liquido < 0).sort((a, b) => a.liquido - b.liquido);

  let base = 0;
  const degraus = [...positivas, ...negativas].map((familia) => {
    const degrau: DegrauDaPonte = {
      code: familia.code,
      name: familia.name,
      valor: familia.liquido,
      ganhos: familia.ganhos,
      perdas: familia.perdas,
      alteracoes: familia.alteracoes,
      base,
      topo: Number((base + familia.liquido).toFixed(2)),
    };
    base = degrau.topo;
    return degrau;
  });

  return {
    periodicity: periodicidade,
    degraus,
    total: lado.liquido,
    resto: Number((lado.liquido - base).toFixed(2)),
    outras: lados.filter((l) => l.periodicity !== periodicidade).map((l) => l.periodicity),
  };
}

// ---------------------------------------------------------------------------
// 4. Como ele evoluiu? — os extremos da série
// ---------------------------------------------------------------------------

export interface ExtremosDaSerie {
  melhor: PontoDeImpacto;
  pior: PontoDeImpacto;
}

/**
 * A melhor e a pior vigência da janela desenhada.
 *
 * `null` com menos de dois pontos: com um ponto só, "melhor" e "pior" seriam a
 * mesma vigência escrita duas vezes — uma comparação que não aconteceu.
 *
 * A leitura é sobre os pontos **que estão na tela**, e não sobre o histórico
 * inteiro: quem lê "pior vigência" embaixo de um gráfico de seis barras espera
 * a pior das seis.
 */
export function extremosDaSerie(pontos: PontoDeImpacto[]): ExtremosDaSerie | null {
  if (pontos.length < 2) return null;
  let melhor = pontos[0];
  let pior = pontos[0];
  for (const ponto of pontos) {
    if (ponto.liquido > melhor.liquido) melhor = ponto;
    if (ponto.liquido < pior.liquido) pior = ponto;
  }
  return { melhor, pior };
}

// ---------------------------------------------------------------------------
// 5. Onde está o dinheiro? — as principais mudanças
// ---------------------------------------------------------------------------

export type FiltroDeMudanca = "todos" | "ganhos" | "perdas";

export const FILTROS_DE_MUDANCA: FiltroDeMudanca[] = ["todos", "ganhos", "perdas"];

export const ROTULO_DO_FILTRO: Record<FiltroDeMudanca, string> = {
  todos: "Todos",
  ganhos: "Ganhos",
  perdas: "Perdas",
};

export function filtroDeMudancaValido(valor: string | null): valor is FiltroDeMudanca {
  return valor === "todos" || valor === "ganhos" || valor === "perdas";
}

export interface MudancaRelevante {
  /** A chave do parâmetro — a mesma de `ExecutiveSummary.topParameters`. */
  key: string;
  name: string;
  familyCode: string;
  familyName: string;
  /** O que este parâmetro somou. Sempre ≥ 0. */
  ganhos: number;
  /** O que ele tirou. Sempre ≤ 0 — o sinal fica. */
  perdas: number;
  liquido: number;
  /** `ganhos + |perdas|` — quanto dinheiro se mexeu. É por ele que a lista ordena. */
  movimento: number;
  /** Alterações com preço deste parâmetro, dos dois lados. */
  alteracoes: number;
  /** Veículos do lado que pesa mais — nunca a soma dos dois, que contaria duas vezes. */
  veiculos: number;
  classificacao: "ganho" | "perda";
  /** Do maior movimento da lista: 0 a 1. É o comprimento da barra, e nada mais. */
  proporcao: number;
  /** Se o parâmetro se mexeu nos dois sentidos — a linha diz isso em vez de esconder. */
  doisLados: boolean;
}

/**
 * O ranking unificado de ganhos e perdas — os parâmetros que mais mexeram no
 * resultado, dentro de uma periodicidade.
 *
 * Sai de `summary.sides`, o único lugar do contrato onde os dois sinais existem
 * separados por linha de alteração. Um parâmetro que subiu em oito ativos e
 * caiu em dois aparece **uma vez**, com os dois números e o líquido dos dois —
 * é a mesma régua de `impactoPorFamilia`, um degrau abaixo.
 *
 * **A ordem é pelo movimento, e não pelo saldo.** Um parâmetro que somou
 * R$ 40 mil num lugar e tirou R$ 39 mil noutro tem saldo de R$ 1.000 e é o
 * maior acontecimento da vigência; ranqueado pelo saldo ele apareceria em
 * último, ou sumiria se o saldo desse exatamente zero. É a mesma decisão que
 * `ImpactoDeFamilia.movimento` documenta — e é o oposto de ranquear por
 * quantidade de ocorrências, que poria uma alteração de R$ 3,00 em cem
 * veículos acima de uma de R$ 30 mil em um.
 *
 * `[]` quando a periodicidade não existe na vigência — nunca uma lista de
 * parâmetros zerados, que se leria como "nada mexeu".
 */
export function mudancasRelevantes(
  view: ComResumo | null | undefined,
  periodicidade: string | null,
): MudancaRelevante[] {
  const sides = view?.summary.sides ?? [];
  if (periodicidade === null || sides.length === 0) return [];
  const lado = sides.find((s) => s.periodicity === periodicidade);
  if (!lado) return [];

  interface Acumulado extends Omit<MudancaRelevante, "movimento" | "classificacao" | "proporcao" | "doisLados"> {
    veiculosGanho: number;
    veiculosPerda: number;
  }

  const porChave = new Map<string, Acumulado>();
  const acumular = (
    contribuintes: typeof lado.gains.parameters,
    sinal: "ganho" | "perda",
  ) => {
    for (const p of contribuintes) {
      const atual = porChave.get(p.key) ?? {
        key: p.key,
        name: p.name,
        familyCode: p.family,
        familyName: p.familyName,
        ganhos: 0,
        perdas: 0,
        liquido: 0,
        alteracoes: 0,
        veiculos: 0,
        veiculosGanho: 0,
        veiculosPerda: 0,
      };
      if (sinal === "ganho") {
        atual.ganhos += p.amount;
        atual.veiculosGanho += p.vehicles;
      } else {
        atual.perdas += p.amount;
        atual.veiculosPerda += p.vehicles;
      }
      atual.alteracoes += p.changes;
      porChave.set(p.key, atual);
    }
  };

  acumular(lado.gains.parameters, "ganho");
  acumular(lado.losses.parameters, "perda");

  const linhas = [...porChave.values()].map((a) => {
    const liquido = Number((a.ganhos + a.perdas).toFixed(2));
    return {
      key: a.key,
      name: a.name,
      familyCode: a.familyCode,
      familyName: a.familyName,
      ganhos: Number(a.ganhos.toFixed(2)),
      perdas: Number(a.perdas.toFixed(2)),
      liquido,
      movimento: Number((a.ganhos + Math.abs(a.perdas)).toFixed(2)),
      alteracoes: a.alteracoes,
      /*
        O maior dos dois lados, e não a soma: o mesmo veículo pode ter subido
        num atributo e caído noutro dentro do mesmo parâmetro, e somar os dois
        lados o contaria duas vezes. O maior é o piso honesto — "pelo menos
        tantos ativos".
      */
      veiculos: Math.max(a.veiculosGanho, a.veiculosPerda),
      classificacao: (liquido < 0 ? "perda" : "ganho") as "ganho" | "perda",
      doisLados: a.ganhos > 0 && a.perdas < 0,
    };
  });

  const teto = Math.max(...linhas.map((l) => l.movimento), 0);
  return linhas
    .map((l) => ({ ...l, proporcao: teto === 0 ? 0 : l.movimento / teto }))
    .sort((a, b) => b.movimento - a.movimento);
}

/**
 * O recorte da lista — Todos, Ganhos ou Perdas.
 *
 * Em **Ganhos** e **Perdas** a linha é ranqueada e desenhada pelo lado pedido,
 * e não pelo líquido: quem clicou em "Perdas" quer as maiores perdas, inclusive
 * as que estão dentro de um parâmetro cujo saldo é positivo. É por isso que a
 * função devolve linhas com `movimento` e `proporcao` recalculados sobre o lado
 * escolhido, em vez de só filtrar as do sinal do saldo.
 */
export function filtrarMudancas(
  linhas: MudancaRelevante[],
  filtro: FiltroDeMudanca,
): MudancaRelevante[] {
  if (filtro === "todos") return linhas;

  const doLado = linhas
    .filter((l) => (filtro === "ganhos" ? l.ganhos > 0 : l.perdas < 0))
    .map((l) => ({
      ...l,
      movimento: filtro === "ganhos" ? l.ganhos : Math.abs(l.perdas),
      classificacao: (filtro === "ganhos" ? "ganho" : "perda") as "ganho" | "perda",
    }));

  const teto = Math.max(...doLado.map((l) => l.movimento), 0);
  return doLado
    .map((l) => ({ ...l, proporcao: teto === 0 ? 0 : l.movimento / teto }))
    .sort((a, b) => b.movimento - a.movimento);
}

/** O valor que a linha publica no recorte aberto — o lado pedido, ou o líquido. */
export function valorDaMudanca(linha: MudancaRelevante, filtro: FiltroDeMudanca): number {
  if (filtro === "ganhos") return linha.ganhos;
  if (filtro === "perdas") return linha.perdas;
  return linha.liquido;
}

// ---------------------------------------------------------------------------
// 6. Onde agir agora?
// ---------------------------------------------------------------------------

export interface AcaoAgora {
  chave: string;
  tom: Tom;
  titulo: string;
  detalhe: string;
  /** O destino que responde a este item — `null` quando nenhuma tela responde exatamente. */
  href: string | null;
}

/**
 * O que exige atenção nesta vigência — **derivado do dado, nunca inventado**.
 *
 * Cada item existe porque um campo do contrato o sustenta, e nenhum nasce de
 * um limiar escrito aqui:
 *
 * | Item | O que o sustenta |
 * |---|---|
 * | Alterações sem preço | `impact.notCalculable` |
 * | Cobertura financeira | `coberturaApurada` + a régua de `qualidadeDaCobertura` |
 * | Perdas relevantes | a fila do cockpit (`priorities`), severidade CRÍTICO/ALTO com impacto negativo |
 * | Famílias com alteração crítica | `FamilyView.critical` — grupos com selo DINHEIRO ou RUPTURA |
 * | Vigência sem anterior | `cockpit.baseline.hasBaseline` |
 *
 * A severidade da fila e o selo dos grupos são decididos em
 * `lib/comparison/src/cockpit.ts` e `classification.ts`, no servidor, e
 * testados lá contra o export real. Aqui só se lê o veredito.
 *
 * Um item sem tela que responda **exatamente** à população que ele contou sai
 * com `href: null` em vez de com um destino aproximado — a regra de
 * `PontoDeAtencao.href`, e a razão pela qual a Visão Geral não aponta para
 * telas que recortam por unidade.
 */
export function ondeAgirAgora({
  view,
  cobertura,
  periodicidade,
  prioridades,
  recorte,
  comDestino,
}: {
  view: FamiliesView;
  cobertura: CoberturaApurada | null;
  periodicidade: string | null;
  /** A fila do cockpit já juntada aos grupos — `juntarPrioridades`. */
  prioridades: ItemCockpit[];
  recorte: Recorte;
  /**
   * Se os itens podem apontar para uma tela.
   *
   * Falso na Visão Geral: as telas de destino recortam por unidade, e um
   * endereço sem `scopeHash` cai na unidade padrão do servidor — o item abriria
   * a lista de **uma** unidade debaixo de um número que somou todas.
   */
  comDestino: boolean;
}): AcaoAgora[] {
  const acoes: AcaoAgora[] = [];
  const daVigencia: Recorte = { ...recorte, period: view.period };
  const destino = (href: string) => (comDestino ? href : null);

  const semPreco = view.impact.notCalculable;
  if (semPreco > 0) {
    const uma = semPreco === 1;
    acoes.push({
      chave: "sem-preco",
      tom: "atencao",
      titulo: `${semPreco.toLocaleString("pt-BR")} ${uma ? "alteração sem" : "alterações sem"} preço apurado`,
      detalhe: uma ? "Pode alterar o resultado final." : "Podem alterar o resultado final.",
      href: destino(
        linkDeAlteracoes({
          recorte: daVigencia,
          filtros: { impactConfidence: "NOT_CALCULABLE" },
        }),
      ),
    });
  }

  if (cobertura && cobertura.qualidade.tom !== "ok") {
    acoes.push({
      chave: "cobertura",
      tom: cobertura.qualidade.tom,
      titulo: `Cobertura financeira ${cobertura.qualidade.palavra.toLowerCase()}`,
      detalhe:
        `Apenas ${escreverPercentual(cobertura.percentual)} das alterações têm impacto apurado. ` +
        "A Curadoria é onde uma alteração ganha preço.",
      href: destino("/curadoria"),
    });
  }

  const perdas = perdasParaAuditar(prioridades, periodicidade);
  if (perdas) {
    acoes.push({
      chave: "perdas-para-auditar",
      tom: "grave",
      titulo: `${perdas.quantidade.toLocaleString("pt-BR")} ${perdas.quantidade === 1 ? "perda relevante" : "perdas relevantes"} para auditar`,
      detalhe: `Representam ${escreverImpacto({ periodicity: perdas.periodicity, amount: perdas.total })} na fila do Acompanhamento.`,
      href: destino(linkDoAcompanhamento(daVigencia)),
    });
  }

  const criticas = view.families.filter((f) => f.critical > 0);
  if (criticas.length > 0) {
    const grupos = criticas.reduce((soma, f) => soma + f.critical, 0);
    acoes.push({
      chave: "familias-criticas",
      tom: "atencao",
      titulo: `${criticas.length.toLocaleString("pt-BR")} ${criticas.length === 1 ? "família" : "famílias"} com alteração crítica`,
      detalhe: `${grupos.toLocaleString("pt-BR")} ${grupos === 1 ? "tipo de alteração" : "tipos de alteração"} com selo de dinheiro ou ruptura.`,
      href: destino(`/parametros?${new URLSearchParams({ period: view.period })}`),
    });
  }

  if (!view.cockpit.baseline.hasBaseline) {
    acoes.push({
      chave: "sem-baseline",
      tom: "atencao",
      titulo: "Vigência sem anterior para comparar",
      detalhe: "O resultado desta competência não tem base de comparação importada.",
      href: destino("/vigencias"),
    });
  }

  return acoes;
}

/**
 * As perdas que a fila do cockpit marcou como críticas ou altas.
 *
 * A severidade é do servidor; o que se faz aqui é recortar a fila pelo sinal do
 * impacto e pela periodicidade da manchete — somar uma perda mensal com uma
 * anual daria um total que nenhuma das duas grandezas justifica.
 *
 * `null` quando não há nenhuma: um "0 perdas relevantes" é um item que ocupa
 * espaço para dizer que não tem o que dizer.
 */
export function perdasParaAuditar(
  prioridades: ItemCockpit[],
  periodicidade: string | null,
): { quantidade: number; total: number; periodicity: string } | null {
  if (periodicidade === null) return null;
  const relevantes = prioridades.filter(
    ({ item, group }) =>
      (item.severity === "CRITICO" || item.severity === "ALTO") &&
      group.impact.confidence === "CALCULATED" &&
      group.impact.amount !== null &&
      group.impact.amount < 0 &&
      group.impact.periodicity === periodicidade,
  );
  if (relevantes.length === 0) return null;
  return {
    quantidade: relevantes.length,
    total: Number(
      relevantes.reduce((soma, { group }) => soma + (group.impact.amount ?? 0), 0).toFixed(2),
    ),
    periodicity: periodicidade,
  };
}

/**
 * A fila do Acompanhamento no mesmo recorte — o destino das perdas relevantes.
 *
 * É a tela que publica essa fila, na mesma ordem e da mesma autoridade: quem
 * chega encontra no topo exatamente os itens que o cartão contou. O foco da
 * fila é estado da tela e não viaja na URL, então o item promete a fila e não
 * um filtro — e a frase dele diz isso.
 */
function linkDoAcompanhamento(recorte: Recorte): string {
  const params = new URLSearchParams();
  if (recorte.period) params.set("period", recorte.period);
  if (recorte.scopeHash) params.set("scopeHash", recorte.scopeHash);
  if (recorte.canal !== null && recorte.canal !== undefined) params.set("canal", recorte.canal);
  const consulta = params.toString();
  return consulta ? `/vigencia?${consulta}` : "/vigencia";
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** `+R$ 21.931` — o mais na frente do ganho, que `formatBrlShort` não escreve. */
export function comSinal(valor: number): string {
  return valor > 0 ? `+${formatBrlShort(valor)}` : formatBrlShort(valor);
}

/** Uma família da ponte, escrita como a gaveta de detalhe a nomeia. */
export function escreverDegrau(degrau: DegrauDaPonte, periodicity: string): string {
  return `${degrau.name}: ${escreverImpacto({ periodicity, amount: degrau.valor })}`;
}

export type { ImpactoDeFamilia };
