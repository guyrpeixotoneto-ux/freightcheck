import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  appUserTable,
  encerrarPoolDoProcesso,
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { processarEnvioDeChamados } from "@workspace/comparison";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * A superfície do Monitoramento de Chamados.
 *
 * O cálculo é de `@workspace/comparison` e está coberto lá, contra dado real.
 * O que estes testes protegem é o **contrato da rota**, que é onde uma tela
 * ganha número errado sem nenhum erro aparecer:
 *
 * - o recorte por série não vaza, e uma série que não existe devolve **vazio**,
 *   nunca o produto inteiro;
 * - a aba vem de lista fechada: texto de fora não vira predicado;
 * - o autor da revisão é a **sessão**, e não um campo do corpo;
 * - revisar uma versão que já não é a atual é recusado com 409, e não gravado
 *   por cima de algo que ninguém viu.
 *
 * O router sobe num socket de verdade e é consultado por `fetch`, como em
 * `dre.test.ts` e pela mesma razão: o workspace não tem supertest.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

/** A sessão que o `app.ts` injeta antes das rotas. Aqui ela é fixa. */
const SESSAO = { id: "11111111-1111-1111-1111-111111111111", email: "gestor@empresa.com" };

async function get(caminho: string) {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: (await res.json()) as any };
}

async function post(caminho: string, corpo: unknown) {
  const res = await fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** Um envio com um chamado por unidade, no formato real (uma linha por campo). */
async function enviar(
  chamados: { externalId: string; unidade: string; prazo: string }[],
  recebidoEm: string,
  filename: string,
) {
  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename,
      contentSha256: `sha-${filename}-${recebidoEm}`,
      byteSize: 1,
      status: "READ",
      receivedAt: new Date(recebidoEm),
    })
    .returning();

  let linha = 0;
  for (const c of chamados) {
    linha++;
    const [t] = await ctx.db
      .insert(ticketTable)
      .values({
        ticketImportId: envio!.id,
        externalId: c.externalId,
        statusRaw: "Em análise",
        statusBucket: "EM_ANDAMENTO",
        unidadeRaw: c.unidade,
        segmentoRaw: "Operações",
        aprovadorRaw: "João Silva",
        prazoPrevisto: c.prazo,
        subject: "Entrega do relatório mensal",
        sourceRowIndex: linha,
      })
      .returning();
    await ctx.db.insert(ticketChangeTable).values({
      ticketId: t!.id,
      ticketImportId: envio!.id,
      parameterLabel: "Frete peso",
      valueAfterRaw: "100",
      beforeSource: "ARQUIVO",
      sourceColumnIndex: 0,
    });
  }
  await processarEnvioDeChamados(ctx.db, envio!.id);
  return envio!.id;
}

const DIA = "2026-09-02";
const ONTEM = "2026-09-01";
const as = (dia: string, hora: number) =>
  `${dia}T${String(hora + 3).padStart(2, "0")}:00:00.000Z`;

beforeAll(async () => {
  ctx = await createTestDatabase("api_monitoramento_chamados");
  process.env.DATABASE_URL = ctx.url;

  /*
    A conta existe de verdade, porque a revisão referencia `app_user`.

    Não é cerimônia de teste: a chave estrangeira é o que impede uma revisão de
    apontar para uma conta que nunca existiu, e um teste com id inventado
    passaria a medir um caminho que produção não tem. Foi o que aconteceu na
    primeira versão deste arquivo — as escritas voltavam 500.
  */
  await ctx.db.insert(appUserTable).values({
    id: SESSAO.id,
    email: SESSAO.email,
    name: "Gestor",
    passwordHash: "x",
  });

  for (const unidade of ["Recife", "Camaçari"]) {
    await enviar(
      [{ externalId: `${unidade}-1`, unidade, prazo: "2026-09-10" }],
      as(ONTEM, 8),
      `Chamados_${unidade}.xlsx`,
    );
    await enviar(
      [{ externalId: `${unidade}-1`, unidade, prazo: "2026-09-20" }],
      as(DIA, 8),
      `Chamados_${unidade}.xlsx`,
    );
  }

  const { default: router } = await import("../monitoramento-de-chamados");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { error: () => {}, warn: () => {}, info: () => {} };
    (req as unknown as { user: unknown }).user = SESSAO;
    next();
  });
  app.use(router);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 300_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

const BASE = "/monitoramento-de-chamados";

describe("o recorte por série", () => {
  it("sem série, responde por todas — o padrão de uma instalação de uma unidade", async () => {
    const { status, body } = await get(`${BASE}/dia/${DIA}`);
    expect(status).toBe(200);
    expect(body.movimentacoes).toBe(2);
  });

  it("com série, responde só por ela", async () => {
    const { body } = await get(`${BASE}/dia/${DIA}?serie=Recife`);
    expect(body.movimentacoes).toBe(1);
    expect(body.porUnidade).toEqual([{ unidade: "Recife", total: 1 }]);
  });

  it("uma série que não existe devolve vazio — nunca o produto inteiro", async () => {
    // É a diferença entre um filtro que não achou e um filtro que sumiu. A
    // segunda é como uma tela passa a mostrar o acervo de outra unidade.
    const { body } = await get(`${BASE}/dia/${DIA}?serie=Belém`);
    expect(body.movimentacoes).toBe(0);
    const lista = await get(`${BASE}/dia/${DIA}/movimentacoes?serie=Belém`);
    expect(lista.body.total).toBe(0);
    expect(lista.body.rows).toEqual([]);
  });

  it("a lista honra a série tanto no total quanto nas linhas", async () => {
    const { body } = await get(`${BASE}/dia/${DIA}/movimentacoes?serie=Camaçari`);
    expect(body.total).toBe(1);
    expect(body.rows.map((r: any) => r.externalId)).toEqual(["Camaçari-1"]);
  });
});

describe("a aba vem de lista fechada", () => {
  it("uma aba inventada cai em TODOS, e não vira predicado", async () => {
    const { body } = await get(`${BASE}/dia/${DIA}/movimentacoes?aba=' OR 1=1--`);
    expect(body.aba).toBe("TODOS");
    expect(body.total).toBe(2);
  });

  it("as abas conhecidas recortam de verdade", async () => {
    expect((await get(`${BASE}/dia/${DIA}/movimentacoes?aba=ALTERADOS`)).body.total).toBe(2);
    expect((await get(`${BASE}/dia/${DIA}/movimentacoes?aba=NOVOS`)).body.total).toBe(0);
  });
});

describe("a régua", () => {
  it("volta com a janela pedida e o dia de hoje da operação", async () => {
    const { body } = await get(`${BASE}/dias?ate=${DIA}`);
    expect(body.ate).toBe(DIA);
    expect(body.dias).toHaveLength(9);
    const doDia = body.dias.find((d: any) => d.dia === DIA);
    expect(doDia.estado).toBe("PENDENTE");
    expect(doDia.pendentes).toBe(2);
  });

  it("recusa uma janela invertida em vez de devolver lista vazia", async () => {
    const { status, body } = await get(`${BASE}/dias?de=2026-09-10&ate=2026-09-01`);
    expect(status).toBe(400);
    expect(body.error).toContain("posterior");
  });

  it("recusa data fora do formato", async () => {
    expect((await get(`${BASE}/dia/02-09-2026`)).status).toBe(400);
  });
});

describe("a revisão", () => {
  it("grava o autor da sessão, e não um do corpo", async () => {
    const lista = await get(`${BASE}/dia/${DIA}/movimentacoes?serie=Recife`);
    const m = lista.body.rows[0];

    const { status } = await post(`${BASE}/movimentacoes/${m.id}/revisao`, {
      revisao: m.revisao,
      // Um corpo que tentasse dizer quem revisou. Ele é ignorado: o autor é a
      // sessão, e uma revisão que o cliente pudesse assinar não sustenta a
      // frase "foi fulano quem revisou".
      revisadoPor: "outra.pessoa@empresa.com",
    });
    expect(status).toBe(200);

    const depois = await get(`${BASE}/dia/${DIA}/movimentacoes?serie=Recife`);
    expect(depois.body.rows[0].revisada).toBe(true);
    expect(depois.body.rows[0].revisadaPor).toBe(SESSAO.email);
  });

  it("recusa com 409 a revisão de uma versão que já não é a atual", async () => {
    const lista = await get(`${BASE}/dia/${DIA}/movimentacoes?serie=Camaçari`);
    const m = lista.body.rows[0];

    const { status, body } = await post(`${BASE}/movimentacoes/${m.id}/revisao`, {
      revisao: m.revisao + 1,
    });
    expect(status).toBe(409);
    expect(body.error).toContain("mudou desde que a tela carregou");
  });

  it("404 para movimentação que não existe, 400 para id que não é uuid", async () => {
    expect(
      (await post(`${BASE}/movimentacoes/00000000-0000-0000-0000-000000000000/revisao`, {}))
        .status,
    ).toBe(404);
    expect((await post(`${BASE}/movimentacoes/nao-e-uuid/revisao`, {})).status).toBe(400);
  });

  it("o lote recusa id inválido antes de gravar qualquer coisa", async () => {
    const { status, body } = await post(`${BASE}/revisoes`, { ids: ["nao-e-uuid"] });
    expect(status).toBe(400);
    expect(body.error).toContain("inválido");
  });

  it("o lote tem teto, e a recusa diz qual é", async () => {
    const ids = Array.from({ length: 101 }, () => "00000000-0000-0000-0000-000000000000");
    const { status, body } = await post(`${BASE}/revisoes`, { ids });
    expect(status).toBe(400);
    expect(body.error).toContain("100");
  });

  it("o lote separa o que revisou do que recusou", async () => {
    const lista = await get(`${BASE}/dia/${DIA}/movimentacoes?serie=Camaçari`);
    const { status, body } = await post(`${BASE}/revisoes`, {
      ids: [lista.body.rows[0].id, "00000000-0000-0000-0000-000000000000"],
    });
    expect(status).toBe(200);
    expect(body.revisadas).toHaveLength(1);
    expect(body.recusadas).toHaveLength(1);
  });
});

describe("o detalhe", () => {
  it("traz o encadeamento do dia e os parâmetros do chamado", async () => {
    const lista = await get(`${BASE}/dia/${DIA}/movimentacoes?serie=Recife`);
    const { status, body } = await get(`${BASE}/movimentacoes/${lista.body.rows[0].id}`);

    expect(status).toBe(200);
    expect(body.passos).toHaveLength(1);
    expect(body.parametros.map((p: any) => p.parameterLabel)).toEqual(["Frete peso"]);
  });

  it("404 para movimentação inexistente", async () => {
    expect(
      (await get(`${BASE}/movimentacoes/00000000-0000-0000-0000-000000000000`)).status,
    ).toBe(404);
  });
});

describe("as séries disponíveis", () => {
  it("alimentam o seletor da tela", async () => {
    const { body } = await get(`${BASE}/series`);
    expect(body.series.map((s: any) => s.serie).sort()).toEqual(["Camaçari", "Recife"]);
    expect(body.semSerie).toBe("@sem-serie");
  });
});

describe("um banco sem a 0087", () => {
  it("responde 503 com o nome da migration, e não 500", async () => {
    // O estado real de um ambiente atrasado: a tela abre e cada consulta morre
    // num `42P01` que parece defeito do pedido.
    await ctx.db.execute(sql`ALTER TABLE ticket_movement_day RENAME TO ticket_movement_day_off`);
    try {
      const { status, body } = await get(`${BASE}/dia/${DIA}`);
      expect(status).toBe(503);
      expect(JSON.stringify(body)).toContain("0087_monitoramento_de_chamados");
    } finally {
      await ctx.db.execute(sql`ALTER TABLE ticket_movement_day_off RENAME TO ticket_movement_day`);
    }
  });
});
