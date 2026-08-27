import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonOrNull } from "@/lib/api";
import type { Movimentos, RangeOverview } from "@/lib/analise";
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

  /*
    Mesma chave de `LinhaDoTempoDeImpacto` e `LinhaDoTempoDeAlteracoes` — as
    três leem `/changes/range` do início ao fim do histórico do contexto no
    carregamento inicial da tela. Chaves próprias por componente faziam o
    React Query disparar a mesma requisição cara três vezes; com a chave
    alinhada por parâmetros, a primeira a resolver serve as outras duas do
    cache.
  */
  const movimentos = useQuery({
    queryKey: ["changes-range", query.toString()],
    queryFn: () => fetchJsonOrNull<Movimentos>(`/changes/range?${query}`),
    enabled: ordenadas.length > 1,
    staleTime: 60_000,
  });

  return useMemo(
    () => new Map((movimentos.data?.movements ?? []).map((m) => [m.period, m.changes])),
    [movimentos.data],
  );
}

/**
 * A mesma contagem em Visão Geral — somada entre todas as unidades.
 *
 * Vem de `/changes/range/overview`, que já lê o intervalo inteiro por unidade
 * × contexto para o ranking "Onde está o impacto?" da Linha do Tempo e agora
 * devolve também `changes` por competência na série consolidada. Somar no
 * navegador exigiria a lista de alterações de N unidades para escrever seis
 * números.
 *
 * `habilitado` existe porque essa leitura é cara: os quatro cabeçalhos que
 * abrem este seletor (Visão Geral, Linha do Tempo, Dashboard e Gestão à Vista)
 * a disparam **quando o menu abre**, e não ao carregar a tela. O menu já está
 * em tela quando a resposta chega; a coluna aparece com ela, como no seletor
 * da unidade enquanto `/changes/range` não voltou.
 */
export function useAlteracoesPorVigenciaGeral(
  periodos: string[],
  habilitado = true,
): Map<string, number> {
  const ordenadas = useMemo(() => [...periodos].sort((a, b) => a.localeCompare(b)), [periodos]);

  const query = new URLSearchParams();
  if (ordenadas.length > 1) {
    query.set("from", ordenadas[0]);
    query.set("to", ordenadas[ordenadas.length - 1]);
  }

  /*
    A mesma chave de `LinhaDoTempoDeImpacto` — quando as pontas do intervalo
    coincidem, uma resposta serve as duas telas em vez de duas varreduras
    iguais do histórico inteiro.
  */
  const overview = useQuery({
    queryKey: ["linha-do-tempo-overview", query.toString()],
    queryFn: () => fetchJsonOrNull<RangeOverview>(`/changes/range/overview?${query}`),
    enabled: habilitado && ordenadas.length > 1,
    staleTime: 60_000,
  });

  return useMemo(
    () => new Map((overview.data?.serie ?? []).map((p) => [p.period, p.changes])),
    [overview.data],
  );
}
