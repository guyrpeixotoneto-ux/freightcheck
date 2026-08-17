import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronRight,
  Columns3,
  DollarSign,
  HelpCircle,
  Lock,
  SlidersHorizontal,
  TrendingDown,
  Truck,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import {
  LimparRecorte,
  SeletorDeJanela,
  type JanelaDeVigencias,
} from "@/components/changes/janela-vigencias";
import { Card, CardTitle } from "@/components/ui/card";
import {
  Aviso,
  brl0,
  ImpactoPorPeriodicidade,
  MetricCard,
  TituloDePainel,
} from "@/components/changes/cartoes";
import {
  ChangeTable,
  ChangeFilterPanel,
  type AttributeRollup,
  type ChangeRow,
  type Breakdown,
  type Filters,
  type TravessiaParaQuinzenas,
  emptyFilters,
  toQuery,
} from "@/components/changes/change-table";
import { fetchJson } from "@/lib/api";
import { paramsDoEscopo, type EscopoDeFrota } from "@/lib/frota";
import { primeiraPagina, type Janela } from "@/lib/paginacao";
import {
  FILTROS_NA_URL,
  lerFiltros,
  lerRecorte,
  linkDaVisaoGeral,
  nomeDaUnidade,
  paramsDeAlteracoes,
  paramsDoRecorte,
  temRecorte,
  type Recorte,
} from "@/lib/recorte";
import { cn } from "@/lib/utils";
import type { SeriesContext } from "@/components/inicio/types";

interface ConsolidatedResponse {
  view: {
    /**
     * De quem é o período — a unidade e o canal que o servidor **escolheu**.
     *
     * Vem na resposta e não do pedido de propósito: quem abre sem escolher nada
     * recebe o contexto mais recente, e a tela precisa poder dizer qual foi. Ler
     * do endereço mostraria "nada escolhido" onde o servidor escolheu por conta
     * própria.
     */
    context: SeriesContext & {
      /**
       * **Todas** as vigências do contexto, sem o recorte — é delas que o
       * seletor De/Até se monta. Um seletor que só oferecesse as de dentro do
       * intervalo atual não teria como sair dele.
       */
      periodosDisponiveis: string[];
      periodosNaJanela: number;
    };
    /** A vigência da leitura; com recorte, a ponta de cima dele. */
    period: string;
    /** `agosto/2026` — o mesmo rótulo que a Visão geral mostra no cabeçalho. */
    periodLabel: string;
    present: {
      entityTypeSet: string;
      effectiveDate: string;
      sourceLabel: string;
      previousLabel: string | null;
      reason: string | null;
    }[];
    missing: string[];
    complete: boolean;
    totals: {
      valueChanges: number;
      entitiesAdded: number;
      entitiesRemoved: number;
      attributesAdded: number;
      attributesRemoved: number;
      inconclusive: number;
      impactNotCalculable: number;
    };
    impactByPeriodicity: Record<string, number>;
    /** O recorte aplicado; null é a leitura de uma vigência só. */
    janela: { de: string; ate: string } | null;
    /** As vigências que a leitura cobre, da mais antiga à mais recente. */
    periodos: string[];
    /** Quantas transições entraram na soma — **não** é `periodos.length`. */
    transicoes: number;
    /** `2025-12-02` → `EMPURRADA_2_12_2025`, para todas as do contexto. */
    rotulos: Record<string, string>;
  };
  breakdown: Breakdown;
  periods: { effective_date: string; series: string[] }[];
  /**
   * Os mesmos números, recontados dentro do escopo de frota — só quando há um.
   *
   * Vem separado da `view` de propósito, e a rota explica por quê: a `view`
   * descreve o período inteiro — quais séries chegaram, qual faltou, o total da
   * frota — e continua sendo o que a tela de Alterações lê. O escopo não a
   * reescreve; ele vem ao lado, e quem está numa tela 360° lê daqui.
   */
  totais?: TotaisDoEscopo;
  total: number;
  rows: ChangeRow[];
}

/** Os sete números do topo e o impacto, na régua de um escopo de frota. */
interface TotaisDoEscopo {
  valueChanges: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  attributesAdded: number;
  attributesRemoved: number;
  inconclusive: number;
  impactNotCalculable: number;
  impactByPeriodicity: Record<string, number>;
}

interface LatestResponse {
  set: {
    id: string;
    snapshotALabel: string;
    snapshotBLabel: string;
    valueChanges: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    attributesAdded: number;
    attributesRemoved: number;
    unchanged: number;
    inconclusive: number;
    calculatedImpactByPeriodicity: Record<string, number>;
    impactNotCalculable: number;
  };
  breakdown: Breakdown;
  series: { entityTypeSet: string; vigencias: number; latestLabel: string }[];
  selectedSeries: string;
  total: number;
  rows: ChangeRow[];
}

/**
 * Qual disclosure da aba Planilha está aberta abaixo da fileira de avisos.
 *
 * Mesma regra da aba Chamados: um só de cada vez, nenhuma por padrão. O aviso
 * diz o tamanho do problema em uma linha; o detalhe — que é longo — só ocupa a
 * tela de quem pediu para vê-lo.
 */
type PainelPlanilha = "parcial" | "semPreco" | null;

/**
 * A tela responde, em ordem: o que mudou, de quanto para quanto, quanto isso
 * vale, em que parte da remuneração, e de onde veio. Materialidade ordena a
 * lista; nunca a filtra por conta própria.
 *
 * A forma é a da aba Chamados — cartões grandes, avisos em fileira, filtros
 * rápidos com o resto atrás de um botão, os dois painéis de concentração, e a
 * lista por último. Duas telas que respondem à mesma pergunta por caminhos
 * diferentes não deviam obrigar a reaprender onde ficam as coisas. O que
 * continua diferente é o único lugar onde a diferença é real: as réguas. Lá o
 * impacto é uma soma só; aqui é uma linha por periodicidade, porque R$/mês e
 * R$/ano não somam.
 *
 * **`escopo` é o que a torna reaproveitável pelas telas 360°**, e ele não é
 * mais um filtro: ele troca a população de que a aba inteira fala, e por isso
 * atravessa os cartões, os painéis e a lista de uma vez só — ver `lib/frota.ts`.
 * Três coisas mudam de forma quando ele existe, e as três estão explicadas no
 * lugar em que acontecem: os cartões passam a ler `totais` em vez da `view`, o
 * seletor de série some, e a faixa da Visão geral não aparece.
 */
export function AbaPlanilha({
  escopo,
  vigencias = {},
  onVigencias,
  onVerQuinzenas,
}: {
  escopo?: EscopoDeFrota;
  /** O recorte De/Até, partilhado com as outras abas de Alterações. */
  vigencias?: JanelaDeVigencias;
  /** Ausente nas telas 360°, que não oferecem o recorte. */
  onVigencias?: (j: JanelaDeVigencias) => void;
  /**
   * Levar uma alteração à matriz por placa e vigência, na aba Impacto.
   *
   * Quem responde por isto é a tela que tem as duas abas — é ela que troca de
   * aba e guarda a travessia —, e por isso chega de fora. Sem ela a lista segue
   * como sempre foi: o nome do atributo deixa de ser um botão, em vez de ser um
   * botão que não leva a nada.
   */
  onVerQuinzenas?: (travessia: TravessiaParaQuinzenas) => void;
} = {}) {
  const search = useSearch();
  const [caminho, navegar] = useLocation();

  /*
    O endereço é o estado da tela — todo ele.

    Unidade, canal, vigência, série e filtros moram na URL, e não há uma segunda
    cópia em `useState`. A tentação era guardar os filtros à parte, "porque o
    endereço só semeia": bastava então limpar um filtro na barra para a barra de
    endereços passar a descrever uma tela que não existe mais — e o próximo clique
    numa pastilha de série a levaria de volta para dentro da consulta,
    ressuscitando um recorte que a pessoa tinha acabado de desfazer.

    Uma fonte só, e as três coisas que ela dá de graça: o link chega inteiro do
    outro lado, voltar desfaz de verdade, e o que está escrito é o que está à
    vista. Filtrar troca o endereço **sem empilhar histórico** (`replace`) — o
    botão de voltar continua significando "a tela anterior", e não "o filtro
    anterior".

    Os filtros chegam da Visão geral: `impactConfidence=NOT_CALCULABLE` de "Sem
    impacto calculável", `entityType` do equipamento mais tocado, `attributeCode`
    de uma alteração em destaque. E `search=` continua chegando do Acompanhamento,
    como sempre chegou — o termo cobre código, nome do atributo e placa, ver
    `buildWhere` em `lib/comparison/src/query.ts`.
  */
  const recorte = lerRecorte(search);
  const contexto = paramsDoRecorte(recorte);
  /**
   * null = visão consolidada da frota; caso contrário, uma série.
   *
   * Sob escopo é sempre `null`, e não por omissão. Uma série é uma comparação
   * inteira — `/changes/latest` responde pela mais recente de `CAVALO+CARRETA`,
   * por exemplo —, e dentro de Cavalo 360° escolher uma delas ofereceria trocar
   * o assunto da tela por um que inclui a carreta. O consolidado do período,
   * recortado no equipamento, é a leitura que corresponde ao nome da tela.
   */
  const series = escopo ? null : new URLSearchParams(search).get("serie");

  /*
    Identidade estável, presa à string do endereço: `filters` entra na chave da
    consulta e na dependência do efeito abaixo, e um objeto novo a cada render
    faria a lista voltar para a página 1 sozinha — nunca se chegaria à página 2.
  */
  const filters = useMemo<Filters>(
    () => ({ ...emptyFilters, ...lerFiltros(search) }),
    [search],
  );

  const setFilters = (proximos: Filters) => {
    const params = new URLSearchParams(search);
    for (const chave of FILTROS_NA_URL) {
      const valor = proximos[chave].trim();
      if (valor) params.set(chave, valor);
      else params.delete(chave);
    }
    // Partindo do endereço atual, e não montado do zero: `aba` e `serie` andam
    // aqui também, e reconstruir a consulta pelos filtros os deixaria cair —
    // filtrar dentro de `/impacto-financeiro?aba=planilha` devolveria a pessoa
    // para a aba Impacto no meio da frase.
    navegar(params.toString() ? `${caminho}?${params}` : caminho, { replace: true });
  };

  const [janela, setJanela] = useState<Janela>(primeiraPagina);
  const [painel, setPainel] = useState<PainelPlanilha>(null);

  const recortado = vigencias.de !== undefined || vigencias.ate !== undefined;

  /*
    Filtrar, recortar ou trocar de série encurta a lista, e a página em que se
    estava pode deixar de existir — a tabela ficaria vazia com o rodapé
    afirmando que há resultados. Voltar para a primeira é o que não mente.
  */
  useEffect(() => {
    setJanela((atual) => (atual.pagina === 1 ? atual : { ...atual, pagina: 1 }));
  }, [filters, series, vigencias.de, vigencias.ate]);

  /*
    Uma série escolhida e um recorte aceso não podem coexistir.

    `trocarSerie` já apaga o recorte de quem troca por aqui, e este efeito cobre
    quem chega com a série já escolhida — o recorte vem de outra aba, e nesta
    leitura ele não é aplicado nem tem seletor onde aparecer. Um recorte que só
    existe na memória do componente é o começo de dois números discordando.
  */
  useEffect(() => {
    if (series !== null && recortado) onVigencias?.({});
  }, [series, recortado, onVigencias]);

  /**
   * Recortar apaga a vigência única do endereço — as duas são o mesmo eixo.
   *
   * `?period=` é o que a Visão geral manda: *esta* vigência, comparada com a
   * anterior dela. O recorte é a outra pergunta do mesmo eixo: *este intervalo*,
   * e as transições de dentro dele. Deixar as duas escritas ao mesmo tempo faria
   * a barra de endereços afirmar uma vigência que a resposta não aplicou — o
   * servidor dá precedência ao recorte, e é ele que vale.
   */
  const trocarVigencias = (proxima: JanelaDeVigencias) => {
    onVigencias?.(proxima);
    const pediuRecorte = proxima.de !== undefined || proxima.ate !== undefined;
    if (!pediuRecorte || recorte.period === null) return;
    const params = new URLSearchParams(search);
    params.delete("period");
    navegar(params.toString() ? `${caminho}?${params}` : caminho, { replace: true });
  };

  /**
   * Trocar de série é trocar de comparação, e a vigência escolhida não vem
   * junto.
   *
   * `/changes/latest` responde pela comparação **mais recente** de uma série, e
   * é a única resposta que ela tem: cavalo e carreta terminam em vigências
   * próprias, e não existe "o cavalo de julho" como leitura isolada enquanto a
   * rota não souber recebê-la. Então a vigência sai do endereço no mesmo
   * movimento, em vez de ficar escrita ali afirmando um recorte que a resposta
   * não aplicou. A procedência logo abaixo passa a mostrar quais duas vigências
   * estão sendo comparadas de fato.
   */
  const trocarSerie = (proxima: string | null) => {
    /*
      O recorte também não atravessa. `/changes/latest` responde pela comparação
      mais recente de uma série e não sabe receber um intervalo; mantê-lo aceso
      na tela deixaria um seletor dizendo "3 de 9 vigências" sobre uma resposta
      que leu duas. Ele volta a valer assim que se volta para a frota.
    */
    if (proxima !== null && recortado) onVigencias?.({});
    const params = paramsDeAlteracoes({
      aba: "planilha",
      recorte: proxima === null ? recorte : { ...recorte, period: null },
      filtros: lerFiltros(search),
      serie: proxima,
    });
    // O `aba` explícito sobrevive à troca: quem entrou por
    // `/impacto-financeiro?aba=planilha` continua na Planilha depois de escolher
    // uma série.
    const abaAtual = new URLSearchParams(search).get("aba");
    if (abaAtual !== null) params.set("aba", abaAtual);
    navegar(params.toString() ? `${caminho}?${params}` : caminho);
  };

  /** O escopo como a API o recebe. Vazio fora das telas 360°. */
  const escopoNaConsulta = escopo ? paramsDoEscopo(escopo) : null;

  const consolidated = useQuery({
    queryKey: [
      "changes",
      "consolidated",
      contexto.toString(),
      escopoNaConsulta?.toString() ?? null,
      filters,
      janela,
      vigencias.de,
      vigencias.ate,
    ],
    queryFn: () => {
      /*
        O contexto entra depois, e não por `toQuery`: aquela função descarta
        valor vazio, e `canal=` vazio **é** um valor — quer dizer "as vigências
        sem canal legível no rótulo", que é uma partição real da base. Passado
        por lá, o canal vazio sumiria e a tela responderia pela unidade inteira
        achando que respondia por uma fatia dela.
      */
      const consulta = new URLSearchParams(toQuery(filters, {}, janela));
      for (const [chave, valor] of contexto) consulta.set(chave, valor);
      /*
        O escopo entra por último, e sobrescreve: `entityType` é filtro de linha
        nesta aba e chega da Visão geral por link, mas numa tela 360° ele é o
        assunto — deixar o filtro vencer abriria Cavalo 360° mostrando carretas
        porque alguém colou um endereço antigo.
      */
      for (const [chave, valor] of escopoNaConsulta ?? []) consulta.set(chave, valor);
      // O recorte vai pelos mesmos `de`/`ate` das outras abas — é o contexto
      // que o carrega do lado do servidor, e não um parâmetro desta rota.
      if (vigencias.de) consulta.set("de", vigencias.de);
      if (vigencias.ate) consulta.set("ate", vigencias.ate);
      return fetchJson<ConsolidatedResponse>(`/changes/consolidated?${consulta}`);
    },
    enabled: series === null,
    // Virar a página ou mexer numa ponta do recorte não pode apagar a tabela: a
    // lista pisca em branco a cada clique, e quem está comparando dois recortes
    // perde a referência do que estava lendo.
    placeholderData: keepPreviousData,
  });

  const single = useQuery({
    queryKey: ["changes", "latest", filters, series, janela],
    queryFn: () =>
      fetchJson<LatestResponse>(
        `/changes/latest?${toQuery(filters, {}, janela)}&entityTypeSet=${series}`,
      ),
    enabled: series !== null,
  });

  const isLoading = series === null ? consolidated.isLoading : single.isLoading;
  const error = series === null ? consolidated.error : single.error;
  const cv = consolidated.data?.view;
  const data = single.data;

  // Séries conhecidas, para os botões. Vêm do consolidado, que enxerga todas.
  const known = [
    ...(cv?.present.map((p) => p.entityTypeSet) ?? []),
    ...(cv?.missing ?? []),
    ...(data?.series.map((s) => s.entityTypeSet) ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i).sort();

  const rows = series === null ? consolidated.data?.rows : data?.rows;
  const total = series === null ? consolidated.data?.total : data?.total;
  const breakdown = series === null ? consolidated.data?.breakdown : data?.breakdown;
  /**
   * Os totais recontados no escopo, quando há escopo.
   *
   * É a linha que separa uma tela honesta de uma que só parece honesta: sem
   * ela, "Cavalo 360°" mostraria os cinco cartões da frota inteira — carretas
   * incluídas — em cima de uma lista só de cavalos, e as duas leituras teriam a
   * mesma cara de verdade. `??` e não `||`: `totais` ausente é resposta de rota
   * antiga, não um total zerado.
   */
  const doEscopo = consolidated.data?.totais;
  const totals =
    series === null
      ? (doEscopo ?? cv?.totals)
      : data && {
          valueChanges: data.set.valueChanges,
          entitiesAdded: data.set.entitiesAdded,
          entitiesRemoved: data.set.entitiesRemoved,
          attributesAdded: data.set.attributesAdded,
          attributesRemoved: data.set.attributesRemoved,
          inconclusive: data.set.inconclusive,
          impactNotCalculable: data.set.impactNotCalculable,
        };
  const impact =
    series === null
      ? (doEscopo?.impactByPeriodicity ?? cv?.impactByPeriodicity ?? {})
      : (data?.set.calculatedImpactByPeriodicity ?? {});

  /*
    O aviso de consolidado parcial continua valendo sob escopo, e é ali que ele
    mais importa: numa tela de cavalos, "faltou o cavalo neste período" é a
    diferença entre uma frota que não mexeu e um arquivo que não chegou. O que o
    escopo muda é só de quem são os números, não o que a `view` sabe sobre a
    entrega.
  */
  const parcial = series === null && cv !== undefined && !cv.complete;
  const semPreco = totals?.impactNotCalculable ?? 0;
  const temAviso = parcial || semPreco > 0;

  const abrirPainel = (alvo: PainelPlanilha) =>
    setPainel((atual) => (atual === alvo ? null : alvo));

  const filtrarPorAtributo = (attributeCode: string) =>
    setFilters({
      ...filters,
      attributeCode:
        filters.attributeCode === attributeCode ? "" : attributeCode,
    });

  return (
    <div className="p-8 space-y-5">
      {/*
        Quem mandou esta tela abrir assim, e como se desfaz.

        Só aparece quando o endereço traz recorte — quem abriu Alterações pelo
        menu não precisa de uma faixa dizendo que não filtrou nada. O que ela
        mostra sai da **resposta**, e não da URL: é o servidor quem diz de que
        unidade e de que vigência são as linhas abaixo, e uma faixa que repetisse
        o pedido em vez do atendido continuaria anunciando julho depois de o
        servidor ter respondido por agosto.
      */}
      {/* Fora do escopo apenas: numa tela 360° a faixa ofereceria voltar para
          um número da Visão geral de onde ninguém veio, e o link "ver a
          vigência mais recente" sairia do cavalo para as Alterações inteiras —
          uma saída que não desfaz o recorte, troca de tela. */}
      {escopo === undefined && temRecorte(recorte) && (
        <VindoDaVisaoGeral
          recorte={recorte}
          unidade={cv ? nomeDaUnidade(cv.context) : null}
          // Com recorte De/Até a vigência única não vale mais: quem a
          // anunciasse estaria nomeando uma coluna de um intervalo de nove.
          vigencia={
            series === null && !recortado ? (cv?.periodLabel ?? null) : null
          }
        />
      )}

      {/*
        O recorte De/Até — o mesmo das abas Impacto e Cliente.

        Fica acima da procedência porque é ela que ele muda: as vigências
        escolhidas aqui são as que a linha de baixo passa a nomear. Só na
        leitura da frota — `/changes/latest`, que responde por uma série, é
        sempre a comparação mais recente dela e não sabe receber um intervalo —
        e só fora das telas 360°, que não passam `onVigencias`: lá a tela já tem
        um recorte por assunto, e um segundo eixo de escolha ao lado dele diria
        que a página responde por duas coisas ao mesmo tempo.
      */}
      {series === null && cv && onVigencias && (
        <SeletorDeJanela
          disponiveis={cv.context.periodosDisponiveis}
          rotulos={cv.rotulos}
          janela={vigencias}
          onJanela={trocarVigencias}
          noRecorte={cv.context.periodosNaJanela}
        />
      )}

      {/* De onde saiu tudo o que está abaixo, e sobre que recorte da frota.
          Fica numa linha, e não num cartão: é a procedência da tela, não um
          número dela. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
            {series === null ? (
              cv &&
              (cv.janela === null ? (
                <span className="font-mono">período {cv.period}</span>
              ) : (
                /*
                  Com recorte, a procedência é o intervalo — e o número de
                  transições vem junto, porque ele **não** é o de vigências.
                  A mais antiga do intervalo não tem par aqui dentro: a
                  comparação dela atravessa a borda e pertence ao recorte
                  anterior. Escrever os dois números é o que impede alguém de
                  ler "9 vigências" como "9 comparações".
                */
                <>
                  <span className="font-mono">
                    {cv.rotulos[cv.janela.de] ?? cv.janela.de}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-mono">
                    {cv.rotulos[cv.janela.ate] ?? cv.janela.ate}
                  </span>
                  <span>
                    · {cv.periodos.length} vigência
                    {cv.periodos.length === 1 ? "" : "s"}, {cv.transicoes}{" "}
                    comparaç{cv.transicoes === 1 ? "ão" : "ões"}
                  </span>
                </>
              ))
            ) : (
              data && (
                <>
                  <span className="font-mono">{data.set.snapshotALabel}</span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-mono">{data.set.snapshotBLabel}</span>
                </>
              )
            )}
          </p>

          {series === null && cv && cv.present.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {/* Sob escopo, a procedência nomeia só a série do equipamento:
                  listar a entrega da carreta numa tela de cavalos descreveria
                  um arquivo que não produziu nenhuma linha do que está abaixo. */}
              {escopo ? "Comparação de " : "Consolidado de "}
              {procedenciaDasSeries(
                cv.present.filter(
                  (p) =>
                    escopo === undefined ||
                    p.entityTypeSet.split("+").includes(escopo.entityType),
                ),
              )}
              . Cada série é comparada com a anterior dela mesma; nada é fundido.
            </p>
          )}
        </div>

        {/* Consolidado é agrupamento de tela e API: soma as séries que
            entregaram no período. Nenhuma vigência é fundida no banco.

            Fora do escopo apenas — a razão está em `series`, logo acima: dentro
            de Cavalo 360° estes botões ofereceriam trocar o assunto da tela por
            um que inclui a carreta. */}
        {escopo === undefined && known.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SerieChip active={series === null} onClick={() => trocarSerie(null)}>
              frota
            </SerieChip>
            {known.map((s) => (
              <SerieChip
                key={s}
                active={series === s}
                onClick={() => trocarSerie(s)}
                hint={
                  recorte.period !== null || recortado
                    ? "a comparação de uma série é sempre a mais recente dela — a vigência escolhida e o recorte De/Até saem junto"
                    : undefined
                }
              >
                {s.replace("+", " · ").toLowerCase()}
              </SerieChip>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="space-y-2">
          <ApiErrorNotice
            error={error}
            what="As alterações da planilha não puderam ser carregadas."
          />
          {/* A recusa mais provável aqui é o recorte: uma ponta que este
              contexto não tem volta como 400 com a lista das que ele tem. Sem
              este botão o recorte fica aceso com o seletor escondido, e só
              recarregar a página desfaz. */}
          {recortado && onVigencias && (
            <LimparRecorte onLimpar={() => onVigencias({})} />
          )}
        </div>
      )}

      {totals && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            tone="blue"
            icon={<SlidersHorizontal className="w-6 h-6" />}
            label="Valores alterados"
            value={totals.valueChanges.toLocaleString("pt-BR")}
            hint="célula a célula, entre as vigências"
          />
          <MetricCard
            tone="green"
            icon={<Truck className="w-6 h-6" />}
            label="Ativos entraram / saíram"
            value={`+${totals.entitiesAdded} / −${totals.entitiesRemoved}`}
            hint="entradas e saídas da frota"
          />
          <MetricCard
            tone="purple"
            icon={<Columns3 className="w-6 h-6" />}
            label="Colunas novas / removidas"
            value={`+${totals.attributesAdded} / −${totals.attributesRemoved}`}
            hint="mudanças no layout do arquivo"
          />
          {/*
            Impacto da planilha — uma linha por periodicidade, e nunca um número
            só: R$/mês e R$/ano são grandezas diferentes, e somá-las seria
            exatamente o erro que este produto existe para pegar. É também por
            isso que este cartão **não** soma com o de Impacto da aba Chamados:
            lá a régua é a distância entre um pedido e uma resposta.
          */}
          <MetricCard
            tone="red"
            icon={<TrendingDown className="w-6 h-6" />}
            label="Impacto apurado"
            value={<ImpactoPorPeriodicidade buckets={impact} />}
            hint={`${semPreco.toLocaleString("pt-BR")} alterações fora destes valores`}
          />
          <MetricCard
            tone="orange"
            icon={<HelpCircle className="w-6 h-6" />}
            label="Inconclusivas"
            value={totals.inconclusive.toLocaleString("pt-BR")}
            hint="listadas, não escondidas"
            valueTone={totals.inconclusive > 0 ? "warn" : "muted"}
          />
        </div>
      )}

      {/* Os avisos da comparação, em uma linha cada: o tamanho do problema à
          vista, e o detalhe atrás de um clique. Nenhum deles some quando é
          inconveniente — some quando não existe. */}
      {(temAviso || painel !== null) && (
        <Card className="p-5 space-y-4">
          <div className={cn("gap-4 md:grid-cols-2", temAviso ? "grid" : "hidden")}>
            {parcial && cv && (
              <Aviso
                tone="red"
                titulo="Visão consolidada parcial"
                detalhe={`Falta ${cv.missing.join(", ").toLowerCase()} ${
                  cv.janela === null
                    ? `no período ${cv.period}`
                    : "no intervalo escolhido"
                }`}
                acao="Revisar"
                aberto={painel === "parcial"}
                onClick={() => abrirPainel("parcial")}
              />
            )}
            {semPreco > 0 && (
              <Aviso
                tone="amber"
                icone={<Lock className="w-6 h-6" />}
                titulo={`${semPreco.toLocaleString("pt-BR")} alterações fora da soma de impacto`}
                detalhe="Continuam na lista — o que falta é o preço, não o fato"
                acao="Ver detalhes"
                aberto={painel === "semPreco"}
                onClick={() => abrirPainel("semPreco")}
              />
            )}
          </div>

          {painel === "parcial" && cv && (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
              {cv.janela === null ? (
                <>
                  Para o período <span className="font-mono">{cv.period}</span>{" "}
                  chegou apenas{" "}
                </>
              ) : (
                <>
                  No intervalo{" "}
                  <span className="font-mono">
                    {cv.rotulos[cv.janela.de] ?? cv.janela.de}
                  </span>{" "}
                  —{" "}
                  <span className="font-mono">
                    {cv.rotulos[cv.janela.ate] ?? cv.janela.ate}
                  </span>{" "}
                  chegou apenas{" "}
                </>
              )}
              {[
                ...new Set(cv.present.map((p) => p.entityTypeSet.toLowerCase())),
              ].join(", ")}
              .
              Falta <strong>{cv.missing.join(", ").toLowerCase()}</strong> — os
              números acima cobrem só o que foi entregue, e a série ausente não
              está contada como zero.
            </div>
          )}

          {painel === "semPreco" && (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm space-y-3">
              <p>
                <strong>{semPreco.toLocaleString("pt-BR")}</strong> alterações
                estão fora da soma de impacto porque a semântica do atributo
                ainda não foi confirmada, ou porque ele não é um montante
                somável. Elas continuam na lista — o que falta é o preço, não o
                fato.
              </p>
              {/*
                A ponta que faltava da corrente. A Visão geral manda para cá quem
                clicou em "Sem impacto calculável", e aqui se vê quais são; o
                preço, porém, não nasce nesta tela — nasce na Curadoria, quando
                alguém confirma o que a coluna significa. Sem este link, a
                pergunta chega ao fim da lista e para.
              */}
              <p className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setFilters({ ...filters, impactConfidence: "NOT_CALCULABLE" })
                  }
                  className="text-[0.8125rem] font-bold text-brand hover:underline"
                >
                  ver só estas na lista
                </button>
                <Link
                  href="/curadoria"
                  className="inline-flex items-center gap-1 text-[0.8125rem] font-bold text-brand hover:underline"
                >
                  confirmar a semântica na Curadoria
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </p>
            </div>
          )}
        </Card>
      )}

      <Card className="p-4 space-y-4">
        <ChangeFilterPanel
          filters={filters}
          onChange={setFilters}
          breakdown={breakdown}
        />
      </Card>

      {breakdown && breakdown.byAttribute.length > 0 && (
        <Card>
          <div className="grid md:grid-cols-2 md:divide-x">
            <AtributosMaisAlterados
              itens={breakdown.byAttribute}
              selecionado={filters.attributeCode}
              onSelecionar={filtrarPorAtributo}
            />
            <ImpactosPorAtributo
              itens={breakdown.byAttribute}
              selecionado={filters.attributeCode}
              naoApuradas={semPreco}
              onSelecionar={filtrarPorAtributo}
            />
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 border-b">
          <CardTitle className="text-sm font-semibold">
            {total !== undefined
              ? `${total.toLocaleString("pt-BR")} alterações`
              : "Alterações"}
          </CardTitle>
          <p
            className="text-xs text-muted-foreground"
            title="Materialidade ordena a lista; nunca a filtra por conta própria."
          >
            Ordenadas por materialidade: primeiro o que tem impacto apurado,
            depois pelo tamanho da variação · nada é omitido por ser pequeno
            {/*
              O caminho fica escrito, e não só no `title` do botão: um nome de
              atributo clicável parece, de longe, com o filtro que os painéis de
              cima aplicam — e a diferença entre filtrar esta lista e abrir as
              nove vigências do parâmetro é a diferença entre as duas perguntas.
            */}
            {onVerQuinzenas && (
              <>
                {" "}
                · clique no nome do atributo para ver as variações por quinzena
              </>
            )}
          </p>
        </div>
        {isLoading && (
          <p className="p-6 text-sm text-muted-foreground">Comparando…</p>
        )}
        {rows && total !== undefined && (
          <ChangeTable
            rows={rows}
            total={total}
            janela={janela}
            onJanela={setJanela}
            onVerQuinzenas={onVerQuinzenas}
          />
        )}
      </Card>
    </div>
  );
}

/**
 * De onde saiu cada série, numa frase — de uma vigência ou de um intervalo.
 *
 * Sem recorte há uma entrada por série, e a frase é a de sempre:
 * `cavalo (V7 → V8) · carreta (V7 → V8)`. Com recorte há uma por série **e por
 * vigência**, e repetir todas produziria dezoito parênteses numa linha que
 * ninguém leria — e que, pior, teria de ser lida para se descobrir quantas
 * comparações cada série trouxe.
 *
 * Então cada série vira uma frase só: quantas comparações ela tem, e entre que
 * pontas. As pontas saem das próprias entradas — a mais antiga que tem par e a
 * mais recente —, e não do intervalo pedido, porque uma série que não entregou
 * na borda do recorte começa depois dela. Uma série sem par nenhum diz o motivo,
 * em vez de sumir da frase deixando parecer que não entregou nada.
 */
function procedenciaDasSeries(
  present: ConsolidatedResponse["view"]["present"],
): string {
  const porSerie = new Map<string, typeof present>();
  for (const p of present) {
    const lista = porSerie.get(p.entityTypeSet) ?? [];
    lista.push(p);
    porSerie.set(p.entityTypeSet, lista);
  }

  return [...porSerie.entries()]
    .map(([serie, entradas]) => {
      const nome = serie.toLowerCase();
      // Em ordem de vigência, que é a ordem em que o servidor as devolveu.
      const comparadas = entradas.filter((e) => e.previousLabel !== null);
      if (comparadas.length === 0) {
        return `${nome} (${entradas[0]?.reason ?? "sem comparação"})`;
      }
      const primeira = comparadas[0];
      const ultima = comparadas[comparadas.length - 1];
      if (comparadas.length === 1) {
        return `${nome} (${primeira.previousLabel} → ${primeira.sourceLabel})`;
      }
      return (
        `${nome} (${comparadas.length} comparações, ` +
        `${primeira.previousLabel} → ${ultima.sourceLabel})`
      );
    })
    .join(" · ");
}

/**
 * A faixa do recorte — o outro lado da conversa com a Visão geral.
 *
 * Ela responde às três perguntas de quem chegou aqui por um número clicado lá:
 * *de que unidade e de que vigência são estas linhas*, *como volto para o
 * número de onde vim*, e *como vejo tudo sem o recorte*. Sem as duas últimas, um
 * link que filtra vira uma armadilha: a tela mostra 244 de 1.100 e a única saída
 * é adivinhar que existe um botão de limpar em algum lugar mais abaixo.
 *
 * A vigência é omitida quando uma série está escolhida — ali o que manda é a
 * comparação mais recente daquela série, que a procedência logo abaixo nomeia.
 * Repetir a vigência aqui seria afirmar um recorte que não foi aplicado.
 *
 * Os **filtros** não entram nesta faixa de propósito: quem os escreve é
 * `ChangeFilterPanel`, junto do × que desfaz cada um. Dois lugares dizendo quais
 * filtros estão ligados é um lugar a mais para eles discordarem.
 */
function VindoDaVisaoGeral({
  recorte,
  unidade,
  vigencia,
}: {
  recorte: Recorte;
  unidade: string | null;
  vigencia: string | null;
}) {
  const partes = [unidade, vigencia].filter((p): p is string => p !== null);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brand/40 bg-accent/40 px-4 py-3">
      <Link
        href={linkDaVisaoGeral(recorte)}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:underline shrink-0"
      >
        <ArrowLeft className="w-4 h-4" />
        Visão geral
      </Link>
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {partes.length > 0 ? (
          <>
            Recorte aberto: <strong className="text-foreground">{partes.join(" · ")}</strong>
          </>
        ) : (
          "Recorte aberto — lendo a vigência pedida."
        )}
      </p>
      <Link
        href="/alteracoes"
        className="text-[0.8125rem] font-bold text-brand hover:underline shrink-0"
      >
        ver a vigência mais recente
      </Link>
    </div>
  );
}

/** O recorte da frota — a pílula que troca o assunto da tela inteira. */
function SerieChip({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** O que a troca leva junto, quando ela leva algo — ver `trocarSerie`. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={cn(
        "h-9 rounded-full border px-4 text-sm font-medium transition-colors",
        active
          ? "bg-blue-600 border-blue-600 text-white shadow-sm"
          : "bg-background border-input text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Onde as alterações da planilha se concentram.
 *
 * Contagem, e só contagem: é a pergunta "o que mais mexeram", que não tem nada
 * a ver com "o que mais custou" — o painel ao lado responde essa, e os dois
 * quase nunca têm o mesmo primeiro colocado. É o mesmo par de leituras da aba
 * Chamados, sobre a mesma frota, por um caminho diferente.
 */
function AtributosMaisAlterados({
  itens,
  selecionado,
  onSelecionar,
}: {
  itens: AttributeRollup[];
  selecionado: string;
  onSelecionar: (attributeCode: string) => void;
}) {
  const topo = [...itens].sort((a, b) => b.count - a.count).slice(0, 5);

  return (
    <div className="p-6">
      <TituloDePainel icone={<BarChart3 className="w-5 h-5" />}>
        Atributos mais alterados
      </TituloDePainel>

      <div className="mt-4">
        {topo.map((a, i) => (
          <button
            key={a.attributeCode}
            onClick={() => onSelecionar(a.attributeCode)}
            title={`filtrar a lista por ${a.attributeCode}`}
            className={cn(
              "w-full flex items-center gap-4 px-2 py-3 text-left border-b last:border-b-0 rounded-md transition-colors",
              selecionado === a.attributeCode
                ? "bg-blue-50 text-blue-800"
                : "hover:bg-muted/50",
            )}
          >
            <span className="w-4 shrink-0 text-blue-600 font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate">
              {a.attributeName ?? a.attributeCode}
            </span>
            <span className="font-bold tabular-nums shrink-0">
              {a.count.toLocaleString("pt-BR")}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Um atributo que aparece aqui <em>e</em> na aba Chamados é a mesma
        história contada dos dois lados.
      </p>
    </div>
  );
}

/**
 * O que a vigência custou, por atributo.
 *
 * Uma linha por atributo **e periodicidade**, e não por atributo: um mesmo
 * atributo com impacto mensal e anual são duas quantias que não se somam, e
 * fundi-las para caber numa linha só produziria o número que este produto
 * existe para não deixar passar.
 *
 * Só entra aqui o que tem preço apurado — e o rodapé diz quantas alterações
 * ficaram de fora por não terem. Uma lista de "impactos relevantes" que cala o
 * tamanho do que não sabe medir é a que faz alguém concluir que o resto é zero.
 */
function ImpactosPorAtributo({
  itens,
  selecionado,
  naoApuradas,
  onSelecionar,
}: {
  itens: AttributeRollup[];
  selecionado: string;
  naoApuradas: number;
  onSelecionar: (attributeCode: string) => void;
}) {
  const comImpacto = itens
    .flatMap((a) => a.impact.map((i) => ({ atributo: a, ...i })))
    .filter((linha) => linha.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5);

  return (
    <div className="p-6">
      <TituloDePainel icone={<DollarSign className="w-5 h-5" />}>
        Impactos relevantes
      </TituloDePainel>

      {comImpacto.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum atributo desta comparação tem impacto apurado. Não quer dizer
          que a vigência não custou nada — quer dizer que a semântica dos
          atributos que mudaram ainda não permite pôr preço na diferença.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {comImpacto.map((linha) => {
            const perda = linha.amount < 0;
            const { atributo } = linha;
            return (
              <button
                key={`${atributo.attributeCode}-${linha.periodicity}`}
                onClick={() => onSelecionar(atributo.attributeCode)}
                title={`filtrar a lista por ${atributo.attributeCode}`}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
                  perda ? "bg-red-50 hover:bg-red-100" : "bg-emerald-50 hover:bg-emerald-100",
                  selecionado === atributo.attributeCode &&
                    (perda ? "ring-1 ring-red-300" : "ring-1 ring-emerald-300"),
                )}
              >
                <span
                  className={cn(
                    "h-8 w-8 rounded-full grid place-content-center shrink-0 bg-card border",
                    perda ? "text-red-600 border-red-200" : "text-emerald-600 border-emerald-200",
                  )}
                >
                  {perda ? (
                    <ArrowDown className="w-4 h-4" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
                  )}
                </span>
                <span className="flex-1 truncate">
                  {atributo.attributeName ?? atributo.attributeCode}
                </span>
                <span
                  className={cn(
                    "font-bold tabular-nums shrink-0",
                    perda ? "text-red-600" : "text-emerald-700",
                  )}
                >
                  {linha.amount > 0 ? "+" : ""}
                  {brl0(linha.amount)}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                    /{linha.periodicity.toLowerCase()}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {naoApuradas > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {naoApuradas.toLocaleString("pt-BR")} alterações não têm impacto
          apurado e não entram nesta lista.
        </p>
      )}
    </div>
  );
}
