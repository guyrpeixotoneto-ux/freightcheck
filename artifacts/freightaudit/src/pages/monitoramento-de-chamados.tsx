import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Headset,
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
  ABAS,
  ROTULO_DA_ABA,
  ROTULO_DO_TIPO,
  contagemDaAba,
  diaPorExtenso,
  fraseDoDia,
  hojeNaOperacao,
  horaLegivel,
  progressoDoDia,
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
 */

const POR_PAGINA = 25;

export default function MonitoramentoDeChamados() {
  const [, navegar] = useLocation();
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
    `undefined` é "todas as séries" e `null` é a série sem unidade — duas coisas
    diferentes, e é por isso que a URL as distingue por um rótulo (`@sem-serie`)
    em vez de por um parâmetro vazio.
  */
  const serie =
    serieBruta === null
      ? undefined
      : serieBruta === "@sem-serie"
        ? null
        : serieBruta;

  const regua = useReguaDeDias({ ate: fimDaRegua, serie });
  const resumoConsulta = useResumoDoDia({ dia, serie });
  const lista = useMovimentacoes({ dia, serie, aba, filtros, pagina, porPagina: POR_PAGINA });
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
  const mostrarSeletorDeSerie = seriesDisponiveis.length > 1;

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
                <h1 className="text-2xl font-bold tracking-tight">
                  Monitoramento de Chamados
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
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mostrarSeletorDeSerie && (
              <Select
                value={serieBruta ?? "__todas__"}
                onValueChange={(v) => {
                  setPagina(1);
                  trocar({ serie: v === "__todas__" ? null : v });
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__todas__">Todas as unidades</SelectItem>
                  {seriesDisponiveis.map((s) => (
                    <SelectItem
                      key={s.serie ?? "@sem-serie"}
                      value={s.serie ?? "@sem-serie"}
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

        <ReguaDeDias
          dias={regua.dados?.dias ?? []}
          diaAberto={dia}
          hoje={regua.dados?.hoje ?? hoje}
          carregando={regua.carregando}
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

              {movimentacoes.length === 0 && !lista.carregando ? (
                <div className="rounded-xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
                  {resumo?.movimentacoes === 0
                    ? (frase?.titulo ?? "Nenhuma movimentação neste dia.")
                    : "Nenhuma movimentação com estes filtros."}
                </div>
              ) : (
                <>
                  <ListaDeMovimentacoes
                    movimentacoes={movimentacoes}
                    carregando={lista.carregando}
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
            <ResumoDoDiaPainel resumo={resumo} carregando={resumoConsulta.carregando} />
          </aside>
        </div>
      </div>
    </Layout>
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
