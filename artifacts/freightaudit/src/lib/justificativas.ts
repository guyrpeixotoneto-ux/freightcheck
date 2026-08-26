import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizarEquipamento } from "@workspace/curation/equipamento";

import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import { EQUIPAMENTOS, rotuloDoTipo } from "@/lib/frota";

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

// ---------------------------------------------------------------------------
// As abas por tipo de ativo
// ---------------------------------------------------------------------------

/**
 * O mínimo de que a divisão em abas precisa de cada placa agrupada.
 *
 * `entityType` é `string | null` porque é assim que a comparação o devolve —
 * `entity_type` é texto livre no banco de propósito, e a linha pode vir sem
 * tipo nenhum.
 */
export interface PlacaComTipo {
  entityType: string | null;
}

export interface AbaDeTipo {
  /** `null` na aba "Todas" — o recorte que não recorta. */
  tipo: string | null;
  rotulo: string;
  /** Quantas placas da vigência caem nela. */
  total: number;
}

/**
 * As abas do Plano de Ação: "Todas", os três tipos com tela 360° e o que mais
 * a vigência trouxer.
 *
 * A tela agrupava por placa e mostrava o tipo como etiqueta dentro do card —
 * o que respondia "de que é esta placa" e não "o que mudou nos trechos". São
 * perguntas diferentes: justificar é um trabalho por tipo de ativo (quem
 * explica reajuste de cavalo não é quem explica quilometragem de trecho), e
 * sem o recorte a fila chegava misturada, com o gestor rolando 36 cards para
 * achar os seis que são dele.
 *
 * Os três fixos aparecem **mesmo vazios**, pela razão de
 * `abasDeEquipamento` (`lib/curadoria.ts`): uma aba escrita `Trecho 0` diz
 * "nenhum trecho mudou nesta vigência"; a ausência da aba deixa em aberto se
 * a vigência não mexeu em trecho ou se a tela não sabe mostrá-lo. Um tipo que
 * não está na lista — o `DOLLY` que um dia venha do Freightech — entra depois
 * deles, em ordem alfabética, sem mudança nenhuma aqui.
 *
 * O total conta **placas**, e não alterações, porque é a placa que o card
 * representa: `Trecho 6` que abre com seis cards é a aba dizendo a verdade
 * sobre o que há atrás dela; contando alterações, ela prometeria dezesseis
 * cards e mostraria seis.
 */
export function abasDeTipo(placas: readonly PlacaComTipo[]): AbaDeTipo[] {
  const contagem = new Map<string, number>();
  for (const placa of placas) {
    const tipo = normalizarEquipamento(placa.entityType);
    if (tipo === null) continue;
    contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1);
  }

  const fixas: string[] = [...EQUIPAMENTOS];
  const extras = [...contagem.keys()]
    .filter((tipo) => !fixas.includes(tipo))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return [
    { tipo: null, rotulo: "Todas", total: placas.length },
    ...[...fixas, ...extras].map((tipo) => ({
      tipo,
      rotulo: rotuloDoTipo(tipo),
      total: contagem.get(tipo) ?? 0,
    })),
  ];
}

/**
 * As placas da aba escolhida — `null` (Todas) não recorta nada.
 *
 * A comparação com o tipo passa pela mesma normalização das abas: a escolha
 * viaja no endereço, e um link escrito à mão com `?tipo=cavalo` tem de abrir
 * a mesma lista que o clique abre.
 */
export function placasDaAba<T extends PlacaComTipo>(
  placas: readonly T[],
  tipo: string | null,
): T[] {
  if (tipo === null) return [...placas];
  const alvo = normalizarEquipamento(tipo);
  return placas.filter((p) => normalizarEquipamento(p.entityType) === alvo);
}
