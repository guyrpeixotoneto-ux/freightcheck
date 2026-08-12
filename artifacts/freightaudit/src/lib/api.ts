/**
 * Returns the full URL for an API endpoint path.
 * In the Replit monorepo, the api-server is mounted at /api.
 *
 * @param path  e.g. "/fleet-analysis/summary" → "/api/fleet-analysis/summary"
 */
export function getApiUrl(path: string): string {
  const base = "/api";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

/**
 * Ler o corpo de uma resposta sem confiar que ela é o que se pediu.
 *
 * Esta função nasceu dentro da tela de Importações e vive aqui porque o defeito
 * que ela evita não era daquela tela: era de toda chamada escrita como
 * `(await fetch(...)).json()`. Um 500 desta API também é JSON — `{"error":
 * "Internal server error"}` — então `.json()` devolve um objeto, a chamada
 * parece ter dado certo, e o objeto de erro segue viagem no lugar dos dados.
 * Duas linhas adiante alguém lê `data.impactByPeriodicity.length`, encontra
 * `undefined`, e o React derruba a árvore inteira: tela branca, com o motivo
 * verdadeiro (o banco) invisível.
 */
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    // Um 5xx de corpo vazio nunca é nosso: toda resposta desta API é JSON,
    // mesmo quando é erro. Corpo vazio quer dizer que a requisição parou numa
    // camada antes — o roteador sem ninguém na porta (502), ou o proxy do Vite
    // sem servidor atrás (500). Dizer "o servidor respondeu" a respeito de um
    // servidor que não chegou a ser consultado mandou uma tela ser reescrita
    // duas vezes atrás de um defeito que estava no ambiente.
    if (response.status >= 500) {
      throw new Error(
        `A API não respondeu (${response.status}). A interface está no ar, mas o ` +
          `servidor por trás de /api não está, e nada foi enviado. Confira o ` +
          `processo "API Server" e depois /api/healthz.`,
      );
    }
    throw new Error(
      response.ok
        ? `O servidor respondeu ${response.status} sem conteúdo. A conexão pode ter sido interrompida a caminho.`
        : `O servidor respondeu ${response.status} sem detalhar o motivo.`,
    );
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Resposta inesperada do servidor (${response.status}): ${text.slice(0, 160)}`,
    );
  }
}

/**
 * GET numa rota da API, com a falha como falha.
 *
 * É o que todo `useQuery` desta interface deve chamar. Um status fora do 2xx
 * vira exceção, que é o que o React Query sabe tratar — `isError` em vez de
 * `data` com o formato errado.
 */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(getApiUrl(path), init);
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : undefined;
    throw new Error(
      message ?? `O servidor respondeu ${response.status} em ${path}.`,
    );
  }
  // `readJson` descreve o corpo como objeto porque é assim que os erros desta
  // API vêm; várias rotas devolvem lista, e a conversão passa por `unknown`.
  return body as unknown as T;
}
