/**
 * O contrato de erro desta API, agora que ele é do servidor e não das rotas.
 *
 * Cinquenta e quatro `try/catch` respondiam `{"error": "Internal server
 * error"}`. A frase era a mesma para uma coluna que falta, para o banco fora do
 * ar e para um `undefined` numa conta — e a tela, que não tem como distingui-las,
 * mostrava o mesmo aviso amarelo em Composição e em Alterações no mesmo minuto,
 * enquanto o `/api/healthz` respondia `SAUDAVEL`. As três coisas eram verdade.
 *
 * Os `catch` saíram e a classificação passou a ser feita uma vez, aqui. Este
 * arquivo trava os cinco desfechos que substituíram a constante, e trava também
 * o que **não** pode sair junto com eles.
 *
 * O que ele não é: um teste de rota. Nenhuma rota é montada — o que se exercita
 * é o handler contra erros construídos à mão, porque é exatamente essa a
 * pergunta que ninguém conseguia responder antes ("o que esta API responde a
 * *isto*?"). O comportamento rota a rota continua nos arquivos de cada uma.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { EstadoObservado } from "@workspace/db/diagnostico";
import {
  ContextNotFoundError,
  JanelaInvalidaError,
} from "@workspace/comparison";
import {
  BaixaRecusada,
  CelulaNaoEncontrada,
  DecisaoRecusada,
} from "@workspace/coverage";
import { EmailAlreadyUsedError } from "../../lib/session";

const observarBanco = vi.hoisted(() => vi.fn<() => Promise<EstadoObservado>>());

vi.mock("../../lib/migrations", async (original) => ({
  ...(await original<typeof import("../../lib/migrations")>()),
  observarBanco,
}));

const {
  erroEmJson,
  rotaDesconhecida,
  CODIGO_ERRO_INTERNO,
  CODIGO_PEDIDO_INVALIDO,
  CODIGO_RECUSA,
  CODIGO_ROTA_DESCONHECIDA,
} = await import("../contrato-json");
const { contextoDeSchema } = await import("../contexto-de-schema");

const REQUEST_ID = "req-de-teste";

/**
 * O erro que o `pg` levanta e o drizzle embrulha.
 *
 * A `message` do `DrizzleQueryError` é a consulta inteira com os parâmetros. O
 * SQLSTATE mora no `cause`, que é onde o driver o põe de verdade — e é por isso
 * que a classificação pergunta lá, e não pela mensagem.
 */
function erroDoDrizzle(
  code: string,
  texto: string,
  extra: Record<string, unknown> = {},
): DrizzleQueryError {
  return new DrizzleQueryError(
    'select "attribute"."code" from "attribute" where "attribute"."id" = $1',
    ["42"],
    Object.assign(new Error(texto), { code, ...extra }),
  );
}

/** Tudo o que nunca pode sair desta API para o browser. */
const PROIBIDO: [RegExp, string][] = [
  [/failed query:/i, "o carimbo do drizzle"],
  [/\bparams:/i, "os parâmetros da consulta"],
  [/select\b[\s\S]*\bfrom\b/i, "SQL de leitura"],
  [/\binsert\s+into\b/i, "SQL de escrita"],
  [/\$\d+/, "um parâmetro posicional"],
  [/\n\s+at\s+\S/, "um stack trace"],
];

function exigirRespostaLimpa(corpo: unknown): void {
  const inteiro = JSON.stringify(corpo);
  for (const [marca, oQueE] of PROIBIDO) {
    expect(
      marca.test(inteiro),
      `a resposta traz ${oQueE}: ${inteiro.slice(0, 400)}`,
    ).toBe(false);
  }
}

let servidor: Server;
let base: string;

/**
 * Um app montado como o `app.ts`: rotas, o 404 do caminho desconhecido e, por
 * último, o contrato. A ordem não é estética — o Express só reconhece um
 * handler de erro se ele vier depois de tudo o que pode falhar.
 *
 * `/estoura/:qual` é a única "rota": ela lança o que o teste pedir. É como se
 * pergunta a esta camada o que ela responde a cada forma de falha, sem arrastar
 * junto o comportamento de nenhuma rota de verdade.
 */
const LANCAR = new Map<string, () => unknown>();

beforeAll(async () => {
  const app = express();
  /*
    A ordem é a do `app.ts`: o `pino-http` — que instala `req.id` e `req.log` —
    vem antes do parser de corpo. Não é detalhe: o `express.json()` recusa um
    corpo malformado antes de qualquer rota, e se o id fosse instalado depois,
    justamente a recusa que nunca passa por rota nenhuma sairia sem ele.
  */
  app.use((req, _res, next) => {
    Object.assign(req, {
      log: { warn: () => {}, error: () => {}, info: () => {} },
      id: REQUEST_ID,
    });
    next();
  });
  app.use(express.json());

  // Uma superfície que declara o que lê, e outra que não declara nada.
  app.use(
    "/comdeclaracao",
    contextoDeSchema("O Book não tem onde guardar neste banco."),
  );

  app.all("/comdeclaracao/:qual", (req) => {
    throw LANCAR.get(req.params.qual)!();
  });
  app.all("/estoura/:qual", (req) => {
    throw LANCAR.get(req.params.qual)!();
  });
  app.all("/assincrono/:qual", async (req) => {
    await Promise.resolve();
    throw LANCAR.get(req.params.qual)!();
  });

  app.use(rotaDesconhecida);
  app.use(erroEmJson);

  await new Promise<void>((resolve) => {
    servidor = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      servidor.close(() => resolve());
    }),
);

beforeEach(() => {
  vi.clearAllMocks();
  /* Um banco em dia: é o estado do caso vivido, e o que torna "falta
     migration" uma explicação impossível — sobrando só a divergência. */
  observarBanco.mockResolvedValue({
    configurada: true,
    alcancavel: true,
    aplicadas: 23,
    pendentes: [],
  });
});

afterEach(() => vi.unstubAllEnvs());

interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

async function pedir(caminho: string, init?: RequestInit): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, init);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

/** Lança `err` de dentro de um handler e devolve o que a API respondeu. */
async function respostaPara(
  err: unknown,
  prefixo = "/estoura",
): Promise<Resposta> {
  const chave = `caso${LANCAR.size}`;
  LANCAR.set(chave, () => err);
  return pedir(`${prefixo}/${chave}`);
}

// ---------------------------------------------------------------------------
// 1 — os erros conhecidos continuam respondendo o 4xx que sempre responderam
// ---------------------------------------------------------------------------

describe("as recusas nomeadas mantêm o número que a rota lhes dava", () => {
  /**
   * A tabela é a de `lib/recusa-de-dominio.ts`, e os números são os que estavam
   * escritos no comentário de cada classe — "a rota traduz em 404". O que mudou
   * é que agora existe **um** lugar que traduz, e não trinta e nove cópias.
   */
  const CASOS: [string, () => Error, number][] = [
    [
      "contexto que não existe",
      () => new ContextNotFoundError({ scopeHash: "abc" }, []),
      404,
    ],
    [
      "recorte que não existe no contexto",
      () =>
        new JanelaInvalidaError("A vigência 2026-01-01 não existe aqui.", [
          "2026-02-01",
        ]),
      400,
    ],
    [
      "célula de cobertura inexistente",
      () => new CelulaNaoEncontrada("id", "CAVALO"),
      404,
    ],
    [
      "decisão de curadoria recusada",
      () => new DecisaoRecusada("Exige justificativa."),
      422,
    ],
    [
      "baixa de frota recusada",
      () => new BaixaRecusada("Já existe baixa nesta data."),
      422,
    ],
    ["e-mail já usado por outra conta", () => new EmailAlreadyUsedError(), 409],
  ];

  for (const [nome, montar, esperado] of CASOS) {
    it(`${nome} responde ${esperado}`, async () => {
      const { status, body } = await respostaPara(montar());

      expect(status).toBe(esperado);
      expect(body["code"]).toBe(CODIGO_RECUSA);
      /* A frase é do domínio, e sai inteira: é ela que diz o que fazer. */
      expect(body["error"]).toBe(montar().message);
      expect(body["requestId"]).toBe(REQUEST_ID);
    });
  }

  it("a recusa vem antes do diagnóstico de banco", async () => {
    /*
      A ordem importa: perguntar pelo banco primeiro faria uma vigência
      inexistente — que é uma resposta, não uma falha — parecer um banco
      quebrado, e o `observarBanco` seria consultado à toa.
    */
    const { status } = await respostaPara(
      new ContextNotFoundError({ scopeHash: "x" }, []),
    );

    expect(status).toBe(404);
    expect(observarBanco).not.toHaveBeenCalled();
  });

  it("uma recusa não carrega detalhe: a frase dela já é o detalhe", async () => {
    const { body } = await respostaPara(
      new DecisaoRecusada("Exige justificativa."),
    );

    expect(body["detalhe"]).toBeUndefined();
  });

  it("corpo JSON malformado continua 400, e não 500", async () => {
    const { status, body } = await pedir("/estoura/qualquer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{isto não é json",
    });

    expect(status).toBe(400);
    expect(body["code"]).toBe(CODIGO_PEDIDO_INVALIDO);
    expect(body["error"]).toMatch(/não é JSON válido/);
    expect(body["requestId"]).toBe(REQUEST_ID);
  });

  it("caminho sem rota continua 404 em JSON", async () => {
    const { status, body } = await pedir("/nao/existe");

    expect(status).toBe(404);
    expect(body["code"]).toBe(CODIGO_ROTA_DESCONHECIDA);
    expect(body["requestId"]).toBe(REQUEST_ID);
  });
});

// ---------------------------------------------------------------------------
// 2 — falta de schema responde 503 com diagnóstico
// ---------------------------------------------------------------------------

describe("o banco a que falta parte do schema", () => {
  /** Os SQLSTATEs que, sozinhos, dizem "uma migration não rodou aqui". */
  const SQLSTATES = [
    ["42P01", 'relation "chamado" does not exist'],
    ["42703", 'column "attribute.definition" does not exist'],
    ["42704", 'type "book_entry_kind" does not exist'],
    ["42883", "function freightcheck_snapshot_key(text) does not exist"],
  ] as const;

  for (const [code, texto] of SQLSTATES) {
    it(`${code} responde 503 com o diagnóstico do banco`, async () => {
      const { status, body } = await respostaPara(erroDoDrizzle(code, texto));

      expect(status).toBe(503);
      expect(body["code"]).toBe("SCHEMA_AUSENTE");
      expect((body["diagnostico"] as { estado: string }).estado).toBe(
        "SCHEMA_DIVERGENTE",
      );
      exigirRespostaLimpa(body);
    });
  }

  it("42P10 do ON CONFLICT sem índice é schema, e responde 503", async () => {
    const { status, body } = await respostaPara(
      erroDoDrizzle("42P10", "no unique constraint matching", {
        routine: "infer_arbiter_indexes",
      }),
    );

    expect(status).toBe(503);
    expect(body["code"]).toBe("SCHEMA_AUSENTE");
  });

  it("42P10 de consulta mal escrita é defeito nosso, e responde 500", async () => {
    /*
      A separação é pela `routine`, que o Postgres manda sem traduzir. Fosse
      pelo SQLSTATE sozinho, um `ORDER BY 5` fora da lista de seleção mandaria
      alguém rodar migrations por causa de um bug nosso.
    */
    const { status, body } = await respostaPara(
      erroDoDrizzle("42P10", "ORDER BY position 5 is not in select list", {
        routine: "findTargetlistEntrySQL92",
      }),
    );

    expect(status).toBe(500);
    expect(body["code"]).toBe(CODIGO_ERRO_INTERNO);
    expect(JSON.stringify(body)).not.toMatch(/migration/i);
  });

  it("o SQLSTATE atravessa para o contexto — a mensagem do driver não", async () => {
    const { body } = await respostaPara(
      erroDoDrizzle("42703", 'column "attribute.definition" does not exist'),
    );

    expect(body["contexto"]).toContain("42703");
    exigirRespostaLimpa(body);
  });

  it("sem declaração do router, o contexto nomeia o pedido que parou", async () => {
    const { body } = await respostaPara(erroDoDrizzle("42P01", "no table"));

    expect(body["contexto"]).toMatch(/GET \/estoura\//);
  });

  it("com declaração do router, é a frase da superfície que sai", async () => {
    const { body } = await respostaPara(
      erroDoDrizzle("42P01", "no table"),
      "/comdeclaracao",
    );

    expect(body["contexto"]).toContain(
      "O Book não tem onde guardar neste banco.",
    );
    expect(body["contexto"]).toContain("42P01");
  });

  it("o diagnóstico é o mesmo do /healthz, e ninguém escreve recomendação por fora", async () => {
    const { body } = await respostaPara(
      erroDoDrizzle("42703", "column x does not exist"),
    );
    const diagnostico = body["diagnostico"] as {
      acao: { codigo: string };
      risco: { emRisco: boolean };
    };

    /* Registro em dia + objeto ausente = divergência, e não fila atrasada:
       mandar rodar migration de novo aqui não resolveria nada. */
    expect(diagnostico.acao.codigo).toBe("CONFERIR_SCHEMA");
    expect(diagnostico.risco.emRisco).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3 — o inesperado responde 500 com requestId
// ---------------------------------------------------------------------------

describe("a falha que ninguém previu", () => {
  const INESPERADOS: [string, () => unknown][] = [
    ["um defeito de código", () => new TypeError("x is not a function")],
    [
      "um erro do banco que não é schema",
      () => erroDoDrizzle("23505", "duplicate key"),
    ],
    ["algo que nem é Error", () => ({ algo: "que não é Error" })],
    ["um Error sem mensagem", () => new Error("")],
  ];

  for (const [nome, montar] of INESPERADOS) {
    it(`${nome} responde 500 com code e requestId`, async () => {
      const { status, body } = await respostaPara(montar());

      expect(status).toBe(500);
      expect(body["code"]).toBe(CODIGO_ERRO_INTERNO);
      expect(body["requestId"]).toBe(REQUEST_ID);
      /* A constante que este trabalho inteiro existe para eliminar. */
      expect(body["error"]).not.toBe("Internal server error");
      expect(body["error"]).toBeTruthy();
    });
  }

  it("uma rejeição de handler assíncrono chega aqui, e não ao finalhandler", async () => {
    /*
      É o Express 5 que encaminha a rejeição sozinho. Vale travar: no 4 ela
      virava `unhandledRejection`, e a tela recebia HTML — o desfecho que faz
      quem investiga procurar um processo derrubado que está de pé.
    */
    const { status, body } = await respostaPara(
      new TypeError("boom"),
      "/assincrono",
    );

    expect(status).toBe(500);
    expect(body["code"]).toBe(CODIGO_ERRO_INTERNO);
    expect(body["requestId"]).toBe(REQUEST_ID);
  });

  it("se o próprio diagnóstico falhar, a resposta ainda é 500 em JSON", async () => {
    /*
      O desfecho de schema abre conexão. Um handler de erro cuja promessa
      rejeita deixa o Express responder HTML — e voltaríamos a ter uma falha
      nossa parecendo falha de infraestrutura.
    */
    observarBanco.mockRejectedValue(
      new Error("o banco caiu no meio do diagnóstico"),
    );

    const { status, body } = await respostaPara(
      erroDoDrizzle("42P01", "no table"),
    );

    expect(status).toBe(500);
    expect(body["code"]).toBe(CODIGO_ERRO_INTERNO);
    expect(body["requestId"]).toBe(REQUEST_ID);
  });
});

// ---------------------------------------------------------------------------
// 4 — nada de sensível atravessa, em nenhum ambiente
// ---------------------------------------------------------------------------

describe("o que nunca sai desta API", () => {
  const VAZAMENTOS: [string, () => unknown][] = [
    [
      "a consulta que o drizzle carimba",
      () => erroDoDrizzle("23505", "duplicate key"),
    ],
    ["o 42P01 embrulhado", () => erroDoDrizzle("42P01", "no table")],
    [
      "um erro cuja própria frase é a consulta",
      () =>
        new Error(
          'Failed query: UPDATE "import_run" SET status = $1 params: PROMOTED',
        ),
    ],
    [
      "um stack trace que virou mensagem",
      () =>
        new Error(
          "boom\n    at promote (/app/lib/ingest/src/pipeline.ts:1815:11)\n    at async /app/dist/index.mjs:9:1",
        ),
    ],
  ];

  for (const [nome, montar] of VAZAMENTOS) {
    it(`${nome} não chega ao corpo da resposta`, async () => {
      const { body } = await respostaPara(montar());
      exigirRespostaLimpa(body);
    });
  }

  it("o detalhe some inteiro em produção", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { body } = await respostaPara(new TypeError("x is not a function"));

    expect(body["detalhe"]).toBeUndefined();
    /* O que **não** depende do ambiente: é o requestId que substitui o detalhe
       para quem está na tela, e ele sai sempre. */
    expect(body["requestId"]).toBe(REQUEST_ID);
  });

  it("mesmo com API_ERRO_DETALHADO=1 em produção, a consulta não passa", async () => {
    /*
      A chave decide **se** há detalhe; ela nunca decidiu **o quê**. Era essa a
      brecha: ligada em produção, ela publicava `Failed query: … params: …` de
      qualquer falha de banco.
    */
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_ERRO_DETALHADO", "1");

    const { body } = await respostaPara(
      erroDoDrizzle("23505", "duplicate key"),
    );

    expect(body["detalhe"]).toBeTruthy();
    expect(body["detalhe"]).toContain("SQLSTATE 23505");
    exigirRespostaLimpa(body);
  });

  it("fora de produção, o detalhe de um defeito nosso continua legível", async () => {
    /* A troca não pode custar o que o detalhe comprava: um `TypeError` não
       carrega SQL, e ler "x is not a function" economiza uma ida ao log. */
    const { body } = await respostaPara(new TypeError("x is not a function"));

    expect(body["detalhe"]).toContain("x is not a function");
  });
});
