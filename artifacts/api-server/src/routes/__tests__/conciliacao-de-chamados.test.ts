import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  encerrarPoolDoProcesso,
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { computeChangeSet } from "@workspace/comparison";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * A superfície da Conciliação de Chamados.
 *
 * O cruzamento é de `@workspace/comparison` e está coberto lá, par a par. O que
 * estes testes protegem é o **contrato da rota**, que é onde uma tela ganha
 * número errado sem nenhum erro aparecer:
 *
 * - os dois lados são **escolhidos e devolvidos**: quem lê a resposta sabe
 *   sobre qual comparação e qual envio ela fala, mesmo sem ter pedido nenhum
 *   dos dois. Um resumo que não dissesse isso seria um número sem endereço, e a
 *   lista poderia estar falando de outro par sem nada denunciar;
 * - a situação vem de lista fechada: texto de fora não vira predicado;
 * - a paginação não perde o total.
 *
 * O router sobe num socket de verdade e é consultado por `fetch`, como em
 * `monitoramento-de-chamados.test.ts` e pela mesma razão: o workspace não tem
 * supertest.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let changeSetId: string;
let envioAntigoId: string;
let envioNovoId: string;
/** Um envio de outra unidade, e o mais recente de todos — a armadilha da série. */
let envioDeOutraUnidadeId: string;

const SESSAO = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "gestor@empresa.com",
};

const BASE = "/conciliacao-de-chamados";

const ATRIBUTOS: AttributeSpec[] = [
  { code: "cavalo.frete_peso", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: "cavalo.pedagio", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

async function get(caminho: string) {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: (await res.json()) as any };
}

/** Um envio com um chamado que pede o frete peso da placa A. */
async function enviar(
  sha: string,
  recebidoEm: string,
  serie: string | null = "CAMAÇARI",
): Promise<string> {
  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename: `Chamados_${sha}.xlsx`,
      contentSha256: sha,
      byteSize: 1,
      status: "READ",
      receivedAt: new Date(recebidoEm),
      serie,
      serieOrigem: serie === null ? "INDETERMINADA" : "ARQUIVO",
      ticketCount: 1,
      rowCount: 1,
    })
    .returning();

  const [chamado] = await ctx.db
    .insert(ticketTable)
    .values({
      ticketImportId: envio!.id,
      externalId: `${sha}-CH-1`,
      statusBucket: "ATENDIDO",
      entityLabel: "AAA1A11",
      entityType: "CAVALO",
      sourceRowIndex: 1,
      changedParameterCount: 1,
    })
    .returning();

  await ctx.db.insert(ticketChangeTable).values({
    ticketId: chamado!.id,
    ticketImportId: envio!.id,
    parameterLabel: "Frete peso",
    attributeCode: "cavalo.frete_peso",
    entityLabel: "AAA1A11",
    entityType: "CAVALO",
    changeKind: "SET",
    beforeSource: "ARQUIVO",
    valueBeforeRaw: "100",
    valueBeforeNumeric: "100",
    valueAfterRaw: "111",
    valueAfterNumeric: "111",
    sourceColumnIndex: 0,
    impactConfidence: "CALCULATED",
  });

  return envio!.id;
}

beforeAll(async () => {
  ctx = await createTestDatabase("rota_conciliacao_de_chamados");
  process.env.DATABASE_URL = ctx.url;

  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: "2026-07",
        effectiveDate: "2026-07-01",
        data: { AAA1A11: { "cavalo.frete_peso": 100, "cavalo.pedagio": 20 } },
      },
      {
        label: "2026-08",
        effectiveDate: "2026-08-01",
        data: {
          /* Conciliada: é o que o chamado pediu. */
          "AAA1A11": { "cavalo.frete_peso": 111, "cavalo.pedagio": 25 },
        },
      },
    ],
    { entityType: "CAVALO" },
  );
  const [a, b] = Object.values(snapshotIds);
  changeSetId = (await computeChangeSet(ctx.db, a, b, { force: true })).id;

  /* Dois envios: o padrão da rota tem de ser o mais recente. */
  envioAntigoId = await enviar("sha-antigo", "2026-08-10T08:00:00Z");
  envioNovoId = await enviar("sha-novo", "2026-08-20T08:00:00Z");
  /*
    E um terceiro, de **outra unidade** e mais novo que os dois. Ele é a
    armadilha que o recorte por série existe para não cair: sem `?serie=`, é
    ele que o padrão escolhe — e é o certo, porque sem recorte "o mais recente"
    é o mais recente. Com `?serie=CAMAÇARI`, ele não pode ser escolhido.
  */
  envioDeOutraUnidadeId = await enviar(
    "sha-recife",
    "2026-08-25T08:00:00Z",
    "RECIFE",
  );

  const { default: router } = await import("../conciliacao-de-chamados");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
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

describe("os dois lados", () => {
  /*
    Sem pedir nada, a rota escolhe — e **diz** o que escolheu. É a propriedade
    que separa "um número" de "um número sobre alguma coisa": os cartões da tela
    saem daqui, e um seletor vazio ao lado deles deixaria quem lê supor que está
    vendo todas as vigências e todos os envios de uma vez.
  */
  it("escolhe o padrão e devolve qual escolheu", async () => {
    const { status, body } = await get(`${BASE}/resumo`);
    expect(status).toBe(200);
    expect(body.changeSetId).toBe(changeSetId);
    /* Sem série, "o mais recente" é o mais recente do banco. */
    expect(body.ticketImportId).toBe(envioDeOutraUnidadeId);
  });

  /*
    O recorte que a lateral produz. Com a unidade aberta, o envio padrão é o
    mais recente **dela** — e não o mais recente do banco, que aqui é de outra
    unidade. Sem isto, abrir a tela com CAMAÇARI na lateral confrontaria a
    vigência de Camaçari contra a fila de Recife, e devolveria uma tela cheia de
    pendência que não é pendência.
  */
  it("com série, o envio padrão é o mais recente daquela unidade", async () => {
    const { body } = await get(`${BASE}/resumo?serie=${encodeURIComponent("CAMAÇARI")}`);
    expect(body.ticketImportId).toBe(envioNovoId);
  });

  /*
    Série que não existe devolve **nada**, e com uma frase que diz o que fazer —
    nunca o envio de outra unidade. É a diferença entre um filtro que não achou
    e um filtro que sumiu.
  */
  it("uma série sem envio é recusada com o motivo, nunca trocada por outra", async () => {
    const { status, body } = await get(`${BASE}/resumo?serie=MANAUS`);
    expect(status).toBe(404);
    expect(body.error).toContain("MANAUS");
  });

  /* Um envio escolhido à mão vence a série: quem escolheu escolheu. */
  it("o envio pedido vence o recorte por série", async () => {
    const { body } = await get(
      `${BASE}/resumo?serie=${encodeURIComponent("CAMAÇARI")}&ticketImportId=${envioDeOutraUnidadeId}`,
    );
    expect(body.ticketImportId).toBe(envioDeOutraUnidadeId);
  });

  it("a lista responde sobre o mesmo par que o resumo", async () => {
    const resumo = await get(`${BASE}/resumo`);
    const linhas = await get(`${BASE}/linhas`);
    expect(linhas.body.changeSetId).toBe(resumo.body.changeSetId);
    expect(linhas.body.ticketImportId).toBe(resumo.body.ticketImportId);
  });

  it("honra o envio pedido, e não o padrão", async () => {
    const { body } = await get(`${BASE}/resumo?ticketImportId=${envioAntigoId}`);
    expect(body.ticketImportId).toBe(envioAntigoId);
  });

  /*
    A armadilha do append-only, do lado do contrato: os dois envios trazem o
    mesmo chamado, e conciliar contra um ou contra o outro tem de dar o mesmo
    número. Uma rota que somasse os envios devolveria o dobro.
  */
  it("não soma os envios entre si", async () => {
    const novo = await get(`${BASE}/resumo?ticketImportId=${envioNovoId}`);
    const antigo = await get(`${BASE}/resumo?ticketImportId=${envioAntigoId}`);
    expect(antigo.body.chamados.alteracoes).toBe(novo.body.chamados.alteracoes);
    expect(antigo.body.pares).toBe(novo.body.pares);
  });

  it("oferece as duas listas do seletor, e só os envios lidos", async () => {
    const { status, body } = await get(`${BASE}/opcoes`);
    expect(status).toBe(200);
    expect(body.comparacoes.map((c: any) => c.id)).toContain(changeSetId);
    expect(body.comparacoes[0].rotuloA).toBe("2026-07");
    expect(body.comparacoes[0].rotuloB).toBe("2026-08");
    /*
      A lista **inteira** dos envios lidos, e não a da unidade aberta: quando o
      casamento por nome não acontece, é aqui que quem abriu acha uma saída.
    */
    expect(body.envios.map((e: any) => e.id)).toEqual([
      envioDeOutraUnidadeId,
      envioNovoId,
      envioAntigoId,
    ]);
    /* E cada um diz de que unidade é — é o que separa dois arquivos do mesmo dia. */
    expect(body.envios.map((e: any) => e.serie)).toEqual([
      "RECIFE",
      "CAMAÇARI",
      "CAMAÇARI",
    ]);
  });
});

describe("o que a rota conta", () => {
  it("classifica o par que bate e o que a planilha mudou sozinha", async () => {
    const { body } = await get(`${BASE}/resumo`);
    expect(body.conciliadas).toBe(1);
    expect(body.semChamado).toBe(1);
    expect(body.pares).toBe(2);
    /* Duas alterações na planilha, uma no chamado: a diferença é publicada. */
    expect(body.planilha.alteracoes).toBe(2);
    expect(body.chamados.alteracoes).toBe(1);
    expect(body.diferenca).toBe(1);
  });

  it("filtra por situação da lista fechada", async () => {
    const { body } = await get(`${BASE}/linhas?situacao=SEM_CHAMADO`);
    expect(body.total).toBe(1);
    expect(body.linhas[0].attributeCode).toBe("cavalo.pedagio");
  });

  /*
    Texto de fora não vira predicado — ele é **ignorado**, e a resposta é a sem
    filtro. É a mesma disciplina de `ABAS` no Monitoramento: um recorte que a
    rota não conhece não pode virar uma consulta que ninguém revisou.
  */
  it("ignora situação que não existe, em vez de aceitá-la", async () => {
    const { status, body } = await get(`${BASE}/linhas?situacao=QUALQUER_COISA`);
    expect(status).toBe(200);
    expect(body.total).toBe(2);
  });

  it("pagina sem perder o total", async () => {
    const { body } = await get(`${BASE}/linhas?limit=1&offset=0`);
    expect(body.total).toBe(2);
    expect(body.linhas).toHaveLength(1);
  });
});
