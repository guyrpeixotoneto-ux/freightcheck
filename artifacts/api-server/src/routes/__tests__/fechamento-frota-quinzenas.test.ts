import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  encerrarPoolDoProcesso,
  fechamentoCompetenciaTable,
  fechamentoDocumentoTable,
  fechamentoFrotaPromaxTable,
  remuneracaoUnidadeTable,
  unidadeTable,
} from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `GET /fechamento/frota/quinzenas` — a série de ativos e parados.
 *
 * A régua da contagem está provada sem HTTP e sem banco em
 * `@workspace/fechamento` (`frota-quinzenal.test.ts`). O que só existe aqui é o
 * caminho inteiro: o `where` do documento vigente, o recorte por unidade, e a
 * tradução do pedido — e é este último que decide o que quem opera lê.
 *
 * O caso que mais importa é o da **cobertura**: a quinzena em que uma unidade
 * não mandou o relatório de parados não pode sair como zero parados, porque na
 * tela isso vira uma frota que ninguém parou. A resposta traz `null` e diz quem
 * não reportou.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const TRANSPORTADORA = { codigo: "36", nome: "HORIZONTE LOGISTICA LTDA" };

async function pedir(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Abre a quinzena pela porta da frente — a mesma que a tela do Fechamento usa. */
async function abrir(opcoes: {
  unidade: { codigo: string; nome: string };
  mes: number;
  quinzena: 1 | 2;
}): Promise<string> {
  const res = await fetch(`${base}/fechamento/competencias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ano: 2026,
      mes: opcoes.mes,
      quinzena: opcoes.quinzena,
      unidade: opcoes.unidade,
      transportadora: TRANSPORTADORA,
      tipoDeOperacao: "EMPURRADA",
    }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * As placas de uma das duas casinhas do Promax, escritas direto no banco.
 *
 * Pela porta da frente seria o upload do relatório, e o layout do 01.22.02.00
 * ainda não foi confirmado com o cliente (ver o TODO em `dominio.ts`). O que
 * esta suíte mede é a rota, não o leitor — que tem bateria própria.
 */
async function gravarFrota(opcoes: {
  competenciaId: string;
  situacao: "ATIVA" | "INATIVA";
  sufixo: string;
  placas: string[];
  vigente?: boolean;
}): Promise<void> {
  const [documento] = await ctx.db
    .insert(fechamentoDocumentoTable)
    .values({
      competenciaId: opcoes.competenciaId,
      tipo:
        opcoes.situacao === "ATIVA"
          ? "FROTA_PROMAX_ATIVA"
          : "FROTA_PROMAX_INATIVA",
      nomeDoArquivo: `${opcoes.situacao} ${opcoes.sufixo}.txt`,
      sha256: `frota-${opcoes.situacao}-${opcoes.sufixo}`,
      tamanhoEmBytes: 1024,
      linhasLidas: opcoes.placas.length,
      vigente: opcoes.vigente ?? true,
      enviadoEm: new Date("2026-07-16T09:00:00.000Z"),
    })
    .returning();
  if (opcoes.placas.length === 0) return;
  await ctx.db.insert(fechamentoFrotaPromaxTable).values(
    opcoes.placas.map((placa, i) => ({
      documentoId: documento.id,
      competenciaId: opcoes.competenciaId,
      linhaNoArquivo: i + 1,
      situacao: opcoes.situacao,
      unidade: "443",
      placa,
      modelo: "TOCO",
    })),
  );
}

const BELEM = { codigo: "081-0443", nome: "CRBS SA - CDD Belem" };
const MANAUS = { codigo: "081-0999", nome: "CRBS SA - CDD Manaus" };

/*
  Os escopos da lateral — três, e os três de propósito.

  A tela de Ativos e Parados fala em `scope_hash`, que é como a caixa "Unidade
  atual" nomeia uma unidade, e o Fechamento fala em `unidade.id`. Quem liga os
  dois é `remuneracao_unidade`, e é essa travessia que estes três exercitam: a
  que chega (Belém), a que não tem associação nenhuma (Manaus) e a que tem duas
  discordando (o escopo ambíguo).
*/
const ESCOPO_DE_BELEM = "scope-belem";
const ESCOPO_SEM_CADASTRO = "scope-manaus";
const ESCOPO_AMBIGUO = "scope-ambiguo";

beforeAll(async () => {
  ctx = await createTestDatabase("api_frota_quinzenas");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: fechamentoRouter } = await import("../fechamento");

  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
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
  if (typeof endereco === "string" || endereco === null)
    throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  /*
    Belém em três quinzenas: a frota cresce, um veículo para, e na última o
    relatório de parados não chega. Manaus só na segunda — é ela que prova que a
    soma de todas as unidades não pode ser lida sem a cobertura ao lado.
  */
  const b1 = await abrir({ unidade: BELEM, mes: 6, quinzena: 1 });
  await gravarFrota({
    competenciaId: b1,
    situacao: "ATIVA",
    sufixo: "b1",
    placas: ["AAA1A11", "BBB2B22"],
  });
  await gravarFrota({
    competenciaId: b1,
    situacao: "INATIVA",
    sufixo: "b1",
    placas: [],
  });

  const b2 = await abrir({ unidade: BELEM, mes: 6, quinzena: 2 });
  /* Um envio derrubado por reenvio — as linhas dele não podem entrar na conta. */
  await gravarFrota({
    competenciaId: b2,
    situacao: "ATIVA",
    sufixo: "b2-velho",
    placas: ["XXX0X00", "YYY0Y00", "ZZZ0Z00", "WWW0W00"],
    vigente: false,
  });
  await gravarFrota({
    competenciaId: b2,
    situacao: "ATIVA",
    sufixo: "b2",
    placas: ["AAA1A11", "CCC3C33"],
  });
  await gravarFrota({
    competenciaId: b2,
    situacao: "INATIVA",
    sufixo: "b2",
    placas: ["BBB2B22"],
  });

  const m2 = await abrir({ unidade: MANAUS, mes: 6, quinzena: 2 });
  await gravarFrota({
    competenciaId: m2,
    situacao: "ATIVA",
    sufixo: "m2",
    placas: ["QQQ9Q99"],
  });
  /* Manaus não mandou o relatório de parados nesta quinzena. */

  const b3 = await abrir({ unidade: BELEM, mes: 7, quinzena: 1 });
  await gravarFrota({
    competenciaId: b3,
    situacao: "ATIVA",
    sufixo: "b3",
    placas: ["AAA1A11", "CCC3C33", "DDD4D44"],
  });
  await gravarFrota({
    competenciaId: b3,
    situacao: "INATIVA",
    sufixo: "b3",
    placas: ["BBB2B22"],
  });

  /*
    A identidade, que é o que o escopo resolve para.

    Belém ganha unidade canônica e as competências dela passam a apontar para
    ela — é o estado normal de uma unidade classificada. Manaus fica sem, de
    propósito: é o passivo histórico, e é ele que prova que a resposta a um
    escopo sem cadastro não pode ser o acervo inteiro.
  */
  const [unidadeDeBelem] = await ctx.db
    .insert(unidadeTable)
    .values({ nome: "CDD BELÉM", codigoGerencial: "081-0443" })
    .returning();
  const [outraUnidade] = await ctx.db
    .insert(unidadeTable)
    .values({ nome: "CDD MANAUS", codigoGerencial: "081-0999" })
    .returning();

  await ctx.db
    .update(fechamentoCompetenciaTable)
    .set({ unidadeId: unidadeDeBelem!.id })
    .where(eq(fechamentoCompetenciaTable.unidadeCodigo, BELEM.codigo));

  await ctx.db.insert(remuneracaoUnidadeTable).values([
    {
      scopeHash: ESCOPO_DE_BELEM,
      codigo: BELEM.codigo,
      nome: "CDD BELÉM",
      canal: "EMPURRADA",
      vigenciaInicial: "2026-06-01",
      unidadeId: unidadeDeBelem!.id,
    },
    /* O mesmo escopo, o outro canal, a mesma unidade — uma resposta só. */
    {
      scopeHash: ESCOPO_DE_BELEM,
      codigo: BELEM.codigo,
      nome: "CDD BELÉM",
      canal: "ROTA",
      vigenciaInicial: "2026-06-01",
      unidadeId: unidadeDeBelem!.id,
    },
    /* Cadastro sem associação: o escopo existe e não alcança unidade nenhuma. */
    {
      scopeHash: ESCOPO_SEM_CADASTRO,
      codigo: MANAUS.codigo,
      nome: "CDD MANAUS",
      canal: "EMPURRADA",
      vigenciaInicial: "2026-06-01",
      unidadeId: null,
    },
    /* Duas unidades para o mesmo escopo — erro de alguém, e ninguém escolhe. */
    {
      scopeHash: ESCOPO_AMBIGUO,
      codigo: "081-0443",
      nome: "CDD BELÉM",
      canal: "EMPURRADA",
      vigenciaInicial: "2026-06-01",
      unidadeId: unidadeDeBelem!.id,
    },
    {
      scopeHash: ESCOPO_AMBIGUO,
      codigo: "081-0999",
      nome: "CDD MANAUS",
      canal: "ROTA",
      vigenciaInicial: "2026-06-01",
      unidadeId: outraUnidade!.id,
    },
  ]);
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
  await admin.pool.query(
    `DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`,
  );
  await admin.pool.end();
});

describe("GET /fechamento/frota/quinzenas", () => {
  it("200 com a série da unidade, da mais antiga para a mais recente", async () => {
    const { status, body } = await pedir(
      `/fechamento/frota/quinzenas?unidade=${encodeURIComponent(BELEM.codigo)}`,
    );

    expect(status).toBe(200);
    expect(
      body.quinzenas.map((q: { competencia: string }) => q.competencia),
    ).toEqual(["2026-06-Q1", "2026-06-Q2", "2026-07-Q1"]);
    /* O envio derrubado tinha quatro placas e não entra: a segunda tem duas. */
    expect(body.quinzenas[1]).toMatchObject({
      ativos: 2,
      parados: 1,
      total: 3,
    });
    expect(body.quinzenas[1].variacao).toMatchObject({
      contra: "2026-06-Q1",
      ativos: 0,
      parados: 1,
      total: 1,
    });
    expect(body.quinzenas[2]).toMatchObject({ ativos: 3, parados: 1 });
  });

  it("a primeira quinzena da janela não tem variação — e isso não é zero", async () => {
    const { body } = await pedir(
      `/fechamento/frota/quinzenas?unidade=${encodeURIComponent(BELEM.codigo)}`,
    );
    expect(body.quinzenas[0].variacao).toBeNull();
  });

  it("sem unidade, soma o conjunto — e diz quem não reportou", async () => {
    const { body } = await pedir("/fechamento/frota/quinzenas");
    const segunda = body.quinzenas.find(
      (q: { competencia: string }) => q.competencia === "2026-06-Q2",
    );

    /* Belém (2 ativas) + Manaus (1 ativa); parados só Belém tem. */
    expect(segunda).toMatchObject({ ativos: 3, parados: 1 });
    expect(segunda.cobertura.unidades).toEqual([BELEM.codigo, MANAUS.codigo]);
    expect(segunda.cobertura.comFrotaInativa).toEqual([BELEM.codigo]);
  });

  it("a unidade sem relatório nenhum de parados devolve null, e não zero", async () => {
    const { body } = await pedir(
      `/fechamento/frota/quinzenas?unidade=${encodeURIComponent(MANAUS.codigo)}`,
    );
    expect(body.quinzenas).toHaveLength(1);
    expect(body.quinzenas[0]).toMatchObject({
      ativos: 1,
      parados: null,
      total: null,
    });
    expect(body.quinzenas[0].percentualParado).toBeNull();
  });

  it("a janela recorta as quinzenas mais recentes", async () => {
    const { body } = await pedir(
      `/fechamento/frota/quinzenas?unidade=${encodeURIComponent(BELEM.codigo)}&limite=2`,
    );
    expect(
      body.quinzenas.map((q: { competencia: string }) => q.competencia),
    ).toEqual(["2026-06-Q2", "2026-07-Q1"]);
  });

  it("400 quando a janela pedida está fora da faixa", async () => {
    expect((await pedir("/fechamento/frota/quinzenas?limite=0")).status).toBe(
      400,
    );
    expect((await pedir("/fechamento/frota/quinzenas?limite=99")).status).toBe(
      400,
    );
    expect(
      (await pedir("/fechamento/frota/quinzenas?limite=doze")).status,
    ).toBe(400);
  });

  it("publica as unidades do acervo, para o seletor da tela", async () => {
    const { body } = await pedir("/fechamento/frota/quinzenas");
    expect(body.unidades.map((u: { codigo: string }) => u.codigo)).toEqual([
      BELEM.codigo,
      MANAUS.codigo,
    ]);
    expect(body.recorte).toMatchObject({ unidadeCodigo: null, limite: 12 });
  });

  it("unidade que não existe devolve série vazia, e não o acervo inteiro", async () => {
    const { status, body } = await pedir(
      "/fechamento/frota/quinzenas?unidade=nao-existe",
    );
    expect(status).toBe(200);
    expect(body.quinzenas).toEqual([]);
  });
});

/**
 * O ESCOPO DA LATERAL — a tela recortada pela unidade que a caixa "Unidade
 * atual" está anunciando.
 *
 * O que se mede aqui é a travessia inteira, e ela é a razão de esta suíte
 * existir com banco: `scope_hash` → `remuneracao_unidade.unidade_id` →
 * `fechamento_competencia.unidade_id`. Nenhum texto é comparado no caminho, e é
 * isso que impede o pior desfecho possível desta tela — a frota de uma unidade
 * desenhada embaixo do nome de outra.
 */
describe("GET /fechamento/frota/quinzenas?scopeHash", () => {
  it("recorta pela unidade canônica do escopo, sem comparar texto nenhum", async () => {
    const { status, body } = await pedir(
      `/fechamento/frota/quinzenas?scopeHash=${ESCOPO_DE_BELEM}`,
    );

    expect(status).toBe(200);
    expect(body.escopo).toMatchObject({
      scopeHash: ESCOPO_DE_BELEM,
      tipo: "RESOLVIDO",
      nome: "CDD BELÉM",
    });
    /* As três de Belém, e nenhuma de Manaus — que é a única da 2026-06-Q2. */
    expect(
      body.quinzenas.map((q: { competencia: string }) => q.competencia),
    ).toEqual(["2026-06-Q1", "2026-06-Q2", "2026-07-Q1"]);
    const segunda = body.quinzenas[1];
    expect(segunda).toMatchObject({ ativos: 2, parados: 1, total: 3 });
    expect(segunda.cobertura.unidades).toEqual([BELEM.codigo]);
  });

  /*
    O caso que motivou a mudança: escopo que não alcança unidade cadastrada.

    A tentação é responder o acervo inteiro — "não sei recortar, então mostro
    tudo" —, e é exatamente o defeito que a tela tinha antes, só que agora
    escondido no caminho da falha. A resposta é vazia e **diz por quê**.
  */
  it("escopo sem unidade associada devolve vazio com o motivo, e não o acervo", async () => {
    const { status, body } = await pedir(
      `/fechamento/frota/quinzenas?scopeHash=${ESCOPO_SEM_CADASTRO}`,
    );

    expect(status).toBe(200);
    expect(body.quinzenas).toEqual([]);
    expect(body.escopo).toMatchObject({
      scopeHash: ESCOPO_SEM_CADASTRO,
      tipo: "SEM_CADASTRO",
    });
    /* O caminho de volta continua publicado: o acervo tem unidades. */
    expect(body.unidades.length).toBe(2);
  });

  it("escopo que nunca foi cadastrado cai no mesmo estado", async () => {
    const { body } = await pedir(
      "/fechamento/frota/quinzenas?scopeHash=scope-que-ninguem-cadastrou",
    );

    expect(body.quinzenas).toEqual([]);
    expect(body.escopo).toMatchObject({ tipo: "SEM_CADASTRO" });
  });

  it("duas unidades para o mesmo escopo não escolhem nenhuma", async () => {
    const { body } = await pedir(
      `/fechamento/frota/quinzenas?scopeHash=${ESCOPO_AMBIGUO}`,
    );

    expect(body.quinzenas).toEqual([]);
    expect(body.escopo).toMatchObject({ tipo: "AMBIGUO" });
    expect(body.escopo.nomes).toEqual(["CDD BELÉM", "CDD MANAUS"]);
  });

  /*
    Sem escopo, a leitura continua sendo a do acervo — a Visão Geral. `escopo`
    volta `null` para que a tela distinga "ninguém pediu recorte" de "pedi e não
    resolveu", que são as duas leituras que ela desenha de formas diferentes.
  */
  it("sem escopo, a resposta é a de sempre e `escopo` é null", async () => {
    const { body } = await pedir("/fechamento/frota/quinzenas");

    expect(body.escopo).toBeNull();
    expect(body.quinzenas.length).toBeGreaterThan(0);
  });

  /* A janela continua valendo dentro do recorte do escopo. */
  it("a janela recorta dentro do escopo", async () => {
    const { body } = await pedir(
      `/fechamento/frota/quinzenas?scopeHash=${ESCOPO_DE_BELEM}&limite=2`,
    );

    expect(
      body.quinzenas.map((q: { competencia: string }) => q.competencia),
    ).toEqual(["2026-06-Q2", "2026-07-Q1"]);
  });
});
