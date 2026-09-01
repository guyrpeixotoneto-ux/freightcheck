import { ApiError, fetchJson } from "@/lib/api";
import { LEITURA_DE_APURACAO } from "@/lib/frescor-das-leituras";
import type { FamiliesView } from "@/components/inicio/types";

/**
 * A leitura da vigência aberta — a mesma consulta, e a **mesma chave de
 * cache**, para as duas telas do Dashboard.
 *
 * O Impacto Líquido e o Impacto Apurado respondem perguntas diferentes sobre
 * exatamente a mesma resposta do servidor (`GET /changes/families`). Enquanto
 * cada um montasse a própria `queryKey`, trocar de um módulo para o outro
 * refazia uma varredura que já estava em memória — e, pior, abria a porta para
 * os dois lerem vigências diferentes durante os 150 ms em que uma das duas
 * ainda não respondeu. Duas telas do mesmo menu publicando dois impactos
 * líquidos da mesma unidade é o defeito que este produto existe para não ter.
 *
 * A chave começa em `families` e carrega a consulta inteira — unidade, canal e
 * vigência —, que é o que identifica o recorte. O `"dashboard"` no meio é
 * histórico: era a chave que o Impacto Líquido já usava, e mantê-la letra por
 * letra é o que faz o cache existente continuar servindo quem já está com a
 * tela aberta.
 */
export function chaveDaVigencia(consulta: URLSearchParams): string[] {
  return ["families", "dashboard", consulta.toString()];
}

/** `?a=1&b=2`, ou vazio — o sufixo que a rota recebe. */
export function sufixoDaConsulta(consulta: URLSearchParams): string {
  const texto = consulta.toString();
  return texto ? `?${texto}` : "";
}

/**
 * O recorte que viaja na URL das telas do Dashboard — unidade, canal e
 * vigência, e nada mais.
 *
 * O que a tela guarda em `?familia=`, `?mudancas=` ou `?janela=` é estado de
 * leitura, não recorte: mandá-lo ao servidor mudaria a chave de cache sem
 * mudar a resposta, e cada clique numa gaveta refaria a varredura da vigência.
 */
export function consultaDoRecorte(search: string | URLSearchParams): URLSearchParams {
  const parametros = typeof search === "string" ? new URLSearchParams(search) : search;
  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  return consulta;
}

/**
 * As opções do React Query para a vigência aberta.
 *
 * O 404 vira `null` — "nenhuma vigência importada ainda" é uma resposta sobre o
 * acervo, e não uma falha da tela: quem chama distingue os dois casos e mostra
 * a página de banco vazio em vez da de erro.
 */
export function opcoesDaVigencia(consulta: URLSearchParams) {
  const sufixo = sufixoDaConsulta(consulta);
  return {
    queryKey: chaveDaVigencia(consulta),
    ...LEITURA_DE_APURACAO,
    queryFn: async (): Promise<FamiliesView | null> => {
      try {
        return await fetchJson<FamiliesView>(`/changes/families${sufixo}`);
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
  };
}
