/**
 * A pergunta que a tela faz sozinha — e as três respostas que não se confundem.
 *
 * Este arquivo prova, do lado de quem desenha, a distinção que o incidente da
 * tela de login apagava: **servidor fora do ar**, **ambiente não pronto** e
 * **erro normal da chamada** (uma credencial errada, um arquivo que não serve)
 * são três coisas, com três frases, e nenhuma delas manda a pessoa abrir
 * endpoint técnico nenhum.
 *
 * O `fetch` é substituído porque o que se testa aqui é a **classificação**, e
 * ela precisa ser exercitável nos desfechos que não dá para produzir num teste
 * de unidade — o roteador respondendo HTML, a conexão recusada. A prova com o
 * servidor de verdade, incluindo o banco desligado de fato, está do outro
 * lado: `api-server/src/__tests__/banco-fora-do-ar.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { apresentar } from "@/lib/apresentar-erro";
import type { Diagnostico } from "@/lib/diagnostico";
import {
  consultarProntidao,
  orientacaoDaProntidao,
  type RespostaDaProntidao,
} from "@/lib/prontidao";

const INDISPONIVEL: Diagnostico = {
  estado: "INDISPONIVEL",
  humano:
    "O banco de dados deste ambiente não está respondendo agora. Não é a sua " +
    "senha nem o arquivo que você enviou: nada do que você fez chegou a ser " +
    "gravado, e nada se perdeu.",
  resumo:
    "A DATABASE_URL chegou ao processo, mas o banco não respondeu no endereço " +
    "que ela aponta.",
  risco: { emRisco: false, texto: "Nada foi gravado e nada se perdeu." },
  acao: {
    codigo: "RESTABELECER_BANCO",
    texto: "Restabelecer o banco. Não é algo que se resolva pela tela.",
    quem: "plataforma",
  },
};

function respondendo(status: number, corpo: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(corpo), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("consultarProntidao", () => {
  it("um 503 não é erro: é a resposta, com o diagnóstico dentro", async () => {
    respondendo(503, {
      ready: false,
      diagnostico: INDISPONIVEL,
      detail: "…",
    });

    const resposta = await consultarProntidao();

    expect(resposta.estado).toBe("nao-pronto");
    expect(
      resposta.estado === "nao-pronto" && resposta.diagnostico?.estado,
    ).toBe("INDISPONIVEL");
  });

  it("pronto é pronto — e vira null na orientação, nunca 'está tudo certo'", async () => {
    respondendo(200, { ready: true, diagnostico: null });

    const resposta = await consultarProntidao();

    expect(resposta.estado).toBe("pronto");
    /* Imprimir "está tudo certo" ao lado de uma falha manda procurar no lugar
       errado — a regra de sempre, agora aplicada onde a resposta nasce. */
    expect(orientacaoDaProntidao(resposta)).toBeNull();
  });

  it("servidor fora do ar: nem a pergunta chega, e a resposta é do transporte", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const resposta = await consultarProntidao();

    expect(resposta.estado).toBe("inalcancavel");
    expect(
      resposta.estado === "inalcancavel" && resposta.diagnostico.estado,
    ).toBe("SEM_RESPOSTA");
  });

  it("o roteador respondendo HTML não vira 'não pronto' de um servidor que não falou", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><h1>502 Bad Gateway</h1>", {
            status: 502,
          }),
      ),
    );

    const resposta = await consultarProntidao();

    expect(resposta.estado).toBe("inalcancavel");
    expect(
      resposta.estado === "inalcancavel" && resposta.diagnostico.estado,
    ).toBe("RESPOSTA_ESTRANHA");
  });
});

describe("as três falhas da tela de login, distinguidas", () => {
  /** O 401 como a rota de login o escreve — resposta, não falha. */
  const credencialErrada = new ApiError("E-mail ou senha incorretos.", 401);

  /** O 503 como o contrato o escreve com o banco desligado. */
  const bancoFora = new ApiError(
    "POST /api/auth/login não foi executado…",
    503,
    "BANCO_INDISPONIVEL",
    {
      contexto:
        "POST /api/auth/login não foi executado: a consulta não chegou ao " +
        "banco deste ambiente. Nada foi gravado por esta chamada.",
      diagnostico: INDISPONIVEL,
      requestId: "9f2c1a",
    },
  );

  it("credencial errada diz isso — e nenhuma prontidão a reexplica", () => {
    /*
      A prontidão pode estar vermelha por outra razão (drift, bridge no meio) e
      o login continuar funcionando. A senha errada é uma resposta que o
      servidor escreveu de propósito, e nada tem o direito de soterrá-la com
      "problema de infraestrutura".
    */
    const vermelha: RespostaDaProntidao = {
      estado: "nao-pronto",
      diagnostico: INDISPONIVEL,
    };

    const vista = apresentar(credencialErrada, vermelha);

    expect(vista.orientacao).toBeNull();
    expect(vista.mensagemCrua).toBe("E-mail ou senha incorretos.");
    expect(vista.principal).toBeNull();
  });

  it("banco fora diz que é o ambiente — em português, sem comando na frase", () => {
    const vista = apresentar(bancoFora);

    expect(vista.orientacao?.estado).toBe("INDISPONIVEL");
    expect(vista.principal).toMatch(/banco de dados/i);
    expect(vista.principal).toMatch(/não é a sua senha/i);
    /* O jargão fica nos detalhes, e existe lá. */
    expect(vista.principal).not.toMatch(/DATABASE_URL|healthz|SQLSTATE/i);
    expect(vista.detalhes.some((d) => /DATABASE_URL/.test(d.texto))).toBe(true);
    expect(vista.detalhes.some((d) => d.texto === "9f2c1a")).toBe(true);
  });

  it("servidor fora diz que não houve resposta — e também sem endpoint", () => {
    const inalcancavel: RespostaDaProntidao = {
      estado: "inalcancavel",
      diagnostico: {
        estado: "SEM_RESPOSTA",
        humano:
          "O servidor não respondeu a esta chamada. A tela tenta de novo " +
          "sozinha por alguns segundos; se continuar assim, é o ambiente que " +
          "precisa ser olhado, e não algo que você tenha feito. Nada do que " +
          "você enviou foi gravado.",
        resumo: "O que se sabe: o navegador não recebeu resposta nenhuma…",
        risco: { emRisco: false, texto: "Nada foi gravado." },
        acao: null,
      },
    };

    const vista = apresentar(
      new Error("primeira falha qualquer"),
      inalcancavel,
    );

    expect(vista.orientacao?.estado).toBe("SEM_RESPOSTA");
    expect(vista.principal).toMatch(/servidor não respondeu/i);
    expect(vista.principal).not.toMatch(/healthz|\/api\//);
  });

  it("as três frases principais são três — nenhum par coincide", () => {
    const daCredencial = apresentar(credencialErrada);
    const doBanco = apresentar(bancoFora);
    const doServidor = apresentar(new TypeError("Failed to fetch"));

    const frases = [
      daCredencial.principal ?? daCredencial.mensagemCrua,
      doBanco.principal,
      doServidor.principal,
    ];

    expect(new Set(frases).size).toBe(3);
  });
});
