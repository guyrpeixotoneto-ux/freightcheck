import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  CircleHelp,
  CloudDownload,
  Database,
  FileText,
  History,
  Info,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersVertical,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, fetchJson } from "@/lib/api";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { RESUMO_EXECUTIVO } from "@/lib/ambiente";
import { cn } from "@/lib/utils";
import { periodicitySuffix } from "@/lib/format";
import {
  COR_DA_LINHA,
  DetalheDaAlteracao,
  ICONE_DA_LINHA,
} from "@/components/inicio/detalhe-da-alteracao";
import { DetalheDoImpacto } from "@/components/inicio/detalhe-do-impacto";
import { ComposicaoDoImpacto } from "@/components/inicio/composicao-do-impacto";
import { ComposicaoDasAlteracoes } from "@/components/inicio/composicao-das-alteracoes";
import {
  cobertura,
  composicaoDasAlteracoes,
  composicaoDoImpacto,
  detalheDaAlteracao,
  detalheDoImpacto,
  escreverImpacto,
  escreverPercentual,
  escreverVariacao,
  frotaTotal,
  impactosDaVigencia,
  integridade,
  ladosDoImpacto,
  maioresImpactos,
  participacao,
  partesDoImpacto,
  pontosDeAtencao,
  qualidadeDaCobertura,
  ultimaImportacao,
  ultimasAlteracoes,
  variacao,
  vigenciaAnterior,
  type ExecucaoDeImportacao,
  type FocoDeAlteracoes,
  type Lado,
  type LadosDoImpacto,
  type LinhaDeAlteracao,
  type PontoDeAtencao,
  type Tom,
} from "@/lib/visao-geral";
import {
  lerRecorte,
  linkDeAlteracoes,
  nomeDaUnidade,
  type Recorte,
} from "@/lib/recorte";
import { formatBrlShort } from "@/lib/format";
import { VisaoGeralConteudo } from "@/components/inicio/visao-geral-consolidada";
import type {
  FamiliesOverview,
  FamiliesView,
  GroupedView,
} from "@/components/inicio/types";
import type { BalancoResumo } from "@/components/balanco/tipos";
import { useAlteracoesPorVigencia } from "@/hooks/use-alteracoes-por-vigencia";
import { SeletorDeVigencia } from "@/components/vigencia/seletor-de-vigencia";

/**
 * Visão geral — a primeira tela, e a única que responde antes de ser perguntada.
 *
 * Ela é o painel executivo da unidade aberta: **quanto custou, o que mudou, em
 * quantos ativos, o que travou e o quanto disso a auditoria cobre** — nesta
 * ordem, porque é a ordem em que a pergunta chega. Abaixo dos números vêm as
 * três leituras que explicam cada um deles (os maiores impactos, as alterações
 * em destaque, a qualidade da apuração) e, por último, as portas para as telas
 * que aprofundam.
 *
 * O que esta tela substituiu, e por quê: era uma saudação com sete cartões de
 * entrada, todos com a mesma frase fixa por baixo do título. Um cartão que
 * repete a mesma frase todo dia vira moldura e para de ser lido — e a tela que
 * mais gente abre era, justamente, a que menos dizia. Os cartões de entrada não
 * sumiram: viraram a faixa "Explorar", que é o tamanho certo para eles agora que
 * o menu lateral já lista as quinze telas.
 *
 * As recusas que este produto tem em toda parte valem aqui em dobro, porque
 * aqui os números são lidos primeiro e por quem tem menos contexto:
 *
 * 1. **Periodicidade nunca soma.** O impacto sai em uma linha por
 *    periodicidade, e o ranking de parâmetros acontece dentro de uma delas.
 * 2. **Cartão sem dado não aparece.** Nada aqui mostra "0" para preencher o
 *    lugar; sem resposta do servidor, o cartão some e a grade fecha.
 * 3. **Nenhuma comparação inventada.** "vs vigência anterior" só aparece quando
 *    existe vigência anterior e ela foi de fato consultada.
 */

/**
 * O cartão desta tela.
 *
 * Ele existia porque o resto do produto era quase reto (`--radius: 0.25rem`) e
 * esta tela — a única feita de blocos que se leem em paralelo — precisava do
 * canto arredondado para separar um bloco do outro sobre o cinza da página sem
 * gastar mais uma linha. O canto era a exceção, e o `rounded-2xl` escrito à mão
 * era como ela se dizia.
 *
 * A casca inteira foi arredondada, e a exceção acabou: `rounded-xl` é o mesmo
 * raio que `Card` dá a qualquer cartão do produto. A constante fica pelo que
 * sobrou dela — fundo, borda e sombra numa string só, repetida em nove seções
 * desta página —, e agora ela segue `--radius` junto com o resto.
 */
const CARTAO = "bg-card border rounded-xl shadow-sm";
export default function Inicio() {
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);

  /*
    A unidade e a vigência abertas moram na URL, e não no estado do componente.

    É o que faz o seletor de unidade da lateral e o botão "Trocar vigência"
    funcionarem como o resto do produto: o endereço descreve o que está na
    tela, dá para mandar para alguém, e o botão de voltar do navegador desfaz
    a troca. Os três parâmetros são os mesmos que Parâmetros usa, de
    propósito — sair daqui para lá leva o recorte junto.
  */
  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  const sufixo = consulta.toString() ? `?${consulta}` : "";

  /*
    "Visão Geral" é uma opção de unidade/escopo — vive no seletor da lateral
    (`components/layout/sidebar.tsx`), nunca um valor de `period`. Os dois
    seletores continuam ortogonais: ligar Visão Geral não mexe na competência
    que já estava aberta, e trocar de competência dentro da Visão Geral nunca
    desliga `visaoGeral`.
  */
  const visaoGeral = parametros.get("visaoGeral") === "1";

  const vigencia = useQuery({
    queryKey: ["families", "visao-geral", consulta.toString()],
    enabled: !visaoGeral,
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesView>(`/changes/families${sufixo}`);
      } catch (erro) {
        // 404 aqui quer dizer "ainda não há vigência para mostrar", que é um
        // estado do produto e não uma falha dele. A tela vazia explica o que
        // fazer; o aviso vermelho mandaria procurar defeito onde não há.
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
  });

  const view = visaoGeral ? null : (vigencia.data ?? null);
  const anterior = vigenciaAnterior(view);

  /*
    A vigência anterior vem numa consulta própria e só quando existe.

    `/changes/grouped` e não `/changes/families`: daqui só saem duas contagens —
    alterações e impacto —, e o resumo executivo com a árvore de famílias
    inteira seria trabalho de servidor para um dado que a tela não usa.
  */
  const comparacao = useQuery({
    queryKey: ["grouped", "visao-geral-anterior", anterior?.date, consulta.toString()],
    enabled: anterior !== null,
    queryFn: async () => {
      const query = new URLSearchParams(consulta);
      query.set("period", anterior!.date);
      try {
        return await fetchJson<GroupedView>(`/changes/grouped?${query}`);
      } catch {
        // Sem a anterior, as linhas de variação somem — e nada mais nesta tela
        // depende dela. Falhar a página inteira por causa da comparação seria
        // trocar cinco números verdadeiros por um aviso.
        return null;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const balancos = useQuery({
    queryKey: ["balance", "visao-geral"],
    queryFn: () => fetchJson<BalancoResumo[]>("/balance").catch(() => null),
    retry: false,
    staleTime: 60_000,
  });

  const importacoes = useQuery({
    queryKey: ["imports", "visao-geral"],
    queryFn: () => fetchJson<ExecucaoDeImportacao[]>("/imports").catch(() => null),
    retry: false,
    staleTime: 60_000,
  });

  /*
    A quarta consulta que usava `["contexts"]` com regras próprias — e a mais
    silenciosa das quatro: `.catch(() => [])` transformava **qualquer** falha em
    lista vazia e a gravava no cache compartilhado, com `staleTime` de um minuto.
    Quem saísse daqui para `/unidades` no minuto seguinte encontraria uma lista
    vazia legítima, sem erro nenhum, sobre uma chamada que tinha falhado nesta
    tela. Ver `lib/contextos.ts`.
  */
  const contextos = useContextosDaCasca();

  /*
    A união de competências de todas as unidades — o que "Trocar vigência"
    lista quando Visão Geral está ativa, no lugar de `view.periods` (que não
    existe em modo overview, porque não há um único `FamiliesView` por trás).
  */
  const periodosOverview = useMemo(
    () =>
      Array.from(new Set(contextos.contextos.flatMap((c) => c.periodosDisponiveis))).sort(
        (a, b) => b.localeCompare(a),
      ),
    [contextos.contextos],
  );

  const periodoOverviewEfetivo =
    parametros.get("period") ?? periodosOverview[periodosOverview.length - 1] ?? null;

  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, {
    enabled: visaoGeral,
  });

  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;

  const coberturaAuditada = useMemo(() => cobertura(balancos.data), [balancos.data]);
  const integridadeDosDados = useMemo(() => integridade(balancos.data), [balancos.data]);
  const ultima = useMemo(() => ultimaImportacao(importacoes.data), [importacoes.data]);
  const ranking = useMemo(() => maioresImpactos(view?.summary), [view]);

  /*
    O parâmetro aberto no detalhe mora na URL, como a unidade e a vigência.

    É o que faz "de onde vem este número" ser uma pergunta que se manda para
    alguém: o endereço com `?impacto=` abre o mesmo painel, sobre o mesmo
    recorte, com o mesmo número dentro. O botão de voltar do navegador fecha o
    painel em vez de sair da tela, que é o que a mão espera de uma gaveta.
  */
  const detalhe = useMemo(
    () =>
      detalheDoImpacto(
        view,
        parametros.get("impacto"),
        /*
          Qual periodicidade o painel explica, dita no endereço.

          Quem clica no pódio e quem clica numa linha da balança chegam ao mesmo
          painel por caminhos que ranqueiam em periodicidades possivelmente
          diferentes — o pódio na de maior movimento, a balança na que estava
          aberta. Sem a chave, o painel escolheria a do pódio nos dois casos, e
          quem abrisse a balança do anual receberia o número mensal sob o nome do
          parâmetro que acabou de clicar. A chave é opcional: um `?impacto=`
          colado sem ela continua caindo na régua do pódio.
        */
        parametros.get("periodicidade") ?? ranking?.periodicity ?? null,
      ),
    // `parametros` é derivado de `search`, e `ranking` de `view`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, ranking, search],
  );

  /*
    A balança aberta na gaveta mora na URL, como as outras duas.

    São três chaves e não uma porque são três leituras diferentes da vigência —
    o saldo partido em dois lados, o parâmetro que somou dinheiro e a alteração
    em destaque. Abrir uma apaga as outras do endereço: duas gavetas empilhadas
    escondem a de baixo sem fechá-la, e quem fechasse a de cima cairia num
    painel que não pediu.
  */
  const composicao = useMemo(
    () =>
      composicaoDoImpacto(view, parametros.get("composicao"), parametros.get("lado")),
    // `parametros` é derivado de `search`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, search],
  );

  /*
    A composição das alterações detectadas, a quarta gaveta desta tela.

    Chave própria (`?detectadas=`) e não um valor a mais em `?composicao=`: são
    duas leituras de vigências inteiras que não se somam — uma parte dinheiro em
    dois lados, a outra parte contagem em três partições —, e uma chave só
    obrigaria quem lê o endereço a saber qual painel um valor abre.

    `detectadas` e não `alteracoes`: `?alteracao=` já existe e abre outra coisa,
    e duas chaves a uma letra de distância são um erro esperando para acontecer
    em quem monta um endereço à mão.
  */
  const detectadas = useMemo(
    () => composicaoDasAlteracoes(view, parametros.get("detectadas"), lerRecorte(search)),
    // `parametros` e o recorte são derivados de `search`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, search],
  );

  /*
    O recorte que sai daqui rumo às Alterações.

    Sai do endereço, e não do estado da tela, porque é o mesmo que os cartões de
    troca escrevem lá em cima — o link herda a unidade e a vigência que estão à
    vista. A vigência é reposta com a que o servidor de fato respondeu (dentro de
    `pontosDeAtencao` e `ultimasAlteracoes`): quem abriu sem escolher nada tem a
    URL vazia e mesmo assim está lendo uma vigência, e mandá-la vazia faria o
    outro lado escolher de novo, por conta própria, e possivelmente outra.
  */
  const recorte = lerRecorte(search);

  /*
    A alteração aberta na gaveta mora na URL, pelo mesmo motivo que `?impacto=`.

    São duas chaves e não uma porque são duas leituras diferentes da vigência —
    o parâmetro que somou dinheiro e a alteração que está em destaque. Abrir uma
    apaga a outra do endereço: duas gavetas empilhadas escondem a de baixo sem
    fechá-la, e quem fechasse a de cima cairia num painel que não pediu.
  */
  const alteracao = useMemo(
    () => detalheDaAlteracao(view, parametros.get("alteracao"), lerRecorte(search)),
    // `parametros` e `recorte` são derivados de `search`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, search],
  );

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${RESUMO_EXECUTIVO}?${texto}` : RESUMO_EXECUTIVO);
  };

  /*
    Abrir uma gaveta é fechar as outras duas, e as chaves que sobram de uma
    gaveta fechada também saem.

    Escrito uma vez aqui e não em cada `onAbrir`: eram cinco lugares montando a
    mesma lista de chaves a apagar, e o primeiro a esquecer uma delas deixaria um
    `?lado=perdas` grudado num endereço que não tem balança — invisível na tela e
    colável assim mesmo.
  */
  const abrirGaveta = (aberta: Record<string, string | null>) =>
    trocarPara({
      impacto: null,
      periodicidade: null,
      alteracao: null,
      composicao: null,
      lado: null,
      detectadas: null,
      ...aberta,
    });

  return (
    <Layout>
      <Cabecalho
        view={view}
        overview={overview}
        visaoGeral={visaoGeral}
        periodosOverview={periodosOverview}
        ultima={ultima}
        consulta={consulta}
        onTrocar={trocarPara}
      />

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {visaoGeral ? (
          <>
            {overviewQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a Visão Geral…</p>
            )}
            {overviewQuery.error && (
              <ApiErrorNotice
                error={overviewQuery.error}
                what="Não foi possível montar a Visão Geral."
              />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && (
              <BancoVazio />
            )}
            {overview && (
              <VisaoGeralConteudo overview={overview} search={search} onTrocar={trocarPara} />
            )}
          </>
        ) : (
          <>
            {vigencia.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a vigência…</p>
            )}

            {vigencia.error && (
              <ApiErrorNotice error={vigencia.error} what="Não foi possível montar a visão geral." />
            )}

            {!vigencia.isLoading && !vigencia.error && view === null && <BancoVazio />}
          </>
        )}

        {view && (
          <>
            <Indicadores
              view={view}
              anterior={comparacao.data ?? null}
              cobertura={coberturaAuditada}
              recorte={recorte}
              onAbrirComposicao={(periodicity, lado) =>
                abrirGaveta({ composicao: periodicity, lado: lado ?? null })
              }
              onAbrirDetectadas={(foco) => abrirGaveta({ detectadas: foco })}
            />

            <Atencao
              pontos={pontosDeAtencao(view, ranking, integridadeDosDados, recorte)}
            />

            {!view.complete && (
              <div className="flex gap-3 rounded-xl border border-amber-400 bg-amber-50 px-5 py-4 text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>
                  <strong>Visão parcial.</strong> Nesta vigência chegou apenas{" "}
                  {view.series.map((s) => s.equipment.toLowerCase()).join(", ")}. Falta{" "}
                  <strong>{view.missingSeries.join(", ").toLowerCase()}</strong> — os números
                  acima cobrem só o que foi entregue, e a série ausente não está contada como
                  zero.
                </p>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <MaioresImpactos
                ranking={ranking}
                period={view.period}
                onAbrir={(key) =>
                  abrirGaveta({
                    impacto: key,
                    periodicidade: ranking?.periodicity ?? null,
                  })
                }
              />
              <UltimasAlteracoes
                view={view}
                recorte={recorte}
                onAbrir={(chave) => abrirGaveta({ alteracao: chave })}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <QualidadeDaAuditoria
                view={view}
                cobertura={coberturaAuditada}
                ultima={ultima}
              />
              <Explorar />
            </div>

            <ComposicaoDasAlteracoes
              composicao={detectadas}
              period={view.period}
              periodLabel={view.periodLabel}
              recorte={recorte}
              onAbrirPonto={(chave) => abrirGaveta({ alteracao: chave })}
              onTrocarFoco={(foco) => abrirGaveta({ detectadas: foco })}
              onFechar={() => trocarPara({ detectadas: null })}
            />

            <ComposicaoDoImpacto
              composicao={composicao}
              periodLabel={view.periodLabel}
              recorte={{ ...recorte, period: view.period }}
              onAbrirParametro={(key, periodicity) =>
                abrirGaveta({ impacto: key, periodicidade: periodicity })
              }
              onTrocarPeriodicidade={(periodicity) =>
                abrirGaveta({ composicao: periodicity })
              }
              onFechar={() => trocarPara({ composicao: null, lado: null })}
            />

            <DetalheDoImpacto
              detalhe={detalhe}
              period={view.period}
              periodLabel={view.periodLabel}
              recorte={recorte}
              onFechar={() => trocarPara({ impacto: null, periodicidade: null })}
            />

            <DetalheDaAlteracao
              detalhe={alteracao}
              period={view.period}
              periodLabel={view.periodLabel}
              onFechar={() => trocarPara({ alteracao: null })}
            />
          </>
        )}

        <Rodape />
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// O cabeçalho
// ---------------------------------------------------------------------------

/**
 * Onde estou, de quando é isto, e quando chegou.
 *
 * As três coisas numa linha só, porque as três qualificam todo número abaixo.
 * Os dois botões de troca aparecem **apenas quando há o que trocar**: um menu de
 * uma opção é uma promessa de variedade que o dado não tem, e cobra um clique
 * para descobrir que não havia escolha.
 */
function Cabecalho({
  view,
  overview,
  visaoGeral,
  periodosOverview,
  ultima,
  consulta,
  onTrocar,
}: {
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  visaoGeral: boolean;
  /** União de `periodosDisponiveis` de todas as unidades, mais recente primeiro. */
  periodosOverview: string[];
  ultima: ReturnType<typeof ultimaImportacao>;
  consulta: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const alteracoesPorVigencia = useAlteracoesPorVigencia(view, consulta);
  const ultimaComparacao = useMemo(() => {
    if (!view) return null;
    return (
      [...view.periods]
        .sort((a, b) => b.date.localeCompare(a.date))
        .find(
          (periodo) =>
            periodo.date !== view.period && (alteracoesPorVigencia.get(periodo.date) ?? 0) > 0,
        ) ?? null
    );
  }, [view, alteracoesPorVigencia]);
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const partes = visaoGeral
    ? overview
      ? [
          `${overview.unitsIncluded.length} de ${overview.unitsIncluded.length + overview.unitsExcluded.length} unidades incluídas`,
          ultima ? `última importação ${ultima.relativo}` : null,
        ].filter((p): p is string => p !== null)
      : []
    : [
        view?.context.channel ?? null,
        view?.periodLabel ?? null,
        ultima ? `última importação ${ultima.relativo}` : null,
      ].filter((p): p is string => p !== null);

  return (
    /*
      Sem a faixa branca com borda embaixo que havia aqui.

      O título passou a morar sobre o mesmo cinza dos cartões: a faixa desenhava
      uma segunda barra logo abaixo da vermelha do Freightech, e as duas juntas
      empurravam o primeiro número para baixo da dobra em tela de 13 polegadas.
      O que qualifica os números é o texto, não o fundo atrás dele.
    */
    <header className="px-8 pt-7 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
        <div className="min-w-0">
          <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight">
            Resumo executivo — {visaoGeral ? "Visão Geral" : (unidade ?? "")}
          </h1>
          {partes.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1.5">{partes.join(" · ")}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!visaoGeral && ultimaComparacao && (
            <button
              type="button"
              onClick={() => onTrocar({ period: ultimaComparacao.date })}
              className={BOTAO_DE_TROCA}
              title={`Ir para ${ultimaComparacao.label}, a vigência mais recente com comparação disponível`}
            >
              <History className="w-4 h-4" />
              Última comparação · {ultimaComparacao.label}
            </button>
          )}
          {visaoGeral
            ? periodosOverview.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
                    <CalendarDays className="w-4 h-4" />
                    Trocar vigência
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {periodosOverview.length} competências disponíveis
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {periodosOverview.map((data) => (
                      <DropdownMenuItem
                        key={data}
                        onSelect={() => onTrocar({ period: data })}
                        className={cn(data === overview?.period && "font-bold text-brand")}
                      >
                        {data}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            : (
                <SeletorDeVigencia
                  view={view}
                  consulta={consulta}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                />
              )}
        </div>
      </div>
    </header>
  );
}

/**
 * Os botões de troca do cabeçalho, com a mesma casca.
 *
 * Contorno vermelho e fundo branco: são as únicas ações desta tela, e o
 * laranja cheio está reservado para a ação que cria trabalho — "Enviar a
 * primeira planilha", no banco vazio. Trocar de unidade, trocar de vigência
 * e ir para a última comparação não mudam nada no banco; mudam o recorte do
 * que se está lendo.
 */
const BOTAO_DE_TROCA =
  "flex items-center gap-2 rounded-lg border border-brand bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";

// ---------------------------------------------------------------------------
// Os cinco números
// ---------------------------------------------------------------------------

/**
 * A régua de indicadores.
 *
 * Cinco cartões, e cada um responde uma pergunta inteira: quanto custou, o que
 * mudou, em quantos ativos, o que não deu para valorar, e o quanto de tudo isso
 * a auditoria cobre. O quarto existe para que o primeiro não seja lido como a
 * conta fechada — impacto apurado sem o número do que ficou de fora é meia
 * verdade contada com autoridade de total.
 *
 * **Três deles abrem**, e cada um na tela que mostra exatamente a população que
 * ele contou:
 *
 * - *Impacto líquido* → as linhas com valor apurado (`impactConfidence=CALCULATED`);
 * - *Alterações detectadas* → a vigência inteira, sem filtro;
 * - *Sem impacto calculável* → as mesmas alterações, filtradas em `NOT_CALCULABLE`.
 *
 * *Cobertura auditada* leva ao Balanço de massa, que é de onde a conta dela sai.
 *
 * **Veículos afetados não abre nada, e é a decisão mais deliberada das cinco.**
 * Ele chegou a apontar para a Análise de frota — "é lá que se lê ativo por
 * ativo", o que é verdade e não basta: `routes/fleet-analysis.ts` lê um `.xlsx`
 * do disco, fora do Postgres, e não conhece vigência, unidade nem canal (ver
 * `docs/ARQUITETURA.md` §"absorver"). O número deste cartão é canônico e conta
 * os ativos **desta** vigência; mandá-lo para uma tela que responde por outra
 * fonte é exatamente o defeito que os outros quatro links existem para eliminar,
 * cometido no cartão do meio. Nenhum destino de hoje lista "os ativos tocados
 * desta vigência" a partir do canônico, e enquanto não listar o cartão fica
 * sendo só o número — que é honesto. Quando a dívida do `fleet-analysis` for
 * absorvida, o link volta.
 *
 * Nenhum destes destinos foi escolhido por parecer relacionado: em cada um, o
 * número do cartão é o número que a tela de destino mostra. Um atalho que abre
 * um total diferente do que foi clicado gasta mais confiança do que economiza
 * cliques.
 */
function Indicadores({
  view,
  anterior,
  cobertura: coberturaAuditada,
  recorte,
  onAbrirComposicao,
  onAbrirDetectadas,
}: {
  view: FamiliesView;
  anterior: GroupedView | null;
  cobertura: ReturnType<typeof cobertura>;
  recorte: Recorte;
  /** Abre a balança da vigência. Ver `ComposicaoDoImpacto`. */
  onAbrirComposicao: (periodicity: string, lado?: Lado) => void;
  /** Abre a composição das alterações. Ver `ComposicaoDasAlteracoes`. */
  onAbrirDetectadas: (foco: FocoDeAlteracoes) => void;
}) {
  const impactos = impactosDaVigencia(view);
  /*
    Só as periodicidades em que dinheiro de fato se mexeu.

    Filtrado aqui e não dentro do bloco dos dois lados porque é o mesmo corte
    que decide se o cartão abre a gaveta: uma periodicidade cujos dois lados são
    zero não tem balança a mostrar, e mandar o clique para ela abriria um painel
    com duas listas vazias.
  */
  const lados = ladosDoImpacto(view).filter((l) => l.fatiaDeGanho !== null);
  const frota = frotaTotal(view);
  const veiculos = participacao(view.totals.vehiclesTouched, frota);
  const semPreco = participacao(view.impact.notCalculable, view.totals.changes);
  const variacaoDeMudancas = variacao(view.totals.changes, anterior?.totals.changes);
  const qualidade = coberturaAuditada ? qualidadeDaCobertura(coberturaAuditada.percentual) : null;

  // A vigência que o servidor respondeu, e não a que a URL pediu: quem não
  // escolheu nada está lendo uma vigência mesmo assim, e é ela que precisa
  // atravessar para o outro lado.
  const daVigencia: Recorte = { ...recorte, period: view.period };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Indicador
        icone={ReceiptText}
        titulo="Impacto líquido"
        ajuda="A diferença de remuneração apurada nesta vigência, por periodicidade — o que somou menos o que subtraiu. R$/mês e R$/ano nunca são somados: são grandezas diferentes."
        /*
          O cartão abre uma gaveta, e não mais a lista filtrada de Alterações.

          O que ele publica é uma subtração, e o que faltava era justamente as
          duas parcelas dela. Em agosto/2026 o cartão dizia "R$ 11.917/mês
          favorável", e o que aconteceu foi R$ 21.764 entrando enquanto R$ 9.847
          saíam. A lista de linhas não responde isso — ela mostra as alterações
          uma a uma, e reconstruir os dois lados a partir dali é a conta que
          ninguém faz. A gaveta responde, e leva a lista dentro dela.

          Sem impacto apurado não há balança para abrir, e o cartão continua só
          cartão: uma gaveta vazia depois de um clique se lê como defeito.
        */
        aoAbrir={
          lados.length === 0
            ? undefined
            : () => onAbrirComposicao(lados[0].periodicity)
        }
        abrir="ver o que somou e o que subtraiu"
      >
        {impactos.length === 0 ? (
          <>
            {/*
              "Nenhum valor apurável" ocupa o lugar do número, no corpo do
              número — e não numa linha cinza de rodapé. É a resposta da
              vigência à pergunta do cartão: escondê-la num cinza pequeno faria
              o olho procurar um valor que não existe e concluir que a tela não
              carregou.
            */}
            <ValorGrande texto="Nenhum valor apurável" apagado />
            <Nota
              texto={`${view.impact.notCalculable.toLocaleString("pt-BR")} ${
                view.impact.notCalculable === 1 ? "alteração sem preço" : "alterações sem preço"
              }`}
            />
          </>
        ) : (
          <>
            {impactos.map((impacto) => {
              const partes = partesDoImpacto(impacto);
              return (
                <ValorGrande
                  key={impacto.periodicity ?? "sem-periodicidade"}
                  texto={partes.valor}
                  sufixo={partes.sufixo}
                  tom={impacto.amount < 0 ? "grave" : "ok"}
                />
              );
            })}
            <p
              className={cn(
                "text-sm font-semibold mt-1 flex items-center gap-1",
                impactos[0].amount < 0 ? "text-red-700" : "text-emerald-700",
              )}
            >
              {impactos[0].amount < 0 ? (
                <ArrowDownRight className="w-4 h-4" />
              ) : (
                <ArrowUpRight className="w-4 h-4" />
              )}
              {impactos[0].amount < 0 ? "desfavorável" : "favorável"}
            </p>
            <DoisLados lados={lados} onAbrir={onAbrirComposicao} />
            {/*
              Quem diz que não há com que comparar é o cockpit, e não a ausência
              da resposta anterior: `hasBaseline` é a verdade por série, e a
              consulta pode ter faltado por outro motivo. Anunciar "primeira
              vigência" por causa de uma chamada que falhou seria transformar um
              tropeço de rede em fato sobre o histórico do cliente.
            */}
            <Nota
              texto={
                view.cockpit.baseline.hasBaseline
                  ? "vs vigência anterior"
                  : "primeira vigência da série — não há anterior com que comparar"
              }
            />
          </>
        )}
      </Indicador>

      <Indicador
        icone={FileText}
        titulo="Alterações detectadas"
        /*
          A definição passou a dizer o que a de antes prometia e o número não
          cumpria. "Cada valor que mudou" descrevia 205 das 267 de agosto/2026:
          as outras 62 são troca de formato pura, em que os dois lados valem o
          mesmo. A frase agora conta as duas coisas, e a partição está no cartão.
        */
        ajuda="Cada célula que veio diferente da vigência anterior, contada uma vez por ativo e por parâmetro. Nem toda diferença é um valor diferente: a troca de formato da fonte entra na contagem e sai destacada."
        /*
          O cartão abre a gaveta, e não mais a lista de Alterações — a mesma
          troca do cartão de Impacto líquido, pela mesma razão. A lista continua
          a um clique: é a primeira porta lá dentro, e agora chega com a
          composição já lida em vez de com 267 linhas para conferir na mão.
        */
        aoAbrir={
          view.totals.changes === 0 ? undefined : () => onAbrirDetectadas("todas")
        }
        abrir="ver de onde vêm estas alterações"
      >
        <ValorGrande texto={view.totals.changes.toLocaleString("pt-BR")} />
        {variacaoDeMudancas !== null && (
          <p
            className={cn(
              "text-sm font-semibold mt-1 flex items-center gap-1",
              variacaoDeMudancas > 0 ? "text-brand-red" : "text-muted-foreground",
            )}
          >
            {variacaoDeMudancas > 0 ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <ArrowDownRight className="w-4 h-4" />
            )}
            {escreverVariacao(variacaoDeMudancas)} vs vigência anterior
          </p>
        )}
        <ValorEFormato
          total={view.totals.changes}
          formato={view.totals.formatOnlyChanges}
          onAbrir={onAbrirDetectadas}
        />
        <Nota texto={`${view.totals.groups} pontos da remuneração tocados`} />
      </Indicador>

      <Indicador
        icone={Truck}
        titulo="Veículos afetados"
        ajuda="Ativos com pelo menos uma alteração nesta vigência, sobre a frota que a vigência entregou."
        /* Sem `href` de propósito — a razão está no cabeçalho de `Indicadores`. */
      >
        <ValorGrande texto={view.totals.vehiclesTouched.toLocaleString("pt-BR")} />
        {veiculos !== null && (
          <Nota
            texto={`${escreverPercentual(veiculos)} da frota (${frota.toLocaleString("pt-BR")} ativos)`}
          />
        )}
      </Indicador>

      <Indicador
        icone={CircleHelp}
        titulo="Sem impacto calculável"
        ajuda="Alterações reais que o sistema não sabe valorar — falta semântica confirmada ou preço. Elas não entram no impacto acima, e nenhuma delas foi arredondada para zero."
        href={
          view.impact.notCalculable === 0
            ? undefined
            : linkDeAlteracoes({
                recorte: daVigencia,
                filtros: { impactConfidence: "NOT_CALCULABLE" },
              })
        }
        abrir="ver quais alterações ficaram sem preço"
      >
        <ValorGrande texto={view.impact.notCalculable.toLocaleString("pt-BR")} />
        {semPreco !== null && <Nota texto={`${escreverPercentual(semPreco)} das alterações`} />}
      </Indicador>

      <Indicador
        icone={ShieldCheck}
        titulo="Cobertura auditada"
        ajuda="Das células que as planilhas trouxeram, quanto a auditoria alcança: tudo menos a perda declarada e o resíduo sem destino. É percentual de célula, não de dinheiro."
        tom="ok"
        href={coberturaAuditada === null ? undefined : "/balanco-massa"}
        abrir="ver a conservação célula a célula"
      >
        {coberturaAuditada === null ? (
          <>
            <ValorGrande texto="sem importação" apagado />
            <Nota texto="nenhuma planilha conferida ainda" />
          </>
        ) : (
          <>
            <ValorGrande
              texto={escreverPercentual(coberturaAuditada.percentual, 1)}
              tom={qualidade?.tom}
            />
            <Nota texto="das células importadas" />
            <Barra proporcao={coberturaAuditada.percentual / 100} tom={qualidade?.tom ?? "ok"} />
          </>
        )}
      </Indicador>
    </div>
  );
}

/**
 * O cartão de um número.
 *
 * O selo do ícone é laranja em quatro dos cinco e verde no da cobertura, e não é
 * enfeite: a cobertura é a única medida da régua que fala da **apuração** e não
 * da remuneração — ela responde "dá para confiar nos outros quatro?". O verde
 * aqui é o mesmo verde do arco lá embaixo, e nenhum dos dois é dito por cor
 * sozinha: o número e o rótulo continuam ao lado.
 *
 * **Quem abre uma tela diz isso no canto, e não num rodapé.** A primeira versão
 * punha uma linha "VER A LISTA COMPLETA DAS ALTERAÇÕES" no pé de cada cartão que
 * levava a algum lugar, e ela produzia um buraco: os cinco cartões têm a mesma
 * altura, então o que não linkava ficava com cem pixels de vazio embaixo — que é
 * exatamente o que se lê como "faltou carregar", e o que este arquivo já recusa
 * na faixa de atenção logo abaixo.
 *
 * E o buraco não era um caso raro: **quatro estados normais o produzem**. Sem
 * impacto apurado, o primeiro cartão não linka; sem alteração sem preço, o
 * quarto não linka; sem importação, o quinto não linka; e "Veículos afetados"
 * não linka nunca, por decisão. O rodapé só ficaria parelho na vigência em que
 * tudo acontece ao mesmo tempo.
 *
 * A seta no canto superior resolve os quatro de uma vez, porque não ocupa
 * altura: os cinco cartões passam a ter a mesma estrutura, e o que muda entre
 * eles é a seta existir. Onde ela some, não sobra espaço nenhum. O destino, que
 * o rodapé dizia por extenso, continua dito — no `title` da seta e no
 * `aria-label` do link, que é onde quem usa leitor de tela sempre o ouviu.
 */
function Indicador({
  icone: Icone,
  titulo,
  ajuda,
  tom,
  href,
  aoAbrir,
  abrir,
  children,
}: {
  icone: LucideIcon;
  titulo: string;
  ajuda: string;
  tom?: "marca" | "ok";
  /** Para onde o número leva. Sem destino, o cartão continua só cartão. */
  href?: string;
  /**
   * A gaveta que o número abre, para quem não sai da tela.
   *
   * Alternativa a `href`, e não companheira dele: um cartão com os dois teria
   * dois destinos para o mesmo clique, e o primeiro a divergir seria o que
   * ninguém está olhando. A casca é a mesma — a seta, o rótulo acessível e a
   * borda que acende no hover não sabem qual dos dois está preenchido.
   */
  aoAbrir?: () => void;
  /** O que a pessoa vai encontrar lá — o rodapé do cartão, e o rótulo do link. */
  abrir?: string;
  children: React.ReactNode;
}) {
  const abre = href !== undefined || aoAbrir !== undefined;

  return (
    <section
      className={cn(
        CARTAO,
        // `min-w-0` porque o cartão é item de grid: sem ele, o número grande
        // em `whitespace-nowrap` (ValorGrande) força o tamanho mínimo pelo
        // conteúdo e vaza a borda do cartão em telas estreitas, em vez de
        // respeitar a coluna que o grid reservou.
        "p-5 flex flex-col min-w-0",
        abre && "relative group focus-within:border-brand hover:border-brand transition-colors",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
            tom === "ok" ? "bg-emerald-50" : "bg-accent",
          )}
        >
          <Icone
            className={cn("w-[1.125rem] h-[1.125rem]", tom === "ok" ? "text-emerald-600" : "text-brand")}
            strokeWidth={2.25}
          />
        </span>
        <h2 className="text-[0.8125rem] font-bold min-w-0 flex-1 leading-tight pt-1.5">{titulo}</h2>
        {/*
          O ⓘ fica fora do link, e não dentro dele.

          São duas ações diferentes na mesma linha: ler a definição do número e
          abrir a lista que o produziu. Aninhadas, um toque no ⓘ navegaria — e a
          definição, que é a defesa contra citar o número errado, viraria a coisa
          mais fácil de disparar por engano.

          `relative z-10` nos dois pela mesma razão: o link do cartão passa por
          baixo deles, e sem a camada o ⓘ deixaria de abrir a definição.
        */}
        <Ajuda texto={ajuda} />
        {abre && (
          <ChevronRight
            className="relative z-10 w-4 h-4 shrink-0 mt-0.5 text-muted-foreground group-hover:text-brand transition-colors"
            aria-hidden
          />
        )}
      </div>
      <div className="mt-5 min-w-0">{children}</div>
      {/*
        O link cobre o cartão inteiro (`absolute inset-0`) em vez de embrulhá-lo:
        assim o alvo do clique é o cartão todo — que é o que o olho vê como um
        botão — sem que o ⓘ e o texto do número virem filhos de uma âncora.

        O rótulo acessível diz o destino por extenso, e não "saiba mais": quem
        navega por leitor de tela ouve quatro links seguidos e precisa distinguir
        os quatro. É a mesma frase que a seta carrega no `title`.
      */}
      {href !== undefined && (
        <Link
          href={href}
          aria-label={`${titulo}: ${abrir ?? "abrir"}`}
          title={abrir}
          className="absolute inset-0 rounded-xl"
        />
      )}
      {href === undefined && aoAbrir !== undefined && (
        <button
          type="button"
          onClick={aoAbrir}
          aria-label={`${titulo}: ${abrir ?? "abrir"}`}
          title={abrir}
          className="absolute inset-0 rounded-xl"
        />
      )}
    </section>
  );
}

/**
 * Os dois lados do impacto, dentro do cartão.
 *
 * A barra mede **movimento** e não saldo: a fatia verde é `ganhos ÷ (ganhos +
 * |perdas|)`. É a diferença entre "esta vigência foi calma" e "esta vigência
 * teve dois movimentos grandes que quase se anularam" — duas leituras que o
 * líquido sozinho publica com a mesma frase, e que pedem conversas diferentes
 * com o cliente.
 *
 * Os dois números são botões, e cada um abre a balança **naquele lado**. O
 * cartão inteiro já abre a balança; o que estes dois acrescentam é chegar lá com
 * a lista que interessa em cima, sem rolar. Eles ficam acima do link que cobre o
 * cartão (`relative z-10`) pela mesma razão que o ⓘ fica.
 *
 * A periodicidade só é escrita quando há mais de uma: com uma só, ela já está
 * colada no número grande logo acima, e repeti-la gastaria a linha que o cartão
 * não tem.
 *
 * Zero aqui é medição, e não ausência dela — a régua do arquivo continua de pé.
 * "R$ 0" num dos lados quer dizer que **toda** alteração com preço foi para o
 * outro lado, que é um fato sobre a vigência. O que não chega até aqui é a
 * periodicidade sem movimento nenhum: ela é cortada em `Indicadores`, junto com
 * a decisão de o cartão abrir ou não.
 */
function DoisLados({
  lados,
  onAbrir,
}: {
  lados: LadosDoImpacto[];
  onAbrir: (periodicity: string, lado?: Lado) => void;
}) {
  if (lados.length === 0) return null;

  return (
    <div className="mt-3.5 space-y-3">
      {lados.map((lado) => {
        const verde = Math.max(0, Math.min(1, lado.fatiaDeGanho ?? 0)) * 100;
        return (
          <div key={lado.periodicity}>
            {lados.length > 1 && (
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                em R$
                {periodicitySuffix(lado.periodicity)}
              </p>
            )}
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-emerald-600" style={{ width: `${verde}%` }} />
              <div className="h-full bg-red-600" style={{ width: `${100 - verde}%` }} />
            </div>
            <div className="relative z-10 mt-1.5 flex items-center justify-between gap-1">
              {/*
                O rótulo acessível diz o que o número é, e não só o número.

                O conteúdo do botão é "+R$ 21.764", e um leitor de tela leria
                exatamente isso: um valor sem substantivo, ao lado de outro
                valor sem substantivo. O `aria-label` põe a palavra que a cor
                está dizendo para quem enxerga.
              */}
              <button
                type="button"
                onClick={() => onAbrir(lado.periodicity, "ganhos")}
                aria-label={`Somou ${formatBrlShort(lado.ganhos)}: ver tudo o que aumentou a remuneração`}
                title="Ver tudo o que somou à remuneração"
                className={cn(
                  "rounded px-1 -mx-1 text-xs font-bold tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  lado.ganhos === 0 ? "text-muted-foreground" : "text-emerald-700",
                )}
              >
                +{formatBrlShort(lado.ganhos)}
              </button>
              <button
                type="button"
                onClick={() => onAbrir(lado.periodicity, "perdas")}
                aria-label={`Subtraiu ${formatBrlShort(Math.abs(lado.perdas))}: ver tudo o que reduziu a remuneração`}
                title="Ver tudo o que subtraiu da remuneração"
                className={cn(
                  "rounded px-1 -mx-1 text-xs font-bold tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  lado.perdas === 0 ? "text-muted-foreground" : "text-red-700",
                )}
              >
                {formatBrlShort(lado.perdas)}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * O que mexeu no valor e o que só trocou de formato, dentro do cartão.
 *
 * A barra existe porque a contagem sozinha mente por omissão: em agosto/2026,
 * **62 das 267 alterações detectadas não são valor que mudou** — são troca de
 * formato pura, em que os dois lados valem o mesmo e o que mudou foi a forma de
 * exportar a coluna. Um quarto do número mais lido da tela descrevia outra
 * coisa, e nada na tela dizia isso.
 *
 * Ardósia e não âmbar no lado do formato: o que aquele selo diz é que **não**
 * houve mudança contratual, e vesti-lo de alerta reporia pela cor o susto que a
 * classificação acabou de tirar. É a mesma decisão do selo FORMATO no cartão de
 * grupo.
 *
 * **Sem troca de formato, o bloco inteiro some** — e isso é uma afirmação, não
 * um vazio: quer dizer que as alterações da vigência são todas valores que
 * mudaram. Uma barra de um segmento só não parte nada, e ocuparia a linha para
 * dizer "100%".
 *
 * Os dois números são botões, e cada um abre a gaveta **já recortada naquele
 * lado**. O cartão inteiro já abre a gaveta; o que estes dois acrescentam é
 * chegar lá com a lista de pontos que interessa em vez da vigência toda.
 */
function ValorEFormato({
  total,
  formato,
  onAbrir,
}: {
  total: number;
  formato: number;
  onAbrir: (foco: FocoDeAlteracoes) => void;
}) {
  if (formato === 0 || total === 0) return null;
  const valor = total - formato;
  const fatia = Math.max(0, Math.min(1, valor / total)) * 100;

  return (
    <div className="mt-3.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-brand" style={{ width: `${fatia}%` }} />
        <div className="h-full bg-slate-400" style={{ width: `${100 - fatia}%` }} />
      </div>
      {/* `relative z-10` pela mesma razão que o ⓘ: o botão do cartão cobre tudo. */}
      <div className="relative z-10 mt-1.5 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onAbrir("valor")}
          aria-label={`${valor.toLocaleString("pt-BR")} mexeram no valor: ver quais pontos`}
          title="Ver os pontos em que o valor mudou"
          className="rounded px-1 -mx-1 text-xs font-bold tabular-nums text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {valor.toLocaleString("pt-BR")} no valor
        </button>
        <button
          type="button"
          onClick={() => onAbrir("formato")}
          aria-label={`${formato.toLocaleString("pt-BR")} são só troca de formato: ver quais pontos`}
          title="Ver os pontos em que só o formato mudou"
          className="rounded px-1 -mx-1 text-xs font-bold tabular-nums text-slate-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {formato.toLocaleString("pt-BR")} só formato
        </button>
      </div>
    </div>
  );
}

/**
 * O ⓘ de cada cartão.
 *
 * Não é enfeite de interface: é onde mora a definição do número. Um "96,8%" sem
 * a frase que diz o que está no denominador é a coisa mais fácil de citar errado
 * numa reunião.
 */
function Ajuda({ texto }: { texto: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={texto}
          /*
            `relative z-10`: nos cartões que abrem uma tela, um link cobre o
            cartão inteiro e passaria por cima deste botão. Sem a camada, tocar
            no ⓘ navegaria em vez de mostrar a definição do número.
          */
          className="relative z-10 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs bg-foreground text-background">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * O número que o cartão existe para mostrar.
 *
 * O corpo é generoso, mas não a ponto de estourar a coluna: com cinco cartões
 * lado a lado em tela de 13 polegadas, "R$ 39.936" em corpo fixo era cortado no
 * meio do "/mês" — e um valor cortado é pior do que um valor menor, porque
 * quem lê não percebe que falta pedaço. O sufixo da periodicidade fica menor e
 * cinza, como no Acompanhamento, e nunca desaparece.
 */
function ValorGrande({
  texto,
  sufixo,
  tom,
  apagado,
}: {
  texto: string;
  sufixo?: string;
  tom?: Tom;
  apagado?: boolean;
}) {
  return (
    <div
      className={cn(
        "font-extrabold tabular-nums leading-none whitespace-nowrap",
        /*
          O corpo cede ao comprimento, e não o contrário. "83" e "−R$ 39.936"
          moram no mesmo cartão de 193px: em corpo único, ou o primeiro fica
          pequeno à toa ou o segundo quebra no hífen — e "−" sozinho numa linha
          com "R$ 39.936" na outra chega a ser lido como dois números.

          Três degraus, e não dois: a contagem curta ("244", "62") é o número
          que esta tela existe para mostrar de longe, e ela cabe no maior deles
          sem chegar perto da borda.
        */
        texto.length > 12
          ? "text-2xl"
          : texto.length > 8
            ? "text-3xl"
            : "text-[2.5rem]",
        /*
          A frase que ocupa o lugar do número quebra linha e usa entrelinha de
          texto — "Nenhum valor apurável" em `leading-none` encosta uma linha na
          outra —, mas continua no corpo e no peso de um número: é a resposta do
          cartão, não uma nota de rodapé.
        */
        apagado && "text-2xl leading-tight whitespace-normal",
        tom === "grave" && "text-red-700",
        tom === "ok" && !apagado && "text-emerald-700",
        tom === "atencao" && "text-brand-red",
      )}
    >
      {texto}
      {sufixo && (
        <span className="text-sm font-normal text-muted-foreground">{sufixo}</span>
      )}
    </div>
  );
}

function Nota({ texto }: { texto: string }) {
  return <p className="text-xs text-muted-foreground mt-3 leading-snug">{texto}</p>;
}

function Barra({ proporcao, tom }: { proporcao: number; tom: Tom }) {
  const largura = Math.max(0, Math.min(1, proporcao)) * 100;
  return (
    <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full",
          tom === "grave" && "bg-red-600",
          tom === "atencao" && "bg-warning",
          tom === "ok" && "bg-emerald-600",
        )}
        style={{ width: `${largura}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// O que merece sua atenção
// ---------------------------------------------------------------------------

const CORES_DO_TOM: Record<Tom, string> = {
  grave: "bg-red-600",
  atencao: "bg-warning",
  ok: "bg-emerald-600",
};

const ICONES_DO_PONTO: Record<string, LucideIcon> = {
  "maior-impacto": ReceiptText,
  "sem-preco": CircleHelp,
  equipamento: Truck,
  integridade: Database,
};

/**
 * A faixa de atenção — quatro leituras do estado, não quatro avisos fixos.
 *
 * O tom de cada uma sai do dado: a bolinha fica verde quando a resposta é boa e
 * vermelha quando não é, e a mesma posição pode trazer as duas coisas em
 * vigências diferentes. Uma faixa que só sabe ficar vermelha ensina o olho a
 * pular por cima dela.
 */
function Atencao({ pontos }: { pontos: PontoDeAtencao[] }) {
  if (pontos.length === 0) return null;

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      {/*
        O título fica na mesma linha dos pontos, e não numa linha própria acima
        deles. São três ou quatro leituras curtas: com o rótulo em cima, a faixa
        gastava duas alturas de linha para dizer uma frase que não muda nunca —
        e empurrava para baixo justamente o que muda a cada vigência.
      */}
      <div className="flex flex-col gap-y-5 xl:flex-row xl:items-center xl:gap-x-6">
        <div className="flex items-center gap-3 shrink-0 xl:border-r xl:pr-6">
          <span className="w-9 h-9 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-[1.125rem] h-[1.125rem] text-warning" strokeWidth={2.25} />
          </span>
          <h2 className="text-base font-bold leading-tight">O que merece sua atenção</h2>
        </div>

        <div
          className={cn(
            "grid flex-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:divide-x",
            COLUNAS_DA_ATENCAO[pontos.length] ?? "xl:grid-cols-4",
          )}
        >
          {pontos.map((ponto, indice) => {
            const Icone = ICONES_DO_PONTO[ponto.chave] ?? Info;
            return (
              <Link
                key={ponto.chave}
                href={ponto.href}
                className={cn(
                  "group flex items-start gap-2.5 min-w-0",
                  indice > 0 && "xl:pl-6",
                )}
              >
                <span
                  className={cn(
                    "w-2.5 h-2.5 rounded-full shrink-0 mt-1.5",
                    CORES_DO_TOM[ponto.tom],
                  )}
                />
                <Icone className="w-5 h-5 shrink-0 mt-0.5 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold group-hover:text-brand transition-colors">
                    {ponto.titulo}
                  </span>
                  <span className="block text-[0.8125rem] text-muted-foreground leading-snug mt-0.5">
                    {ponto.detalhe}
                  </span>
                  {ponto.valor && (
                    <span
                      className={cn(
                        "block text-sm font-bold tabular-nums mt-0.5",
                        ponto.tom === "grave" ? "text-red-700" : "text-emerald-700",
                      )}
                    >
                      {ponto.valor}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Quantas colunas a faixa abre, pelo número de pontos que a vigência produziu.
 *
 * A conta é do dado e não do desenho: uma vigência sem impacto apurado não tem
 * o ponto de maior impacto, e três pontos numa grade de quatro deixariam um
 * quarto de faixa vazio à direita — buraco que se lê como "faltou carregar".
 * As classes ficam escritas por extenso porque o Tailwind varre o código-fonte:
 * `xl:grid-cols-${n}` não existiria no CSS gerado.
 */
const COLUNAS_DA_ATENCAO: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
};

// ---------------------------------------------------------------------------
// Maiores impactos
// ---------------------------------------------------------------------------

/**
 * O pódio dos parâmetros — dentro de uma periodicidade só.
 *
 * A barra é a única figura desta tela, e ela afirma comparabilidade: pôr
 * "−R$ 18.420/mês" e "+R$ 5.240/ano" na mesma escala diria que o segundo é
 * pequeno perto do primeiro, quando os dois não se comparam sem uma conversão
 * que este produto se recusa a fazer no escuro. Por isso o cabeçalho traz a
 * periodicidade escrita, e o rodapé nomeia as que ficaram de fora em vez de
 * deixá-las sumir.
 *
 * **Cada linha abre a sua própria conta.** O pódio afirmava três números e não
 * dava caminho nenhum até eles: quem precisava defender o "R$ 26.856/mês" numa
 * reunião tinha de sair da tela, reencontrar o parâmetro numa grade de sessenta
 * cartões e torcer para chegar lá no mesmo recorte. Agora a linha é um botão, e
 * o painel que ela abre — `DetalheDoImpacto` — mostra os grupos de alteração que
 * somam no número, o que ficou de fora dele e por quê.
 */
function MaioresImpactos({
  ranking,
  period,
  onAbrir,
}: {
  ranking: ReturnType<typeof maioresImpactos>;
  period: string;
  /** Abre a conta por trás de uma linha. Ver `DetalheDoImpacto`. */
  onAbrir: (key: string) => void;
}) {
  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Maiores impactos</h2>
        {ranking && (
          <span className="text-xs font-semibold text-muted-foreground">
            em R$
            {periodicitySuffix(ranking.periodicity)}
          </span>
        )}
        <Ajuda texto="Os parâmetros que mais mexeram na remuneração desta vigência. O ranking acontece dentro de uma periodicidade — nunca entre periodicidades diferentes. Clique numa linha para ver de onde vem o número." />
      </div>

      {ranking === null ? (
        <SemPodio />
      ) : (
        <>
          <ol className="mt-4 space-y-3.5 flex-1">
            {ranking.linhas.map((linha, indice) => (
              <li key={linha.key}>
                {/*
                  A linha inteira é o botão, e não uma seta no fim dela.

                  O que se quer clicar aqui é o número — é ele que gera a
                  desconfiança —, e um alvo de 16 pixels na borda direita
                  obrigaria a mirar para fazer a pergunta mais óbvia da tela.
                */}
                <button
                  type="button"
                  onClick={() => onAbrir(linha.key)}
                  title={`De onde vem o impacto de ${linha.name}`}
                  className="w-full flex items-center gap-3 text-left rounded-lg px-2 -mx-2 py-1.5 -my-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors group"
                >
                  <span className="w-6 h-6 rounded-full border text-[0.6875rem] font-bold flex items-center justify-center shrink-0 text-muted-foreground">
                    {indice + 1}
                  </span>
                  <span className="w-40 shrink-0 min-w-0">
                    <span
                      className="block text-sm font-semibold truncate group-hover:underline"
                      title={linha.name}
                    >
                      {linha.name}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate">
                      {linha.familyName}
                    </span>
                  </span>
                  <span className="flex-1 h-2.5 bg-muted overflow-hidden min-w-8">
                    <span
                      className={cn(
                        "block h-full",
                        linha.amount < 0 ? "bg-red-600" : "bg-emerald-600",
                      )}
                      style={{ width: `${Math.max(2, linha.proporcao * 100)}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums shrink-0 text-right w-28",
                      linha.amount < 0 ? "text-red-700" : "text-emerald-700",
                    )}
                  >
                    {escreverImpacto({
                      periodicity: ranking.periodicity,
                      amount: linha.amount,
                    })}
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
                </button>
              </li>
            ))}
          </ol>

          {ranking.outras.length > 0 && (
            <p className="text-xs text-muted-foreground mt-4 border-t pt-3">
              Esta vigência também tem impacto em{" "}
              <strong className="text-foreground">
                R$
                {ranking.outras.map((p) => periodicitySuffix(p)).join(", R$")}
              </strong>
              , que não entra neste ranking porque não se compara com o de cima. Os números
              completos estão em Parâmetros.
            </p>
          )}
        </>
      )}

      <Link
        href={`/parametros?period=${period}`}
        className="mt-5 self-start inline-flex items-center gap-1.5 rounded-lg border border-brand px-5 py-2.5 text-sm font-bold text-brand hover:bg-accent transition-colors"
      >
        Ver todos os impactos
        <ChevronRight className="w-4 h-4" />
      </Link>
    </section>
  );
}

/**
 * O pódio que não existe nesta vigência.
 *
 * Duas frases, e as duas dizem a mesma coisa em alturas diferentes: a primeira
 * é o fato ("nenhum parâmetro tem impacto apurado"), a segunda é a cadeia que
 * produziu o fato ("sem semântica não há preço, sem preço não há ranking").
 * Quem só passa o olho lê a primeira e já sabe que não é defeito da tela; quem
 * precisa agir lê a segunda e sabe onde a corrente começa.
 *
 * O desenho é de dois ícones e um círculo cinza, sem arquivo de imagem: um
 * vazio ilustrado ocupa o lugar que o pódio ocuparia, e um painel que encolhe
 * quando não tem dado faz a linha inteira dançar ao trocar de vigência.
 */
function SemPodio() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8">
      <span
        className="relative w-28 h-28 rounded-full bg-muted flex items-center justify-center"
        aria-hidden="true"
      >
        <ChartNoAxesCombined className="w-12 h-12 text-muted-foreground/40" strokeWidth={1.75} />
        <Search
          className="w-7 h-7 text-muted-foreground/50 absolute right-6 bottom-6"
          strokeWidth={2}
        />
      </span>
      <p className="text-base font-bold mt-5 max-w-sm leading-snug">
        Nenhum parâmetro desta vigência tem impacto apurado.
      </p>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-md leading-snug">
        Sem semântica confirmada não há preço, e sem preço não há ranking.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Últimas alterações
// ---------------------------------------------------------------------------

/**
 * As alterações em destaque desta vigência.
 *
 * Sem coluna de relógio, e é decisão de verdade e não de espaço: **todas as
 * alterações desta vigência foram apuradas na mesma comparação, no mesmo
 * instante.** Quatro horários diferentes ao lado — "hoje, 10:32", "hoje, 09:58"
 * — inventariam uma cronologia que o dado não tem. O que é verdadeiro pôr à
 * direita é o tamanho do fato: em quantos ativos ele aconteceu.
 */
function UltimasAlteracoes({
  view,
  recorte,
  onAbrir,
}: {
  view: FamiliesView;
  recorte: Recorte;
  /** Abre a conta por trás de uma linha. Ver `DetalheDaAlteracao`. */
  onAbrir: (chave: string) => void;
}) {
  const linhas = ultimasAlteracoes(view, 4);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Alterações em destaque</h2>
        <Ajuda texto="As alterações mais relevantes da vigência aberta, na mesma ordem do Acompanhamento: dinheiro primeiro, ruído por último. Clique numa linha para ver por que ela está aqui e o que mudou, veículo a veículo." />
        {/*
          "Ver todas" leva a vigência junto. Sem ela, o link abria a comparação
          mais recente da unidade padrão — e quem estava lendo julho de CAMAÇARI
          via a lista de agosto sem uma palavra dizendo que o assunto mudou.
        */}
        <Link
          href={linkDeAlteracoes({ recorte: { ...recorte, period: view.period } })}
          className="ml-auto text-[0.8125rem] font-bold text-brand hover:underline shrink-0"
        >
          Ver todas
        </Link>
      </div>

      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-4 flex-1">
          O cliente não mexeu em nada nesta vigência.
        </p>
      ) : (
        <ol className="mt-3 divide-y flex-1">
          {linhas.map((linha, indice) => {
            const Icone = ICONE_DA_LINHA[linha.tipo];
            return (
              <li key={linha.chave}>
                {/*
                  A linha inteira é o botão, e ele abre a gaveta em vez de
                  trocar de tela.

                  O link para a Planilha filtrada resolvia metade do beco: dava
                  as linhas, mas cobrava a Visão geral inteira por elas e não
                  respondia a pergunta que o destaque provoca — *por que isto
                  está aqui em cima?*. A gaveta responde as duas sem sair, com a
                  mesma disciplina dos Maiores impactos, e continua levando à
                  Planilha por dentro para quem quer as linhas mesmo.
                */}
                <button
                  type="button"
                  onClick={() => onAbrir(linha.chave)}
                  title={`Por que ${linha.titulo} está em destaque`}
                  className="w-full text-left group flex items-start gap-3 py-3.5 -mx-2 px-2 rounded-lg hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors"
                >
                  <span
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                      COR_DA_LINHA[linha.tipo],
                    )}
                  >
                    <Icone className="w-4 h-4" />
                  </span>
                  {/*
                    A ordem numerada, e não bolinha de lista: esta fila é a do
                    cockpit, e o "1." afirma que existe um primeiro — quem lê
                    precisa saber que a lista está ordenada por relevância e não
                    pela ordem em que os dados chegaram.
                  */}
                  <span className="text-sm font-bold text-muted-foreground tabular-nums shrink-0 pt-1">
                    {indice + 1}.
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug group-hover:text-brand transition-colors">
                      {linha.titulo}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                      {linha.detalhe}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground tabular-nums">
                    {linha.direita}
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 mt-1.5 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <LeiturasDeAlteracoes view={view} recorte={recorte} />
    </section>
  );
}

/**
 * As três leituras de Alterações, nomeadas onde a pergunta por elas nasce.
 *
 * A tela contava alterações e oferecia uma porta só — "Ver todas" —, que abre a
 * Planilha. As outras duas abas existiam sem que nada aqui dissesse que existem:
 * quem quisesse saber o que **nós** pedimos por chamado, ou quanto cada ativo
 * custa em cada quinzena, tinha de descobrir por conta própria que a resposta
 * mora atrás de uma aba de outra tela.
 *
 * Cada uma leva o que sabe honrar, e é `linkDeAlteracoes` quem faz esse corte:
 * a Planilha vai recortada na vigência aberta; o Impacto leva a unidade mas não
 * a vigência, porque ele põe todas as quinzenas lado a lado; Chamados não leva
 * nada, porque o export de chamados é uma população própria, sem unidade nem
 * vigência. As frases por baixo são as mesmas que rotulam as abas do outro lado
 * — o nome do lugar não pode mudar no caminho até ele.
 */
function LeiturasDeAlteracoes({
  view,
  recorte,
}: {
  view: FamiliesView;
  recorte: Recorte;
}) {
  const leituras: { href: string; titulo: string; frase: string }[] = [
    {
      href: linkDeAlteracoes({ recorte: { ...recorte, period: view.period } }),
      titulo: "Planilha",
      frase: "o que a Ambev mexeu nesta vigência",
    },
    {
      href: linkDeAlteracoes({ aba: "chamados" }),
      titulo: "Chamados",
      frase: "o que pedimos e o que voltou aplicado",
    },
    {
      href: linkDeAlteracoes({ aba: "impacto", recorte }),
      titulo: "Impacto",
      frase: "quanto cada ativo custa em cada quinzena",
    },
  ];

  return (
    <div className="mt-auto pt-4 border-t">
      <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
        Três leituras da mesma remuneração — os números de uma nunca somam com os
        da outra
      </p>
      <div className="grid sm:grid-cols-3 gap-2 mt-2.5">
        {leituras.map((leitura) => (
          <Link
            key={leitura.titulo}
            href={leitura.href}
            className="group rounded-lg border px-3 py-2 hover:border-brand hover:bg-accent/40 transition-colors"
          >
            <span className="flex items-center gap-1 text-[0.8125rem] font-bold group-hover:text-brand transition-colors">
              {leitura.titulo}
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            </span>
            <span className="block text-xs text-muted-foreground leading-snug mt-0.5">
              {leitura.frase}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Qualidade da auditoria
// ---------------------------------------------------------------------------

/**
 * O quanto se pode confiar nos números acima — dito com os números que o
 * sustentam.
 *
 * A palavra ("Alta", "Parcial") nunca aparece sozinha: vem sempre colada ao
 * percentual e à contagem de inconclusivas, porque um adjetivo é a coisa mais
 * fácil de mentir numa tela e a mais difícil de conferir.
 */
function QualidadeDaAuditoria({
  view,
  cobertura: coberturaAuditada,
  ultima,
}: {
  view: FamiliesView;
  cobertura: ReturnType<typeof cobertura>;
  ultima: ReturnType<typeof ultimaImportacao>;
}) {
  const qualidade = coberturaAuditada ? qualidadeDaCobertura(coberturaAuditada.percentual) : null;

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Qualidade da auditoria</h2>
        <Ajuda texto="Três medidas da apuração, não da remuneração: quanto das células importadas a auditoria alcança, quantas alterações ficaram sem preço, e quando a última planilha entrou." />
      </div>

      {/*
        As três medidas na mesma régua, cada uma com rótulo e nota por baixo.

        A barra e o adjetivo ("Alta", "Parcial") que ficavam abaixo saíram: o
        arco já é a figura da cobertura, e desenhá-la duas vezes na mesma altura
        dobrava o peso visual de uma medida só — a que fala da apuração — dentro
        do painel que compara as três. O adjetivo continua existindo em
        `qualidadeDaCobertura`, e é ele que dá a cor do arco.
      */}
      <div className="flex items-center gap-4 mt-6 divide-x">
        {coberturaAuditada && (
          <div className="flex flex-col items-center gap-2 pr-4 shrink-0">
            <Rosca percentual={coberturaAuditada.percentual} tom={qualidade?.tom ?? "ok"} />
            <span className="text-center">
              <span className="block text-[0.8125rem] font-semibold leading-tight">
                Cobertura auditada
              </span>
              <span className="block text-xs text-muted-foreground">das células importadas</span>
            </span>
          </div>
        )}

        <Medida
          valor={view.impact.notCalculable.toLocaleString("pt-BR")}
          rotulo="Alterações sem preço"
          nota="requerem análise"
        />

        {ultima && (
          <Medida valor={ultima.hora} rotulo="Última importação" nota={ultima.relativo} />
        )}
      </div>

      {coberturaAuditada && (
        <p className="text-xs text-muted-foreground leading-snug mt-auto pt-5">
          {coberturaAuditada.celulas.toLocaleString("pt-BR")} células conferidas em{" "}
          {coberturaAuditada.importacoes}{" "}
          {coberturaAuditada.importacoes === 1 ? "importação" : "importações"}
          {coberturaAuditada.foraDaAuditoria === 0 ? (
            <>. Toda célula que os arquivos trouxeram chegou a um destino declarado.</>
          ) : (
            <>
              ; {coberturaAuditada.foraDaAuditoria.toLocaleString("pt-BR")} ficaram fora da
              auditoria — o Balanço de massa diz quais e por quê.
            </>
          )}
        </p>
      )}
    </section>
  );
}

function Medida({
  valor,
  rotulo,
  nota,
}: {
  valor: string;
  rotulo: string;
  nota?: string;
}) {
  return (
    <div className="min-w-0 flex-1 px-2 text-center">
      <div className="text-[2rem] font-extrabold tabular-nums leading-none">{valor}</div>
      <div className="text-[0.8125rem] font-semibold leading-tight mt-2">{rotulo}</div>
      {nota && <div className="text-xs text-muted-foreground">{nota}</div>}
    </div>
  );
}

/**
 * A rosca da cobertura.
 *
 * SVG à mão, e não uma biblioteca de gráfico: é um arco, um número no meio e
 * nada mais — nem eixo, nem legenda, nem tooltip. Trazer um motor de gráficos
 * para desenhar um círculo custaria peso de página em troca de nada.
 */
function Rosca({ percentual, tom }: { percentual: number; tom: Tom }) {
  const raio = 26;
  const volta = 2 * Math.PI * raio;
  const preenchido = (Math.max(0, Math.min(100, percentual)) / 100) * volta;
  const cor =
    tom === "grave" ? "stroke-red-600" : tom === "atencao" ? "stroke-brand" : "stroke-emerald-600";

  return (
    <svg
      viewBox="0 0 64 64"
      className="w-[5.5rem] h-[5.5rem] shrink-0"
      role="img"
      aria-label={`Cobertura de ${escreverPercentual(percentual, 1)}`}
    >
      <circle cx="32" cy="32" r={raio} fill="none" strokeWidth="6" className="stroke-muted" />
      {/*
        Só o arco gira, e o giro é atributo do próprio círculo — o texto do meio
        fica de pé sem precisar de uma contra-rotação para desfazer a do pai.
      */}
      <circle
        cx="32"
        cy="32"
        r={raio}
        fill="none"
        strokeWidth="6"
        strokeLinecap="butt"
        strokeDasharray={`${preenchido} ${volta - preenchido}`}
        transform="rotate(-90 32 32)"
        className={cor}
      />
      <text
        x="32"
        y="32"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-[0.75rem] font-bold tabular-nums"
      >
        {escreverPercentual(percentual, 1)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Explorar
// ---------------------------------------------------------------------------

/**
 * As quatro portas, e por que são estas quatro.
 *
 * Elas seguem a ordem em que a pergunta aparece depois de a pessoa olhar os
 * números acima: *qual parâmetro fez isso* (Parâmetros), *em quais ativos*
 * (Veículos), *o que aqui é defeito de arquivo e não mudança de contrato*
 * (Anomalias) e *isto é normal para esta unidade?* (Comparar vigências).
 * Importações e Curadoria saíram: as duas já são alcançadas por um clique na
 * faixa de atenção quando têm o que mostrar, e uma porta que repete um caminho
 * de dois passos acima só divide a atenção.
 *
 * A cor de cada ícone é a da seção do menu a que a tela pertence — os mesmos
 * `--nav-*`. Eles hoje apontam todos para o mesmo marinho, e o vínculo continua
 * escrito assim mesmo: é ele que devolve a cor certa a cada porta no dia em que
 * as seções voltarem a ter cores próprias. O limite é o de sempre — **estas
 * cores pintam o caminho, nunca o dado**. Nenhuma diz que algo vai bem ou mal.
 */
const PORTAS: { href: string; icone: LucideIcon; titulo: string; cor: string }[] = [
  { href: "/parametros", icone: SlidersVertical, titulo: "Parâmetros", cor: "text-nav-admin" },
  {
    href: "/analise-equipamentos",
    icone: Truck,
    titulo: "Veículos",
    cor: "text-nav-inteligencia",
  },
  /*
    Anomalias abre o Acompanhamento, que é onde elas moram: o painel de
    prioridade traz o indício de troca de formato ponto a ponto, e o KPI de
    anomalias fica no resumo da mesma tela. Não há rota `/anomalias`, e
    inventá-la aqui seria pôr no atalho uma promessa que o roteador não cumpre.
  */
  { href: "/vigencia", icone: AlertTriangle, titulo: "Anomalias", cor: "text-brand" },
  {
    href: "/comparar",
    icone: TrendingUp,
    titulo: "Comparar vigências",
    cor: "text-nav-auditoria",
  },
];

/**
 * Os cartões de entrada, no tamanho que lhes cabe hoje.
 *
 * Eram sete, ocupavam a tela inteira e cada um repetia a mesma frase todo dia.
 * Com o menu lateral listando as quinze telas por seção, o papel que sobrou
 * para eles é o de atalho para as quatro que se abrem logo depois de olhar os
 * números — e atalho não precisa de descrição.
 */
function Explorar() {
  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <h2 className="text-base font-bold">Explorar</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 flex-1">
        {PORTAS.map((porta) => (
          <Link
            key={porta.href}
            href={porta.href}
            className="group rounded-xl border p-4 flex flex-col min-h-32 hover:border-brand hover:bg-accent/40 transition-colors"
          >
            <porta.icone className={cn("w-6 h-6 shrink-0", porta.cor)} strokeWidth={2} />
            <span className="mt-auto pt-6 flex items-end justify-between gap-2">
              <span className="text-sm font-semibold leading-snug group-hover:text-brand transition-colors">
                {porta.titulo}
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// O rodapé e o banco vazio
// ---------------------------------------------------------------------------

/**
 * A promessa que o produto inteiro existe para cumprir, no pé da primeira tela.
 *
 * Ela fica aqui e não no topo de propósito: é a frase que se lê depois de olhar
 * os números, quando a pergunta que aparece é "de onde saiu isso?". O link leva
 * ao Balanço de massa, que é onde a resposta é verificável — e não a um texto
 * que repetiria a promessa com outras palavras.
 */
function Rodape() {
  return (
    <aside className={cn(CARTAO, "border-l-[6px] border-l-emerald-600 overflow-hidden")}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
        <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">Dados rastreáveis até a origem</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Nenhum valor desta tela é estimativa. Cada número volta à célula da planilha
            importada, e o que não pôde ser calculado aparece dito — nunca arredondado para
            zero.
          </p>
        </div>
        <Link
          href="/balanco-massa"
          className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:underline shrink-0 inline-flex items-center gap-1"
        >
          Saiba como funciona
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </aside>
  );
}

/** Banco sem vigência nenhuma: a tela diz o que fazer, e não finge um painel. */
function BancoVazio() {
  return (
    <section className={cn(CARTAO, "px-8 py-10 text-center")}>
      <CloudDownload className="w-10 h-10 text-brand mx-auto" strokeWidth={1.75} />
      <h2 className="text-xl font-bold mt-4">Nenhuma vigência importada ainda</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
        Esta tela mostra o impacto de uma vigência sobre a anterior. Enquanto a primeira planilha
        do Freightech não entrar, não há o que comparar — e um painel com zeros diria que nada
        mudou, quando a verdade é que nada foi medido.
      </p>
      <Link
        href="/importacoes"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-6 py-3 text-[0.8125rem] font-bold uppercase tracking-wide hover:bg-brand-dark transition-colors"
      >
        Enviar a primeira planilha
        <ChevronRight className="w-4 h-4" />
      </Link>
    </section>
  );
}
