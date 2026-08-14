import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";

/**
 * Os números que o menu mostra ao lado dos itens.
 *
 * Estavam dentro da `Topbar`, que os escrevia em bolinhas próprias. Saíram para
 * cá com a faixa vermelha: cada número passou a viver junto do item que o
 * resolve, e não em dois lugares da mesma tela — o mesmo algarismo repetido não
 * reforça, obriga a conferir se os dois são o mesmo, e duas consultas com
 * chaves de cache diferentes bastariam para não serem.
 *
 * A regra dos três é uma só, e é a que já valia: **contagem que não conta nada
 * não vira bolinha.** Zero com desenho de alerta ensina o olho a ignorar
 * justamente o lugar onde o número importante vai aparecer depois. Quem chama
 * decide o que fazer com o zero; nenhum destes ganchos inventa um.
 */

/** Importações que ainda não terminaram. */
export function useImportacoesEmAndamento(): number {
  const { data } = useQuery({
    queryKey: ["imports", "casca"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/imports"));
      if (!response.ok) return [] as { status: string }[];
      const body: unknown = await response.json();
      return Array.isArray(body) ? (body as { status: string }[]) : [];
    },
    staleTime: 30_000,
    retry: false,
  });
  return (data ?? []).filter((i) => i.status !== "PROMOTED" && i.status !== "FAILED").length;
}

/**
 * Atributos monetários ainda sem semântica confirmada — o gargalo do produto,
 * porque é ele que segura impacto financeiro em "não calculável".
 */
export function useCuradoriaPendente(): number {
  const { data } = useQuery({
    queryKey: ["curation", "summary", "casca"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/curation/summary"));
      if (!response.ok) return 0;
      const data = (await response.json()) as {
        byStatus: { status: string; count: number; monetary: number }[];
      };
      return data.byStatus
        .filter((s) => s.status !== "CONFIRMED")
        .reduce((sum, s) => sum + s.monetary, 0);
    },
    staleTime: 60_000,
    retry: false,
  });
  return data ?? 0;
}

/**
 * As alterações de valor da vigência aberta — a soma de todas as séries dela.
 *
 * Lê `/change-sets`, que é uma listagem, e **não** `/changes/latest`, que
 * calcula a comparação que faltar. O menu está em toda página; abrir qualquer
 * tela do produto não pode disparar o cálculo pesado da comparação só para
 * escrever um número ao lado de "Alterações".
 *
 * Soma as séries em vez de pegar a primeira: carreta e cavalo compartilham a
 * data da vigência e são comparações separadas. Mostrar uma delas seria mostrar
 * o número menor e não dizer nada sobre o maior.
 */
export function useAlteracoesDaVigencia(): number {
  const { data } = useQuery({
    queryKey: ["change-sets", "casca"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/change-sets"));
      if (!response.ok) return [] as ChangeSetRow[];
      const body: unknown = await response.json();
      return Array.isArray(body) ? (body as ChangeSetRow[]) : [];
    },
    staleTime: 60_000,
    retry: false,
  });

  const linhas = data ?? [];
  if (linhas.length === 0) return 0;

  const ultima = linhas.reduce(
    (maior, linha) => (dataDaVigencia(linha) > maior ? dataDaVigencia(linha) : maior),
    "",
  );
  return linhas
    .filter((linha) => dataDaVigencia(linha) === ultima)
    .reduce((soma, linha) => soma + Number(linha.value_changes ?? 0), 0);
}

interface ChangeSetRow {
  value_changes: number | string | null;
  snapshot_b_date: string | null;
}

/** A data chega como texto ou como ISO, conforme o driver; comparar texto basta. */
function dataDaVigencia(linha: ChangeSetRow): string {
  return String(linha.snapshot_b_date ?? "").slice(0, 10);
}
