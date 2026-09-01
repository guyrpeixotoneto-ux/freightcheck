import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  Gauge,
  ReceiptText,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJsonOrNull } from "@/lib/api";
import { opcoesDaVigencia } from "@/lib/leitura-da-vigencia";
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { DASHBOARD, GESTAO_A_VISTA } from "@/lib/ambiente";
import { cn } from "@/lib/utils";
import {
  formatBrlShort,
  formatPercent,
  formatValue,
  periodicitySuffix,
  reaisPublicados,
} from "@/lib/format";
import {
  detalheDaFamilia,
  escreverImpacto,
  frotaTotal,
  impactoPorFamilia,
  impactosDaVigencia,
  ladosDoImpacto,
  type Impacto,
  type ImpactoDeFamilia,
  type LadosDoImpacto,
  type Lado,
} from "@/lib/visao-geral";
import { juntarPrioridades } from "@/lib/cockpit";
import { lerRecorte, linkDeAlteracoes, nomeDaUnidade, type Recorte } from "@/lib/recorte";
import { DetalheDaFamilia } from "@/components/inicio/detalhe-da-familia";
import type { UnidadeDoDrill } from "@/lib/drill-da-familia";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";
import { Sparkline } from "@/components/dashboard/sparkline";
import { AnelDeCobertura } from "@/components/dashboard/anel-de-cobertura";
import {
  MenuDaGestaoAVista,
  SeletorDeUnidade,
} from "@/components/dashboard/controles-do-recorte";
import { GraficoDeImpacto, type PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import { useSerieDeImpacto, useSerieDeImpactoGeral } from "@/lib/serie-de-impacto";
import {
  BotaoDeVoltarVigencia,
  useVoltaDeVigencia,
} from "@/components/vigencia/voltar-de-vigencia";
import { iconeDaAlteracao } from "@/components/dashboard/icone-da-alteracao";
import {
  SeletorDeVigencia,
  SeletorDeVigenciaGeral,
} from "@/components/vigencia/seletor-de-vigencia";
import { opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";
import type {
  ChangeGroup,
  FamiliesOverview,
  FamiliesView,
  OverviewContextRef,
  SeriesContext,
} from "@/components/inicio/types";
import type { Movimentos } from "@/lib/analise";

/**
 * O Dashboard — a tela de vigilância: o que a Ambev mudou, e o que isso custou.
 *
 * A informação está ordenada pela pergunta que ela responde, na ordem em que
 * um executivo faria as perguntas: o que mudou (a faixa fina do topo), quanto
 * isso custou (os quatro indicadores, com o líquido em destaque), onde
 * aconteceu (o gráfico de impacto por competência e o pódio de maiores
 * impactos) e o que precisa de atenção agora (a tabela de alterações, a
 * movimentação da frota e a faixa de qualidade da apuração, por último e nunca
 * competindo com o financeiro pelo olho de quem abre a tela).
 *
 * A Visão Geral desenha exatamente este mesmo corpo, com os números de todas
 * as unidades somados no servidor (`FamiliesOverview.consolidado`) e o
 * ranking de unidades a mais. Trocar de unidade para "Visão Geral" muda o
 * recorte, nunca a forma da tela — foi o defeito da primeira versão, onde a
 * Visão Geral mostrava quatro cartões e o resto abria só dentro de uma
 * unidade.
 *
 * Nada aqui reimplementa a apuração: os indicadores somam `summary.sides`, a
 * tabela lê a mesma fila de prioridade do Acompanhamento (`juntarPrioridades`,
 * `lib/cockpit.ts`), o gráfico de impacto lê a mesma série de `/changes/range`
 * que a antiga linha do tempo lia (`seriesDoIntervalo`), e o pódio de maiores
 * impactos lê `view.families` — os mesmos campos que `lib/visao-geral.ts` já
 * sabia explicar antes desta tela existir.
 *
 * Um princípio que atravessa a tela inteira: **tudo aqui é medido, nada é
 * previsto**. Não existe "projetado em 12 meses" em lugar nenhum — anualizar
 * o líquido de uma competência só multiplicaria uma medida por doze e chamaria
 * o resultado de outra coisa. O que a tela não tem dado honesto para dizer,
 * ela omite — nunca aproxima.
 */
export default function Dashboard() {
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);

  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  const visaoGeral = parametros.get("visaoGeral") === "1";

  const vigencia = useQuery({
    ...opcoesDaVigencia(consulta),
    enabled: !visaoGeral,
    /*
      A leitura da unidade aberta, com a política de apuração fechada
      (`lib/frescor-das-leituras.ts`).

      Esta é a consulta da **troca de unidade**: a chave carrega `scopeHash`,
      `canal` e `period`, então escolher outra unidade na lateral produz uma
      chave que nunca foi buscada. Sem `placeholderData`, `data` vinha
      `undefined`, o ramo `vigencia.isLoading` assumia e o Dashboard inteiro
      era substituído por "Carregando a vigência…" — medido em 147–163 ms de
      tela vazia por troca, com o conteúdo sumindo 16 ms depois do clique.

      O `staleTime` é o mesmo minuto que a Linha do Tempo já declarava para
      exatamente esta leitura, e pela mesma razão: uma vigência fechada não
      muda entre duas importações, e é a importação que invalida a chave — não
      o relógio.

      A chave, o `staleTime`, o `placeholderData` e o 404 que vira `null` saíram
      para `lib/leitura-da-vigencia.ts` quando o Impacto Apurado nasceu ao lado
      desta tela: os dois módulos leem exatamente esta resposta, e a chave
      compartilhada é o que impede que busquem — e, por 150 ms, publiquem —
      vigências diferentes da mesma unidade.
    */
  });

  const view = visaoGeral ? null : (vigencia.data ?? null);
  const contextos = useContextosDaCasca();

  const periodosOverview = useMemo(
    () =>
      Array.from(new Set(contextos.contextos.flatMap((c) => c.periodosDisponiveis))).sort(
        (a, b) => b.localeCompare(a),
      ),
    [contextos.contextos],
  );

  /*
    Sem `?period=` a Visão Geral abre na competência **mais recente**, que é o
    que toda outra tela do produto faz (`gestao-a-vista.tsx`, o seletor da
    unidade) e o que alguém que abre o Dashboard veio ver. `periodosOverview`
    vem em ordem decrescente: a mais recente é a primeira da lista, e pegar a
    última abria a tela na competência mais antiga do histórico — a única sem
    vigência anterior contra a qual comparar, e por isso sempre com "0
    alterações detectadas" e nenhum valor apurado.
  */
  const periodoOverviewEfetivo = parametros.get("period") ?? periodosOverview[0] ?? null;

  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, {
    enabled: visaoGeral,
  });

  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;
  const recorte = lerRecorte(search);

  /*
    Qual família tem a gaveta aberta — na URL, e não num `useState`.

    O endereço com `?familia=AQUISICAO` é colável num chat e volta abrindo o
    mesmo painel sobre a mesma vigência, que é a promessa que o resto do produto
    já faz com `?impacto=` e `?alteracao=`. Um estado só de React perderia a
    gaveta a cada recarga e não teria como ser mandado a ninguém.
  */
  const familiaAberta = parametros.get("familia");

  // O relógio da faixa fina — a mesma leitura da Gestão à Vista
  // (`dataUpdatedAt` da própria consulta, nunca `new Date()` fabricado no
  // cliente): ele diz quando os dados foram de fato buscados, e não a hora
  // agora.
  const atualizadoEm = visaoGeral ? overviewQuery.dataUpdatedAt : vigencia.dataUpdatedAt;

  /*
    A série do gráfico de impacto — a mesma conta que o Resumo executivo lê,
    num hook só (`lib/serie-de-impacto.ts`). A janela de seis vigências, o
    intervalo pedido ao servidor e a periodicidade que manda no eixo moram lá:
    escritas em duas telas, bastaria uma delas mudar para as duas passarem a
    desenhar gráficos diferentes do mesmo dado.
  */
  const serieDaUnidade = useSerieDeImpacto(visaoGeral ? null : view, consulta, !visaoGeral);
  /*
    O gráfico sai **depois** do conteúdo principal, não junto com ele.

    `useSerieDeImpactoGeral` lê `/changes/range/overview`, e as duas leituras de
    overview do Dashboard custam 243 ms e 21 ms quando medidas sozinhas, mas
    625 ms e 607 ms quando disparam no mesmo instante: cada uma abre um leque de
    consultas por unidade, e as duas disputam os mesmos núcleos e o mesmo pool.
    Medido na abertura fria, a última resposta chegava aos 921 ms e 65% da
    jornada era esse par (`docs/AUDITORIA-ZERO-LOADING.md`, §2 e §3.1);
    adiando a segunda, o conteúdo útil saiu de 951 ms para 569 ms.

    Esta série não alimenta a resposta principal da tela — os quatro
    indicadores, o líquido e a fila saem de `overviewQuery`. Segurá-la até o
    conteúdo principal existir não atrasa nada que alguém esteja esperando.

    A guarda é `!overviewQuery.isLoading`, e não `overviewQuery.data`, por causa
    do `placeholderData`: numa troca de competência `isLoading` já é `false` (há
    o dado anterior em tela), e o gráfico acompanha a troca sem esperar de novo.
    O adiamento vale só para a **primeira** leitura, que é a única em que havia
    disputa.
  */
  const serieGeral = useSerieDeImpactoGeral(
    periodosOverview,
    periodoOverviewEfetivo,
    overview,
    visaoGeral && !overviewQuery.isLoading,
  );

  /*
    De onde a leitura saiu, para o botão de voltar dentro do gráfico. Mora
    aqui, e não no gráfico: trocar a vigência refaz a consulta e desmonta o
    corpo da tela enquanto ela não responde.
  */
  const pontosDesenhados = visaoGeral ? serieGeral : serieDaUnidade.pontos;
  const vigenciaAberta = visaoGeral ? periodoOverviewEfetivo : (view?.period ?? null);
  const volta = useVoltaDeVigencia({
    periodo: vigenciaAberta,
    label: pontosDesenhados.find((ponto) => ponto.periodo === vigenciaAberta)?.label ?? null,
  });

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${DASHBOARD}?${texto}` : DASHBOARD);
  };

  // O mesmo recorte que a tela está mostrando, levado para a Gestão à Vista —
  // o telão abre sobre o que esta tela já abriu, nunca sobre outra escolha.
  const paraGestaoAVista = consulta.toString() ? `${GESTAO_A_VISTA}?${consulta}` : GESTAO_A_VISTA;

  return (
    <Layout>
      <Cabecalho
        view={view}
        overview={overview}
        visaoGeral={visaoGeral}
        periodosOverview={periodosOverview}
        contextos={contextos.contextos}
        consulta={consulta}
        onTrocar={trocarPara}
        paraGestaoAVista={paraGestaoAVista}
        atualizando={
          visaoGeral ? overviewQuery.isPlaceholderData : vigencia.isPlaceholderData
        }
      />

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {visaoGeral ? (
          <>
            {overviewQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando o Dashboard…</p>
            )}
            {overviewQuery.error && (
              <ApiErrorNotice error={overviewQuery.error} what="Não foi possível montar o Dashboard." />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && <BancoVazio />}
            {overview && (
              /*
                Enquanto o conteúdo é o da competência anterior, ele fica dito:
                `isPlaceholderData` é o único sinal que quer dizer "a chave
                mudou e a resposta dela ainda não chegou". Um `isFetching` no
                lugar dele acenderia o indicador também num refetch de fundo da
                mesma competência, onde não há nada a declarar. O `space-y-5`
                repete o do contêiner acima: `space-y` só alcança filhos
                diretos, e sem ele esta envoltória colaria os cartões.
              */
              <div className={cn("space-y-5", classeDeAtualizacao(overviewQuery.isPlaceholderData))}>
              <ConteudoGeral
                overview={overview}
                atualizadoEm={atualizadoEm}
                onTrocar={trocarPara}
                serie={serieGeral}
                familiaAberta={familiaAberta}
                onAbrirFamilia={(code) => trocarPara({ familia: code })}
                onFecharFamilia={() => trocarPara({ familia: null })}
                onEscolherVigencia={(periodo) => {
                  volta.registrar();
                  trocarPara({ period: periodo });
                }}
                voltarPara={volta.destino}
                onVoltar={(periodo) => {
                  volta.limpar();
                  trocarPara({ period: periodo });
                }}
              />
              </div>
            )}
          </>
        ) : (
          <>
            {vigencia.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a vigência…</p>
            )}
            {vigencia.error && (
              <ApiErrorNotice error={vigencia.error} what="Não foi possível montar o Dashboard." />
            )}
            {!vigencia.isLoading && !vigencia.error && view === null && <BancoVazio />}
            {view && (
              <div className={cn("space-y-5", classeDeAtualizacao(vigencia.isPlaceholderData))}>
              <ConteudoDaUnidade
                view={view}
                recorte={recorte}
                atualizadoEm={atualizadoEm}
                serie={serieDaUnidade}
                familiaAberta={familiaAberta}
                onAbrirFamilia={(code) => trocarPara({ familia: code })}
                onFecharFamilia={() => trocarPara({ familia: null })}
                onEscolherVigencia={(periodo) => {
                  volta.registrar();
                  trocarPara({ period: periodo });
                }}
                voltarPara={volta.destino}
                onVoltar={(periodo) => {
                  volta.limpar();
                  trocarPara({ period: periodo });
                }}
              />
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

const CARTAO = "bg-card border rounded-xl shadow-sm";

// ---------------------------------------------------------------------------
// O cabeçalho
// ---------------------------------------------------------------------------

function Cabecalho({
  view,
  overview,
  visaoGeral,
  periodosOverview,
  contextos,
  consulta,
  onTrocar,
  paraGestaoAVista,
  atualizando,
}: {
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  visaoGeral: boolean;
  periodosOverview: string[];
  contextos: SeriesContext[];
  consulta: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  paraGestaoAVista: string;
  /**
   * O corpo da tela ainda é o recorte anterior (`isPlaceholderData`).
   *
   * O título continua nomeando o recorte **da resposta que está em tela** —
   * `view.context` e `view.period`, nunca `params.get("scopeHash")` —, e é o
   * que torna o par honesto: o título diz de quem são os números, e o
   * indicador ao lado diz que outro está a caminho. Sem o indicador, o título
   * ainda estaria certo, mas a lateral já nomearia a unidade nova e ninguém
   * teria como saber qual das duas ler.
   */
  atualizando: boolean;
}) {
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const periodoAtual = visaoGeral ? (overview?.period ?? null) : (view?.period ?? null);

  return (
    <header className="px-8 pt-7 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight">
              Impacto Líquido — {visaoGeral ? "Visão Geral" : (unidade ?? "")}
            </h1>
            <EmAtualizacao ativo={atualizando} />
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">
            O que a Ambev mudou nesta competência, e quanto isso custou.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {contextos.length > 1 && (
            <SeletorDeUnidade
              contextos={contextos}
              visaoGeral={visaoGeral}
              periodoAtual={periodoAtual}
              onTrocar={onTrocar}
            />
          )}

          {visaoGeral
            ? (
                <SeletorDeVigenciaGeral
                  periodos={periodosOverview}
                  ativa={overview?.period ?? null}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                />
              )
            : (
                <SeletorDeVigencia
                  view={view}
                  consulta={consulta}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                />
              )}

          <MenuDaGestaoAVista paraGestaoAVista={paraGestaoAVista} />
        </div>
      </div>
    </header>
  );
}

const BOTAO_DE_TROCA =
  "flex items-center gap-2 rounded-lg border border-brand bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";

function BancoVazio() {
  return (
    <div className={cn(CARTAO, "px-6 py-10 text-center")}>
      <p className="text-base font-bold">Nenhuma vigência para mostrar ainda.</p>
      <p className="text-sm text-muted-foreground mt-1.5">
        Envie a primeira planilha em Importações para o Dashboard ter o que vigiar.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unidade — o corpo inteiro da tela
// ---------------------------------------------------------------------------

function ConteudoDaUnidade({
  view,
  recorte,
  atualizadoEm,
  serie,
  familiaAberta,
  onAbrirFamilia,
  onFecharFamilia,
  onEscolherVigencia,
  voltarPara,
  onVoltar,
}: {
  view: FamiliesView;
  recorte: ReturnType<typeof lerRecorte>;
  atualizadoEm: number;
  /** A série do gráfico, já pronta — ver `lib/serie-de-impacto.ts`. */
  serie: { pontos: PontoDeImpacto[]; periodicity: string | null; carregando?: boolean };
  familiaAberta: string | null;
  onAbrirFamilia: (code: string) => void;
  onFecharFamilia: () => void;
  onEscolherVigencia: (periodo: string) => void;
  voltarPara: { periodo: string; label: string } | null;
  onVoltar: (periodo: string) => void;
}) {
  const cobertura = coberturaDePreco(view.totals.changes, view.impact.notCalculable);
  const principal = ladosDoImpacto(view)[0] ?? null;
  const dominante = impactosDaVigencia(view)[0]?.periodicity ?? null;

  const { pontos, periodicity, carregando = false } = serie;

  // As sparklines dos cartões só valem quando descrevem a mesma periodicidade
  // do número grande ao lado — misturar R$/mês no número e R$/ano na linha
  // seria a mesma mistura de escala que o produto se recusa a fazer em
  // qualquer outra tela.
  const sparklines =
    principal && periodicity === principal.periodicity && pontos.length >= 2
      ? { ganhos: pontos.map((p) => p.ganhos), perdas: pontos.map((p) => p.perdas) }
      : null;

  /*
    A unidade aberta, na mesma forma que a Visão Geral usa para cada uma das
    suas — uma lista de um item.

    A gaveta não precisa saber em qual das duas leituras está: o degrau por
    unidade mostra a única que existe aqui, e o degrau por placa pergunta a ela
    com o `scopeHash` dela, que é o mesmo caminho da Visão Geral. Escrever dois
    caminhos para o mesmo clique é como as duas leituras começariam a divergir.
  */
  const unidades: UnidadeDoDrill[] = [
    {
      chave: view.context.scopeHash,
      label: nomeDaUnidade(view.context),
      contexts: [{ scopeHash: view.context.scopeHash, channel: view.context.channel }],
      summary: view.summary,
    },
  ];

  return (
    <>
      <FaixaSlim
        changes={view.totals.changes}
        grupos={view.groups.length}
        vehiclesTouched={view.totals.vehiclesTouched}
        veiculosDeduplicados
        atualizadoEm={atualizadoEm}
      />

      <Indicadores principal={principal} cobertura={cobertura} sparklines={sparklines} />

      <ImpactoEPodio
        pontos={pontos}
        periodicity={periodicity}
        carregando={carregando}
        resumo={view}
        familias={view.families}
        dominante={dominante}
        period={view.period}
        periodLabel={view.periodLabel}
        vigenciaAtiva={view.period}
        recorte={recorte}
        unidades={unidades}
        familiaAberta={familiaAberta}
        onAbrirFamilia={onAbrirFamilia}
        onFecharFamilia={onFecharFamilia}
        onEscolherVigencia={onEscolherVigencia}
        voltarPara={voltarPara}
        onVoltar={onVoltar}
      />

      <PrincipaisAlteracoes linhas={linhasDaUnidade(view, recorte)} />

      <MovimentacaoDaFrota
        entitiesAdded={view.totals.entitiesAdded}
        entitiesRemoved={view.totals.entitiesRemoved}
        ativos={frotaTotal(view)}
      />

      <QualidadeDaApuracao
        cobertura={cobertura}
        notCalculable={view.impact.notCalculable}
        semCorrespondencia={view.totals.inconclusive}
      />
    </>
  );
}

/**
 * O gráfico de impacto por competência e o pódio de famílias, lado a lado —
 * a mesma faixa nas duas leituras.
 *
 * Fica num componente próprio porque é literalmente o mesmo bloco: o que muda
 * entre Unidade e Visão Geral são os dados que chegam nele, e um bloco escrito
 * duas vezes é onde as duas leituras começam a divergir no visual sem que
 * ninguém decida isso.
 */
function ImpactoEPodio({
  pontos,
  periodicity,
  carregando = false,
  resumo,
  familias,
  dominante,
  period,
  periodLabel,
  recorte,
  vigenciaAtiva,
  unidades,
  familiaAberta,
  onAbrirFamilia,
  onFecharFamilia,
  onEscolherVigencia,
  voltarPara,
  onVoltar,
  notaDoGrafico,
}: {
  pontos: PontoDeImpacto[];
  periodicity: string | null;
  /** A série ainda a caminho — ver `GraficoDeImpacto`. */
  carregando?: boolean;
  /** A vigência ou o consolidado — o pódio lê `summary.sides` dos dois. */
  resumo: Pick<FamiliesView, "summary"> | null;
  familias: FamiliaNoPodio[];
  dominante: string | null;
  /** A vigência aberta — `null` na Visão Geral, e aí a gaveta não abre portas. */
  period: string | null;
  periodLabel: string | null;
  recorte?: Recorte;
  /* A vigência que a tela está mostrando — a barra acesa no gráfico. Vem
     separada de `period` porque a Visão Geral tem competência aberta (e por
     isso barra acesa e clique) mesmo sem uma unidade a quem abrir a gaveta. */
  vigenciaAtiva: string | null;
  /**
   * As unidades por trás destes números — uma dentro de uma unidade, todas as
   * consolidadas em Visão Geral.
   *
   * É o que faz cada parâmetro da gaveta abrir por unidade e, dentro dela,
   * placa a placa. Vazia, a gaveta continua sendo a mesma leitura de antes.
   */
  unidades: UnidadeDoDrill[];
  familiaAberta: string | null;
  onAbrirFamilia: (code: string) => void;
  onFecharFamilia: () => void;
  /* Clicar numa barra do gráfico troca a vigência aberta — a tela inteira
     passa a falar da vigência clicada, e não só o gráfico. */
  onEscolherVigencia: (periodo: string) => void;
  /** O caminho de volta do gráfico — a lembrança fica na página. */
  voltarPara: { periodo: string; label: string } | null;
  onVoltar: (periodo: string) => void;
  notaDoGrafico?: string;
}) {
  /*
    A gaveta lê a **mesma** resposta que desenhou o pódio, e na mesma
    periodicidade dele. Dois pedidos seriam duas vigências possíveis, e é assim
    que o número da gaveta deixaria de bater com o número da linha.
  */
  const sides = resumo?.summary.sides ?? [];
  const periodicidade =
    sides.find((s) => s.periodicity === dominante)?.periodicity ?? sides[0]?.periodicity ?? null;
  const detalhe = detalheDaFamilia(resumo, familiaAberta, periodicidade);

  /*
    O pódio é calculado aqui, e não dentro de cada cartão: as duas colunas
    (o que somou e o que tirou) são dois recortes da **mesma** lista de
    famílias, e calculá-la duas vezes é onde as duas leituras começariam a
    divergir — bastaria uma delas escolher outra periodicidade.
  */
  const comImpacto = impactoPorFamilia(resumo, periodicidade);
  const temImpacto = comImpacto.length > 0 && periodicidade !== null;

  return (
    <div className="grid gap-5">
      {/*
        O gráfico ocupa a faixa inteira. Ele é uma série no tempo, e uma série
        espremida em três quintos da tela perde justamente o que ela existe
        para mostrar: a distância entre uma vigência e a seguinte.
      */}
      <section className={cn(CARTAO, "px-6 py-5")}>
        {/*
          O botão de voltar fica no canto superior direito do cartão, na linha
          do título: é o canto onde a tela guarda a saída, e ali ele aparece
          mesmo quando o gráfico não tem o que desenhar — dentro do gráfico, a
          vigência sem série levava embora o próprio caminho de volta.
        */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-bold">Impacto das alterações por vigência</h2>
          <BotaoDeVoltarVigencia destino={voltarPara} onVoltar={(periodo) => onVoltar?.(periodo)} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {notaDoGrafico ??
            "Ganhos e perdas divergindo do zero, com o líquido por cima. Uma barra por vigência entregue — duas no mesmo mês aparecem pelo dia, nunca somadas."}
        </p>
        <GraficoDeImpacto
          pontos={pontos}
          periodicity={periodicity}
          carregando={carregando}
          vigenciaAtiva={vigenciaAtiva}
          onEscolherVigencia={onEscolherVigencia}
        />
      </section>

      {/*
        Debaixo dele, o pódio partido em dois: o que somou à esquerda, o que
        tirou à direita. Uma lista só, ordenada por movimento, misturava as
        duas perguntas numa fila — a família que mais encareceu e a que mais
        barateou disputavam a mesma posição, e quem procurava "onde eu perdi
        dinheiro" tinha de ler linha a linha para descobrir de que cor era
        cada uma. Separadas, cada coluna responde a uma pergunta só.
      */}
      {temImpacto ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <MaioresImpactos
            lado="ganhos"
            familias={comImpacto}
            periodicidade={periodicidade}
            familiaAberta={familiaAberta}
            onAbrirFamilia={onAbrirFamilia}
          />
          <MaioresImpactos
            lado="perdas"
            familias={comImpacto}
            periodicidade={periodicidade}
            familiaAberta={familiaAberta}
            onAbrirFamilia={onAbrirFamilia}
          />
        </div>
      ) : (
        /*
          Sem preço apurado em lugar nenhum não há dois lados para separar —
          e dois cartões vazios lado a lado diriam duas vezes o mesmo nada.
          Aí volta a faixa inteira, com a contagem de alterações.
        */
        <MaioresImpactosPorQuantidade familias={familias} />
      )}

      <DetalheDaFamilia
        detalhe={detalhe}
        period={period}
        periodLabel={periodLabel}
        recorte={recorte}
        unidades={unidades}
        vigencia={vigenciaAtiva}
        onFechar={onFecharFamilia}
      />
    </div>
  );
}

/**
 * As linhas da tabela em modo Unidade — a fila do Acompanhamento, e o recorte
 * da tela em todas elas.
 *
 * `unidade: null` de propósito: a tela inteira já é de uma unidade, e repetir
 * o nome dela em cada linha é ruído.
 */
function linhasDaUnidade(view: FamiliesView, recorte: Recorte): LinhaDaTabela[] {
  const fila = juntarPrioridades(view);
  const grupos: ChangeGroup[] = fila.length > 0 ? fila.map((e) => e.group) : view.groups;
  const daVigencia = { ...recorte, period: view.period };
  return grupos.map((grupo) => ({
    chave: grupo.key,
    grupo,
    unidade: null,
    recorte: daVigencia,
  }));
}

/**
 * As linhas da tabela em Visão Geral — a fila já consolidada pelo servidor.
 *
 * Cada linha leva o recorte da **sua** unidade, e não o da tela: clicar numa
 * alteração de CAMAÇARI abre Alterações em CAMAÇARI, na competência aberta.
 * Um link que caísse no recorte da Visão Geral (que não tem unidade) abriria a
 * unidade padrão — a mesma promessa vazia que `lib/recorte.ts` existe para
 * evitar.
 */
export function linhasDaVisaoGeral(overview: FamiliesOverview): LinhaDaTabela[] {
  return overview.consolidado.groups.map((linha) => ({
    chave: `${linha.unidade}|${linha.channel ?? ""}|${linha.group.key}`,
    grupo: linha.group,
    unidade: linha.label,
    recorte: {
      period: overview.period,
      scopeHash: linha.scopeHash,
      canal: linha.channel,
    },
  }));
}

// ---------------------------------------------------------------------------
// Geral — o corpo inteiro da tela
// ---------------------------------------------------------------------------

/**
 * O mesmo corpo de tela da unidade, com as informações de todas elas.
 *
 * A tela não muda de forma quando se troca uma unidade pela Visão Geral: os
 * mesmos quatro indicadores, o mesmo gráfico por competência, o mesmo pódio de
 * famílias, a mesma tabela de alterações e a mesma movimentação de frota —
 * mais o ranking de unidades, que só a Visão Geral tem para dar.
 *
 * O que muda é a régua de cada peça, e ela está escrita em
 * `OverviewConsolidado` (servidor), não aqui: famílias somam, alterações
 * enfileiram sem mesclar (cada linha diz de que unidade é), frota soma porque
 * as populações são disjuntas. A ressalva que sobrevive à consolidação — o
 * pódio de parâmetros não abre gaveta sobre o total somado — continua dita
 * onde aparece; a contagem de veículos se explica sozinha na faixa do topo,
 * que diz se é união de ativos distintos ou soma de unidades.
 */
function ConteudoGeral({
  overview,
  atualizadoEm,
  onTrocar,
  serie,
  familiaAberta,
  onAbrirFamilia,
  onFecharFamilia,
  onEscolherVigencia,
  voltarPara,
  onVoltar,
}: {
  overview: FamiliesOverview;
  atualizadoEm: number;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  serie: PontoDeImpacto[];
  familiaAberta: string | null;
  onAbrirFamilia: (code: string) => void;
  onFecharFamilia: () => void;
  onEscolherVigencia: (periodo: string) => void;
  voltarPara: { periodo: string; label: string } | null;
  onVoltar: (periodo: string) => void;
}) {
  const cobertura = coberturaDePreco(overview.summary.changes, overview.summary.notCalculable);
  const principal = ladosDoImpacto(overview)[0] ?? null;
  const dominante = principal?.periodicity ?? null;
  const { totals } = overview.consolidado;

  /*
    Quem entrou na soma — e é por isso que a gaveta consegue abrir um parâmetro
    por unidade sem pedir nada ao servidor: cada unidade incluída já viaja com o
    seu próprio resumo executivo dentro da mesma resposta que desenhou o pódio.
    Um segundo pedido seriam duas vigências possíveis, e é assim que o número da
    gaveta deixaria de bater com o de cima.
  */
  const unidades: UnidadeDoDrill[] = overview.unitsIncluded.map((u) => ({
    chave: u.unidade,
    label: u.label,
    contexts: u.contexts.map((c) => ({ scopeHash: c.scopeHash, channel: c.channel })),
    summary: u.summary,
  }));

  // A mesma disciplina do modo Unidade: a sparkline só acompanha o número
  // grande quando as duas descrevem a mesma periodicidade.
  const sparklines =
    principal && serie.length >= 2
      ? { ganhos: serie.map((p) => p.ganhos), perdas: serie.map((p) => p.perdas) }
      : null;

  return (
    <>
      <FaixaSlim
        changes={overview.summary.changes}
        grupos={overview.summary.groups}
        /*
          `vehiclesTouchedDistinct` é a união dos ativos das unidades;
          `summary.vehiclesTouched` é a soma delas, e o servidor documenta que
          a soma não é uma cardinalidade global — o mesmo caminhão exportado
          por duas unidades entra duas vezes. A faixa publica a união, que é o
          que a palavra "veículos" promete quando aparece sozinha.

          A soma continua sendo o que a tela mostra quando a resposta é de uma
          versão anterior da API, ainda em cache e sem o campo novo — e aí o
          rótulo diz "soma das unidades" em vez de "distintos", porque um
          número somado com nome de conjunto é exatamente a confusão que esta
          faixa existe para desfazer.
        */
        vehiclesTouched={overview.vehiclesTouchedDistinct ?? overview.summary.vehiclesTouched}
        veiculosDeduplicados={overview.vehiclesTouchedDistinct !== undefined}
        atualizadoEm={atualizadoEm}
      />

      <Indicadores principal={principal} cobertura={cobertura} sparklines={sparklines} />

      <ImpactoEPodio
        pontos={serie}
        periodicity={dominante}
        resumo={overview}
        familias={overview.consolidado.families}
        dominante={dominante}
        /*
          Sem `period` e sem recorte: a Visão Geral não tem uma unidade a quem
          perguntar, e a gaveta que ela abre recusa a porta para Parâmetros em
          vez de prometer "esta família" e entregar a de `contexts[0]`.
        */
        period={null}
        periodLabel={null}
        /*
          A gaveta recusa a porta, mas o eixo do tempo continua navegável: a
          competência aberta existe na Visão Geral (`overview.period`), e é ela
          que acende a barra e recebe o clique.
        */
        vigenciaAtiva={overview.period}
        unidades={unidades}
        familiaAberta={familiaAberta}
        onAbrirFamilia={onAbrirFamilia}
        onFecharFamilia={onFecharFamilia}
        onEscolherVigencia={onEscolherVigencia}
        voltarPara={voltarPara}
        onVoltar={onVoltar}
        notaDoGrafico="Ganhos e perdas de todas as unidades incluídas, com o líquido por cima. Uma barra por competência — a unidade sem vigência naquela competência não entra nela."
      />

      <MovimentacaoDaFrota
        entitiesAdded={totals.entitiesAdded}
        entitiesRemoved={totals.entitiesRemoved}
        ativos={totals.fleet}
      />

      <PrincipaisAlteracoes
        linhas={linhasDaVisaoGeral(overview)}
        nota={
          "Na ordem do Acompanhamento — todas as unidades, dinheiro e criticidade primeiro. " +
          "Uma linha por tipo de alteração (atributo × equipamento) em cada unidade: o mesmo " +
          "atributo em duas unidades são duas linhas, porque são duas frotas e dois valores." +
          (overview.consolidado.gruposNoTotal > overview.consolidado.groups.length
            ? ` A fila traz os ${overview.consolidado.groups.length} de maior prioridade, de ${overview.consolidado.gruposNoTotal.toLocaleString("pt-BR")} que existem nesta competência.`
            : "")
        }
      />

      <RankingDeUnidades overview={overview} onTrocar={onTrocar} />

      <QualidadeDaApuracao
        cobertura={cobertura}
        notCalculable={overview.summary.notCalculable}
        semCorrespondencia={totals.inconclusive}
      />

      <p className="text-xs text-muted-foreground">
        No pódio, cada parâmetro abre por unidade e, dentro dela, placa a placa com o antes e o
        depois — a soma Geral não mescla a árvore de parâmetros entre unidades, então esse degrau
        é lido unidade por unidade, no recorte de cada uma. Os números por periodicidade dos
        cartões continuam sendo soma de unidades; a contagem de veículos da faixa do topo diz, ali
        mesmo, se é união de ativos distintos ou soma.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// A faixa fina de abertura — Unidade e Geral, a mesma leitura
// ---------------------------------------------------------------------------

/**
 * "355 alterações em 91 veículos distintos, agrupadas em 31 tipos — desde a
 * vigência anterior", com o relógio da última atualização do outro lado.
 *
 * Substitui o cartão grande de abertura das duas primeiras versões desta tela
 * — os mesmos números (`changes`/`vehiclesTouched`), sem a frase de impacto: o
 * líquido já tem cartão próprio logo abaixo, com corpo maior do que uma frase
 * soubesse dar a ele.
 *
 * A faixa nomeia os **três universos** da tela numa frase só, e é por isso que
 * ela ganhou o terceiro número. Eles estavam todos publicados, cada um num
 * canto, com a mesma palavra:
 *
 * - `changes` (355) conta **linhas** — uma por (veículo, atributo) que mudou;
 * - `grupos` (31) conta **tipos de alteração** — é o que a tabela de
 *   "Principais alterações" lista e o que as abas Cavalo/Carreta somam
 *   (17 + 14), e não tem como bater com 355;
 * - `vehiclesTouched` (91) conta **ativos distintos**, e por isso é sempre
 *   menor que 355: o mesmo caminhão entra em cada atributo que mudou nele.
 *
 * Escrever "355 alterações" ao lado de uma aba escrita "Cavalo 17" sem dizer
 * isto era a tela oferecendo três respostas para "quantas alterações?".
 *
 * O relógio nunca fabrica hora: é `dataUpdatedAt` da própria consulta
 * (`useQuery`), a mesma leitura da Gestão à Vista — `0` antes da primeira
 * resposta, e a faixa diz isso em vez de inventar um horário.
 */
function FaixaSlim({
  changes,
  grupos,
  vehiclesTouched,
  veiculosDeduplicados,
  atualizadoEm,
}: {
  changes: number;
  grupos: number;
  vehiclesTouched: number;
  /**
   * Se `vehiclesTouched` é a cardinalidade de um conjunto ou a soma de vários.
   *
   * Verdadeiro na Unidade, onde o servidor conta `entity_id` distintos numa
   * varredura só; falso no Geral, onde ele soma as unidades sem deduplicar
   * entre elas. A palavra na tela muda junto — "distintos" é uma afirmação
   * sobre o método, não um enfeite do rótulo.
   */
  veiculosDeduplicados: boolean;
  atualizadoEm: number;
}) {
  const veiculos = veiculosDeduplicados
    ? vehiclesTouched === 1
      ? "veículo distinto"
      : "veículos distintos"
    : vehiclesTouched === 1
      ? "veículo afetado (soma das unidades)"
      : "veículos afetados (soma das unidades)";
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-1 py-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span
          title={
            `${changes.toLocaleString("pt-BR")} linhas de alteração: uma por veículo e atributo que mudou. ` +
            `${grupos.toLocaleString("pt-BR")} tipos de alteração: o mesmo atributo em vários veículos conta uma vez — ` +
            "é o que a tabela de Principais alterações lista e o que as abas de equipamento somam. " +
            `${vehiclesTouched.toLocaleString("pt-BR")} ${veiculos}: ` +
            (veiculosDeduplicados
              ? "o mesmo veículo conta uma vez, por mais alterações que tenha. A identidade do ativo é global (casada por placa e chassi), então ele também não conta duas vezes quando aparece em mais de uma unidade."
              : "soma das unidades, sem deduplicar entre elas — é uma aproximação, e não uma contagem de ativos distintos.")
          }
        >
          <strong className="text-foreground tabular-nums">{changes.toLocaleString("pt-BR")}</strong>{" "}
          {changes === 1 ? "alteração detectada" : "alterações detectadas"}
          {vehiclesTouched > 0 && (
            <>
              {" em "}
              <strong className="text-foreground tabular-nums">
                {vehiclesTouched.toLocaleString("pt-BR")}
              </strong>{" "}
              {veiculos}
            </>
          )}
          {grupos > 0 && (
            <>
              {", em "}
              <strong className="text-foreground tabular-nums">
                {grupos.toLocaleString("pt-BR")}
              </strong>{" "}
              {grupos === 1 ? "tipo de alteração" : "tipos de alteração"}
            </>
          )}
          {" — desde a vigência anterior"}
        </span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <Clock className="w-3.5 h-3.5" />
        {atualizadoEm === 0
          ? "aguardando a primeira resposta…"
          : `atualização ${new Date(atualizadoEm).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}`}
      </span>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cobertura de preço — "24 de 33 alterações precificadas"
// ---------------------------------------------------------------------------

export interface CoberturaDePreco {
  apurado: number;
  total: number;
  percentual: number;
}

/**
 * "24 de 33 alterações precificadas" — a fração de alterações que já viraram
 * dinheiro (apurado ou excluído por já contar noutra parcela), sobre o total,
 * mais o percentual pronto para o anel de progresso.
 *
 * A identidade `apurado + semPreco = total` é a mesma que `porApuracao`
 * (`composicaoDasAlteracoes`) garante nas suas três fatias — aqui só a conta
 * mais simples dela. `null` sem alteração nenhuma: uma fração `0/0` não é
 * cobertura, é ausência de vigência.
 */
function coberturaDePreco(total: number, semPreco: number): CoberturaDePreco | null {
  if (total === 0) return null;
  const apurado = total - semPreco;
  return { apurado, total, percentual: (apurado / total) * 100 };
}

// ---------------------------------------------------------------------------
// Os indicadores — quatro cartões, o líquido em destaque
// ---------------------------------------------------------------------------

/**
 * Os quatro números que respondem "quanto custou" — na mesma régua para a
 * Unidade e para o Geral, porque `FamiliesOverview.summary` tem a mesma forma
 * de `ExecutiveSummary` que `FamiliesView.summary`.
 *
 * O Impacto líquido é o cartão em destaque — o número que a Ambev pergunta em
 * reunião primeiro. Ele nunca ganha um "projetado em 12 meses": este produto
 * só publica medida, e anualizar o líquido de uma competência multiplicaria
 * uma medida por doze para chamar o resultado de outra coisa.
 */
function Indicadores({
  principal,
  cobertura,
  sparklines,
}: {
  principal: LadosDoImpacto | null;
  cobertura: CoberturaDePreco | null;
  sparklines: { ganhos: number[]; perdas: number[] } | null;
}) {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Cartao
        icone={TrendingDown}
        titulo="Perdas mensais"
        explicacao={
          `Soma só do que reduziu a remuneração, na periodicidade dominante. ` +
          "Cobre a vigência inteira — todas as alterações precificadas, e não só as " +
          "linhas da tabela de Principais alterações."
        }
      >
        {principal ? (
          <div className="flex items-end justify-between gap-2">
            <p className="text-3xl font-extrabold tabular-nums text-red-700">
              {formatBrlShort(principal.perdas)}
              {principal.periodicity !== "MENSAL" && (
                <span className="text-xs font-normal text-muted-foreground block mt-1">
                  {periodicitySuffix(principal.periodicity)}
                </span>
              )}
            </p>
            {sparklines && sparklines.perdas.length >= 2 && (
              <Sparkline valores={sparklines.perdas} cor="#dc2626" />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">sem valor apurado</p>
        )}
      </Cartao>

      <Cartao
        icone={TrendingUp}
        titulo="Ganhos mensais"
        explicacao={
          `Soma só do que aumentou a remuneração, na periodicidade dominante. ` +
          "Cobre a vigência inteira — todas as alterações precificadas, e não só as " +
          "linhas da tabela de Principais alterações."
        }
      >
        {principal ? (
          <div className="flex items-end justify-between gap-2">
            <p className="text-3xl font-extrabold tabular-nums text-emerald-700">
              {formatBrlShort(principal.ganhos)}
              {principal.periodicity !== "MENSAL" && (
                <span className="text-xs font-normal text-muted-foreground block mt-1">
                  {periodicitySuffix(principal.periodicity)}
                </span>
              )}
            </p>
            {sparklines && sparklines.ganhos.length >= 2 && (
              <Sparkline valores={sparklines.ganhos} cor="#059669" />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">sem valor apurado</p>
        )}
      </Cartao>

      <Cartao
        icone={ReceiptText}
        titulo="Impacto líquido"
        explicacao={
          "Ganhos menos perdas da vigência inteira, na mesma periodicidade. É o mesmo " +
          "número que a barra de líquido do gráfico marca na vigência aberta, e o mesmo " +
          "que as famílias de Maiores impactos somam."
        }
        destaque
        className="min-w-0"
      >
        {principal ? (
          <>
            <p
              className={cn(
                "text-2xl sm:text-3xl xl:text-4xl font-extrabold tabular-nums leading-none whitespace-nowrap",
                principal.liquido < 0 ? "text-red-700" : "text-emerald-700",
              )}
            >
              {formatBrlShort(principal.liquido)}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              {periodicitySuffix(principal.periodicity) || " valor único"} · +
              {formatBrlShort(principal.ganhos)} / {formatBrlShort(principal.perdas)}
            </p>
          </>
        ) : (
          <p className="text-xl font-extrabold text-muted-foreground">Nenhum valor apurável</p>
        )}
      </Cartao>

      <Cartao
        icone={Gauge}
        titulo="Cobertura financeira"
        explicacao={
          "Fração das linhas de alteração da vigência que já viraram dinheiro — o mesmo " +
          "universo do primeiro número da faixa do topo, e não o dos tipos de alteração " +
          "que a tabela lista. Precificada é toda linha que tem valor apurado, em qualquer " +
          "periodicidade: entram aqui as apuradas em R$ 0,00 e as que já são contadas " +
          "noutra parcela, que por isso não somam nem tiram nos Maiores impactos. É por " +
          "isso que este número é maior que as contagens do pódio, e não bate com elas."
        }
      >
        {cobertura ? (
          <div className="flex items-center gap-3">
            <AnelDeCobertura percentual={cobertura.percentual} />
            <p className="text-xs text-muted-foreground leading-snug">
              <strong className="text-foreground tabular-nums">
                {cobertura.apurado.toLocaleString("pt-BR")}
              </strong>{" "}
              de{" "}
              <strong className="text-foreground tabular-nums">
                {cobertura.total.toLocaleString("pt-BR")}
              </strong>{" "}
              alterações precificadas
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">sem alteração nesta vigência</p>
        )}
      </Cartao>
    </div>
  );
}

function Cartao({
  icone: Icone,
  titulo,
  explicacao,
  children,
  className,
  destaque = false,
}: {
  icone: typeof FileText;
  titulo: string;
  /** O universo que o cartão mede, por extenso — ver `Indicador.titulo`. */
  explicacao?: string;
  children: React.ReactNode;
  className?: string;
  destaque?: boolean;
}) {
  return (
    <section
      title={explicacao}
      className={cn(
        CARTAO,
        "p-5 flex flex-col overflow-hidden",
        destaque && "bg-accent/40 border-brand/30 border-2",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shrink-0">
          <Icone className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
        </span>
        <h2 className="text-[0.8125rem] font-bold">{titulo}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Maiores impactos desta vigência — antiga "Onde a Ambev alterou"
// ---------------------------------------------------------------------------

/**
 * Uma linha do pódio — o mínimo que ele lê, e por isso o que Unidade e Visão
 * Geral conseguem entregar com a mesma forma.
 *
 * `FamilyView` (unidade) tem tudo isto e mais; `OverviewFamilyTotal` (a soma
 * entre unidades) tem só isto, de propósito — "4 de 10 parâmetros" é uma
 * fração de uma unidade e não sobrevive à soma. Tipar pelo mínimo é o que
 * deixa o mesmo pódio servir às duas sem um `as` no meio.
 */
export interface FamiliaNoPodio {
  code: string;
  name: string;
  changes: number;
  impact: { byPeriodicity: Record<string, number> };
}

/**
 * Um lado do pódio: as famílias que mais somaram, ou as que mais tiraram,
 * na periodicidade dominante da vigência.
 *
 * Duas instâncias deste cartão dividem a faixa debaixo do gráfico. Elas leem
 * a **mesma** lista de famílias — cada uma filtrando e ordenando pelo seu
 * lado — porque o que se pergunta olhando para cá são duas perguntas
 * distintas ("onde eu ganhei" e "onde eu perdi") e uma fila única, ordenada
 * por movimento, obrigava a lê-las misturadas.
 *
 * A escala da barra é a do próprio cartão: a maior linha dele enche a barra,
 * e as outras se medem contra ela. Uma escala compartilhada entre os dois
 * cartões deixaria o lado menor com cinco fiapos ilegíveis, e a comparação
 * entre os dois lados já está feita, com rigor, no gráfico logo acima.
 *
 * O número grande é o do lado; o líquido da família vai embaixo, menor —
 * a família que aparece nos dois cartões é a mesma, e é o líquido que diz o
 * que sobrou dela no fim.
 */
function MaioresImpactos({
  lado,
  familias,
  periodicidade,
  familiaAberta,
  onAbrirFamilia,
}: {
  lado: Lado;
  /** O pódio inteiro, já na periodicidade escolhida — o cartão recorta o seu lado. */
  familias: ImpactoDeFamilia[];
  periodicidade: string;
  /** A família cuja gaveta está aberta, para a linha ficar marcada atrás dela. */
  familiaAberta: string | null;
  onAbrirFamilia: (code: string) => void;
}) {
  const ganho = lado === "ganhos";

  // Ordenado pelo módulo do próprio lado, e não pelo líquido: este cartão
  // responde "quanto entrou/saiu aqui", que é uma parcela, não a subtração.
  const doLado = familias
    .filter((f) => (ganho ? f.ganhos > 0 : f.perdas < 0))
    .sort((a, b) => Math.abs(ganho ? b.ganhos : b.perdas) - Math.abs(ganho ? a.ganhos : a.perdas))
    .slice(0, 5);

  const teto = doLado.reduce((maior, f) => Math.max(maior, Math.abs(ganho ? f.ganhos : f.perdas)), 0);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-bold">
          Maiores impactos {ganho ? "positivos" : "negativos"} desta vigência
        </h2>
        {doLado.length > 0 && (
          <span className="text-xs font-semibold text-muted-foreground">
            em R${periodicitySuffix(periodicidade)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {ganho
          ? "Por família da remuneração — o que somou em cada uma, com o líquido dela embaixo. Até cinco, pelas que mais somaram. Clique para ver de onde vem."
          : "Por família da remuneração — o que tirou em cada uma, com o líquido dela embaixo. Até cinco, pelas que mais tiraram. Clique para ver de onde vem."}
      </p>

      {doLado.length > 0 ? (
        <ol className="space-y-3 flex-1">
          {doLado.map((familia, indice) => {
            const valor = ganho ? familia.ganhos : familia.perdas;
            /*
              As alterações **deste lado**, e não as da família inteira.

              `ImpactoDeFamilia.alteracoes` conta os dois lados juntos, que era
              o número certo quando o pódio era uma lista só. Partido em dois
              cartões ele vira uma afirmação falsa: a mesma família aparece nos
              dois, e repetir "59 alterações" em cada um diria que 118
              alterações somaram e tiraram nesta vigência. Somadas as duas
              contagens de agora, dá exatamente `familia.alteracoes`.
            */
            const doLadoContagem = familia.parametros[lado].reduce((n, l) => n + l.changes, 0);
            return (
              <li key={familia.code}>
                {/*
                  A linha inteira é o botão, e não uma seta no fim dela — a mesma
                  régua do pódio do Resumo executivo: o que se quer clicar aqui é
                  o número, e um alvo de 16 pixels na borda direita obrigaria a
                  mirar para fazer a pergunta mais óbvia da tela.
                */}
                <button
                  type="button"
                  onClick={() => onAbrirFamilia(familia.code)}
                  title={`De onde vem o impacto de ${familia.name}`}
                  aria-expanded={familiaAberta === familia.code}
                  className={cn(
                    "w-full flex items-center gap-3 text-left rounded-lg px-2 -mx-2 py-1.5 -my-1.5",
                    "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors group",
                    familiaAberta === familia.code && "bg-muted/60",
                  )}
                >
                  <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                    {indice + 1}
                  </span>
                  <span className="w-32 shrink-0 min-w-0">
                    <span
                      className="block text-sm font-semibold truncate group-hover:underline"
                      title={familia.name}
                    >
                      {familia.name}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate">
                      {doLadoContagem.toLocaleString("pt-BR")}{" "}
                      {doLadoContagem === 1 ? "alteração" : "alterações"}{" "}
                      {ganho ? "somaram" : "tiraram"}
                    </span>
                  </span>
                  <BarraDoLado valor={valor} teto={teto} ganho={ganho} />
                  <span className="w-28 shrink-0 text-right">
                    <span
                      className={cn(
                        "block text-xs font-bold tabular-nums",
                        ganho ? "text-emerald-700" : "text-red-700",
                      )}
                    >
                      {escreverImpacto({ periodicity: periodicidade, amount: valor })}
                    </span>
                    {/*
                      O líquido embaixo, e não no lugar do lado.

                      A mesma família costuma aparecer nos dois cartões, e o
                      número grande de cada um é só a sua parcela: sem o líquido
                      aqui, a família que somou R$ 40 mil e tirou R$ 39 mil se
                      leria como dois acontecimentos enormes e independentes.
                    */}
                    <span className="block text-[0.6875rem] tabular-nums leading-tight text-muted-foreground">
                      líquido {formatBrlShort(familia.liquido)}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground flex-1">
          {ganho
            ? "Nenhuma família somou dinheiro nesta vigência."
            : "Nenhuma família tirou dinheiro nesta vigência."}
        </p>
      )}
    </section>
  );
}

/**
 * O pódio quando nada tem preço apurado — a faixa inteira, por quantidade.
 *
 * Sem impacto em lugar nenhum não há dois lados a separar, e dois cartões
 * vazios lado a lado diriam duas vezes o mesmo nada. A família sem preço
 * ainda tem o que dizer: quantas alterações ela concentrou.
 */
function MaioresImpactosPorQuantidade({ familias }: { familias: FamiliaNoPodio[] }) {
  const porQuantidade = [...familias]
    .filter((f) => f.changes > 0)
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 5);
  const teto = porQuantidade.reduce((maior, f) => Math.max(maior, f.changes), 0);

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <h2 className="text-base font-bold mb-1">Maiores impactos desta vigência</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Nenhuma alteração desta vigência tem preço apurado — o pódio vai por quantidade de
        alterações, pela família que mais concentrou.
      </p>
      {porQuantidade.length > 0 ? (
        <ol className="space-y-3.5">
          {porQuantidade.map((familia, indice) => (
            <li key={familia.code} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                {indice + 1}
              </span>
              <span className="w-32 shrink-0 min-w-0 text-sm font-semibold truncate" title={familia.name}>
                {familia.name}
              </span>
              <span className="flex-1 h-3 bg-muted overflow-hidden min-w-8 rounded-sm">
                <span
                  className="block h-full bg-brand"
                  style={{
                    width: `${teto === 0 ? 0 : Math.max(2, (familia.changes / teto) * 100)}%`,
                  }}
                />
              </span>
              <span className="text-xs font-bold tabular-nums w-24 text-right">
                {familia.changes} {familia.changes === 1 ? "alteração" : "alterações"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma família registrou alteração nesta vigência.
        </p>
      )}
    </section>
  );
}

/**
 * A barra de uma linha do pódio — um lado só, na escala do seu cartão.
 *
 * O comprimento mede o valor daquele lado contra a maior linha do mesmo
 * cartão, e a cor é a do lado: verde no cartão do que somou, vermelha no do
 * que tirou. Cada cartão faz uma pergunta só, e a barra bicolor de antes —
 * que dividia movimento entre ganho e perda — respondia às duas de uma vez,
 * o que era exatamente o que empurrava as duas leituras para a mesma fila.
 *
 * A linha de topo enche a barra; a comparação rigorosa entre os dois lados
 * continua no gráfico logo acima, que os desenha na mesma escala.
 */
function BarraDoLado({ valor, teto, ganho }: { valor: number; teto: number; ganho: boolean }) {
  const largura = teto === 0 ? 0 : Math.max(2, (Math.abs(valor) / teto) * 100);
  return (
    <span className="flex-1 h-3 bg-muted overflow-hidden min-w-8 rounded-sm">
      <span
        className={cn("block h-full", ganho ? "bg-emerald-600" : "bg-red-600")}
        style={{ width: `${largura}%` }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Principais alterações — a tabela, nomes de negócio sempre
// ---------------------------------------------------------------------------

/**
 * Uma linha da tabela de Principais alterações.
 *
 * O grupo continua sendo o que o servidor apurou; o que a linha acrescenta é
 * **de quem ele é** — `unidade` (preenchida só em Visão Geral, onde a tabela
 * mistura unidades) e o `recorte` que o link de detalhe abre, que em Visão
 * Geral é o da unidade daquela linha e não o da tela. `chave` existe porque
 * `ChangeGroup.key` só é única dentro de uma unidade: a mesma alteração em
 * duas unidades tem a mesma chave, e duas linhas com a mesma `key` no React
 * são uma linha só.
 */
interface LinhaDaTabela {
  chave: string;
  grupo: ChangeGroup;
  unidade: string | null;
  recorte: Recorte;
}

/** Cavalo sempre à frente de Carreta — as demais abas seguem a ordem de chegada. */
const PRIORIDADE_ABA: Record<string, number> = { CAVALO: 0, CARRETA: 1 };

/**
 * As abas de equipamento da tabela — uma por tipo presente na vigência.
 *
 * Cavalo e Carreta respondem a perguntas diferentes (um consome diesel e
 * amortiza financiamento, o outro nem sempre tem tração), e misturá-los numa
 * fila só fazia a tabela alternar de assunto linha a linha. As abas saem dos
 * próprios grupos, e não de uma lista fixa: só aparece a aba que tem conteúdo.
 * A ordem de prioridade do servidor se preserva dentro de cada aba; entre as
 * abas, Cavalo vem sempre primeiro, Carreta em seguida, e qualquer outro
 * equipamento na ordem em que chegou. Um grupo sem `entityType` cai numa aba
 * própria, com a etiqueta que o servidor já deu a ele, em vez de sumir da
 * tela.
 */
export function abasDeEquipamento(
  grupos: ChangeGroup[],
): { chave: string; rotulo: string; grupos: ChangeGroup[] }[] {
  const abas = new Map<string, { chave: string; rotulo: string; grupos: ChangeGroup[] }>();
  for (const grupo of grupos) {
    const chave = grupo.entityType ?? "SEM_EQUIPAMENTO";
    const aba = abas.get(chave);
    if (aba) aba.grupos.push(grupo);
    else abas.set(chave, { chave, rotulo: grupo.equipment, grupos: [grupo] });
  }
  return [...abas.values()].sort(
    (a, b) => (PRIORIDADE_ABA[a.chave] ?? 99) - (PRIORIDADE_ABA[b.chave] ?? 99),
  );
}

/**
 * As colunas Antes / Agora / Diferença de uma linha da tabela.
 *
 * Espelha os mesmos ramos de `<BeforeAfter>` (`components/inicio/group-card.tsx`):
 * só existe total de Antes e Agora quando `aggregation = SUM` — somar km/l ou
 * litros/100km de dezenas de veículos produziria um número que não significa
 * nada. Fora desse caso, Antes e Agora ficam em branco e a Diferença carrega a
 * mesma faixa de variação (ou o padrão dominante) que o cartão de alteração já
 * mostra, para as duas telas nunca se contradizerem sobre o mesmo grupo.
 */
export function celulasAntesDepois(grupo: ChangeGroup) {
  const a = grupo.aggregate;

  if (a.summable && a.totalBefore !== null && a.totalAfter !== null) {
    const alta = a.totalAfter >= a.totalBefore;
    return {
      antes: formatValue(a.totalBefore, grupo.unit),
      agora: formatValue(a.totalAfter, grupo.unit),
      diferenca: (
        <span className={cn("font-semibold whitespace-nowrap", alta ? "text-emerald-700" : "text-red-700")}>
          {alta ? "+" : ""}
          {formatValue(a.totalAfter - a.totalBefore, grupo.unit)}
          {a.deltaPercent !== null && (
            <span
              className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold",
                alta ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800",
              )}
            >
              {formatPercent(a.deltaPercent)}
            </span>
          )}
        </span>
      ),
    };
  }

  if (a.minPercent !== null && a.maxPercent !== null) {
    return {
      antes: "—",
      agora: "—",
      diferenca: (
        <span className="text-xs text-muted-foreground">
          variação de {formatPercent(a.minPercent)} a {formatPercent(a.maxPercent)} por veículo
          <br />
          <span className="italic">não somável ({a.aggregation ?? "agregação não definida"})</span>
        </span>
      ),
    };
  }

  if (grupo.dominantPattern) {
    return {
      antes: grupo.dominantPattern.before ?? "—",
      agora: grupo.dominantPattern.after ?? "—",
      diferenca: <span className="text-muted-foreground">—</span>,
    };
  }

  return {
    antes: "—",
    agora: "—",
    diferenca: <span className="text-muted-foreground italic">sem variação numérica</span>,
  };
}

/** O selo de cor de um indicador do cabeçalho — a mesma paleta de `BADGE_STYLE` (group-card.tsx). */
const TOM_INDICADOR = {
  azul: "bg-sky-50 text-sky-600",
  violeta: "bg-violet-50 text-violet-600",
  positivo: "bg-emerald-50 text-emerald-700",
  negativo: "bg-red-50 text-red-700",
} as const;

/**
 * Um indicador do cabeçalho — contagem ou impacto, com o valor em destaque.
 *
 * `ordem` inverte valor e rótulo: as contagens leem "8, alterações" (o número
 * primeiro, porque é a resposta), o impacto lê "Impacto líquido, −R$ 53.256"
 * (o rótulo primeiro, porque só o número não diz de quê).
 */
function Indicador({
  icone: Icone,
  tom,
  valor,
  rotulo,
  titulo,
  ordem = "valor-rotulo",
}: {
  icone: LucideIcon;
  tom: keyof typeof TOM_INDICADOR;
  valor: React.ReactNode;
  rotulo: string;
  /**
   * O universo que o número mede, por extenso.
   *
   * Não é decoração: três indicadores lado a lado com "alterações",
   * "veículos" e "impacto" cabem em duas palavras cada, e duas palavras não
   * distinguem "as 8 linhas que você está vendo" de "as 355 da vigência". O
   * rótulo diz o que é, e isto diz de onde saiu.
   */
  titulo?: string;
  ordem?: "valor-rotulo" | "rotulo-valor";
}) {
  const linhas =
    ordem === "valor-rotulo" ? (
      <>
        <div className="font-bold tabular-nums text-lg leading-tight">{valor}</div>
        <div className="text-xs text-muted-foreground leading-tight">{rotulo}</div>
      </>
    ) : (
      <>
        <div className="text-xs text-muted-foreground leading-tight">{rotulo}</div>
        <div className="font-bold tabular-nums text-lg leading-tight">{valor}</div>
      </>
    );
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5"
      title={titulo}
    >
      <span className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", TOM_INDICADOR[tom])}>
        <Icone className="w-4 h-4" strokeWidth={2.25} />
      </span>
      <div>{linhas}</div>
    </div>
  );
}

/**
 * Quantos veículos **distintos** as linhas visíveis tocaram — a união dos
 * ativos, e nunca a soma de `grupo.vehicles`.
 *
 * Somar era o que estava no ar, e o número resultante não tinha nome: oito
 * linhas rendiam "42 veículos impactados" ao lado de "91 veículos afetados" na
 * faixa de cima, e os dois diziam "veículos". 42 não era um subconjunto de 91
 * — era 91 contado várias vezes e cortado em oito linhas, porque o mesmo
 * caminhão entra uma vez em cada atributo que mudou nele. A soma podia até
 * passar a frota inteira.
 *
 * A união só é possível porque o grupo carrega **quais** ativos
 * (`entityIds`), e não só quantos. São as mesmas chaves que o servidor usa em
 * `totals.vehiclesTouched`, então este número é comparável com o da faixa: é
 * sempre um subconjunto dele.
 *
 * `null` quando algum grupo chega sem `entityIds` — resposta de uma versão
 * anterior da API ainda em cache. Uma união parcial subestimaria em silêncio,
 * e este produto não publica número que não sabe defender: a tela diz que não
 * sabe.
 */
export function veiculosDistintos(grupos: ChangeGroup[]): number | null {
  const ativos = new Set<string>();
  for (const grupo of grupos) {
    if (!Array.isArray(grupo.entityIds)) return null;
    for (const id of grupo.entityIds) ativos.add(id);
  }
  return ativos.size;
}

/**
 * O impacto líquido das linhas visíveis — só quando todas compartilham a
 * mesma periodicidade.
 *
 * Somar R$/mês com R$/ano no mesmo total é o erro que este produto existe
 * para pegar (ver o comentário do Painel de Impacto, no topo do arquivo); um
 * indicador de cabeçalho não ganha isenção dessa regra só por ser um resumo.
 * Vindo períodos misturados, o indicador diz isso em vez de mostrar um número.
 *
 * **Soma os valores publicados, e não os crus.** Este indicador não é o
 * líquido da vigência — é a soma das oito linhas que estão na tela, e é assim
 * que ele se anuncia. Somado no cru e cortado uma vez no fim, ele discordava
 * da própria coluna: em 01/08/2026, na aba Carreta, as três perdas terminam em
 * −,58, −,60 e −,61, cada uma sobe um centavo ao ser escrita, e quem somasse
 * o que estava na tela chegava a −R$ 20.463 contra os −R$ 20.462 do cartão.
 *
 * O dado não muda: `impact.amount` continua em centavos, o servidor continua
 * sendo a fonte, e os cartões do topo — que resumem a vigência inteira e não
 * uma fatia visível — continuam saindo de `summary.sides`, no cru. O que muda
 * é de onde **este** número soma, e ele soma de onde diz que soma.
 */
export function impactoLiquidoDaTabela(grupos: ChangeGroup[]) {
  const precificados = grupos.filter(
    (g) => g.impact.confidence === "CALCULATED" && g.impact.amount !== null,
  );
  if (precificados.length === 0) return null;
  const periodicidades = new Set(precificados.map((g) => g.impact.periodicity));
  if (periodicidades.size > 1) return { misturado: true as const };
  const total = precificados.reduce((soma, g) => soma + reaisPublicados(g.impact.amount!), 0);
  return { misturado: false as const, total, periodicidade: precificados[0].impact.periodicity };
}

/**
 * As alterações mais relevantes desta vigência, na ordem de prioridade do
 * cockpit — a mesma fila que o Acompanhamento e `ultimasAlteracoes` já usam
 * (`juntarPrioridades`, `lib/cockpit.ts`). Reordenar aqui por conta própria
 * faria esta tabela discordar da lista de "Alterações recentes" que já existe
 * no produto sobre os mesmos dados.
 *
 * A tabela abre numa aba por equipamento (`abasDeEquipamento`), porque uma
 * fila única alternava entre Cavalo e Carreta a cada linha; a fatia de oito
 * linhas passa a ser das oito maiores prioridades **daquele** equipamento. A
 * aba de Cavalo vem sempre primeiro. Com um equipamento só na vigência, as
 * abas somem e o equipamento volta a aparecer sob o título da linha, como
 * antes.
 *
 * Os três indicadores do cabeçalho resumem só a fatia visível (as linhas da
 * aba aberta, até oito) — trocar de aba troca o resumo junto, porque ele
 * responde "o que estou vendo", não "o que existe na vigência inteira".
 *
 * Cada linha mostra `grupo.title` — a etiqueta de negócio já curada por
 * `attributeLabel()` no servidor — e nunca `attributeCode` cru. O ícone à
 * esquerda do título é só decorativo (`iconeDaAlteracao`): uma pista de que
 * tipo de mudança é aquela, com uma etiqueta neutra sempre que a régua de
 * palavras-chave não reconhece nada — nunca um ícone específico arriscado por
 * adivinhação. A cor de fundo da linha (e da coluna Impacto/mês, sempre
 * destacada) segue o sinal do impacto; sem preço, a linha fica neutra.
 */
function PrincipaisAlteracoes({ linhas, nota }: { linhas: LinhaDaTabela[]; nota?: string }) {
  const porGrupo = new Map(linhas.map((l) => [l.grupo, l]));
  const ordenados: ChangeGroup[] = linhas.map((l) => l.grupo);
  const abas = abasDeEquipamento(ordenados);
  const [escolhida, escolher] = useState<string | null>(null);
  const ativa = abas.find((aba) => aba.chave === escolhida) ?? abas[0];
  const daAba = ativa ? ativa.grupos : ordenados;
  const grupos = daAba.slice(0, 8);
  const veiculos = veiculosDistintos(grupos);
  const impacto = impactoLiquidoDaTabela(grupos);
  const escopo = ativa && abas.length > 1 ? ` de ${ativa.rotulo}` : "";

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-bold">Principais alterações</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {nota ??
              "Na ordem do Acompanhamento — dinheiro e criticidade primeiro. Uma linha por tipo de alteração (atributo × equipamento), não por veículo."}
          </p>
        </div>

        {grupos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Indicador
              icone={SlidersHorizontal}
              tom="azul"
              valor={`${grupos.length} de ${daAba.length}`}
              rotulo={`tipos de alteração${escopo} exibidos`}
              titulo={
                `A tabela mostra no máximo os 8 de maior prioridade. ${daAba.length} ` +
                `${daAba.length === 1 ? "tipo de alteração existe" : "tipos de alteração existem"}` +
                `${escopo} nesta vigência${
                  abas.length > 1 ? ` (${abas.map((a) => `${a.rotulo} ${a.grupos.length}`).join(", ")})` : ""
                }. Um tipo é um atributo num equipamento; a faixa do topo conta linhas — ` +
                "uma por veículo e atributo —, por isso o número de lá é maior."
              }
            />
            <Indicador
              icone={Truck}
              tom="violeta"
              valor={veiculos === null ? "—" : veiculos.toLocaleString("pt-BR")}
              rotulo={
                veiculos === null
                  ? "veículos — recarregue a página"
                  : "veículos distintos nas linhas exibidas"
              }
              titulo={
                veiculos === null
                  ? "Esta resposta veio de uma versão anterior da API, sem a identidade dos ativos. Sem ela, só daria para somar as linhas — e a soma contaria o mesmo veículo uma vez por alteração."
                  : "Ativos distintos tocados pelas linhas acima: o mesmo veículo conta uma vez, mesmo aparecendo em várias delas. É um subconjunto dos veículos distintos da faixa do topo, que cobre a vigência inteira."
              }
            />
            <Indicador
              icone={impacto && !impacto.misturado && impacto.total < 0 ? TrendingDown : TrendingUp}
              tom={
                impacto === null || impacto.misturado
                  ? "azul"
                  : impacto.total < 0
                    ? "negativo"
                    : "positivo"
              }
              ordem="rotulo-valor"
              rotulo="Impacto líquido das linhas exibidas"
              titulo={
                "Soma dos valores escritos nas linhas acima, e só delas — some a coluna à " +
                "mão e chega neste número. Trocar de aba ou de vigência troca ele junto. O " +
                "Impacto líquido dos cartões do topo cobre a vigência inteira, sai da " +
                "apuração em centavos, e é sempre o número maior."
              }
              valor={
                impacto === null ? (
                  "sem preço"
                ) : impacto.misturado ? (
                  "periodicidades diferentes"
                ) : (
                  <span className={impacto.total < 0 ? "text-red-700" : "text-emerald-700"}>
                    {formatBrlShort(impacto.total)}
                    <span className="font-normal text-muted-foreground">
                      {periodicitySuffix(impacto.periodicidade)}
                    </span>
                  </span>
                )
              }
            />
          </div>
        )}
      </div>

      {abas.length > 1 && ativa && (
        <Tabs value={ativa.chave} onValueChange={escolher} className="mb-4">
          <TabsList>
            {abas.map((aba) => (
              <TabsTrigger
                key={aba.chave}
                value={aba.chave}
                title={`${aba.grupos.length} ${
                  aba.grupos.length === 1 ? "tipo de alteração" : "tipos de alteração"
                } em ${aba.rotulo} nesta vigência. As abas somam os tipos, não as linhas: a faixa do topo conta uma linha por veículo e atributo, e por isso é um número maior.`}
              >
                {aba.rotulo}
                <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                  {aba.grupos.length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground flex-1">
          Nenhuma alteração nesta vigência.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="font-semibold px-2 pb-2">Alteração</th>
                <th className="font-semibold px-2 pb-2">Antes</th>
                <th className="font-semibold px-2 pb-2">Agora</th>
                <th className="font-semibold px-2 pb-2">Diferença</th>
                <th className="font-semibold px-2 pb-2 text-right">Veíc.</th>
                <th className="font-semibold px-2 pb-2 pl-3 text-right bg-muted/50 rounded-t-md">
                  Impacto/mês
                </th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => {
                const linha = porGrupo.get(grupo)!;
                const filtros: Record<string, string> = {};
                if (grupo.attributeCode) filtros.attributeCode = grupo.attributeCode;
                if (grupo.entityType) filtros.entityType = grupo.entityType;
                const href = linkDeAlteracoes({ recorte: linha.recorte, filtros });
                const comPreco = grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null;
                const negativo = comPreco && grupo.impact.amount! < 0;
                const Icone = iconeDaAlteracao(grupo);
                const { antes, agora, diferenca } = celulasAntesDepois(grupo);

                return (
                  <tr
                    key={linha.chave}
                    className={cn(
                      "border-t transition-colors",
                      comPreco ? (negativo ? "bg-red-50/50" : "bg-emerald-50/50") : "hover:bg-accent/30",
                    )}
                  >
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        <span className="w-6 h-6 rounded-md bg-accent flex items-center justify-center shrink-0 mt-0.5">
                          <Icone className="w-3.5 h-3.5 text-brand" strokeWidth={2.25} />
                        </span>
                        <div className="min-w-0">
                          <Link href={href} className="font-semibold hover:text-brand transition-colors">
                            {grupo.title}
                          </Link>
                          {/*
                            De quem é a linha vem primeiro em Visão Geral: sem
                            isso a tabela mistura unidades sem dizer, e duas
                            linhas do mesmo parâmetro com valores diferentes
                            viram contradição em vez de duas unidades.
                          */}
                          {linha.unidade !== null ? (
                            <div className="text-xs text-muted-foreground">
                              {linha.unidade}
                              {abas.length <= 1 && ` · ${grupo.equipment}`}
                            </div>
                          ) : (
                            abas.length <= 1 && (
                              <div className="text-xs text-muted-foreground">{grupo.equipment}</div>
                            )
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {antes}
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs font-mono font-medium whitespace-nowrap">
                      {agora}
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs">{diferenca}</td>
                    <td className="px-2 py-2.5 align-top text-right tabular-nums text-xs text-muted-foreground">
                      {grupo.vehicles.toLocaleString("pt-BR")}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 pl-3 align-top text-right tabular-nums bg-muted/25",
                        comPreco && (negativo ? "bg-red-100/40" : "bg-emerald-100/40"),
                      )}
                    >
                      {comPreco ? (
                        <span className={cn("font-bold", negativo ? "text-red-700" : "text-emerald-700")}>
                          {formatBrlShort(grupo.impact.amount!)}
                          <span className="font-normal text-muted-foreground">
                            {periodicitySuffix(grupo.impact.periodicity)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">sem preço</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Movimentação da frota — o que entrou, o que saiu, o que está ativo
// ---------------------------------------------------------------------------

/**
 * Três blocos, não quatro. O mockup pedia um quarto — "mudaram de condição" —
 * e ele fica de fora de propósito: o motor só distingue `ENTITY_ADDED` e
 * `ENTITY_REMOVED` como movimento de frota (`lib/comparison/src/engine.ts`);
 * toda outra alteração de um ativo que continua na frota é `VALUE_CHANGED`, o
 * mesmo tipo de qualquer coluna que mudou de valor — não existe um sinal de
 * "mudança de condição" separado de "mudou de valor" que este bloco pudesse
 * mostrar sem inventar um número. Quando esse sinal existir de verdade, o
 * quarto cartão entra aqui.
 *
 * Vale nas duas leituras: entrada e saída de ativo e frota são contagens de
 * populações disjuntas (uma placa é de uma unidade), e por isso somam entre
 * unidades sem a ressalva de dupla contagem que `vehiclesTouched` carrega. Em
 * Visão Geral os números vêm de `consolidado.totals`, somados no servidor.
 */
function MovimentacaoDaFrota({
  entitiesAdded,
  entitiesRemoved,
  ativos,
}: {
  entitiesAdded: number;
  entitiesRemoved: number;
  ativos: number;
}) {
  if (entitiesAdded === 0 && entitiesRemoved === 0 && ativos === 0) return null;

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <h2 className="text-base font-bold mb-4">Movimentação da frota</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TileDeMovimento
          icone={ArrowUpRight}
          cor="text-emerald-700"
          rotulo="Entraram"
          valor={`+${entitiesAdded.toLocaleString("pt-BR")}`}
        />
        <TileDeMovimento
          icone={ArrowDownRight}
          cor="text-red-700"
          rotulo="Saíram"
          valor={`−${entitiesRemoved.toLocaleString("pt-BR")}`}
        />
        <TileDeMovimento
          icone={Truck}
          cor="text-brand"
          rotulo="Veículos ativos"
          valor={ativos.toLocaleString("pt-BR")}
        />
      </div>
    </section>
  );
}

function TileDeMovimento({
  icone: Icone,
  cor,
  rotulo,
  valor,
}: {
  icone: typeof Truck;
  cor: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
        <Icone className={cn("w-4 h-4", cor)} strokeWidth={2.25} />
      </span>
      <div>
        <p className={cn("text-xl font-extrabold tabular-nums", cor)}>{valor}</p>
        <p className="text-[0.6875rem] text-muted-foreground">{rotulo}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking de unidades — Geral, sempre visível
// ---------------------------------------------------------------------------

type Situacao = "critico" | "atencao" | "positivo";

const SITUACAO: Record<Situacao, { label: string; className: string }> = {
  critico: { label: "Crítico", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  atencao: {
    label: "Atenção",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  positivo: {
    label: "Positivo",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
};

/**
 * O selo de situação de uma unidade no ranking, derivado da própria lista —
 * nunca de um limiar por unidade escrito à mão.
 *
 * Impacto positivo é sempre "Positivo". Impacto negativo vira "Crítico" só
 * quando o módulo chega à metade do pior módulo negativo da competência (a
 * pior unidade da vigência é sempre "Crítico"); abaixo disso é "Atenção". É o
 * mesmo tipo de corte relativo que já separa "maior impacto" do resto em
 * `pontosDeAtencao` — metade do pior é grave o bastante para não ser atenção
 * comum, e é um corte que qualquer um reconstrói olhando a própria lista.
 */
function situacaoDaUnidade(impacto: Impacto | null, piorNegativo: number): Situacao {
  if (!impacto || impacto.amount >= 0) return "positivo";
  if (piorNegativo === 0) return "atencao";
  return Math.abs(impacto.amount) >= piorNegativo * 0.5 ? "critico" : "atencao";
}

/**
 * O ranking de unidades da Visão Geral, sempre visível — nunca atrás de um
 * clique ou de uma gaveta (`Sheet`). É o único bloco que só existe neste modo:
 * o resto da tela é o mesmo corpo da unidade, com os números consolidados
 * (`OverviewConsolidado`, em `lib/comparison/src/families-view-overview.ts`).
 * Ele fica logo abaixo do gráfico porque responde a pergunta seguinte à dele —
 * *onde* aconteceu — antes de a tabela entrar no *o quê*.
 *
 * A ordem é a mesma de `unidadesPorImpacto` — maior módulo de impacto
 * primeiro —, e cada linha leva à Dashboard daquela unidade. O selo de
 * "Situação" é decorativo em cima da mesma ordem, não um recorte novo.
 */
function RankingDeUnidades({
  overview,
  onTrocar,
}: {
  overview: FamiliesOverview;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const unidades = unidadesPorImpacto(overview);
  const total = overview.unitsIncluded.length + overview.unitsExcluded.length;
  const piorNegativo = unidades.reduce(
    (pior, u) => (u.impacto && u.impacto.amount < 0 ? Math.max(pior, Math.abs(u.impacto.amount)) : pior),
    0,
  );

  const entrarNaUnidade = (contexto: OverviewContextRef) =>
    onTrocar({
      scopeHash: contexto.scopeHash,
      canal: contexto.channel,
      period: null,
      visaoGeral: null,
    });

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-bold">Unidades em atenção</h2>
        <span className="text-xs text-muted-foreground">
          {overview.unitsIncluded.length} de {total} unidades incluídas
        </span>
      </div>

      {unidades.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma unidade entrou na soma desta competência.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="font-semibold px-2 pb-2">Unidade</th>
                <th className="font-semibold px-2 pb-2 text-right">Alterações</th>
                <th className="font-semibold px-2 pb-2 text-right">Perdas</th>
                <th className="font-semibold px-2 pb-2 text-right">Ganhos</th>
                <th className="font-semibold px-2 pb-2 text-right">Líquido</th>
                <th className="font-semibold px-2 pb-2 text-right">Situação</th>
              </tr>
            </thead>
            <tbody>
              {unidades.map(({ unidade, impacto }) => {
                const perdas =
                  impacto && impacto.periodicity !== null
                    ? (unidade.summary.lossesByPeriodicity[impacto.periodicity] ?? 0)
                    : 0;
                const ganhos =
                  impacto && impacto.periodicity !== null
                    ? (unidade.summary.gainsByPeriodicity[impacto.periodicity] ?? 0)
                    : 0;
                const unico = unidade.contexts.length === 1;
                const situacao = SITUACAO[situacaoDaUnidade(impacto, piorNegativo)];

                return (
                  <tr
                    key={unidade.unidade}
                    className={cn(
                      "border-t transition-colors",
                      unico && "hover:bg-accent/30 cursor-pointer",
                    )}
                    onClick={unico ? () => entrarNaUnidade(unidade.contexts[0]) : undefined}
                  >
                    <td className="px-2 py-2.5 font-semibold">
                      {unico ? (
                        unidade.label
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{unidade.label}</span>
                          {unidade.contexts.map((contexto) => (
                            <button
                              key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
                              type="button"
                              onClick={(evento) => {
                                evento.stopPropagation();
                                entrarNaUnidade(contexto);
                              }}
                              className="text-xs font-normal text-brand hover:underline"
                            >
                              {contexto.channel ?? "sem canal"}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                      {unidade.summary.changes.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-red-700">
                      {perdas !== 0 ? formatBrlShort(perdas) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-emerald-700">
                      {ganhos !== 0 ? formatBrlShort(ganhos) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 text-right tabular-nums font-bold",
                        impacto === null
                          ? "text-muted-foreground font-normal"
                          : impacto.amount < 0
                            ? "text-red-700"
                            : "text-emerald-700",
                      )}
                    >
                      {impacto ? escreverImpacto(impacto) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold",
                          situacao.className,
                        )}
                      >
                        {situacao.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Qualidade da apuração — faixa fina, sempre visível, nunca compete com o financeiro
// ---------------------------------------------------------------------------

/**
 * O que ainda falta apurar — de propósito discreta: pontos coloridos e
 * números pequenos, sem cartão de destaque, para que a régua financeira lá em
 * cima continue sendo a primeira coisa que se lê. É trabalho pendente, não uma
 * falha da tela.
 *
 * "Sem correspondência" só aparece quando o dado existe (`totals.inconclusive`
 * — o mesmo campo que a Gestão à Vista já publica sob este nome) e é maior que
 * zero; na Visão Geral ele nunca aparece porque a soma entre unidades não tem
 * esse total. Não existe um "% da frota conciliada" diferente da cobertura de
 * apuração — não há, nesta base, uma métrica de reconciliação de frota
 * separada dela —, então o selo verde mede exatamente a mesma cobertura do
 * anel dos indicadores, com o rótulo que descreve o que ela de fato é.
 */
function QualidadeDaApuracao({
  cobertura,
  notCalculable,
  semCorrespondencia,
}: {
  cobertura: CoberturaDePreco | null;
  notCalculable: number;
  semCorrespondencia: number | null;
}) {
  if (!cobertura) return null;

  return (
    <section className="flex flex-wrap items-center gap-x-8 gap-y-2 px-2 py-1 text-xs text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide text-[0.6875rem]">
        Qualidade da apuração
      </span>
      <PontoDeQualidade cor="bg-amber-500">
        <strong className="text-foreground tabular-nums">
          {notCalculable.toLocaleString("pt-BR")}
        </strong>{" "}
        sem preço apurado
      </PontoDeQualidade>
      {semCorrespondencia !== null && semCorrespondencia > 0 && (
        <PontoDeQualidade cor="bg-amber-500">
          <strong className="text-foreground tabular-nums">
            {semCorrespondencia.toLocaleString("pt-BR")}
          </strong>{" "}
          sem correspondência
        </PontoDeQualidade>
      )}
      <PontoDeQualidade cor="bg-emerald-600">
        <strong className="text-foreground tabular-nums">
          {cobertura.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
        </strong>{" "}
        de cobertura de apuração
      </PontoDeQualidade>
    </section>
  );
}

function PontoDeQualidade({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("w-2 h-2 rounded-full shrink-0", cor)} />
      {children}
    </span>
  );
}
