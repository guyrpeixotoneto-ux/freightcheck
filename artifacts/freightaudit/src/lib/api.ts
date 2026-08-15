import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";

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
 * A falha de uma chamada, com o que o servidor disse junto.
 *
 * A mensagem sozinha não distinguia "o arquivo que você mandou não serve" de "o
 * banco deste ambiente não tem a tabela" — as duas chegavam como texto vermelho
 * de uma linha. O status separa as duas, e é o que permite a uma tela mostrar a
 * explicação inteira (com o que `/api/healthz` enxerga) só quando a causa está
 * do lado de lá.
 */
export class ApiError extends Error {
  readonly status: number;
  /** O `code` que a API manda em alguns erros — `SCHEMA_AUSENTE`, … */
  readonly code?: string;
  /**
   * O contexto da rota: qual schema falta, e o que houve com o envio.
   *
   * É só o que a rota sabe e mais ninguém. Recomendação nenhuma vem por aqui.
   */
  readonly contexto?: string;
  /**
   * O estado do banco classificado pelo servidor.
   *
   * Quando vem preenchido, é a **única** recomendação que a interface
   * apresenta. Era daqui que nascia o defeito que este campo elimina: a tela
   * imprimia o texto da rota e o do `/healthz` um embaixo do outro, e os dois
   * mandavam fazer coisas diferentes sobre o mesmo erro.
   */
  readonly diagnostico?: Diagnostico;

  constructor(
    message: string,
    status: number,
    code?: string,
    extra?: { contexto?: string; diagnostico?: Diagnostico },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (code !== undefined) this.code = code;
    if (extra?.contexto !== undefined) this.contexto = extra.contexto;
    if (extra?.diagnostico !== undefined) this.diagnostico = extra.diagnostico;
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
    throw new ApiError(
      message ?? `O servidor respondeu ${response.status} em ${path}.`,
      response.status,
      typeof body.code === "string" ? body.code : undefined,
      {
        ...(typeof body.contexto === "string" ? { contexto: body.contexto } : {}),
        ...(ehDiagnostico(body.diagnostico)
          ? { diagnostico: body.diagnostico }
          : {}),
      },
    );
  }
  // `readJson` descreve o corpo como objeto porque é assim que os erros desta
  // API vêm; várias rotas devolvem lista, e a conversão passa por `unknown`.
  return body as unknown as T;
}

/**
 * GET numa rota que responde 404 quando ainda não existe o que mostrar.
 *
 * Várias telas leem rotas em que "nenhuma vigência importada ainda" chega como
 * 404 com `{"error": …}` — vazio de conteúdo, não falha. Elas escreviam a mesma
 * sequência à mão (`fetch`, `status === 404`, `.json()`), e a mão trazia junto
 * o defeito que `readJson` existe para evitar: quando a resposta não é nossa —
 * 502 sem corpo do roteador com ninguém atrás de `/api` — `.json()` estoura com
 * "Unexpected end of JSON input", e a tela acusa um formato inválido de um
 * servidor que não chegou a responder.
 *
 * O vazio continua vazio (`null`), e só ele: um 404 sem o nosso corpo JSON não
 * é "ainda não importaram", é o roteador não achando a rota — esse sobe como
 * falha, com `readJson` dizendo de que lado o defeito está.
 */
export async function fetchJsonOrNull<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    return await fetchJson<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
