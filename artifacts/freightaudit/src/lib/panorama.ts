import {
  cobertura as coberturaAuditada,
  equipamentoMaisTocado,
  escreverImpacto,
  escreverPercentual,
  frotaTotal,
  integridade,
  maioresImpactos,
  participacao,
  qualidadeDaCobertura,
  ultimaImportacao,
  variacao,
  type Cobertura,
  type ExecucaoDeImportacao,
  type Integridade,
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
import type { BalancoResumo } from "@/components/balanco/tipos";
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
        "Ativos com pelo menos uma alteração nesta vigência, sobre a frota que a " +
        "vigência entregou.",
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

function notaDeVeiculos(leitura: LeituraDoPanorama, fatia: number | null): string | null {
  if (!leitura.veiculosDeduplicados) {
    return "soma das unidades — um ativo em duas delas conta duas vezes";
  }
  if (fatia === null || leitura.frota === null) return null;
  return `${escreverPercentual(fatia)} da frota (${leitura.frota.toLocaleString("pt-BR")} ativos)`;
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
  /** Cobertura **auditada**: células alcançadas ÷ células importadas. */
  cobertura: Cobertura | null;
  /** A qualidade da cobertura auditada, pela régua canônica. */
  qualidade: { palavra: string; tom: Tom } | null;
  integridade: Integridade | null;
  ultima: UltimaImportacao | null;
}

/**
 * De onde vêm os números — o último andar, e deliberadamente o último.
 *
 * Quem abre a tela vem ver dinheiro, e a qualidade do dado nunca deve competir
 * com o financeiro pelo primeiro olhar. É também o único andar que lê fontes
 * fora de `/changes` (`/balance` e `/imports`), e o único que responde por
 * *como sabemos* em vez de por *quanto foi*.
 *
 * `null` em toda parte é um estado legítimo: sem importação conferida, o andar
 * some inteiro em vez de desenhar zeros — a mesma regra de "cartão sem dado não
 * aparece" que vale no placar.
 */
export function procedenciaDoPanorama(
  balancos: BalancoResumo[] | null | undefined,
  importacoes: ExecucaoDeImportacao[] | null | undefined,
  agora: Date = new Date(),
): Procedencia | null {
  const cob = coberturaAuditada(balancos);
  const integ = integridade(balancos);
  const ultima = ultimaImportacao(importacoes, agora);

  if (cob === null && integ === null && ultima === null) return null;

  return {
    cobertura: cob,
    qualidade: cob ? qualidadeDaCobertura(cob.percentual) : null,
    integridade: integ,
    ultima,
  };
}
