import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { remuneracaoPlanilhaTable, remuneracaoUnidadeTable } from "@workspace/db/schema";
import { CHAVES_DO_CONTRATO } from "@workspace/remuneracao";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `GET /fechamento/competencias/:id` — o contrato da quinzena, na tela que pede
 * os relatórios.
 *
 * **O defeito que este arquivo fecha.** O devido é o contrato multiplicado pela
 * operação. Uma competência real tinha os três relatórios do devido importados,
 * três vistos verdes nesta tela, e nenhuma linha com número no Resumo — porque
 * a quarta peça do grupo, o contrato, não chega por importação e não tinha onde
 * aparecer aqui. Quem operava não tinha como ligar as duas telas.
 *
 * A rota passa a responder em que porta o cadastro parou, com o problema e o
 * conserto **escritos pelo domínio** (`comoDestravar`). É o mesmo campo que o
 * Resumo e a Conciliação leem: as três telas dizem a mesma coisa por lerem a
 * mesma fonte, e não porque alguém sincronizou três frases.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

/* eslint-disable @typescript-eslint/no-explicit-any -- corpo de resposta HTTP em teste. */
async function pedir(caminho: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${caminho}`, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function abrirCompetencia(unidade: string, quinzena: 1 | 2 = 2): Promise<string> {
  const { body } = await pedir("/fechamento/competencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ano: 2026,
      mes: 7,
      quinzena,
      unidade: { codigo: unidade, nome: `CDD ${unidade}` },
      transportadora: { codigo: "036", nome: "HORIZONTE" },
      tipoDeOperacao: "ROTA",
    }),
  });
  return body.id as string;
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_fechamento_contrato");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: fechamentoRouter } = await import("../fechamento");

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { error: () => {}, warn: () => {}, info: () => {} };
    (req as unknown as { user: unknown }).user = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Guy",
      email: "teste@freightcheck",
      role: "OPERADOR",
    };
    next();
  });
  app.use(fechamentoRouter);
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
});

describe("o contrato da quinzena chega junto da competência", () => {
  it("sem cadastro nenhum: a porta em que parou, e o conserto", async () => {
    const id = await abrirCompetencia("501");
    const { status, body } = await pedir(`/fechamento/competencias/${id}`);

    expect(status).toBe(200);
    expect(body.contrato).not.toBeNull();
    expect(body.contrato.canal).toBe("ROTA");
    /* Nenhuma unidade cadastrada em Remuneração: para na primeira porta. */
    expect(body.contrato.estado).toBe("UNIDADE_NAO_ENCONTRADA");

    /*
      O que faz esta rota valer: o texto do conserto vem escrito, e não um
      booleano que a tela teria de traduzir por conta própria.
    */
    expect(body.contrato.destrava).not.toBeNull();
    expect(body.contrato.destrava.problema).toContain("501");
    expect(body.contrato.destrava.conserto.length).toBeGreaterThan(20);
    /* Sem cadastro, os parâmetros do contrato também não existem. */
    expect(body.contrato.parametros).toBeNull();
    expect(body.contrato.custoVariavelPrevistoPor25Viagens).toBeNull();
  }, 60_000);

  it("o campo vem sempre, e não só quando há problema", async () => {
    /*
      O contraprova de omissão. Uma rota que só devolvesse `contrato` na falha
      faria a tela ler ausência de campo como "está tudo bem" — e ela leria a
      mesma coisa num deploy em que o campo sumisse por acidente.
    */
    const id = await abrirCompetencia("502", 1);
    const { body } = await pedir(`/fechamento/competencias/${id}`);
    expect(Object.keys(body)).toContain("contrato");
    expect(body.contrato.estado).toBeTruthy();
  }, 60_000);

  it("com o cadastro completo: os parâmetros do contrato vêm junto", async () => {
    const codigo = "504";
    const vigencia = "2026-07-16"; // dentro da 2ª quinzena de julho/2026

    await ctx.db.insert(remuneracaoUnidadeTable).values({
      scopeHash: "escopo-teste-504",
      codigo,
      nome: `CDD ${codigo}`,
      canal: "ROTA",
      vigenciaInicial: vigencia,
    });
    await ctx.db.insert(remuneracaoPlanilhaTable).values(
      CHAVES_DO_CONTRATO.map((chave) => ({
        scopeHash: "escopo-teste-504",
        canal: "ROTA",
        effectiveDate: vigencia,
        chave,
        valor: "1",
      })),
    );

    const id = await abrirCompetencia(codigo);
    const { body } = await pedir(`/fechamento/competencias/${id}`);

    expect(body.contrato.estado).toBe("RESPONDEU");
    expect(body.contrato.parametros).not.toBeNull();
    expect(body.contrato.parametros.frotaFixaAtiva).toBe(1);
    expect(body.contrato.parametros.aliquotas.pis).toBeCloseTo(0.01);
    expect(body.contrato.custoVariavelPrevistoPor25Viagens).toBe(2);
  }, 60_000);

  it("a resposta continua trazendo o que já trazia", async () => {
    /* O campo novo não pode ter custado nenhum dos antigos. */
    const id = await abrirCompetencia("503");
    const { body } = await pedir(`/fechamento/competencias/${id}`);
    expect(body.competencia?.id).toBe(id);
    expect(Array.isArray(body.documentos)).toBe(true);
    expect(body).toHaveProperty("apuracao");
  }, 60_000);
});

describe("GET /fechamento/lados", () => {
  it("publica os quatro lados, com o texto que a tela mostra", async () => {
    const { status, body } = await pedir("/fechamento/lados");

    expect(status).toBe(200);
    /*
      Quatro, e não três: `CONFERENCIA_OPERACIONAL` entrou com a frota Promax e
      é categoria própria de propósito — não é dinheiro nenhum, é contagem de
      veículo contra o cadastro do contrato. Ver a nota de `ladoDaFonte` em
      `lib/fechamento/src/dominio.ts`: tratá-la como mais um `FATURAMENTO` faria
      uma leitura apressada somar veículos a reais.
    */
    expect(body.map((l: { lado: string }) => l.lado)).toEqual([
      "DEVIDO",
      "DEMONSTRADO",
      "FATURAMENTO",
      "CONFERENCIA_OPERACIONAL",
    ]);
    /*
      Dois dependem do contrato, e não só o devido — ver `LADOS_DA_CONFERENCIA`.
      O devido depende dele para calcular; a conferência operacional depende
      dele para ter contra o que comparar: a frota que o Promax declara ativa só
      diz alguma coisa contra a frota que o cadastro do contrato registra.
    */
    expect(
      body
        .filter((l: { precisaDeContrato: boolean }) => l.precisaDeContrato)
        .map((l: { lado: string }) => l.lado),
    ).toEqual(["DEVIDO", "CONFERENCIA_OPERACIONAL"]);
    for (const l of body) {
      expect(l.titulo.length).toBeGreaterThan(0);
      expect(l.explica.length).toBeGreaterThan(20);
    }
  }, 60_000);
});

describe("GET /fechamento/fontes", () => {
  it("cada fonte declara o lado, para a tela agrupar sem decidir nada", async () => {
    const { body } = await pedir("/fechamento/fontes");
    const lado = (tipo: string) => body.find((f: { tipo: string }) => f.tipo === tipo)?.lado;

    expect(lado("OPERACAO")).toBe("DEVIDO");
    /* As duas casinhas do 03.08.18 formam o devido, cada uma pela frota dela. */
    expect(lado("DISPONIBILIDADE_FF")).toBe("DEVIDO");
    expect(lado("DISPONIBILIDADE_VAN")).toBe("DEVIDO");
    expect(lado("REQUISICOES")).toBe("DEVIDO");
    expect(lado("PAGAMENTO")).toBe("DEMONSTRADO");
    expect(lado("CTE")).toBe("FATURAMENTO");
    expect(lado("CONCILIACAO")).toBe("FATURAMENTO");
  }, 60_000);
});
