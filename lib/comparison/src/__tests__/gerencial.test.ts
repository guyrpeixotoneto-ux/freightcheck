import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet } from "../engine";
import { listarVigenciasDaAuditoria, type VigenciaDaAuditoria } from "../gerencial";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * A leitura da Visão Gerencial da Auditoria.
 *
 * A tela que lê daqui é uma home: responde antes de alguém escolher qualquer
 * coisa, e um número errado nela será lido primeiro, por quem tem menos
 * contexto. O que este arquivo prende são as três afirmações de que a tela
 * depende e que só o banco pode provar:
 *
 * 1. **A comparação de uma vigência é a canônica** — contra a imediatamente
 *    anterior da mesma série. A tela Comparar grava pares arbitrários na mesma
 *    tabela, e apanhá-los por `snapshot_b_id` somaria dois meses de movimento
 *    ao total de um.
 * 2. **Ler não calcula.** Abrir a tela não pode disparar o motor: é isso que
 *    faz a vigência nunca comparada aparecer como buraco em vez de ser tapada
 *    em silêncio.
 * 3. **A série respeita o canal.** Duas vigências da mesma unidade em canais
 *    diferentes não se sucedem, e a primeira de cada canal não tem anterior.
 */

let ctx: TestDb;

const UNIDADE_A = "scope-gerencial-a";
const UNIDADE_B = "scope-gerencial-b";

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

let ids: Record<string, string> = {};

beforeAll(async () => {
  ctx = await createTestDatabase("gerencial");
  await seedTaxonomy(ctx.db, "test");

  // Unidade A, canal EMPURRADA: três vigências seguidas.
  const a = await buildFixture(
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
      {
        label: "EMPURRADA_2_3_2026",
        effectiveDate: "2026-03-02",
        data: { AAA1A11: { "carreta.custo_fixo": 1500 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_A },
  );

  // A mesma unidade noutro canal, na mesma data de março: outra série.
  const rota = await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "ROTA_2_3_2026",
        effectiveDate: "2026-03-02",
        data: { CCC3C33: { "carreta.custo_fixo": 7000 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_A },
  );

  // Unidade B, duas vigências de cavalo.
  const b = await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: "2026-02-02",
        data: { BBB2B22: { "carreta.custo_fixo": 5000 } },
      },
      {
        label: "EMPURRADA_2_3_2026",
        effectiveDate: "2026-03-02",
        data: { BBB2B22: { "carreta.custo_fixo": 4000 } },
      },
    ],
    { entityType: "CAVALO", scopeHash: UNIDADE_B },
  );

  ids = {
    aJan: a.snapshotIds.EMPURRADA_2_1_2026,
    aFev: a.snapshotIds.EMPURRADA_2_2_2026,
    aMar: a.snapshotIds.EMPURRADA_2_3_2026,
    rotaMar: rota.snapshotIds.ROTA_2_3_2026,
    bFev: b.snapshotIds.EMPURRADA_2_2_2026,
    bMar: b.snapshotIds.EMPURRADA_2_3_2026,
  };

  /*
    Só duas transições canônicas são calculadas. Março da unidade A fica de
    fora **de propósito**: é a vigência que chegou e ninguém comparou, e é o
    caso que a tela existe para mostrar.
  */
  await computeChangeSet(ctx.db, ids.aJan, ids.aFev, { computedBy: "test" });
  await computeChangeSet(ctx.db, ids.bFev, ids.bMar, { computedBy: "test" });

  /*
    E uma comparação avulsa, como a tela Comparar grava: janeiro contra março,
    pulando fevereiro. Ela existe na mesma tabela e tem `snapshot_b` = março.
  */
  await computeChangeSet(ctx.db, ids.aJan, ids.aMar, { computedBy: "test:comparar" });
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

const de = (linhas: VigenciaDaAuditoria[], snapshotId: string): VigenciaDaAuditoria =>
  linhas.find((l) => l.snapshotId === snapshotId)!;

describe("a leitura gerencial da auditoria", () => {
  it("devolve uma linha por vigência viva, da mais recente para a mais antiga", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);

    expect(linhas).toHaveLength(6);
    expect(linhas.map((l) => l.effectiveDate)).toEqual([
      "2026-03-02",
      "2026-03-02",
      "2026-03-02",
      "2026-02-02",
      "2026-02-02",
      "2026-01-02",
    ]);
  });

  it("anexa a comparação canônica de cada vigência", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);
    const fevereiro = de(linhas, ids.aFev);

    expect(fevereiro.anterior?.snapshotId).toBe(ids.aJan);
    expect(fevereiro.comparacao).toMatchObject({ status: "DONE", alteracoes: 1 });
    // 1000 → 1200 é +200/mês, e é o oficial que a tela publica.
    expect(fevereiro.comparacao?.impacto).toEqual({ MENSAL: 200 });
  });

  /*
    O defeito que este caso guarda tem nome e endereço: um `change_set` de
    janeiro contra março existe, e apanhá-lo por `snapshot_b_id` faria a tela
    creditar a março duas transições de movimento — e, pior, dar por auditada
    uma vigência que ninguém comparou com a anterior.
  */
  it("ignora a comparação avulsa que a tela Comparar gravou", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);
    const marco = de(linhas, ids.aMar);

    expect(marco.anterior?.snapshotId).toBe(ids.aFev);
    expect(marco.comparacao).toBeNull();
  });

  it("marca como sem anterior a primeira vigência de cada série", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);

    expect(de(linhas, ids.aJan).anterior).toBeNull();
    expect(de(linhas, ids.aJan).comparacao).toBeNull();
    // Mesma unidade, outro canal, mesma data de março: série própria, e a
    // vigência de fevereiro do canal EMPURRADA não é anterior dela.
    expect(de(linhas, ids.rotaMar).anterior).toBeNull();
  });

  it("separa os contextos por unidade e canal, com o rótulo do seletor", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);

    expect(de(linhas, ids.aMar).contexto.channel).toBe("EMPURRADA");
    expect(de(linhas, ids.rotaMar).contexto.channel).toBe("ROTA");
    expect(de(linhas, ids.aMar).contexto.scopeHash).toBe(
      de(linhas, ids.rotaMar).contexto.scopeHash,
    );
    expect(de(linhas, ids.aMar).contexto.label).not.toBe(
      de(linhas, ids.rotaMar).contexto.label,
    );
    expect(de(linhas, ids.bMar).contexto.scopeHash).not.toBe(
      de(linhas, ids.aMar).contexto.scopeHash,
    );
  });

  /*
    Abrir a tela não pode disparar o motor. A leitura atravessa todos os
    contextos de uma vez, e garantir as comparações de todos eles faria a home
    cobrar de quem a abre o trabalho do banco inteiro — além de tapar, em
    silêncio, o buraco que ela existe para mostrar.
  */
  it("não calcula comparação nenhuma ao ser lida", async () => {
    const contar = async () =>
      Number(
        (await ctx.db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM change_set`))
          .rows[0].n,
      );

    const antes = await contar();
    await listarVigenciasDaAuditoria(ctx.db);

    expect(await contar()).toBe(antes);
  });

  it("traz a frota que cada vigência declarou", async () => {
    const linhas = await listarVigenciasDaAuditoria(ctx.db);

    expect(de(linhas, ids.aMar).ativos).toBe(1);
    expect(de(linhas, ids.aMar).entityTypeSet).toBe("CARRETA");
    expect(de(linhas, ids.bMar).entityTypeSet).toBe("CAVALO");
  });
});
