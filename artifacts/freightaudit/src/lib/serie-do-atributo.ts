import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getApiUrl } from "@/lib/api";
import type { AttributeSeries } from "@/components/inicio/types";

/**
 * `/attributes/:code/series` — uma pergunta, uma consulta, uma política.
 *
 * Mora num lugar só pela regra que `chave-compartilhada.test.ts` prende: no
 * React Query a chave **é** a identidade da consulta, e duas cópias da mesma
 * chave com `queryFn` diferentes não são duplicação — são uma consulta cujo
 * comportamento depende de qual componente montou primeiro. O cartão da Visão
 * geral e a fila do Acompanhamento fazem exatamente esta pergunta, e faziam
 * cada um a sua cópia.
 *
 * As cópias não colidiam por acidente: só uma delas mandava o contexto, então
 * as chaves eram diferentes e o cache as separava. Isso não era segurança —
 * era o defeito. Sem `scopeHash`/`canal` o servidor não fica sem filtro: cai em
 * `contexts[0]`, a unidade com a vigência mais recente, e a série desenhada sob
 * o cartão passava a ser a história do atributo **noutra unidade**. Corrigir a
 * primeira metade fez as chaves coincidirem, que é o que trouxe as duas cópias
 * para cá.
 */
export function useSerieDoAtributo(
  attributeCode: string | null,
  /**
   * Unidade e canal — e o que mais a tela já carregue no contexto, como o
   * recorte De/Até da vigência. Entra na chave, e não só na URL: sem isso duas
   * unidades dividiriam a mesma entrada de cache e trocar de unidade serviria a
   * série da anterior sem ir ao servidor.
   */
  contexto: URLSearchParams,
): UseQueryResult<AttributeSeries | null> {
  return useQuery({
    queryKey: ["attribute-series", attributeCode, contexto.toString()],
    queryFn: async () => {
      const sufixo = contexto.toString() ? `?${contexto}` : "";
      const response = await fetch(
        getApiUrl(`/attributes/${encodeURIComponent(attributeCode ?? "")}/series${sufixo}`),
      );
      if (!response.ok) return null;
      return (await response.json()) as AttributeSeries;
    },
    // Sem atributo não há série: perguntar daria `/attributes//series`.
    enabled: attributeCode !== null,
  });
}
