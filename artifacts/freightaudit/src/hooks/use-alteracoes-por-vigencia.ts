import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonOrNull } from "@/lib/api";
import { opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";
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
 *
 * Onde a tela já faz essa mesma leitura por conta própria — o Dashboard em
 * Visão Geral, para o gráfico de impacto por vigência, e a Linha do Tempo,
 * para o ranking entre unidades —, a chave compartilhada
 * (`opcoesDoIntervaloGeral`) faz a contagem já estar no cache: lá o menu abre
 * com a coluna preenchida, sem esperar requisição nenhuma.
 */
export function useAlteracoesPorVigenciaGeral(
  periodos: string[],
  habilitado = true,
): Map<string, number> {
  const ordenadas = useMemo(() => [...periodos].sort((a, b) => a.localeCompare(b)), [periodos]);

  /*
    A mesma chave de `LinhaDoTempoDeImpacto` e do gráfico do Dashboard em
    Visão Geral (`opcoesDoIntervaloGeral`) — quando as pontas do intervalo
    coincidem, uma resposta serve as três em vez de três varreduras iguais do
    histórico inteiro. É por esse compartilhamento que a contagem do menu do
    Dashboard já está no cache quando alguém abre o menu.
  */
  const overview = useQuery({
    ...opcoesDoIntervaloGeral(
      ordenadas[0] ?? null,
      ordenadas[ordenadas.length - 1] ?? null,
    ),
    enabled: habilitado && ordenadas.length > 1,
  });

  return useMemo(
    () => new Map((overview.data?.serie ?? []).map((p) => [p.period, p.changes])),
    [overview.data],
  );
}
