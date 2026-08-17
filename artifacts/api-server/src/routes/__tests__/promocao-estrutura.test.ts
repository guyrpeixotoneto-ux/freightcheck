import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import express from "express";
import { sql } from "drizzle-orm";
import {
  attributeTable,
  CONFIRMED_SEMANTICS,
  contarNosCanonicos,
  encerrarPoolDoProcesso,
  taxonomyNodeTable,
} from "@workspace/db";
import {
  createTestDatabase,
  modelExportPaths,
  realExportPath,
  type TestDb,
} from "@workspace/ingest/testing";

/**
 * **A estrutura obrigatória, garantida pela rota que a tela chama.**
 *
 * Este arquivo prova o que nenhum teste provava: que arrastar uma planilha para
 * a tela de Importações e clicar em promover deixa a base **utilizável**, sem
 * `dev:seed`, sem CLI e sem curadoria externa.
 *
 * Ele sobe o router **inteiro**, na mesma ordem de montagem do produto
 * (`routes/index.ts`), e conversa por HTTP: `POST /imports` com o arquivo em
 * base64, espera o run chegar a PREVIEWED, e `POST /imports/:id/promote`. Não
 * é cerimônia — é o objeto do teste. O defeito que ele fecha era exatamente de
 * roteamento: existiam **dois** `POST /imports/:id/promote`, e o único que
 * semeava a taxonomia era o segundo, que o Express nunca alcançava. Um teste
 * que chamasse `promote()` direto da biblioteca teria passado o tempo todo.
 *
 * Medido em 17/08/2026, antes da correção, por este mesmo caminho: **zero nós**
 * de taxonomia depois da promoção, 138 de 138 atributos sem nó, e `cost_class`
 * nulo em 267 de 267 linhas de comparação.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

/** Os 22 nós, contados da própria árvore — nunca um número escrito à mão. */
const NOS_CANONICOS = contarNosCanonicos();

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-01";

interface Resposta {
  status: number;
  body: any;
}

async function post(caminho: string, corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** O envio como a tela o faz: o arquivo em base64 dentro de um JSON. */
async function enviar(filePath: string): Promise<string> {
  const enviado = await post("/imports", {
    filename: path.basename(filePath),
    contentBase64: readFileSync(filePath).toString("base64"),
  });
  expect(enviado.status, JSON.stringify(enviado.body)).toBe(202);
  const importRunId = enviado.body.importRunId as string;

  // A leitura roda destacada, como em produção; a tela faz este mesmo poll.
  for (let tentativa = 0; tentativa < 600; tentativa++) {
    const estado = await get(`/imports/${importRunId}/status`);
    const status = estado.body.status as string;
    if (status === "PREVIEWED") return importRunId;
    if (status === "VALIDATION_ERROR" || status === "READ_ERROR") {
      throw new Error(`Leitura falhou: ${estado.body.failureReason}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("O run não chegou a PREVIEWED.");
}

async function promover(importRunId: string): Promise<Resposta> {
  const previa = await get(`/imports/${importRunId}`);
  return post(`/imports/${importRunId}/promote`, {
    confirmNewEntityTypes: previa.body.pendingIdentities ?? [],
    onExistingSnapshot: "FAIL",
  });
}

let primeira: Resposta;

beforeAll(async () => {
  ctx = await createTestDatabase("api_promocao_estrutura");
  process.env.DATABASE_URL = ctx.url;
  process.env.IMPORT_STORAGE_DIR = mkdtempSync(
    path.join(tmpdir(), "promocao-estrutura-"),
  );

  const { default: router } = await import("../index");
  const app = express();
  app.use(express.json({ limit: "64mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(router);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  primeira = await promover(await enviar(realExportPath()));
  expect(primeira.status, JSON.stringify(primeira.body)).toBe(200);
}, 600_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

describe("a promoção garante a estrutura obrigatória — banco vazio, sem seed", () => {
  /**
   * Quem respondeu.
   *
   * A rota morta de `overview.ts` devolvia `proposal`, `confirmations` e
   * `versions`. A viva devolve `taxonomia` e `semanticasConfirmadas`. Conferir
   * a forma da resposta é a maneira de este teste continuar sabendo qual das
   * duas está no ar caso alguém registre uma segunda de novo.
   */
  it("responde pela rota viva, e ela faz o trabalho", () => {
    expect(primeira.body).toHaveProperty("taxonomia");
    expect(primeira.body).toHaveProperty("semanticasConfirmadas");
    expect(primeira.body).not.toHaveProperty("proposal");
    expect(primeira.body).not.toHaveProperty("versions");
  });

  it("1. semeia os 22 nós da taxonomia", async () => {
    expect(primeira.body.taxonomia).toEqual({
      nosCriados: NOS_CANONICOS,
      nosExistentes: 0,
    });

    const nos = await ctx.db.select().from(taxonomyNodeTable);
    expect(nos).toHaveLength(NOS_CANONICOS);
    expect(NOS_CANONICOS).toBe(22);
    // A árvore que a tela oferece no seletor "Nó da taxonomia" existe.
    const arvore = await get("/curation/taxonomy?flat=true");
    expect(arvore.body).toHaveLength(NOS_CANONICOS);
  });

  it("2. vincula os 17 atributos canônicos aos nós", async () => {
    const { rows } = await ctx.db.execute<{ code: string; node: string }>(sql`
      SELECT a.code, n.code AS node
        FROM attribute a
        JOIN taxonomy_node n ON n.id = a.taxonomy_node_id
       ORDER BY a.code
    `);
    expect(rows).toHaveLength(CONFIRMED_SEMANTICS.length);
    expect(rows.map((r) => r.code).sort()).toEqual(
      CONFIRMED_SEMANTICS.map((e) => e.code).sort(),
    );
    // Cada um no nó que o registro declara, e não num nó qualquer.
    const esperado = new Map(
      CONFIRMED_SEMANTICS.map((e) => [e.code, e.taxonomyCode]),
    );
    for (const row of rows) expect(row.node, row.code).toBe(esperado.get(row.code));

    // E a versão em vigor carrega o mesmo nó — é ela que a comparação lê.
    const [{ semNo }] = (
      await ctx.db.execute<{ semNo: number }>(sql`
        SELECT count(*)::int AS "semNo"
          FROM attribute_semantics v
          JOIN attribute a ON a.id = v.attribute_id
         WHERE v.effective_until IS NULL
           AND a.semantics_status = 'CONFIRMED'
           AND v.taxonomy_node_id IS NULL
      `)
    ).rows;
    expect(semNo).toBe(0);
  });

  it("3. resolve a classe de custo nesses atributos", async () => {
    const { loadAttributeClassificationsAt } = await import("@workspace/comparison");
    const classificacoes = [
      ...(await loadAttributeClassificationsAt(ctx.db, AGOSTO)).values(),
    ];
    const confirmados = classificacoes.filter(
      (c) => c.semanticsStatus === "CONFIRMED",
    );
    expect(confirmados).toHaveLength(CONFIRMED_SEMANTICS.length);
    for (const c of confirmados) {
      expect(c.costClass, c.attributeCode).not.toBeNull();
      expect(c.taxonomyName, c.attributeCode).not.toBeNull();
    }
    /*
      A herança é o que se está provando aqui, e não um `UPDATE`: nenhum nó de
      grupo declara classe — quem declara são `custo_fixo` e `custo_variavel`, e
      o atributo a recebe do ancestral mais próximo. `finameCavalo` está em
      `cf_financiamento`, que não tem classe própria.
    */
    const finame = confirmados.find((c) => c.attributeCode === "cavalo.finame_cavalo")!;
    expect(finame.costClass).toBe("FIXO");
    expect(finame.taxonomyName).toBe("Financiamento e juros");
  });

  it("4. carimba a classe de custo nas comparações novas", async () => {
    const { computeChangeSet } = await import("@workspace/comparison");
    const { rows: snaps } = await ctx.db.execute<{ id: string }>(sql`
      SELECT id::text FROM snapshot
       WHERE status <> 'SUPERSEDED' AND effective_date IN (${JULHO}::date, ${AGOSTO}::date)
       ORDER BY effective_date
    `);
    expect(snaps).toHaveLength(2);

    const set = await computeChangeSet(ctx.db, snaps[0].id, snaps[1].id, {
      computedBy: "test:estrutura",
    });
    const [linhas] = (
      await ctx.db.execute<{ total: number; comClasse: number; comGrupo: number }>(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE cost_class IS NOT NULL)::int AS "comClasse",
               count(*) FILTER (WHERE taxonomy_name IS NOT NULL)::int AS "comGrupo"
          FROM "change" WHERE change_set_id = ${set.id}::uuid
      `)
    ).rows;

    /*
      267 alterações entre julho e agosto/2026, das quais 19 são de colunas do
      registro canônico. Antes desta correção o segundo número era zero — e
      ficava zero para sempre, porque `cost_class` e `taxonomy_name` são
      **gravados** na linha no momento em que a comparação é calculada.
    */
    expect(linhas.total).toBe(267);
    expect(linhas.comClasse).toBe(19);
    expect(linhas.comGrupo).toBe(19);
  });
});

describe("5. a segunda importação não duplica nada", () => {
  let segunda: Resposta;
  let antes: { nos: number; versoes: number; confirmados: number; eventos: number };

  const contar = async () => {
    const [linha] = (
      await ctx.db.execute<{
        nos: number;
        versoes: number;
        confirmados: number;
        eventos: number;
      }>(sql`
        SELECT (SELECT count(*) FROM taxonomy_node)::int AS nos,
               (SELECT count(*) FROM attribute_semantics)::int AS versoes,
               (SELECT count(*) FROM attribute WHERE semantics_status = 'CONFIRMED')::int
                 AS confirmados,
               (SELECT count(*) FROM curation_event)::int AS eventos
      `)
    ).rows;
    return linha;
  };

  beforeAll(async () => {
    antes = await contar();
    /*
      Outro arquivo, mesmo conteúdo: `Modelo_Cavalo` é a metade do export
      combinado, entregue em arquivo próprio. Bytes diferentes — então o
      recebimento não o recusa por duplicidade de arquivo — e dados que a base
      já tem, que é o caso real de reenvio.
    */
    segunda = await promover(await enviar(modelExportPaths().cavalo));
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(200);
  }, 600_000);

  it("não cria nó, versão nem confirmação de novo", async () => {
    expect(segunda.body.taxonomia).toEqual({
      nosCriados: 0,
      nosExistentes: NOS_CANONICOS,
    });
    expect(segunda.body.semanticasConfirmadas.aplicadas).toBe(0);
    expect(segunda.body.semanticasConfirmadas.jaConfirmadas).toBe(
      CONFIRMED_SEMANTICS.length,
    );
    expect(segunda.body.semanticasConfirmadas.divergentes).toEqual([]);
    expect(segunda.body.semanticasConfirmadas.incoerentes).toEqual([]);

    const depois = await contar();
    expect(depois.nos).toBe(antes.nos);
    expect(depois.confirmados).toBe(antes.confirmados);
    /*
      Versões e eventos são as duas medidas que uma reaplicação silenciosa
      inflaria: uma versão nova por atributo, ou um `curation_event` por campo
      "alterado" de um valor para ele mesmo. Nenhum dos dois se move.
    */
    expect(depois.versoes).toBe(antes.versoes);
    expect(depois.eventos).toBe(antes.eventos);
  });

  it("mantém a assinatura humana de quem decidiu", async () => {
    const confirmados = await ctx.db
      .select()
      .from(attributeTable)
      .where(sql`${attributeTable.semanticsStatus} = 'CONFIRMED'`);
    for (const attribute of confirmados) {
      expect(attribute.confirmedBy, attribute.code).toMatch(/@/);
      expect(attribute.confirmedBy, attribute.code).not.toMatch(/^import:/);
    }
  });
});
