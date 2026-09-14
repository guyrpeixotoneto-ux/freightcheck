import {
  equipamentoMaisTocado,
  escreverImpacto,
  escreverPercentual,
  frotaTotal,
  maioresImpactos,
  participacao,
  ultimaImportacao,
  variacao,
  type LadosDoImpacto,
  type Tom,
  type UltimaImportacao,
} from "./visao-geral";
import {
  coberturaDaVigencia,
  ondeAgirAgora,
  outrasPeriodicidades,
  situacaoDaApuracao,
  type AcaoAgora,
  type CoberturaApurada,
  type SituacaoDaApuracao,
} from "./impacto-apurado";
import { linkDeAlteracoes, type Recorte } from "./recorte";
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
    frota: frotaTotal(view),
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
    frota: overview.consolidado.totals.fleet,
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
// Andar 5 — o mapa
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
}

/**
 * Onde a vigência aconteceu — **o único andar que troca de forma entre as duas
 * leituras**.
 *
 * A soma de unidades não tem uma frota a movimentar (o `byEquipment` mora no
 * cockpit de uma vigência, e o overview não mescla cockpits), e uma unidade não
 * tem um ranking de unidades. Fingir simetria aqui produziria um cartão vazio
 * numa das duas leituras — e cartão sem dado não aparece.
 */
export type MapaDoPanorama =
  | {
      eixo: "frota";
      entraram: number;
      sairam: number;
      ativos: number | null;
      /** O equipamento mais tocado — `null` quando o cockpit não sabe dizer. */
      equipamento: { nome: string; entityType: string | null; mudancas: number } | null;
    }
  | { eixo: "unidades"; linhas: LinhaDoMapa[] };

export function mapaDoPanorama(
  leitura: LeituraDoPanorama,
  /** A `FamiliesView` da unidade — `null` na Visão Geral. */
  view: FamiliesView | null,
  /** As unidades já ranqueadas — `unidadesPorImpacto`. Vazio na unidade. */
  unidades: { chave: string; label: string; impacto: { periodicity: string; amount: number } | null; alteracoes: number }[],
): MapaDoPanorama {
  if (view === null) {
    return {
      eixo: "unidades",
      linhas: unidades.map((u) => ({
        chave: u.chave,
        label: u.label,
        impacto: u.impacto ? escreverImpacto(u.impacto) : null,
        negativo: u.impacto ? u.impacto.amount < 0 : null,
        alteracoes: u.alteracoes,
      })),
    };
  }

  return {
    eixo: "frota",
    entraram: leitura.entraram,
    sairam: leitura.sairam,
    ativos: leitura.frota,
    equipamento: equipamentoMaisTocado(view),
  };
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
