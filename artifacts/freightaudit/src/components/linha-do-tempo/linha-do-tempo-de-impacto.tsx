import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChartNoAxesCombined,
  Clock,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";
import { fetchJsonOrNull } from "@/lib/api";
import { opcoesDoIntervalo } from "@/lib/intervalo-da-linha-do-tempo";
import { cn } from "@/lib/utils";
import { formatBrlCompacto, formatBrlShort, periodicityAdjective, periodicitySuffix } from "@/lib/format";
import { linkDeAlteracoes, type Recorte } from "@/lib/recorte";
import type { Movimentos, ParameterRollup, RangeMovement, RangeOverview } from "@/lib/analise";
import { DetalheDoIntervalo, type AberturaDoIntervalo } from "@/components/linha-do-tempo/detalhe-do-intervalo";

const CARTAO = "bg-card border rounded-xl shadow-sm";

/**
 * O impacto líquido de cada vigência do histórico, uma embaixo da outra.
 *
 * O cartão de Impacto líquido só mostra a vigência aberta contra a anterior a
 * ela — o resto da história (quantas vigências tiveram alteração, quando o
 * impacto foi maior, se ele vem crescendo ou oscilando) fica sem resposta
 * nesta tela. Esta seção lê `/changes/range` do início ao fim do histórico do
 * contexto, e mostra o mesmo número oficial que o cartão de cima publica —
 * `movement.impact.byPeriodicity`, já sem dupla contagem — uma linha por
 * vigência, a mais antiga em cima.
 */
export function LinhaDoTempoDeImpacto({
  consulta,
  periods,
  currentPeriod,
}: {
  consulta: URLSearchParams;
  periods: { date: string; label: string }[];
  currentPeriod: string;
}) {
  const ordenadas = [...periods].sort((a, b) => a.date.localeCompare(b.date));
  const primeira = ordenadas[0]?.date;

  // A mesma unidade e canal em toda a linha do tempo — só a vigência muda de
  // linha para linha, e é ela que cada linha acrescenta ao clicar.
  const recorteBase: Recorte = {
    period: null,
    scopeHash: consulta.get("scopeHash"),
    canal: consulta.get("canal"),
  };

  const [abertura, setAbertura] = useState<AberturaDoIntervalo | null>(null);
  const abrirParametro = (parameterKey: string, periodicidade: string) =>
    setAbertura({ tipo: "parametro", parameterKey, periodicidade });

  // Qual periodicidade a linha do tempo mostra — MENSAL e ANUAL contam a
  // mesma vigência de formas diferentes, então mostrá-las ao mesmo tempo faz
  // o mesmo mês parecer repetido. Uma aba de cada vez resolve isso.
  const [periodicidadeDaAba, setPeriodicidadeDaAba] = useState<string | null>(null);

  /*
    A chave é a mesma que `LinhaDoTempoDeAlteracoes`, `useAlteracoesPorVigencia`
    e o prefetch da página usam para este mesmo endpoint — todos leem
    `/changes/range` para o mesmo contexto e, no carregamento inicial da tela,
    para o mesmo `from`/`to` (histórico inteiro). Chaves próprias por
    componente faziam o React Query tratá-las como perguntas diferentes e
    disparar requisições idênticas ao abrir a tela; com a chave montada por
    `opcoesDoIntervalo`, elas compartilham cache e a requisição em voo — uma só
    chamada cara. É por esse compartilhamento que o prefetch da página
    (`pages/linha-do-tempo.tsx`) chega aqui: quando este componente monta, a
    resposta ou já está no cache, ou está a caminho.
  */
  const movimentos = useQuery({
    ...opcoesDoIntervalo(consulta, primeira ?? currentPeriod, currentPeriod),
    enabled: ordenadas.length > 1,
  });

  /*
    A mesma pergunta, entre todas as unidades — "onde está o impacto" só faz
    sentido sobre o intervalo, não sobre unidade/canal (que aqui identificam a
    própria pergunta). Por isso a consulta desta seção não herda `scopeHash`
    nem `canal` de `query`: são só as pontas do intervalo.
  */
  const queryOverview = new URLSearchParams();
  if (primeira) queryOverview.set("from", primeira);
  queryOverview.set("to", currentPeriod);

  /*
    E ela só sai **depois** que a leitura desta unidade chegou.

    Não é atraso por precaução: `/changes/range/overview` roda a análise
    completa do intervalo uma vez por unidade × contexto, todas de uma vez
    (ver `getRangeOverview`). Disparada junto com a leitura da unidade aberta,
    ela disputa o mesmo pool de conexões com a resposta que a tela de fato
    espera — e atrasa o conteúdo principal para adiantar um cartão lateral.

    O cartão que ela alimenta não some por esperar: `OndeEstaOImpacto` não
    desenha nada enquanto a resposta não chega, e passa a desenhar quando ela
    chega. O que muda é a ordem — primeiro o que a tela veio mostrar, depois o
    ranking entre unidades.
  */
  const overview = useQuery({
    queryKey: ["linha-do-tempo-overview", queryOverview.toString()],
    queryFn: () => fetchJsonOrNull<RangeOverview>(`/changes/range/overview?${queryOverview}`),
    enabled: ordenadas.length > 1 && movimentos.isSuccess,
    staleTime: 60_000,
  });

  // Uma vigência só não tem linha do tempo a desenhar.
  if (ordenadas.length <= 1) return null;
  if (movimentos.isLoading) {
    return (
      <section className={cn(CARTAO, "p-5")}>
        <p className="text-sm text-muted-foreground">Carregando a linha do tempo…</p>
      </section>
    );
  }

  const dados = movimentos.data;
  if (!dados || dados.movements.length === 0) return null;

  // Mais antiga em cima — a mesma leitura que "Quando aconteceu" já usa em Parâmetros.
  const linhas = [...dados.movements].reverse();
  const periodicidades = [
    ...new Set(linhas.flatMap((m) => Object.keys(m.impact.byPeriodicity))),
  ].sort();
  const periodicidadeSelecionada = periodicidadeDaAba ?? periodicidades[0];

  /*
    A periodicidade que o cabeçalho conta — a de maior movimento absoluto no
    intervalo inteiro. As outras periodicidades continuam com sua própria
    linha do tempo mais abaixo; o que muda aqui é só qual delas os quatro
    cartões do topo e o parágrafo final escolhem para contar a história —
    nunca uma soma entre elas.
  */
  const principal = [...periodicidades].sort(
    (a, b) => Math.abs(dados.impact.byPeriodicity[b] ?? 0) - Math.abs(dados.impact.byPeriodicity[a] ?? 0),
  )[0] as string | undefined;

  return (
    <>
      <section className={cn(CARTAO, "p-5")}>
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-accent">
            <ChartNoAxesCombined className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[0.8125rem] font-bold leading-tight">
              Impacto líquido ao longo do tempo
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {dados.fromLabel} → {dados.toLabel} · mais antiga em cima
            </p>
          </div>
        </div>

        {dados.gaps.length > 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            {dados.gaps.length} {dados.gaps.length === 1 ? "vigência" : "vigências"} do
            histórico sem comparação calculada — não aparecem abaixo, e não estão
            contadas como zero.
          </p>
        )}

        {principal !== undefined && (
          <CartoesDeResumo
            dados={dados}
            periodicidade={principal}
            onAbrir={() => setAbertura({ tipo: "consolidado", periodicidade: principal })}
          />
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            {periodicidades.length === 0 ? (
              <ContagemPorVigencia linhas={linhas} recorteBase={recorteBase} />
            ) : (
              <div className="space-y-3">
                {periodicidades.length > 1 && (
                  <div className="inline-flex rounded-lg border p-0.5 text-xs font-semibold">
                    {periodicidades.map((periodicidade) => (
                      <button
                        key={periodicidade}
                        type="button"
                        onClick={() => setPeriodicidadeDaAba(periodicidade)}
                        aria-pressed={periodicidade === periodicidadeSelecionada}
                        className={cn(
                          "rounded-md px-3 py-1 transition-colors",
                          periodicidade === periodicidadeSelecionada
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        R${periodicitySuffix(periodicidade)}
                      </button>
                    ))}
                  </div>
                )}
                <LinhaDoTempoDaPeriodicidade
                  periodicidade={periodicidadeSelecionada}
                  linhas={linhas}
                  recorteBase={recorteBase}
                />
              </div>
            )}
          </div>

          <div className="space-y-4">
            <OndeEstaOImpacto overview={overview.data ?? null} periodicidade={principal ?? null} />
            <PendenciasDeValoracao dados={dados} recorteBase={recorteBase} />
          </div>
        </div>

        {principal !== undefined && <Narrativa dados={dados} periodicidade={principal} linhas={linhas} />}
      </section>

      <AtributosDeMaiorImpacto
        byParameter={dados.byParameter}
        periodicidades={periodicidades}
        onAbrir={abrirParametro}
      />

      <DetalheDoIntervalo
        abertura={abertura}
        dados={dados}
        recorteBase={recorteBase}
        onFechar={() => setAbertura(null)}
        onAbrirParametro={abrirParametro}
      />
    </>
  );
}

/**
 * Os quatro cartões do topo — o líquido, os dois lados que o formam e a
 * contagem de alterações —, todos sobre a **mesma** periodicidade.
 *
 * Separar "o que somou" e "o que subtraiu" em cartões próprios, e não só numa
 * barra dentro do cartão de líquido, é a resposta ao mesmo problema que
 * `DoisLados` resolve na Visão geral: um líquido negativo não distingue "quase
 * nada se moveu" de "dois movimentos grandes quase se cancelaram", e é
 * exatamente essa segunda leitura que a conversa com o cliente precisa.
 */
function CartoesDeResumo({
  dados,
  periodicidade,
  onAbrir,
}: {
  dados: Movimentos;
  periodicidade: string;
  onAbrir: () => void;
}) {
  const liquido = dados.impact.byPeriodicity[periodicidade] ?? 0;
  const ganhos = dados.gainsByPeriodicity[periodicidade] ?? 0;
  const perdas = dados.lossesByPeriodicity[periodicidade] ?? 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-5">
      <CartaoDeResumo
        icone={liquido < 0 ? ArrowDownRight : ArrowUpRight}
        tom={liquido < 0 ? "perda" : "ganho"}
        titulo={`Impacto líquido${periodicitySuffix(periodicidade)}`}
        valor={formatBrlShort(liquido)}
        onClique={onAbrir}
        rotulo="Ver o que somou e o que subtraiu"
      />
      <CartaoDeResumo
        icone={Clock}
        tom="perda"
        titulo={`Perdas identificadas${periodicitySuffix(periodicidade)}`}
        valor={formatBrlShort(perdas)}
        onClique={onAbrir}
        rotulo="Ver o que subtraiu da remuneração"
      />
      <CartaoDeResumo
        icone={ArrowUpRight}
        tom="ganho"
        titulo={`Ganhos identificados${periodicitySuffix(periodicidade)}`}
        valor={`+${formatBrlShort(ganhos)}`}
        onClique={onAbrir}
        rotulo="Ver o que somou à remuneração"
      />
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Alterações
        </div>
        <div className="text-xl font-extrabold tabular-nums mt-1.5">
          {dados.totals.changes.toLocaleString("pt-BR")}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          em {contar(dados.totals.vehiclesTouched, "ativo", "ativos")}
        </div>
      </div>
    </div>
  );
}

function CartaoDeResumo({
  icone: Icone,
  tom,
  titulo,
  valor,
  onClique,
  rotulo,
}: {
  icone: typeof ArrowUpRight;
  tom: "ganho" | "perda";
  titulo: string;
  valor: string;
  onClique: () => void;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      onClick={onClique}
      aria-label={`${titulo}: ${rotulo}`}
      title={rotulo}
      className="rounded-lg border p-4 text-left hover:bg-accent hover:border-brand/40 transition-colors"
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center",
          tom === "perda" ? "bg-red-50" : "bg-emerald-50",
        )}
      >
        <Icone className={cn("w-4 h-4", tom === "perda" ? "text-red-600" : "text-emerald-600")} />
      </div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mt-2.5">{titulo}</div>
      <div
        className={cn(
          "text-xl font-extrabold tabular-nums mt-1",
          tom === "perda" ? "text-red-700" : "text-emerald-700",
        )}
      >
        {valor}
      </div>
    </button>
  );
}

/**
 * A linha do tempo do impacto — uma vigência por linha, a mais antiga em
 * cima, com o eixo de escala visível e o mês crítico nomeado.
 *
 * O eixo (`ticks`) usa o mesmo teto que dimensiona as barras — não um valor
 * redondo escolhido à parte —, para a régua e as barras nunca discordarem
 * sobre o que "a ponta do gráfico" significa.
 */
function LinhaDoTempoDaPeriodicidade({
  periodicidade,
  linhas,
  recorteBase,
}: {
  periodicidade: string;
  linhas: RangeMovement[];
  recorteBase: Recorte;
}) {
  const teto = Math.max(
    ...linhas.map((l) => Math.abs(l.impact.byPeriodicity[periodicidade] ?? 0)),
    1,
  );
  const comValor = linhas.filter((l) => l.impact.byPeriodicity[periodicidade] !== undefined);
  const maior = comValor.reduce(
    (a, b) =>
      Math.abs(b.impact.byPeriodicity[periodicidade] ?? 0) >
      Math.abs(a.impact.byPeriodicity[periodicidade] ?? 0)
        ? b
        : a,
    comValor[0],
  );
  const ticks = [-teto, -teto / 2, 0, teto / 2, teto];

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Impacto financeiro (R${periodicitySuffix(periodicidade)})
      </div>
      <div className="grid grid-cols-[7rem_1fr_9rem_7rem] gap-3 text-[0.6875rem] text-muted-foreground mb-1.5 px-1">
        <span />
        <div className="flex justify-between">
          {ticks.map((t, i) => (
            <span key={i}>{t === 0 ? "0" : formatBrlCompacto(t)}</span>
          ))}
        </div>
        <span />
        <span />
      </div>
      <div className="space-y-2">
        {linhas.map((linha) => {
          const valor = linha.impact.byPeriodicity[periodicidade];
          const largura = valor === undefined ? 0 : (Math.abs(valor) / teto) * 100;
          const critico = maior && linha.period === maior.period && largura > 0;
          const semValoracao = valor === undefined && linha.changes > 0;
          const parcial =
            valor !== undefined && linha.impact.notCalculable > 0 && linha.impact.notCalculable < linha.changes;

          return (
            <Link
              key={linha.period}
              href={linkDeAlteracoes({
                recorte: { ...recorteBase, period: linha.period },
              })}
              aria-label={`Ver as alterações de ${linha.label}`}
              title="Ver as alterações desta vigência"
              className="grid grid-cols-[7rem_1fr_9rem_7rem] items-center gap-3 text-sm rounded px-1 py-1 -mx-1 hover:bg-accent transition-colors"
            >
              <span className="min-w-0">
                <span className={cn("block truncate", critico ? "font-bold" : "text-muted-foreground")}>
                  {linha.label}
                </span>
                {critico && (
                  <span className="mt-0.5 inline-block rounded-full bg-red-50 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-red-700">
                    Mês crítico
                  </span>
                )}
                {!critico && parcial && (
                  <span className="mt-0.5 block text-[0.625rem] text-muted-foreground">
                    parcialmente valorado
                  </span>
                )}
              </span>

              {/* O zero fica no meio; perda cresce para a esquerda. */}
              <div className="flex items-center h-4 relative">
                <span className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                <div className="w-1/2 flex justify-end">
                  {valor !== undefined && valor < 0 && (
                    <span className="h-2.5 bg-red-600" style={{ width: `${largura}%` }} />
                  )}
                </div>
                <div className="w-1/2">
                  {valor !== undefined && valor > 0 && (
                    <span className="h-2.5 bg-emerald-600 block" style={{ width: `${largura}%` }} />
                  )}
                </div>
              </div>

              <span
                className={cn(
                  "text-right tabular-nums text-xs",
                  valor === undefined
                    ? "text-muted-foreground italic"
                    : valor < 0
                      ? "text-red-700"
                      : "text-emerald-700",
                )}
              >
                {valor === undefined
                  ? semValoracao
                    ? "sem valoração"
                    : "sem alteração"
                  : formatBrlShort(valor)}
              </span>

              <span className="text-right tabular-nums text-xs text-muted-foreground">
                {linha.changes.toLocaleString("pt-BR")}{" "}
                {linha.changes === 1 ? "alteração" : "alterações"}
                {linha.impact.notCalculable > 0 && (
                  <span className="block text-[0.625rem]">
                    {linha.impact.notCalculable} sem valoração
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Quando nenhuma vigência do intervalo tem impacto apurado: a mesma linha do tempo, contando alterações. */
function ContagemPorVigencia({
  linhas,
  recorteBase,
}: {
  linhas: RangeMovement[];
  recorteBase: Recorte;
}) {
  const teto = Math.max(...linhas.map((l) => l.changes), 1);
  const maior = linhas.reduce((a, b) => (b.changes > a.changes ? b : a), linhas[0]);

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Alterações por vigência — nenhuma com impacto apurado
      </div>
      <div className="space-y-1.5">
        {linhas.map((linha) => {
          const destaque = linha.period === maior.period && maior.changes > 0;
          return (
            <Link
              key={linha.period}
              href={linkDeAlteracoes({
                recorte: { ...recorteBase, period: linha.period },
              })}
              aria-label={`Ver as alterações de ${linha.label}`}
              title="Ver as alterações desta vigência"
              className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3 text-sm rounded px-1 -mx-1 hover:bg-accent transition-colors"
            >
              <span
                className={cn("truncate", destaque ? "font-bold" : "text-muted-foreground")}
              >
                {linha.label}
              </span>
              <div className="h-4 flex items-center">
                <span
                  className="h-2.5 bg-slate-400 block"
                  style={{ width: `${(linha.changes / teto) * 100}%` }}
                />
              </div>
              <span className="text-right tabular-nums text-xs">
                {linha.changes.toLocaleString("pt-BR")}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onde está o impacto — o ranking por unidade
// ---------------------------------------------------------------------------

const TOPO_DE_UNIDADES = 6;

/**
 * O ranking de unidades pelo líquido do intervalo — a mesma pergunta de
 * `LinhaDoTempoDaPeriodicidade`, respondida por "onde" em vez de "quando".
 *
 * Vem de `/changes/range/overview`, que soma o mesmo intervalo por unidade em
 * vez de por unidade única — ver `getRangeOverview` em
 * `@workspace/comparison`. Sem essa resposta ainda (carregando, ou nenhuma
 * outra unidade elegível), o cartão não aparece: um ranking de uma unidade só
 * não é ranking, é o mesmo número que os cartões acima já mostram.
 */
function OndeEstaOImpacto({
  overview,
  periodicidade,
}: {
  overview: RangeOverview | null;
  periodicidade: string | null;
}) {
  if (overview === null || periodicidade === null) return null;

  const ranking = overview.unitsIncluded
    .map((u) => ({ ...u, valor: u.impact.byPeriodicity[periodicidade] ?? 0 }))
    .filter((u) => u.valor !== 0)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

  if (ranking.length <= 1) return null;

  const teto = Math.max(...ranking.map((u) => Math.abs(u.valor)), 1);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
        <MapPin className="w-3.5 h-3.5" />
        Onde está o impacto?
      </div>
      <ol className="space-y-2.5">
        {ranking.slice(0, TOPO_DE_UNIDADES).map((unidade, indice) => (
          <li key={unidade.unidade}>
            <Link
              href={linkDeAlteracoes({
                recorte: {
                  period: null,
                  scopeHash: unidade.contexts[0]?.scopeHash ?? null,
                  canal: unidade.contexts[0]?.channel ?? null,
                },
              })}
              aria-label={`Ver as alterações de ${unidade.label}`}
              title="Ver as alterações desta unidade"
              className="block rounded px-1 -mx-1 hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-muted-foreground w-3 shrink-0">{indice + 1}</span>
                  <span className="font-semibold truncate" title={unidade.label}>
                    {unidade.label}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-xs font-bold tabular-nums shrink-0",
                    unidade.valor < 0 ? "text-red-700" : "text-emerald-700",
                  )}
                >
                  {formatBrlShort(unidade.valor)}
                </span>
              </div>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full", unidade.valor < 0 ? "bg-red-600" : "bg-emerald-600")}
                  style={{ width: `${Math.max(4, (Math.abs(unidade.valor) / teto) * 100)}%` }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {ranking.length > TOPO_DE_UNIDADES && (
        <p className="mt-2.5 text-xs text-muted-foreground">
          + {contar(ranking.length - TOPO_DE_UNIDADES, "outra unidade", "outras unidades")} com
          impacto menor que as acima.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pendências de valoração
// ---------------------------------------------------------------------------

/**
 * Quantas alterações do intervalo ainda não têm impacto apurado — o mesmo
 * `notCalculable` que o cartão "Sem impacto calculável" mostra numa vigência
 * só, aqui somado ao intervalo inteiro.
 */
function PendenciasDeValoracao({
  dados,
  recorteBase,
}: {
  dados: Movimentos;
  recorteBase: Recorte;
}) {
  if (dados.impact.notCalculable === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-800">
        <AlertTriangle className="w-3.5 h-3.5" />
        Pendências de valoração
      </div>
      <div className="text-xl font-extrabold tabular-nums mt-1.5 text-amber-900">
        {dados.impact.notCalculable.toLocaleString("pt-BR")}
      </div>
      <p className="text-xs text-amber-800 mt-1">
        {contar(dados.impact.notCalculable, "alteração", "alterações")} ainda sem impacto
        financeiro calculado.
      </p>
      <Link
        href={linkDeAlteracoes({
          recorte: recorteBase,
          filtros: { impactConfidence: "NOT_CALCULABLE" },
        })}
        aria-label="Ver as alterações ainda sem valoração"
        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 transition-colors"
      >
        Ver alterações
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A narrativa
// ---------------------------------------------------------------------------

/**
 * O parágrafo que resume o intervalo — a mesma leitura que os cartões e a
 * linha do tempo já publicam, só que em frase corrida, para quem quer levar
 * uma linha para a reunião em vez de uma tela.
 *
 * Monta-se inteiramente a partir do que os componentes acima já leram —
 * nenhuma causa é inventada, só o que o motor apurou.
 */
function Narrativa({
  dados,
  periodicidade,
  linhas,
}: {
  dados: Movimentos;
  periodicidade: string;
  linhas: RangeMovement[];
}) {
  const liquido = dados.impact.byPeriodicity[periodicidade] ?? 0;
  const ganhos = dados.gainsByPeriodicity[periodicidade] ?? 0;
  const perdas = dados.lossesByPeriodicity[periodicidade] ?? 0;

  const comValor = linhas.filter((l) => l.impact.byPeriodicity[periodicidade] !== undefined);
  const critico = comValor.reduce(
    (a, b) =>
      Math.abs(b.impact.byPeriodicity[periodicidade] ?? 0) >
      Math.abs(a.impact.byPeriodicity[periodicidade] ?? 0)
        ? b
        : a,
    comValor[0],
  );

  const frases: string[] = [
    `No período, as alterações geraram impacto líquido ${liquido < 0 ? "desfavorável" : "favorável"} de ${formatBrlShort(Math.abs(liquido))}${periodicitySuffix(periodicidade)}.`,
  ];

  if (critico && ganhos !== 0 && perdas !== 0) {
    frases.push(
      `${critico.label} concentrou o maior impacto ${(critico.impact.byPeriodicity[periodicidade] ?? 0) < 0 ? "negativo" : "positivo"}, com perdas de ${formatBrlShort(Math.abs(perdas))} parcialmente compensadas por ${formatBrlShort(ganhos)} em ganhos.`,
    );
  } else if (critico) {
    frases.push(`${critico.label} concentrou o maior impacto do período.`);
  }

  if (dados.impact.notCalculable > 0) {
    frases.push("Existem alterações ainda sem valoração que exigem revisão.");
  }

  return (
    <div className="mt-5 flex gap-3 rounded-lg border bg-muted/30 p-4">
      <ChartNoAxesCombined className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {frases.join(" ")}
        <span className="ml-1 text-xs uppercase tracking-wide">
          ({periodicityAdjective(periodicidade)})
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Os atributos de maior impacto
// ---------------------------------------------------------------------------

const TOPO = 6;

/**
 * Os parâmetros que mais somaram e mais tiraram no intervalo inteiro, uma
 * periodicidade por vez.
 *
 * A lista vigência a vigência acima responde "quando" o impacto aconteceu; esta
 * responde "o quê" — que atributo produziu esse impacto, somado por todas as
 * vigências do intervalo. Sai de `byParameter`, o mesmo rollup que a resposta
 * de `/changes/range` já calcula, e não de um pedido novo.
 *
 * Cada lista é a **soma no intervalo**, não uma vigência só — por isso o clique
 * numa linha não abre direto a Planilha (que filtraria por uma vigência que a
 * soma acima já deixou de ser). Em vez disso abre `DetalheDoIntervalo`, que
 * decompõe a soma vigência a vigência, e só ali oferece o link para cada uma.
 */
function AtributosDeMaiorImpacto({
  byParameter,
  periodicidades,
  onAbrir,
}: {
  byParameter: ParameterRollup[];
  periodicidades: string[];
  onAbrir: (parameterKey: string, periodicidade: string) => void;
}) {
  if (byParameter.length === 0 || periodicidades.length === 0) return null;

  return (
    <section className={cn(CARTAO, "p-5")}>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-accent">
          <BarChart3 className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[0.8125rem] font-bold leading-tight">
            Atributos de maior impacto
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            O que mais somou e o que mais tirou no intervalo inteiro, por periodicidade
          </p>
        </div>
      </div>

      <div className="space-y-7">
        {periodicidades.map((periodicidade) => (
          <RankingDaPeriodicidade
            key={periodicidade}
            periodicidade={periodicidade}
            byParameter={byParameter}
            onAbrir={onAbrir}
          />
        ))}
      </div>
    </section>
  );
}

interface ItemDoRanking extends ParameterRollup {
  valor: number;
}

function RankingDaPeriodicidade({
  periodicidade,
  byParameter,
  onAbrir,
}: {
  periodicidade: string;
  byParameter: ParameterRollup[];
  onAbrir: (parameterKey: string, periodicidade: string) => void;
}) {
  const comValor: ItemDoRanking[] = byParameter
    .map((p) => ({ ...p, valor: p.impact.byPeriodicity[periodicidade] ?? 0 }))
    .filter((p) => p.impact.byPeriodicity[periodicidade] !== undefined && p.valor !== 0);

  if (comValor.length === 0) return null;

  const positivos = comValor.filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor);
  const negativos = comValor.filter((p) => p.valor < 0).sort((a, b) => a.valor - b.valor);
  const teto = Math.max(...comValor.map((p) => Math.abs(p.valor)), 1);

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Impacto em R${periodicitySuffix(periodicidade)}
      </div>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-6">
        <ColunaDeAtributos
          titulo="O que mais somou"
          ganho
          itens={positivos}
          teto={teto}
          periodicidade={periodicidade}
          onAbrir={onAbrir}
        />
        <ColunaDeAtributos
          titulo="O que mais tirou"
          ganho={false}
          itens={negativos}
          teto={teto}
          periodicidade={periodicidade}
          onAbrir={onAbrir}
        />
      </div>
    </div>
  );
}

function ColunaDeAtributos({
  titulo,
  ganho,
  itens,
  teto,
  periodicidade,
  onAbrir,
}: {
  titulo: string;
  ganho: boolean;
  itens: ItemDoRanking[];
  teto: number;
  periodicidade: string;
  onAbrir: (parameterKey: string, periodicidade: string) => void;
}) {
  const cor = ganho ? "text-emerald-700" : "text-red-700";
  const barra = ganho ? "bg-emerald-600" : "bg-red-600";

  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wide mb-3 flex items-center gap-1.5">
        {ganho ? (
          <ArrowUpRight className="w-4 h-4 text-emerald-600" />
        ) : (
          <ArrowDownRight className="w-4 h-4 text-red-600" />
        )}
        {titulo}
      </h3>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum parâmetro {ganho ? "somou" : "tirou"} nesta periodicidade.
        </p>
      ) : (
        <>
          <ol className="space-y-3">
            {itens.slice(0, TOPO).map((item) => (
              <li key={item.parameterKey}>
                <button
                  type="button"
                  onClick={() => onAbrir(item.parameterKey, periodicidade)}
                  aria-label={`Ver o detalhe de ${item.parameterName}`}
                  className="w-full text-left rounded px-1.5 py-1 -mx-1.5 hover:bg-accent transition-colors"
                >
                  <span className="flex-1 min-w-0 block">
                    <span
                      className="block text-sm font-semibold truncate"
                      title={item.parameterName}
                    >
                      {item.parameterName}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate">
                      {item.familyName} · {contar(item.changes, "alteração", "alterações")} em{" "}
                      {contar(item.vehicles, "ativo", "ativos")}
                    </span>
                  </span>
                  <span className="mt-1.5 h-2 w-full block overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", barra)}
                      style={{ width: `${Math.max(2, (Math.abs(item.valor) / teto) * 100)}%` }}
                    />
                  </span>
                  <span className={cn("mt-1 block text-xs font-bold tabular-nums", cor)}>
                    {formatBrlShort(item.valor)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {itens.length > TOPO && (
            <p className="mt-2.5 text-xs text-muted-foreground">
              + {contar(itens.length - TOPO, "outro parâmetro", "outros parâmetros")}{" "}
              {ganho ? "somando" : "tirando"} menos que os acima.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** `3 alterações`, `1 alteração` — o número por extenso com a palavra que ele rege. */
function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}
