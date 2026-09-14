import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { sql } from "drizzle-orm";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { setImportRunHidden } from "@workspace/ingest";
import { seedTaxonomy } from "@workspace/curation";
import { encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * **A procedência de um recorte não pode vazar, e não pode calar.**
 *
 * `GET /balance` responde "os arquivos fecham?" sobre o acervo inteiro, e é
 * global por contrato. `GET /balance/recorte` responde a pergunta inversa —
 * "qual a qualidade das fontes que alimentam o que está na tela?" — e por isso
 * é a primeira rota de **leitura** deste servidor a exigir ambiente e a derivar
 * a operação dele.
 *
 * Os casos aqui guardam duas coisas que são fáceis de confundir e caras de
 * errar:
 *
 * 1. **vazamento** — um recorte de uma auditoria nunca alcança o acervo de
 *    outra, e a recusa não conta que o outro existe;
 * 2. **silêncio** — recusa de acesso, acervo inexistente e recorte sem
 *    importação são três respostas diferentes, e **nenhuma** delas é `200` com
 *    lista vazia, exceto a terceira, que é a única lista vazia legítima.
 *
 * O banco é deliberadamente misturado: a mesma unidade (`scope_hash`), duas
 * operações, e um contexto sem canal legível no rótulo para provar a diferença
 * entre `?canal=` ausente e `?canal=` vazio.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

/** A unidade — uma só para as duas operações. É o caso difícil, não o fácil. */
const UNIDADE = "scope-balance-recorte";

const CUSTO: AttributeSpec[] = [
  {
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const JANEIRO = "2026-01-02";
const FEVEREIRO = "2026-02-02";
/** A data do contexto sem canal — anterior, para não virar o padrão do seletor. */
const DEZEMBRO = "2025-12-02";
/** A vigência viva que não tem fato nenhum — a única lista vazia legítima. */
const MAIO = "2026-05-02";
const UNIDADE_SEM_FATO = "scope-balance-sem-fato";

/** Quem pergunta. A conta existe porque a permissão tem chave estrangeira. */
let usuario = "";
/** Uma conta sem acesso ao ambiente da Empurrada. */
let semAcesso = "";
/** De quem é a sessão desta requisição — trocado caso a caso. */
let sessao = "";

interface Resposta {
  status: number;
  body: any;
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** O JSON inteiro como texto — para procurar o que não pode estar lá. */
const texto = (corpo: unknown) => JSON.stringify(corpo);

beforeAll(async () => {
  ctx = await createTestDatabase("api_balance_recorte");
  process.env.DATABASE_URL = ctx.url;
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_1_2026",
        effectiveDate: JANEIRO,
        data: { EMP1A11: { "carreta.custo_fixo": 1000 } },
      },
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: FEVEREIRO,
        data: { EMP1A11: { "carreta.custo_fixo": 1200 } },
      },
    ],
    { scopeHash: UNIDADE, canal: "EMPURRADA" },
  );

  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "ROTA_2_1_2026",
        effectiveDate: JANEIRO,
        data: { ROT2B22: { "carreta.custo_fixo": 5000 } },
      },
      {
        label: "ROTA_2_2_2026",
        effectiveDate: FEVEREIRO,
        data: { ROT2B22: { "carreta.custo_fixo": 4000 } },
      },
    ],
    { scopeHash: UNIDADE, canal: "ROTA" },
  );

  /*
    O contexto sem canal legível: o rótulo não casa com `CHANNEL_PATTERN`, então
    `channelSql` devolve NULL e ele é uma partição própria — a mesma unidade e a
    mesma operação, com `channel` nulo. É o que permite provar que `?canal=`
    ausente e `?canal=` vazio são pedidos diferentes.
  */
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "AVULSO",
        effectiveDate: DEZEMBRO,
        data: { EMP1A11: { "carreta.custo_fixo": 900 } },
      },
    ],
    { scopeHash: UNIDADE, canal: "EMPURRADA" },
  );

  /*
    Uma vigência viva **sem fato**: o contexto existe, a competência existe, e não
    há fonte a conferir. É o estado que distingue "não há o que conferir" de "este
    recorte não existe", e sem ele os dois responderiam a mesma coisa à tela.
  */
  await buildFixture(
    ctx.db,
    CUSTO,
    [{ label: "EMPURRADA_2_5_2026", effectiveDate: MAIO, data: {} }],
    { scopeHash: UNIDADE_SEM_FATO, canal: "EMPURRADA" },
  );

  const criarConta = async (email: string): Promise<string> => {
    const { rows } = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO app_user (email, name, password_hash)
      VALUES (${email}, ${email}, 'x') RETURNING id::text AS id
    `);
    return rows[0]!.id;
  };

  usuario = await criarConta("com-acesso@teste");
  semAcesso = await criarConta("sem-acesso@teste");
  sessao = usuario;

  /* A ausência de linha concede; quem não pode é quem tem a linha que tira. */
  await ctx.db.execute(sql`
    INSERT INTO permissao_de_modulo (user_id, modulo, nivel, definido_por)
    VALUES (${semAcesso}::uuid, '@auditoria', 'SEM_ACESSO', 'teste')
  `);

  const { default: balanceRouter } = await import("../balance");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    /*
      A sessão do teste. `req.user` é a conta **visualizada** em produção — num
      "visualizar como" é por ela que menu e permissões respondem —, e é por isso
      que a rota a lê em vez de `donoDaSessao`: o caso da visualização é provado
      abaixo pondo as duas em contas diferentes.
    */
    (req as unknown as { user: unknown }).user = { id: sessao };
    (req as unknown as { donoDaSessao: unknown }).donoDaSessao = { id: usuario };
    next();
  });
  app.use(balanceRouter);
  app.use(erroEmJson);

  await new Promise<void>((resolve) => {
    servidor = app.listen(0, () => {
      const endereco = servidor.address();
      base = `http://127.0.0.1:${typeof endereco === "object" && endereco ? endereco.port : 0}`;
      resolve();
    });
  });
}, 300_000);

afterAll(async () => {
  sessao = usuario;
  await new Promise<void>((resolve) => servidor?.close(() => resolve()));
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

// ---------------------------------------------------------------------------
// A forma do pedido — 400, antes de qualquer contexto
// ---------------------------------------------------------------------------

describe("o par ambiente + operação", () => {
  it("recusa o ambiente de uma operação com a operação de outra", async () => {
    const r = await get("/balance/recorte?ambiente=auditoria&operacao=ROTA");

    expect(r.status).toBe(400);
    expect(r.body.code).toBe("PAR_INCOMPATIVEL");
    /*
      A recusa não conta que existe acervo do outro lado: nem o rótulo da
      unidade, nem a operação do ambiente, nem contagem nenhuma.
    */
    expect(texto(r.body)).not.toContain(UNIDADE);
    expect(texto(r.body)).not.toContain("EMPURRADA");
  });

  it("recusa ambiente ausente e ambiente desconhecido, com códigos diferentes", async () => {
    const ausente = await get("/balance/recorte?operacao=EMPURRADA");
    const desconhecido = await get("/balance/recorte?ambiente=auditoria-marte&operacao=EMPURRADA");

    expect(ausente.status).toBe(400);
    expect(ausente.body.code).toBe("AMBIENTE_AUSENTE");
    expect(desconhecido.status).toBe(400);
    expect(desconhecido.body.code).toBe("AMBIENTE_INVALIDO");
  });

  it("recusa ambiente de fechamento — o eixo de operação dele é outro", async () => {
    const r = await get("/balance/recorte?ambiente=fechamento-rota&operacao=ROTA");

    expect(r.status).toBe(400);
    expect(r.body.code).toBe("AMBIENTE_INVALIDO");
    expect(r.body.error).toMatch(/Fechamento/);
  });

  it("recusa operação ausente e operação ilegível, com códigos diferentes", async () => {
    const ausente = await get("/balance/recorte?ambiente=auditoria");
    const ilegivel = await get("/balance/recorte?ambiente=auditoria&operacao=---");

    expect(ausente.status).toBe(400);
    expect(ausente.body.code).toBe("OPERACAO_AUSENTE");
    expect(ilegivel.status).toBe(400);
    expect(ilegivel.body.code).toBe("OPERACAO_INVALIDA");
  });
});

// ---------------------------------------------------------------------------
// A pessoa — 403, e nunca uma lista vazia
// ---------------------------------------------------------------------------

describe("o acesso ao ambiente", () => {
  it("recusa quem não trabalha no ambiente — com 403, e não com lista vazia", async () => {
    sessao = semAcesso;
    try {
      const r = await get(
        `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}`,
      );

      expect(r.status).toBe(403);
      expect(r.body.code).toBe("SEM_ACESSO_AO_AMBIENTE");
      /* O corpo da recusa não é uma resposta: não tem importações nem contagem. */
      expect(r.body.importacoes).toBeUndefined();
      expect(r.body.atribuido).toBeUndefined();
    } finally {
      sessao = usuario;
    }
  });

  it("segue a conta visualizada, e não o dono da sessão", async () => {
    /*
      Num "visualizar como", `req.user` é a conta visualizada e `donoDaSessao` é
      quem digitou a senha. Ver o produto pelos olhos de alguém é exatamente o
      que se foi fazer: a leitura tem de recusar o que **aquela** conta não pode,
      ainda que o dono da sessão possa.
    */
    sessao = semAcesso;
    try {
      const r = await get(
        `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}`,
      );
      expect(r.status).toBe(403);
    } finally {
      sessao = usuario;
    }
  });

  it("aceita VISUALIZAR — o nível separa leitura de escrita", async () => {
    await ctx.db.execute(sql`
      UPDATE permissao_de_modulo SET nivel = 'VISUALIZAR'
       WHERE user_id = ${semAcesso}::uuid AND modulo = '@auditoria'
    `);
    sessao = semAcesso;
    try {
      const r = await get(
        `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}`,
      );
      expect(r.status).toBe(200);
    } finally {
      sessao = usuario;
      await ctx.db.execute(sql`
        UPDATE permissao_de_modulo SET nivel = 'SEM_ACESSO'
         WHERE user_id = ${semAcesso}::uuid AND modulo = '@auditoria'
      `);
    }
  });
});

// ---------------------------------------------------------------------------
// O acervo — 404 e 400, e o que a recusa não pode dizer
// ---------------------------------------------------------------------------

describe("o recorte", () => {
  it("responde a procedência da unidade, em contagens e sem percentual", async () => {
    const r = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}&canal=EMPURRADA&period=${FEVEREIRO}`,
    );

    expect(r.status).toBe(200);
    expect(r.body.recorte.operacao).toBe("EMPURRADA");
    expect(r.body.recorte.period).toBe(FEVEREIRO);
    expect(r.body.importacoes.length).toBeGreaterThan(0);
    expect(r.body.atribuido.vigenciasVivas).toBe(1);
    expect(r.body.atribuido.celulasEmFato).toBeGreaterThanOrEqual(0);

    /*
      **Nenhum percentual, em lugar nenhum.** Cobertura auditada recortada não é
      grandeza bem definida: o resíduo nunca virou fato, logo não tem unidade a
      que pertencer. Um percentual no corpo convidaria a tela a publicá-lo.
    */
    expect(texto(r.body)).not.toMatch(/percentual/i);
    expect(r.body.conservacao.celulasDosArquivos).toBeDefined();
    expect(r.body.conservacao).not.toHaveProperty("celulas");
  });

  it("mede o alcance de cada arquivo, e nunca afirma exclusividade sem medir", async () => {
    /*
      O alcance vem de `alcanceDosRuns`, sobre os runs que `runsDeProveniencia`
      devolveu — e aqueles vêm de `fact.origin_import_run_id`. Numa revisão
      parcial o run de origem pode não ter vigência viva nenhuma, e a primeira
      versão desta rota inventava `contextos: 1` para ele: chamava de exclusivo um
      arquivo que ninguém tinha medido, e punha a ressalva da tela em silêncio
      justamente no caso em que ela é necessária.
    */
    const r = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}&canal=EMPURRADA&period=${FEVEREIRO}`,
    );

    expect(r.status).toBe(200);
    for (const i of r.body.importacoes) {
      expect(i.alcance.medido).toBe(true);
      expect(i.alcance.vigencias.length).toBeGreaterThan(0);
      /* Medido e exclusivo são coisas diferentes, e a segunda exige a primeira. */
      if (i.alcance.exclusivoDesteRecorte) expect(i.alcance.medido).toBe(true);
    }
    /* A exclusividade do conjunto nunca é mais forte que a de cada arquivo. */
    expect(r.body.conservacao.exclusivaDesteRecorte).toBe(
      r.body.importacoes.every(
        (i: { alcance: { medido: boolean; exclusivoDesteRecorte: boolean } }) =>
          i.alcance.medido && i.alcance.exclusivoDesteRecorte,
      ),
    );
  });

  it("não alcança o acervo da outra operação, e não conta que ele existe", async () => {
    /* A unidade é a mesma; o que muda é a operação do ambiente. */
    const empurrada = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}&canal=EMPURRADA`,
    );
    const rota = await get(
      `/balance/recorte?ambiente=auditoria-rota&operacao=ROTA&scopeHash=${UNIDADE}&canal=ROTA`,
    );

    expect(empurrada.status).toBe(200);
    expect(rota.status).toBe(200);

    /* Nenhuma importação em comum: os dois acervos não se tocam. */
    const idsDe = (r: Resposta) =>
      new Set<string>(r.body.importacoes.map((i: { importRunId: string }) => i.importRunId));
    const comuns = [...idsDe(empurrada)].filter((id) => idsDe(rota).has(id));
    expect(comuns).toEqual([]);
  });

  it("um canal da outra operação não acha contexto — 404, e muda sobre o alheio", async () => {
    const r = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}&canal=ROTA`,
    );

    expect(r.status).toBe(404);
    expect(texto(r.body)).not.toContain("ROTA_2_2_2026");
  });

  it("uma competência que não é deste recorte é 400, e não a mais próxima", async () => {
    const r = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}&canal=EMPURRADA&period=2026-07-02`,
    );

    expect(r.status).toBe(400);
    expect(r.body.code).toBe("PERIODO_FORA_DO_RECORTE");
  });

  it("canal ausente escolhe o contexto padrão; canal vazio é a partição sem canal", async () => {
    const ausente = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}`,
    );
    const vazio = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}&canal=`,
    );

    expect(ausente.status).toBe(200);
    expect(ausente.body.recorte.canal).toBe("EMPURRADA");

    expect(vazio.status).toBe(200);
    /* `canal=` não é "sem filtro": é a partição real dos rótulos sem canal. */
    expect(vazio.body.recorte.canal).toBeNull();
    expect(vazio.body.recorte.period).toBe(DEZEMBRO);
  });
});

// ---------------------------------------------------------------------------
// A única lista vazia legítima
// ---------------------------------------------------------------------------

describe("o recorte sem fonte a conferir", () => {
  it("responde 200 com lista vazia — a única lista vazia legítima", async () => {
    /*
      200, e não 404: o recorte existe e é legítimo — o que não existe é
      importação a conferir. Responder 404 aqui diria que a unidade não está no
      acervo, que é um fato diferente e manda procurar noutro lugar; responder
      403 acusaria a pessoa de algo que não houve.
    */
    const r = await get(
      `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE_SEM_FATO}&canal=EMPURRADA&period=${MAIO}`,
    );

    expect(r.status).toBe(200);
    expect(r.body.importacoes).toEqual([]);
    expect(r.body.conservacao.arquivos).toBe(0);
    expect(r.body.conservacao.celulasDosArquivos).toBe(0);
    expect(r.body.atribuido.celulasEmFato).toBe(0);
    expect(r.body.ultima).toBeNull();
    /* E a vigência continua lá: é dela que a tela fala. */
    expect(r.body.atribuido.vigenciasVivas).toBe(1);
  });

  it("ocultar a única fonte de um contexto tira o contexto do acervo — 404, e é o contrato de hidden_at", async () => {
    /*
      `hidden_at` tira o run "e todos os fatos de todas as suas vigências de todo
      agregado". A consequência alcança `listContexts`, que não lista vigência de
      run oculto: o contexto deixa de existir para quem pergunta, e a resposta
      certa passa a ser 404 — não 200 com lista vazia, que diria que a unidade
      está no acervo sem fonte, quando ela saiu do acervo.
    */
    const { rows } = await ctx.db.execute<{ id: string }>(sql`
      SELECT DISTINCT f.origin_import_run_id::text AS id
        FROM fact f
        JOIN snapshot s ON s.id = f.snapshot_id
       WHERE s.source_label = 'AVULSO'
    `);
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      await setImportRunHidden(ctx.db, r.id, true, { by: "teste", reason: "teste" });
    }

    try {
      const r = await get(
        `/balance/recorte?ambiente=auditoria&operacao=EMPURRADA&scopeHash=${UNIDADE}&canal=&period=${DEZEMBRO}`,
      );
      expect(r.status).toBe(404);
    } finally {
      for (const r of rows) {
        await setImportRunHidden(ctx.db, r.id, false, { by: "teste" });
      }
    }
  });
});
