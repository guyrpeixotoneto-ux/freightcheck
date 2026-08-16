import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet, findPreviousSnapshot } from "../engine";
import { computeMissingChangeSets, getConsolidated, listPeriods } from "../consolidated";
import { getAccumulatedImpact, getAttributeSeries, getGroupedView } from "../grouped";
import {
  ContextNotFoundError,
  listContexts,
  resolveContext,
} from "../series";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * O contexto de uma leitura: unidade e canal.
 *
 * Este arquivo existe por causa de dois defeitos que só apareceriam no dia da
 * primeira importação de uma segunda unidade — tarde demais, e num número já
 * publicado:
 *
 * 1. **Períodos chaveados só por data.** Duas unidades entregando agosto viravam
 *    um período só, e o cartão da tela somava as duas frotas sem dizer que
 *    somou.
 * 2. **Séries chaveadas sem canal.** Com o parser de vigência aceitando outros
 *    canais, a primeira vigência do canal ROTA tomaria a última do canal
 *    EMPURRADA como sua anterior — mesma unidade, mesma cobertura, remuneração
 *    diferente — e toda a frota apareceria alterada.
 *
 * Os dois são testados aqui com dado sintético, porque a base real tem uma
 * unidade e um canal e portanto não pode exercitá-los.
 */

let ctx: TestDb;

/** Duas unidades distintas, com placas próprias para não disputarem identidade. */
const UNIDADE_A = "scope-unidade-a";
const UNIDADE_B = "scope-unidade-b";

/**
 * O contexto, resolvido a partir do `scope_hash` que o fixture gravou.
 *
 * Os fixtures escrevem `snapshot.scope_hash` com o valor literal que recebem, e
 * desde o PR-7 o identificador de contexto é o hash do **escopo canônico** —
 * outro valor. Passar pelo `resolveContext` é o que traduz um no outro, e não é
 * concessão: é exatamente o caminho que um link colado antes da mudança
 * percorre. Cada uso aqui é uma prova a mais de que a compatibilidade funciona.
 */
async function contextoDe(db: TestDb["db"], scopeHash: string, channel: string) {
  return (await resolveContext(db, { scopeHash, channel }))!;
}

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

beforeAll(async () => {
  ctx = await createTestDatabase("series_context");
  await seedTaxonomy(ctx.db, "test");

  // Unidade A, canal EMPURRADA: 1000 -> 1200 (+200/mês).
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_1_2026",
        effectiveDate: "2026-01-02",
        data: { AAA1A11: { "carreta.custo_fixo": 1000 } },
      },
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: "2026-02-02",
        data: { AAA1A11: { "carreta.custo_fixo": 1200 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_A, canal: "EMPURRADA" },
  );

  // Unidade B, mesmo canal, **mesmas datas**: 5000 -> 4000 (−1000/mês).
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_1_2026",
        effectiveDate: "2026-01-02",
        data: { BBB2B22: { "carreta.custo_fixo": 5000 } },
      },
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: "2026-02-02",
        data: { BBB2B22: { "carreta.custo_fixo": 4000 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_B, canal: "EMPURRADA" },
  );

  // Unidade A de novo, agora no canal ROTA, na mesma data de fevereiro.
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "ROTA_2_2_2026",
        effectiveDate: "2026-02-02",
        data: { CCC3C33: { "carreta.custo_fixo": 7000 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_A, canal: "ROTA" },
  );

  await computeMissingChangeSets(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

/**
 * O canal tem **uma** autoridade: a coluna `snapshot.canal`.
 *
 * Este bloco substitui o que existia aqui, e a substituição é a correção. O
 * teste antigo provava que duas derivações do canal — a do TypeScript na
 * ingestão e a de uma expressão regular no SQL da leitura — davam o mesmo
 * resultado. Ele passava, e não bastava: as duas derivações eram aplicadas a
 * *entradas* diferentes. A da leitura corria sobre o rótulo como ele veio
 * escrito; a da escrita normalizava antes de gravar. Para `Transferencia_1_6_2026`
 * a coluna guarda `TRANSFERENCIA` e o regex devolvia `Transferencia`, e o mesmo
 * canal virava dois contextos.
 *
 * A prova certa não é que as duas concordam: é que só existe uma. O que se
 * afirma agora é que a leitura devolve o que está gravado, **inclusive quando o
 * rótulo não permitiria derivá-lo** — que é o caso em que a derivação antiga
 * respondia NULL e juntava numa partição só vigências de canais diferentes.
 */
describe("o canal vem da coluna, e de mais lugar nenhum", () => {
  /*
    Banco próprio, e não o compartilhado do arquivo.

    Os fixtures daqui acrescentam contextos, e o bloco seguinte conta contextos
    do banco inteiro. Enfraquecer aquelas asserções para caber estas seria
    trocar cobertura por conveniência — quem chegou depois paga o isolamento.
  */
  let local: TestDb;

  beforeAll(async () => {
    local = await createTestDatabase("series_canal_coluna");
    await seedTaxonomy(local.db, "test");
  }, 180_000);

  afterAll(async () => {
    await local?.drop().catch(() => {});
  });

  it("a leitura devolve o canal gravado mesmo com rótulo que não o declara", async () => {
    await buildFixture(
      local.db,
      CUSTO,
      [
        {
          label: "planilha-sem-forma-de-rotulo",
          effectiveDate: "2026-05-02",
          data: { DDD4D44: { "carreta.custo_fixo": 900 } },
        },
      ],
      { entityType: "CARRETA", scopeHash: "scope-sem-rotulo", canal: "TRANSFERENCIA" },
    );

    const contexto = await contextoDe(local.db, "scope-sem-rotulo", "TRANSFERENCIA");
    // A derivação por rótulo daria NULL aqui. A coluna diz TRANSFERENCIA.
    expect(contexto.channel).toBe("TRANSFERENCIA");

    const periodos = await listPeriods(local.db, contexto);
    expect(periodos.map((p) => p.effective_date)).toEqual(["2026-05-02"]);
  });

  it("dois rótulos escritos em caixas diferentes ficam no mesmo canal", async () => {
    // O caso medido na auditoria: `EMPURRADA_…` e `Empurrada_…` são o mesmo
    // canal, e a normalização da importação já os unifica na coluna. Pela
    // derivação antiga eles davam `EMPURRADA` e `Empurrada` — dois contextos,
    // e o Impacto abrindo com metade do histórico sem dizer que havia mais.
    for (const [i, label] of ["EMPURRADA_1_6_2026", "Empurrada_1_7_2026"].entries()) {
      await buildFixture(
        local.db,
        CUSTO,
        [
          {
            label,
            effectiveDate: `2026-0${6 + i}-01`,
            data: { [`EEE${i}E${i}${i}`]: { "carreta.custo_fixo": 800 + i } },
          },
        ],
        { entityType: "CARRETA", scopeHash: "scope-caixa", canal: "EMPURRADA" },
      );
    }

    const contextos = (await listContexts(local.db)).filter((c) =>
      c.scopeHashesLegados.includes("scope-caixa"),
    );
    expect(contextos).toHaveLength(1);
    expect(contextos[0].periods).toBe(2);
  });
});

describe("duas unidades na mesma data", () => {
  it("são dois contextos, não um período compartilhado", async () => {
    const contexts = await listContexts(ctx.db);
    // Unidade A tem dois canais; unidade B tem um.
    expect(contexts).toHaveLength(3);
    // O identificador é o hash do escopo canônico; o `scope_hash` que o fixture
    // gravou fica ao lado, como legado, e é por ele que a asserção nomeia quem
    // é quem sem depender de reproduzir o hash aqui.
    expect(
      contexts.map((c) => `${c.scopeHashesLegados.join(",")}|${c.channel}`).sort(),
    ).toEqual([
      `${UNIDADE_A}|EMPURRADA`,
      `${UNIDADE_A}|ROTA`,
      `${UNIDADE_B}|EMPURRADA`,
    ]);
  });

  it("cada uma vê só as suas vigências", async () => {
    const a = await listPeriods(ctx.db, await contextoDe(ctx.db, UNIDADE_A, "EMPURRADA"));
    const rota = await listPeriods(ctx.db, await contextoDe(ctx.db, UNIDADE_A, "ROTA"));
    expect(a.map((p) => p.effective_date)).toEqual(["2026-02-02", "2026-01-02"]);
    expect(rota.map((p) => p.effective_date)).toEqual(["2026-02-02"]);
  });

  it("o impacto de fevereiro é o da unidade pedida, nunca a soma das duas", async () => {
    const a = (await getGroupedView(ctx.db, "2026-02-02", {
      scopeHash: UNIDADE_A,
      channel: "EMPURRADA",
    }))!;
    const b = (await getGroupedView(ctx.db, "2026-02-02", {
      scopeHash: UNIDADE_B,
      channel: "EMPURRADA",
    }))!;

    expect(a.impact.byPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.impact.byPeriodicity).toEqual({ MENSAL: -1000 });
    // A soma das duas seria −800/mês: um número que nenhuma das unidades
    // reconheceria como seu, e que era o que a chave por data devolvia.
    expect(a.impact.byPeriodicity.MENSAL).not.toBe(-800);
    expect(b.impact.byPeriodicity.MENSAL).not.toBe(-800);
  });

  it("o consolidado também é por contexto", async () => {
    const a = (await getConsolidated(ctx.db, "2026-02-02", { scopeHash: UNIDADE_A, channel: "EMPURRADA" }))!;
    const b = (await getConsolidated(ctx.db, "2026-02-02", { scopeHash: UNIDADE_B, channel: "EMPURRADA" }))!;
    expect(a.impactByPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.impactByPeriodicity).toEqual({ MENSAL: -1000 });
    expect(a.totals.valueChanges).toBe(1);
    expect(b.totals.valueChanges).toBe(1);
  });

  it("a série de um atributo não junta as frotas das duas unidades", async () => {
    const a = (await getAttributeSeries(ctx.db, "carreta.custo_fixo", {
      scopeHash: UNIDADE_A,
      channel: "EMPURRADA",
    }))!;
    const fevereiro = a.points.find((p) => p.effectiveDate === "2026-02-02")!;
    // Um veículo, R$ 1.200 — e não dois veículos somando R$ 5.200, que faria a
    // média por veículo descrever um universo que não existe.
    expect(fevereiro.vehicles).toBe(1);
    expect(fevereiro.total).toBe(1200);
    expect(fevereiro.average).toBe(1200);
  });

  it("o acumulado é o da unidade, não o de todas", async () => {
    const a = await getAccumulatedImpact(ctx.db, { scopeHash: UNIDADE_A, channel: "EMPURRADA" });
    const b = await getAccumulatedImpact(ctx.db, { scopeHash: UNIDADE_B, channel: "EMPURRADA" });
    expect(a.byPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.byPeriodicity).toEqual({ MENSAL: -1000 });
    expect(a.comparisons).toBe(1);
    expect(b.comparisons).toBe(1);
  });

  it("diz qual contexto escolheu quando ninguém escolheu", async () => {
    const view = (await getGroupedView(ctx.db))!;
    expect(view.context.scopeHash).toBeDefined();
    // E nomeia os outros, para que a escolha padrão não seja uma omissão.
    expect(view.otherContexts).toHaveLength(2);
    expect(
      view.otherContexts.every(
        (c) => !(c.scopeHash === view.context.scopeHash && c.channel === view.context.channel),
      ),
    ).toBe(true);
  });
});

describe("dois canais na mesma unidade", () => {
  it("a vigência de um canal não tem a do outro como anterior", async () => {
    const { rows } = await ctx.db.execute<{ id: string; source_label: string }>(sql`
      SELECT id::text, source_label FROM snapshot WHERE scope_hash = ${UNIDADE_A}
    `);
    const rota = rows.find((r) => r.source_label === "ROTA_2_2_2026")!;
    const empurradaFev = rows.find((r) => r.source_label === "EMPURRADA_2_2_2026")!;
    const empurradaJan = rows.find((r) => r.source_label === "EMPURRADA_2_1_2026")!;

    // ROTA é a primeira do seu canal: não há anterior, e inventar uma seria
    // declarar alterada uma frota que ninguém alterou.
    expect(await findPreviousSnapshot(ctx.db, rota.id)).toBeNull();
    // E o canal EMPURRADA continua encadeado normalmente.
    expect(await findPreviousSnapshot(ctx.db, empurradaFev.id)).toBe(empurradaJan.id);
  });

  it("comparar canais diferentes é recusado por escrito", async () => {
    const { rows } = await ctx.db.execute<{ id: string; source_label: string }>(sql`
      SELECT id::text, source_label FROM snapshot WHERE scope_hash = ${UNIDADE_A}
    `);
    const rota = rows.find((r) => r.source_label === "ROTA_2_2_2026")!;
    const empurrada = rows.find((r) => r.source_label === "EMPURRADA_2_2_2026")!;

    await expect(computeChangeSet(ctx.db, empurrada.id, rota.id)).rejects.toThrow(
      /Canais diferentes/,
    );
  });

  it("o backfill não pareia vigências de canais diferentes", async () => {
    // Rodar de novo é idempotente e, sobretudo, não descobre um par novo entre
    // ROTA e EMPURRADA que a primeira execução tivesse deixado passar.
    const result = await computeMissingChangeSets(ctx.db, "test");
    expect(result.computed).toBe(0);
    // Três séries: A/EMPURRADA, A/ROTA e B/EMPURRADA.
    expect(result.series).toBe(3);
    // E duas comparações no total — a de ROTA não existe, por não ter anterior.
    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM change_set`,
    );
    expect(rows[0].n).toBe(2);
  });
});

describe("contexto pedido que não existe", () => {
  it("é recusa escrita, não uma resposta vazia", async () => {
    await expect(
      resolveContext(ctx.db, { scopeHash: "unidade-que-nao-existe" }),
    ).rejects.toBeInstanceOf(ContextNotFoundError);

    await expect(
      resolveContext(ctx.db, { scopeHash: "unidade-que-nao-existe" }),
    ).rejects.toThrow(/Disponíveis:/);
  });
});
