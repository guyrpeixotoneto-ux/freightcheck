/**
 * A tela quase inteira funcionando, e um pedaço quebrado.
 *
 * O caso vivido, em 16/08/2026: a Curadoria de Atributos abriu com os três
 * cartões de cima somando certo — 0 confirmados, 75 aguardando, 0 monetários
 * sem confirmar — e a fila logo abaixo respondeu `Internal server error`. O
 * `/api/healthz`, consultado no mesmo minuto, respondeu `SAUDAVEL`, com
 * `migrations: {expected: 23, applied: 23, pending: []}` e "nenhuma ação é
 * necessária".
 *
 * As três coisas eram verdade ao mesmo tempo, e é isso que este arquivo trava.
 * O resumo conta `attribute` agrupado por status e não lê mais nada; a fila lê
 * `attribute.definition`, a coluna que a `0022_significado` acrescenta e que
 * **nenhuma outra tela toca**. Num banco onde essa migration consta aplicada e
 * não deixou a coluna, essa é exatamente a fronteira do estrago — e a contagem
 * de migrations não o revela, porque por ela está tudo em dia.
 *
 * O que a rota respondia àquilo era uma constante: a mesma frase para uma
 * coluna que falta, para o banco fora do ar e para um defeito nosso, sem
 * `requestId` que ligasse a tela ao log. Estes casos exigem os dois desfechos
 * que substituíram a constante — 503 com diagnóstico quando falta schema, e o
 * contrato JSON com `requestId` para todo o resto — e, como em
 * `imports-falha`, exigem que nenhuma resposta carregue a consulta.
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

const observarBanco = vi.hoisted(() => vi.fn<() => Promise<EstadoObservado>>());
const getCurationQueue = vi.hoisted(() => vi.fn());
const getCurationSummary = vi.hoisted(() => vi.fn());
const confirmAttribute = vi.hoisted(() => vi.fn());
const saveMeaning = vi.hoisted(() => vi.fn());
const getAttributeDetail = vi.hoisted(() => vi.fn());

vi.mock("../../lib/migrations", async (original) => ({
  ...(await original<typeof import("../../lib/migrations")>()),
  observarBanco,
}));

vi.mock("@workspace/curation", async (original) => ({
  ...(await original<typeof import("@workspace/curation")>()),
  getCurationQueue,
  getCurationSummary,
  confirmAttribute,
  saveMeaning,
  getAttributeDetail,
}));

const { default: router } = await import("../curation");
const { faltaOSchemaDaCuradoria } = await import("../curation");
const { erroEmJson, CODIGO_ERRO_INTERNO } = await import(
  "../../middlewares/contrato-json"
);

const CODIGO = "cavalo.ipva_licenciamento";

/**
 * O erro que o `pg` levanta e o drizzle embrulha.
 *
 * A `message` do `DrizzleQueryError` é a consulta inteira com os parâmetros —
 * é dela que sai o `Failed query: … params: …` que não pode chegar à tela. O
 * SQLSTATE mora no `cause`, que é onde o driver o põe de verdade.
 */
function erroDoDrizzle(code: string, texto: string): DrizzleQueryError {
  return new DrizzleQueryError(
    'select "attribute"."code", "attribute"."definition", ' +
      '"attribute_semantics"."calculation_basis" from "attribute" left join ' +
      '"taxonomy_node" on "attribute"."taxonomy_node_id" = "taxonomy_node"."id" ' +
      'left join "attribute_semantics" on "attribute_semantics"."attribute_id" ' +
      '= "attribute"."id" where $1',
    ["true"],
    Object.assign(new Error(texto), { code }),
  );
}

/** O erro exato do banco divergente: a coluna que a 0022 cria não está lá. */
function colunaAusente(): DrizzleQueryError {
  return erroDoDrizzle("42703", 'column "attribute.definition" does not exist');
}

/** Tudo o que nunca pode sair desta API para o browser. */
const PROIBIDO: [RegExp, string][] = [
  [/failed query:/i, "o carimbo do drizzle"],
  [/\bparams:/i, "os parâmetros da consulta"],
  [/select\b[\s\S]*\bfrom\b/i, "SQL de leitura"],
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

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // O que o pino-http e a sessão instalam em produção. `user` porque
    // `/confirm` e `/meaning` assinam com quem está logado, e não com o corpo.
    Object.assign(req, {
      log: { warn: () => {}, error: () => {} },
      id: "req-de-teste",
      user: { email: "curador@ambev.com.br" },
    });
    next();
  });
  app.use(router);
  // O contrato JSON, montado como no `app.ts`: é para ele que a rota manda o
  // que não é falta de schema, e sem ele o teste mediria o `finalhandler`.
  app.use(erroEmJson);
  await new Promise<void>((resolve) => {
    servidor = app.listen(0, () => resolve());
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
  /*
    O estado que o /healthz respondeu no dia: conectado, 23 registradas, nada
    pendente. É o que torna este arquivo o teste do caso vivido e não de um
    banco atrasado qualquer — com `pendentes` vazio, "falta migration" deixa de
    ser explicação possível, e só sobra a divergência.
  */
  observarBanco.mockResolvedValue({
    configurada: true,
    alcancavel: true,
    aplicadas: 23,
    pendentes: [],
  });
});

afterEach(() => vi.restoreAllMocks());

interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

async function pedir(caminho: string, init?: RequestInit): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// A — o caso vivido
// ---------------------------------------------------------------------------

describe("a fila que morre numa coluna que o registro dá por criada", () => {
  it("responde 503 e classifica o banco como SCHEMA_DIVERGENTE", async () => {
    getCurationQueue.mockRejectedValue(colunaAusente());

    const { status, body } = await pedir("/curation/queue?includeConfirmed=false");

    expect(status).toBe(503);
    expect(body["code"]).toBe("SCHEMA_AUSENTE");
    expect((body["diagnostico"] as { estado: string }).estado).toBe(
      "SCHEMA_DIVERGENTE",
    );
  });

  it("diz o SQLSTATE e as migrations, e não a consulta", async () => {
    getCurationQueue.mockRejectedValue(colunaAusente());

    const { body } = await pedir("/curation/queue");

    expect(body["contexto"]).toContain("42703");
    expect(body["contexto"]).toContain("0022_significado");
    exigirRespostaLimpa(body);
  });

  it("não manda rodar as migrations de novo — o registro já as dá por aplicadas", async () => {
    getCurationQueue.mockRejectedValue(colunaAusente());

    const { body } = await pedir("/curation/queue");
    const acao = (body["diagnostico"] as { acao: { codigo: string } }).acao;

    expect(acao.codigo).toBe("CONFERIR_SCHEMA");
  });

  it("garante ao curador que nada foi gravado nem perdido", async () => {
    getCurationQueue.mockRejectedValue(colunaAusente());

    const { body } = await pedir("/curation/queue");
    const risco = (body["diagnostico"] as { risco: { emRisco: boolean } }).risco;

    expect(risco.emRisco).toBe(false);
    expect(body["contexto"]).toContain("Nada foi gravado");
  });
});

// ---------------------------------------------------------------------------
// B — a assimetria que enganava quem olhava a tela
// ---------------------------------------------------------------------------

describe("o resumo que continua somando enquanto a fila cai", () => {
  it("responde 200 no mesmo banco em que a fila responde 503", async () => {
    // Os números da tela: nenhum confirmado, 75 aguardando.
    getCurationSummary.mockResolvedValue({
      byStatus: [{ status: "UNKNOWN", count: 75, monetary: 0 }],
      unclassified: 75,
    });
    getCurationQueue.mockRejectedValue(colunaAusente());

    const resumo = await pedir("/curation/summary");
    const fila = await pedir("/curation/queue");

    expect(resumo.status).toBe(200);
    expect(fila.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// C — o que não é falta de schema segue para o contrato JSON
// ---------------------------------------------------------------------------

describe("o defeito que não é banco divergente", () => {
  it("vira 500 com code e requestId, e não a constante de antes", async () => {
    getCurationQueue.mockRejectedValue(new TypeError("x is not a function"));

    const { status, body } = await pedir("/curation/queue");

    expect(status).toBe(500);
    expect(body["code"]).toBe(CODIGO_ERRO_INTERNO);
    expect(body["requestId"]).toBe("req-de-teste");
    expect(body["error"]).not.toBe("Internal server error");
  });
});

// ---------------------------------------------------------------------------
// D — as rotas que respondiam 422 a uma coluna que falta
// ---------------------------------------------------------------------------

describe("gravar num banco divergente", () => {
  it("confirmar responde 503, e não 422 culpando o que o curador preencheu", async () => {
    confirmAttribute.mockRejectedValue(colunaAusente());

    const { status, body } = await pedir(
      `/curation/attributes/${CODIGO}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "IPVA é anual, conferido no contrato." }),
      },
    );

    expect(status).toBe(503);
    expect(body["code"]).toBe("SCHEMA_AUSENTE");
    exigirRespostaLimpa(body);
  });

  it("escrever o significado responde 503 — é a coluna da própria 0022", async () => {
    saveMeaning.mockRejectedValue(colunaAusente());

    const { status, body } = await pedir(
      `/curation/attributes/${CODIGO}/meaning`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition: "Vida útil considerada em contrato." }),
      },
    );

    expect(status).toBe(503);
    expect(body["code"]).toBe("SCHEMA_AUSENTE");
    exigirRespostaLimpa(body);
  });

  it("a recusa de regra de negócio continua 422, com a frase do curador", async () => {
    confirmAttribute.mockRejectedValue(
      new Error("Confirmar algo monetário exige unidade, periodicidade e agregação."),
    );

    const { status, body } = await pedir(
      `/curation/attributes/${CODIGO}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "IPVA é anual." }),
      },
    );

    expect(status).toBe(422);
    expect(body["error"]).toContain("exige unidade");
  });
});

// ---------------------------------------------------------------------------
// E — a autoridade sobre o que é falta de schema
// ---------------------------------------------------------------------------

describe("faltaOSchemaDaCuradoria", () => {
  it("reconhece coluna, tabela e tipo ausentes através do embrulho do drizzle", () => {
    for (const code of ["42703", "42P01", "42704", "42883"]) {
      expect(faltaOSchemaDaCuradoria(erroDoDrizzle(code, "ausente"))).toBe(true);
    }
  });

  it("não confunde defeito nosso com banco divergente", () => {
    expect(faltaOSchemaDaCuradoria(new TypeError("x is not a function"))).toBe(
      false,
    );
    // Violação de unicidade: o schema está lá, o dado é que colidiu.
    expect(faltaOSchemaDaCuradoria(erroDoDrizzle("23505", "duplicate"))).toBe(
      false,
    );
  });
});
