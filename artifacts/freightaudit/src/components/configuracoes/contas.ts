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
  /**
   * O arquivamento — quando a conta saiu da lista, e por quem.
   *
   * `null` nos dois é toda conta que ninguém arquivou. Arquivar não apaga e não
   * tira acesso: só se arquiva quem já está desativado, e o que muda é a lista,
   * que passa a esconder essas contas até alguém pedir para vê-las.
   */
  archivedAt: string | null;
  archivedBy: string | null;
  openSessions: number;
  /**
   * A lotação da pessoa — cargo e unidade, do cadastro da casa.
   *
   * Vem com `id` **e** nome porque a tela usa os dois e por razões diferentes:
   * o `id` é o que ela devolve ao editar, e o nome é o que ela mostra e por
   * onde agrupa a lista. `null` nos dois é o estado normal de quem entrou antes
   * de alguém dizer o que faz e onde — a lista mostra essas contas no grupo
   * "Sem cargo" em vez de as esconder.
   */
  cargoId: string | null;
  cargoNome: string | null;
  /**
   * O departamento, lido **através do cargo** — não há coluna de departamento na
   * conta, e é de propósito: departamento é atributo do cargo, e uma segunda
   * cópia aqui permitiria alguém no Comercial com um cargo da Controladoria.
   * Muda-se trocando o cargo da pessoa, ou o departamento do cargo.
   */
  departamentoId: string | null;
  departamentoNome: string | null;
  unidadeId: string | null;
  unidadeNome: string | null;
  /** O telefone, como foi ditado. `null` é quem não deu o número. */
  telefone: string | null;
  /**
   * A quem a pessoa reporta — o organograma, com `id` e nome pela mesma razão
   * do cargo. `null` nos dois é o topo, que é resposta e não lacuna.
   */
  gestorId: string | null;
  gestorNome: string | null;
}

export const CHAVE_DAS_CONTAS = ["users"] as const;

export function useContas(): UseQueryResult<ManagedUser[], Error> {
  return useQuery<ManagedUser[], Error>({
    queryKey: CHAVE_DAS_CONTAS,
    queryFn: () => fetchJson<ManagedUser[]>("/users"),
  });
}
