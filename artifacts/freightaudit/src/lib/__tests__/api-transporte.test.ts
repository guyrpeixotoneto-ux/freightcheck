import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/api";
import { ehFalhaTransitoria } from "@/lib/resiliencia";
import { ErroDeTransporte } from "@/lib/transporte";

/**
 * A falha de rede classificada onde ela acontece.
 *
 * `fetch` rejeita com `TypeError` quando a requisição não completa, e esse
 * `TypeError` subia cru daqui. Quem o classificava era `apresentar-erro.ts`, por
 * `instanceof TypeError` — uma aposta ("nenhum erro nosso é `TypeError`") que é
 * falsa: `undefined is not a function` e um `.map` num objeto também são
 * `TypeError`. O preço era um defeito de código nosso apresentado como "o
 * servidor não respondeu", mandando procurar rede.
 *
 * E o pouco que o navegador diz — "Failed to fetch", "Load failed",
 * "NetworkError…" — se perdia no caminho, junto com a distinção entre uma queda
 * e um cancelamento nosso.
 */

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson classifica o que impede a resposta", () => {
  it("o fetch rejeitado vira ErroDeTransporte, com a frase do navegador junto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    const { diagnostico } = erro as ErroDeTransporte;
    expect(diagnostico.estado).toBe("SEM_RESPOSTA");
    expect(diagnostico.status).toBeUndefined();
    expect(diagnostico.evidencia).toMatch(/Failed to fetch/);
  });

  /**
   * O cancelamento tem estado próprio, e a diferença tem consequência: ele não
   * é repetido. Repetir uma chamada que a navegação abandonou é gastar rede para
   * jogar o resultado fora — e, na tela, acusar a plataforma por um clique.
   */
  it("uma chamada abortada é cancelamento, e não é repetida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    expect((erro as ErroDeTransporte).diagnostico.estado).toBe("REQUISICAO_CANCELADA");
    expect(ehFalhaTransitoria(erro)).toBe(false);
  });

  /** Uma queda continua sendo repetível — é o caso mais transitório que existe. */
  it("a queda de rede continua valendo repetição", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    expect(ehFalhaTransitoria(erro)).toBe(true);
  });

  /**
   * O corpo cortado no meio da leitura **teve** status — e dizê-lo importa.
   *
   * `response.text()` rejeita com `TypeError` quando a conexão morre depois da
   * linha de resposta. Cru, isso caía no `instanceof TypeError` de
   * `apresentar-erro.ts` e virava `SEM_RESPOSTA`: a tela anunciava não ter
   * recebido status nenhum sobre uma chamada cujo status ela tinha lido.
   */
  it("o corpo cortado no meio é resposta incompleta, com o status que veio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        ok: true,
        text: async () => {
          throw new TypeError("network error");
        },
      })),
    );

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    const { diagnostico } = erro as ErroDeTransporte;
    expect(diagnostico.estado).toBe("RESPOSTA_INCOMPLETA");
    expect(diagnostico.status).toBe(200);
    expect(diagnostico.evidencia).toMatch(/network error/);
  });

  /**
   * O 5xx de corpo vazio continua sendo `API_AUSENTE`, e não `SEM_RESPOSTA`.
   *
   * A distinção é a que a tela precisa fazer e não fazia: aqui **houve**
   * resposta, e ela veio de uma camada antes da API — o roteador do Replit (502)
   * ou o proxy do Vite (500, `text/plain`, zero bytes, medido). É o único estado
   * autorizado a mandar conferir o processo "API Server".
   */
  it("um 5xx de corpo vazio é a camada anterior, com status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502, headers: { "Content-Type": "text/plain" } })),
    );

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    expect((erro as ErroDeTransporte).diagnostico.estado).toBe("API_AUSENTE");
    expect((erro as ErroDeTransporte).diagnostico.status).toBe(502);
    expect((erro as ErroDeTransporte).diagnostico.acao?.codigo).toBe("RESTABELECER_API");
  });

  /**
   * Uma chamada que nunca termina — a conexão abre e ninguém do outro lado
   * escreve um byte — não pode ficar pendurada para sempre. Antes desta
   * função ter um teto próprio, `fetch` sem `signal` não tinha prazo nenhum:
   * a promessa nunca resolvia, nunca rejeitava, e a tela ficava em
   * "Carregando…" para sempre — pior do que o painel de indisponibilidade que
   * existe exatamente para este caso. Reproduzia sempre: nenhum `fetch` mockado
   * aqui jamais resolve, então sem o teto este teste nunca terminaria.
   *
   * O desfecho tem de ser `SEM_RESPOSTA` — e não `REQUISICAO_CANCELADA`: quem
   * abortou fomos nós, pelo teto, e não quem chamou. `REQUISICAO_CANCELADA` não
   * é repetida; `SEM_RESPOSTA` é, e uma chamada que nunca respondeu é
   * exatamente o caso banal que a política de `resiliencia.ts` existe para
   * atravessar.
   */
  it("uma chamada que nunca responde estoura o teto e vira SEM_RESPOSTA, repetível", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const promessa = fetchJson("/contexts").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(45_000);
    const erro = await promessa;

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    const { diagnostico } = erro as ErroDeTransporte;
    expect(diagnostico.estado).toBe("SEM_RESPOSTA");
    expect(diagnostico.evidencia).toMatch(/45s/);
    expect(ehFalhaTransitoria(erro)).toBe(true);

    vi.useRealTimers();
  });

  /**
   * O cancelamento de quem chamou continua sendo cancelamento, mesmo agora que
   * esta função também tem o seu próprio `AbortController` por baixo — os dois
   * sinais precisam compor, e o que decide a classificação é **quem** abortou
   * primeiro, não que um `AbortController` qualquer abortou.
   */
  it("o cancelamento de quem chamou continua sendo cancelamento, não SEM_RESPOSTA", async () => {
    const controle = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const promessa = fetchJson("/contexts", { signal: controle.signal }).catch(
      (e: unknown) => e,
    );
    controle.abort();
    const erro = await promessa;

    expect((erro as ErroDeTransporte).diagnostico.estado).toBe("REQUISICAO_CANCELADA");
    expect(ehFalhaTransitoria(erro)).toBe(false);
  });
});
