import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError, fetchJson } from "@/lib/api";
import type { FamiliesOverview } from "@/components/inicio/types";

/**
 * `GET /changes/families/overview?period=` — uma consulta só, com um dono.
 *
 * A Visão Geral aparece em quatro telas (Resumo executivo, Linha do Tempo,
 * Dashboard, Gestão à Vista) e as quatro pedem a mesma competência com a mesma
 * chave (`["families", "overview", period]`). Chave igual é a mesma consulta
 * no cache do React Query — **um** objeto `Query`, com **uma** `queryFn` e
 * **uma** política de repetição —, e antes desta função cada tela escrevia a
 * sua própria `queryFn`, textualmente parecida e nunca garantida idêntica (ver
 * `lib/__tests__/chave-compartilhada.test.ts`, que existe por causa de
 * exatamente este defeito em `["contexts"]`). Esta função é o lugar único: quem
 * precisar de comportamento diferente (como o `refetchInterval` da Gestão à
 * Vista) passa uma opção, e nunca reescreve a busca.
 */
export function useFamiliesOverviewQuery(
  period: string | null,
  { enabled = true, refetchInterval }: { enabled?: boolean; refetchInterval?: number } = {},
): UseQueryResult<FamiliesOverview | null> {
  return useQuery({
    queryKey: ["families", "overview", period],
    enabled: enabled && period !== null,
    refetchInterval,
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesOverview>(
          `/changes/families/overview?period=${encodeURIComponent(period!)}`,
        );
      } catch (erro) {
        // 404 aqui quer dizer "nenhuma unidade tem essa competência" de
        // verdade — o servidor só devolve isso quando não há vigência
        // nenhuma para o período pedido, nunca quando existe mas não deu
        // para consolidar (aí a resposta é 200 com `unitsIncluded: []`).
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
  });
}
