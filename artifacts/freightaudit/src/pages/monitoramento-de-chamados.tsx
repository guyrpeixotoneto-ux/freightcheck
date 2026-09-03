import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Headset,
  Layers,
  MapPin,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { AbaBotao, MetricCard } from "@/components/changes/cartoes";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Paginacao } from "@/components/ui/paginacao";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReguaDeDias } from "@/components/monitoramento/regua-de-dias";
import { ResumoDoDiaPainel } from "@/components/monitoramento/resumo-do-dia";
import { ListaDeMovimentacoes } from "@/components/monitoramento/lista-de-movimentacoes";
import { cn } from "@/lib/utils";
import {
  contextoAberto,
  unidadeDe,
  useContextosDaCasca,
} from "@/lib/contextos";
import { visaoGeralAtiva } from "@/lib/navegacao-do-escopo";
import {
  recorteDeChamados,
  serieDaUnidade,
  type RecorteDeChamados,
} from "@/lib/serie-da-unidade";
import {
  ABAS,
  ROTULO_DA_ABA,
  ROTULO_DO_TIPO,
  contagemDaAba,
  diaPorExtenso,
  fraseDoDia,
  hojeNaOperacao,
  horaLegivel,
  progressoDoDia,
  SEM_SERIE,
  useMovimentacoes,
  useResumoDoDia,
  useReguaDeDias,
  useRevisao,
  useSeries,
  type Aba,
  type FiltrosDaTela,
  type Movimentacao,
} from "@/lib/monitoramento-de-chamados";

/**
 * MONITORAMENTO DE CHAMADOS.
 *
 * Os chamados da Ambev entram por importação (`/importacoes?secao=chamados`) e
 * a aba Chamados mostra a fila de **um** envio. Esta tela responde a outra
 * pergunta, que é a que se faz todo dia: **o que mudou desde ontem, e o que
 * disso eu ainda não olhei.**
 *
 * ---------------------------------------------------------------------------
 * O que manda no desenho
 * ---------------------------------------------------------------------------
 *
 * 1. **A régua é a data da importação**, no fuso da operação. Clicar em 02/09 é
 *    pedir as movimentações que as importações daquele dia produziram — não os
 *    chamados abertos naquele dia, que é outra data e outra pergunta.
 *
 * 2. **A unidade da tela é a movimentação**, e uma movimentação é *o chamado que
 *    se mexeu num dia*. Um chamado com três campos alterados é uma linha com
 *    três diferenças; um que se mexeu três vezes hoje é uma linha com três
 *    passos. É o que faz "70 movimentações" querer dizer 70 chamados.
 *
 * 3. **O antes → depois fica na linha.** Escondê-lo atrás de um clique
 *    transformaria revisar setenta movimentações em setenta cliques.
 *
 * 4. **Nada é revisado pela importação.** O selo de revisão só aparece depois de
 *    alguém clicar, e a tela sempre diz quem clicou.
 *
 * A tela abre em três consultas — régua, dia, primeira página —, e nenhuma delas
 * compara nada: o motor já comparou na importação. É o que permite esta ser a
 * página mais acessada do produto sem ser a mais cara.
 *
 * O estado que precisa sobreviver a ir e voltar mora na URL — o dia, a série, a
 * aba —, como as vigências das outras telas e pelo mesmo motivo: um link para
 * "02/09, não revisados" tem de abrir em 02/09, não revisados.
 *
 * ---------------------------------------------------------------------------
 * A unidade é a da lateral, e não a de um seletor só desta tela
 * ---------------------------------------------------------------------------
 *
 * A tela recorta por **série** — a unidade que o export da Ambev nomeia —, e
 * durante um tempo esse recorte só existia aqui dentro: a lateral escrevia
 * PERNAMBUCO e a tela somava as unidades todas, e trocar de unidade na lateral
 * jogava para Parâmetros, porque a tela estava fora de
 * `TELAS_QUE_HONRAM_ESCOPO`. A reclamação, nas palavras de quem a fez: *"eu
 * mudo de PERNAMBUCO para CAMAÇARI e muda o módulo, mas eu quero ver justamente
 * os chamados que importei de Camaçari"*.
 *
 * Agora a unidade aberta na lateral **é** o recorte, e quem casa os dois
 * vocabulários é `lib/serie-da-unidade.ts`. As três consequências, todas
 * visíveis em tela:
 *
 * 1. **Trocar de unidade na lateral não sai daqui** — troca a série, mantém o
 *    dia, e a régua e a lista voltam recortadas.
 * 2. **A unidade sem envio de chamados diz isso** em vez de mostrar o acervo
 *    inteiro embaixo do nome dela. É o mesmo desencontro que a Cobertura de
 *    dados tinha, e a mesma correção.
 * 3. **A soma continua existindo, como escolha**: é a Visão Geral da lateral,
 *    que aqui é `visaoGeral=1` e nada mais — não é o que sobra de não ter
 *    escolhido.
 *
 * O seletor da própria tela continua, porque há série que a lateral não alcança
 * — a do envio **sem unidade no arquivo**, e a da unidade que mandou chamados
 * sem nunca ter mandado vigência. Escolher nele escreve `serie` na URL, que
 * vence a lateral; quando os dois discordam, a tela diz qual está valendo.
 */

const POR_PAGINA = 25;

export default function MonitoramentoDeChamados() {
  const [pathname, navegar] = useLocation();
  const busca = useSearch();
  const parametros = useMemo(() => new URLSearchParams(busca), [busca]);

  const hoje = hojeNaOperacao();
  const dia = parametros.get("dia") ?? hoje;
  const fimDaRegua = parametros.get("regua") ?? hoje;
  const serieBruta = parametros.get("serie");
  const aba = ((ABAS as readonly string[]).includes(parametros.get("aba") ?? "")
    ? parametros.get("aba")
    : "TODOS") as Aba;

  const [pagina, setPagina] = useState(1);
  const [filtros, setFiltros] = useState<FiltrosDaTela>({});
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set());

  const trocar = (mudancas: Record<string, string | null>) => {
    const proximos = new URLSearchParams(parametros);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proximos.delete(chave);
      else proximos.set(chave, valor);
    }
    navegar(`/monitoramento-de-chamados?${proximos.toString()}`);
  };

  const series = useSeries();
  /*
    A unidade que a lateral nomeia — a mesma resolução que a caixa "Unidade
    atual" faz (`contextoAberto`), porque as duas têm de responder a mesma
    coisa. Sem contexto nenhum não há unidade, e aí não há o que recortar.
  */
  const { contextos } = useContextosDaCasca();
  const contexto = contextoAberto(contextos, parametros.get("scopeHash"));
  const unidade = contexto === undefined ? null : unidadeDe(contexto);

  /*
    O recorte inteiro decidido num lugar só, e fora do JSX — ver
    `lib/serie-da-unidade.ts`, onde estão a ordem das autoridades e o que
    acontece quando a unidade não casa com série nenhuma.

    `undefined` é "todas as séries" e `null` é a série sem unidade — duas coisas
    diferentes, e é por isso que a URL as distingue por um rótulo (`@sem-serie`)
    em vez de por um parâmetro vazio.
  */
  const recorte = recorteDeChamados({
    serieNaUrl: serieBruta,
    visaoGeral: visaoGeralAtiva(pathname, busca),
    unidade,
    series: series.dados?.series,
  });
  const serie = recorte.serie;

  const regua = useReguaDeDias({
    ate: fimDaRegua,
    serie,
    habilitado: recorte.pronto,
  });
  const resumoConsulta = useResumoDoDia({ dia, serie, habilitado: recorte.pronto });
  const lista = useMovimentacoes({
    dia,
    serie,
    aba,
    filtros,
    pagina,
    porPagina: POR_PAGINA,
    habilitado: recorte.pronto,
  });
  const revisao = useRevisao(dia);

  const resumo = resumoConsulta.dados ?? null;
  const frase = fraseDoDia(resumo);
  const progresso = progressoDoDia(resumo);
  const movimentacoes = lista.dados?.rows ?? [];

  /*
    A escrita marca a linha como ocupada enquanto está em voo: sem isso, dois
    cliques rápidos disparam duas requisições, e a segunda volta com o 409 de
    "esta movimentação mudou" — um erro que a tela criou sozinha.
  */
  const comOcupada = async (id: string, acao: () => Promise<unknown>) => {
    setOcupadas((atual) => new Set(atual).add(id));
    try {
      await acao();
    } finally {
      setOcupadas((atual) => {
        const proximo = new Set(atual);
        proximo.delete(id);
        return proximo;
      });
    }
  };

  const revisar = (m: Movimentacao) =>
    comOcupada(m.id, () =>
      revisao.revisar.mutateAsync({ id: m.id, revisao: m.revisao }),
    );
  const desfazer = (m: Movimentacao) =>
    comOcupada(m.id, () => revisao.desfazer.mutateAsync(m.id));

  /** "Continuar revisão" — as pendentes da página, de uma vez. */
  const continuar = () => {
    const pendentes = movimentacoes.filter((m) => !m.revisada).map((m) => m.id);
    if (pendentes.length > 0) revisao.emLote.mutate(pendentes);
  };

  const seriesDisponiveis = series.dados?.series ?? [];
  /*
    O seletor da tela existe para as séries que a lateral não alcança: a do
    envio sem unidade no arquivo, e a da unidade que mandou chamados sem nunca
    ter mandado vigência. Com uma série só, e ela casando com a unidade aberta,
    não há escolha nenhuma a oferecer — um menu de uma opção é ruído.
  */
  const mostrarSeletorDeSerie =
    seriesDisponiveis.length > 1 || recorte.motivo === "UNIDADE_SEM_ENVIO";

  /*
    Enquanto o recorte não está decidido as três consultas estão paradas de
    propósito, e `carregando` delas é `false` — dizer "nenhuma movimentação"
    nesse instante seria afirmar uma resposta que ninguém pediu ainda.
  */
  const decidindo = !recorte.pronto;

  const indisponivel =
    resumoConsulta.indisponivel || lista.indisponivel || regua.indisponivel;

  return (
    <Layout>
      <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
                <Headset className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                {/*
                  O título é o mesmo rótulo curto da lateral —
                  **"Monitoramento"** — e não "Monitoramento de Chamados": a
                  tela é a que o menu acende, e um cabeçalho que diz um nome
                  diferente do item clicado faz duvidar de que se chegou onde
                  se queria. O assunto já está dito de dois lados: a seção da
                  lateral se chama "Chamados Ambev", e a linha abaixo do título
                  é o dia dos chamados. Ver `layout/nav-auditoria.ts`.
                */}
                <h1 className="text-2xl font-bold tracking-tight">
                  Monitoramento
                </h1>
                <p className="text-sm text-muted-foreground">
                  {diaPorExtenso(dia)}
                  {resumo?.ultimaImportacao && (
                    <>
                      {" · "}
                      Última importação {horaLegivel(resumo.ultimaImportacao)}
                    </>
                  )}
                </p>
                <RecorteEmTela recorte={recorte} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mostrarSeletorDeSerie && (
              <Select
                value={valorDoSeletor(recorte, serieBruta)}
                onValueChange={(v) => {
                  setPagina(1);
                  trocar(mudancaDoSeletor(v));
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  {/*
                    A unidade da lateral é a primeira opção porque é o padrão —
                    escolhê-la é apagar a série da URL, não escrever outra.
                    Some quando não há unidade aberta: uma opção que não recorta
                    nada é uma promessa vazia.
                  */}
                  {recorte.unidade !== null && (
                    <SelectItem value={DA_UNIDADE}>
                      {recorte.unidade} (unidade aberta)
                    </SelectItem>
                  )}
                  <SelectItem value={TODAS_AS_SERIES}>
                    Todas as unidades
                  </SelectItem>
                  {seriesDisponiveis.map((s) => (
                    <SelectItem
                      key={s.serie ?? SEM_SERIE}
                      value={s.serie ?? SEM_SERIE}
                    >
                      {s.serie ?? "Sem unidade no arquivo"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                resumoConsulta.tentarDeNovo();
                lista.tentarDeNovo();
                regua.tentarDeNovo();
              }}
              title="Atualizar"
            >
              <RefreshCw
                className={cn("h-4 w-4", lista.atualizando && "animate-spin")}
              />
            </Button>
          </div>
        </header>

        {indisponivel && (
          <ApiErrorNotice
            error={resumoConsulta.erro ?? lista.erro ?? regua.erro}
            what="o monitoramento de chamados"
            tentando={lista.atualizando || resumoConsulta.atualizando}
            onTentarDeNovo={() => {
              resumoConsulta.tentarDeNovo();
              lista.tentarDeNovo();
              regua.tentarDeNovo();
            }}
          />
        )}

        <AvisoDoRecorte
          recorte={recorte}
          series={seriesDisponiveis}
          onTodas={() => {
            setPagina(1);
            trocar(mudancaDoSeletor(TODAS_AS_SERIES));
          }}
          onUnidade={() => {
            setPagina(1);
            trocar(mudancaDoSeletor(DA_UNIDADE));
          }}
        />

        <ReguaDeDias
          dias={regua.dados?.dias ?? []}
          diaAberto={dia}
          hoje={regua.dados?.hoje ?? hoje}
          carregando={regua.carregando || decidindo}
          onDia={(d) => {
            setPagina(1);
            trocar({ dia: d });
          }}
          onDeslocar={(passos) => {
            const base = new Date(`${fimDaRegua}T12:00:00.000Z`);
            base.setUTCDate(base.getUTCDate() + passos);
            trocar({ regua: base.toISOString().slice(0, 10) });
          }}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5 min-w-0">
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard
                icon={<TrendingUp className="h-6 w-6" />}
                tone="blue"
                label="Movimentações"
                value={resumo?.movimentacoes ?? "—"}
                hint="chamados que se mexeram neste dia"
              />
              <MetricCard
                icon={<CheckCircle2 className="h-6 w-6" />}
                tone="green"
                label="Revisadas"
                value={resumo?.revisadas ?? "—"}
                valueTone="good"
                hint="movimentações já analisadas por alguém"
              />
              <MetricCard
                icon={<Clock className="h-6 w-6" />}
                tone="red"
                label="Pendentes"
                value={resumo?.pendentes ?? "—"}
                valueTone={resumo && resumo.pendentes > 0 ? "bad" : "muted"}
                hint="movimentações aguardando revisão"
              />
            </div>

            {/*
              O detalhamento por classe. As quatro somam exatamente o total —
              é a propriedade que o motor garante, e a tela a mostra somada para
              que ela seja conferível a olho.
            */}
            {resumo !== null && resumo.movimentacoes > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm px-1">
                {[
                  ["novos", resumo.novos, "bg-blue-500"],
                  ["alterados", resumo.alterados, "bg-amber-500"],
                  ["encerrados", resumo.encerrados, "bg-emerald-500"],
                  ["saíram da fila", resumo.removidos, "bg-slate-400"],
                ].map(([rotulo, total, cor]) => (
                  <span key={rotulo as string} className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", cor as string)} />
                    <span className="font-semibold tabular-nums">{total as number}</span>
                    <span className="text-muted-foreground">{rotulo as string}</span>
                  </span>
                ))}
                <span className="text-xs text-muted-foreground">
                  = {resumo.movimentacoes} movimentações
                </span>
              </div>
            )}

            {frase && (
              <div
                className={cn(
                  "rounded-xl border px-5 py-4 flex flex-wrap items-center justify-between gap-4",
                  frase.tom === "pendente" && "border-red-200 bg-red-50",
                  frase.tom === "concluido" && "border-emerald-200 bg-emerald-50",
                  frase.tom === "informativo" && "border-blue-200 bg-blue-50",
                  frase.tom === "neutro" && "bg-card",
                )}
              >
                <div className="min-w-0">
                  <div className="font-bold">{frase.titulo}</div>
                  <div className="text-sm text-muted-foreground">{frase.detalhe}</div>
                  {progresso && (
                    <Progress
                      value={progresso.percentual}
                      className="mt-3 h-2 w-full max-w-md"
                    />
                  )}
                </div>
                {progresso && progresso.revisadas < progresso.total && (
                  <Button onClick={continuar} disabled={revisao.emLote.isPending}>
                    Continuar revisão
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}

            {/*
              O lote pode recusar linhas: se um envio novo reescreveu uma
              movimentação entre a lista carregar e o clique, ela não é revisada
              em silêncio. A tela diz quantas ficaram.
            */}
            {revisao.emLote.data && revisao.emLote.data.recusadas.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {revisao.emLote.data.recusadas.length}{" "}
                {revisao.emLote.data.recusadas.length === 1
                  ? "movimentação mudou"
                  : "movimentações mudaram"}{" "}
                desde que a lista carregou e não foram revisadas. Atualize para ver
                o que mudou.
              </div>
            )}

            <div>
              <div className="flex items-center gap-1 border-b overflow-x-auto">
                {ABAS.map((nome) => (
                  <AbaBotao
                    key={nome}
                    active={aba === nome}
                    onClick={() => {
                      setPagina(1);
                      trocar({ aba: nome });
                    }}
                    label={ROTULO_DA_ABA[nome].label}
                    hint={ROTULO_DA_ABA[nome].hint}
                    count={contagemDaAba(resumo, nome)}
                  />
                ))}
              </div>

              {resumo !== null && resumo.movimentacoes > 0 && (
                <div className="flex flex-wrap gap-2 py-3">
                  <FiltroSelect
                    rotulo="Unidade"
                    valor={filtros.unidade}
                    opcoes={resumo.filtros.unidades}
                    onChange={(v) => {
                      setPagina(1);
                      setFiltros((f) => ({ ...f, unidade: v }));
                    }}
                  />
                  <FiltroSelect
                    rotulo="Área"
                    valor={filtros.area}
                    opcoes={resumo.filtros.areas}
                    onChange={(v) => {
                      setPagina(1);
                      setFiltros((f) => ({ ...f, area: v }));
                    }}
                  />
                  <FiltroSelect
                    rotulo="Responsável"
                    valor={filtros.responsavel}
                    opcoes={resumo.filtros.responsaveis}
                    onChange={(v) => {
                      setPagina(1);
                      setFiltros((f) => ({ ...f, responsavel: v }));
                    }}
                  />
                  <FiltroSelect
                    rotulo="Tipo de alteração"
                    valor={filtros.tipoDeAlteracao}
                    opcoes={resumo.filtros.tiposDeAlteracao}
                    rotuloDaOpcao={(t) => ROTULO_DO_TIPO[t] ?? t}
                    onChange={(v) => {
                      setPagina(1);
                      setFiltros((f) => ({ ...f, tipoDeAlteracao: v }));
                    }}
                  />
                </div>
              )}

              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground pt-3 pb-2">
                Alterações do dia
              </h2>

              {movimentacoes.length === 0 && !lista.carregando && !decidindo ? (
                <div className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
                  {resumo?.movimentacoes === 0
                    ? (frase?.titulo ?? "Nenhuma movimentação neste dia.")
                    : "Nenhuma movimentação com estes filtros."}
                </div>
              ) : (
                <>
                  <ListaDeMovimentacoes
                    movimentacoes={movimentacoes}
                    carregando={lista.carregando || decidindo}
                    ocupadas={ocupadas}
                    onRevisar={revisar}
                    onDesfazer={desfazer}
                  />
                  {(lista.dados?.total ?? 0) > POR_PAGINA && (
                    <Paginacao
                      pagina={pagina}
                      porPagina={POR_PAGINA}
                      total={lista.dados?.total ?? 0}
                      onPagina={setPagina}
                      unidade="movimentações"
                      className="pt-3"
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <aside className="min-w-0">
            <ResumoDoDiaPainel
              resumo={resumo}
              carregando={resumoConsulta.carregando || decidindo}
            />
          </aside>
        </div>
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// O recorte em tela
// ---------------------------------------------------------------------------

/**
 * Os dois rótulos que **não** são séries — e por que eles não viajam na URL.
 *
 * "A unidade aberta" é a ausência de `serie` no endereço, e "todas as unidades"
 * é `visaoGeral=1`: os dois já têm nome na URL, e inventar um terceiro faria a
 * mesma pergunta ter duas respostas escritas. Aqui eles são só o valor que o
 * `Select` do Radix precisa ter para cada item — vocabulário do componente, e
 * não do endereço.
 */
const DA_UNIDADE = "__unidade__";
const TODAS_AS_SERIES = "__todas__";

/** O item marcado no seletor — o que a tela está de fato lendo. */
function valorDoSeletor(
  recorte: RecorteDeChamados,
  serieNaUrl: string | null,
): string {
  if (serieNaUrl !== null) return serieNaUrl;
  return recorte.motivo === "TODAS" ? TODAS_AS_SERIES : DA_UNIDADE;
}

/**
 * O que cada escolha do seletor escreve no endereço.
 *
 * `serie` e `visaoGeral` são apagados um pelo outro sempre: deixar os dois na
 * URL faria o link carregar um recorte que a tela não está aplicando, e é
 * exatamente esse tipo de sobra que faz um endereço colado abrir diferente do
 * que quem o copiou estava vendo.
 */
function mudancaDoSeletor(escolha: string): Record<string, string | null> {
  if (escolha === DA_UNIDADE) return { serie: null, visaoGeral: null };
  if (escolha === TODAS_AS_SERIES) return { serie: null, visaoGeral: "1" };
  return { serie: escolha, visaoGeral: null };
}

/**
 * A etiqueta que diz de quem são os números da tela.
 *
 * Os cartões mudam de valor conforme o recorte, e um número que muda sem dizer
 * de quem é vale menos do que nenhum. A etiqueta fica colada ao título, e não
 * na lateral: quem lê "70 movimentações" está olhando para cá.
 */
function RecorteEmTela({ recorte }: { recorte: RecorteDeChamados }) {
  if (recorte.motivo === "TODAS") {
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
        <Layers className="h-3.5 w-3.5" />
        Todas as unidades
      </span>
    );
  }
  const nome =
    recorte.motivo === "ESCOLHA"
      ? (recorte.serie ?? "Sem unidade no arquivo")
      : recorte.unidade;
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
      <MapPin className="h-3.5 w-3.5" />
      {nome}
    </span>
  );
}

/**
 * Os dois desencontros possíveis entre a lateral e a tela, ditos por extenso.
 *
 * **A unidade sem envio.** Nenhum arquivo de chamados nomeia a unidade aberta.
 * Mostrar o acervo inteiro embaixo do nome dela seria o desencontro que esta
 * tela acabou de sair de ter; mostrar vazio sem explicar seria pior ainda, que
 * é confundir "não achei" com "não há". A tela nomeia as séries que existem, e
 * oferece a soma.
 *
 * **A série escolhida à mão.** Quem escreveu `serie` na URL vence a lateral —
 * e a lateral continua escrita com outro nome, a cinco centímetros daqui. A
 * tira diz qual dos dois está valendo e devolve o caminho de volta num clique.
 */
function AvisoDoRecorte({
  recorte,
  series,
  onTodas,
  onUnidade,
}: {
  recorte: RecorteDeChamados;
  series: { serie: string | null }[];
  onTodas: () => void;
  onUnidade: () => void;
}) {
  if (recorte.motivo === "UNIDADE_SEM_ENVIO") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-bold text-amber-900">
            Nenhum chamado importado para {recorte.unidade}.
          </div>
          <div className="text-sm text-amber-900/80">{ondeEstaoOsEnvios(series)}</div>
        </div>
        <Button variant="outline" onClick={onTodas}>
          Ver todas as unidades
        </Button>
      </div>
    );
  }

  /*
    A divergência só é afirmável depois de a lista de séries chegar: com ela
    vazia, `serieDaUnidade` devolve `null` para toda unidade, e a tira apareceria
    em toda escolha durante a primeira carga — dizendo divergência onde só há
    espera.
  */
  const divergente =
    recorte.motivo === "ESCOLHA" &&
    recorte.unidade !== null &&
    series.length > 0 &&
    recorte.serie !== serieDaUnidade(recorte.unidade, series);
  if (!divergente) return null;

  return (
    <div className="rounded-xl border bg-card px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-sm">
      <div className="min-w-0">
        Esta tela está lendo{" "}
        <span className="font-semibold">
          {recorte.serie ?? "os envios sem unidade no arquivo"}
        </span>
        , e a lateral está em{" "}
        <span className="font-semibold">{recorte.unidade}</span>.
      </div>
      <Button variant="outline" size="sm" onClick={onUnidade}>
        Voltar para {recorte.unidade}
      </Button>
    </div>
  );
}

/**
 * Onde os chamados estão, para quem abriu a unidade que não tem nenhum.
 *
 * Nomear as séries que existem é o que transforma "está vazio" em "está vazio
 * **porque**" — e cobre o caso mais provável de todos, que é a mesma unidade
 * escrita de outro jeito no arquivo da Ambev. A lista é cortada em cinco: o
 * aviso é uma frase, não um segundo seletor.
 */
function ondeEstaoOsEnvios(series: { serie: string | null }[]): string {
  const nomeadas = series
    .map((s) => s.serie)
    .filter((s): s is string => s !== null);
  if (nomeadas.length === 0) {
    return "Nenhum arquivo de chamados foi importado ainda.";
  }
  const mostradas = nomeadas.slice(0, 5).join(", ");
  const resto = nomeadas.length - 5;
  return (
    `Os arquivos importados nomeiam ${mostradas}` +
    (resto > 0 ? ` e mais ${resto}` : "") +
    ". Se for a mesma unidade com outro nome no arquivo, escolha-a no seletor acima."
  );
}

const TODOS = "__todos__";

/** Um filtro que só existe quando há mais de uma opção para escolher. */
function FiltroSelect({
  rotulo,
  valor,
  opcoes,
  onChange,
  rotuloDaOpcao = (o) => o,
}: {
  rotulo: string;
  valor: string | undefined;
  opcoes: string[];
  onChange: (valor: string | undefined) => void;
  rotuloDaOpcao?: (opcao: string) => string;
}) {
  // Um seletor com uma opção só não é uma escolha — é ruído entre os que são.
  if (opcoes.length < 2) return null;
  return (
    <Select
      value={valor ?? TODOS}
      onValueChange={(v) => onChange(v === TODOS ? undefined : v)}
    >
      <SelectTrigger className="w-auto min-w-[150px] h-9">
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{rotulo}: todos</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o} value={o}>
            {rotuloDaOpcao(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
