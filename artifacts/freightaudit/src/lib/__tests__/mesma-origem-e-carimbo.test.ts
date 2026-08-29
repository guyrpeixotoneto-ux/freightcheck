import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError, fetchJson, getApiUrl } from "@/lib/api";
import { ErroDeTransporte, diagnosticarTransporte } from "@/lib/transporte";
import { descreverErro } from "@/lib/registro-de-falhas";

/**
 * Duas propriedades que a tela de DESVIADA pressupõe, e que ninguém provava.
 *
 * ---------------------------------------------------------------------------
 * 1. A chamada sai sempre para a **mesma origem**
 * ---------------------------------------------------------------------------
 * O aviso da Visão Geral afirma que *uma camada entre o navegador e a
 * aplicação* desviou a chamada. A afirmação só se sustenta se o endereço que
 * saiu daqui era o da própria aplicação: se algum dia uma variável de ambiente
 * fizesse produção chamar um domínio interno da plataforma, o "desvio" seria
 * nosso — nós é que teríamos mandado o navegador para outro lugar — e a tela
 * estaria acusando a infraestrutura pelo próprio bundle.
 *
 * Não é hipótese remota: é o modo mais comum de isto quebrar em projetos com
 * frontend e API publicados juntos. `VITE_API_URL` apontando para o endereço de
 * preview de um deploy antigo produz exatamente o sintoma desta tela, e produz
 * a intermitência junto — funciona enquanto aquele endereço responde.
 *
 * A régua abaixo é dupla: o que `getApiUrl` devolve (relativo, sempre) e o que
 * o texto-fonte contém (nenhuma origem absoluta de API, nenhuma variável de
 * base de API).
 *
 * ---------------------------------------------------------------------------
 * 2. Dá para dizer se a chamada **chegou ao Express**
 * ---------------------------------------------------------------------------
 * A distinção entre "o backend respondeu com erro" e "a requisição nunca chegou
 * ao backend" era inferida do formato do corpo — não é JSON, logo não é nossa.
 * A regra acerta na maioria e erra nos casos caros: um 502 de corpo vazio e um
 * 204 legítimo têm o mesmo corpo. Agora existe fato: o carimbo
 * `X-FreightCheck-API`, que só o nosso Express escreve.
 */

afterEach(() => vi.unstubAllGlobals());

describe("toda chamada sai para a mesma origem", () => {
  it("getApiUrl devolve caminho relativo, sob /api, sem esquema nem host", () => {
    for (const pedido of [
      "/changes/families/overview?period=2026-08",
      "changes/families",
      "/contexts",
      "/balance",
    ]) {
      const url = getApiUrl(pedido);
      expect(url.startsWith("/api/")).toBe(true);
      expect(url).not.toMatch(/^[a-z]+:/i);
      expect(url).not.toMatch(/^\/\//);
      // Resolvida contra qualquer origem, continua nessa origem.
      expect(new URL(url, "https://freightcheck.com.br").origin).toBe(
        "https://freightcheck.com.br",
      );
    }
  });

  const AQUI = path.dirname(fileURLToPath(import.meta.url));
  const SRC = path.join(AQUI, "..", "..");

  function fontes(diretorio: string): string[] {
    const achados: string[] = [];
    for (const nome of readdirSync(diretorio)) {
      const completo = path.join(diretorio, nome);
      if (statSync(completo).isDirectory()) {
        if (nome === "__tests__") continue;
        achados.push(...fontes(completo));
      } else if (/\.(ts|tsx)$/.test(nome)) {
        achados.push(completo);
      }
    }
    return achados;
  }

  it("nenhum arquivo declara uma base de API absoluta nem lê uma do ambiente", () => {
    const culpados: string[] = [];
    for (const arquivo of fontes(SRC)) {
      const texto = readFileSync(arquivo, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      /*
        Duas formas, e as duas já derrubaram produtos como este: a variável de
        ambiente que vira base (`VITE_API_URL`, `API_BASE_URL`, …) e o endereço
        absoluto escrito à mão dentro de um `fetch`.
      */
      if (/import\.meta\.env\.[A-Z_]*API[A-Z_]*(URL|BASE|HOST)/.test(texto)) {
        culpados.push(
          `${path.relative(SRC, arquivo)} (base de API no ambiente)`,
        );
      }
      if (/\bfetch\(\s*[`"']https?:\/\//.test(texto)) {
        culpados.push(
          `${path.relative(SRC, arquivo)} (fetch para origem absoluta)`,
        );
      }
    }

    expect(
      culpados,
      `A arquitetura é de mesma origem; estes arquivos a rompem: ${culpados.join(", ")}`,
    ).toEqual([]);
  });
});

describe("o carimbo diz se a chamada chegou ao Express", () => {
  it("resposta estranha COM carimbo: chegou ao servidor, e o defeito é nosso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("não sou json", {
            status: 500,
            headers: { "x-freightcheck-api": "1", "x-request-id": "req-77" },
          }),
      ),
    );

    const erro = (await fetchJson("/contexts").catch(
      (e: unknown) => e,
    )) as ErroDeTransporte;

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    expect(erro.diagnostico.estado).toBe("RESPOSTA_ESTRANHA");
    expect(erro.diagnostico.chegouAoServidor).toBe(true);
    expect(erro.diagnostico.requestId).toBe("req-77");
  });

  it("resposta estranha SEM carimbo: quem respondeu foi uma camada antes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>502 Bad Gateway</html>", { status: 502 }),
      ),
    );

    const erro = (await fetchJson("/contexts").catch(
      (e: unknown) => e,
    )) as ErroDeTransporte;

    expect(erro.diagnostico.chegouAoServidor).toBe(false);
    expect(erro.diagnostico.requestId).toBeUndefined();
  });

  it("um desvio nunca chegou ao Express — e isso é afirmado, não suposto", () => {
    const desviada = diagnosticarTransporte({ desviadaPara: null });
    expect(desviada.estado).toBe("DESVIADA");
    expect(desviada.chegouAoServidor).toBe(false);
  });

  it("sem resposta, nada é afirmado: `undefined` é a resposta honesta", () => {
    const semResposta = diagnosticarTransporte({ naoCompletou: true });
    expect(semResposta.estado).toBe("SEM_RESPOSTA");
    expect(semResposta.chegouAoServidor).toBeUndefined();
  });

  it("o requestId do cabeçalho chega ao ApiError mesmo sem estar no corpo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Faça login.", code: "UNAUTHENTICATED" }),
            {
              status: 401,
              headers: {
                "content-type": "application/json",
                "x-freightcheck-api": "1",
                "x-request-id": "req-401",
              },
            },
          ),
      ),
    );

    const erro = (await fetchJson("/contexts").catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.requestId).toBe("req-401");
  });

  it("o registro de falhas grava a distinção, e não a deduz de frase nenhuma", () => {
    const doServidor = descreverErro(
      new ApiError("o servidor falhou", 500, "ERRO_INTERNO", {
        requestId: "req-9",
      }),
    );
    expect(doServidor.chegouAoServidor).toBe(true);
    expect(doServidor.requestId).toBe("req-9");

    const desviada = descreverErro(
      new ErroDeTransporte(diagnosticarTransporte({ desviadaPara: null })),
    );
    expect(desviada.chegouAoServidor).toBe(false);

    const semResposta = descreverErro(
      new ErroDeTransporte(diagnosticarTransporte({ naoCompletou: true })),
    );
    expect(semResposta.chegouAoServidor).toBeUndefined();
  });
});
