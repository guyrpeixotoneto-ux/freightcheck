import type { UseQueryOptions } from "@tanstack/react-query";
import { fetchJsonOrNull } from "@/lib/api";
import type { Movimentos } from "@/lib/analise";

/**
 * A leitura de `/changes/range` da Linha do Tempo — a pergunta, num lugar só.
 *
 * Três consumidores fazem exatamente esta pergunta ao abrir a tela: o cartão de
 * impacto, o gráfico de alterações e o prefetch da própria página. Enquanto a
 * chave era montada em cada um deles, "a mesma pergunta" era uma coincidência
 * que dependia de os três repetirem a mesma ordem de parâmetros — e uma letra
 * fora do lugar em qualquer um deles vira uma segunda requisição cara, sem
 * ninguém notar, porque as duas respondem certo.
 *
 * Aqui a coincidência vira função: quem quiser o intervalo pede por este
 * caminho, e o React Query enxerga uma pergunta só — um cache, uma requisição
 * em voo.
 */
export function consultaDoIntervalo(
  consulta: URLSearchParams,
  de: string,
  ate: string,
): URLSearchParams {
  const query = new URLSearchParams(consulta);
  query.delete("period");
  query.set("from", de);
  query.set("to", ate);
  return query;
}

export function opcoesDoIntervalo(
  consulta: URLSearchParams,
  de: string,
  ate: string,
): Pick<
  UseQueryOptions<Movimentos | null>,
  "queryKey" | "queryFn" | "staleTime"
> {
  const query = consultaDoIntervalo(consulta, de, ate);
  return {
    queryKey: ["changes-range", query.toString()],
    queryFn: () => fetchJsonOrNull<Movimentos>(`/changes/range?${query}`),
    staleTime: 60_000,
  };
}
