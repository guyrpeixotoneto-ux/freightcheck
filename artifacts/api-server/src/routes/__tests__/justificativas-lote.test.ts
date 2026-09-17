import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso, justificativaTable } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `POST /justificativas/lote` — a mesma frase, aplicada a várias alterações.
 *
 * O que se prende aqui é o que separa esta rota de "um `changeIds` mais longo":
 *
 * 1. **o recorte é reaberto no servidor.** Quem seleciona "todos os resultados"
 *    manda o filtro, não a lista — e o universo que recebe a justificativa é o
 *    que o servidor apura com a mesma função que desenhou a tabela. É a única
 *    forma de o registro dizer a verdade sobre o que foi alcançado.
 * 2. **o par tem de bater.** Um filtro montado sobre um par e mandado com o id
 *    da comparação de outro gravaria a frase num universo que ninguém viu.
 * 3. **o que já está explicado não é sobrescrito em silêncio** — e substituir
 *    exige papel de administrador.
 * 4. **conflito e dado incompleto não são alterações**, e não recebem
 *    justificativa nem quando o id vem no corpo.
 * 5. **o universo fica registrado**, em `justificativa_lote`, com as quatro
 *    contagens do momento da gravação.
 */

const IPVA: AttributeSpec[] = [
  {
    code: "cavalo.ipva_licenciamento",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-02";
const ESCOPO = "scope-lote";

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;
let vigencia: Record<string, string> = {};
let changeSetId = "";
/** As alterações da comparação, por placa. */
let alteracao: Record<string, number> = {};

/** Quem está logado em cada requisição — trocado por teste. */
let usuario: { id: string; email: string; role: string } = {
  id: "u1",
  email: "operador@x.com",
  role: "OPERADOR",
};

const JUSTIFICATIVA = {
  formula: "IPVA = valor de nota × alíquota do estado",
  regra: "Muda quando a alíquota do estado muda.",
  conforme: true,
};

async function post(caminho: string, corpo: unknown) {
  const res = await fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const recorte = (over: Record<string, unknown> = {}) => ({
  tipo: "FILTRO",
  rubrica: "ipva",
  base: vigencia.base,
  comparada: vigencia.comparada,
  filtros: { estado: "ALTERADO" },
  ...over,
});

beforeAll(async () => {
  ctx = await createTestDatabase("api_justificativas_lote");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  /*
    Quatro placas: três com a mesma queda — o caso que a justificativa em lote
    existe para resolver — e uma que não se moveu, para provar que ela fica de
    fora do universo sem ninguém precisar filtrá-la.
  */
  const fixture = await buildFixture(
    ctx.db,
    IPVA,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          RPG0C44: { "cavalo.ipva_licenciamento": 7210 },
          RPG1B56: { "cavalo.ipva_licenciamento": 7210 },
          RPG1D47: { "cavalo.ipva_licenciamento": 7210 },
          RPG2E53: { "cavalo.ipva_licenciamento": 5000 },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          RPG0C44: { "cavalo.ipva_licenciamento": 4145.26 },
          RPG1B56: { "cavalo.ipva_licenciamento": 4145.26 },
          RPG1D47: { "cavalo.ipva_licenciamento": 4145.26 },
          RPG2E53: { "cavalo.ipva_licenciamento": 5000 },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: ESCOPO, canal: "EMPURRADA" },
  );

  vigencia = {
    base: fixture.snapshotIds["EMPURRADA_2_7_2026"]!,
    comparada: fixture.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    (req as unknown as { user: unknown }).user = usuario;
    next();
  });
  const { default: ipvaRouter } = await import("../ipva");
  const { default: justificativasRouter } = await import("../justificativas");
  app.use(ipvaRouter);
  app.use(justificativasRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  /* A comparação sai da mesma rota que a tela usa — é ela que calcula o
     `change_set` e devolve as linhas com os `change.id`. */
  const res = await fetch(
    `${base}/ipva/comparacao?base=${vigencia.base}&comparada=${vigencia.comparada}`,
  );
  const comparacao = (await res.json()) as any;
  changeSetId = comparacao.changeSetId;
  alteracao = Object.fromEntries(
    comparacao.linhas
      .filter((l: any) => l.id !== null)
      .map((l: any) => [l.entityLabel, l.id as number]),
  );
}, 600_000);

beforeEach(async () => {
  usuario = { id: "u1", email: "operador@x.com", role: "OPERADOR" };
  await ctx.db.delete(justificativaTable);
});

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await ctx?.pool.end().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});

  const admin = createDb(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433",
  );
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nomeDoBanco],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`);
  await admin.pool.end();
}, 60_000);

describe("o recorte, reaberto no servidor", () => {
  it("alcança as três alterações do filtro sem receber id nenhum", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(201);
    expect(res.body.resumo).toEqual({
      universo: 3,
      aplicadas: 3,
      preservadas: 0,
      sobrescritas: 0,
    });
    /* A placa parada não tem alteração, e por isso não está no universo. */
    expect(
      res.body.justificativas.map((j: any) => j.entityLabel).sort(),
    ).toEqual(["RPG0C44", "RPG1B56", "RPG1D47"]);
  });

  it("grava uma linha por alteração, com a mesma frase e o mesmo lote", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      ...JUSTIFICATIVA,
    });
    const lotes = new Set(res.body.justificativas.map((j: any) => j.loteId));
    expect(lotes.size).toBe(1);
    expect([...lotes][0]).toBe(res.body.lote.id);
    for (const j of res.body.justificativas) {
      expect(j.formula).toBe(JUSTIFICATIVA.formula);
      expect(j.conforme).toBe(true);
      expect(j.criadoPor).toBe("operador@x.com");
    }
  });

  it("registra o universo, por extenso e por objeto", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ filtros: { estado: "ALTERADO", busca: "RPG" } }),
      ...JUSTIFICATIVA,
    });
    expect(res.body.lote.escopo).toBe("FILTRO");
    expect(res.body.lote.descricao).toContain("todos os resultados do recorte");
    expect(res.body.lote.descricao).toContain("estado ALTERADO");
    expect(res.body.lote.recorte.filtros.busca).toBe("RPG");
    expect(res.body.lote.alteracoesNoUniverso).toBe(3);
  });

  it("honra a busca — o recorte do servidor é o mesmo da tela", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ filtros: { estado: "ALTERADO", busca: "RPG0C44" } }),
      ...JUSTIFICATIVA,
    });
    expect(res.body.resumo.universo).toBe(1);
    expect(res.body.justificativas[0].entityLabel).toBe("RPG0C44");
  });

  it("recusa um recorte de outro par — o filtro não pertence a esta comparação", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ base: vigencia.comparada, comparada: vigencia.base }),
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("outro par");
  });
});

describe("a seleção a dedo", () => {
  it("grava só o que foi escolhido", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: { tipo: "SELECAO", changeIds: [alteracao.RPG0C44] },
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(201);
    expect(res.body.resumo.aplicadas).toBe(1);
    expect(res.body.lote.escopo).toBe("SELECAO");
  });

  it("descarta id que não é desta comparação", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: { tipo: "SELECAO", changeIds: [alteracao.RPG0C44, 999_999] },
      ...JUSTIFICATIVA,
    });
    expect(res.body.resumo.universo).toBe(1);
  });

  it("recusa uma seleção vazia", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: { tipo: "SELECAO", changeIds: [] },
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(400);
  });
});

describe("o que já está justificado", () => {
  const jaGravada = async () => {
    await post("/justificativas/lote", {
      changeSetId,
      escopo: { tipo: "SELECAO", changeIds: [alteracao.RPG0C44] },
      ...JUSTIFICATIVA,
      formula: "a primeira explicação",
    });
  };

  it("é preservado por padrão, e contado", async () => {
    await jaGravada();
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      ...JUSTIFICATIVA,
    });
    expect(res.body.resumo).toEqual({
      universo: 3,
      aplicadas: 2,
      preservadas: 1,
      sobrescritas: 0,
    });
    expect(
      res.body.justificativas.map((j: any) => j.entityLabel),
    ).not.toContain("RPG0C44");
  });

  it("um operador não pode substituir", async () => {
    await jaGravada();
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      sobrescrever: true,
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("administrador");
  });

  it("um administrador pode, e a substituição fica registrada", async () => {
    await jaGravada();
    usuario = { id: "u2", email: "chefe@x.com", role: "ADMIN" };
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      sobrescrever: true,
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(201);
    expect(res.body.resumo).toEqual({
      universo: 3,
      aplicadas: 3,
      preservadas: 0,
      sobrescritas: 1,
    });
    expect(res.body.lote.sobrescrever).toBe(true);
    expect(res.body.lote.sobrescritas).toBe(1);

    /* A anterior não é apagada: é histórico, e a leitura mostra a mais recente. */
    const gravadas = await ctx.db.select().from(justificativaTable);
    expect(gravadas.filter((j) => j.changeId === alteracao.RPG0C44)).toHaveLength(2);
  });

  it("recusa, com o número na mão, quando não sobra nada a aplicar", async () => {
    await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      ...JUSTIFICATIVA,
    });
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(409);
    expect(res.body.resumo.preservadas).toBe(3);
  });
});

describe("o que a rota recusa", () => {
  it("uma justificativa incompleta, pela mesma regra do POST de uma alteração", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      formula: "só a fórmula",
    });
    expect(res.status).toBe(400);
    expect(res.body.faltam).toBeTruthy();
  });

  it("um corpo sem comparação", async () => {
    expect((await post("/justificativas/lote", { escopo: recorte() })).status).toBe(400);
  });

  it("uma rubrica cujo recorte ela não sabe reabrir", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ rubrica: "finame" }),
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(400);
  });
});
