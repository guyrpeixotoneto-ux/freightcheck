import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, realExportPath, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * As rotas de Cobertura de dados, sobre o export real.
 *
 * O que estas provas protegem não é o cálculo — ele é de `@workspace/coverage`
 * e está coberto lá, contra o export e contra fixtures. É o **contrato da
 * superfície**, e três propriedades dele em particular:
 *
 * 1. que a tela receba resumo, matriz, lacunas e descobertas de **uma** medição,
 *    e não de quatro chamadas que poderiam discordar entre si;
 * 2. que o drill-down devolva exatamente a mesma conta que a matriz mostrou;
 * 3. que uma decisão de curadoria sem justificativa pare em 422 com a frase
 *    escrita para quem opera, e não num 500 mudo.
 */
let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

interface Resposta {
  status: number;
  body: any;
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

async function post(caminho: string, corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_coverage");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const received = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  const report = await preview(ctx.db, received.importRunId);
  await promote(ctx.db, received.importRunId, {
    confirmNewEntityTypes: report.pendingIdentities,
  });
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);

  const { default: coverageRouter } = await import("../coverage");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    /* A sessão é do middleware, testado em `auth.test.ts`; aqui ela é fixada. */
    (req as unknown as { user: { email: string } }).user = { email: "curador@teste" };
    next();
  });
  app.use(coverageRouter);
  /*
    O contrato JSON, montado como no `app.ts`. Não é cerimônia de teste: desde
    que a tradução das recusas e o diagnóstico de schema saíram dos `catch` das
    rotas, é ele quem responde 404, 400, 422, 503 e 500 — e um app de teste sem
    ele mede o `finalhandler` do Express, que devolve HTML.
  */
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  /* A semeadura é explícita, como na promoção — nunca efeito colateral de um GET. */
  await post("/coverage/contract/seed", {});
}, 600_000);

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

describe("GET /coverage", () => {
  it("devolve resumo, matriz, lacunas e descobertas numa medição só", async () => {
    const res = await get("/coverage?vigencias=9");
    expect(res.status).toBe(200);

    expect(res.body.resumo.geral.percentual).toBeGreaterThan(0);
    expect(res.body.resumo.veredito.frase).toBeTruthy();
    expect(res.body.colunas.length).toBe(9);
    expect(res.body.linhas.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.lacunas)).toBe(true);
    expect(Array.isArray(res.body.descobertas)).toBe(true);
    expect(res.body.incompleto).toEqual([]);
  });

  it("o resumo é a soma das células, e não uma segunda conta", async () => {
    const res = await get("/coverage?vigencias=9");
    const celulas = res.body.linhas.flatMap((l: any) => Object.values(l.celulas));
    const esperadas = celulas.reduce(
      (s: number, c: any) => s + c.conta.combinacoesEsperadas,
      0,
    );
    const encontradas = celulas.reduce(
      (s: number, c: any) => s + c.conta.combinacoesEncontradas,
      0,
    );
    expect(res.body.resumo.geral.combinacoesEsperadas).toBe(esperadas);
    expect(res.body.resumo.geral.combinacoesEncontradas).toBe(encontradas);
  });

  it("toda célula traz estado e conta, e nenhuma passa de 100%", async () => {
    const res = await get("/coverage?vigencias=9");
    const estados = new Set<string>();
    for (const linha of res.body.linhas) {
      for (const celula of Object.values<any>(linha.celulas)) {
        expect(celula.conta.percentual).toBeLessThanOrEqual(100);
        expect(celula.contaCritica.percentual).toBeLessThanOrEqual(100);
        estados.add(celula.estado);
      }
    }
    for (const estado of estados) {
      expect([
        "COMPLETO",
        "PARCIAL",
        "AUSENTE",
        "NOVO",
        "ALTERADO",
        "NAO_APLICAVEL",
      ]).toContain(estado);
    }
  });

  it("o filtro de criticidade restringe as lacunas devolvidas", async () => {
    const todas = await get("/coverage?vigencias=9");
    const criticas = await get("/coverage?vigencias=9&criticidade=CRITICO");
    expect(criticas.body.lacunas.length).toBeLessThanOrEqual(todas.body.lacunas.length);
    expect(criticas.body.lacunas.every((l: any) => l.criticidade === "CRITICO")).toBe(true);
  });

  it("um equipamento inexistente devolve matriz vazia, não a de outro", async () => {
    const res = await get("/coverage?equipamento=NAVIO");
    expect(res.status).toBe(200);
    expect(res.body.linhas).toEqual([]);
  });
});

describe("GET /coverage/cell e /coverage/gap", () => {
  it("a célula abre com a mesma conta que a matriz devolveu", async () => {
    const visao = await get("/coverage?vigencias=9");
    const linha = visao.body.linhas[0];
    const celula: any = Object.values(linha.celulas).at(-1);

    const res = await get(
      `/coverage/cell/${celula.vigencia.snapshotId}/${celula.entityType}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.conta.percentual).toBe(celula.conta.percentual);
    expect(res.body.conta.combinacoesEsperadas).toBe(celula.conta.combinacoesEsperadas);
    expect(Array.isArray(res.body.contribuintes)).toBe(true);
    expect(res.body.contribuintes.length).toBeGreaterThan(0);
  });

  it("um identificador de vigência inválido para em 400", async () => {
    const res = await get("/coverage/cell/nao-e-uuid/CAVALO");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/i);
  });

  it("uma vigência que não existe para em 404, com a frase escrita", async () => {
    const res = await get(
      "/coverage/cell/00000000-0000-0000-0000-000000000000/CAVALO",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("a lacuna lista as entidades e diz quantas ficaram de fora", async () => {
    const visao = await get("/coverage?vigencias=9");
    const linha = visao.body.linhas[0];
    const celula: any = Object.values(linha.celulas).at(-1);
    const detalhe = await get(
      `/coverage/cell/${celula.vigencia.snapshotId}/${celula.entityType}`,
    );

    const alvo = detalhe.body.lacunas[0];
    if (!alvo) return; /* Sem lacuna nesta célula não há o que abrir. */

    const res = await get(
      `/coverage/gap/${celula.vigencia.snapshotId}/${encodeURIComponent(alvo.attributeCode)}?limite=5`,
    );
    expect(res.status).toBe(200);
    expect(res.body.entidades.length).toBeLessThanOrEqual(5);
    expect(typeof res.body.naoListadas).toBe("number");
  });
});

describe("GET /coverage/attributes", () => {
  it("abre a linha da matriz nas mesmas colunas, atributo por atributo", async () => {
    const visao = await get("/coverage?vigencias=9");
    const linha = visao.body.linhas[0];

    const query = new URLSearchParams({
      familia: linha.datasetFamily,
      equipamento: linha.entityType,
      escopo: linha.scopeHash,
      vigencias: "9",
    });
    if (linha.canal) query.set("canal", linha.canal);

    const res = await get(`/coverage/attributes?${query}`);
    expect(res.status).toBe(200);
    expect(res.body.colunas.map((c: any) => c.chave)).toEqual(
      visao.body.colunas.map((c: any) => c.chave),
    );
    expect(res.body.linhas.length).toBeGreaterThan(0);
    expect(res.body.conjunto.rotulo).toBe(linha.rotulo);
    /* Toda linha traz o porquê junto: expectativa sem explicação é palpite. */
    for (const atributo of res.body.linhas) {
      if (atributo.origem) expect(atributo.motivo).toBeTruthy();
    }
  });

  /*
    A propriedade que este degrau existe para não quebrar: a tabela por dentro
    da célula soma exatamente o número que a célula mostrou. Duas contas para a
    mesma pergunta é o defeito que este módulo inteiro veio corrigir.
  */
  it("a soma das linhas de atributo fecha com a conta da célula", async () => {
    const visao = await get("/coverage?vigencias=9");
    const linha = visao.body.linhas[0];
    const celula: any = Object.values(linha.celulas).at(-1);

    const query = new URLSearchParams({
      familia: linha.datasetFamily,
      equipamento: linha.entityType,
      escopo: linha.scopeHash,
      vigencias: "9",
    });
    if (linha.canal) query.set("canal", linha.canal);
    const res = await get(`/coverage/attributes?${query}`);

    const doPeriodo = res.body.linhas
      .map((a: any) => a.celulas[celula.vigencia.effectiveDate])
      .filter((c: any) => c !== undefined && c.esperado);

    expect(
      doPeriodo.reduce((s: number, c: any) => s + c.entidadesEsperadas, 0),
    ).toBe(celula.conta.combinacoesEsperadas);
    expect(
      doPeriodo.reduce((s: number, c: any) => s + c.entidadesPresentes, 0),
    ).toBe(celula.conta.combinacoesEncontradas);
  });

  it("sem dizer de qual conjunto, para em 400 com a frase de quem opera", async () => {
    const res = await get("/coverage/attributes?familia=REMUNERACAO_EQUIPAMENTO");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/escopo/i);
  });

  it("um escopo que não existe devolve tabela vazia, não a de outro conjunto", async () => {
    const res = await get(
      "/coverage/attributes?familia=REMUNERACAO_EQUIPAMENTO&equipamento=CAVALO&escopo=nao-existe",
    );
    expect(res.status).toBe(200);
    expect(res.body.linhas).toEqual([]);
    expect(res.body.resumo.atributos).toBe(0);
  });
});

describe("GET /coverage/history e /coverage/provenance", () => {
  it("o histórico de um atributo tem um ponto por vigência", async () => {
    const res = await get("/coverage/history/cavalo.ipva_licenciamento");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(9);
    expect(res.body.every((p: any) => typeof p.percentual === "number")).toBe(true);
  });

  it("a proveniência de um fato chega ao arquivo e ao SHA-256", async () => {
    const visao = await get("/coverage?vigencias=9");
    const linha = visao.body.linhas.find((l: any) => l.entityType === "CAVALO");
    const celula: any = Object.values(linha.celulas).at(-1);

    /* Uma entidade com o dado presente, para ter fato a rastrear. */
    const gap = await get(
      `/coverage/gap/${celula.vigencia.snapshotId}/${encodeURIComponent("cavalo.ipva_licenciamento")}?limite=1`,
    );
    expect(gap.status).toBe(200);

    /* Um fato qualquer da vigência; a rota é sobre a cadeia, não sobre a escolha. */
    const { rows } = await ctx.db.execute<{ id: string }>(sql`
      SELECT f.id::text AS id FROM fact f
       WHERE f.snapshot_id = ${celula.vigencia.snapshotId}::uuid
         AND NOT f.is_null
       LIMIT 1
    `);
    const factId = rows[0]?.id;
    if (!factId) return;

    const res = await get(`/coverage/provenance/${factId}`);
    expect(res.status).toBe(200);
    expect(res.body.importacao.arquivo).toBeTruthy();
    expect(res.body.importacao.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.celula.aba).toBeTruthy();
  });

  it("um fato inexistente para em 404", async () => {
    const res = await get("/coverage/provenance/999999999");
    expect(res.status).toBe(404);
  });

  it("um identificador de fato inválido para em 400", async () => {
    const res = await get("/coverage/provenance/abc");
    expect(res.status).toBe(400);
  });
});

describe("POST /coverage/decisions", () => {
  it("recusa uma decisão sem justificativa com 422 e a frase de quem opera", async () => {
    const res = await post("/coverage/decisions", {
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      entityType: "CAVALO",
      attributeCode: "cavalo.seguro",
      status: "DISPENSADO",
      efetivoDe: "2026-08-01",
      motivo: "",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/justificativa/i);
  });

  it("recusa uma decisão sem dizer sobre o que ela é", async () => {
    const res = await post("/coverage/decisions", { motivo: "porque sim" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/família|atributo/i);
  });

  it("aceita uma dispensa justificada e a registra com o usuário da sessão", async () => {
    const res = await post("/coverage/decisions", {
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      entityType: "CAVALO",
      attributeCode: "cavalo.km_volta",
      status: "DISPENSADO",
      efetivoDe: "2026-08-01",
      motivo: "Esta unidade não opera retorno carregado desde agosto.",
    });
    expect(res.status).toBe(201);

    const { rows } = await ctx.db.execute<{ actor: string; reason: string }>(sql`
      SELECT actor, reason FROM curation_event
       WHERE target_kind = 'COVERAGE_EXPECTATION' AND target_label = 'cavalo.km_volta'
    `);
    expect(rows[0]?.actor).toBe("curador@teste");
    expect(rows[0]?.reason).toMatch(/retorno carregado/);
  });
});

describe("GET /coverage/contract", () => {
  it("serve o contrato com a evidência de cada linha", async () => {
    const res = await get("/coverage/contract");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((c: any) => c.motivo && c.motivo.trim().length > 0)).toBe(true);
    expect(res.body.some((c: any) => c.criticidade === "CRITICO")).toBe(true);
  });
});

/*
  Por último, porque apaga o agregado: o contrato de superfície do reparo, que é
  a saída de um estado em que a tela ficava presa. Ver `lib/coverage/src/
  agregado.ts` para como uma vigência inteira perde a medição sem perder dado.
*/
describe("o agregado de cobertura, perdido e refeito pela rota", () => {
  it("`/coverage` não anuncia banco vazio quando o que falta é a medição", async () => {
    await ctx.db.execute(sql`DELETE FROM snapshot_entity_type`);

    const res = await get("/coverage?vigencias=9");
    expect(res.status).toBe(200);
    expect(res.body.linhas).toEqual([]);
    expect(res.body.incompleto.length).toBeGreaterThan(0);
    /* A frase que a tela imprime não pode mandar importar o que já está lá. */
    expect(res.body.resumo.veredito.frase).not.toMatch(/[Nn]enhuma vigência importada/);
  });

  it("lista as vigências sem agregado antes de tocar em qualquer coisa", async () => {
    const res = await get("/coverage/aggregate/missing");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((v: any) => v.fatos > 0 && v.sourceLabel)).toBe(true);
  });

  it("o POST refaz a medição e a matriz volta", async () => {
    const reparo = await post("/coverage/aggregate/rebuild", {});
    expect(reparo.status).toBe(200);
    expect(reparo.body.vigencias).toBeGreaterThan(0);
    expect(reparo.body.rotulos.length).toBeGreaterThan(0);

    const res = await get("/coverage?vigencias=9");
    expect(res.body.linhas.length).toBeGreaterThan(0);
    expect(res.body.incompleto).toEqual([]);
    expect(res.body.resumo.geral.percentual).toBeGreaterThan(0);
  });

  it("chamado de novo, não tem o que fazer", async () => {
    const reparo = await post("/coverage/aggregate/rebuild", {});
    expect(reparo.status).toBe(200);
    expect(reparo.body).toEqual({ vigencias: 0, linhas: 0, rotulos: [] });
    expect((await get("/coverage/aggregate/missing")).body).toEqual([]);
  });
});
