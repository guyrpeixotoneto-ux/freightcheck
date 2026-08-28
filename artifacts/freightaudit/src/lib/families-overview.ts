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
  {
    enabled = true,
    refetchInterval,
    comParametros = false,
  }: {
    enabled?: boolean;
    refetchInterval?: number;
    /**
     * Pedir a árvore de Parâmetros junto — só a tela de Parâmetros pede.
     *
     * Ela **entra na chave**, e não só na URL: a resposta com a árvore e a sem
     * são conteúdos diferentes, e no React Query a chave *é* a identidade da
     * consulta. Sem isto, a tela de Parâmetros leria do cache a resposta magra
     * que o Dashboard tivesse buscado antes — `parametros: null` — e concluiria,
     * errado, que nenhuma unidade pôde ser consolidada.
     */
    comParametros?: boolean;
  } = {},
): UseQueryResult<FamiliesOverview | null> {
  return useQuery({
    queryKey: ["families", "overview", period, comParametros],
    enabled: enabled && period !== null,
    refetchInterval,
    // Mesmo padrão das outras queries desta tela (`comparacao`, `balancos`,
    // `importacoes`): a leitura soma todas as unidades no servidor e é cara —
    // sem isto, cada navegação de volta à Visão Geral reprocessava tudo do
    // zero mesmo que nada tivesse mudado nos últimos segundos.
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesOverview>(
          `/changes/families/overview?period=${encodeURIComponent(period!)}` +
            (comParametros ? "&parametros=1" : ""),
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
