/**
 * O SQL que chegou à tela.
 *
 * Aprovar uma planilha devolveu, em vermelho e no meio da tela de Importações,
 * `Failed query: INSERT INTO "snapshot_entity_type" ( snapshot_id, entity_type,
 * … ) SELECT $1::uuid, … params: 1f10e1af-…`. A planilha tinha 41.391 fatos e
 * zero erros; o que faltava era a migration `0021_cobertura` naquele banco.
 *
 * Duas coisas produziram aquela tela. O drizzle não deixa o erro do `pg` subir
 * cru — ele o embrulha num `DrizzleQueryError` cuja `message` é a consulta
 * inteira com os parâmetros, e põe o erro de verdade em `cause`. E a rota
 * respondia `err.message` direto, com status 422, que nesta API significa "o
 * dado não fecha: corrija a origem e reenvie". A resposta mandava mexer numa
 * planilha que estava certa.
 *
 * Estes testes usam o `DrizzleQueryError` **de verdade**, e não uma imitação:
 * o que se quer provar é que aquela mensagem, exatamente daquela forma, não
 * atravessa mais. Por isso também a última varredura, que não olha o desfecho
 * de nenhum caso em particular — só passeia por todas as saídas do fluxo e
 * exige que nenhuma carregue consulta, parâmetro ou stack.
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
const promote = vi.hoisted(() => vi.fn());
const getImportRunStatus = vi.hoisted(() => vi.fn());
const listImportRuns = vi.hoisted(() => vi.fn());
const deleteImportRun = vi.hoisted(() => vi.fn());

vi.mock("../../lib/migrations", async (original) => ({
  ...(await original<typeof import("../../lib/migrations")>()),
  observarBanco,
}));

vi.mock("@workspace/ingest", async (original) => ({
  ...(await original<typeof import("@workspace/ingest")>()),
  promote,
  getImportRunStatus,
  listImportRuns,
  deleteImportRun,
}));

const { default: router } = await import("../imports");
const { classificarFalhaDeImportacao, ehFraseParaQuemOpera, motivoGravavel } =
  await import("../imports");
const { PromocaoRecusada } = await import("@workspace/ingest");

const RUN = "1f10e1af-ac9b-4beb-86f4-17f941419318";

/**
 * A consulta que apareceu na tela, montada pela classe que a montou.
 *
 * `DrizzleQueryError` compõe `message` a partir da consulta e dos parâmetros —
 * é dela que sai o `Failed query: … params: …`. Passar o erro do `pg` como
 * `cause` é o que o driver faz de verdade, e é onde mora o SQLSTATE.
 */
function erroDoDrizzle(code: string, texto: string): DrizzleQueryError {
  return new DrizzleQueryError(
    'INSERT INTO "snapshot_entity_type" ( snapshot_id, entity_type, ' +
      "entity_count ) SELECT $1::uuid, e.entity_type, count(*)::int FROM " +
      '"fact" f JOIN "entity" e ON e.id = f.entity_id WHERE f.snapshot_id = ' +
      "$2::uuid GROUP BY e.entity_type ON CONFLICT (snapshot_id, entity_type) " +
      "DO NOTHING",
    [RUN, RUN],
    Object.assign(new Error(texto), { code }),
  );
}

/** Tudo o que nunca pode sair desta API para o browser. */
const PROIBIDO: [RegExp, string][] = [
  [/failed query:/i, "o carimbo do drizzle"],
  [/\bparams:/i, "os parâmetros da consulta"],
  [/insert\s+into/i, "SQL de escrita"],
  [/update\s+"?\w+"?\s+set/i, "SQL de escrita"],
  [/delete\s+from/i, "SQL de escrita"],
  [/select\b[\s\S]*\bfrom\b/i, "SQL de leitura"],
  [/on\s+conflict/i, "a especificação de conflito"],
  [/\$\d+::uuid/, "um parâmetro posicional"],
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
  // O `req.log` que o pino-http instala em produção. Aqui basta engolir: o
  // conteúdo do log é conferido à parte, e o que estes casos olham é a resposta.
  app.use((req, _res, next) => {
    Object.assign(req, { log: { warn: () => {}, error: () => {} } });
    next();
  });
  app.use(router);
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
  // O estado normal de um banco atrasado: alcançável, com migrations na fila.
  observarBanco.mockResolvedValue({
    configurada: true,
    alcancavel: true,
    aplicadas: 20,
    pendentes: ["0021_cobertura"],
  });
  getImportRunStatus.mockResolvedValue({ status: "PREVIEWED" });
});

afterEach(() => vi.restoreAllMocks());

interface Resposta {
  status: number;
  body: unknown;
}

async function aprovar(): Promise<Resposta> {
  const res = await fetch(`${base}/imports/${RUN}/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmNewEntityTypes: ["CARRETA"] }),
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// A — o caso vivido
// ---------------------------------------------------------------------------

describe("a aprovação que esbarra num schema atrasado", () => {
  it("responde 503 com o diagnóstico do banco, e não a consulta", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle("42P01", 'relation "snapshot_entity_type" does not exist'),
    );

    const { status, body } = await aprovar();

    // 503 e não 422: é indisponibilidade deste ambiente, não erro do pedido.
    expect(status).toBe(503);
    const corpo = body as Record<string, unknown>;
    expect(corpo["code"]).toBe("SCHEMA_AUSENTE");
    expect((corpo["diagnostico"] as { estado: string }).estado).toBe(
      "MIGRATIONS_PENDENTES",
    );
    exigirRespostaLimpa(body);
  });

  it("não manda corrigir nem reenviar a planilha", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle("42P01", 'relation "snapshot_entity_type" does not exist'),
    );

    const { body } = await aprovar();
    const corpo = body as Record<string, unknown>;
    const contexto = corpo["contexto"] as string;

    // O que a rota escreve é só o que ela sabe, e o que ela sabe inocenta o
    // arquivo. Mandar reenviar era o efeito do 422 que este caso substitui.
    expect(contexto).toMatch(/não é a sua planilha/i);
    expect(contexto).not.toMatch(/reenvi|corrija a origem/i);
    // Recomendação nenhuma sai da rota — quem recomenda é o diagnóstico.
    expect(contexto).not.toMatch(/pnpm|migrate|reinici/i);
  });

  it("o 42P01 chega até com o erro do pg embrulhado em vários níveis", async () => {
    // `cause` é campo livre, e nada obriga o driver a ser o primeiro nível.
    // Um wrapper de retentativa por cima do drizzle já bastaria para esconder
    // o SQLSTATE de quem só olhasse a superfície.
    const doDrizzle = erroDoDrizzle(
      "42703",
      'column "inherited_fact_count" does not exist',
    );
    const doRepositorio = Object.assign(
      new Error("falha ao gravar o agregado"),
      {
        cause: doDrizzle,
      },
    );
    const doServico = Object.assign(new Error("promoção interrompida"), {
      cause: doRepositorio,
    });
    promote.mockRejectedValue(doServico);

    const { status, body } = await aprovar();

    expect(status).toBe(503);
    expect((body as Record<string, unknown>)["code"]).toBe("SCHEMA_AUSENTE");
    exigirRespostaLimpa(body);
  });
});

// ---------------------------------------------------------------------------
// C — o ON CONFLICT sem índice
// ---------------------------------------------------------------------------

describe("42P10 — o ON CONFLICT sem índice que o case", () => {
  /**
   * O segundo desfecho do mesmo banco atrasado, e o mais fácil de classificar
   * errado: a tabela existe, só o índice único não. `snapshot_entity_type_uq`
   * nasce na mesma migration da tabela, e sem ele o `ON CONFLICT (snapshot_id,
   * entity_type)` do pipeline não tem em que se apoiar.
   */
  it("é schema atrasado, então 503 — nunca 422", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle(
        "42P10",
        "there is no unique or exclusion constraint matching the ON CONFLICT specification",
      ),
    );

    const { status, body } = await aprovar();

    expect(status).toBe(503);
    expect(status).not.toBe(422);
    expect((body as Record<string, unknown>)["code"]).toBe("SCHEMA_AUSENTE");
    exigirRespostaLimpa(body);
  });

  it("42883 — a função que a migration cria — é o mesmo desfecho", async () => {
    promote.mockRejectedValue(
      erroDoDrizzle(
        "42883",
        "function freightcheck_snapshot_key(text, text, text, date, jsonb) does not exist",
      ),
    );

    const { status } = await aprovar();
    expect(status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// D — a recusa que continua sendo recusa
// ---------------------------------------------------------------------------

describe("as recusas escritas para quem opera continuam inteiras", () => {
  it("uma recusa nomeada mantém 422, a frase e a decisão", async () => {
    const frase =
      "Esta vigência não fecha: o total de EMPURRADA_2_1_2026 diverge do " +
      "somatório dos componentes. Corrija a origem e envie o arquivo de novo.";
    promote.mockRejectedValue(
      new PromocaoRecusada(frase, "DADO_NAO_FECHA", "VALIDATION_ERROR", {
        label: "EMPURRADA_2_1_2026",
      }),
    );

    const { status, body } = await aprovar();
    const corpo = body as Record<string, unknown>;

    expect(status).toBe(422);
    expect(corpo["error"]).toBe(frase);
    expect(corpo["decisao"]).toBe("DADO_NAO_FECHA");
    expect((corpo["detalhe"] as Record<string, unknown>)["label"]).toBe(
      "EMPURRADA_2_1_2026",
    );
  });

  it("já existe uma versão ativa continua sendo 409, com o run aprovável", async () => {
    promote.mockRejectedValue(
      new PromocaoRecusada(
        "Já existe uma versão ativa desta vigência. Registre uma correção para substituí-la.",
        "VIGENCIA_ATIVA_EXISTENTE",
        "PREVIEWED",
        { revisionAtiva: 1 },
      ),
    );

    const { status, body } = await aprovar();
    expect(status).toBe(409);
    expect((body as Record<string, unknown>)["error"]).toMatch(/versão ativa/i);
  });

  it("a recusa de equipamento novo — um Error simples — não vira 500", async () => {
    // O pipeline a levanta com `new Error(...)`, não com `PromocaoRecusada`.
    // Trocá-la por uma frase genérica seria perder a única mensagem que
    // explica o que houve com a aba CARRETA.
    const frase =
      "Esta importação criaria um equipamento que o dicionário não conhece: " +
      "CARRETA. Se for equipamento novo mesmo, confirme CARRETA na pré-visualização.";
    promote.mockRejectedValue(new Error(frase));

    const { status, body } = await aprovar();
    expect(status).toBe(422);
    expect((body as Record<string, unknown>)["error"]).toBe(frase);
  });

  it("o estado errado é recusado antes de chegar ao pipeline", async () => {
    getImportRunStatus.mockResolvedValue({ status: "PROMOTED" });

    const { status, body } = await aprovar();
    expect(status).toBe(409);
    expect((body as Record<string, unknown>)["error"]).toMatch(
      /já foi aprovada/i,
    );
    expect(promote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E — o inesperado
// ---------------------------------------------------------------------------

describe("o erro inesperado responde sem contar o que é", () => {
  it("um defeito nosso vira 500 com frase segura, sem o texto do runtime", async () => {
    promote.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'entityId')"),
    );

    const { status, body } = await aprovar();
    const corpo = body as Record<string, unknown>;

    expect(status).toBe(500);
    expect(corpo["error"]).toMatch(/Não foi possível concluir a importação/);
    expect(corpo["error"]).toMatch(/healthz/);
    expect(JSON.stringify(corpo)).not.toMatch(/Cannot read properties/);
    expect(JSON.stringify(corpo)).not.toMatch(/entityId/);
  });

  it("um erro do banco que não é schema também é 500, e não 422", async () => {
    // 23505 é corrida de gravação: nem recusa de regra, nem migration faltando.
    // O que ele não pode virar é um 422 que mande corrigir a planilha.
    promote.mockRejectedValue(
      erroDoDrizzle("23505", "duplicate key value violates unique constraint"),
    );

    const { status, body } = await aprovar();
    expect(status).toBe(500);
    expect(status).not.toBe(422);
    exigirRespostaLimpa(body);
  });

  it("um erro sem mensagem não vira uma resposta vazia", async () => {
    promote.mockRejectedValue({ algo: "que não é Error" });

    const { status, body } = await aprovar();
    expect(status).toBe(500);
    expect((body as Record<string, unknown>)["error"]).toMatch(
      /Não foi possível concluir a importação/,
    );
  });
});

// ---------------------------------------------------------------------------
// F — a varredura
// ---------------------------------------------------------------------------

describe("nenhuma saída deste fluxo carrega SQL", () => {
  /** Cada forma que uma falha de banco toma antes de chegar a um `catch`. */
  const FALHAS: [string, () => unknown][] = [
    ["42P01 embrulhado pelo drizzle", () => erroDoDrizzle("42P01", "no table")],
    ["42P10 embrulhado pelo drizzle", () => erroDoDrizzle("42P10", "no index")],
    ["23505 embrulhado pelo drizzle", () => erroDoDrizzle("23505", "dup key")],
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

  /** Cada porta por onde uma resposta sai. */
  const PORTAS: [string, () => Promise<Resposta>][] = [
    ["POST /imports/:id/promote", () => aprovar()],
    [
      "GET /imports",
      async () => {
        const r = await fetch(`${base}/imports`);
        return { status: r.status, body: await r.json() };
      },
    ],
    [
      "GET /imports/:id/status",
      async () => {
        const r = await fetch(`${base}/imports/${RUN}/status`);
        return { status: r.status, body: await r.json() };
      },
    ],
    [
      "DELETE /imports/:id",
      async () => {
        const r = await fetch(`${base}/imports/${RUN}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "arquivo errado" }),
        });
        return { status: r.status, body: await r.json() };
      },
    ],
  ];

  for (const [nomeDaFalha, montar] of FALHAS) {
    for (const [nomeDaPorta, chamar] of PORTAS) {
      it(`${nomeDaPorta} com ${nomeDaFalha}`, async () => {
        promote.mockRejectedValue(montar());
        listImportRuns.mockRejectedValue(montar());
        deleteImportRun.mockRejectedValue(montar());
        getImportRunStatus.mockRejectedValue(montar());

        const { status, body } = await chamar();

        // Nunca 2xx: a falha continua sendo falha.
        expect(status).toBeGreaterThanOrEqual(400);
        exigirRespostaLimpa(body);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// As funções puras, direto
// ---------------------------------------------------------------------------

describe("classificarFalhaDeImportacao", () => {
  it("o SQLSTATE decide antes do texto, e é procurado dentro do embrulho", () => {
    expect(classificarFalhaDeImportacao(erroDoDrizzle("42P01", "x"))).toEqual({
      tipo: "SCHEMA",
    });
    expect(classificarFalhaDeImportacao(erroDoDrizzle("42P10", "x"))).toEqual({
      tipo: "SCHEMA",
    });
    expect(classificarFalhaDeImportacao(erroDoDrizzle("23505", "x"))).toEqual({
      tipo: "INESPERADO",
    });
  });

  it("uma frase escrita em português é recusa, e sobrevive inteira", () => {
    const frase = "Esta vigência não fecha: corrija a origem e envie de novo.";
    expect(classificarFalhaDeImportacao(new Error(frase))).toEqual({
      tipo: "REGRA",
      mensagem: frase,
    });
  });

  it("um defeito do runtime nunca é recusa, por mais que seja um Error", () => {
    expect(
      classificarFalhaDeImportacao(new TypeError("x is undefined")),
    ).toEqual({ tipo: "INESPERADO" });
    expect(
      classificarFalhaDeImportacao(new RangeError("out of range")),
    ).toEqual({
      tipo: "INESPERADO",
    });
  });

  it("a peneira final pega o que a classificação não viu", () => {
    // Um erro sem `code` nenhum, cuja mensagem é a consulta: nada o
    // classificaria como banco, e ainda assim ele não pode virar resposta.
    const semCodigo = new Error('Failed query: INSERT INTO "fact" params: 1');
    expect(classificarFalhaDeImportacao(semCodigo)).toEqual({
      tipo: "INESPERADO",
    });
  });
});

describe("ehFraseParaQuemOpera", () => {
  it("deixa passar as frases que o pipeline escreve", () => {
    expect(
      ehFraseParaQuemOpera(
        "Esta importação criaria um equipamento que o dicionário não conhece: CARRETA.",
      ),
    ).toBe(true);
    expect(
      ehFraseParaQuemOpera(
        "Já existe uma versão ativa desta vigência. Registre uma correção.",
      ),
    ).toBe(true);
  });

  it("barra consulta, parâmetro e stack", () => {
    expect(ehFraseParaQuemOpera("Failed query: select 1")).toBe(false);
    expect(ehFraseParaQuemOpera('INSERT INTO "fact" VALUES (1)')).toBe(false);
    expect(ehFraseParaQuemOpera("DELETE FROM snapshot WHERE id = 1")).toBe(
      false,
    );
    expect(ehFraseParaQuemOpera('UPDATE "import_run" SET status = $1')).toBe(
      false,
    );
    expect(ehFraseParaQuemOpera("params: 1f10e1af-ac9b")).toBe(false);
    expect(ehFraseParaQuemOpera("boom\n    at promote (/app/x.ts:1:1)")).toBe(
      false,
    );
  });
});

describe("motivoGravavel", () => {
  /**
   * `import_run.failure_reason` é pior do que uma resposta HTTP: a resposta
   * passa, o campo fica. Ele é lido no card da importação meses depois, e era
   * por ali que a consulta entrava no banco para sempre.
   */
  it("nunca grava a consulta no run", () => {
    const gravado = motivoGravavel(erroDoDrizzle("42P01", "no table"));
    expect(gravado).not.toMatch(/Failed query|INSERT INTO|params:/i);
    expect(gravado).toMatch(/falta pelo menos uma migration/i);
    expect(gravado).toMatch(/healthz/);
  });

  it("preserva o motivo quando ele foi escrito para quem lê", () => {
    const frase = "A aba CAVALO não tem coluna de placa.";
    expect(motivoGravavel(new Error(frase))).toBe(frase);
  });

  it("um defeito do runtime vira frase genérica", () => {
    expect(
      motivoGravavel(new TypeError("undefined is not a function")),
    ).toMatch(/Não foi possível concluir a importação/);
  });
});
