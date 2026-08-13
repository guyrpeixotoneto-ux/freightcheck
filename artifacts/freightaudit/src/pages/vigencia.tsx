import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrlShort, impactEntries, periodicitySuffix } from "@/lib/format";
import { GroupCard } from "@/components/inicio/group-card";
import type { ChangeGroup, GroupedView } from "@/components/inicio/types";

/**
 * Acompanhamento de vigência — a tela.
 *
 * A ordem da página é a ordem da pergunta: **mudou → o que merece atenção →
 * quanto custa → em quantos veículos → detalhe → origem**. Nada acima de um
 * cartão existe para ser bonito; o veredicto é uma frase, o impacto são duas
 * linhas, e o resto da altura é dos cartões.
 *
 * Duas coisas que esta tela recusa a fazer:
 *
 * 1. **Somar periodicidades.** R$/mês e R$/ano aparecem lado a lado, sempre.
 * 2. **Confundir vigência com histórico.** O impacto da vigência tem destaque;
 *    o acumulado das dezesseis comparações fica numa linha própria, com o
 *    período escrito. O Painel anterior exibia o acumulado sob o título de uma
 *    vigência só, e era o número que mais enganava no produto.
 */

/** Grupos que ficam recolhidos: o que o sistema não achou motivo para destacar. */
const COLLAPSED_BADGES = new Set(["SEM_SINAL"]);

export default function Vigencia() {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [showRest, setShowRest] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["grouped", period],
    queryFn: async () => {
      const query = period ? `?period=${period}` : "";
      const response = await fetch(getApiUrl(`/changes/grouped${query}`));
      if (!response.ok) throw new Error((await response.json()).error ?? "Falha ao carregar");
      return (await response.json()) as GroupedView;
    },
  });

  const highlighted = data?.groups.filter((g) => !COLLAPSED_BADGES.has(g.badge)) ?? [];
  const rest = data?.groups.filter((g) => COLLAPSED_BADGES.has(g.badge)) ?? [];

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {data ? `Vigência de ${data.periodLabel}` : "Início"}
            </h1>
            {data && (
              <p className="text-sm mt-1 font-medium">{data.context.label}</p>
            )}
            {data && (
              <p className="text-muted-foreground text-sm mt-1">
                {data.series.map((s, i) => (
                  <span key={s.entityTypeSet}>
                    {i > 0 && " · "}
                    {s.equipment.toLowerCase()}:{" "}
                    <span className="font-mono text-xs">
                      {s.previousLabel ?? "—"} → {s.snapshotLabel}
                    </span>
                  </span>
                ))}
              </p>
            )}
          </div>

          {data && data.periods.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
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

      <div className="p-8 space-y-6 max-w-6xl">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <Verdict view={data} highlighted={highlighted.length} />

            {/*
              Escolher a unidade mais recente por padrão é uma escolha, e uma
              escolha que a tela não mostra é uma omissão. Enquanto houver uma
              unidade só, este aviso não aparece — não há nada a escolher.
            */}
            {data.otherContexts.length > 0 && (
              <div className="flex gap-3 rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>
                  Os números abaixo são de <strong>{data.context.label}</strong>. Há mais{" "}
                  {data.otherContexts.length}{" "}
                  {data.otherContexts.length === 1 ? "contexto" : "contextos"} no banco (
                  {data.otherContexts.map((c) => c.label).join(", ")}), e{" "}
                  <strong>nenhum deles está somado aqui</strong>.
                </p>
              </div>
            )}

            {!data.complete && (
              <div className="flex gap-3 rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>
                  <strong>Visão parcial.</strong> Nesta vigência chegou apenas{" "}
                  {data.series.map((s) => s.equipment.toLowerCase()).join(", ")}. Falta{" "}
                  <strong>{data.missingSeries.join(", ").toLowerCase()}</strong> — os números
                  abaixo cobrem só o que foi entregue, e a série ausente não está contada
                  como zero.
                </p>
              </div>
            )}

            {data.series
              .filter((s) => s.reason !== null)
              .map((s) => (
                <div
                  key={s.entityTypeSet}
                  className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
                >
                  <strong className="text-foreground">{s.equipment}:</strong> {s.reason}
                </div>
              ))}

            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {highlighted.length > 0
                  ? "Mudanças que precisam da sua atenção"
                  : "Nenhuma mudança destacada nesta vigência"}
              </h2>
              {highlighted.map((group) => (
                <GroupCard key={group.key} group={group} period={data.period} />
              ))}
            </section>

            {rest.length > 0 && (
              <section className="space-y-3">
                <button
                  onClick={() => setShowRest(!showRest)}
                  className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                >
                  {showRest ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  e mais {rest.length}{" "}
                  {rest.length === 1 ? "mudança" : "mudanças"} sem sinal relevante
                </button>
                {showRest &&
                  rest.map((group) => (
                    <GroupCard key={group.key} group={group} period={data.period} />
                  ))}
              </section>
            )}

            <Footer view={data} />
          </>
        )}
      </div>
    </Layout>
  );
}

/**
 * O veredicto — a resposta, antes de qualquer detalhe.
 *
 * Uma frase montada por regra determinística a partir das contagens. Nenhum
 * texto aqui é gerado por modelo, e nenhum número aqui é projetado.
 */
function Verdict({ view, highlighted }: { view: GroupedView; highlighted: number }) {
  const impact = impactEntries(view.impact.byPeriodicity);
  const excluded = impactEntries(view.impact.excludedByPeriodicity);
  const accumulated = impactEntries(view.accumulated.byPeriodicity);

  return (
    <section className="rounded-lg border bg-card px-6 py-5 space-y-4">
      <p className="text-lg">
        {view.totals.changes === 0 ? (
          <>O cliente não mexeu em nada nesta vigência.</>
        ) : (
          <>
            O cliente mexeu em <strong>{view.totals.groups}</strong>{" "}
            {view.totals.groups === 1 ? "ponto" : "pontos"} da sua remuneração
            {highlighted > 0 && (
              <>
                . <strong>{highlighted}</strong>{" "}
                {highlighted === 1 ? "merece" : "merecem"} sua atenção
              </>
            )}
            .
          </>
        )}
      </p>

      <div className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Impacto desta vigência
          </div>
          {impact.length === 0 ? (
            <div className="text-xl font-semibold text-muted-foreground mt-0.5">
              nenhum valor apurável
            </div>
          ) : (
            <div className="mt-0.5 space-y-0.5">
              {impact.map((entry) => (
                <div
                  key={entry.periodicity}
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    entry.amount < 0 ? "text-red-700" : "text-emerald-700",
                  )}
                >
                  {formatBrlShort(entry.amount)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {periodicitySuffix(entry.periodicity)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            {view.impact.calculatedChanges - view.impact.excludedChanges} de{" "}
            {view.totals.changes} alterações têm valor apurado · {view.impact.notCalculable} sem
            preço, todas listadas
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Acumulado histórico
          </div>
          <div className="mt-0.5 space-y-0.5">
            {accumulated.length === 0 ? (
              <div className="text-lg text-muted-foreground">nenhum</div>
            ) : (
              accumulated.map((entry) => (
                <div key={entry.periodicity} className="text-lg font-semibold tabular-nums">
                  {formatBrlShort(entry.amount)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {periodicitySuffix(entry.periodicity)}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            soma de {view.accumulated.comparisons} comparações
            {view.accumulated.from && view.accumulated.to && (
              <>
                {" "}
                ({view.accumulated.from} a {view.accumulated.to})
              </>
            )}
            . Não é o valor desta vigência.
          </div>
        </div>
      </div>

      {excluded.length > 0 && (
        <p className="text-xs text-muted-foreground border-t pt-3">
          <strong className="text-foreground">
            {excluded.map((e) => e.label).join(" · ")}
          </strong>{" "}
          ficaram fora do impacto desta vigência ({view.impact.excludedChanges}{" "}
          {view.impact.excludedChanges === 1 ? "alteração" : "alterações"}): são atributos que
          são o total de outros que também mudaram no mesmo veículo, e somá-los contaria o
          mesmo dinheiro duas vezes. Cada caso está explicado no cartão correspondente.
        </p>
      )}
    </section>
  );
}

function Footer({ view }: { view: GroupedView }) {
  return (
    <div className="border-t pt-4 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
      <span>
        {view.totals.unchanged.toLocaleString("pt-BR")} valores não mudaram nesta vigência
      </span>
      <span>{view.totals.vehiclesTouched} veículos com alguma alteração</span>
      {(view.totals.entitiesAdded > 0 || view.totals.entitiesRemoved > 0) && (
        <span>
          frota: +{view.totals.entitiesAdded} / −{view.totals.entitiesRemoved} ativos
        </span>
      )}
      <Link href="/alteracoes" className="text-primary hover:underline">
        ver a lista completa, linha a linha
      </Link>
      <Link href="/curadoria" className="text-primary hover:underline">
        destravar preços na curadoria
      </Link>
    </div>
  );
}

/** Reexportado para os testes de tipo da tela. */
export type { ChangeGroup };
