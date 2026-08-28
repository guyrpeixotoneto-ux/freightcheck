import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * As contas do produto, buscadas em um lugar só.
 *
 * Duas telas perguntam por elas — o índice de Configurações, para dizer quantas
 * estão ativas na linha de Usuários, e a própria seção de Usuários, para
 * listá-las. No React Query há uma `Query` por chave, com **uma** `queryFn`:
 * duas telas declarando `["users"]` com funções diferentes não são duas
 * consultas, são uma consulta e um empate — quem dispara primeiro dita o
 * comportamento das duas. É o defeito que `lib/contextos.ts` documenta em
 * detalhe, e a lição que fez esta função existir antes de ele se repetir aqui.
 */

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  /** ADMIN gerencia contas; OPERADOR usa o produto. */
  role: string;
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
  disabledBy: string | null;
  openSessions: number;
}

export const CHAVE_DAS_CONTAS = ["users"] as const;

export function useContas(): UseQueryResult<ManagedUser[], Error> {
  return useQuery<ManagedUser[], Error>({
    queryKey: CHAVE_DAS_CONTAS,
    queryFn: () => fetchJson<ManagedUser[]>("/users"),
  });
}
