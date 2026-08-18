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
  GitCompareArrows,
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
import { cn } from "@/lib/utils";
import { periodicitySuffix } from "@/lib/format";
import {
  cobertura,
  escreverImpacto,
  escreverPercentual,
  escreverVariacao,
  frotaTotal,
  impactosDaVigencia,
  integridade,
  maioresImpactos,
  maiorAbrangencia,
  parametrosMaisAlterados,
  participacao,
  partesDoImpacto,
  pontosDeAtencao,
  qualidadeDaCobertura,
  ultimaImportacao,
  variacao,
  vigenciaAnterior,
  type ExecucaoDeImportacao,
  type LinhaDeParametro,
  type PontoDeAtencao,
  type Tom,
} from "@/lib/visao-geral";
import {
  lerRecorte,
  linkDeAlteracoes,
  nomeDaUnidade,
  type Recorte,
} from "@/lib/recorte";
import type { FamiliesView, GroupedView, SeriesContext } from "@/components/inicio/types";
import type { BalancoResumo } from "@/components/balanco/tipos";

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

    É o que faz "Trocar unidade" e "Trocar vigência" funcionarem como o resto do
    produto: o endereço descreve o que está na tela, dá para mandar para alguém,
    e o botão de voltar do navegador desfaz a troca. Os três parâmetros são os
    mesmos que Parâmetros usa, de propósito — sair daqui para lá leva o recorte
    junto.
  */
  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  const sufixo = consulta.toString() ? `?${consulta}` : "";

  const vigencia = useQuery({
    queryKey: ["families", "visao-geral", consulta.toString()],
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

  const view = vigencia.data ?? null;
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

  const contextos = useQuery({
    queryKey: ["contexts"],
    queryFn: () => fetchJson<SeriesContext[]>("/contexts").catch(() => []),
    retry: false,
    staleTime: 60_000,
  });

  const coberturaAuditada = useMemo(() => cobertura(balancos.data), [balancos.data]);
  const integridadeDosDados = useMemo(() => integridade(balancos.data), [balancos.data]);
  const ultima = useMemo(() => ultimaImportacao(importacoes.data), [importacoes.data]);
  const ranking = useMemo(() => maioresImpactos(view?.summary), [view]);

  /*
    O recorte que sai daqui rumo às Alterações.

    Sai do endereço, e não do estado da tela, porque é o mesmo que os cartões de
    troca escrevem lá em cima — o link herda a unidade e a vigência que estão à
    vista. A vigência é reposta com a que o servidor de fato respondeu (dentro de
    `pontosDeAtencao` e `parametrosMaisAlterados`): quem abriu sem escolher nada tem a
    URL vazia e mesmo assim está lendo uma vigência, e mandá-la vazia faria o
    outro lado escolher de novo, por conta própria, e possivelmente outra.
  */
  const recorte = lerRecorte(search);

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `/?${texto}` : "/");
  };

  return (
    <Layout>
      <Cabecalho
        view={view}
        ultima={ultima}
        contextos={contextos.data ?? []}
        onTrocar={trocarPara}
      />

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {vigencia.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando a vigência…</p>
        )}

        {vigencia.error && (
          <ApiErrorNotice error={vigencia.error} what="Não foi possível montar a visão geral." />
        )}

        {!vigencia.isLoading && !vigencia.error && view === null && <BancoVazio />}

        {view && (
          <>
            <Indicadores
              view={view}
              anterior={comparacao.data ?? null}
              cobertura={coberturaAuditada}
              recorte={recorte}
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
                view={view}
                period={view.period}
                recorte={recorte}
              />
              <ParametrosMaisAlterados view={view} recorte={recorte} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <QualidadeDaAuditoria
                view={view}
                cobertura={coberturaAuditada}
                ultima={ultima}
              />
              <Explorar />
            </div>
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
  ultima,
  contextos,
  onTrocar,
}: {
  view: FamiliesView | null;
  ultima: ReturnType<typeof ultimaImportacao>;
  contextos: SeriesContext[];
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const partes = [
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
            Visão geral{unidade ? ` — ${unidade}` : ""}
          </h1>
          {partes.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1.5">{partes.join(" · ")}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {contextos.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
                <GitCompareArrows className="w-4 h-4" />
                Trocar unidade
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {contextos.length} unidades com vigência importada
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {contextos.map((contexto) => (
                  <DropdownMenuItem
                    key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
                    onSelect={() =>
                      /*
                        A vigência sai da URL junto com a unidade: a data de uma
                        unidade não existe necessariamente na outra, e insistir
                        nela levaria a uma tela vazia com aparência de defeito.
                      */
                      onTrocar({
                        scopeHash: contexto.scopeHash,
                        canal: contexto.channel,
                        period: null,
                      })
                    }
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-semibold">{nomeDaUnidade(contexto)}</span>
                    <span className="text-xs text-muted-foreground">
                      {contexto.channel ?? "sem canal no rótulo"} · {contexto.periods}{" "}
                      {contexto.periods === 1 ? "vigência" : "vigências"}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {view && view.periods.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
                <CalendarDays className="w-4 h-4" />
                Trocar vigência
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {view.periods.length} vigências no histórico
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {[...view.periods]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((periodo) => (
                    <DropdownMenuItem
                      key={periodo.date}
                      onSelect={() => onTrocar({ period: periodo.date })}
                      className={cn(periodo.date === view.period && "font-bold text-brand")}
                    >
                      {periodo.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Os dois botões de troca do cabeçalho, com a mesma casca.
 *
 * Contorno vermelho e fundo branco: são as duas únicas ações desta tela, e o
 * laranja cheio está reservado para a ação que cria trabalho — "Enviar a
 * primeira planilha", no banco vazio. Trocar de unidade e trocar de vigência
 * não mudam nada no banco; mudam o recorte do que se está lendo.
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
}: {
  view: FamiliesView;
  anterior: GroupedView | null;
  cobertura: ReturnType<typeof cobertura>;
  recorte: Recorte;
}) {
  const impactos = impactosDaVigencia(view);
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
        ajuda="A diferença de remuneração apurada nesta vigência, por periodicidade. R$/mês e R$/ano nunca são somados: são grandezas diferentes."
        /*
          Sem impacto apurado não há lista para abrir: o link levaria a uma tela
          filtrada em "com impacto" que responderia com zero linhas, que é o
          mesmo que um beco com aparência de erro.
        */
        href={
          impactos.length === 0
            ? undefined
            : linkDeAlteracoes({
                recorte: daVigencia,
                filtros: { impactConfidence: "CALCULATED" },
              })
        }
        abrir="ver as alterações que somam este valor"
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
        titulo="Ocorrências detectadas"
        ajuda="Tudo o que o motor apurou entre a vigência anterior e esta, nos quatro eixos: valor que mudou, ativo que entrou ou saiu, coluna que apareceu ou sumiu, e significado de coluna que mudou. A aba Planilha mostra só o primeiro eixo, sob o nome 'Valores alterados' — por isso os dois números podem não coincidir, e por isso as parcelas estão logo abaixo."
        href={linkDeAlteracoes({ recorte: daVigencia })}
        abrir="ver a lista completa das alterações"
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
        <Decomposicao totals={view.totals} />
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
  abrir,
  children,
}: {
  icone: LucideIcon;
  titulo: string;
  ajuda: string;
  tom?: "marca" | "ok";
  /** Para onde o número leva. Sem destino, o cartão continua só cartão. */
  href?: string;
  /** O que a pessoa vai encontrar lá — o rodapé do cartão, e o rótulo do link. */
  abrir?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        CARTAO,
        "p-5 flex flex-col",
        href && "relative group focus-within:border-brand hover:border-brand transition-colors",
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
        {href && (
          <ChevronRight
            className="relative z-10 w-4 h-4 shrink-0 mt-0.5 text-muted-foreground group-hover:text-brand transition-colors"
            aria-hidden
          />
        )}
      </div>
      <div className="mt-5">{children}</div>
      {/*
        O link cobre o cartão inteiro (`absolute inset-0`) em vez de embrulhá-lo:
        assim o alvo do clique é o cartão todo — que é o que o olho vê como um
        botão — sem que o ⓘ e o texto do número virem filhos de uma âncora.

        O rótulo acessível diz o destino por extenso, e não "saiba mais": quem
        navega por leitor de tela ouve quatro links seguidos e precisa distinguir
        os quatro. É a mesma frase que a seta carrega no `title`.
      */}
      {href && (
        <Link
          href={href}
          aria-label={`${titulo}: ${abrir ?? "abrir"}`}
          title={abrir}
          className="absolute inset-0 rounded-xl"
        />
      )}
    </section>
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

/**
 * As parcelas do número de ocorrências, por eixo do motor.
 *
 * **Existe por causa de uma pergunta que a tela não sabia responder.** A aba
 * Planilha mostrava 244 e esta mostrava 749 no mesmo período, e as duas estavam
 * certas: lá o rótulo é "Valores alterados" e conta só o eixo `SOURCE_CHANGE`;
 * aqui é o total dos quatro eixos. Nada em nenhuma das duas telas dizia isso, e
 * dois números seus que não se explicam gastam mais confiança do que qualquer
 * número errado — porque quem lê não descobre em qual acreditar.
 *
 * **A primeira parcela é sempre dita, mesmo valendo zero.** Ela é a que a outra
 * tela mostra; escondê-la quando não há valor alterado devolveria exatamente o
 * silêncio que este componente existe para acabar. As outras três aparecem
 * quando existem: uma linha de zeros ensina a não ler a linha.
 *
 * `outras` é a válvula. Se o motor passar a emitir um eixo que este código não
 * nomeia, ele aparece como "outros" em vez de fazer a soma não fechar em
 * silêncio — que é a única forma de erro que este cartão não pode ter, já que a
 * sua razão de ser é justamente mostrar que a conta fecha.
 */
function Decomposicao({ totals }: { totals: FamiliesView["totals"] }) {
  const { byCategory } = totals;
  const partes: string[] = [
    `${byCategory.valueChanges.toLocaleString("pt-BR")} ${
      byCategory.valueChanges === 1 ? "valor alterado" : "valores alterados"
    }`,
  ];
  if (byCategory.fleetChanges > 0) {
    partes.push(
      `${byCategory.fleetChanges.toLocaleString("pt-BR")} ${
        byCategory.fleetChanges === 1
          ? "ativo entrou/saiu"
          : "ativos entraram/saíram"
      }`,
    );
  }
  if (byCategory.layoutChanges > 0) {
    partes.push(
      `${byCategory.layoutChanges.toLocaleString("pt-BR")} ${
        byCategory.layoutChanges === 1 ? "coluna" : "colunas"
      }`,
    );
  }
  if (byCategory.semanticsChanges > 0) {
    partes.push(
      `${byCategory.semanticsChanges.toLocaleString("pt-BR")} de semântica`,
    );
  }
  if (byCategory.outras > 0) {
    partes.push(`${byCategory.outras.toLocaleString("pt-BR")} de outro eixo`);
  }

  return (
    <p className="text-xs text-muted-foreground mt-2.5 leading-snug">
      {partes.join(" · ")}
      {partes.length === 1 && (
        /*
          Com uma parcela só, a soma é o próprio total e a linha pareceria uma
          repetição do número grande. Dizer que os outros três eixos ficaram em
          zero é o que a transforma em informação: a vigência não mexeu na
          frota, no layout nem na semântica.
        */
        <span className="block mt-0.5">
          nenhum ativo entrou ou saiu, nenhuma coluna e nenhuma semântica mudou
        </span>
      )}
    </p>
  );
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
 * **Sem impacto apurado, o painel troca de assunto — e diz que trocou.** Antes
 * ele mostrava um vazio ilustrado, honesto e inútil: a vigência com 20
 * parâmetros mexidos e nenhuma semântica confirmada é justamente a que tem mais
 * o que olhar, e o lugar mais nobre da tela ficava dizendo que não havia nada.
 * Agora ele mostra "Maior abrangência", que é a única ordenação que aquele dado
 * sustenta.
 *
 * O que **não** pode acontecer é a troca ser silenciosa. Abrangência não é
 * dinheiro: "toda a frota" e "R$ 18 mil/mês" respondem perguntas diferentes, e
 * um alcance total pode valer zero. Por isso o `<h2>` muda junto com o conteúdo
 * — nenhuma linha de abrangência aparece sob o título "Maiores impactos" — e a
 * primeira coisa dentro do painel é a frase que diz por que o outro ranking não
 * está ali. Um painel que troca de métrica mantendo o título é pior do que o
 * vazio que ele substituiu: quem passa o olho lê percentual de frota como
 * percentual de custo.
 */
function MaioresImpactos({
  ranking,
  view,
  period,
  recorte,
}: {
  ranking: ReturnType<typeof maioresImpactos>;
  view: FamiliesView;
  period: string;
  recorte: Recorte;
}) {
  if (ranking === null) {
    return <MaiorAbrangencia view={view} recorte={recorte} />;
  }

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Maiores impactos</h2>
        <span className="text-xs font-semibold text-muted-foreground">
          em R$
          {periodicitySuffix(ranking.periodicity)}
        </span>
        <Ajuda texto="Os parâmetros que mais mexeram na remuneração desta vigência. O ranking acontece dentro de uma periodicidade — nunca entre periodicidades diferentes." />
      </div>

      <ol className="mt-4 space-y-3.5 flex-1">
        {ranking.linhas.map((linha, indice) => (
          <li key={linha.key} className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full border text-[0.6875rem] font-bold flex items-center justify-center shrink-0 text-muted-foreground">
              {indice + 1}
            </span>
            <span className="w-40 shrink-0 min-w-0">
              <span className="block text-sm font-semibold truncate" title={linha.name}>
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
              {escreverImpacto({ periodicity: ranking.periodicity, amount: linha.amount })}
            </span>
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
 * O painel que ocupa o lugar do pódio quando não há dinheiro apurado.
 *
 * **Não é um estado vazio, e não é o pódio com outra régua.** É outra métrica,
 * com outro título, e as duas coisas são deliberadas.
 *
 * A primeira frase continua sendo a que o vazio ilustrado dizia — "nenhum
 * parâmetro desta vigência tem impacto apurado", seguida da cadeia que produziu
 * o fato — porque quem abre precisa saber que o ranking de dinheiro não sumiu
 * por defeito da tela. Ela vem **antes** da lista, e não depois, para que
 * ninguém leia os percentuais de frota achando que são a resposta financeira
 * que veio procurar.
 *
 * A régua é a proporção da frota alcançada, e a barra diz isso e só isso. Ela
 * é cinza-azulada de propósito: vermelho e verde nesta tela significam dinheiro
 * saindo e entrando, e pintar alcance com as cores do impacto seria dizer com
 * cor aquilo que o título acabou de negar com palavra.
 *
 * O botão do rodapé muda junto. "Ver todos os impactos" numa vigência sem
 * impacto nenhum leva a uma tela que não tem o que mostrar; aqui ele leva à
 * curadoria, que é onde a corrente começa e o único lugar em que alguém pode
 * destravar o ranking que está faltando.
 */
function MaiorAbrangencia({
  view,
  recorte,
}: {
  view: FamiliesView;
  recorte: Recorte;
}) {
  const linhas = maiorAbrangencia(view, 3, recorte);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Maior abrangência</h2>
        <span className="text-xs font-semibold text-muted-foreground">
          em % da frota
        </span>
        <Ajuda texto="Em que proporção da frota cada parâmetro mudou. É alcance, não dinheiro: um parâmetro que mudou em toda a frota pode custar zero, e este ranking não diz nada sobre valor." />
      </div>

      <p className="text-sm mt-3 leading-snug">
        <strong className="font-bold">
          Nenhum parâmetro desta vigência tem impacto apurado.
        </strong>{" "}
        <span className="text-muted-foreground">
          Sem semântica confirmada não há preço, e sem preço não há ranking de
          dinheiro. Enquanto isso, o que este painel pode ordenar é o alcance.
        </span>
      </p>

      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-4 flex-1">
          O cliente não mexeu em nada nesta vigência.
        </p>
      ) : (
        <ol className="mt-4 space-y-3.5 flex-1">
          {linhas.map((linha, indice) => (
            <li key={linha.key}>
              <Link
                href={linha.href}
                className="group flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-lg hover:bg-accent/40 transition-colors"
              >
                <span className="w-6 h-6 rounded-full border text-[0.6875rem] font-bold flex items-center justify-center shrink-0 text-muted-foreground">
                  {indice + 1}
                </span>
                <span className="w-40 shrink-0 min-w-0">
                  <span
                    className="block text-sm font-semibold truncate group-hover:text-brand transition-colors"
                    title={linha.name}
                  >
                    {linha.name}
                  </span>
                  <span className="block text-[0.6875rem] text-muted-foreground truncate">
                    {linha.equipment}
                  </span>
                </span>
                <span className="flex-1 h-2.5 bg-muted overflow-hidden min-w-8">
                  <span
                    className="block h-full bg-slate-500"
                    style={{
                      width: `${Math.max(2, linha.percent ?? 0)}%`,
                    }}
                  />
                </span>
                {/*
                  Os dois números juntos, e o percentual nunca sozinho: "100%"
                  sem o "62 de 62" ao lado esconde se a frota tem sessenta ativos
                  ou dois, e um alcance total de dois ativos não é a mesma
                  notícia.
                */}
                <span className="shrink-0 text-right w-28">
                  <span className="block text-sm font-bold tabular-nums">
                    {linha.percent === null
                      ? "—"
                      : escreverPercentual(linha.percent)}
                  </span>
                  <span className="block text-[0.6875rem] text-muted-foreground tabular-nums">
                    {linha.vehicles.toLocaleString("pt-BR")} de{" "}
                    {linha.fleet.toLocaleString("pt-BR")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <Link
        href="/curadoria"
        className="mt-5 self-start inline-flex items-center gap-1.5 rounded-lg border border-brand px-5 py-2.5 text-sm font-bold text-brand hover:bg-accent transition-colors"
      >
        Confirmar semântica na Curadoria
        <ChevronRight className="w-4 h-4" />
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Parâmetros mais alterados
// ---------------------------------------------------------------------------

const ICONE_DA_LINHA: Record<LinhaDeParametro["tipo"], LucideIcon> = {
  queda: ArrowDownRight,
  alta: ArrowUpRight,
  "sem-preco": CircleHelp,
  neutro: Info,
};

const COR_DA_LINHA: Record<LinhaDeParametro["tipo"], string> = {
  queda: "text-red-700 bg-red-50",
  alta: "text-emerald-700 bg-emerald-50",
  "sem-preco": "text-warning bg-warning/10",
  neutro: "text-muted-foreground bg-muted",
};

/**
 * Os pontos da remuneração que mais mudaram nesta vigência.
 *
 * **A ordem é a coluna que está à vista.** Antes este painel mostrava a fila do
 * cockpit — criticidade, depois abrangência, depois magnitude — sob o título
 * "Alterações em destaque", e trazia à direita a contagem de *ativos*. Quem lia
 * procurava "o que mudou mais" e recebia uma ordem que nenhum número visível
 * explicava: o primeiro item podia ter menos alterações que o terceiro, e a
 * razão morava num cálculo de criticidade que a tela não mostrava. Uma lista
 * ordenada por algo invisível é uma lista que se pede para o leitor aceitar.
 *
 * **As duas grandezas ficam lado a lado porque não são a mesma.** "62
 * alterações · 62 ativos" é uma coluna que mexeu uma vez em toda a frota; "62
 * alterações · 3 ativos" é um punhado de ativos com muita coisa mexida. Mostrar
 * só uma das duas apagaria a diferença entre duas investigações que não se
 * parecem.
 *
 * Sem coluna de relógio, e é decisão de verdade e não de espaço: **todas as
 * alterações desta vigência foram apuradas na mesma comparação, no mesmo
 * instante.** Quatro horários diferentes ao lado — "hoje, 10:32", "hoje, 09:58"
 * — inventariam uma cronologia que o dado não tem.
 *
 * A fila do cockpit não sumiu do produto: ela continua sendo a ordem do
 * Acompanhamento, que é a tela de agir. Esta é a tela de olhar, e a pergunta
 * dela é outra.
 */
function ParametrosMaisAlterados({
  view,
  recorte,
}: {
  view: FamiliesView;
  recorte: Recorte;
}) {
  const linhas = parametrosMaisAlterados(view, 4, recorte);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Parâmetros mais alterados</h2>
        <Ajuda texto="Os pontos da remuneração com mais linhas de alteração nesta vigência, do maior para o menor. Alterações e ativos são grandezas diferentes e aparecem separados: um mesmo ativo pode ter várias alterações no mesmo ponto." />
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
                  A linha inteira é o link, e o destino é o recorte dela: a
                  vigência aberta, o parâmetro e o equipamento de que ela fala.
                  Era o beco mais visível desta tela — quatro alterações
                  anunciadas por nome, e nenhuma delas abria as suas linhas.
                */}
                <Link
                  href={linha.href}
                  className="group flex items-start gap-3 py-3.5 -mx-2 px-2 rounded-lg hover:bg-accent/40 transition-colors"
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
                    A ordem numerada, e não bolinha de lista: o "1." afirma que
                    existe um primeiro — quem lê precisa saber que a lista está
                    ordenada, e não na ordem em que os dados chegaram. Aqui o
                    critério da ordem é a própria coluna da direita, o que
                    dispensa acreditar na numeração.
                  */}
                  <span className="text-sm font-bold text-muted-foreground tabular-nums shrink-0 pt-1">
                    {indice + 1}.
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug group-hover:text-brand transition-colors">
                      {linha.titulo}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                      {linha.equipamento}
                    </span>
                  </span>
                  {/*
                    As duas contagens empilhadas, a que ordena em cima e em
                    corpo maior. Uma ao lado da outra na mesma linha, "62 · 62"
                    vira um par sem rótulo, e foi assim que a versão anterior
                    deste painel conseguiu mostrar ativos onde todo mundo lia
                    alterações.
                  */}
                  <span className="shrink-0 rounded-lg border px-2.5 py-1.5 text-right tabular-nums">
                    <span className="block text-sm font-bold">
                      {linha.alteracoes.toLocaleString("pt-BR")}{" "}
                      <span className="text-[0.6875rem] font-normal text-muted-foreground">
                        {linha.alteracoes === 1 ? "alteração" : "alterações"}
                      </span>
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {linha.veiculos.toLocaleString("pt-BR")}{" "}
                      {linha.veiculos === 1 ? "ativo" : "ativos"}
                    </span>
                  </span>
                </Link>
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
