import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonOrNull } from "@/lib/api";
import type { Movimentos } from "@/lib/analise";
import type { FamiliesView } from "@/components/inicio/types";

/**
 * Quantas alterações cada vigência do histórico carrega — a mesma contagem
 * que a Linha do Tempo já apura via `/changes/range`, aqui só reaproveitada
 * para o dropdown de troca de vigência.
 *
 * A vigência mais antiga do histórico não entra no mapa: não há uma anterior
 * contra a qual compará-la, então "quantas alterações" não é uma pergunta com
 * resposta para ela.
 */
export function useAlteracoesPorVigencia(
  view: FamiliesView | null,
  consulta: URLSearchParams,
): Map<string, number> {
  const ordenadas = useMemo(
    () => (view ? [...view.periods].sort((a, b) => a.date.localeCompare(b.date)) : []),
    [view],
  );

  const query = new URLSearchParams(consulta);
  query.delete("period");
  if (ordenadas.length > 0 && view) {
    query.set("from", ordenadas[0].date);
    query.set("to", view.period);
  }

  const movimentos = useQuery({
    queryKey: ["alteracoes-por-vigencia", query.toString()],
    queryFn: () => fetchJsonOrNull<Movimentos>(`/changes/range?${query}`),
    enabled: ordenadas.length > 1,
    staleTime: 60_000,
  });

  return useMemo(
    () => new Map((movimentos.data?.movements ?? []).map((m) => [m.period, m.changes])),
    [movimentos.data],
  );
}
