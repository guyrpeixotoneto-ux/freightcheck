import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { PADRAO_DAS_CONSULTAS, chamadaResiliente } from "@/lib/chamada-resiliente";
import { CHAVE_DOS_CONTEXTOS, ENDPOINT_DOS_CONTEXTOS, type Contexto } from "@/lib/contextos";
import { TENTATIVAS_AUTOMATICAS } from "@/lib/resiliencia";
import { ErroDeTransporte } from "@/lib/transporte";
import { limparRegistro, falhasRegistradas } from "@/lib/registro-de-falhas";

/**
 * A tela de Unidades e a casca do produto, sobre a mesma chave.
 *
 * O que este arquivo prende é o defeito inteiro, no lugar onde ele acontecia: o
 * cache. `["contexts"]` tinha quatro `useQuery`, três `queryFn` e três conjuntos
 * de opções; quem disparava a busca era a **casca** (o `Layout` monta em volta
 * da página, e efeitos do React correm de dentro para fora), e a `queryFn` da
 * casca traduzia `!response.ok` em `[]` e trazia `retry: false`.
 *
 * Os três cenários abaixo são os três desfechos que isso produzia, e cada um
 * falha contra o código anterior:
 *
 *   1. a `queryFn` da página nunca rodava;
 *   2. 502 e 401 chegavam à tela como lista vazia — "nenhuma vigência importada
 *      ainda" sobre uma API fora do ar e sobre uma sessão expirada;
 *   3. as cinco tentativas de `resiliencia.ts` viravam uma.
 *
 * A montagem é reproduzida na ordem que o React usa — **a casca assina
 * primeiro** —, porque é essa ordem que decidia o desfecho. `QueryObserver`
 * direto, sem React, pelo mesmo motivo do teste vizinho de resiliência: o que se
 * afirma é comportamento de consulta, e montar DOM acrescentaria um navegador
 * sem acrescentar uma asserção.
 *
 * Nada aqui reescreve a política: `chamadaResiliente({ endpoint })` é
 * literalmente o objeto que `useContextos` e `useContextosDaCasca` espalham, e
 * `fetch` é o global de verdade, trocado por um duplo que responde o que o
 * cenário pede. O caminho exercitado é o do produto — `fetchJson` → `readJson`
 * → `diagnosticarTransporte`.
 */

const CONTEXTOS: Contexto[] = [
  {
    scopeHash: "hash-camacari",
    channel: "GRANEL",
    label: "CAMAÇARI · GRANEL",
    scopes: [{ scopeType: "UNIDADE", code: "CAM", name: "CAMAÇARI" }],
    latestPeriod: "2026-08-01",
    periods: 4,
  },
];

/**
 * Duas compressões, ambas declaradas — o resto é o objeto de produção.
 *
 * `retryDelay: 0` porque o cronograma real soma 13,2s e nenhuma asserção daqui
 * muda com o tamanho da espera; ele é medido exatamente, e sem esperar nada, em
 * `esperaDaTentativa`. `carimbo` injetado porque `chamadaResiliente` lê
 * `/api/build` fora do caminho crítico para classificar a interrupção — deixá-lo
 * ir à rede acrescentaria uma chamada às contagens sem acrescentar verdade.
 *
 * É a mesma exceção, pelos mesmos motivos, que `consulta-resiliente.test.ts`
 * declara. Tudo o mais — `queryFn`, `retry`, `fetchJson`, `readJson`,
 * `diagnosticarTransporte`, o registro de falhas — é o que roda na tela.
 */
const SEM_CARIMBO = async () => null;

/** As opções que `useContextosDaCasca` espalha. */
function opcoesDaCasca() {
  return {
    queryKey: CHAVE_DOS_CONTEXTOS,
    ...chamadaResiliente<Contexto[]>({
      endpoint: ENDPOINT_DOS_CONTEXTOS,
      carimbo: SEM_CARIMBO,
    }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retryDelay: 0,
  };
}

/** As opções que `useContextos` espalha, por `useConsultaResiliente`. */
function opcoesDaTela() {
  return {
    queryKey: CHAVE_DOS_CONTEXTOS,
    ...chamadaResiliente<Contexto[]>({
      endpoint: ENDPOINT_DOS_CONTEXTOS,
      carimbo: SEM_CARIMBO,
    }),
    retryDelay: 0,
  };
}

/**
 * Uma resposta HTTP de mentira, com o corpo cru.
 *
 * Corpo cru e não `Response.json()`: o defeito que `readJson` existe para pegar
 * é justamente o corpo **vazio** de um 502, que `.json()` não sabe representar.
 */
function resposta(status: number, corpo: string, tipo = "application/json"): Response {
  return new Response(corpo, { status, headers: { "Content-Type": tipo } });
}

let client: QueryClient;

beforeEach(() => {
  limparRegistro();
  client = new QueryClient({ defaultOptions: { queries: PADRAO_DAS_CONSULTAS } });
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

/**
 * Monta casca e tela na ordem do React e espera o desfecho.
 *
 * A casca assina primeiro **de propósito**: era ela que ditava a `queryFn` e o
 * `retry` para os dois. Inverter a ordem aqui esconderia o defeito exatamente
 * como não montar a casca o escondia.
 */
async function montar() {
  const casca = new QueryObserver(client, opcoesDaCasca());
  const tela = new QueryObserver(client, opcoesDaTela());
  const paradas = [casca.subscribe(() => {}), tela.subscribe(() => {})];
  await vi.waitFor(
    () => {
      const r = tela.getCurrentResult();
      if (r.isPending) throw new Error("ainda buscando");
    },
    { timeout: 5_000, interval: 10 },
  );
  for (const parar of paradas) parar();
  return { casca: casca.getCurrentResult(), tela: tela.getCurrentResult() };
}

describe("a consulta de /contexts é uma só", () => {
  it("casca e tela fazem uma chamada, e é a mesma", async () => {
    const fetchFalso = vi.fn(async () => resposta(200, JSON.stringify(CONTEXTOS)));
    vi.stubGlobal("fetch", fetchFalso);

    const { casca, tela } = await montar();

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls[0]?.[0]).toBe("/api/contexts");
    expect(tela.data).toEqual(CONTEXTOS);
    expect(casca.data).toEqual(CONTEXTOS);
  });

  /**
   * O caso que a tela apresentava ao contrário.
   *
   * Com a API fora do ar quem responde é a camada anterior, e o que ela escreve
   * é 5xx de corpo vazio — medido: `HTTP/1.1 500`, `Content-Type: text/plain`,
   * zero bytes pelo proxy do Vite com `connect ECONNREFUSED`; 502 igualmente
   * vazio pelo roteador do Replit. A `queryFn` da casca devolvia `[]` para isso,
   * e a tela escrevia "nenhuma vigência importada ainda" — o convite a importar
   * a primeira planilha, sobre um servidor que não estava lá.
   */
  it("um 502 de corpo vazio chega à tela como falha, não como lista vazia", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(502, "", "text/plain")));

    const { tela } = await montar();

    expect(tela.data).toBeUndefined();
    expect(tela.error).toBeInstanceOf(ErroDeTransporte);
    expect((tela.error as ErroDeTransporte).diagnostico.estado).toBe("API_AUSENTE");
    expect((tela.error as ErroDeTransporte).diagnostico.status).toBe(502);
  });

  /** Sessão expirada é 401, e também virava "nenhuma vigência importada". */
  it("um 401 chega à tela como falha de autenticação, não como lista vazia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        resposta(401, JSON.stringify({ error: "Faça login para usar o FreightCheck.", code: "UNAUTHENTICATED" })),
      ),
    );

    const { tela } = await montar();

    expect(tela.data).toBeUndefined();
    expect((tela.error as { status?: number }).status).toBe(401);
    expect((tela.error as { code?: string }).code).toBe("UNAUTHENTICATED");
  });

  /**
   * A política de repetição vale para esta chave — que é o que `retry: false` da
   * casca cancelava.
   *
   * O número não é decorativo: `TENTATIVAS_AUTOMATICAS` foi calibrado (13,2s em
   * cinco tentativas) para atravessar uma partida a frio, que é a causa mais
   * comum de "não houve resposta" neste ambiente. Com uma tentativa só, o painel
   * era **garantido** em todo cold start, e não havia recuperação depois —
   * `refetchOnWindowFocus` é `false` por decisão global.
   */
  it("uma falha de rede é repetida até o orçamento de resiliência, não uma vez", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchFalso);

    const { tela } = await montar();

    expect(fetchFalso).toHaveBeenCalledTimes(TENTATIVAS_AUTOMATICAS);
    expect(tela.error).toBeInstanceOf(ErroDeTransporte);
    expect((tela.error as ErroDeTransporte).diagnostico.estado).toBe("SEM_RESPOSTA");
  });

  /**
   * A falha fica gravada, e é a única evidência que sai de um navegador que não
   * está conseguindo falar com o servidor.
   *
   * A tela de Unidades não participava disto: `useQuery` cru não passa por
   * `chamadaResiliente`, então nenhuma das falhas que ela mostrava chegava ao
   * registro. Quem atendia o chamado pedia `__freightcheck_falhas` e recebia uma
   * lista sem a chamada que tinha falhado.
   */
  it("a falha entra no registro que o console publica", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await montar();

    const registradas = falhasRegistradas();
    expect(registradas.length).toBeGreaterThan(0);
    expect(registradas[0]?.endpoint).toBe(ENDPOINT_DOS_CONTEXTOS);
    expect(registradas[0]?.estado).toBe("SEM_RESPOSTA");
  });
});
