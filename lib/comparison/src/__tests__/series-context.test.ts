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
  type SeriesContext,
} from "../series";
import { chaveDeEscopoSql } from "@workspace/availability";
import {
  buildFixture,
  cnpjDe,
  contextoDaUnidade,
  type AttributeSpec,
} from "./fixtures";

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
const UNIDADE_A = "unidade-a";
const UNIDADE_B = "unidade-b";

/**
 * Os contextos das duas unidades, resolvidos depois que os fixtures entram.
 *
 * Antes bastava passar o nome — `{ scopeHash: UNIDADE_A }` — porque o fixture
 * o gravava em `snapshot.scope_hash` e `resolveContext` aceitava a coluna como
 * grafia legada. Com a `0022`, o nome é nome e a chave é chave.
 */
let CTX_A: SeriesContext;
let CTX_B: SeriesContext;

/**
 * O contexto de uma unidade, perguntado ao banco.
 *
 * Isto era `resolveContext(db, { scopeHash: <a semente do fixture> })`, e
 * funcionava porque o fixture gravava a semente em `snapshot.scope_hash` e
 * `resolveContext` a aceitava como grafia legada. Cada uso era, nas palavras do
 * comentário antigo, "uma prova a mais de que a compatibilidade funciona" — o
 * que descreve exatamente o problema: o teste exercitava a ponte, não a
 * identidade.
 *
 * A `0022` derrubou a coluna e a aceitação. Agora a pergunta é de negócio — de
 * que unidade é esta entrega — e quem responde é a autoridade.
 */
async function contextoDe(db: TestDb["db"], unidade: string, channel: string) {
  return contextoDaUnidade(db, unidade, channel);
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
    { entityType: "CARRETA", unidade: UNIDADE_A, canal: "EMPURRADA" },
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
    { entityType: "CARRETA", unidade: UNIDADE_B, canal: "EMPURRADA" },
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
    { entityType: "CARRETA", unidade: UNIDADE_A, canal: "ROTA" },
  );

  CTX_A = await contextoDaUnidade(ctx.db, UNIDADE_A, "EMPURRADA");
  CTX_B = await contextoDaUnidade(ctx.db, UNIDADE_B, "EMPURRADA");

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
      { entityType: "CARRETA", unidade: "sem-rotulo", canal: "TRANSFERENCIA" },
    );

    const contexto = await contextoDe(local.db, "sem-rotulo", "TRANSFERENCIA");
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
        { entityType: "CARRETA", unidade: "caixa", canal: "EMPURRADA" },
      );
    }

    // Quem identifica a unidade é o CNPJ que o fixture escreveu, e não uma
    // chave que o teste montou: é o mesmo caminho da tela.
    const contextos = (await listContexts(local.db)).filter((c) =>
      c.scopes.some((e) => e.code === cnpjDe("caixa")),
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
    /*
      A asserção nomeia quem é quem pelo **CNPJ**, e não pela chave.

      Antes ela lia `scopeHashesLegados` — a lista de grafias cruas — porque era
      o único jeito de dizer "este contexto é o da unidade A" sem reproduzir o
      hash no teste. O CNPJ faz o mesmo e é melhor: é o dado que o arquivo
      traz, o mesmo que a tela mostra, e não depende de nenhuma coluna que a
      identidade canônica já aposentou.
    */
    expect(
      contexts.map((c) => `${c.scopes.map((e) => e.code).join(",")}|${c.channel}`).sort(),
    ).toEqual(
      [
        `${cnpjDe(UNIDADE_A)}|EMPURRADA`,
        `${cnpjDe(UNIDADE_A)}|ROTA`,
        `${cnpjDe(UNIDADE_B)}|EMPURRADA`,
      ].sort(),
    );
  });

  it("cada uma vê só as suas vigências", async () => {
    const a = await listPeriods(ctx.db, await contextoDe(ctx.db, UNIDADE_A, "EMPURRADA"));
    const rota = await listPeriods(ctx.db, await contextoDe(ctx.db, UNIDADE_A, "ROTA"));
    expect(a.map((p) => p.effective_date)).toEqual(["2026-02-02", "2026-01-02"]);
    expect(rota.map((p) => p.effective_date)).toEqual(["2026-02-02"]);
  });

  it("o impacto de fevereiro é o da unidade pedida, nunca a soma das duas", async () => {
    const a = (await getGroupedView(ctx.db, "2026-02-02", CTX_A))!;
    const b = (await getGroupedView(ctx.db, "2026-02-02", CTX_B))!;

    expect(a.impact.byPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.impact.byPeriodicity).toEqual({ MENSAL: -1000 });
    // A soma das duas seria −800/mês: um número que nenhuma das unidades
    // reconheceria como seu, e que era o que a chave por data devolvia.
    expect(a.impact.byPeriodicity.MENSAL).not.toBe(-800);
    expect(b.impact.byPeriodicity.MENSAL).not.toBe(-800);
  });

  it("o consolidado também é por contexto", async () => {
    const a = (await getConsolidated(ctx.db, "2026-02-02", CTX_A))!;
    const b = (await getConsolidated(ctx.db, "2026-02-02", CTX_B))!;
    expect(a.impactByPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.impactByPeriodicity).toEqual({ MENSAL: -1000 });
    expect(a.totals.valueChanges).toBe(1);
    expect(b.totals.valueChanges).toBe(1);
  });

  it("a série de um atributo não junta as frotas das duas unidades", async () => {
    const a = (await getAttributeSeries(ctx.db, "carreta.custo_fixo", CTX_A))!;
    const fevereiro = a.points.find((p) => p.effectiveDate === "2026-02-02")!;
    // Um veículo, R$ 1.200 — e não dois veículos somando R$ 5.200, que faria a
    // média por veículo descrever um universo que não existe.
    expect(fevereiro.vehicles).toBe(1);
    expect(fevereiro.total).toBe(1200);
    expect(fevereiro.average).toBe(1200);
  });

  it("o acumulado é o da unidade, não o de todas", async () => {
    const a = await getAccumulatedImpact(ctx.db, CTX_A);
    const b = await getAccumulatedImpact(ctx.db, CTX_B);
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
      SELECT s.id::text, s.source_label
        FROM snapshot s
       WHERE ${chaveDeEscopoSql("s")} = ${(await contextoDe(ctx.db, UNIDADE_A, "EMPURRADA")).scopeHash}
    `);
    const rota = rows.find((r) => r.source_label === "ROTA_2_2_2026")!;
    const empurradaFev = rows.find((r) => r.source_label === "EMPURRADA_2_2_2026")!;
    const empurradaJan = rows.find((r) => r.source_label === "EMPURRADA_2_1_2026")!;

    // ROTA é a primeira do seu canal: não há anterior, e inventar uma seria
    // declarar alterada uma frota que ninguém alterou.
    const daRota = await findPreviousSnapshot(ctx.db, rota.id);
    expect(daRota.encontrada).toBe(false);
    if (!daRota.encontrada) expect(daRota.motivo).toBe("PRIMEIRA_DA_SERIE");

    // E o canal EMPURRADA continua encadeado normalmente.
    const daEmpurrada = await findPreviousSnapshot(ctx.db, empurradaFev.id);
    expect(daEmpurrada.encontrada).toBe(true);
    if (daEmpurrada.encontrada) {
      expect(daEmpurrada.vigencia.snapshotId).toBe(empurradaJan.id);
    }
  });

  it("comparar canais diferentes é recusado por escrito", async () => {
    const { rows } = await ctx.db.execute<{ id: string; source_label: string }>(sql`
      SELECT s.id::text, s.source_label
        FROM snapshot s
       WHERE ${chaveDeEscopoSql("s")} = ${(await contextoDe(ctx.db, UNIDADE_A, "EMPURRADA")).scopeHash}
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
