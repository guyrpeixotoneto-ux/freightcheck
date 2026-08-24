import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { snapshotTable } from "@workspace/db";
import type { Database } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type PlanilhaSpec } from "./planilha-sintetica";

/**
 * A Ambev manda, às vezes, um export consolidado: uma vigência só, várias
 * unidades juntas na mesma aba, cada linha dizendo a sua no `Unidade - CNPJ`
 * (o caso real que motivou este arquivo foi "EMPURRADA_Cavalo", cinco
 * unidades — Camaçari, Pernambuco, CDD Cebrasa, Equatorial e Manaus — numa
 * aba só).
 *
 * `promote` costumava agrupar os fatos só pelo rótulo da vigência, então
 * essas linhas viravam **um** snapshot cujo escopo era a união de todas as
 * unidades — e a tela, que lê a primeira unidade do escopo, mostrava só uma
 * delas (a que ordenasse primeiro por CNPJ), como se as outras não tivessem
 * sido importadas. Elas tinham: estavam ali, misturadas, sem lugar próprio
 * para aparecer.
 */

let ctx: TestDb;

async function importar(db: Database, caminho: string) {
  const recebido = await receiveFile(db, { filePath: caminho });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  const promovido = await promote(db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
  return { importRunId: recebido.importRunId, promovido };
}

async function ativos(db: Database, effectiveDate: string) {
  return db
    .select()
    .from(snapshotTable)
    .where(
      and(
        eq(snapshotTable.effectiveDate, effectiveDate),
        sql`${snapshotTable.status} <> 'SUPERSEDED'`,
      ),
    );
}

beforeAll(async () => {
  ctx = await createTestDatabase("multiunidade");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("um arquivo consolidado, com mais de uma unidade na mesma vigência", () => {
  it("cria um snapshot por unidade, não um snapshot só com a união de todas", async () => {
    const CAMACARI = "07.526.557/0015-05";
    const MANAUS = "03.134.910/0002-36";

    const spec: PlanilhaSpec = {
      vigencia: "EMPURRADA_1_8_2040",
      unidadeNome: "CAMACARI",
      abas: [
        {
          nome: "cavalos",
          linhas: [
            { placa: "AAA1B11", unidadeCnpj: CAMACARI },
            { placa: "AAA2B22", unidadeCnpj: CAMACARI },
            { placa: "MMM3C33", unidadeCnpj: MANAUS },
          ],
        },
      ],
    };

    const { promovido } = await importar(ctx.db, escreverPlanilha(spec));
    expect(promovido.snapshots).toHaveLength(2);

    const snapshots = await ativos(ctx.db, "2040-08-01");
    expect(snapshots).toHaveLength(2);

    const porEntidades = [...snapshots].sort((a, b) => a.entityCount - b.entityCount);
    expect(porEntidades.map((s) => s.entityCount)).toEqual([1, 2]);

    // Escopos distintos: nenhum snapshot pode carregar as duas unidades juntas.
    const scopes = snapshots.map((s) => JSON.stringify(s.canonicalScope));
    expect(new Set(scopes).size).toBe(2);
    for (const s of snapshots) {
      const codigos = (s.canonicalScope as { scopeType: string; code: string }[])
        .filter((e) => e.scopeType === "UNIDADE")
        .map((e) => e.code);
      expect(codigos).toHaveLength(1);
    }

    const total = snapshots.reduce((soma, s) => soma + s.entityCount, 0);
    expect(total).toBe(3);
  });

  it("um arquivo de unidade única continua produzindo um snapshot só", async () => {
    const spec: PlanilhaSpec = {
      vigencia: "EMPURRADA_2_8_2040",
      abas: [
        {
          nome: "cavalos",
          linhas: [{ placa: "SOL1O11" }, { placa: "SOL2O22" }],
        },
      ],
    };

    const { promovido } = await importar(ctx.db, escreverPlanilha(spec));
    expect(promovido.snapshots).toHaveLength(1);

    const snapshots = await ativos(ctx.db, "2040-08-02");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].entityCount).toBe(2);
  });
});
