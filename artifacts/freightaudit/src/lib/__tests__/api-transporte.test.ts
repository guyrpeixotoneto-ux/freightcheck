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
   * existe exatamente para este caso. **Reproduz sempre**: o `fetch` mockado
   * aqui jamais resolve por conta própria — só quando o `AbortSignal` dispara
   * —, então sem o teto de `requisitar` esta promessa fica pendente para
   * sempre e o teste só termina pelo timeout do próprio runner (5s), nunca
   * pela asserção. Contra o código anterior a este pacote de correções, esse
   * é exatamente o desfecho: `Test timed out in 5000ms`.
   *
   * O desfecho tem de ser `TEMPO_ESGOTADO` — um estado **distinto** de
   * `SEM_RESPOSTA` e de `REQUISICAO_CANCELADA`. Não é `REQUISICAO_CANCELADA`:
   * quem abortou fomos nós, pelo teto, e não quem chamou — e cancelamento não
   * é repetido. E não é `SEM_RESPOSTA` também, embora os dois sejam
   * repetíveis: `SEM_RESPOSTA` é o navegador desistindo sozinho, `TEMPO_ESGOTADO`
   * é este código desistindo depois de um prazo que ele mesmo escolheu — a
   * distinção que separa "uma rota específica está sempre estourando o prazo"
   * de "a rede caiu", legível em `__freightcheck_falhas`.
   */
  it("uma chamada que nunca responde estoura o prazo e rejeita, deterministicamente, com TEMPO_ESGOTADO", async () => {
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

    // Instantes antes do teto: a promessa continua pendente — não é um
    // desfecho por acaso, é o prazo específico decidindo.
    await vi.advanceTimersByTimeAsync(44_999);
    let resolvida = false;
    void promessa.then(() => {
      resolvida = true;
    });
    await Promise.resolve();
    expect(resolvida).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const erro = await promessa;

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    const { diagnostico } = erro as ErroDeTransporte;
    expect(diagnostico.estado).toBe("TEMPO_ESGOTADO");
    expect(diagnostico.estado).not.toBe("SEM_RESPOSTA");
    expect(diagnostico.estado).not.toBe("REQUISICAO_CANCELADA");
    expect(diagnostico.evidencia).toMatch(/45000ms/);
    expect(ehFalhaTransitoria(erro)).toBe(true);

    vi.useRealTimers();
  });

  /**
   * O cancelamento de quem chamou continua sendo cancelamento, mesmo agora que
   * esta função também tem o seu próprio `AbortController` por baixo — os dois
   * sinais precisam compor, e o que decide a classificação é **quem** abortou
   * primeiro, não que um `AbortController` qualquer abortou. Um
   * `AbortController` externo (o que o React Query passa como `ctx.signal`, ou
   * uma desmontagem) que aborta **antes** do teto interno tem de continuar
   * `REQUISICAO_CANCELADA` — e não virar `TEMPO_ESGOTADO` só porque as duas
   * classes de abort agora nascem do mesmo `AbortController` combinado.
   */
  it("um AbortController externo que aborta antes do teto continua REQUISICAO_CANCELADA", async () => {
    vi.useFakeTimers();
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
    // Bem antes dos 45s do teto interno.
    await vi.advanceTimersByTimeAsync(1_000);
    controle.abort();
    const erro = await promessa;

    expect((erro as ErroDeTransporte).diagnostico.estado).toBe("REQUISICAO_CANCELADA");
    expect((erro as ErroDeTransporte).diagnostico.estado).not.toBe("TEMPO_ESGOTADO");
    expect(ehFalhaTransitoria(erro)).toBe(false);

    vi.useRealTimers();
  });
});

/**
 * O 204 é sucesso, e não meia resposta.
 *
 * Este bloco existe por um defeito de campo: no editor de conexões do fluxo,
 * "Remover" apagava a conexão no banco e devolvia, na tela, "A resposta do
 * servidor chegou pela metade — a conexão foi interrompida no caminho. Tentar
 * de novo costuma bastar". As duas metades da frase estavam erradas ao mesmo
 * tempo — nada tinha se interrompido, e tentar de novo encontrava uma conexão
 * que já não existia —, e a exclusão parecia ter falhado quando tinha dado
 * certo.
 *
 * A causa não era da tela: `DELETE` nessas rotas responde `204 … end()`, e
 * `readJson` classifica corpo vazio como transporte quebrado. É uma regra certa
 * para toda rota que promete JSON, e o 204 é justamente a que não promete.
 */
describe("fetchJson entende o sucesso sem corpo", () => {
  it("um 204 resolve, e não vira ErroDeTransporte", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    const apagada = fetchJson("/fluxos/f1/conexoes/c1", { method: "DELETE" });

    await expect(apagada).resolves.toBeUndefined();
  });

  /**
   * O corte é pelo status. Um 200 sem corpo continua sendo defeito: aí a rota
   * prometeu JSON e não entregou, e apagar essa distinção devolveria `undefined`
   * a quem espera dados — a tela branca que `readJson` existe para evitar.
   */
  it("um 200 de corpo vazio continua sendo resposta incompleta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    expect((erro as ErroDeTransporte).diagnostico.estado).toBe("RESPOSTA_INCOMPLETA");
  });
});
