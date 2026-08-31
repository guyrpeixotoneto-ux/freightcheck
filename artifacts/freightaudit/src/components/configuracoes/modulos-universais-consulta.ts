import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * O que a instalação desligou, buscado em um lugar só.
 *
 * Duas telas perguntam: o índice de Configurações, para dizer numa linha quanto
 * do produto está fora do ar, e a seção de Módulos Universais, para ligar e
 * desligar. É a mesma razão de `contas.ts` e `papeis-consulta.ts` — no React
 * Query há uma `Query` por chave com **uma** `queryFn`, e duas telas declarando
 * `["modulos-universais"]` com funções diferentes não são duas consultas: são
 * uma consulta e um empate, decidido por quem montar primeiro.
 */

export interface ModuloDesligado {
  /** O `href` do item no menu, ou `@ambiente`. */
  chave: string;
  desligadoEm: string;
  desligadoPor: string;
  motivo: string | null;
}

export interface EventoUniversal {
  chave: string;
  /** `false` é o desligamento; `true`, a volta ao menu. */
  ligado: boolean;
  motivo: string | null;
  em: string;
  por: string;
}

export interface ModulosUniversais {
  desligadas: ModuloDesligado[];
  /** As chaves que o servidor recusa desligar — hoje, `/configuracoes`. */
  protegidas: string[];
  historico: EventoUniversal[];
}

export const CHAVE_DOS_MODULOS_UNIVERSAIS = ["modulos-universais"] as const;

export function useModulosUniversais(): UseQueryResult<
  ModulosUniversais,
  Error
> {
  return useQuery<ModulosUniversais, Error>({
    queryKey: CHAVE_DOS_MODULOS_UNIVERSAIS,
    queryFn: () => fetchJson<ModulosUniversais>("/modulos-universais"),
  });
}
