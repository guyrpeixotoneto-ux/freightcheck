import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestDatabase,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import {
  atributosDisponiveis,
  contextosDisponiveis,
  equipamentosDisponiveis,
  estadoDoValor,
  serieDe,
  seriesDisponiveis,
  verificarDisponibilidade,
  vigenciaAnterior,
  vigenciasDisponiveis,
} from "../index";

/**
 * A autoridade contra o export real — a entrega de verdade, em duas partes.
 *
 * Os fixtures provam os casos que a realidade ainda não produziu. Este arquivo
 * prova o contrário: que a autoridade descreve **o que já existe**, incluindo o
 * caso que mais importa e que nenhum fixture reproduz de graça — a fusão de
 * duas entregas por equipamento na mesma vigência canônica.
 *
 * `Modelo_Carreta.xlsx` abre nove vigências só de carretas; `Modelo_Cavalo.xlsx`
 * as leva à revisão 2, herdando os fatos que ele não toca. Ao final, nove
 * vigências disponíveis e nove substituídas, e a autoridade tem de enxergar
 * exatamente as primeiras.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("disp_export_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const arquivo of [carreta, cavalo]) {
    const recebido = await receiveFile(ctx.db, { filePath: arquivo });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    await promote(ctx.db, recebido.importRunId, {
      onExistingSnapshot: "NEW_REVISION",
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });
  }
}, 900_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
}, 60_000);

describe("15 · o export real", () => {
  it("enxerga as nove vigências, e nenhuma das nove substituídas", async () => {
    const vigencias = await vigenciasDisponiveis(ctx.db);
    expect(vigencias).toHaveLength(9);
    expect(vigencias.every((v) => v.revision === 2)).toBe(true);

    const { rows } = await ctx.db.execute<{ closed: number; superseded: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'CLOSED')::int     AS closed,
             count(*) FILTER (WHERE status = 'SUPERSEDED')::int AS superseded
        FROM snapshot`);
    expect(Number(rows[0].closed)).toBe(9);
    expect(Number(rows[0].superseded)).toBe(9);
  }, 300_000);

  it("uma unidade, um canal, uma série — e as nove datas dentro dela", async () => {
    const contextos = await contextosDisponiveis(ctx.db);
    expect(contextos).toHaveLength(1);
    expect(contextos[0].rotulo).toContain("EMPURRADA");
    expect(contextos[0].periodos).toBe(9);

    const series = await seriesDisponiveis(ctx.db);
    expect(series).toHaveLength(1);
    expect(series[0].periodos).toHaveLength(9);
    expect(series[0].datasetFamily).toBe("REMUNERACAO_EQUIPAMENTO");
  }, 300_000);

  it("oito das nove têm anterior; a primeira diz por que não tem", async () => {
    const vigencias = await vigenciasDisponiveis(ctx.db);
    const semAnterior: string[] = [];
    for (const v of vigencias) {
      const anterior = await vigenciaAnterior(ctx.db, v.snapshotId);
      if (!anterior.encontrada) {
        expect(anterior.motivo).toBe("PRIMEIRA_DA_SERIE");
        semAnterior.push(v.effectiveDate);
        continue;
      }
      // A anterior é sempre a de antes na mesma série, e nunca ela mesma.
      expect(anterior.vigencia.serie).toBe(v.serie);
      expect(anterior.vigencia.effectiveDate < v.effectiveDate).toBe(true);
    }
    expect(semAnterior).toEqual([vigencias[0].effectiveDate]);
  }, 300_000);

  it("as duas entregas por equipamento são uma série só", async () => {
    // A prova de que a fusão funcionou: nove vigências, uma série, e cada uma
    // cobrindo os dois equipamentos — ainda que tenham chegado em dois arquivos.
    const vigencias = await vigenciasDisponiveis(ctx.db);
    expect(new Set(vigencias.map((v) => v.serie)).size).toBe(1);
    for (const v of vigencias) {
      expect(v.equipamentos.map((e) => e.entityType).sort()).toEqual(["CARRETA", "CAVALO"]);
    }
    expect(
      (await equipamentosDisponiveis(ctx.db)).map((e) => [e.entityType, e.vigencias]),
    ).toEqual([
      ["CARRETA", 9],
      ["CAVALO", 9],
    ]);
  }, 300_000);

  it("o censo bate com o banco, contado por fora da autoridade", async () => {
    // A conferência que fecha o círculo: o número da autoridade contra um
    // `count` cru. Se os dois divergirem, é a autoridade que está errada.
    const vigencias = await vigenciasDisponiveis(ctx.db);
    const { rows } = await ctx.db.execute<{ datas: number; fatos: number; entidades: number }>(sql`
      SELECT count(DISTINCT s.effective_date)::int AS datas,
             sum(s.fact_count)::int                AS fatos,
             (SELECT count(*)::int FROM fact f
               JOIN snapshot x ON x.id = f.snapshot_id AND x.status = 'CLOSED') AS entidades
        FROM snapshot s WHERE s.status = 'CLOSED'`);
    expect(vigencias.length).toBe(Number(rows[0].datas));
    expect(vigencias.reduce((n, v) => n + v.fatos, 0)).toBe(Number(rows[0].fatos));
    // `fact_count` é gravado na promoção; conferir contra `fact` prova que ele
    // não envelheceu.
    expect(vigencias.reduce((n, v) => n + v.fatos, 0)).toBe(Number(rows[0].entidades));
  }, 300_000);

  it("o veredito é DISPONIVEL, e nunca VAZIO_GLOBAL com dado no banco", async () => {
    expect((await verificarDisponibilidade(ctx.db)).estado).toBe("DISPONIVEL");

    const contexto = (await contextosDisponiveis(ctx.db))[0];
    expect(
      (await verificarDisponibilidade(ctx.db, { contexto: contexto.chave })).estado,
    ).toBe("DISPONIVEL");

    // Um contexto que não existe é vazio **no recorte**, e a resposta diz onde
    // o dado está. É a frase que impede a tela de escrever "não há dados".
    const veredito = await verificarDisponibilidade(ctx.db, { contexto: "inexistente" });
    expect(veredito.estado).toBe("VAZIO_NO_RECORTE");
    if (veredito.estado !== "VAZIO_NO_RECORTE") return;
    expect(veredito.existemEm).toHaveLength(1);
  }, 300_000);

  it("os atributos disponíveis são os do dicionário que o layout trouxe", async () => {
    const todos = await atributosDisponiveis(ctx.db);
    expect(todos.length).toBeGreaterThan(100);

    const deCavalo = await atributosDisponiveis(ctx.db, { entityType: "CAVALO" });
    expect(deCavalo.every((a) => a.entityType === "CAVALO")).toBe(true);
    expect(deCavalo.some((a) => a.code === "cavalo.finame_cavalo")).toBe(true);

    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT sa.attribute_id)::int AS n
        FROM snapshot_attribute sa
        JOIN snapshot s ON s.id = sa.snapshot_id AND s.status = 'CLOSED'
       WHERE sa.present_in_layout`);
    expect(todos.length).toBe(Number(rows[0].n));
  }, 300_000);

  it("no dado real, zero e nulo convivem — e a célula os separa", async () => {
    // Medido: 17.717 zeros econômicos e 11.962 ausências declaradas. Se a
    // classificação colapsasse os dois, quase trinta mil células mudariam de
    // significado sem que nada na tela mudasse.
    const { rows } = await ctx.db.execute<{
      snapshot_id: string;
      entity_id: string;
      code: string;
      is_null: boolean;
    }>(sql`
      (SELECT f.snapshot_id::text, f.entity_id::text, a.code, f.is_null
         FROM fact f
         JOIN snapshot s  ON s.id = f.snapshot_id AND s.status = 'CLOSED'
         JOIN attribute a ON a.id = f.attribute_id
        WHERE f.is_null LIMIT 1)
      UNION ALL
      (SELECT f.snapshot_id::text, f.entity_id::text, a.code, f.is_null
         FROM fact f
         JOIN snapshot s  ON s.id = f.snapshot_id AND s.status = 'CLOSED'
         JOIN attribute a ON a.id = f.attribute_id
        WHERE NOT f.is_null AND f.value_numeric = 0 LIMIT 1)`);
    expect(rows).toHaveLength(2);

    const nulo = await estadoDoValor(
      ctx.db,
      rows[0].snapshot_id,
      rows[0].entity_id,
      rows[0].code,
    );
    expect(nulo.estado).toBe("NULO");
    expect(nulo.valor).toBeNull();
    expect(nulo.motivo).toBeTruthy();

    const zero = await estadoDoValor(
      ctx.db,
      rows[1].snapshot_id,
      rows[1].entity_id,
      rows[1].code,
    );
    expect(zero.estado).toBe("ZERO");
    expect(zero.valor).toBe(0);
  }, 300_000);

  it("`serieDe` concorda com a série de toda vigência do censo", async () => {
    for (const v of await vigenciasDisponiveis(ctx.db)) {
      expect(await serieDe(ctx.db, v.snapshotId)).toBe(v.serie);
    }
  }, 300_000);
});
