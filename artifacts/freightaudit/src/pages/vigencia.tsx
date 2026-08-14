import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { AlertTriangle, Search, X } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { ResumoExecutivo } from "@/components/vigencia/resumo";
import { Panorama } from "@/components/vigencia/panorama";
import { Prioridade } from "@/components/vigencia/prioridade";
import {
  FILTRO_VAZIO,
  FOCO_LABEL,
  SEVERITY_LABEL,
  contarFocos,
  equipamentosDisponiveis,
  filtrarPrioridades,
  filtroAtivo,
  juntarPrioridades,
  type FiltroCockpit,
  type Foco,
} from "@/lib/cockpit";
import type { ChangeGroup, GroupedView } from "@/components/inicio/types";

/**
 * Acompanhamento — o cockpit de auditoria da vigência.
 *
 * A tela responde, de cima para baixo, na ordem em que a pergunta é feita:
 *
 * 1. **Contexto** — de que unidade, canal e vigência estamos falando.
 * 2. **Resumo executivo** — quantas alterações, quantos pontos exigem atenção,
 *    quantos veículos, quanto custa, quantos indícios de formato. Mais a frase
 *    que amarra os cinco números.
 * 3. **Panorama** — de que tipo é o risco: criticidade, natureza, frota, preço.
 * 4. **Prioridades** — por onde começar, com o diagnóstico já escrito e a
 *    investigação a um clique.
 *
 * O que mudou em relação à tela anterior, e por quê:
 *
 * - **O número deixou de morar dentro de uma frase.** "O cliente mexeu em 15
 *   pontos… 12 merecem atenção" tinha a informação certa numa forma que não se
 *   escaneia. Agora são cinco grandezas nomeadas, e cada uma diz sua unidade.
 * - **"Nenhum valor apurável" saiu do lugar mais nobre da tela.** Ele descrevia
 *   o produto, não a vigência: 244 alterações tinham sido encontradas. O risco
 *   passa a ser o assunto, e a ausência de preço vira qualificação dele — com o
 *   motivo escrito no panorama.
 * - **Os cartões deixaram de ter todos o mesmo peso.** Existe uma fila, ela é
 *   ordenada por uma soma explicável, e a conta fica visível dentro do item.
 * - **O valor cru saiu da primeira camada.** `2028-07-01T12:00:00Z → 46935.5` é
 *   prova de auditoria e continua inteiro — na investigação, que é onde ele é
 *   lido, e não no lugar onde se decide o que investigar.
 *
 * O que a tela continua recusando: somar periodicidades, tratar "sem preço"
 * como zero, e confundir o impacto desta vigência com o acumulado do histórico.
 */
export default function Vigencia() {
  const search = useSearch();
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [filtro, setFiltro] = useState<FiltroCockpit>(FILTRO_VAZIO);

  /*
    A unidade e o canal vêm da URL quando alguém os manda — é o mesmo par que
    Parâmetros usa, e é o que o seletor da lateral escreve. Sem eles, a API
    responde pelo contexto mais recente e diz na resposta qual foi.
  */
  const contexto = useMemo(() => {
    const params = new URLSearchParams(search);
    const query = new URLSearchParams();
    for (const key of ["scopeHash", "canal"]) {
      const value = params.get(key);
      if (value !== null) query.set(key, value);
    }
    return query;
  }, [search]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["grouped", period, contexto.toString()],
    queryFn: async () => {
      const query = new URLSearchParams(contexto);
      if (period) query.set("period", period);
      const suffix = query.toString() ? `?${query}` : "";
      const response = await fetch(getApiUrl(`/changes/grouped${suffix}`));
      if (!response.ok) throw new Error((await response.json()).error ?? "Falha ao carregar");
      return (await response.json()) as GroupedView;
    },
  });

  const entradas = useMemo(() => (data ? juntarPrioridades(data) : []), [data]);
  const visiveis = useMemo(() => filtrarPrioridades(entradas, filtro), [entradas, filtro]);
  const contagens = useMemo(() => contarFocos(entradas, filtro), [entradas, filtro]);
  const equipamentos = data ? equipamentosDisponiveis(data) : [];

  const mudarFiltro = (mudanca: Partial<FiltroCockpit>) =>
    setFiltro((atual) => ({ ...atual, ...mudanca }));

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Monitoramento da vigência
            </div>
            <h1 className="text-3xl font-bold tracking-tight mt-0.5">
              {data ? capitalizar(data.periodLabel) : "Acompanhamento"}
            </h1>
            {data && (
              <p className="text-sm font-semibold mt-1 uppercase tracking-wide">
                {data.context.label}
              </p>
            )}
            {data && (
              <p className="text-muted-foreground text-xs mt-1">
                {data.series.map((s, i) => (
                  <span key={s.entityTypeSet}>
                    {i > 0 && " · "}
                    {s.equipment.toLowerCase()}:{" "}
                    <span className="font-mono">
                      {s.previousLabel ?? "—"} → {s.snapshotLabel}
                    </span>
                  </span>
                ))}
              </p>
            )}
          </div>

          {data && data.periods.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Vigência
              </div>
              <Select value={data.period} onValueChange={setPeriod}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.periods.map((p) => (
                    <SelectItem key={p.date} value={p.date}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </header>

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {isLoading && <Esqueleto />}

        {error && (
          <div className="border border-red-300 bg-red-50 px-5 py-4">
            <p className="font-semibold text-red-900">Não foi possível carregar a vigência.</p>
            <p className="text-sm text-red-900/80 mt-1">{(error as Error).message}</p>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="mt-3 text-xs font-semibold uppercase tracking-wide border border-red-700 text-red-800 px-3 py-1.5 hover:bg-red-100 disabled:opacity-50"
            >
              {isFetching ? "Tentando…" : "Tentar novamente"}
            </button>
          </div>
        )}

        {data && (
          <>
            <ResumoExecutivo cockpit={data.cockpit} />

            <Avisos data={data} />

            {data.totals.changes === 0 ? (
              <section className="bg-card border shadow-sm px-6 py-10 text-center">
                {data.cockpit.baseline.hasBaseline ? (
                  <>
                    <p className="text-lg font-bold">
                      Nenhuma alteração encontrada nesta vigência.
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-xl mx-auto">
                      Os valores desta vigência são idênticos aos da anterior nas séries
                      comparadas. {data.totals.unchanged.toLocaleString("pt-BR")} valores foram
                      conferidos e nenhum mudou.
                    </p>
                  </>
                ) : (
                  /*
                    Zero alterações tem duas causas opostas, e a tela precisa
                    dizer qual é: nada mudou, ou não havia contra o que comparar.
                  */
                  <>
                    <p className="text-lg font-bold">
                      Esta é a primeira vigência disponível.
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-xl mx-auto">
                      A auditoria desta unidade começa na próxima vigência: é a segunda
                      entrega que dá ao FreightCheck contra o que comparar a primeira.
                    </p>
                    <Link
                      href="/importacoes"
                      className="inline-block mt-4 text-xs font-semibold uppercase tracking-wide border border-brand text-brand px-4 py-2 hover:bg-accent"
                    >
                      Ir para Importações
                    </Link>
                  </>
                )}
              </section>
            ) : (
              <>
                <Panorama cockpit={data.cockpit} filtro={filtro} aoFiltrar={mudarFiltro} />

                <section className="bg-card border shadow-sm">
                  <div className="px-5 py-4 border-b">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <h2 className="text-lg font-bold">Prioridades para investigação</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Ordenadas pelo nível de atenção, pela abrangência e pela magnitude da
                          mudança. Nenhum ponto é escondido — o último da fila continua na
                          lista.
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {visiveis.length} de {entradas.length}{" "}
                        {entradas.length === 1 ? "ponto" : "pontos"}
                      </span>
                    </div>

                    <Filtros
                      filtro={filtro}
                      contagens={contagens}
                      equipamentos={equipamentos}
                      aoFiltrar={mudarFiltro}
                      aoLimpar={() => setFiltro(FILTRO_VAZIO)}
                    />
                  </div>

                  {visiveis.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      Nenhum ponto atende a este recorte. Os {entradas.length} pontos da
                      vigência continuam aqui — limpe o filtro para vê-los.
                    </p>
                  ) : (
                    visiveis.map((entry) => (
                      <Prioridade
                        key={entry.item.key}
                        entry={entry}
                        period={data.period}
                        contexto={contexto}
                      />
                    ))
                  )}
                </section>
              </>
            )}

            <Rodape data={data} />
          </>
        )}
      </div>
    </Layout>
  );
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Os avisos que qualificam a leitura inteira.
 *
 * Continuam existindo, e continuam antes da fila: um número que cobre metade da
 * frota precisa dizer isso antes de ser lido, não depois.
 */
function Avisos({ data }: { data: GroupedView }) {
  /*
    A série sem anterior só vira aviso quando **alguma outra** foi comparada:
    aí o número da tela cobre parte da frota, e isso precisa ser dito. Quando
    nenhuma tem anterior, o resumo já abre dizendo que esta é a primeira
    vigência, e repetir aqui seria a terceira vez na mesma tela.
  */
  const primeiraVigencia = data.cockpit.baseline.hasBaseline
    ? data.series.filter((s) => s.changeSetId === null)
    : [];

  return (
    <>
      {data.otherContexts.length > 0 && (
        <Aviso>
          Os números acima são de <strong>{data.context.label}</strong>. Há mais{" "}
          {data.otherContexts.length}{" "}
          {data.otherContexts.length === 1 ? "contexto" : "contextos"} no banco (
          {data.otherContexts.map((c) => c.label).join(", ")}), e{" "}
          <strong>nenhum deles está somado aqui</strong>.
        </Aviso>
      )}

      {!data.complete && (
        <Aviso tom="alerta">
          <strong>Visão parcial.</strong> Nesta vigência chegou apenas{" "}
          {data.series.map((s) => s.equipment.toLowerCase()).join(", ")}. Falta{" "}
          <strong>{data.missingSeries.join(", ").toLowerCase()}</strong> — os números acima
          cobrem só o que foi entregue, e a série ausente não está contada como zero.
        </Aviso>
      )}

      {primeiraVigencia.map((s) => (
        <Aviso key={s.entityTypeSet}>
          <strong>{s.equipment}:</strong> {s.reason}
        </Aviso>
      ))}
    </>
  );
}

function Aviso({
  children,
  tom = "neutro",
}: {
  children: React.ReactNode;
  tom?: "neutro" | "alerta";
}) {
  return (
    <div
      className={cn(
        "flex gap-3 border px-4 py-3 text-sm",
        tom === "alerta"
          ? "border-amber-400 bg-amber-50 text-amber-900"
          : "bg-muted/40 text-muted-foreground",
      )}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

/**
 * Os filtros da fila.
 *
 * Compactos de propósito, e todos com a contagem do que entregam: um botão que
 * leva a uma lista vazia é uma promessa quebrada, e escrever o número ao lado
 * do rótulo custa menos do que descobrir clicando.
 */
function Filtros({
  filtro,
  contagens,
  equipamentos,
  aoFiltrar,
  aoLimpar,
}: {
  filtro: FiltroCockpit;
  contagens: Record<Foco, number>;
  equipamentos: { entityType: string; equipment: string }[];
  aoFiltrar: (mudanca: Partial<FiltroCockpit>) => void;
  aoLimpar: () => void;
}) {
  const focos: Foco[] = ["TODOS", "ATENCAO", "IMPACTO", "SEM_PRECO", "ANOMALIA"];

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-3">
      {focos.map((foco) => (
        <Chip
          key={foco}
          ativo={filtro.foco === foco}
          aoClicar={() => aoFiltrar({ foco })}
          desabilitado={contagens[foco] === 0 && foco !== "TODOS"}
        >
          {FOCO_LABEL[foco]}
          <span className="ml-1.5 tabular-nums opacity-70">{contagens[foco]}</span>
        </Chip>
      ))}

      {equipamentos.length > 1 && (
        <>
          <span className="w-px h-5 bg-border mx-1" />
          {equipamentos.map((e) => (
            <Chip
              key={e.entityType}
              ativo={filtro.equipamento === e.entityType}
              aoClicar={() =>
                aoFiltrar({
                  equipamento: filtro.equipamento === e.entityType ? null : e.entityType,
                })
              }
            >
              {e.equipment}
            </Chip>
          ))}
        </>
      )}

      {filtro.severidade && (
        <Chip ativo aoClicar={() => aoFiltrar({ severidade: null })}>
          {SEVERITY_LABEL[filtro.severidade]}
          <X className="w-3 h-3 ml-1" />
        </Chip>
      )}
      {filtro.selo && (
        <Chip ativo aoClicar={() => aoFiltrar({ selo: null })}>
          {filtro.selo.toLowerCase()}
          <X className="w-3 h-3 ml-1" />
        </Chip>
      )}

      <div className="relative ml-auto">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filtro.busca}
          onChange={(e) => aoFiltrar({ busca: e.target.value })}
          placeholder="Buscar parâmetro…"
          className="border bg-card pl-8 pr-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {filtroAtivo(filtro) && (
        <button
          onClick={aoLimpar}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          limpar
        </button>
      )}
    </div>
  );
}

function Chip({
  children,
  ativo,
  desabilitado,
  aoClicar,
}: {
  children: React.ReactNode;
  ativo?: boolean;
  desabilitado?: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      onClick={aoClicar}
      disabled={desabilitado}
      aria-pressed={ativo}
      className={cn(
        "inline-flex items-center text-xs font-semibold px-2.5 py-1 border transition-colors",
        ativo
          ? "border-brand bg-accent text-foreground"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
        desabilitado && "opacity-40 cursor-not-allowed hover:text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * O rodapé — o que fica fora da fila e ainda assim precisa ser dito.
 *
 * O acumulado histórico está aqui, e não no topo: ele é a soma de várias
 * vigências, e ocupar um cartão ao lado do impacto **desta** foi por muito
 * tempo o número que mais enganava no produto. Com uma comparação só, ele nem
 * aparece — repetir o valor da vigência sob outro nome não é histórico.
 */
function Rodape({ data }: { data: GroupedView }) {
  const historico = data.cockpit.history;

  return (
    <div className="border-t pt-4 text-xs text-muted-foreground space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>
          {data.totals.unchanged.toLocaleString("pt-BR")} valores não mudaram nesta vigência
        </span>
        <span>{data.totals.vehiclesTouched} veículos com alguma alteração</span>
        {(data.totals.entitiesAdded > 0 || data.totals.entitiesRemoved > 0) && (
          <span>
            frota: +{data.totals.entitiesAdded} / −{data.totals.entitiesRemoved} ativos
          </span>
        )}
        <Link href="/alteracoes" className="text-primary hover:underline">
          ver a lista completa, linha a linha
        </Link>
        <Link href="/curadoria" className="text-primary hover:underline">
          destravar preços na curadoria
        </Link>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold uppercase tracking-wide text-[0.625rem]">
          Acumulado histórico
        </span>
        {historico.sufficient ? (
          <>
            {Object.entries(historico.byPeriodicity)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([periodicity, amount]) => (
                <span key={periodicity} className="tabular-nums font-semibold text-foreground">
                  {formatBrlShort(amount)}
                  <span className="font-normal text-muted-foreground">
                    {periodicitySuffix(periodicity)}
                  </span>
                </span>
              ))}
            <span>
              soma de {historico.comparisons} comparações
              {historico.from && historico.to && (
                <>
                  {" "}
                  ({historico.from} a {historico.to})
                </>
              )}
              . Não é o valor desta vigência.
            </span>
          </>
        ) : (
          <span>
            Histórico ainda insuficiente — {historico.comparisons}{" "}
            {historico.comparisons === 1 ? "comparação registrada" : "comparações registradas"}{" "}
            neste contexto.
          </span>
        )}
      </div>
    </div>
  );
}

/** O esqueleto acompanha o layout novo: cinco números, quatro blocos, uma fila. */
function Esqueleto() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="bg-card border shadow-sm">
        <div className="grid grid-cols-2 lg:grid-cols-5 divide-x">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-5 py-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
        <div className="border-t px-5 py-4 space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-3 w-full max-w-3xl" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card border shadow-sm px-4 py-3.5 space-y-2.5">
            <Skeleton className="h-3 w-28" />
            {Array.from({ length: 4 }).map((__, j) => (
              <Skeleton key={j} className="h-3 w-full" />
            ))}
          </div>
        ))}
      </div>
      <div className="bg-card border shadow-sm divide-y">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-4 space-y-2">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-3 w-52" />
            <Skeleton className="h-3 w-full max-w-2xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reexportado para os testes de tipo da tela. */
export type { ChangeGroup };
