import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDownRight, ArrowUpRight, BarChart3, ChartNoAxesCombined } from "lucide-react";
import { fetchJsonOrNull } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { linkDeAlteracoes, type Recorte } from "@/lib/recorte";
import type { Movimentos, ParameterRollup, RangeMovement } from "@/lib/analise";

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

  const query = new URLSearchParams(consulta);
  query.delete("period");
  if (primeira) query.set("from", primeira);
  query.set("to", currentPeriod);

  const movimentos = useQuery({
    queryKey: ["linha-do-tempo-de-impacto", query.toString()],
    queryFn: () => fetchJsonOrNull<Movimentos>(`/changes/range?${query}`),
    enabled: ordenadas.length > 1,
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

        <ResumoDoIntervalo dados={dados} periodicidades={periodicidades} />

        {periodicidades.length === 0 ? (
          <ContagemPorVigencia linhas={linhas} recorteBase={recorteBase} />
        ) : (
          <div className="space-y-5">
            {periodicidades.map((periodicidade) => (
              <BarraDaPeriodicidade
                key={periodicidade}
                periodicidade={periodicidade}
                linhas={linhas}
                recorteBase={recorteBase}
              />
            ))}
          </div>
        )}
      </section>

      <AtributosDeMaiorImpacto byParameter={dados.byParameter} periodicidades={periodicidades} />
    </>
  );
}

/**
 * A balança consolidada do intervalo — o número que o resto da tela existe
 * para explicar, uma periodicidade por vez.
 *
 * Fica no topo, antes da lista vigência a vigência, porque é a primeira
 * pergunta de quem abre a tela: "no total, este intervalo foi bom ou ruim, e
 * por quanto?" A barra verde/vermelha mede o mesmo que `Balanca` mede no
 * painel de Composição — movimento, não saldo — e pela mesma razão: o
 * líquido sozinho não diz se ele veio de um empate quase perfeito ou de um
 * caminho sem perda nenhuma.
 */
function ResumoDoIntervalo({
  dados,
  periodicidades,
}: {
  dados: Movimentos;
  periodicidades: string[];
}) {
  if (periodicidades.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-5">
      {periodicidades.map((periodicidade) => {
        const liquido = dados.impact.byPeriodicity[periodicidade] ?? 0;
        const ganhos = dados.gainsByPeriodicity[periodicidade] ?? 0;
        const perdas = dados.lossesByPeriodicity[periodicidade] ?? 0;
        const movimento = ganhos + Math.abs(perdas);
        const fatiaVerde = movimento === 0 ? null : (ganhos / movimento) * 100;

        return (
          <div key={periodicidade} className="flex-1 min-w-[13rem] rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Líquido consolidado em R${periodicitySuffix(periodicidade)}
            </div>
            <div
              className={cn(
                "text-xl font-extrabold tabular-nums mt-1",
                liquido < 0 ? "text-red-700" : liquido > 0 ? "text-emerald-700" : "",
              )}
            >
              {formatBrlShort(liquido)}
            </div>

            {fatiaVerde !== null && (
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted flex">
                <div className="h-full bg-emerald-600" style={{ width: `${fatiaVerde}%` }} />
                <div className="h-full bg-red-600" style={{ width: `${100 - fatiaVerde}%` }} />
              </div>
            )}

            <div className="mt-2 flex items-center justify-between text-xs font-semibold">
              <span className="text-emerald-700">{formatBrlShort(ganhos)}</span>
              <span className="text-red-700">{formatBrlShort(perdas)}</span>
            </div>
          </div>
        );
      })}

      <div className="flex-1 min-w-[13rem] rounded-lg border p-4 bg-muted/30">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Alterações no intervalo
        </div>
        <div className="text-xl font-extrabold tabular-nums mt-1">
          {dados.totals.changes.toLocaleString("pt-BR")}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          {contar(dados.totals.changes, "alteração", "alterações")} em{" "}
          {contar(dados.totals.vehiclesTouched, "ativo", "ativos")}
        </div>
      </div>
    </div>
  );
}

function BarraDaPeriodicidade({
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

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Impacto em R${periodicitySuffix(periodicidade)}
      </div>
      <div className="space-y-1.5">
        {linhas.map((linha) => {
          const valor = linha.impact.byPeriodicity[periodicidade];
          const largura = valor === undefined ? 0 : (Math.abs(valor) / teto) * 100;
          const destaque = maior && linha.period === maior.period && largura > 0;
          return (
            <Link
              key={linha.period}
              href={linkDeAlteracoes({
                recorte: { ...recorteBase, period: linha.period },
              })}
              aria-label={`Ver as alterações de ${linha.label}`}
              title="Ver as alterações desta vigência"
              className="grid grid-cols-[7rem_1fr_9rem_5.5rem] items-center gap-3 text-sm rounded px-1 -mx-1 hover:bg-accent transition-colors"
            >
              <span
                className={cn("truncate", destaque ? "font-bold" : "text-muted-foreground")}
              >
                {linha.label}
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
                {valor === undefined ? (
                  linha.changes === 0 ? (
                    "sem alteração"
                  ) : (
                    "sem valoração"
                  )
                ) : (
                  <>
                    {formatBrlShort(valor)}
                    {destaque && (
                      <span className="text-muted-foreground font-normal"> ← maior</span>
                    )}
                  </>
                )}
              </span>

              <span className="text-right tabular-nums text-xs text-muted-foreground">
                {linha.changes.toLocaleString("pt-BR")}{" "}
                {linha.changes === 1 ? "alteração" : "alterações"}
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
 * Cada lista é a **soma no intervalo**, não uma vigência só — por isso as linhas
 * não levam a lugar nenhum: um clique que abrisse Planilha filtraria por uma
 * vigência que a soma acima já deixou de ser.
 */
function AtributosDeMaiorImpacto({
  byParameter,
  periodicidades,
}: {
  byParameter: ParameterRollup[];
  periodicidades: string[];
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
}: {
  periodicidade: string;
  byParameter: ParameterRollup[];
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
        <ColunaDeAtributos titulo="O que mais somou" ganho itens={positivos} teto={teto} />
        <ColunaDeAtributos titulo="O que mais tirou" ganho={false} itens={negativos} teto={teto} />
      </div>
    </div>
  );
}

function ColunaDeAtributos({
  titulo,
  ganho,
  itens,
  teto,
}: {
  titulo: string;
  ganho: boolean;
  itens: ItemDoRanking[];
  teto: number;
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
