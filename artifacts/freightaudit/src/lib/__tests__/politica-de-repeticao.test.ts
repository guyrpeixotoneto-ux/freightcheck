import { describe, expect, it, afterEach, vi } from "vitest";

import { ApiError, fetchJson } from "@/lib/api";
import {
  ORCAMENTO_DE_ESPERA_MS,
  TENTATIVAS_AUTOMATICAS,
  deveTentarDeNovo,
  ehFalhaTransitoria,
  esperaAcumuladaMs,
  esperaDaTentativa,
} from "@/lib/resiliencia";
import { ErroDeTransporte, diagnosticarTransporte } from "@/lib/transporte";

/**
 * Quando insistir vale a pena, e quanto tempo isso pode custar a quem espera.
 *
 * A política de repetição já existia e já era testada em pedaços — o que não
 * existia era um lugar onde as **classes de falha** estivessem lado a lado,
 * cada uma com o seu veredito. A ausência custou caro: um desvio da plataforma
 * (302 para `replit.com/__replshield`) chegava indistinguível de um pacote
 * perdido, e gastava as cinco tentativas e treze segundos numa chamada que
 * seria desviada igual em todas elas.
 *
 * Aqui as nove classes estão numa tabela só. Um veredito que mude sem que
 * alguém o mude de propósito derruba este arquivo.
 */

afterEach(() => vi.unstubAllGlobals());

/** Uma falha de transporte já classificada, como `api.ts` a produz. */
function transporte(observado: Parameters<typeof diagnosticarTransporte>[0]) {
  return new ErroDeTransporte(diagnosticarTransporte(observado));
}

describe("as classes de falha, e o que a política faz com cada uma", () => {
  const casos: ReadonlyArray<{
    classe: string;
    erro: unknown;
    repete: boolean;
    porque: string;
  }> = [
    {
      classe: "1 · erro HTTP real da API (o servidor classificou)",
      erro: new ApiError("falta a migration", 503, "SCHEMA_AUSENTE"),
      repete: false,
      porque:
        "um erro que o servidor nomeou é um erro que ele vai nomear igual na repetição",
    },
    {
      classe: "2 · timeout (fomos nós que desistimos de esperar)",
      erro: transporte({ naoCompletou: true, esgotouTempo: true, tempoLimiteMs: 45_000 }),
      repete: true,
      porque: "compatível com uma origem que ainda está subindo",
    },
    {
      classe: "3 · conexão recusada / DNS / TLS (sem resposta nenhuma)",
      erro: transporte({ naoCompletou: true, motivo: "Failed to fetch" }),
      repete: true,
      porque: "é o caso que a espera existe para cobrir — Repl dormindo, reinício",
    },
    {
      classe: "4 · `Failed to fetch` cru, antes de qualquer classificação",
      erro: new TypeError("Failed to fetch"),
      repete: true,
      porque: "a mesma chamada 400ms depois costuma responder",
    },
    {
      classe: "5 · desviada para outra origem (ReplShield/CORS)",
      erro: transporte({ desviadaPara: null }),
      repete: false,
      porque:
        "quem respondeu foi uma camada intermediária; insistir devolve o mesmo desvio",
    },
    {
      classe: "6a · 401 — sem sessão",
      erro: new ApiError("faça login", 401),
      repete: false,
      porque: "repetir sem sessão devolve 401",
    },
    {
      classe: "6b · 403 — sem permissão",
      erro: new ApiError("sem permissão", 403),
      repete: false,
      porque: "repetir sem permissão devolve 403",
    },
    {
      classe: "7 · 429 — pedindo demais",
      erro: new ApiError("tentativas demais", 429),
      repete: false,
      porque: "repetir conta para o mesmo limite: piora o que tentava consertar",
    },
    {
      classe: "8 · 5xx sem código (o servidor não soube classificar)",
      erro: new ApiError("o servidor respondeu 502.", 502),
      repete: true,
      porque: "5xx anônimo é tipicamente o proxy, e o proxy passa",
    },
    {
      classe: "9 · 5xx de corpo vazio — não há ninguém atrás do /api",
      erro: transporte({ status: 502, corpoVazio: true }),
      repete: true,
      porque: "a origem pode estar subindo",
    },
  ];

  for (const caso of casos) {
    it(`${caso.classe} → ${caso.repete ? "repete" : "NÃO repete"} (${caso.porque})`, () => {
      expect(ehFalhaTransitoria(caso.erro)).toBe(caso.repete);
      expect(deveTentarDeNovo(0, caso.erro)).toBe(caso.repete);
    });
  }

  /**
   * O caso que motivou tudo isto, medido de ponta a ponta.
   *
   * Sem esta separação, o desvio custava as quatro esperas inteiras —
   * `ORCAMENTO_DE_ESPERA_MS` — para chegar à mesma resposta.
   */
  it("o desvio da plataforma custa zero espera, e não o orçamento inteiro", () => {
    const desvio = transporte({ desviadaPara: null });
    let tentativas = 1;
    while (deveTentarDeNovo(tentativas - 1, desvio)) tentativas++;

    expect(tentativas).toBe(1);
    expect(esperaAcumuladaMs(tentativas)).toBe(0);

    // e a mesma contagem para uma falha que de fato vale insistir
    const semResposta = transporte({ naoCompletou: true, motivo: "Failed to fetch" });
    let tentativasDaQueda = 1;
    while (deveTentarDeNovo(tentativasDaQueda - 1, semResposta)) tentativasDaQueda++;

    expect(tentativasDaQueda).toBe(TENTATIVAS_AUTOMATICAS);
    expect(esperaAcumuladaMs(tentativasDaQueda)).toBe(ORCAMENTO_DE_ESPERA_MS);
  });
});

describe("o orçamento de espera é um teto, e não uma coincidência", () => {
  it("a progressão inteira cabe no orçamento, e passar dele para de repetir", () => {
    expect(esperaAcumuladaMs(TENTATIVAS_AUTOMATICAS)).toBe(ORCAMENTO_DE_ESPERA_MS);
    expect(esperaAcumuladaMs(TENTATIVAS_AUTOMATICAS + 1)).toBeGreaterThan(
      ORCAMENTO_DE_ESPERA_MS,
    );
  });

  it("a progressão é a que está escrita: 400, 1200, 3600, 8000", () => {
    expect([0, 1, 2, 3].map(esperaDaTentativa)).toEqual([400, 1200, 3600, 8000]);
  });

  /**
   * O portão que protege o orçamento de crescer por descuido. Quem aumentar o
   * número de tentativas sem revisar o teto não ganha tentativas — a soma
   * estoura, `deveTentarDeNovo` recusa, e este teste explica por quê.
   */
  it("nenhuma sequência de repetições ultrapassa o orçamento", () => {
    const queda = transporte({ naoCompletou: true, motivo: "Failed to fetch" });
    let feitas = 1;
    while (deveTentarDeNovo(feitas - 1, queda)) {
      feitas++;
      expect(esperaAcumuladaMs(feitas)).toBeLessThanOrEqual(ORCAMENTO_DE_ESPERA_MS);
    }
  });
});

describe("o desvio chega classificado de `fetch`, e não como falha de rede", () => {
  /**
   * O 302 para o ReplShield, reproduzido. Com `redirect: "manual"` o navegador
   * devolve uma resposta opaca em vez de seguir para a outra origem — e é essa
   * resposta opaca que `api.ts` transforma em diagnóstico.
   */
  it("uma resposta opaca de redirect vira DESVIADA, e não SEM_RESPOSTA", async () => {
    /*
      `type` é um getter do protótipo de `Response` e não aceita atribuição —
      daí o `defineProperty`. O que se está reproduzindo é exatamente o que o
      navegador entrega com `redirect: "manual"` diante de um 302 para outra
      origem: status 0, corpo inacessível, e o tipo como única pista. O
      construtor de `Response` recusa status fora de 200–599, por isso ele
      nasce 200 e é redefinido — `status` e `type` são getters do protótipo.
    */
    const opaca = new Response(null, { status: 200 });
    Object.defineProperty(opaca, "type", { value: "opaqueredirect" });
    Object.defineProperty(opaca, "status", { value: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => opaca));

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeTransporte);
    const { diagnostico } = erro as ErroDeTransporte;
    expect(diagnostico.estado).toBe("DESVIADA");
    expect(diagnostico.acao?.codigo).toBe("DESVIO_NA_PLATAFORMA");
    expect(diagnostico.acao?.quem).toBe("plataforma");
    expect(diagnostico.risco.emRisco).toBe(false);
    expect(ehFalhaTransitoria(erro)).toBe(false);
  });

  /**
   * Um redirect da mesma origem é legível, e o destino entra na evidência —
   * é o que dá a quem investiga o endereço para onde a chamada foi mandada.
   */
  it("um redirect legível traz o destino na evidência", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://replit.com/__replshield?x=1" },
          }),
      ),
    );

    const erro = await fetchJson("/contexts").catch((e: unknown) => e);

    const { diagnostico } = erro as ErroDeTransporte;
    expect(diagnostico.estado).toBe("DESVIADA");
    expect(diagnostico.evidencia).toMatch(/replshield/);
  });

  /**
   * O que a tela diz não pode acusar a API de estar fora do ar: ela pode estar
   * perfeitamente de pé e nunca ter sido consultada. Esta é a diferença entre
   * mandar alguém investigar o processo errado e mandar olhar a camada certa.
   */
  it("a mensagem separa 'não alcançada' de 'fora do ar'", async () => {
    const { diagnostico } = transporte({ desviadaPara: null });
    expect(diagnostico.humano).toMatch(/não chegou/i);
    expect(diagnostico.humano).toMatch(/não é a aplicação que está fora do ar/i);
    expect(diagnostico.resumo).toMatch(/insistir devolve o mesmo desvio/i);
  });
});
