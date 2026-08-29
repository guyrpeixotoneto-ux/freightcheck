import cors from "cors";
import type { RequestHandler } from "express";
import { CABECALHO_DA_API, CABECALHO_DO_REQUEST_ID } from "./carimbo-da-api";

/**
 * O CORS que corresponde à arquitetura — e ela é **mesma origem**.
 *
 * Este servidor era montado com `cors()` sem argumento, que é o preset mais
 * permissivo do pacote: `Access-Control-Allow-Origin: *` em toda resposta,
 * medido em `/api/healthz`, `/api/contexts` e em todas as demais. Isso não é
 * "liberar o que a aplicação precisa" — a aplicação não precisa de nada disso.
 *
 * O desenho publicado é uma origem só. O roteador da plataforma serve o bundle
 * em `/` e encaminha `/api/*` para este processo (ver os `artifact.toml` dos
 * dois artifacts), e o cliente monta **sempre** caminho relativo — `getApiUrl`
 * devolve `/api/...`, sem esquema e sem host, e não existe `VITE_API_URL` neste
 * repositório. Fora do Replit, o proxy do Vite (`API_PROXY_TARGET`) reproduz a
 * mesma origem única. Ou seja: nenhuma chamada legítima deste produto é
 * cross-origin, e nenhuma delas jamais leu um cabeçalho de CORS.
 *
 * O `*` era, então, superfície sem consumidor — e uma que engana quem lê. Um
 * `Access-Control-Allow-Origin: *` numa resposta de API sugere que a API é
 * chamada de outra origem, que é exatamente a hipótese errada a alimentar
 * quando se está investigando um desvio de origem. E ele é inútil onde
 * pareceria útil: com `*` o navegador recusa requisição com credencial, e toda
 * chamada deste produto vai com cookie de sessão.
 *
 * O que fica: **nenhum cabeçalho de CORS por padrão** (mesma origem não usa
 * CORS), e uma lista explícita por variável de ambiente para o caso que ainda
 * não existe — um cliente em outra origem, nomeado um a um, com credencial
 * permitida, que é o que uma sessão por cookie exige. Uma origem fora da lista
 * simplesmente não recebe o cabeçalho, e o navegador dela barra a leitura: é o
 * padrão da web, e não uma recusa nossa (responder 403 aqui esconderia o motivo
 * atrás de um status que a tela leria como problema de permissão do usuário).
 *
 * `ORIGENS_PERMITIDAS` aceita lista separada por vírgula. Vazia ou ausente —
 * o estado de hoje, em todos os ambientes — quer dizer mesma origem, e só.
 */
function origensPermitidas(): string[] {
  return (process.env["API_ORIGENS_PERMITIDAS"] ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o !== "");
}

export function corsDaArquitetura(): RequestHandler {
  const permitidas = origensPermitidas();
  return cors({
    origin(origem, decidir) {
      // Sem `Origin` é chamada de mesma origem (ou de fora do navegador):
      // não há o que responder, e negar aqui recusaria o próprio produto.
      if (!origem) return decidir(null, false);
      decidir(null, permitidas.includes(origem.replace(/\/+$/, "")));
    },
    // Sessão por cookie: sem isto, uma origem da lista continuaria sem
    // conseguir se autenticar, o que faria a lista prometer o que não cumpre.
    credentials: true,
    /*
      Os dois carimbos precisam ser legíveis por quem chama de outra origem —
      são justamente o que responde "chegou ao Express?" e "qual requisição
      foi?". Sem `exposedHeaders` o navegador os esconde do JavaScript, e a
      instrumentação que eles existem para permitir não funcionaria no único
      caso em que a lista é usada.
    */
    exposedHeaders: [CABECALHO_DA_API, CABECALHO_DO_REQUEST_ID],
  });
}
