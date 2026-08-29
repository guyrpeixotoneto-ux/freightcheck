import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";
import { chaveDosFluxos } from "@/lib/fluxos";

/**
 * A ARRUMAÇÃO DOS RESPONSÁVEIS EM TEXTO, do lado da tela.
 *
 * O motor mora em `lib/fluxos/src/arrumacao.ts`, e é lá que estão as decisões:
 * o agrupamento pela identidade do nome, a sugestão por casamento exato (ou
 * nenhuma), e o `UPDATE` que nunca sobrescreve vínculo já escolhido. Aqui só há
 * as duas chamadas e a invalidação do que elas mudam.
 *
 * A invalidação é ampla de propósito: uma arrumação em lote muda `area` e
 * `responsavel` de dezenas de etapas espalhadas por vários fluxos, e não há
 * como saber quais sem reler. Invalidar `["fluxos", empresaId]` derruba a lista
 * e todos os fluxos abertos daquela empresa, que é exatamente o conjunto que
 * pode ter mudado.
 */

export type EscopoDoTexto = "AREA" | "RESPONSAVEL" | "ITEM";
export type TipoDeVinculo = "DEPARTAMENTO" | "CARGO" | "PESSOA";

export interface SugestaoDeVinculo {
  tipo: TipoDeVinculo;
  id: string;
  nome: string;
}

export interface ResponsavelEmTexto {
  escopo: EscopoDoTexto;
  /** A identidade do agrupamento, e o que a aplicação manda de volta. */
  textoCanonico: string;
  /** As grafias encontradas, como foram digitadas — a prova do problema. */
  grafias: string[];
  ocorrencias: number;
  sugestao: SugestaoDeVinculo | null;
}

export interface AchadosDaArrumacao {
  empresaId: string;
  achados: ResponsavelEmTexto[];
}

export const chaveDaArrumacao = (empresaId: string | null) => ["arrumacao", "responsaveis", empresaId];

export function useResponsaveisEmTexto(
  empresaId: string | null,
  habilitado: boolean,
): UseQueryResult<AchadosDaArrumacao, Error> {
  return useQuery<AchadosDaArrumacao, Error>({
    queryKey: chaveDaArrumacao(empresaId),
    enabled: habilitado && empresaId !== null,
    queryFn: () =>
      fetchJson<AchadosDaArrumacao>(
        `/arrumacao/responsaveis?empresaId=${encodeURIComponent(empresaId ?? "")}`,
      ),
  });
}

export interface PedidoDeArrumacao {
  escopo: EscopoDoTexto;
  textoCanonico: string;
  departamentoId?: string | null;
  cargoId?: string | null;
  pessoaId?: string | null;
}

export function useAplicarArrumacao(empresaId: string | null) {
  const cliente = useQueryClient();
  return useMutation<{ alteradas: number; nome: string }, Error, PedidoDeArrumacao>({
    mutationFn: (pedido) =>
      fetchJson<{ alteradas: number; nome: string }>(
        `/arrumacao/responsaveis/aplicar?empresaId=${encodeURIComponent(empresaId ?? "")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pedido),
        },
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: chaveDaArrumacao(empresaId) });
      void cliente.invalidateQueries({ queryKey: ["fluxos", empresaId] });
      void cliente.invalidateQueries({ queryKey: chaveDosFluxos(empresaId, true) });
      void cliente.invalidateQueries({ queryKey: chaveDosFluxos(empresaId, false) });
    },
  });
}
