import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";
import type { Nivel } from "@/lib/permissoes";

/**
 * Os perfis de acesso, buscados em um lugar só.
 *
 * Três telas perguntam por eles — o índice de Configurações, para dizer quantos
 * são; a seção de Permissões, para listá-los e editar o que cada um alcança; e
 * a de Usuários, para montar o seletor de perfil de cada conta. É a mesma razão
 * de `contas.ts`: no React Query há uma `Query` por chave com **uma**
 * `queryFn`, e três telas declarando `["papeis"]` com funções diferentes não são
 * três consultas — são uma consulta e um empate, decidido por quem montar
 * primeiro.
 *
 * **A palavra mudou; a rota, não.** O que a tela chama de *perfil* o banco e a
 * API chamam de `papel` desde a `0082`, e renomear a rota junto seria quebrar
 * todo endereço em uso para ganhar coerência de vocabulário num lugar onde
 * ninguém lê. A tradução acontece aqui, uma vez, e é por isso que a chave da
 * consulta continua sendo `["papeis"]`.
 */

export interface Perfil {
  id: string;
  nome: string;
  descricao: string | null;
  /** Gerencia contas — o antigo ADMIN, agora atributo do perfil. */
  gerenciaContas: boolean;
  /**
   * O piso do perfil: o nível de toda chave sem decisão própria.
   *
   * `EDITAR` em quase todo perfil — a ausência concede, como sempre foi neste
   * produto. `Leitor` nasce `VISUALIZAR`, e é só por causa deste campo que ele
   * é dizível sem uma linha para cada módulo do menu.
   */
  nivelPadrao: Nivel;
  /** Perfil do sistema: não se renomeia, não se apaga, e as permissões se editam. */
  sistema: boolean;
  criadoEm: string;
  criadoPor: string | null;
  /** Quantas contas o usam. Zero é o perfil que dá para apagar. */
  contas: number;
  /** Quantas chaves ele decide fora do piso. Zero é o perfil que é só o piso. */
  restricoes: number;
}

export interface EventoDoPerfil {
  chave: string | null;
  tipo: string;
  nivelAnterior: string | null;
  nivel: string | null;
  detalhe: string | null;
  em: string;
  por: string;
}

export interface DetalheDoPerfil {
  papel: Perfil;
  /**
   * O que o perfil decide, chave a chave — e o piso dele, em `CHAVE_PADRAO`.
   *
   * O piso só aparece quando não é `EDITAR`: o mapa de um perfil que concede é
   * exatamente o que sempre foi, chave a chave e nada mais.
   */
  permissoes: Record<string, Nivel>;
  /**
   * O que a instalação desligou para todo mundo — o botão **Inativar** da
   * matriz. Não é decisão deste perfil e nada que se faça nele a desfaz: a
   * matriz mostra a linha assim, com o gesto que a devolve ao ar.
   */
  universaisDesligadas: string[];
  historico: EventoDoPerfil[];
}

export const CHAVE_DOS_PERFIS = ["papeis"] as const;

export function usePerfis(): UseQueryResult<Perfil[], Error> {
  return useQuery<Perfil[], Error>({
    queryKey: CHAVE_DOS_PERFIS,
    queryFn: () => fetchJson<Perfil[]>("/papeis"),
  });
}
