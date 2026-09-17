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

/**
 * Duas rubricas na mesma vigência — e é o ponto.
 *
 * O IPVA e o FINAME do mesmo cavalo moram no mesmo arquivo e na mesma
 * comparação. Um recorte que lesse as colunas erradas alcançaria alterações de
 * outra rubrica, e a frase de quem estava auditando o tributo iria parar no
 * financiamento. É o que o bloco "cada rubrica lê as colunas dela" prende.
 */
const COLUNAS: AttributeSpec[] = [
  {
    code: "cavalo.ipva_licenciamento",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.finame_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  /*
    As duas dos Impostos — o montante e a alíquota do mesmo tributo.

    Elas existem aqui por causa de `soAliquotas`, que é o filtro próprio dessa
    rubrica e o representante dos sete que cada tela tem. Um recorte que
    ignorasse a caixa própria da rubrica alcançaria as duas linhas onde a tela
    mostra uma — e é a caixa própria, não a busca, que o desenho genérico do
    registro poderia deixar cair sem ninguém notar.
  */
  {
    code: "cavalo.valor_icms",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.percentual_icms",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "PERCENT",
    aggregation: "NONE",
    isMonetary: false,
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
    COLUNAS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          RPG0C44: {
            "cavalo.ipva_licenciamento": 7210,
            "cavalo.finame_cavalo": 3000,
            "cavalo.valor_icms": 1200,
            "cavalo.percentual_icms": 12,
          },
          RPG1B56: { "cavalo.ipva_licenciamento": 7210, "cavalo.finame_cavalo": 3000 },
          RPG1D47: { "cavalo.ipva_licenciamento": 7210, "cavalo.finame_cavalo": 3000 },
          RPG2E53: { "cavalo.ipva_licenciamento": 5000, "cavalo.finame_cavalo": 3000 },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          RPG0C44: {
            "cavalo.ipva_licenciamento": 4145.26,
            "cavalo.finame_cavalo": 2800,
            "cavalo.valor_icms": 1500,
            "cavalo.percentual_icms": 15,
          },
          RPG1B56: { "cavalo.ipva_licenciamento": 4145.26, "cavalo.finame_cavalo": 3000 },
          RPG1D47: { "cavalo.ipva_licenciamento": 4145.26, "cavalo.finame_cavalo": 3000 },
          RPG2E53: { "cavalo.ipva_licenciamento": 5000, "cavalo.finame_cavalo": 3000 },
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

describe("cada rubrica lê as colunas dela", () => {
  /*
    A mesma comparação tem alterações de três rubricas, e o recorte de cada uma
    alcança **o catálogo dela** — nunca "todas as alterações do change set".
    Sem isso, a frase de quem estava auditando o tributo iria parar no
    financiamento.

    Os catálogos **se cruzam de propósito**, e é a parte que surpreende: o ICMS
    é contexto na expansão do FINAME, então `cavalo.valor_icms` está nos dois.
    Isso não é vazamento — é a tela do FINAME mostrando aquela coluna, e um
    recorte que a escondesse não seria o que se vê. O que não pode acontecer é
    o contrário: o IPVA não está no catálogo do FINAME, e nenhum lote de FINAME
    pode alcançá-lo.

    Os três universos têm tamanhos diferentes por construção: se o recorte
    ignorasse a rubrica, os três responderiam a mesma coisa.
  */
  it("o IPVA alcança só o tributo do catálogo dele", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte(),
      ...JUSTIFICATIVA,
    });
    expect(res.body.resumo.universo).toBe(3);
    expect(res.body.justificativas.map((j: any) => j.entityLabel).sort()).toEqual([
      "RPG0C44",
      "RPG1B56",
      "RPG1D47",
    ]);
  });

  it("o FINAME alcança o catálogo dele — e o IPVA não está nele", async () => {
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ rubrica: "finame" }),
      ...JUSTIFICATIVA,
    });
    /* A parcela e o ICMS da RPG0C44: as duas são colunas que a tela do FINAME
       mostra. As três quedas de IPVA, que são de outro catálogo, ficam fora —
       e é por elas que o universo não é cinco. */
    expect(res.body.resumo.universo).toBe(2);
    expect(res.body.justificativas).toHaveLength(2);
    expect(res.body.lote.descricao).toContain("rubrica finame");

    const gravadas = await ctx.db.select().from(justificativaTable);
    expect(gravadas.every((j) => j.changeId !== alteracao.RPG1B56)).toBe(true);
  });

  it("a caixa própria da rubrica recorta — `soAliquotas` nos Impostos", async () => {
    /*
      A placa moveu o valor do ICMS **e** a alíquota dele. Sem a caixa, o
      recorte alcança as duas; com ela, só a alíquota. É a prova de que o
      registro genérico não perde o filtro que é de uma rubrica só — que é o
      que ele mais arriscaria perder, por ser o único campo que muda de nome
      de uma rubrica para a outra.
    */
    const tudo = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ rubrica: "impostos", filtros: { estado: "ALTERADO" } }),
      ...JUSTIFICATIVA,
    });
    expect(tudo.body.resumo.universo).toBe(2);

    await ctx.db.delete(justificativaTable);
    const soAliquota = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({
        rubrica: "impostos",
        filtros: { estado: "ALTERADO", soAliquotas: true },
      }),
      ...JUSTIFICATIVA,
    });
    expect(soAliquota.body.resumo.universo).toBe(1);
    expect(soAliquota.body.lote.descricao).toContain("só as alíquotas");
  });

  it("a mesma placa recebe uma justificativa por alteração, e não uma só", async () => {
    /*
      A RPG0C44 moveu IPVA, parcela e ICMS. Justificar o lote de IPVA e depois
      o de FINAME grava três linhas nela — uma por alteração —, e as do FINAME
      não são contadas como "já justificadas" pela do IPVA: são fatos
      diferentes, sobre colunas diferentes.
    */
    await post("/justificativas/lote", { changeSetId, escopo: recorte(), ...JUSTIFICATIVA });
    const doFiname = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ rubrica: "finame" }),
      ...JUSTIFICATIVA,
    });
    expect(doFiname.body.resumo).toEqual({
      universo: 2,
      aplicadas: 2,
      preservadas: 0,
      sobrescritas: 0,
    });
    const gravadas = await ctx.db.select().from(justificativaTable);
    expect(gravadas.filter((j) => j.entityLabel === "RPG0C44")).toHaveLength(3);
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
    /* A Velocidade Média tem coluna de justificar e não tem tabela por
       veículo: sem a caixa da linha não há como entrar no modo em lote. */
    const res = await post("/justificativas/lote", {
      changeSetId,
      escopo: recorte({ rubrica: "velocidade-media" }),
      ...JUSTIFICATIVA,
    });
    expect(res.status).toBe(400);
  });
});
