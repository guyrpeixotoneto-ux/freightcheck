import {
  periodicidadePrincipal,
  periodicidadesDaLeitura,
} from "@workspace/comparison/contrato-de-impacto";
import {
  escreverImpacto,
  escreverPercentual,
  frotaTotal,
  maioresImpactos,
  participacao,
  ultimaImportacao,
  variacao,
  type ImpactoDeFamilia,
  type LadosDoImpacto,
  type Tom,
  type UltimaImportacao,
} from "./visao-geral";
import {
  coberturaDaVigencia,
  filtrarMudancas,
  ondeAgirAgora,
  outrasPeriodicidades,
  situacaoDaApuracao,
  valorDaMudanca,
  type AcaoAgora,
  type CoberturaApurada,
  type FiltroDeMudanca,
  type MudancaRelevante,
  type SituacaoDaApuracao,
} from "./impacto-apurado";
import { linkDeAlteracoes, RECORTE_VAZIO, type Recorte } from "./recorte";
import type { ItemCockpit } from "./cockpit";
import type { BalancoDoRecorte } from "@/components/balanco/tipos";
import type { FamiliesOverview, FamiliesView } from "@/components/inicio/types";

/**
 * O Panorama Executivo — os seis andares, montados num lugar só.
 *
 * O produto tinha quatro módulos de leitura executiva — Impacto Líquido,
 * Impacto Apurado, Resumo executivo e Linha do Tempo — que liam **a mesma
 * resposta do servidor, sob as mesmas chaves de cache**, e publicavam três
 * blocos idênticos nos quatro. Não eram quatro perguntas: eram quatro
 * formatos, cada um herdado de um momento diferente da história do produto.
 * `docs/PROPOSTA-PANORAMA-EXECUTIVO.md` mede essa sobreposição nos arquivos.
 *
 * Este módulo é o quinto, e a regra que o governa é uma só:
 *
 * > **Nada aqui apura dinheiro.** Toda conta é projeção de `ExecutiveSummary`
 * > por função que já existia e já era testada — `lib/visao-geral.ts`,
 * > `lib/impacto-apurado.ts`, `lib/cockpit.ts`. Não há endpoint novo, não há
 * > segunda soma e não há regra de negócio dentro do JSX. Se houvesse, o
 * > Panorama publicaria um líquido diferente do Impacto Apurado — a quinta
 * > verdade sobre o mesmo dado, que é exatamente o defeito que ele existe para
 * > curar.
 *
 * **Uma leitura só atravessa os seis andares.** {@link LeituraDoPanorama} é o
 * que a unidade e a Visão Geral têm em comum, e os dois adaptadores
 * ({@link leituraDaUnidade}, {@link leituraDaVisaoGeral}) são o único lugar
 * onde a diferença entre as duas respostas do servidor é resolvida. Daí para
 * baixo, o corpo da tela é o mesmo — que é o que impede a Visão Geral de
 * virar, com o tempo, uma segunda tela parecida.
 *
 * **O que cada andar responde**, na ordem em que a pergunta chega:
 *
 * | # | Pergunta | Aqui |
 * |---|---|---|
 * | 1 | Quanto custou esta vigência? | {@link vereditoDoPanorama} |
 * | 2 | E os outros números? | {@link placarDoPanorama} |
 * | 3 | De onde vem esse número? | `ponteDoImpacto` · `mudancasRelevantes` |
 * | 4 | Estamos melhorando ou piorando? | `useSerieDeImpacto` (hook, na tela) |
 * | 5 | Onde isso aconteceu? | {@link mapaDoPanorama} |
 * | 6 | Posso confiar nisto? | {@link procedenciaDoPanorama} |
 *
 * Houve um sétimo andar, "o que eu faço agora": uma fila de trabalho que fundia
 * as três que o produto tinha. Ela saiu, e por não ser leitura — mandava embora
 * em vez de responder sobre a vigência lida, o que é uma tela de execução
 * dentro de uma tela de leitura. Os destinos dela continuam alcançáveis de onde
 * a pergunta nasce, e `ondeAgirAgora` (`lib/impacto-apurado.ts`) continua sendo
 * a fila canônica de quem precisar de uma.
 *
 * Os andares 3 e 4 não têm função aqui porque já tinham a delas: a ponte e a
 * série são leituras que o Impacto Apurado e o Impacto Líquido já montavam, e
 * reescrevê-las neste arquivo seria a duplicação que o módulo veio desfazer.
 */

// ---------------------------------------------------------------------------
// A leitura — o que a unidade e a Visão Geral têm em comum
// ---------------------------------------------------------------------------

/**
 * O que os seis andares precisam saber, vindo de qualquer das duas leituras.
 *
 * Os campos são os que **as duas** respostas sabem responder. O que só uma
 * delas tem — a árvore de parâmetros, a fila do cockpit, a unidade a quem
 * abrir gaveta — não entra aqui: viaja à parte, e cada andar declara se sabe
 * viver sem.
 */
export interface LeituraDoPanorama {
  /** O resumo executivo — a fonte de todo valor apurado da tela. */
  resumo: Pick<FamiliesView, "summary">;
  /** Alterações detectadas na vigência — `totals.changes`. */
  alteracoes: number;
  /** Tipos de alteração tocados — `null` quando a leitura não sabe contá-los. */
  tiposDeAlteracao: number | null;
  /** Ativos tocados. */
  veiculos: number;
  /**
   * Se {@link veiculos} conta ativos distintos ou soma unidades.
   *
   * Na Visão Geral o servidor só devolve a união em `vehiclesTouchedDistinct`,
   * e uma resposta de versão anterior ainda em cache não a traz. Quando é
   * soma, a tela diz que é soma — chamar de "distinto" um número que não é
   * seria a mesma classe de erro das duas coberturas com nome parecido.
   */
  veiculosDeduplicados: boolean;
  /** A frota que a vigência entregou — `null` sem denominador confiável. */
  frota: number | null;
  /**
   * Quantos equipamentos da frota respondem `ATIVO` na coluna `ativo` — e
   * quantos respondem que não.
   *
   * Não se deduz um do outro nem da frota: quem não trouxe a coluna não é
   * parado, é sem resposta. As três pontas viajam separadas justamente para
   * que a nota do card não invente a terceira. Ver `CockpitKpis.ativosNaFrota`.
   *
   * Zero quando a resposta não os traz — uma versão anterior ainda em cache —,
   * e zero aqui quer dizer "ninguém respondeu", que é o caso em que a nota
   * cala. Nunca `undefined`: quem lê esta leitura já pode contar.
   */
  ativosNaFrota: number;
  inativosNaFrota: number;
  /** Ativos que entraram na vigência. */
  entraram: number;
  /** Ativos que saíram. */
  sairam: number;
}

/** A leitura de uma unidade — `GET /changes/families`. */
export function leituraDaUnidade(view: FamiliesView): LeituraDoPanorama {
  return {
    resumo: view,
    alteracoes: view.totals.changes,
    tiposDeAlteracao: view.totals.groups,
    veiculos: view.totals.vehiclesTouched,
    veiculosDeduplicados: true,
    /*
      `?? null` porque `CockpitKpis.fleet` é declarado `number` e pode chegar
      ausente de uma resposta anterior ainda em cache. O campo daqui promete
      `number | null` — "`null` sem denominador confiável" —, e `undefined`
      passando por ele fazia todo consumidor que testa `=== null` tratar a
      ausência como um número.
    */
    frota: frotaTotal(view) ?? null,
    ativosNaFrota: view.cockpit.kpis.ativosNaFrota ?? 0,
    inativosNaFrota: view.cockpit.kpis.inativosNaFrota ?? 0,
    entraram: view.totals.entitiesAdded,
    sairam: view.totals.entitiesRemoved,
  };
}

/**
 * A leitura somada — `GET /changes/families/overview`.
 *
 * `vehiclesTouchedDistinct` é a união dos ativos das unidades; `summary
 * .vehiclesTouched` é a soma delas. A união é a resposta certa, e quando ela
 * não veio a tela publica a soma **dizendo** que é soma.
 */
export function leituraDaVisaoGeral(overview: FamiliesOverview): LeituraDoPanorama {
  const distinto = overview.vehiclesTouchedDistinct;
  return {
    resumo: overview,
    alteracoes: overview.consolidado.totals.changes,
    tiposDeAlteracao: overview.consolidado.gruposNoTotal,
    veiculos: distinto ?? overview.summary.vehiclesTouched,
    veiculosDeduplicados: distinto !== undefined,
    frota: overview.consolidado.totals.fleet ?? null,
    ativosNaFrota: overview.consolidado.totals.ativosNaFrota ?? 0,
    inativosNaFrota: overview.consolidado.totals.inativosNaFrota ?? 0,
    entraram: overview.consolidado.totals.entitiesAdded,
    sairam: overview.consolidado.totals.entitiesRemoved,
  };
}

// ---------------------------------------------------------------------------
// Andar 1 — o veredito
// ---------------------------------------------------------------------------

export interface Veredito {
  /** Em que pé está a apuração — quatro desfechos, e nenhum é o outro. */
  situacao: SituacaoDaApuracao;
  /** As outras periodicidades, em linha própria. R$/mês e R$/ano não somam. */
  outras: LadosDoImpacto[];
  /** A confiança do número acima — `null` numa vigência sem alteração. */
  cobertura: CoberturaApurada | null;
  /**
   * A variação do líquido contra a vigência anterior — `null` sem anterior,
   * sem líquido apurado, ou quando a anterior não tem a mesma periodicidade.
   *
   * A terceira recusa é a que importa, e é por causa dela que a comparação lê
   * o **balde da periodicidade da manchete** (`impact.byPeriodicity`) em vez do
   * primeiro líquido da anterior: a vigência anterior pode ter sido dominada
   * por R$/ano enquanto esta é dominada por R$/mês, e comparar as duas
   * produziria um percentual que nenhuma das duas grandezas justifica. É a
   * mesma recusa de `maioresImpactos`, que não ranqueia entre periodicidades
   * pelo mesmo motivo.
   */
  variacaoDoLiquido: number | null;
}

/** O que basta saber da vigência anterior — `GET /changes/grouped` entrega isto. */
export interface AnteriorDoVeredito {
  impact: { byPeriodicity: Record<string, number> };
}

export function vereditoDoPanorama(
  leitura: LeituraDoPanorama,
  /** A vigência anterior — `null` quando não há anterior lida. */
  anterior: AnteriorDoVeredito | null,
): Veredito {
  const situacao = situacaoDaApuracao(leitura.resumo, leitura.alteracoes);
  const atual = situacao.estado === "com_movimento" ? situacao.lados : null;

  /*
    O mesmo balde nos dois lados, ou nada. `byPeriodicity` pode não ter a chave
    — a anterior simplesmente não teve movimento naquela grandeza —, e aí não
    há comparação a fazer: tratar a ausência como zero diria que o valor caiu a
    zero, que é um fato diferente de não ter havido valor.
  */
  const doAnterior =
    atual !== null ? (anterior?.impact.byPeriodicity[atual.periodicity] ?? null) : null;

  return {
    situacao,
    outras: outrasPeriodicidades(leitura.resumo),
    cobertura: coberturaDaVigencia(
      { changes: leitura.alteracoes },
      { notCalculable: leitura.resumo.summary.impact.notCalculable },
    ),
    variacaoDoLiquido:
      atual !== null && doAnterior !== null ? variacao(atual.liquido, doAnterior) : null,
  };
}

// ---------------------------------------------------------------------------
// Andar 2 — o placar
// ---------------------------------------------------------------------------

export interface MedidaDoPlacar {
  chave: string;
  rotulo: string;
  /** O número, já escrito. `null` quando a leitura não o sustenta. */
  valor: string | null;
  /** A linha de baixo — `null` quando não há nada honesto a pôr nela. */
  nota: string | null;
  /** O tom, quando a medida tem uma régua. `null` é o neutro. */
  tom: Tom | null;
  /** O cartão em destaque — um só, e é o líquido. */
  destaque: boolean;
  /** A tela que responde a esta medida — `null` quando nenhuma responde. */
  href: string | null;
  ajuda: string;
}

/**
 * As cinco medidas da vigência — o superconjunto dos quatro cartões do Impacto
 * Líquido e dos cinco do Resumo executivo.
 *
 * **Há uma cobertura só neste placar, e é a da apuração.** O Impacto Líquido
 * publicava "Cobertura financeira" (alterações precificadas ÷ detectadas) e o
 * Resumo executivo publicava "Cobertura auditada" (células alcançadas ÷
 * importadas) — populações diferentes, ambas em percentual, ambas num anel,
 * ambas coloridas pela mesma régua (`qualidadeDaCobertura`). Quem abria as
 * duas telas na mesma vigência via dois números do mesmo recorte sem pista de
 * que falavam de coisas diferentes.
 *
 * A que fica aqui é a que **qualifica o líquido do andar 1**. A auditada não
 * some: desce para a procedência ({@link procedenciaDoPanorama}), onde é o que
 * sempre foi — uma medida de procedência do dado, e não de resultado
 * financeiro. Duas coberturas com o mesmo peso visual na mesma tela é o
 * defeito; separá-las por assunto é o conserto.
 */
export function placarDoPanorama(
  leitura: LeituraDoPanorama,
  veredito: Veredito,
  {
    recorte,
    /**
     * Se as medidas podem apontar para uma tela.
     *
     * Falso na Visão Geral, pela mesma razão de `ondeAgirAgora`: as telas de
     * destino recortam por unidade, e um endereço sem `scopeHash` cai na
     * unidade padrão do servidor (`resolveContext`) — a medida abriria a lista
     * de **uma** unidade debaixo de um número que somou todas.
     */
    comDestino,
    /** A variação de alterações contra a anterior — `null` sem anterior. */
    variacaoDeAlteracoes,
  }: { recorte: Recorte; comDestino: boolean; variacaoDeAlteracoes: number | null },
): MedidaDoPlacar[] {
  const destino = (href: string) => (comDestino ? href : null);
  const daVigencia: Recorte = recorte;
  const lados = veredito.situacao.estado === "com_movimento" ? veredito.situacao.lados : null;

  const semPreco = leitura.resumo.summary.impact.notCalculable;
  const fatiaSemPreco = participacao(semPreco, leitura.alteracoes);
  const fatiaDeVeiculos = participacao(leitura.veiculos, leitura.frota ?? 0);

  return [
    {
      chave: "liquido",
      rotulo: "Impacto líquido",
      valor: lados
        ? escreverImpacto({ periodicity: lados.periodicity, amount: lados.liquido })
        : null,
      nota: lados
        ? `+${formatarLado(lados.ganhos)} / ${formatarLado(lados.perdas)}`
        : "nenhum valor apurável nesta vigência",
      tom: lados ? (lados.liquido < 0 ? "grave" : "ok") : null,
      destaque: true,
      href: null,
      ajuda:
        "Ganhos menos perdas da vigência inteira, na periodicidade dominante. " +
        "R$/mês e R$/ano nunca são somados: são grandezas diferentes, e as demais " +
        "saem em linha própria logo abaixo da manchete.",
    },
    {
      chave: "alteracoes",
      rotulo: "Alterações detectadas",
      valor: leitura.alteracoes.toLocaleString("pt-BR"),
      nota:
        variacaoDeAlteracoes !== null
          ? `${escreverPercentual(variacaoDeAlteracoes)} vs vigência anterior`
          : leitura.tiposDeAlteracao !== null
            ? `${leitura.tiposDeAlteracao.toLocaleString("pt-BR")} pontos da remuneração tocados`
            : null,
      tom: null,
      destaque: false,
      href: leitura.alteracoes === 0 ? null : destino(linkDeAlteracoes({ recorte: daVigencia })),
      ajuda:
        "Cada célula que veio diferente da vigência anterior, contada uma vez por " +
        "ativo e por parâmetro. Nem toda diferença é um valor diferente: a troca de " +
        "formato da fonte entra na contagem.",
    },
    {
      chave: "veiculos",
      rotulo: "Veículos afetados",
      valor: leitura.veiculos.toLocaleString("pt-BR"),
      nota: notaDeVeiculos(leitura, fatiaDeVeiculos),
      tom: null,
      destaque: false,
      href: null,
      ajuda:
        "Equipamentos com pelo menos uma alteração nesta vigência, sobre a frota " +
        "que a vigência entregou — todos os que vieram no arquivo, rodando ou " +
        "parados. O denominador não é a coluna `ativo`; quantos dela estão em " +
        "ATIVO vai ao lado, quando a frota declara a coluna. Quem não a declara " +
        "não é contado como parado: aparece como \"sem a coluna\".",
    },
    {
      chave: "sem-preco",
      rotulo: "Sem impacto calculável",
      valor: semPreco.toLocaleString("pt-BR"),
      nota: fatiaSemPreco !== null ? `${escreverPercentual(fatiaSemPreco)} das alterações` : null,
      tom: semPreco > 0 ? "atencao" : "ok",
      destaque: false,
      href:
        semPreco === 0
          ? null
          : destino(
              linkDeAlteracoes({
                recorte: daVigencia,
                filtros: { impactConfidence: "NOT_CALCULABLE" },
              }),
            ),
      ajuda:
        "Alterações reais que o sistema não sabe valorar — falta semântica " +
        "confirmada ou preço. Não entram no impacto acima, e nenhuma foi " +
        "arredondada para zero.",
    },
    {
      chave: "cobertura",
      rotulo: "Cobertura da apuração",
      valor: veredito.cobertura
        ? escreverPercentual(veredito.cobertura.percentual)
        : null,
      nota: veredito.cobertura
        ? `${veredito.cobertura.apurado.toLocaleString("pt-BR")} de ${veredito.cobertura.total.toLocaleString("pt-BR")} alterações`
        : "sem alteração a cobrir",
      tom: veredito.cobertura?.qualidade.tom ?? null,
      destaque: false,
      href: null,
      ajuda:
        "Fração das alterações da vigência que já viraram dinheiro — é ela que " +
        "qualifica o líquido acima. Não confundir com a cobertura auditada, que é " +
        "percentual de célula de planilha e vive na procedência, no fim da tela.",
    },
  ];
}

/** Ganhos e perdas na régua curta do placar. */
function formatarLado(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

/**
 * A nota do card de veículos: a fatia da frota, e de que frota se trata.
 *
 * A situação (`ATIVO`/`PARADO`) entra aqui porque foi a pergunta que a nota
 * fazia surgir sem responder. "69 equipamentos" é a frota entregue; quem lê o
 * export sabe que nem todos estão rodando, e a diferença é material — em
 * PERNAMBUCO · agosto/2026 são 69 entregues e 55 em `ATIVO`.
 *
 * **A cláusula só aparece quando há resposta para dar.** Uma frota em que
 * ninguém declarou situação — CARRETA não traz a coluna — sai com a nota de
 * antes, sem um "0 em ATIVO" que seria lido como frota parada. E quando parte
 * da frota respondeu e parte não, os que não responderam são **nomeados**: sem
 * isso, "55 em ATIVO" sobre 69 equipamentos convida à subtração, e a subtração
 * chamaria de parados 14 veículos que podem só não ter trazido a coluna.
 */
function notaDeVeiculos(leitura: LeituraDoPanorama, fatia: number | null): string | null {
  if (!leitura.veiculosDeduplicados) {
    return "soma das unidades — um equipamento em duas delas conta duas vezes";
  }
  if (fatia === null || leitura.frota === null) return null;

  const frota = leitura.frota;
  const base = `${escreverPercentual(fatia)} da frota (${frota.toLocaleString("pt-BR")} equipamentos`;

  const responderam = leitura.ativosNaFrota + leitura.inativosNaFrota;
  if (responderam === 0) return `${base})`;

  const ativos = `${leitura.ativosNaFrota.toLocaleString("pt-BR")} em ATIVO`;
  const semResposta = frota - responderam;
  if (semResposta <= 0) return `${base} · ${ativos})`;

  return `${base} · ${ativos}, ${semResposta.toLocaleString("pt-BR")} sem a coluna)`;
}

// ---------------------------------------------------------------------------
// Dobra 2 — o ranking de onde o dinheiro se mexeu
// ---------------------------------------------------------------------------

/** Os dois grãos do ranking. A família agrega; o parâmetro é o degrau abaixo. */
export const GRAOS_DO_RANKING = ["familia", "parametro"] as const;

export type GraoDoRanking = (typeof GRAOS_DO_RANKING)[number];

export function graoValido(valor: string | null): valor is GraoDoRanking {
  return valor === "familia" || valor === "parametro";
}

export const ROTULO_DO_GRAO: Record<GraoDoRanking, string> = {
  familia: "Família",
  parametro: "Parâmetro",
};

/**
 * Uma linha do ranking — **a mesma forma nos dois grãos**, e é isso que ela
 * existe para garantir.
 *
 * O Panorama tinha três blocos lendo a mesma lista de famílias: dois cartões de
 * pódio (o que somou, o que tirou) e uma lista de parâmetros. Eram três cartões
 * de largura inteira, com três títulos, três subtítulos e três notas de rodapé,
 * para responder uma pergunta só em dois grãos — *onde o dinheiro se mexeu, e
 * quanto?* Empilhados, eles reimprimiam o líquido da vigência quatro vezes e
 * gastavam duas telas de rolagem para mostrar, num recorte de uma família, três
 * linhas de conteúdo.
 *
 * Aqui é um cartão, com duas chaves: o **grão** (família ou parâmetro) e o
 * **lado** (todos, ganhos, perdas) — que é o filtro que a lista de parâmetros
 * já tinha. As quatro leituras que os três cartões davam continuam todas
 * alcançáveis, e nenhuma delas custa rolagem.
 *
 * Tipar as duas por uma forma só é o que impede os dois grãos de divergirem com
 * o tempo, como os três cartões divergiram: quem monta a linha é este módulo,
 * testado fora do JSX, e o componente só desenha o que chega.
 */
export interface LinhaDoRanking {
  /** A chave estável do que a linha nomeia — o `code` da família, a `key` do parâmetro. */
  chave: string;
  nome: string;
  /** A linha de baixo: de que família vem, quantas alterações, quantos veículos. */
  contexto: string;
  /**
   * Como a linha se lê — a mesma régua de `MudancaRelevante.classificacao`,
   * inclusive o "compensado" de quem se mexeu nos dois sentidos e voltou.
   */
  classificacao: "ganho" | "perda" | "compensado";
  /** O número publicado: o líquido no recorte inteiro, o do lado nos recortes de um lado. */
  valor: number;
  /**
   * O líquido embaixo, quando o número de cima é a parcela de um lado —
   * `null` no recorte "todos", onde o de cima **é** o líquido e repeti-lo diria
   * duas vezes a mesma coisa.
   */
  liquido: number | null;
  /** Do maior valor da lista: 0 a 1. É o comprimento da barra, e nada mais. */
  proporcao: number;
}

/**
 * O ranking por família — o pódio dos dois cartões antigos, numa lista.
 *
 * A ordem é pelo **módulo do valor publicado**, que é a régua dos dois pódios
 * que esta lista substitui: no recorte de um lado, quanto aquele lado mexeu;
 * no recorte inteiro, quanto sobrou. Uma família sem nada do lado pedido não
 * entra na lista — não é uma família de valor zero, é uma família que não
 * participou daquele lado.
 */
export function rankingPorFamilia(
  familias: ImpactoDeFamilia[],
  filtro: FiltroDeMudanca,
  limite: number,
): LinhaDoRanking[] {
  const valorDo = (f: ImpactoDeFamilia) =>
    filtro === "ganhos" ? f.ganhos : filtro === "perdas" ? f.perdas : f.liquido;

  const doLado = familias.filter((f) =>
    filtro === "ganhos" ? f.ganhos > 0 : filtro === "perdas" ? f.perdas < 0 : f.movimento > 0,
  );

  const ordenadas = [...doLado]
    .sort((a, b) => Math.abs(valorDo(b)) - Math.abs(valorDo(a)))
    .slice(0, limite);

  const teto = ordenadas.reduce((maior, f) => Math.max(maior, Math.abs(valorDo(f))), 0);

  return ordenadas.map((familia) => {
    const valor = valorDo(familia);
    /*
      As alterações **do lado pedido**, e não as da família inteira — a mesma
      correção que o pódio partido em dois já fazia: repetir "59 alterações" nos
      dois lados diria que 118 alterações somaram e tiraram nesta vigência.
    */
    const contagem =
      filtro === "todos"
        ? familia.alteracoes
        : familia.parametros[filtro].reduce((n, l) => n + l.changes, 0);

    return {
      chave: familia.code,
      nome: familia.name,
      contexto: `${contagem.toLocaleString("pt-BR")} ${contagem === 1 ? "alteração" : "alterações"}`,
      classificacao: classificar(familia.ganhos, familia.perdas, filtro),
      valor,
      /* No recorte inteiro o número de cima já é o líquido. */
      liquido: filtro === "todos" ? null : familia.liquido,
      proporcao: teto === 0 ? 0 : Math.abs(valor) / teto,
    };
  });
}

/**
 * O ranking por parâmetro — o degrau abaixo da família, sobre a mesma lista de
 * `mudancasRelevantes`.
 *
 * Ele não repete o de cima: o grão é outro, e uma família some daqui quando o
 * movimento dela está espalhado em muitos parâmetros pequenos — que é
 * exatamente a diferença que se quer ver ao descer um degrau. O filtro de lado
 * é o mesmo `filtrarMudancas` que a lista já usava, com a reclassificação que
 * ele faz por dentro.
 */
export function rankingPorParametro(
  mudancas: MudancaRelevante[],
  filtro: FiltroDeMudanca,
  limite: number,
): LinhaDoRanking[] {
  return filtrarMudancas(mudancas, filtro)
    .slice(0, limite)
    .map((linha) => ({
      chave: linha.key,
      nome: linha.name,
      contexto: [
        linha.familyName,
        `${linha.alteracoes.toLocaleString("pt-BR")} ${linha.alteracoes === 1 ? "alteração" : "alterações"}`,
        ...(linha.veiculos > 0
          ? [`${linha.veiculos.toLocaleString("pt-BR")} ${linha.veiculos === 1 ? "veículo" : "veículos"}`]
          : []),
      ].join(" · "),
      classificacao: linha.classificacao,
      valor: valorDaMudanca(linha, filtro),
      liquido: filtro === "todos" ? null : linha.liquido,
      proporcao: linha.proporcao,
    }));
}

/**
 * A palavra da linha no recorte inteiro, e a do lado nos recortes de um lado.
 *
 * "Compensado" é o caso que o saldo esconde: mexeu para os dois lados e voltou
 * quase ao mesmo lugar. Chamá-lo de ganho ou de perda daria um veredito a um
 * número que não tem sinal — a mesma recusa de `mudancasRelevantes`.
 */
function classificar(
  ganhos: number,
  perdas: number,
  filtro: FiltroDeMudanca,
): LinhaDoRanking["classificacao"] {
  if (filtro === "ganhos") return "ganho";
  if (filtro === "perdas") return "perda";
  const liquido = ganhos + perdas;
  if (ganhos > 0 && perdas < 0 && liquido === 0) return "compensado";
  return liquido < 0 ? "perda" : "ganho";
}

// ---------------------------------------------------------------------------
// Dobra 2 — o que puxou a janela
// ---------------------------------------------------------------------------

/**
 * O que vem puxando o resultado ao longo da janela do gráfico.
 *
 * **A pergunta é outra, e é a diferença que justifica o cartão.** "Onde o
 * dinheiro se mexeu" (dobra 3) responde pela **competência aberta**; isto
 * responde pelas **últimas vigências** — quem empurra o resultado ao longo do
 * tempo, e se foi um solavanco de uma vigência só ou uma pressão que volta toda
 * quinzena. As duas leituras discordarem é o normal: o parâmetro que dominou
 * esta competência pode ser estreante, e o que sangra há seis vigências pode
 * não ter se mexido nesta.
 *
 * **O dado já estava na resposta do gráfico.** `Movimentos.byParameter`
 * (`/changes/range`) soma cada parâmetro ao longo do intervalo, e o campo que
 * torna a leitura interessante é `periods`: em quantas das vigências da janela
 * aquele parâmetro se mexeu. Nenhuma requisição nova — ver
 * `lib/serie-de-impacto.ts`, que passou a devolver a resposta crua por isso.
 *
 * **Só na leitura de unidade.** `/changes/range/overview` soma unidade a
 * unidade e por isso não tem rollup de parâmetro para oferecer — é a mesma
 * assimetria do mapa, e aqui ela vira ausência declarada: sem janela, a página
 * não desenha o cartão.
 */
export interface JanelaDoImpacto {
  /** "julho/2026 · 2ªq → agosto/2026 · 1ªq" — o intervalo, escrito. */
  rotulo: string;
  /** Quantas vigências a janela cobre — o denominador do "em N de". */
  vigencias: number;
  /** A periodicidade em que a janela foi lida. `null` quando não há líquido. */
  periodicity: string | null;
  linhas: LinhaDaJanela[];
}

/**
 * A linha da janela — a do ranking, mais **em quantas vigências** ela se mexeu.
 *
 * O número já vai escrito dentro de `contexto` ("em 4 de 6 vigências"), que é
 * onde o cartão o lê; separado, ele serve a quem precisa dele como número — a
 * gaveta do parâmetro, que escreve a mesma contagem noutra frase. Repetir a
 * extração a partir do texto do contexto seria ler uma frase para achar um
 * inteiro que a leitura já tinha na mão.
 */
export interface LinhaDaJanela extends LinhaDoRanking {
  /** Em quantas das vigências da janela este parâmetro se mexeu. */
  periodos: number;
}

/**
 * A linha da janela de um parâmetro — o que a gaveta dele precisa saber.
 *
 * A janela cobre várias vigências e a gaveta explica **uma**, e é essa distância
 * que a nota da gaveta declara: sem ela, quem clica numa linha de R$ 31.218 e
 * cai num painel de R$ 14.939 fica com dois números e nenhuma frase dizendo que
 * são de intervalos diferentes.
 */
export function daJanela(
  janela: JanelaDoImpacto | null,
  chave: string | null,
): { linha: LinhaDaJanela; rotulo: string; vigencias: number; periodicity: string | null } | null {
  if (janela === null || chave === null) return null;
  const linha = janela.linhas.find((l) => l.chave === chave);
  if (!linha) return null;
  return {
    linha,
    rotulo: janela.rotulo,
    vigencias: janela.vigencias,
    periodicity: janela.periodicity,
  };
}

/**
 * A janela em linhas — a mesma forma das outras listas da tela.
 *
 * Ordena pelo **módulo do líquido da janela**, que é o que o gráfico ao lado
 * desenha. Parâmetro sem líquido apurado na periodicidade lida não entra: ele
 * não é um parâmetro de R$ 0 na janela, é um parâmetro que a janela não sabe
 * valorar — e a contagem dele já está no "sem impacto calculável" da manchete.
 */
export function janelaDoImpacto(
  movimentos: MovimentosDaJanela | null,
  /** A periodicidade da manchete — a mesma régua do resto da tela. */
  periodicidade: string | null,
  limite: number,
): JanelaDoImpacto | null {
  if (movimentos === null) return null;

  /*
    A periodicidade é a do contrato — a mesma função que o gráfico ao lado
    chama, e não uma segunda régua com o mesmo propósito.

    A anterior aceitava a preferida pela mera **existência** do balde
    (`!== undefined`), e um balde apurado inteiramente em R$ 0,00 existe: a
    janela era lida numa grandeza parada enquanto o dinheiro estava noutra.
    `periodicidadePrincipal` exige movimento antes de respeitar a preferência,
    que é a correção de 18/09/2026.
  */
  const balde = periodicidadePrincipal(
    periodicidadesDaLeitura(movimentos.impact),
    periodicidade,
  );

  const vigencias = movimentos.periods.filter(
    (p) => p.date >= movimentos.from && p.date <= movimentos.to,
  ).length;

  const rotulo = `${movimentos.fromLabel} → ${movimentos.toLabel}`;

  if (balde === null) {
    return { rotulo, vigencias, periodicity: null, linhas: [] };
  }

  const comValor = (movimentos.byParameter ?? []).filter(
    (p) => p.impact.byPeriodicity[balde] !== undefined && p.impact.byPeriodicity[balde] !== 0,
  );

  const ordenados = [...comValor]
    .sort(
      (a, b) =>
        Math.abs(b.impact.byPeriodicity[balde]!) - Math.abs(a.impact.byPeriodicity[balde]!),
    )
    .slice(0, limite);

  const teto = ordenados.reduce(
    (maior, p) => Math.max(maior, Math.abs(p.impact.byPeriodicity[balde]!)),
    0,
  );

  return {
    rotulo,
    vigencias,
    periodicity: balde,
    linhas: ordenados.map((p) => {
      const valor = p.impact.byPeriodicity[balde]!;
      return {
        chave: p.parameterKey,
        nome: p.parameterName,
        periodos: p.periods,
        /*
          "em N de M vigências" é o que esta lista tem e as outras não: ele
          separa o solavanco de uma quinzena da pressão que volta sempre, que é
          a razão de o cartão existir.
        */
        contexto: [
          p.familyName,
          `em ${p.periods.toLocaleString("pt-BR")} de ${vigencias.toLocaleString("pt-BR")} ${vigencias === 1 ? "vigência" : "vigências"}`,
          `${p.changes.toLocaleString("pt-BR")} ${p.changes === 1 ? "alteração" : "alterações"}`,
        ].join(" · "),
        classificacao: valor < 0 ? "perda" : "ganho",
        valor,
        /* O número de cima **é** o líquido da janela: não há parcela a pôr
           embaixo, e repeti-lo diria duas vezes o mesmo. */
        liquido: null,
        proporcao: teto === 0 ? 0 : Math.abs(valor) / teto,
      };
    }),
  };
}

/**
 * O que esta leitura precisa de `/changes/range` — e nada além.
 *
 * Tipar pelo mínimo, e não por `Movimentos` inteiro, é o que mantém a função
 * testável com um objeto de seis campos em vez de uma resposta de servidor
 * inteira, e o que impede este módulo de passar a depender, sem querer, de um
 * campo que a Visão Geral do intervalo não tem.
 */
export interface MovimentosDaJanela {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  periods: { date: string; label: string }[];
  impact: { byPeriodicity: Record<string, number> };
  byParameter?: {
    parameterKey: string;
    parameterName: string;
    familyName: string;
    changes: number;
    periods: number;
    impact: { byPeriodicity: Record<string, number> };
  }[];
}

// ---------------------------------------------------------------------------
// Dobra 3 — o mapa: onde aconteceu
// ---------------------------------------------------------------------------

/** Uma unidade no ranking da Visão Geral. */
export interface LinhaDoMapa {
  chave: string;
  label: string;
  /** O impacto dominante da unidade, já escrito — `null` sem valor apurado. */
  impacto: string | null;
  /** O sinal, para o tom. `null` quando não há impacto. */
  negativo: boolean | null;
  alteracoes: number;
  /** Do maior impacto do ranking: 0 a 1. É o comprimento da barra, e nada mais. */
  proporcao: number;
}

/**
 * Um tipo de ativo na vigência — cavalo, carreta, trecho.
 *
 * É o que responde *onde isso aconteceu* dentro de uma unidade, e o dado
 * sempre esteve na resposta: `cockpit.panorama.byEquipment` traz, por tipo,
 * quantas alterações, quantos parâmetros e de que tamanho é a frota daquele
 * tipo. O cartão antigo lia **um** balde desta lista — o mais tocado — e o
 * publicava como um número solto ao lado de três que não respondiam a pergunta
 * do andar.
 */
export interface LinhaDoTipo {
  /** O `entityType` — `CAVALO`, `CARRETA`. É ele que viaja no filtro da URL. */
  chave: string;
  /** Como se lê — "Cavalo". O servidor manda os dois, e são dois vocabulários. */
  nome: string;
  alteracoes: number;
  /** Parâmetros da remuneração tocados neste tipo. */
  parametros: number;
  /** A frota deste tipo — `null` quando a resposta não a declara. */
  frota: number | null;
  /**
   * A linha de baixo, já escrita — parâmetros tocados e tamanho da frota.
   *
   * É a razão entre os dois que qualifica a contagem de alterações: 244
   * alterações em 15 parâmetros de uma frota de 62 é uma vigência que mexeu em
   * quase tudo do cavalo; o mesmo número em 1 parâmetro seria uma correção de
   * uma coluna só. Vazia quando a resposta não soube dizer nem um nem outro.
   */
  contexto: string;
  /** Do tipo mais tocado: 0 a 1. */
  proporcao: number;
  /** A lista de alterações deste tipo — `null` na Visão Geral. */
  href: string | null;
}

/**
 * A movimentação da frota — **o rodapé do cartão, e não o corpo dele.**
 *
 * Estes quatro números eram quatro tiles do tamanho de um KPI, e nenhum deles
 * responde "onde aconteceu": eles dizem como a população mudou, que é contexto
 * do recorte e não o assunto do andar. Numa vigência sem entrada nem saída, dois
 * deles anunciavam `+0` e `−0` em corpo grande.
 *
 * **E um deles estava errado.** O tile dizia "Veículos ativos" e publicava
 * `frota` — a frota inteira que a vigência entregou, não os que respondem
 * `ATIVO` na coluna. Eram 133 equipamentos entregues e 46 em ATIVO, e a tela
 * chamava 133 de ativos, ao lado de uma régua que já publicava os dois números
 * com os nomes certos. Aqui as duas pontas viajam separadas e nomeadas, com a
 * mesma recusa de {@link LeituraDoPanorama}: quem não trouxe a coluna não é
 * parado, é sem resposta.
 */
export interface MovimentoDaFrota {
  frota: number | null;
  ativos: number;
  inativos: number;
  entraram: number;
  sairam: number;
}

/**
 * Onde a vigência aconteceu — **o único andar que troca de forma entre as duas
 * leituras**.
 *
 * A soma de unidades não tem tipos de ativo a ranquear (o `byEquipment` mora no
 * cockpit de uma vigência, e o overview não mescla cockpits), e uma unidade não
 * tem um ranking de unidades. Fingir simetria aqui produziria um cartão vazio
 * numa das duas leituras — e cartão sem dado não aparece.
 */
export type MapaDoPanorama =
  | { eixo: "tipos"; tipos: LinhaDoTipo[]; movimento: MovimentoDaFrota }
  | { eixo: "unidades"; linhas: LinhaDoMapa[] };

export function mapaDoPanorama(
  leitura: LeituraDoPanorama,
  /** A `FamiliesView` da unidade — `null` na Visão Geral. */
  view: FamiliesView | null,
  /** As unidades já ranqueadas — `unidadesPorImpacto`. Vazio na unidade. */
  unidades: { chave: string; label: string; impacto: { periodicity: string; amount: number } | null; alteracoes: number }[],
  {
    recorte,
    /**
     * Se as linhas podem apontar para uma tela — falso na Visão Geral, pela
     * mesma razão do placar: um endereço sem `scopeHash` cai na unidade padrão
     * do servidor, e a linha abriria a lista de **uma** unidade debaixo de um
     * número que somou todas.
     */
    comDestino,
  }: { recorte: Recorte; comDestino: boolean } = { recorte: RECORTE_VAZIO, comDestino: false },
): MapaDoPanorama {
  if (view === null) {
    const teto = unidades.reduce((maior, u) => Math.max(maior, Math.abs(u.impacto?.amount ?? 0)), 0);
    return {
      eixo: "unidades",
      linhas: unidades.map((u) => ({
        chave: u.chave,
        label: u.label,
        impacto: u.impacto ? escreverImpacto(u.impacto) : null,
        negativo: u.impacto ? u.impacto.amount < 0 : null,
        alteracoes: u.alteracoes,
        proporcao: teto === 0 ? 0 : Math.abs(u.impacto?.amount ?? 0) / teto,
      })),
    };
  }

  return {
    eixo: "tipos",
    tipos: tiposDaVigencia(view, { recorte, comDestino }),
    movimento: {
      frota: leitura.frota,
      ativos: leitura.ativosNaFrota,
      inativos: leitura.inativosNaFrota,
      entraram: leitura.entraram,
      sairam: leitura.sairam,
    },
  };
}

/**
 * Os tipos de ativo, do mais tocado para o menos.
 *
 * **Ordena por alteração, e não por frota.** A pergunta é onde a vigência
 * mexeu: uma frota de 71 carretas com 23 alterações mexeu menos que uma de 62
 * cavalos com 244, e ranquear por tamanho de frota responderia uma pergunta que
 * ninguém fez — a frota é a mesma de vigência em vigência.
 *
 * Tipo sem alteração não entra: ele não é um tipo de zero alterações, é um tipo
 * que esta vigência não tocou, e uma linha de barra vazia no ranking do "onde"
 * diria que ali aconteceu algo de tamanho nenhum.
 *
 * O `contexto` da linha é montado aqui, e não no desenho, porque **quais**
 * cláusulas ele tem depende do que a resposta soube dizer.
 */
function tiposDaVigencia(
  view: FamiliesView,
  { recorte, comDestino }: { recorte: Recorte; comDestino: boolean },
): LinhaDoTipo[] {
  const baldes = view.cockpit.panorama.byEquipment.filter((b) => b.changes > 0);
  const ordenados = [...baldes].sort(
    (a, b) => b.changes - a.changes || a.equipment.localeCompare(b.equipment, "pt-BR"),
  );
  const teto = ordenados.reduce((maior, b) => Math.max(maior, b.changes), 0);

  return ordenados.map((balde) => ({
    /* Sem `entityType` a linha ainda se lê, e é o nome que a identifica: o que
       ela perde é o link, porque é o código que o filtro da URL entende. */
    chave: balde.entityType ?? balde.equipment,
    nome: balde.equipment,
    alteracoes: balde.changes,
    /*
      `?? 0` e `?? null` porque a resposta pode ser de uma versão anterior, ainda
      em cache, que não trazia os dois campos — e o tipo não protege contra o que
      já está gravado no navegador de quem abre a tela. Zero parâmetros e frota
      nula são os dois casos em que a linha **cala** sobre a cláusula, em vez de
      publicar "0 parâmetros" para um tipo que teve 244 alterações.
    */
    parametros: balde.groups ?? 0,
    frota: balde.fleet ?? null,
    contexto: contextoDoTipo(balde.groups ?? 0, balde.fleet ?? null),
    proporcao: teto === 0 ? 0 : balde.changes / teto,
    href:
      comDestino && balde.entityType
        ? linkDeAlteracoes({ recorte, filtros: { entityType: balde.entityType } })
        : null,
  }));
}

/** As cláusulas que a resposta sustenta — nunca um zero de enfeite. */
function contextoDoTipo(parametros: number, frota: number | null): string {
  const partes: string[] = [];
  if (parametros > 0) {
    partes.push(
      `${parametros.toLocaleString("pt-BR")} ${parametros === 1 ? "parâmetro" : "parâmetros"}`,
    );
  }
  if (frota !== null) partes.push(`frota de ${frota.toLocaleString("pt-BR")}`);
  return partes.join(" · ");
}

/**
 * Se o mapa tem o que desenhar — os dois vazios, numa regra só.
 *
 * Nenhuma unidade no ranking, ou uma frota que não se moveu e não tem nada a
 * contar: nos dois o cartão não aparece, em vez de publicar zeros.
 *
 * Ela nasceu quando o cartão dividia uma dobra de duas colunas com o gráfico —
 * ali um cartão que se apaga por dentro deixava **a coluna** dele em branco, e
 * a página precisava saber antes de montar a grade. O cartão desde então passou
 * para uma faixa de largura inteira (o lugar ao lado do gráfico é de quem lê a
 * mesma janela que ele), e nessa forma apagar-se não deixa buraco nenhum: a
 * função continua aqui porque a decisão é de leitura, e é o componente quem a
 * consulta.
 */
export function mapaVazio(mapa: MapaDoPanorama): boolean {
  if (mapa.eixo === "unidades") return mapa.linhas.length === 0;
  const { movimento } = mapa;
  return (
    mapa.tipos.length === 0 &&
    movimento.entraram === 0 &&
    movimento.sairam === 0 &&
    movimento.frota === null
  );
}

// ---------------------------------------------------------------------------
// Andar 6 — a procedência
// ---------------------------------------------------------------------------

export interface Procedencia {
  /** O recorte que **o servidor** resolveu. Nunca o que a tela pediu. */
  recorte: { label: string; period: string };
  /** Os arquivos que alimentaram este recorte. */
  arquivos: {
    total: number;
    fecham: number;
    /** `true` quando todo arquivo alimentou só este recorte. */
    exclusivos: boolean;
  };
  /**
   * A massa **integral** dos arquivos acima — e não "células deste recorte".
   *
   * O nome é longo de propósito: ela pode conter célula atribuída a outra
   * unidade, porque um arquivo multi-unidade alimenta legitimamente a
   * procedência de todas as que alimentou. Somar a de três recortes daria o
   * triplo do acervo.
   */
  massaDosArquivos: number;
  /** Células sem destino, **do arquivo**. Zero é a única resposta aceitável. */
  residuo: number;
  /** A grandeza deste recorte: células que viraram fato nas vigências dele. */
  celulasEmFato: number;
  ultima: UltimaImportacao | null;
}

/**
 * De onde vêm os números — o último andar, e deliberadamente o último.
 *
 * Quem abre a tela vem ver dinheiro, e a qualidade do dado nunca deve competir
 * com o financeiro pelo primeiro olhar. É também o único andar que lê fonte
 * fora de `/changes`, e o único que responde por *como sabemos* em vez de por
 * *quanto foi*.
 *
 * **Ele deixou de publicar a cobertura do acervo inteiro.** Lia `/balance` sem
 * recorte nenhum, de modo que o Panorama de PERNAMBUCO e a Visão Geral
 * publicavam o mesmo percentual — ele nunca foi de unidade nenhuma. Agora a
 * fonte é `/balance/recorte`, que recorta pela mesma unidade, canal e
 * competência dos cinco andares acima, e deriva a operação do ambiente de
 * trabalho em vez de aceitar a que o cliente mandou.
 *
 * **E deixou de publicar percentual.** Não por economia de tela: cobertura
 * auditada recortada não é grandeza bem definida. O resíduo — célula que não
 * chegou a destino — nunca virou fato, logo não tem unidade nem vigência a que
 * pertencer, e é justamente a parcela que o Rastreio de Dados existe para achar.
 * Um percentual aqui rateava o irrateável. O que fica são contagens, e a
 * distinção que elas carregam: {@link Procedencia.massaDosArquivos} é dos
 * arquivos, {@link Procedencia.celulasEmFato} é deste recorte.
 *
 * `null` quando não há arquivo a conferir — e aí quem fala é o estado `vazia`,
 * que diz isso com uma frase em vez de com um zero.
 */
export function procedenciaDoPanorama(
  dados: BalancoDoRecorte | null | undefined,
  agora: Date = new Date(),
): Procedencia | null {
  if (!dados) return null;
  if (dados.conservacao.arquivos === 0) return null;

  return {
    recorte: { label: dados.recorte.label, period: dados.recorte.period },
    arquivos: {
      total: dados.conservacao.arquivos,
      fecham: dados.conservacao.fecham,
      exclusivos: dados.conservacao.exclusivaDesteRecorte,
    },
    massaDosArquivos: dados.conservacao.celulasDosArquivos,
    residuo: dados.conservacao.residuo,
    celulasEmFato: dados.atribuido.celulasEmFato,
    /*
      A última importação passa pela mesma função dos outros módulos, e não por
      uma formatação nova aqui: a régua de "há 2h" / "ontem" / "em 14/08/2026"
      é de um lugar só. A diferença é a população — esta é a última **deste
      recorte**, e não a do acervo, que era o defeito.
    */
    ultima: dados.ultima
      ? ultimaImportacao(
          [
            {
              importRunId: dados.ultima.importRunId,
              status: dados.ultima.status,
              filename: dados.ultima.filename,
              receivedAt: dados.ultima.receivedAt,
            },
          ],
          agora,
        )
      : null,
  };
}

// ---------------------------------------------------------------------------
// Andar 6 — em que pé está a leitura
// ---------------------------------------------------------------------------

/** O que a tela sabe de **uma** das duas leituras da procedência. */
export interface LeituraDaProcedencia<T> {
  /** O endereço, para que a falha diga o que não respondeu. */
  rota: string;
  /** A consulta ainda não se decidiu — inclusive quando ainda nem começou. */
  carregando: boolean;
  dados: T | null | undefined;
  /** A falha como o React Query a entrega. Nula quando não houve. */
  erro: unknown;
  /**
   * Quando a falha foi registrada — `errorUpdatedAt`, e nunca um `new Date()`
   * fabricado na hora de desenhar. É a mesma regra de `UltimaAtualizacao`: a
   * hora que a tela publica diz quando a resposta chegou, e não que horas são.
   */
  erroEm?: number;
}

/** Uma leitura que não respondeu, e o pouco que se sabe sobre por quê. */
export interface FalhaDaProcedencia {
  rota: string;
  /** Quando ela foi registrada — `null` quando a leitura não sabe dizer. */
  quando: Date | null;
  /** O status HTTP — `null` quando a falha não chegou a ter um (rede, DNS). */
  status: number | null;
  /**
   * `true` em 401 e 403.
   *
   * Não é a leitura que falhou, é o acesso — e as duas mandam procurar em
   * lugares diferentes: uma é com quem cuida do servidor, a outra é com quem
   * administra a unidade.
   */
  semAcesso: boolean;
}

/**
 * Os seis desfechos do andar 6, e **nenhum deles é o outro**.
 *
 * Até aqui eram um só. As duas consultas saíam com `.catch(() => null)`, o
 * `null` viajava até {@link procedenciaDoPanorama}, que devolvia `null`, e a
 * tela não desenhava o andar. De modo que "não há importação conferida", "a API
 * respondeu 503", "ainda estou lendo" e "o seu acesso não alcança esta leitura"
 * terminavam no mesmo pixel: nenhum.
 *
 * Para uma tela executiva isso é elegante. Para uma leitura de auditoria é o
 * defeito mais caro que esta tela podia ter, e o próprio produto já escreveu a
 * regra em `pages/rastreio-de-dados.tsx`: *"um indicador que só aparece quando
 * há problema é indistinguível de um indicador quebrado"*. Um andar que some
 * por falha faz **ausência de evidência** parecer **evidência de ausência** —
 * e é exatamente esse par que uma auditoria existe para separar.
 *
 * **"Cartão sem dado não aparece" vale para dado ausente.** Não vale para
 * leitura que falhou, não vale para acesso negado e não vale para leitura em
 * curso. A recusa de desenhar zeros é sobre um dado que se sabe não existir;
 * nos outros três casos não se sabe coisa nenhuma, e é isso que a tela tem de
 * dizer.
 */
export type EstadoDaProcedencia =
  /** Alguma das duas leituras ainda não se decidiu. */
  | { estado: "carregando" }
  /** As duas responderam, e não há importação conferida a resumir. */
  | { estado: "vazia" }
  /** As duas responderam e há o que publicar. */
  | { estado: "pronta"; procedencia: Procedencia }
  /** Uma respondeu e a outra não: publica o que veio e **nomeia** o que faltou. */
  | { estado: "parcial"; procedencia: Procedencia; faltou: FalhaDaProcedencia[] }
  /** Nada a publicar, e o que impediu foi o acesso. */
  | { estado: "sem_acesso"; falhas: FalhaDaProcedencia[] }
  /** Nada a publicar, e o que impediu foi a leitura. */
  | { estado: "falha"; falhas: FalhaDaProcedencia[] };

/**
 * Em que pé está o andar da procedência.
 *
 * **Enquanto alguma das duas não se decidiu, o estado é `carregando`** — mesmo
 * que a outra já tenha falhado. A alternativa era publicar a falha assim que
 * ela chega, e ela chega rápido: um 403 responde em milissegundos e uma leitura
 * lenta demora segundos, de modo que o andar piscaria "falhou" antes de virar
 * "parcial" com o dado que estava a caminho. Uma leitura que trava fica no
 * esqueleto, que é o que de fato está acontecendo.
 *
 * **`parcial` é o estado de quem lê de mais de uma fonte.** Ele nasceu quando o
 * andar lia `/balance` e `/imports` separadamente: duas rotas falham em
 * separado, derrubar o andar inteiro porque uma caiu joga fora a resposta que
 * chegou, e publicar só o que veio sem dizer o que faltou apresenta meia
 * procedência como se fosse inteira.
 *
 * Hoje a tela lê **uma** fonte — `/balance/recorte` devolve também a última
 * importação do recorte, que era o segundo pedido —, então o Panorama não o
 * produz. O desfecho fica porque a máquina é de N leituras e a regra dele é a
 * parte difícil: quem acrescentar uma segunda fonte amanhã recebe o
 * comportamento certo em vez de reinventá-lo.
 */
export function estadoDaProcedencia(
  leituras: readonly LeituraDaProcedencia<unknown>[],
  /**
   * O que as leituras sustentam — `null` quando não sustentam nada.
   *
   * A máquina não conhece o formato da resposta de propósito: ela decide sobre
   * **em que pé está a leitura**, e isso não depende de qual é o payload. Quem
   * monta a procedência é `procedenciaDoPanorama`, uma vez, fora daqui.
   */
  procedencia: Procedencia | null,
): EstadoDaProcedencia {
  if (leituras.some((leitura) => leitura.carregando)) return { estado: "carregando" };

  const falhas = leituras
    .map(falhaDaLeitura)
    .filter((falha): falha is FalhaDaProcedencia => falha !== null);

  if (procedencia === null) {
    if (falhas.length === 0) return { estado: "vazia" };
    /*
      Só é "sem acesso" quando **todas** as falhas são de acesso. Uma 403 ao
      lado de uma 500 é uma tela que caiu, e mandar a pessoa falar com o
      administrador da unidade sobre um servidor com defeito é o tipo de
      recomendação que faz perder a viagem.
    */
    return falhas.every((falha) => falha.semAcesso)
      ? { estado: "sem_acesso", falhas }
      : { estado: "falha", falhas };
  }

  if (falhas.length > 0) return { estado: "parcial", procedencia, faltou: falhas };
  return { estado: "pronta", procedencia };
}

/**
 * O que se sabe de uma leitura que não respondeu.
 *
 * O status é lido com cuidado porque nem toda falha é `ApiError`: uma queda de
 * rede sobe um `TypeError` sem status nenhum, e inventar um número aqui faria a
 * tela explicar uma causa que ela não conhece.
 */
function falhaDaLeitura(leitura: LeituraDaProcedencia<unknown>): FalhaDaProcedencia | null {
  if (leitura.erro === null || leitura.erro === undefined) return null;

  const bruto = (leitura.erro as { status?: unknown }).status;
  const status = typeof bruto === "number" ? bruto : null;

  const quando =
    typeof leitura.erroEm === "number" && leitura.erroEm > 0 ? new Date(leitura.erroEm) : null;

  return {
    rota: leitura.rota,
    quando,
    status,
    semAcesso: status === 401 || status === 403,
  };
}
