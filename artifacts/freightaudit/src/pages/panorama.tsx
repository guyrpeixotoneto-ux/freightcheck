import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Clock, History } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/api";
import { GESTAO_A_VISTA, LINHA_DO_TEMPO, PANORAMA } from "@/lib/ambiente";
import { consultaDoRecorte, opcoesDaVigencia } from "@/lib/leitura-da-vigencia";
import { LEITURA_DE_APURACAO } from "@/lib/frescor-das-leituras";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { useSerieDeImpacto, useSerieDeImpactoGeral } from "@/lib/serie-de-impacto";
import { juntarPrioridades } from "@/lib/cockpit";
import { lerRecorte, nomeDaUnidade, type Recorte } from "@/lib/recorte";
import {
  detalheDaFamilia,
  detalheDoImpacto,
  variacao,
  type ExecucaoDeImportacao,
} from "@/lib/visao-geral";
import {
  DECOMPOSICOES,
  filtroDeMudancaValido,
  mudancasRelevantes,
  ponteDoImpacto,
  type FiltroDeMudanca,
} from "@/lib/impacto-apurado";
import {
  filaDoPanorama,
  leituraDaUnidade,
  leituraDaVisaoGeral,
  mapaDoPanorama,
  placarDoPanorama,
  procedenciaDoPanorama,
  vereditoDoPanorama,
  type LeituraDoPanorama,
  type Veredito as DadosDoVeredito,
} from "@/lib/panorama";
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
import { FaixaDeCobertura, FaixaSemAlteracao } from "@/components/impacto-apurado/faixa-de-cobertura";
import { PonteDoImpactoGrafico } from "@/components/impacto-apurado/ponte-do-impacto";
import { EvolucaoPorVigencia } from "@/components/impacto-apurado/evolucao-por-vigencia";
import { PrincipaisMudancas } from "@/components/impacto-apurado/principais-mudancas";
import { Veredito } from "@/components/panorama/veredito";
import { Placar } from "@/components/panorama/placar";
import { Mapa } from "@/components/panorama/mapa";
import { Fila } from "@/components/panorama/fila";
import { Procedencia } from "@/components/panorama/procedencia";
import { DetalheDaFamilia } from "@/components/inicio/detalhe-da-familia";
import { DetalheDoImpacto } from "@/components/inicio/detalhe-do-impacto";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";
import type { UnidadeDoDrill } from "@/lib/drill-da-familia";
import type { BalancoResumo } from "@/components/balanco/tipos";
import type { FamiliesOverview, FamiliesView, GroupedView } from "@/components/inicio/types";

/**
 * O Panorama Executivo — a leitura executiva inteira, numa tela só.
 *
 * A seção *Visão executiva* tinha quatro módulos de leitura — Impacto Líquido,
 * Impacto Apurado, Resumo executivo e Linha do Tempo — que liam **a mesma
 * resposta do servidor, sob as mesmas chaves de cache**, e publicavam três
 * blocos idênticos nos quatro. Não eram quatro perguntas: eram quatro formatos,
 * cada um herdado de um momento diferente da história do produto, e nenhum
 * deles desenhado contra os outros três. `docs/PROPOSTA-PANORAMA-EXECUTIVO.md`
 * mede a sobreposição nos arquivos.
 *
 * Esta tela é o quinto módulo, e ela **não é os quatro empilhados** — empilhar
 * trocaria quatro telas redundantes por uma tela longa e redundante. Onde três
 * módulos desenhavam a mesma coisa de três jeitos, aqui se desenha o melhor dos
 * três, uma vez. São **sete andares**, e a ordem é a das perguntas que uma
 * diretoria faz:
 *
 * 1. **O veredito** — quanto custou esta vigência?
 * 2. **O placar** — e os outros números?
 * 3. **A composição** — de onde vem esse número?
 * 4. **A trajetória** — estamos melhorando ou piorando?
 * 5. **O mapa** — onde isso aconteceu?
 * 6. **A fila** — o que eu faço agora?
 * 7. **A procedência** — posso confiar nisto?
 *
 * **Nada aqui apura dinheiro.** A aritmética inteira mora em `lib/panorama.ts`,
 * que é projeção de `ExecutiveSummary` por funções que já existiam e já eram
 * testadas fora do JSX (`lib/visao-geral.ts`, `lib/impacto-apurado.ts`,
 * `lib/cockpit.ts`). Não há endpoint novo. Se o Panorama publicasse um líquido
 * diferente do Impacto Apurado sobre a mesma vigência, seria a quinta verdade
 * sobre o mesmo dado — o defeito que ele existe para curar.
 *
 * **Os quatro módulos continuam existindo, e os endereços deles não mudaram.**
 * O Panorama abre a seção e eles descem na lateral, assumindo a função que já
 * exerciam de fato: a exploração detalhada de um andar. Nenhum link colado em
 * e-mail morreu — a mesma regra que manteve a Auditoria Empurrada na raiz
 * (`lib/ambiente.ts`).
 *
 * **O custo de abertura é o de zero requisições novas** quando se chega de
 * qualquer módulo vizinho: a vigência e a série já estão em cache sob as mesmas
 * chaves (`lib/leitura-da-vigencia.ts`, `lib/serie-de-impacto.ts`). Vindo de
 * fora, são as mesmas leituras que qualquer um dos quatro já fazia, mais as
 * duas do andar 7 — que saem sozinhas, sem segurar o conteúdo principal.
 */
export default function Panorama() {
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
     régua dos outros módulos, e a que quem abre a tela veio ver. */
  const periodoOverviewEfetivo = parametros.get("period") ?? periodosOverview[0] ?? null;
  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, { enabled: visaoGeral });
  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;

  const recorte = lerRecorte(search);
  const atualizadoEm = visaoGeral ? overviewQuery.dataUpdatedAt : vigencia.dataUpdatedAt;
  const atualizando = visaoGeral ? overviewQuery.isPlaceholderData : vigencia.isPlaceholderData;

  /*
    A vigência anterior — só para a variação do andar 1, e só quando existe.

    `/changes/grouped` e não `/changes/families`: daqui sai um resumo executivo
    e nada mais, e pedir a árvore de famílias inteira seria trabalho de servidor
    para um dado que a tela não usa. É a mesma consulta, com a mesma justificativa,
    que o Resumo executivo já fazia.

    Não existe na Visão Geral: o overview responde por uma competência de cada
    vez, e "a anterior de cada unidade" não é uma competência — somá-las daria
    uma base que nenhuma unidade tem.
  */
  const anterior = useMemo(() => {
    if (!view) return null;
    const ordenadas = [...view.periods].sort((a, b) => a.date.localeCompare(b.date));
    const indice = ordenadas.findIndex((p) => p.date === view.period);
    return indice > 0 ? ordenadas[indice - 1] : null;
  }, [view]);

  const comparacao = useQuery({
    queryKey: ["grouped", "panorama-anterior", anterior?.date, consulta.toString()],
    enabled: anterior !== null,
    ...LEITURA_DE_APURACAO,
    queryFn: async () => {
      const query = new URLSearchParams(consulta);
      query.set("period", anterior!.date);
      return await fetchJson<GroupedView>(`/changes/grouped?${query}`);
    },
  });

  /*
    As duas leituras do andar 7. Saem **depois** do conteúdo principal, pela
    mesma razão medida em `docs/AUDITORIA-ZERO-LOADING.md` para a série geral:
    não alimentam a resposta que traz alguém à tela, e disputariam o mesmo pool
    de conexões com a leitura que alimenta.
  */
  const principalPronto = visaoGeral ? !overviewQuery.isLoading : !vigencia.isLoading;
  const balancos = useQuery({
    queryKey: ["balance", "panorama"],
    enabled: principalPronto,
    ...LEITURA_DE_APURACAO,
    queryFn: () => fetchJson<BalancoResumo[]>("/balance").catch(() => null),
  });
  const importacoes = useQuery({
    queryKey: ["imports", "panorama"],
    enabled: principalPronto,
    ...LEITURA_DE_APURACAO,
    queryFn: () => fetchJson<ExecucaoDeImportacao[]>("/imports").catch(() => null),
  });

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
    navegar(texto ? `${PANORAMA}?${texto}` : PANORAMA);
  };

  const paraGestaoAVista = consulta.toString() ? `${GESTAO_A_VISTA}?${consulta}` : GESTAO_A_VISTA;
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const periodoAtual = visaoGeral ? (overview?.period ?? null) : (view?.period ?? null);

  const procedencia = procedenciaDoPanorama(balancos.data, importacoes.data);

  return (
    <Layout>
      <header className="px-8 pt-7 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight break-words">
                Panorama — {visaoGeral ? "Visão Geral" : (unidade ?? "")}
              </h1>
              <EmAtualizacao ativo={atualizando} />
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              A leitura executiva inteira desta competência: quanto custou, de onde vem, como
              chegou aqui e o que fazer agora.
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
              <ApiErrorNotice error={overviewQuery.error} what="Não foi possível montar o Panorama." />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && <SemVigencia />}
            {overview && (
              <div className={cn("space-y-5", classeDeAtualizacao(overviewQuery.isPlaceholderData))}>
                <Corpo
                  leitura={leituraDaVisaoGeral(overview)}
                  view={null}
                  overview={overview}
                  recorte={recorte}
                  consulta={consulta}
                  anterior={null}
                  pontos={serieGeral}
                  periodicityDaSerie={null}
                  serieCarregando={overviewQuery.isLoading}
                  vigenciaAberta={overview.period}
                  janela={janela}
                  onJanela={setJanela}
                  parametros={parametros}
                  onTrocar={trocarPara}
                  procedencia={procedencia}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {vigencia.isLoading && <Carregando />}
            {vigencia.error && (
              <ApiErrorNotice error={vigencia.error} what="Não foi possível montar o Panorama." />
            )}
            {!vigencia.isLoading && !vigencia.error && view === null && <SemVigencia />}
            {view && (
              <div className={cn("space-y-5", classeDeAtualizacao(vigencia.isPlaceholderData))}>
                <Corpo
                  leitura={leituraDaUnidade(view)}
                  view={view}
                  overview={null}
                  recorte={recorte}
                  consulta={consulta}
                  anterior={comparacao.data ?? null}
                  pontos={serieDaUnidade.pontos}
                  periodicityDaSerie={serieDaUnidade.periodicity}
                  serieCarregando={serieDaUnidade.carregando}
                  vigenciaAberta={view.period}
                  janela={janela}
                  onJanela={setJanela}
                  parametros={parametros}
                  onTrocar={trocarPara}
                  procedencia={procedencia}
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
 * Os sete andares — **iguais nas duas leituras**.
 *
 * A Visão Geral e a unidade desenham o mesmo corpo, e não duas telas parecidas:
 * `LeituraDoPanorama` é o que as duas respostas do servidor têm em comum, e os
 * dois adaptadores (`leituraDaUnidade`, `leituraDaVisaoGeral`) são o único
 * lugar onde a diferença entre elas é resolvida. O que muda daqui para baixo é
 * só **o que cada leitura sabe responder** — a Visão Geral não tem a árvore de
 * parâmetros nem uma unidade a quem abrir gaveta —, e cada andar declara isso
 * na cara em vez de silenciosamente publicar meio dado.
 */
function Corpo({
  leitura,
  view,
  overview,
  recorte,
  consulta,
  anterior,
  pontos,
  periodicityDaSerie,
  serieCarregando,
  vigenciaAberta,
  janela,
  onJanela,
  parametros,
  onTrocar,
  procedencia,
}: {
  leitura: LeituraDoPanorama;
  /** A unidade aberta — `null` na Visão Geral. */
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  recorte: Recorte;
  consulta: URLSearchParams;
  /** A vigência anterior, para a variação do andar 1. `null` sem anterior. */
  anterior: GroupedView | null;
  pontos: ReturnType<typeof useSerieDeImpacto>["pontos"];
  periodicityDaSerie: string | null;
  serieCarregando: boolean;
  vigenciaAberta: string | null;
  janela: Janela;
  onJanela: (janela: Janela) => void;
  parametros: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  procedencia: ReturnType<typeof procedenciaDoPanorama>;
}) {
  const daVigencia: Recorte = { ...recorte, period: vigenciaAberta };
  const comDestino = view !== null;

  const veredito = vereditoDoPanorama(leitura, anterior);
  const lados = veredito.situacao.estado === "com_movimento" ? veredito.situacao.lados : null;
  const periodicidade = lados?.periodicity ?? null;

  const placar = placarDoPanorama(leitura, veredito, {
    recorte: daVigencia,
    comDestino,
    variacaoDeAlteracoes: variacao(leitura.alteracoes, anterior?.totals.changes),
  });

  const ponte = ponteDoImpacto(leitura.resumo, periodicidade);
  const mudancas = mudancasRelevantes(leitura.resumo, periodicidade);

  const mapa = mapaDoPanorama(
    leitura,
    view,
    overview
      ? unidadesPorImpacto(overview).map(({ unidade, impacto }) => ({
          chave: unidade.contexts[0]?.scopeHash ?? unidade.unidade,
          label: unidade.label,
          impacto:
            impacto && impacto.periodicity !== null
              ? { periodicity: impacto.periodicity, amount: impacto.amount }
              : null,
          alteracoes: unidade.summary.changes,
        }))
      : [],
  );

  const fila = filaDoPanorama({
    view,
    veredito,
    prioridades: view ? juntarPrioridades(view) : [],
    recorte,
    comDestino,
  });

  const familiaAberta = parametros.get("familia");
  const impactoAberto = parametros.get("impacto");
  const detalheFamilia = detalheDaFamilia(leitura.resumo, familiaAberta, periodicidade);
  const detalheImpacto = detalheDoImpacto(view, impactoAberto, periodicidade);

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
      {/* ---- Andar 1 · o veredito ---- */}
      <Veredito veredito={veredito} />

      {veredito.cobertura ? (
        <FaixaDeCobertura
          cobertura={veredito.cobertura}
          verDetalhes={
            comDestino
              ? linkDasSemPreco(daVigencia)
              : /* Na Visão Geral o destino cairia na unidade padrão do servidor. */
                null
          }
        />
      ) : (
        <FaixaSemAlteracao temAnterior={view ? view.cockpit.baseline.hasBaseline : true} />
      )}

      {/* ---- Andar 2 · o placar ---- */}
      <Placar medidas={placar} />

      {/* ---- Andar 3 · a composição ---- */}
      <div className="grid gap-5 xl:grid-cols-3">
        <section className="bg-card border rounded-xl shadow-sm px-6 py-5 xl:col-span-2 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-base font-bold">Composição do impacto líquido</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                De onde vem o resultado apurado desta vigência
              </p>
            </div>
            <span className={cn(BOTAO_DE_TROCA, "cursor-default")}>{DECOMPOSICOES.familia}</span>
          </div>
          {ponte && ponte.degraus.length > 0 ? (
            <PonteDoImpactoGrafico
              ponte={ponte}
              onAbrirFamilia={
                view ? (code) => onTrocar({ familia: code, impacto: null }) : null
              }
              className="mt-4"
            />
          ) : (
            <p className="text-sm text-muted-foreground py-20 text-center">
              Nenhuma família tem valor apurado nesta vigência — não há composição a desenhar.
            </p>
          )}
        </section>

        <section className="bg-card border rounded-xl shadow-sm px-6 py-5 min-w-0">
          <PrincipaisMudancas
            linhas={mudancas}
            periodicity={periodicidade}
            filtro={filtroAberto(parametros)}
            onFiltro={(f) => onTrocar({ mudancas: f === "todos" ? null : f })}
            onAbrir={view ? (key) => onTrocar({ impacto: key, familia: null }) : null}
            limite={5}
            nota={
              view
                ? undefined
                : "Em Visão Geral a lista soma as unidades e não abre por dentro: o detalhe de um parâmetro só existe dentro de um contexto."
            }
          />
        </section>
      </div>

      {/* ---- Andar 4 · a trajetória ---- */}
      <section className="bg-card border rounded-xl shadow-sm px-6 py-5">
        <EvolucaoPorVigencia
          pontos={pontos}
          periodicity={periodicityDaSerie ?? periodicidade}
          janela={janela}
          onJanela={onJanela}
          vigenciaAberta={vigenciaAberta}
          onEscolherVigencia={(periodo) => onTrocar({ period: periodo })}
          carregando={serieCarregando}
        />
        {/*
          A leitura por tipo de ativo — cavalo, carreta, trecho — **não** é um
          controle deste cartão, e essa é uma correção à proposta original.

          Trocar o tipo troca a **população** de todo número, e não o recorte de
          um gráfico: com "Carreta" ligado aqui, este andar falaria de carretas
          enquanto os outros seis continuariam falando da frota inteira, na
          mesma tela e sem nada acusando a divergência — exatamente a classe de
          defeito que o Panorama existe para desfazer.

          A Linha do Tempo pode fazê-lo porque lá o tipo é aba **de página**: a
          tela inteira troca de população junto. Daí o link, e não a pastilha.
        */}
        <p className="text-xs text-muted-foreground mt-4 pt-4 border-t flex items-center gap-1.5 flex-wrap">
          <History className="w-3.5 h-3.5 shrink-0" />
          Para ler este mesmo histórico por tipo de ativo — a população inteira trocada, e não só
          este gráfico —
          <Link
            href={consulta.toString() ? `${LINHA_DO_TEMPO}?${consulta}` : LINHA_DO_TEMPO}
            className="font-semibold text-brand hover:underline"
          >
            abra a Linha do Tempo
          </Link>
          .
        </p>
      </section>

      {/* ---- Andar 5 · o mapa ---- */}
      <Mapa
        mapa={mapa}
        onAbrirUnidade={
          overview ? (chave) => onTrocar({ visaoGeral: null, scopeHash: chave }) : null
        }
      />

      {/* ---- Andar 6 · a fila ---- */}
      <Fila
        itens={fila}
        nota={
          view
            ? undefined
            : "A fila é lida por unidade: os destinos dela recortam por unidade, e um número que somou todas não abre a lista de uma só. Escolha uma unidade para vê-la."
        }
      />

      {/* ---- Andar 7 · a procedência ---- */}
      {procedencia && <Procedencia procedencia={procedencia} />}

      {/* As gavetas — as mesmas do Impacto Apurado, sobre o mesmo recorte. */}
      {view && detalheFamilia && (
        <DetalheDaFamilia
          detalhe={detalheFamilia}
          period={view.period}
          periodLabel={view.periodLabel}
          recorte={{ ...recorte, period: view.period }}
          unidades={unidadesDoDrill}
          vigencia={view.period}
          onFechar={() => onTrocar({ familia: null })}
        />
      )}
      {view && detalheImpacto && (
        <DetalheDoImpacto
          detalhe={detalheImpacto}
          period={view.period}
          periodLabel={view.periodLabel}
          recorte={{ ...recorte, period: view.period }}
          onFechar={() => onTrocar({ impacto: null })}
        />
      )}
    </>
  );
}

/** O endereço das alterações sem preço — a população que a faixa de cobertura conta. */
function linkDasSemPreco(recorte: Recorte): string {
  const params = new URLSearchParams();
  if (recorte.period) params.set("period", recorte.period);
  if (recorte.scopeHash) params.set("scopeHash", recorte.scopeHash);
  if (recorte.canal !== null) params.set("canal", recorte.canal);
  params.set("impactConfidence", "NOT_CALCULABLE");
  return `/alteracoes?${params}`;
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
 * que a Gestão à Vista e os outros módulos publicam.
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
  return <p className="text-sm text-muted-foreground">Carregando o Panorama…</p>;
}

function SemVigencia() {
  return (
    <div className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
      <p className="text-base font-bold">Nenhuma vigência para ler ainda.</p>
      <p className="text-sm text-muted-foreground mt-1.5">
        Envie a primeira planilha em Importações — sem duas vigências não há o que comparar, e sem
        comparação não há panorama a montar.
      </p>
    </div>
  );
}
