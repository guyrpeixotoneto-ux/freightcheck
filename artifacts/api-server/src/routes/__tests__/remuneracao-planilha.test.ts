import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * `/remuneracao/planilha*` — o contrato da única superfície do módulo que
 * **escreve**.
 *
 * O domínio já é provado sem HTTP em `lib/remuneracao/src/__tests__`. O que se
 * protege aqui é o que só existe na borda, e que é onde uma recusa nomeada
 * costuma virar 500:
 *
 * 1. o autor sai da **sessão**, e nunca do corpo — um "informado por" que a
 *    tela preenchesse sustentaria apenas "alguém digitou esse nome";
 * 2. cada recusa do domínio chega com o número certo: célula impossível é 400,
 *    vigência inexistente é 404, corpo sem célula é 400;
 * 3. o que entra pelo `PUT` sai pelo `GET /remuneracao/cadastro` marcado como
 *    `INFORMADO`, e não por cima do que o acervo mede.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const ESCOPO = "escopo-http-planilha";
const VIGENCIA = "2026-08-01";
const CONSULTA = `scopeHash=${ESCOPO}&canal=EMPURRADA`;

interface Resposta {
  status: number;
  body: any;
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

async function enviar(metodo: string, caminho: string, corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

const ATIVO: AttributeSpec = {
  code: "cavalo.ativo",
  dataType: "TEXT",
  semanticsStatus: "CONFIRMED",
};

beforeAll(async () => {
  ctx = await createTestDatabase("api_remuneracao_planilha");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  await seedTaxonomy(ctx.db, "test");
  await buildFixture(
    ctx.db,
    [ATIVO],
    [
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: VIGENCIA,
        data: {
          AAA1A11: { "cavalo.ativo": "ATIVO" },
          BBB2B22: { "cavalo.ativo": "ATIVO" },
          CCC3C33: { "cavalo.ativo": "PARADO" },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: ESCOPO, canal: "cavalos" },
  );

  const { default: remuneracaoRouter } = await import("../remuneracao");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    /*
      A sessão do teste é esta, e é dela que o autor da planilha sai. É o ponto
      inteiro do primeiro caso: nenhum corpo consegue escolher quem assinou.
    */
    (req as unknown as { user: unknown }).user = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Guy",
      email: "teste@freightcheck",
      role: "OPERADOR",
    };
    next();
  });
  app.use(remuneracaoRouter);
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

describe("a planilha informada, pela borda", () => {
  it("começa vazia sem 404 — quem cadastra pela primeira vez está nesse estado", async () => {
    const { status, body } = await get(`/remuneracao/planilha?${CONSULTA}&period=${VIGENCIA}`);
    expect(status).toBe(200);
    expect(body.linhas).toEqual([]);
    expect(body.atualizadaEm).toBeNull();
  });

  it("grava, e assina com a sessão em vez do corpo", async () => {
    const { status, body } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      period: VIGENCIA,
      celulas: [
        { chave: "van_custo_fixo", valor: 4693.85, observacao: "aba de agosto" },
        { chave: "aliquota_iss", valor: 5.9 },
      ],
      // O corpo tenta assinar por outra pessoa; o servidor ignora.
      autor: { id: null, nome: "Outra pessoa" },
    });

    expect(status).toBe(200);
    expect(body.linhas).toHaveLength(2);
    expect(body.linhas.every((l: { autor: string }) => l.autor === "Guy")).toBe(true);
  });

  it("recusa a célula impossível com 400, e nomeia a linha", async () => {
    const { status, body } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      period: VIGENCIA,
      celulas: [{ chave: "aliquota_iss", valor: 900 }],
    });
    expect(status).toBe(400);
    expect(body.error).toContain("Alíquota ISS no Município");
  });

  it("recusa a chave fora do catálogo com 400", async () => {
    const { status } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      period: VIGENCIA,
      celulas: [{ chave: "custo_do_cafezinho", valor: 3 }],
    });
    expect(status).toBe(400);
  });

  it("recusa o corpo sem lista de células com 400", async () => {
    const { status, body } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      period: VIGENCIA,
    });
    expect(status).toBe(400);
    expect(body.error).toContain("celulas");
  });

  /*
    JSON sabe dizer `null`, e uma query não — é por isso que o corpo tem leitura
    de contexto própria. `"canal": null` é o pedido explícito pela série **sem
    canal**, e a planilha gravada por ele é de lá.

    O defeito que isto prende é silencioso. Lido como "não disse", o `null`
    faria o servidor escolher a primeira série do escopo — `EMPURRADA` — e a
    planilha cairia numa série que ninguém pediu, sem erro nenhum e sem nada na
    tela que dissesse onde ela foi parar. A prova é a segunda asserção: a
    planilha de EMPURRADA continua com as duas linhas que ela já tinha.
  */
  it("lê canal nulo no corpo como a série sem canal, e não como omissão", async () => {
    const { status, body } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: null,
      period: VIGENCIA,
      celulas: [{ chave: "van_custo_equipe", valor: 4250.45 }],
    });
    expect(status).toBe(200);
    expect(body.canal).toBeNull();
    expect(body.linhas.map((l: { chave: string }) => l.chave)).toEqual(["van_custo_equipe"]);

    const empurrada = await get(`/remuneracao/planilha?${CONSULTA}&period=${VIGENCIA}`);
    expect(empurrada.body.linhas).toHaveLength(2);
  });

  /*
    O canal que o acervo não entregou. A aba de ROTA existe antes do export de
    ROTA, e recusá-la até a série chegar inverteria a ordem em que a operação
    acontece — a planilha é o que se recebe primeiro.
  */
  it("aceita um tipo de operação que o acervo não tem, na unidade que ele tem", async () => {
    const { status, body } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "ROTA",
      period: VIGENCIA,
      celulas: [{ chave: "aliquota_icms", valor: 17.84 }],
    });
    expect(status).toBe(200);
    expect(body.canal).toBe("ROTA");

    // E ele passa a ter cadastro próprio, com as trinta linhas e sem lastro.
    const cadastro = await get(
      `/remuneracao/cadastro?scopeHash=${ESCOPO}&canal=ROTA&period=${VIGENCIA}`,
    );
    expect(cadastro.status).toBe(200);
    expect(cadastro.body.resumo.linhas).toBe(30);
    expect(cadastro.body.resumo.comLastro).toBe(0);
    expect(cadastro.body.resumo.informadas).toBe(1);
  });

  it("continua recusando a unidade que ninguém importou", async () => {
    const { status } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: "escopo-que-ninguem-importou",
      canal: "ROTA",
      period: VIGENCIA,
      celulas: [{ chave: "aliquota_icms", valor: 17.84 }],
    });
    expect(status).toBe(404);
  });

  it("recusa a vigência que a unidade não entregou com 404", async () => {
    const { status } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      period: "2020-01-01",
      celulas: [{ chave: "van_custo_fixo", valor: 1 }],
    });
    expect(status).toBe(404);
  });

  /*
    A bandeira que deixa a quinzena nascer, pela borda. Ela é opt-in nas três
    superfícies — `vigenciaNova=1` na leitura, `vigenciaNova: true` nas duas
    escritas —, e o que ela não afrouxa é a régua da quinzena: só o dia 1 e o
    dia 16, com a recusa nomeada em 400.
  */
  it("cria a quinzena nova quando o corpo pede, e só então", async () => {
    const SEGUNDA = "2026-08-16";
    const celulas = [{ chave: "aliquota_icms", valor: 17.84 }];

    expect(
      (
        await enviar("PUT", "/remuneracao/planilha", {
          scopeHash: ESCOPO,
          canal: "EMPURRADA",
          period: SEGUNDA,
          celulas,
        })
      ).status,
    ).toBe(404);

    const { status, body } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      period: SEGUNDA,
      vigenciaNova: true,
      celulas,
    });
    expect(status).toBe(200);
    expect(body.effectiveDate).toBe(SEGUNDA);

    // E, depois de existir, ela aparece no seletor do cadastro sem bandeira.
    const cadastro = await get(`/remuneracao/cadastro?${CONSULTA}&period=${SEGUNDA}`);
    expect(cadastro.status).toBe(200);
    const oferecidas = cadastro.body.vigencias.map(
      (v: { effectiveDate: string }) => v.effectiveDate,
    );
    expect(oferecidas).toContain(SEGUNDA);
  });

  it("recusa com 400 a vigência que não é começo de quinzena", async () => {
    const { status, body } = await enviar("PUT", "/remuneracao/planilha", {
      scopeHash: ESCOPO,
      canal: "EMPURRADA",
      period: "2026-09-07",
      vigenciaNova: true,
      celulas: [{ chave: "aliquota_icms", valor: 17.84 }],
    });

    expect(status).toBe(400);
    expect(String(body.error)).toContain("dia 16");
  });

  it("abre o formulário em branco da quinzena nova só com vigenciaNova=1", async () => {
    const NOVA = "2026-09-01";

    expect((await get(`/remuneracao/cadastro?${CONSULTA}&period=${NOVA}`)).status).toBe(404);

    const { status, body } = await get(
      `/remuneracao/cadastro?${CONSULTA}&period=${NOVA}&vigenciaNova=1`,
    );
    expect(status).toBe(200);
    expect(body.effectiveDate).toBe(NOVA);
    expect(body.resumo.informadas).toBe(0);
  });

  it("recusa copiar sem as duas pontas, e copiar para a mesma vigência", async () => {
    expect(
      (await enviar("POST", "/remuneracao/planilha/copia", { scopeHash: ESCOPO, de: VIGENCIA }))
        .status,
    ).toBe(400);
    expect(
      (
        await enviar("POST", "/remuneracao/planilha/copia", {
          scopeHash: ESCOPO,
          canal: "EMPURRADA",
          de: VIGENCIA,
          para: VIGENCIA,
        })
      ).status,
    ).toBe(400);
  });

  /*
    O fecho: o que entrou pelo `PUT` sai no cadastro montado como `INFORMADO`,
    e o que o acervo mede continua `APURADO`. É a garantia que sustenta o resto
    do módulo, medida na ponta em que a tela a lê.
  */
  it("devolve o informado dentro do cadastro, sem virar apurado", async () => {
    const { status, body } = await get(`/remuneracao/cadastro?${CONSULTA}&period=${VIGENCIA}`);
    expect(status).toBe(200);

    const linhas: any[] = body.blocos.flatMap((b: any) => b.linhas);
    const van = linhas.find((l) => l.chave === "van_custo_fixo");
    expect(van.estado).toBe("INFORMADO");
    expect(van.valor).toBe(4693.85);
    expect(van.declarado.autor).toBe("Guy");
    expect(van.declarado.observacao).toBe("aba de agosto");

    const frota = linhas.find((l) => l.chave === "frota_fixa_ativos");
    expect(frota.estado).toBe("APURADO");
    expect(frota.valor).toBe(2);
    expect(frota.declarado).toBeNull();

    expect(body.resumo.informadas).toBe(2);
    expect(body.material.linhasInformadas).toBe(2);
  });
});
