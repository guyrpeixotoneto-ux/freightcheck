import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined } from "lucide-react";
import { fetchJsonOrNull } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import type { Movimentos, RangeMovement } from "@/lib/analise";

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

      {periodicidades.length === 0 ? (
        <ContagemPorVigencia linhas={linhas} />
      ) : (
        <div className="space-y-5">
          {periodicidades.map((periodicidade) => (
            <BarraDaPeriodicidade
              key={periodicidade}
              periodicidade={periodicidade}
              linhas={linhas}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BarraDaPeriodicidade({
  periodicidade,
  linhas,
}: {
  periodicidade: string;
  linhas: RangeMovement[];
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
            <div
              key={linha.period}
              className="grid grid-cols-[7rem_1fr_9rem_5.5rem] items-center gap-3 text-sm"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Quando nenhuma vigência do intervalo tem impacto apurado: a mesma linha do tempo, contando alterações. */
function ContagemPorVigencia({ linhas }: { linhas: RangeMovement[] }) {
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
            <div
              key={linha.period}
              className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3 text-sm"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
