import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from "lucide-react";
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
import { lerRecorte, linkDeAlteracoes } from "@/lib/recorte";
import { FaixaResumo, ResumoExecutivo } from "@/components/vigencia/resumo";
import { Panorama } from "@/components/vigencia/panorama";
import { LinhaPrioridade } from "@/components/vigencia/prioridade";
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
  type ItemCockpit,
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
  /*
    A vigência começa na URL, como a unidade e o canal já começavam.

    Ela era só estado: `?period=` chegava e o Acompanhamento respondia pela mais
    recente, calado. Ninguém apontava para cá com vigência, então nada quebrava
    — mas esta tela é a que mais nomeia vigências no produto, e as duas saídas
    dela para Alterações (a fila e o rodapé) passaram a levar a que está à vista.
    Sem ler a que chega, o par ficava capenga de um lado: dá para sair daqui com
    a vigência, e não dava para entrar com ela.

    O seletor continua mandando daí em diante — é estado inicial, não trava.
  */
  const [period, setPeriod] = useState<string | undefined>(
    () => new URLSearchParams(search).get("period") ?? undefined,
  );
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
      <header className="px-8 pt-7 pb-5 max-w-[1600px]">
        {/*
          Duas colunas que não trocam de lugar: o título é o que encolhe
          (`flex-1 min-w-0`) e o seletor é o que não encolhe (`shrink-0`).
          Com `flex-wrap` e uma linha de procedência de mil e poucos pixels, o
          seletor caía para a linha de baixo e ia parar à esquerda, embaixo do
          título — no lugar onde ninguém procura o controle da página.
        */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1">
            {/*
              Unidade e canal sobem para cima do título. Eles são o que não
              muda enquanto se navega — a vigência é o que muda —, e lidos
              embaixo de um "Agosto/2026" de 36px pareciam legenda dele, e não
              o contexto de que a vigência é um recorte.
            */}
            {data && (
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {data.context.label}
              </p>
            )}
            <h1 className="text-4xl font-bold tracking-tight mt-1">
              {data ? capitalizar(data.periodLabel) : "Acompanhamento"}
            </h1>
            {data && <Procedencia series={data.series} periodLabel={data.periodLabel} />}
          </div>

          {/*
            O seletor traz o rótulo colado nele. Fora da faixa branca do
            cabeçalho antigo, um "Vigência" solto sobre o cinza da página não
            teria mais a que se referir — dentro da mesma moldura do campo, tem.
          */}
          {data && data.periods.length > 1 && (
            <div className="flex items-stretch border rounded-lg bg-card shadow-sm overflow-hidden shrink-0">
              <span className="flex items-center px-3 text-xs font-semibold text-muted-foreground border-r">
                Vigência
              </span>
              <Select value={data.period} onValueChange={setPeriod}>
                <SelectTrigger className="w-52 border-0 shadow-none rounded-none focus:ring-0">
                  <span className="flex items-center gap-2 min-w-0">
                    <CalendarDays className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <SelectValue />
                  </span>
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

      <div className="px-8 pb-6 space-y-4 max-w-[1600px]">
        {isLoading && <Esqueleto />}

        {error && (
          <div className="border border-red-300 rounded-xl bg-red-50 px-5 py-4">
            <p className="font-semibold text-red-900">Não foi possível carregar a vigência.</p>
            <p className="text-sm text-red-900/80 mt-1">{(error as Error).message}</p>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="mt-3 text-xs font-semibold uppercase tracking-wide border border-red-700 rounded-lg text-red-800 px-3 py-1.5 hover:bg-red-100 disabled:opacity-50"
            >
              {isFetching ? "Tentando…" : "Tentar novamente"}
            </button>
          </div>
        )}

        {data && (
          <>
            <ResumoExecutivo cockpit={data.cockpit} />

            {data.totals.changes > 0 && <FaixaResumo cockpit={data.cockpit} />}

            <Avisos data={data} />

            {data.totals.changes === 0 ? (
              <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
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

                <section className="bg-card border rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 pt-4 pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold">Prioridades para investigação</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Ordenadas pelo nível de atenção, pela abrangência e pela magnitude
                          da mudança — a soma que dá a posição está escrita dentro de cada
                          investigação, em{" "}
                          <span className="font-medium">
                            Por que este ponto está nesta posição
                          </span>
                          . A coluna <span className="font-medium">Alterações</span> conta
                          linhas, e as de todos os pontos fecham com o total da vigência.
                        </p>
                      </div>

                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={filtro.busca}
                          onChange={(e) => mudarFiltro({ busca: e.target.value })}
                          placeholder="Buscar parâmetro…"
                          aria-label="Buscar parâmetro"
                          className="border rounded-lg bg-card pl-9 pr-3 py-2 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-brand"
                        />
                      </div>
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
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground border-t">
                      Nenhum ponto atende a este recorte. Os {entradas.length} pontos da
                      vigência continuam aqui — limpe o filtro para vê-los.
                    </p>
                  ) : (
                    <Fila entradas={visiveis} period={data.period} contexto={contexto} />
                  )}
                </section>
              </>
            )}

            <Rodape data={data} contexto={contexto} />
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
 * De onde saiu cada série — uma ficha por série, e não uma frase só.
 *
 * A vigência de cada lado vem antes do nome do arquivo. `CAV_JUL → CAV_AGO`
 * identifica as entregas e não diz de quando elas são; e o "de quando" do lado
 * esquerdo não é dedutível do título da página, porque cada série compara
 * contra a última entrega **dela** — uma que pulou um mês tem um "antes" mais
 * velho que o da outra, na mesma vigência.
 *
 * Isso cabia numa linha corrida enquanto havia uma série. Com duas, a linha
 * junta dois nomes de vigência e dois nomes de arquivo por série, passa de mil
 * pixels e cobra para ser lida o que ela deveria dar de graça: qual par é de
 * qual série se descobre contando parênteses. A ficha separa as séries no eixo
 * em que elas são independentes, e separa dentro de cada uma as duas camadas —
 * a vigência, que é o rótulo, e o arquivo, que é a prova.
 */
function Procedencia({
  series,
  periodLabel,
}: {
  series: GroupedView["series"];
  periodLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {series.map((s) => (
        <div
          key={s.entityTypeSet}
          className="min-w-0 rounded-lg border bg-card/60 px-3 py-1.5"
        >
          <div className="flex items-baseline gap-1.5 text-xs">
            <span className="font-semibold">{s.equipment.toLowerCase()}</span>
            <span className="text-muted-foreground">
              {s.previousPeriodLabel ?? "sem vigência anterior"} → {periodLabel}
            </span>
          </div>
          <div className="font-mono text-[0.6875rem] text-muted-foreground/80 truncate">
            {s.previousLabel ?? "—"} → {s.snapshotLabel}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Quantos pontos a fila abre mostrando, antes de alguém pedir o resto. */
const PONTOS_VISIVEIS = 3;

/**
 * A fila, em tabela.
 *
 * Abre com os primeiros pontos e o resto a um clique — e o clique diz quantos
 * são, porque uma lista que esconde sem dizer quanto esconde é uma lista em que
 * não se confia. Nenhum ponto sai: "ver todos" mostra os {@link PONTOS_VISIVEIS}
 * primeiros e todos os outros, na mesma ordem.
 */
function Fila({
  entradas,
  period,
  contexto,
}: {
  entradas: ItemCockpit[];
  period: string;
  contexto: URLSearchParams;
}) {
  const [tudo, setTudo] = useState(false);
  const mostrados = tudo ? entradas : entradas.slice(0, PONTOS_VISIVEIS);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-t bg-muted/30">
              <Cabecalho className="pl-5 pr-2">#</Cabecalho>
              <Cabecalho>Criticidade</Cabecalho>
              <Cabecalho>Parâmetro</Cabecalho>
              <Cabecalho>Frota</Cabecalho>
              <Cabecalho alinhamento="right">Alterações</Cabecalho>
              <Cabecalho alinhamento="center">Anomalia</Cabecalho>
              <Cabecalho alinhamento="right">Impacto</Cabecalho>
              <Cabecalho alinhamento="right" className="pl-2 pr-5">
                Ações
              </Cabecalho>
            </tr>
          </thead>
          <tbody>
            {mostrados.map((entry) => (
              <LinhaPrioridade
                key={entry.item.key}
                entry={entry}
                period={period}
                contexto={contexto}
              />
            ))}
          </tbody>
        </table>
      </div>

      {entradas.length > PONTOS_VISIVEIS && (
        <button
          onClick={() => setTudo(!tudo)}
          aria-expanded={tudo}
          className="w-full border-t px-5 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          {tudo ? (
            <>
              Ver menos
              <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Ver todos os pontos ({entradas.length})
              <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      )}
    </>
  );
}

function Cabecalho({
  children,
  alinhamento = "left",
  className,
}: {
  children: React.ReactNode;
  alinhamento?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap",
        alinhamento === "right" && "text-right",
        alinhamento === "center" && "text-center",
        alinhamento === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
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
        "flex gap-3 border rounded-xl px-4 py-3 text-sm",
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
    <div className="flex flex-wrap items-center gap-2 mt-3">
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
        "inline-flex items-center text-xs font-semibold px-3 py-1.5 border rounded-lg transition-colors",
        ativo
          ? "border-brand-red bg-red-50 text-brand-red"
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
function Rodape({ data, contexto }: { data: GroupedView; contexto: URLSearchParams }) {
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
        {/*
          A vigência e a unidade vão junto. Sem elas o link abria a comparação
          mais recente do contexto padrão, e "a lista completa" passava a ser a
          de outro mês — logo abaixo de um rodapé que acabara de contar os
          valores **desta**.
        */}
        <Link
          href={linkDeAlteracoes({
            recorte: { ...lerRecorte(contexto), period: data.period },
          })}
          className="text-primary hover:underline"
        >
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

/** O esqueleto acompanha o layout: cinco cartões, uma faixa, quatro blocos, a fila. */
function Esqueleto() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-card border rounded-xl shadow-sm px-4 py-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card border rounded-xl shadow-sm px-4 py-4 space-y-3">
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: 4 }).map((__, j) => (
              <Skeleton key={j} className="h-3 w-full" />
            ))}
          </div>
        ))}
      </div>
      <div className="bg-card border rounded-xl shadow-sm px-5 py-4 space-y-3">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-8 w-full max-w-md" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Reexportado para os testes de tipo da tela. */
export type { ChangeGroup };
