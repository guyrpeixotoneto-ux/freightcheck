import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import * as XLSX from "xlsx";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * As rotas da aba Impacto, sobre o export real.
 *
 * Mesma montagem de `dre.test.ts`, e pela mesma razão: o router sobe num socket
 * de verdade e usa o `db` do processo, que é como ele roda em produção.
 *
 * O que se protege aqui é o contrato da superfície, não o cálculo — esse está
 * coberto em `@workspace/comparison`. Em especial: que `/impacto/panorama`
 * responda **sem** receber equipamento, porque "o que mudou?" não é uma
 * pergunta por equipamento, e a árvore econômica atravessa os dois.
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

beforeAll(async () => {
  ctx = await createTestDatabase("api_impacto");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const { default: impactoRouter } = await import("../impacto");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(impactoRouter);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
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

describe("GET /impacto/panorama", () => {
  it("responde sem que ninguém escolha equipamento nem parâmetro", async () => {
    const res = await get("/impacto/panorama");
    expect(res.status).toBe(200);
    expect(res.body.periods).toHaveLength(9);
    expect(res.body.parametros.length).toBeGreaterThan(25);
  });

  it("traz os dois rankings, e eles não começam pelo mesmo parâmetro", async () => {
    const { body } = await get("/impacto/panorama");
    expect(body.maisAlterados.length).toBeGreaterThan(0);
    expect(body.maiorImpacto.length).toBeGreaterThan(0);
    expect(body.maisAlterados[0]).not.toBe(body.maiorImpacto[0]);
  });

  it("atravessa os dois equipamentos numa resposta só", async () => {
    const { body } = await get("/impacto/panorama");
    const tipos = new Set(
      body.parametros.map((p: { entityType: string }) => p.entityType),
    );
    expect([...tipos].sort()).toEqual(["CARRETA", "CAVALO"]);
  });

  it("separa o ranking financeiro por periodicidade", async () => {
    const { body } = await get("/impacto/panorama");
    const periodicidades = body.impactoPorPeriodicidade.map(
      (g: { periodicity: string }) => g.periodicity,
    );
    expect(periodicidades).toContain("MENSAL");
    expect(periodicidades).toContain("ANUAL");
  });

  it("mantém as colunas de conjunto fora dos rankings e na resposta", async () => {
    const { body } = await get("/impacto/panorama");
    expect(body.visaoDeConjunto).toContain("carreta.custo_fixo");
    expect(body.maiorImpacto).not.toContain("carreta.custo_fixo");

    const conjunto = body.parametros.find(
      (p: { code: string }) => p.code === "carreta.custo_fixo",
    );
    expect(conjunto.papel).toBe("CONJUNTO");
    expect(conjunto.evidencia).toContain("conjunto");
  });

  it("respeita o contexto pedido na query", async () => {
    const res = await get("/impacto/panorama?canal=EMPURRADA");
    expect(res.status).toBe(200);
    expect(res.body.periods).toHaveLength(9);
  });

  it("um escopo que não existe para em 404, e não numa lista vazia", async () => {
    const res = await get("/impacto/panorama?scopeHash=naoexiste");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /impacto/quinzenas", () => {
  it("continua servindo o segundo nível, por parâmetro", async () => {
    const res = await get(
      "/impacto/quinzenas?entityType=CAVALO&attributeCode=cavalo.finame_cavalo",
    );
    expect(res.status).toBe(200);
    expect(res.body.attribute.code).toBe("cavalo.finame_cavalo");
    expect(res.body.periods).toHaveLength(9);
  });

  it("aceita qualquer parâmetro que o panorama ofereça, somável ou não", async () => {
    const { body: panorama } = await get("/impacto/panorama");
    const semRegua = panorama.parametros.find(
      (p: { impactoCalculavel: boolean }) => !p.impactoCalculavel,
    );

    const res = await get(
      `/impacto/quinzenas?entityType=${semRegua.entityType}&attributeCode=${semRegua.code}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.attribute.code).toBe(semRegua.code);
    expect(res.body.attribute.somavel).toBe(false);
  });
});

/**
 * A exportação, sobre o mesmo export real.
 *
 * O que se protege aqui é a única coisa que o arquivo promete e ninguém confere
 * depois de baixá-lo: que ele diga o mesmo que a tela. Um `.xlsx` é lido semanas
 * depois, longe do produto — se uma célula divergir da matriz, quem perceber vai
 * concluir que o produto errou, e não terá como saber qual dos dois números é o
 * certo.
 *
 * Por isso os dois casos centrais comparam o arquivo com as outras duas rotas:
 * as abas contra o panorama, e uma célula contra a matriz daquele parâmetro.
 */
describe("GET /impacto/exportacao.xlsx", () => {
  /**
   * A aba de um parâmetro, achada pelo índice — como quem abre o arquivo faz.
   *
   * O nome da aba é cortado em 31 caracteres, então adivinhá-lo aqui seria
   * reimplementar `nomeDeAba` no teste. Passar pelo índice confere de graça a
   * razão de ele existir: ligar o nome curto ao nome inteiro do parâmetro.
   */
  function abaDoParametro(wb: XLSX.WorkBook, title: string) {
    const indice = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Índice"], {
      header: 1,
    });
    const linha = indice.find((l) => l[1] === title);
    expect(linha, `${title} não está no índice`).toBeDefined();
    const aba = wb.Sheets[linha![0]];
    expect(aba, `a aba ${linha![0]} não existe`).toBeDefined();
    return XLSX.utils.sheet_to_json<(string | number)[]>(aba, { header: 1 });
  }

  async function baixar(caminho: string) {
    const res = await fetch(`${base}${caminho}`);
    if (!res.ok) {
      return { status: res.status, body: await res.json(), wb: null, nome: null };
    }
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    return {
      status: res.status,
      body: null,
      wb,
      nome: res.headers.get("Content-Disposition"),
    };
  }

  it("responde um arquivo que abre, com uma aba por parâmetro alterado", async () => {
    const { body: panorama } = await get("/impacto/panorama");
    const { status, wb, nome } = await baixar("/impacto/exportacao.xlsx");

    expect(status).toBe(200);
    expect(wb!.SheetNames[0]).toBe("Índice");
    // Uma aba por parâmetro que mudou, mais o índice. A contagem sai do próprio
    // panorama: um número fixo aqui envelheceria junto com a curadoria.
    expect(wb!.SheetNames).toHaveLength(panorama.totais.parametrosAlterados + 1);
    expect(nome).toContain("filename");
    expect(nome).toContain(".xlsx");
  });

  it("põe uma coluna por vigência, com o rótulo do arquivo no cabeçalho", async () => {
    const { wb } = await baixar("/impacto/exportacao.xlsx");
    const { body: matriz } = await get(
      "/impacto/quinzenas?entityType=CAVALO&attributeCode=cavalo.finame_cavalo",
    );

    const linhas = abaDoParametro(wb!, matriz.attribute.title);
    const cabecalho = linhas.find((l) => l[1] === "placa")!;

    expect(cabecalho.slice(2, -2)).toEqual(
      matriz.periods.map((p: { sourceLabel: string }) => p.sourceLabel),
    );
  });

  it("diz o mesmo que a matriz, célula por célula", async () => {
    const { wb } = await baixar("/impacto/exportacao.xlsx");
    const { body: matriz } = await get(
      "/impacto/quinzenas?entityType=CAVALO&attributeCode=cavalo.finame_cavalo",
    );

    const linhas = abaDoParametro(wb!, matriz.attribute.title);

    /*
      Um ativo com valor em todas as vigências entregues — é dele que se pode
      exigir igualdade célula a célula. Comparar um ativo com ausências mediria
      a tradução das ausências, que os casos puros de `planilha-impacto` já
      cobrem.
      */
    const cheia = matriz.groups
      .flatMap((g: { rows: unknown[] }) => g.rows)
      .find((r: { cells: { state: string }[] }) =>
        r.cells.every((c) => c.state === "VALOR"),
      ) as { plate: string; cells: { value: number }[]; total: number };
    expect(cheia).toBeDefined();

    const linha = linhas.find((l) => l[1] === cheia.plate)!;
    expect(linha.slice(2, 2 + matriz.periods.length)).toEqual(
      cheia.cells.map((c) => c.value),
    );
    expect(linha[2 + matriz.periods.length]).toBe(cheia.total);
  });

  it("recorta as abas pela classe de custo, como o seletor da tela", async () => {
    const { body: panorama } = await get("/impacto/panorama");
    const fixo = panorama.recortes.find((r: { classe: string }) => r.classe === "FIXO");

    const { wb } = await baixar("/impacto/exportacao.xlsx?classe=FIXO");
    expect(wb!.SheetNames).toHaveLength(fixo.totais.parametrosAlterados + 1);
    expect(wb!.SheetNames.length).toBeLessThan(panorama.totais.parametrosAlterados + 1);
  });

  it("respeita o recorte De/Até: menos vigências, menos colunas", async () => {
    const { body: panorama } = await get("/impacto/panorama");
    const de = panorama.periods[panorama.periods.length - 2].effectiveDate;
    const ate = panorama.periods[panorama.periods.length - 1].effectiveDate;

    const { wb } = await baixar(`/impacto/exportacao.xlsx?de=${de}&ate=${ate}`);
    const aba = wb!.Sheets[wb!.SheetNames[1]];
    const linhas = XLSX.utils.sheet_to_json<string[]>(aba, { header: 1 });
    const cabecalho = linhas.find((l) => l[1] === "placa")!;

    // Duas vigências, mais as duas colunas de identificação e as duas de total.
    expect(cabecalho).toHaveLength(6);
  });

  it("um escopo que não existe para em 404 com JSON, e não num arquivo vazio", async () => {
    const { status, body } = await baixar("/impacto/exportacao.xlsx?scopeHash=naoexiste");
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });
});
