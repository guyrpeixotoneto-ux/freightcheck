import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizarEquipamento } from "@workspace/curation/equipamento";
import { rotuloCurtoDaVigencia } from "@workspace/comparison/labels";

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
  /** Quantas alterações de valor a comparação apurou — a mesma coluna que a bolinha do menu soma. */
  value_changes: number | string | null;
  /** De qual contexto é esta comparação — o que dá nome à unidade no seletor. */
  snapshot_b_scope_hash: string | null;
}

export interface Comparacao {
  id: string;
  snapshotBLabel: string;
  snapshotBDate: string;
  /** Ver `ChangeSetRow.value_changes`. */
  alteracoes: number;
  scopeHash: string | null;
}

/**
 * As comparações já calculadas, mais recente primeiro — a mesma listagem que
 * `useAlteracoesDaVigencia` (`components/layout/contadores.ts`) lê, e pelo
 * mesmo motivo: é leitura de tabela, não o cálculo sob demanda de
 * `/changes/latest`. O seletor de vigência não pode disparar esse cálculo só
 * por estar em tela.
 */
/** `2026-08-01` → `01/08/26`, como a planilha do cliente escreve. */
export function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano.slice(2)}` : iso;
}

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
          alteracoes: Number(r.value_changes ?? 0),
          scopeHash: r.snapshot_b_scope_hash ?? null,
        }),
      );
    },
  });
}

/**
 * As comparações como o seletor de vigência as escreve.
 *
 * O seletor listava `EMPURRADA_2_8_2026 · 02/08/26` — o rótulo do arquivo
 * importado, que é o mesmo texto em todas as unidades da mesma data. Com cinco
 * unidades no acervo, a lista abria com cinco linhas idênticas para cada
 * competência e nenhuma pista de qual era qual: escolher ali era chutar.
 *
 * O formato agora é o dos demais seletores de vigência do produto (ver
 * `components/vigencia/seletor-de-vigencia.tsx`): a competência à esquerda, no
 * mesmo `rotuloCurtoDaVigencia` que o resto da casa usa, e quantas alterações
 * a comparação apurou à direita. A unidade entra junto da data porque aqui —
 * ao contrário do cabeçalho, que já está dentro de uma unidade — a lista
 * atravessa todas elas, e sem ela duas linhas continuariam indistinguíveis.
 *
 * O nome da unidade vem de `/contexts`, casado pelo `scope_hash` da vigência
 * comparada. Quando a lista de contextos ainda não chegou (ou a vigência é
 * anterior à coluna), a linha fica só com a data e a contagem — nada aqui
 * inventa nome de unidade.
 */
export interface OpcaoDeVigencia {
  id: string;
  /** `02/08/2026` — a mesma régua dos outros seletores. */
  competencia: string;
  /** `PERNAMBUCO · EMPURRADA`, quando `/contexts` sabe dizer. */
  unidade: string | null;
  alteracoes: number;
}

export function opcoesDeVigencia(
  comparacoes: Comparacao[],
  contextos: { scopeHash: string; label: string }[],
): OpcaoDeVigencia[] {
  const datas = comparacoes.map((c) => c.snapshotBDate.slice(0, 10));
  const nomePorEscopo = new Map<string, string>();
  for (const contexto of contextos) {
    if (!nomePorEscopo.has(contexto.scopeHash)) nomePorEscopo.set(contexto.scopeHash, contexto.label);
  }

  return comparacoes.map((comparacao) => ({
    id: comparacao.id,
    competencia: rotuloCurtoDaVigencia(comparacao.snapshotBDate.slice(0, 10), datas),
    unidade: comparacao.scopeHash ? (nomePorEscopo.get(comparacao.scopeHash) ?? null) : null,
    alteracoes: comparacao.alteracoes,
  }));
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
