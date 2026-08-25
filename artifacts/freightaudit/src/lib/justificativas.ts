import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";

/**
 * O que o Plano de Ação — Justificativas e a tela de detalhe por placa têm em
 * comum: o tipo da justificativa, a lista de vigências para o seletor, e a
 * leitura das justificativas já gravadas de uma comparação. Extraído para cá
 * quando a segunda tela (`justificativas-placa.tsx`) passou a precisar do
 * mesmo tipo e da mesma consulta que `justificativas.tsx` já tinha.
 */
export interface Justificativa {
  id: string;
  changeSetId: string;
  changeId: number;
  entityLabel: string;
  entityType: string | null;
  texto: string;
  criadoPor: string;
  criadoEm: string;
}

/** Uma comparação já calculada, como `/change-sets` a lista — colunas em snake_case, é SQL cru. */
interface ChangeSetRow {
  id: string;
  snapshot_b_label: string | null;
  snapshot_b_date: string | null;
}

export interface Comparacao {
  id: string;
  snapshotBLabel: string;
  snapshotBDate: string;
}

/** `2026-08-01` → `01/08/26`. */
export function dataCurta(iso: string): string {
  const dia = iso.slice(0, 10);
  const [ano, mes, d] = dia.split("-");
  return ano && mes && d ? `${d}/${mes}/${ano.slice(2)}` : iso;
}

/**
 * As comparações já calculadas, mais recente primeiro — a mesma listagem que
 * `useAlteracoesDaVigencia` (`components/layout/contadores.ts`) lê, e pelo
 * mesmo motivo: é leitura de tabela, não o cálculo sob demanda de
 * `/changes/latest`. O seletor de vigência não pode disparar esse cálculo só
 * por estar em tela.
 */
export function useComparacoes() {
  return useQuery({
    queryKey: ["change-sets", "justificativas"],
    queryFn: async () => {
      const rows = await fetchJson<ChangeSetRow[]>("/change-sets");
      return rows.map(
        (r): Comparacao => ({
          id: String(r.id),
          snapshotBLabel: r.snapshot_b_label ?? "",
          snapshotBDate: r.snapshot_b_date ?? "",
        }),
      );
    },
  });
}

/** As justificativas de uma comparação, por `changeId` — sempre a mais recente. */
export function useJustificadaPor(changeSetId: string | undefined) {
  const consulta = useConsultaResiliente<{ justificativas: Justificativa[] }>({
    queryKey: ["justificativas", changeSetId],
    endpoint: "/justificativas",
    buscar: () =>
      fetchJson<{ justificativas: Justificativa[] }>(
        `/justificativas?changeSetId=${changeSetId}`,
      ),
    enabled: !!changeSetId,
  });

  const justificadaPor = useMemo(() => {
    const mapa = new Map<number, Justificativa>();
    for (const j of consulta.dados?.justificativas ?? []) mapa.set(j.changeId, j);
    return mapa;
  }, [consulta.dados]);

  return { justificadaPor, consulta };
}
