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
  participacao,
  partesDoImpacto,
  pontosDeAtencao,
  qualidadeDaCobertura,
  ultimaImportacao,
  ultimasAlteracoes,
  variacao,
  vigenciaAnterior,
  type ExecucaoDeImportacao,
  type LinhaDeAlteracao,
  type PontoDeAtencao,
  type Tom,
} from "@/lib/visao-geral";
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
 * Canto arredondado e sombra baixa, contra o cartão quase reto que o resto do
 * produto usa (`--radius: 0.25rem`). A diferença é deliberada e local: a Visão
 * geral é a única tela feita de blocos que se leem em paralelo — cinco números,
 * uma faixa, quatro painéis —, e a borda arredondada é o que separa um bloco do
 * outro sobre o cinza da página sem precisar de mais linha. Nas telas de tabela,
 * onde a régua reta alinha coluna com coluna, o canto continua o do Freightech.
 *
 * Vale como uma decisão só, escrita num lugar só: se um dia a casca inteira for
 * arredondada, é esta constante que some.
 */
const CARTAO = "bg-card border rounded-2xl shadow-sm";
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
            />

            <Atencao
              pontos={pontosDeAtencao(view, ranking, integridadeDosDados)}
            />

            {!view.complete && (
              <div className="flex gap-3 rounded-2xl border border-amber-400 bg-amber-50 px-5 py-4 text-sm text-amber-900">
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
              <MaioresImpactos ranking={ranking} period={view.period} />
              <UltimasAlteracoes view={view} />
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
                      className={cn(periodo.date === view.period && "font-bold text-brand-red")}
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
  "flex items-center gap-2 rounded-lg border border-brand-red bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand-red hover:bg-accent transition-colors";

/** O nome da unidade; sem escopo cadastrado sobra o rótulo que o servidor montou. */
function nomeDaUnidade(contexto: SeriesContext): string {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? contexto.label;
}

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
 */
function Indicadores({
  view,
  anterior,
  cobertura: coberturaAuditada,
}: {
  view: FamiliesView;
  anterior: GroupedView | null;
  cobertura: ReturnType<typeof cobertura>;
}) {
  const impactos = impactosDaVigencia(view);
  const frota = frotaTotal(view);
  const veiculos = participacao(view.totals.vehiclesTouched, frota);
  const semPreco = participacao(view.impact.notCalculable, view.totals.changes);
  const variacaoDeMudancas = variacao(view.totals.changes, anterior?.totals.changes);
  const qualidade = coberturaAuditada ? qualidadeDaCobertura(coberturaAuditada.percentual) : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Indicador
        icone={ReceiptText}
        titulo="Impacto líquido"
        ajuda="A diferença de remuneração apurada nesta vigência, por periodicidade. R$/mês e R$/ano nunca são somados: são grandezas diferentes."
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
        titulo="Alterações detectadas"
        ajuda="Cada valor que mudou entre a vigência anterior e esta, contado uma vez por ativo e por parâmetro."
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
        <Nota texto={`${view.totals.groups} pontos da remuneração tocados`} />
      </Indicador>

      <Indicador
        icone={Truck}
        titulo="Veículos afetados"
        ajuda="Ativos com pelo menos uma alteração nesta vigência, sobre a frota que a vigência entregou."
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
      >
        <ValorGrande texto={view.impact.notCalculable.toLocaleString("pt-BR")} />
        {semPreco !== null && <Nota texto={`${escreverPercentual(semPreco)} das alterações`} />}
      </Indicador>

      <Indicador
        icone={ShieldCheck}
        titulo="Cobertura auditada"
        ajuda="Das células que as planilhas trouxeram, quanto a auditoria alcança: tudo menos a perda declarada e o resíduo sem destino. É percentual de célula, não de dinheiro."
        tom="ok"
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
 */
function Indicador({
  icone: Icone,
  titulo,
  ajuda,
  tom,
  children,
}: {
  icone: LucideIcon;
  titulo: string;
  ajuda: string;
  tom?: "marca" | "ok";
  children: React.ReactNode;
}) {
  return (
    <section className={cn(CARTAO, "p-5 flex flex-col")}>
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
        <Ajuda texto={ajuda} />
      </div>
      <div className="mt-5">{children}</div>
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
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
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
          tom === "atencao" && "bg-brand",
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
  atencao: "bg-brand",
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
          <span className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shrink-0">
            <AlertTriangle className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
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
 */
function MaioresImpactos({
  ranking,
  period,
}: {
  ranking: ReturnType<typeof maioresImpactos>;
  period: string;
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
        <Ajuda texto="Os parâmetros que mais mexeram na remuneração desta vigência. O ranking acontece dentro de uma periodicidade — nunca entre periodicidades diferentes." />
      </div>

      {ranking === null ? (
        <SemPodio />
      ) : (
        <>
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
        </>
      )}

      <Link
        href={`/parametros?period=${period}`}
        className="mt-5 self-start inline-flex items-center gap-1.5 rounded-lg border border-brand-red px-5 py-2.5 text-sm font-bold text-brand-red hover:bg-accent transition-colors"
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

const ICONE_DA_LINHA: Record<LinhaDeAlteracao["tipo"], LucideIcon> = {
  queda: ArrowDownRight,
  alta: ArrowUpRight,
  "sem-preco": CircleHelp,
  neutro: Info,
};

const COR_DA_LINHA: Record<LinhaDeAlteracao["tipo"], string> = {
  queda: "text-red-700 bg-red-50",
  alta: "text-emerald-700 bg-emerald-50",
  "sem-preco": "text-brand bg-accent",
  neutro: "text-muted-foreground bg-muted",
};

/**
 * As alterações em destaque desta vigência.
 *
 * Sem coluna de relógio, e é decisão de verdade e não de espaço: **todas as
 * alterações desta vigência foram apuradas na mesma comparação, no mesmo
 * instante.** Quatro horários diferentes ao lado — "hoje, 10:32", "hoje, 09:58"
 * — inventariam uma cronologia que o dado não tem. O que é verdadeiro pôr à
 * direita é o tamanho do fato: em quantos ativos ele aconteceu.
 */
function UltimasAlteracoes({ view }: { view: FamiliesView }) {
  const linhas = ultimasAlteracoes(view);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Alterações em destaque</h2>
        <Ajuda texto="As alterações mais relevantes da vigência aberta, na mesma ordem do Acompanhamento: dinheiro primeiro, ruído por último." />
        <Link
          href="/alteracoes"
          className="ml-auto text-[0.8125rem] font-bold text-brand-red hover:underline shrink-0"
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
              <li key={linha.chave} className="flex items-start gap-3 py-3.5">
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
                  <span className="block text-sm font-semibold leading-snug">{linha.titulo}</span>
                  <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                    {linha.detalhe}
                  </span>
                </span>
                <span className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground tabular-nums">
                  {linha.direita}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
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
 * cinco `--nav-*`. É a única cor além de laranja e vermelho que este produto
 * usa, e o limite dela continua o mesmo: **ela pinta o caminho, nunca o dado**.
 * Nenhuma delas diz que algo vai bem ou mal.
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
  { href: "/vigencia", icone: AlertTriangle, titulo: "Anomalias", cor: "text-brand-red" },
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
          className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand-red hover:underline shrink-0 inline-flex items-center gap-1"
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
