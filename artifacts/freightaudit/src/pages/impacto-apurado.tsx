import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Clock } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";
import { cn } from "@/lib/utils";
import { GESTAO_A_VISTA, IMPACTO_APURADO } from "@/lib/ambiente";
import { consultaDoRecorte, opcoesDaVigencia } from "@/lib/leitura-da-vigencia";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { useSerieDeImpacto, useSerieDeImpactoGeral } from "@/lib/serie-de-impacto";
import { juntarPrioridades } from "@/lib/cockpit";
import { lerRecorte, linkDeAlteracoes, nomeDaUnidade } from "@/lib/recorte";
import {
  detalheDaFamilia,
  detalheDoImpacto,
  frotaTotal,
  impactosDaVigencia,
} from "@/lib/visao-geral";
import {
  DECOMPOSICOES,
  coberturaDaVigencia,
  filtroDeMudancaValido,
  mudancasRelevantes,
  ondeAgirAgora,
  outrasPeriodicidades,
  ponteDoImpacto,
  situacaoDaApuracao,
  type Decomposicao,
  type FiltroDeMudanca,
} from "@/lib/impacto-apurado";
import { JANELA_PADRAO, type Janela } from "@/lib/janela-de-vigencias";
import {
  MenuDaGestaoAVista,
  SeletorDeUnidade,
} from "@/components/dashboard/controles-do-recorte";
import {
  BOTAO_DE_TROCA,
  SeletorDeVigencia,
  SeletorDeVigenciaGeral,
} from "@/components/vigencia/seletor-de-vigencia";
import { Manchete, type ContextoDaManchete } from "@/components/impacto-apurado/manchete";
import {
  FaixaDeCobertura,
  FaixaSemAlteracao,
} from "@/components/impacto-apurado/faixa-de-cobertura";
import { PonteDoImpactoGrafico } from "@/components/impacto-apurado/ponte-do-impacto";
import { EvolucaoPorVigencia } from "@/components/impacto-apurado/evolucao-por-vigencia";
import { PrincipaisMudancas } from "@/components/impacto-apurado/principais-mudancas";
import { OndeAgirAgora } from "@/components/impacto-apurado/onde-agir";
import { DetalheDaFamilia } from "@/components/inicio/detalhe-da-familia";
import { DetalheDoImpacto } from "@/components/inicio/detalhe-do-impacto";
import type { UnidadeDoDrill } from "@/lib/drill-da-familia";
import type { FamiliesOverview, FamiliesView } from "@/components/inicio/types";

/**
 * O Impacto Apurado — o segundo módulo da seção Dashboard.
 *
 * O Impacto Líquido, ao lado dele no menu, é a tela de **exploração**: cinco
 * cartões do mesmo tamanho, a fila de alterações, a movimentação da frota, a
 * qualidade da apuração. Quem trabalha na auditoria abre aquela. Esta é a de
 * **decisão**, e responde seis perguntas na ordem em que uma diretoria as faz:
 *
 * 1. **Quanto já apuramos?** — a manchete, e só ela em corpo grande.
 * 2. **Posso confiar nesse número?** — a faixa de cobertura, imediatamente
 *    abaixo, porque um resultado com 7% de cobertura e um com 99% são duas
 *    conversas diferentes e a diferença não pode ficar num anel discreto.
 * 3. **O que explica o resultado?** — a ponte por família.
 * 4. **Estamos melhorando ou piorando?** — a evolução por vigência.
 * 5. **Onde está o dinheiro?** — as principais mudanças.
 * 6. **Onde agir agora?** — os pontos derivados do próprio dado.
 *
 * **Nada aqui apura dinheiro.** As duas telas leem a mesma resposta de
 * `GET /changes/families`, com a mesma chave de cache
 * (`lib/leitura-da-vigencia.ts`), e toda conta desta página é uma projeção de
 * `ExecutiveSummary.sides` feita em `lib/impacto-apurado.ts`. Não há endpoint
 * novo, não há segunda soma e não há regra de negócio escondida no JSX: se
 * houvesse, os dois módulos do mesmo menu publicariam dois impactos líquidos da
 * mesma unidade.
 *
 * O custo de abertura é o de **zero requisições novas** quando se chega pelo
 * Impacto Líquido: a vigência e a série já estão em cache sob as mesmas chaves.
 * Vindo de fora, são as mesmas duas leituras que aquela tela já fazia.
 */
export default function ImpactoApurado() {
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);
  const consulta = consultaDoRecorte(search);
  const visaoGeral = parametros.get("visaoGeral") === "1";

  const vigencia = useQuery({ ...opcoesDaVigencia(consulta), enabled: !visaoGeral });
  const view = visaoGeral ? null : (vigencia.data ?? null);

  const contextos = useContextosDaCasca();
  const periodosOverview = useMemo(
    () =>
      Array.from(new Set(contextos.contextos.flatMap((c) => c.periodosDisponiveis))).sort((a, b) =>
        b.localeCompare(a),
      ),
    [contextos.contextos],
  );
  /* Sem `?period=`, a Visão Geral abre na competência mais recente — a mesma
     régua do Impacto Líquido, e a que quem abre a tela veio ver. */
  const periodoOverviewEfetivo = parametros.get("period") ?? periodosOverview[0] ?? null;
  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, { enabled: visaoGeral });
  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;

  const recorte = lerRecorte(search);
  const atualizadoEm = visaoGeral ? overviewQuery.dataUpdatedAt : vigencia.dataUpdatedAt;
  const atualizando = visaoGeral
    ? overviewQuery.isPlaceholderData
    : vigencia.isPlaceholderData;

  /*
    As séries são as mesmas do Impacto Líquido, nos mesmos hooks e sob as
    mesmas chaves. A geral sai depois do conteúdo principal pela razão medida
    lá: as duas leituras de overview disputam o mesmo pool e a série não
    alimenta a resposta principal da tela.
  */
  const serieDaUnidade = useSerieDeImpacto(visaoGeral ? null : view, consulta, !visaoGeral);
  const serieGeral = useSerieDeImpactoGeral(
    periodosOverview,
    periodoOverviewEfetivo,
    overview,
    visaoGeral && !overviewQuery.isLoading,
  );

  const [janela, setJanela] = useState<Janela>(JANELA_PADRAO);

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${IMPACTO_APURADO}?${texto}` : IMPACTO_APURADO);
  };

  const paraGestaoAVista = consulta.toString() ? `${GESTAO_A_VISTA}?${consulta}` : GESTAO_A_VISTA;
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const periodoAtual = visaoGeral ? (overview?.period ?? null) : (view?.period ?? null);

  return (
    <Layout>
      <header className="px-8 pt-7 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight break-words">
                Impacto Apurado — {visaoGeral ? "Visão Geral" : (unidade ?? "")}
              </h1>
              <EmAtualizacao ativo={atualizando} />
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              O que mudou nesta competência, quanto já conseguimos apurar e onde agir.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            {contextos.contextos.length > 1 && (
              <SeletorDeUnidade
                contextos={contextos.contextos}
                visaoGeral={visaoGeral}
                periodoAtual={periodoAtual}
                onTrocar={trocarPara}
              />
            )}
            {visaoGeral ? (
              <SeletorDeVigenciaGeral
                periodos={periodosOverview}
                ativa={overview?.period ?? null}
                onTrocar={trocarPara}
                className={BOTAO_DE_TROCA}
              />
            ) : (
              <SeletorDeVigencia
                view={view}
                consulta={consulta}
                onTrocar={trocarPara}
                className={BOTAO_DE_TROCA}
              />
            )}
            <MenuDaGestaoAVista paraGestaoAVista={paraGestaoAVista} />
          </div>
        </div>
        <UltimaAtualizacao quando={atualizadoEm} />
      </header>

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {visaoGeral ? (
          <>
            {overviewQuery.isLoading && <Carregando />}
            {overviewQuery.error && (
              <ApiErrorNotice
                error={overviewQuery.error}
                what="Não foi possível montar o Impacto Apurado."
              />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && <SemVigencia />}
            {overview && (
              <div className={cn("space-y-5", classeDeAtualizacao(overviewQuery.isPlaceholderData))}>
                <Corpo
                  resumo={overview}
                  contexto={contextoDaVisaoGeral(overview)}
                  pontos={serieGeral}
                  periodicityDaSerie={null}
                  serieCarregando={overviewQuery.isLoading}
                  vigenciaAberta={overview.period}
                  janela={janela}
                  onJanela={setJanela}
                  onEscolherVigencia={(periodo) => trocarPara({ period: periodo })}
                  filtro={filtroAberto(parametros)}
                  onFiltro={(f) => trocarPara({ mudancas: f === "todos" ? null : f })}
                  decomposicao="familia"
                  temAnterior
                  /* A Visão Geral não tem unidade a quem perguntar: as gavetas
                     e os destinos ficariam sobre `contexts[0]`, que é uma
                     unidade que ninguém escolheu. Ver `PontoDeAtencao.href`. */
                  unidadeAberta={null}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {vigencia.isLoading && <Carregando />}
            {vigencia.error && (
              <ApiErrorNotice
                error={vigencia.error}
                what="Não foi possível montar o Impacto Apurado."
              />
            )}
            {!vigencia.isLoading && !vigencia.error && view === null && <SemVigencia />}
            {view && (
              <div className={cn("space-y-5", classeDeAtualizacao(vigencia.isPlaceholderData))}>
                <Corpo
                  resumo={view}
                  contexto={contextoDaUnidade(view)}
                  pontos={serieDaUnidade.pontos}
                  periodicityDaSerie={serieDaUnidade.periodicity}
                  serieCarregando={serieDaUnidade.carregando}
                  vigenciaAberta={view.period}
                  janela={janela}
                  onJanela={setJanela}
                  onEscolherVigencia={(periodo) => trocarPara({ period: periodo })}
                  filtro={filtroAberto(parametros)}
                  onFiltro={(f) => trocarPara({ mudancas: f === "todos" ? null : f })}
                  decomposicao="familia"
                  temAnterior={view.cockpit.baseline.hasBaseline}
                  unidadeAberta={{
                    view,
                    recorte,
                    familiaAberta: parametros.get("familia"),
                    impactoAberto: parametros.get("impacto"),
                    onAbrirFamilia: (code) => trocarPara({ familia: code, impacto: null }),
                    onFecharFamilia: () => trocarPara({ familia: null }),
                    onAbrirImpacto: (key) => trocarPara({ impacto: key, familia: null }),
                    onFecharImpacto: () => trocarPara({ impacto: null }),
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

/**
 * O que a tela mostra quando há resposta — igual nas duas leituras.
 *
 * A Visão Geral e a unidade desenham **o mesmo corpo**, e não duas telas
 * parecidas: `FamiliesOverview.summary` tem a forma de `ExecutiveSummary`, que
 * é de onde sai tudo o que esta página publica. O que muda é o que cada
 * leitura sabe responder — a Visão Geral não tem a árvore de parâmetros nem uma
 * unidade a quem abrir gaveta —, e isso viaja em `unidadeAberta`.
 */
interface UnidadeAberta {
  view: FamiliesView;
  recorte: ReturnType<typeof lerRecorte>;
  familiaAberta: string | null;
  impactoAberto: string | null;
  onAbrirFamilia: (code: string) => void;
  onFecharFamilia: () => void;
  onAbrirImpacto: (key: string) => void;
  onFecharImpacto: () => void;
}

function Corpo({
  resumo,
  contexto,
  pontos,
  periodicityDaSerie,
  serieCarregando,
  vigenciaAberta,
  janela,
  onJanela,
  onEscolherVigencia,
  filtro,
  onFiltro,
  decomposicao,
  temAnterior,
  unidadeAberta,
}: {
  resumo: Pick<FamiliesView, "summary">;
  /** O contexto da manchete mais o `semPreco`, que só a faixa de cobertura lê. */
  contexto: ContextoDaManchete & { semPreco: number };
  pontos: ReturnType<typeof useSerieDeImpacto>["pontos"];
  periodicityDaSerie: string | null;
  serieCarregando: boolean;
  vigenciaAberta: string | null;
  janela: Janela;
  onJanela: (janela: Janela) => void;
  onEscolherVigencia: (periodo: string) => void;
  filtro: FiltroDeMudanca;
  onFiltro: (filtro: FiltroDeMudanca) => void;
  decomposicao: Decomposicao;
  /**
   * Se a vigência tem anterior com que comparar — `cockpit.baseline`.
   *
   * Só muda a frase do caso "nenhuma alteração": sem anterior não há alteração
   * a detectar, e dizer "o cliente não mudou nada" ali seria afirmar sobre o
   * cliente o que é um fato sobre o acervo. Na Visão Geral vale `true`: a soma
   * só chega a zero alteração quando as unidades tinham anterior e nada mudou.
   */
  temAnterior: boolean;
  unidadeAberta: UnidadeAberta | null;
}) {
  /*
    Um universo de dados só para a página inteira: a situação, a cobertura, a
    ponte e o ranking saem todos de `resumo` — a mesma resposta, o mesmo
    recorte, a mesma periodicidade. É o que faz a manchete, o gráfico e a lista
    reconciliarem por construção, em vez de por coincidência.
  */
  const situacao = situacaoDaApuracao(resumo, contexto.alteracoes);
  const lados = situacao.estado === "com_movimento" ? situacao.lados : null;
  const periodicidade = lados?.periodicity ?? null;
  const cobertura = coberturaDaVigencia(
    { changes: contexto.alteracoes },
    { notCalculable: contexto.semPreco },
  );
  const ponte = ponteDoImpacto(resumo, periodicidade);
  const mudancas = mudancasRelevantes(resumo, periodicidade);

  const view = unidadeAberta?.view ?? null;
  const daVigencia = view ? { ...unidadeAberta!.recorte, period: view.period } : null;
  const acoes = view
    ? ondeAgirAgora({
        view,
        cobertura,
        periodicidade,
        prioridades: juntarPrioridades(view),
        recorte: unidadeAberta!.recorte,
        comDestino: true,
      })
    : [];

  const detalheFamilia = detalheDaFamilia(
    resumo,
    unidadeAberta?.familiaAberta ?? null,
    periodicidade,
  );
  const detalheImpacto = detalheDoImpacto(view, unidadeAberta?.impactoAberto ?? null, periodicidade);

  const unidadesDoDrill: UnidadeDoDrill[] = view
    ? [
        {
          chave: view.context.scopeHash,
          label: nomeDaUnidade(view.context),
          contexts: [{ scopeHash: view.context.scopeHash, channel: view.context.channel }],
          summary: view.summary,
        },
      ]
    : [];

  return (
    <>
      <Manchete situacao={situacao} outras={outrasPeriodicidades(resumo)} contexto={contexto} />

      {cobertura ? (
        <FaixaDeCobertura
          cobertura={cobertura}
          verDetalhes={
            daVigencia
              ? linkDeAlteracoes({
                  recorte: daVigencia,
                  filtros: { impactConfidence: "NOT_CALCULABLE" },
                })
              : null
          }
        />
      ) : (
        <FaixaSemAlteracao temAnterior={temAnterior} />
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="bg-card border rounded-xl shadow-sm px-6 py-5 xl:col-span-2 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-base font-bold">Composição do impacto líquido</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                De onde vem o resultado apurado desta vigência
              </p>
            </div>
            {/*
              O seletor de decomposição existe com uma opção só, e isso é o
              desenho: o eixo por família é o que o Freightech publica e o que o
              produto inteiro já agrupa. O segundo eixo entra em `DECOMPOSICOES`
              e numa função ao lado de `ponteDoImpacto` — nunca num `if` dentro
              do gráfico.
            */}
            <span className={cn(BOTAO_DE_TROCA, "cursor-default")}>
              {DECOMPOSICOES[decomposicao]}
            </span>
          </div>
          {ponte && ponte.degraus.length > 0 ? (
            <PonteDoImpactoGrafico
              ponte={ponte}
              onAbrirFamilia={unidadeAberta ? unidadeAberta.onAbrirFamilia : null}
              className="mt-4"
            />
          ) : (
            <p className="text-sm text-muted-foreground py-20 text-center">
              Nenhuma família tem valor apurado nesta vigência — não há composição a desenhar.
            </p>
          )}
        </section>

        <section className="bg-card border rounded-xl shadow-sm px-6 py-5 min-w-0">
          <EvolucaoPorVigencia
            pontos={pontos}
            periodicity={periodicityDaSerie ?? periodicidade}
            janela={janela}
            onJanela={onJanela}
            vigenciaAberta={vigenciaAberta}
            onEscolherVigencia={onEscolherVigencia}
            carregando={serieCarregando}
          />
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <PrincipaisMudancas
          linhas={mudancas}
          periodicity={periodicidade}
          filtro={filtro}
          onFiltro={onFiltro}
          onAbrir={unidadeAberta ? unidadeAberta.onAbrirImpacto : null}
          nota={
            unidadeAberta
              ? undefined
              : "Em Visão Geral a lista soma as unidades e não abre por dentro: o detalhe de um parâmetro só existe dentro de um contexto."
          }
        />
        <OndeAgirAgora
          acoes={acoes}
          nota={
            unidadeAberta
              ? undefined
              : "Os pontos de atenção são lidos por unidade. Escolha uma unidade para vê-los."
          }
        />
      </div>

      {unidadeAberta && view && (
        <>
          <DetalheDaFamilia
            detalhe={detalheFamilia}
            period={view.period}
            periodLabel={view.periodLabel}
            recorte={unidadeAberta.recorte}
            unidades={unidadesDoDrill}
            vigencia={view.period}
            onFechar={unidadeAberta.onFecharFamilia}
          />
          <DetalheDoImpacto
            detalhe={detalheImpacto}
            period={view.period}
            periodLabel={view.periodLabel}
            recorte={unidadeAberta.recorte}
            onFechar={unidadeAberta.onFecharImpacto}
          />
        </>
      )}
    </>
  );
}

/**
 * O contexto da manchete numa unidade.
 *
 * `vehiclesTouched` é contagem de ativos distintos numa varredura só do
 * servidor, e a frota vem do cockpit — o mesmo campo que o Acompanhamento lê.
 * Duas telas dizendo frotas diferentes para a mesma vigência é o defeito que
 * custa a confiança nas duas.
 */
function contextoDaUnidade(view: FamiliesView): ContextoDaManchete & { semPreco: number } {
  const frota = frotaTotal(view);
  return {
    alteracoes: view.totals.changes,
    tiposDeAlteracao: view.totals.groups,
    veiculos: view.totals.vehiclesTouched,
    frota: frota > 0 ? frota : null,
    veiculosDeduplicados: true,
    semPreco: view.impact.notCalculable,
  };
}

/**
 * O mesmo contexto na Visão Geral — com as ressalvas que a soma impõe.
 *
 * `vehiclesTouchedDistinct` é a união dos ativos entre unidades; quando a
 * resposta em cache é de uma versão que não o traz, sobra a soma, e a tela diz
 * que é soma em vez de chamar de distinto um número que não é.
 */
function contextoDaVisaoGeral(
  overview: FamiliesOverview,
): ContextoDaManchete & { semPreco: number } {
  const distintos = overview.vehiclesTouchedDistinct;
  const frota = overview.consolidado.totals.fleet;
  return {
    alteracoes: overview.summary.changes,
    tiposDeAlteracao: overview.consolidado.gruposNoTotal,
    veiculos: distintos ?? overview.summary.vehiclesTouched,
    frota: frota > 0 ? frota : null,
    veiculosDeduplicados: distintos !== undefined,
    semPreco: overview.summary.notCalculable,
  };
}

/** O recorte da lista de mudanças, lido da URL — colável, como o resto do produto. */
function filtroAberto(parametros: URLSearchParams): FiltroDeMudanca {
  const pedido = parametros.get("mudancas");
  return filtroDeMudancaValido(pedido) ? pedido : "todos";
}

/**
 * Quando os dados em tela foram buscados.
 *
 * `dataUpdatedAt` da própria consulta, e nunca um `new Date()` fabricado aqui:
 * ele diz quando a resposta chegou, e não que horas são agora — a mesma leitura
 * que a Gestão à Vista e o Impacto Líquido publicam.
 */
function UltimaAtualizacao({ quando }: { quando: number }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      {quando === 0
        ? "aguardando a primeira resposta…"
        : `Dados atualizados às ${new Date(quando).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}`}
    </p>
  );
}

function Carregando() {
  return <p className="text-sm text-muted-foreground">Carregando o Impacto Apurado…</p>;
}

function SemVigencia() {
  return (
    <div className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
      <p className="text-base font-bold">Nenhuma vigência para apurar ainda.</p>
      <p className="text-sm text-muted-foreground mt-1.5">
        Envie a primeira planilha em Importações — sem duas vigências não há o que comparar, e sem
        comparação não há impacto a apurar.
      </p>
    </div>
  );
}
