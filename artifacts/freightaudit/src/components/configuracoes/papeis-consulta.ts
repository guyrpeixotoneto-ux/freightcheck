import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";
import type { Nivel } from "@/lib/permissoes";

/**
 * Os papéis do cadastro, buscados em um lugar só.
 *
 * Três telas perguntam por eles — o índice de Configurações, para dizer quantos
 * são; a seção de Papéis, para listá-los; e a de Usuários, para montar o
 * seletor de papel de cada conta. É a mesma razão de `contas.ts`: no React
 * Query há uma `Query` por chave com **uma** `queryFn`, e três telas
 * declarando `["papeis"]` com funções diferentes não são três consultas — são
 * uma consulta e um empate, decidido por quem montar primeiro.
 */

export interface Papel {
  id: string;
  nome: string;
  descricao: string | null;
  /** Gerencia contas — o antigo ADMIN, agora atributo do papel. */
  gerenciaContas: boolean;
  /** Papel do sistema: não se renomeia, não se apaga, e as permissões se editam. */
  sistema: boolean;
  criadoEm: string;
  criadoPor: string | null;
  /** Quantas contas o usam. Zero é o papel que dá para apagar. */
  contas: number;
  /** Quantas chaves ele restringe. Zero é o papel que alcança tudo. */
  restricoes: number;
}

export interface EventoDoPapel {
  chave: string | null;
  tipo: string;
  nivelAnterior: string | null;
  nivel: string | null;
  detalhe: string | null;
  em: string;
  por: string;
}

export interface DetalheDoPapel {
  papel: Papel;
  permissoes: Record<string, Nivel>;
  historico: EventoDoPapel[];
}

export const CHAVE_DOS_PAPEIS = ["papeis"] as const;

export function usePapeis(): UseQueryResult<Papel[], Error> {
  return useQuery<Papel[], Error>({
    queryKey: CHAVE_DOS_PAPEIS,
    queryFn: () => fetchJson<Papel[]>("/papeis"),
  });
}
