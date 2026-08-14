import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { attributeTable, entityTypeCorrectionTable } from "@workspace/db";
import { createTestDatabase, modelExportPaths, type TestDb } from "@workspace/ingest/testing";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { getEntityTable } from "../grouped";

/**
 * A correção de identidade de equipamento, contra dado importado de verdade.
 *
 * O defeito: a aba `Modelo_Cavalo` virava o tipo MODELOCAVALO — um equipamento
 * paralelo ao que já existia, com as mesmas colunas e os mesmos ativos. A regra
 * de ingestão já foi corrigida, mas corrigir a regra não reescreve o que entrou
 * com ela, e **reimportar também não resolve**: o ativo é reconhecido pela
 * placa, então a reimportação reaproveita a mesma linha de `entity` com o tipo
 * errado ainda gravado nela. Só uma correção explícita move a identidade.
 *
 * O teste vai e volta: importa o cavalo de verdade, empurra a identidade para
 * MODELOCAVALO com a mesma função — é a única forma honesta de produzir o
 * banco doente, já que a ingestão não produz mais esse tipo — e corrige de
 * volta, conferindo que a tabela do cartão volta a responder com dado.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("correcao_identidade");
  const { cavalo } = modelExportPaths();
  const received = await receiveFile(ctx.db, { filePath: cavalo });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  await preview(ctx.db, received.importRunId);
  await promote(ctx.db, received.importRunId);
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const COLUNAS = ["cavalo.chassi", "cavalo.ano", "cavalo.montadora"];
const COLUNAS_ANTIGAS = COLUNAS.map((c) => c.replace("cavalo.", "modelocavalo."));

async function corrigir(de: string, para: string): Promise<string> {
  const { rows } = await ctx.db.execute<{ id: string }>(
    sql`SELECT freightcheck_correct_entity_type(${de}, ${para}, 'test') AS id`,
  );
  return rows[0].id;
}

async function registro(id: string) {
  const linhas = await ctx.db
    .select()
    .from(entityTypeCorrectionTable)
    .where(sql`${entityTypeCorrectionTable.id} = ${id}::uuid`);
  return linhas[0];
}

describe("a identidade errada, e o que ela quebra", () => {
  it("empurrar o tipo para MODELOCAVALO reproduz o banco que o operador viu", async () => {
    const id = await corrigir("CAVALO", "MODELOCAVALO");
    const feito = await registro(id);

    expect(feito.attributesRenamed).toBeGreaterThan(0);
    expect(feito.entitiesRenamed).toBeGreaterThan(0);
    // As vigências também: sem elas, o motor recusaria comparar a série
    // corrigida com a próxima, alegando cobertura diferente.
    expect(feito.snapshotsRenamed).toBeGreaterThan(0);
    expect(feito.skipped).toEqual([]);

    const tabela = (await getEntityTable(ctx.db, "CAVALO", COLUNAS))!;
    expect(tabela.rows).toHaveLength(0);
    expect(tabela.attributesKnown).toBe(0);
    expect(tabela.seriesDelivered).toBe(false);
    // E o diagnóstico da tela acha a identidade paralela, que é o que fez o
    // operador dizer "mas eu importei sim".
    expect(tabela.elsewhere.aliasTypes[0]?.entityType).toBe("MODELOCAVALO");
  });

  it("o dado continua lá, inteiro, sob o nome errado", async () => {
    const tabela = (await getEntityTable(ctx.db, "MODELOCAVALO", COLUNAS_ANTIGAS))!;

    expect(tabela.rows.length).toBeGreaterThan(0);
    expect(tabela.missingColumns).toEqual([]);
    expect(tabela.seriesDelivered).toBe(true);
  });
});

describe("a correção de volta", () => {
  let idDaCorrecao: string;

  beforeAll(async () => {
    idDaCorrecao = await corrigir("MODELOCAVALO", "CAVALO");
  }, 60_000);

  it("devolve o cartão ao dado, com placa e colunas", async () => {
    const tabela = (await getEntityTable(ctx.db, "CAVALO", COLUNAS))!;

    expect(tabela.rows.length).toBeGreaterThan(0);
    expect(tabela.attributesKnown).toBeGreaterThan(0);
    expect(tabela.missingColumns).toEqual([]);
    // A cobertura da vigência voltou junto: sem isso o cartão mostraria dado e
    // a série continuaria dita como não entregue.
    expect(tabela.seriesDelivered).toBe(true);
    expect(tabela.rows[0].label).toBeTruthy();
  });

  it("não deixa nenhuma coluna com o código antigo", async () => {
    const restos = await ctx.db
      .select({ code: attributeTable.code })
      .from(attributeTable)
      .where(sql`${attributeTable.entityType} = 'MODELOCAVALO'
                 OR ${attributeTable.code} LIKE 'modelocavalo.%'`);

    expect(restos).toEqual([]);
  });

  it("os fatos não foram tocados: a trava de imutabilidade seguiu de pé", async () => {
    // A correção move identidade, não valor. Se ela tivesse tentado reapontar
    // um fato, o gatilho `fact_immutable` teria derrubado a operação inteira —
    // este teste existe para que a próxima pessoa não "melhore" a função
    // fundindo colunas por baixo dos panos.
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM fact f
        JOIN snapshot s ON s.id = f.snapshot_id
       WHERE s.status = 'CLOSED'
    `);
    expect(rows[0].n).toBeGreaterThan(0);

    const recusa = await ctx.db
      .execute(
        sql`UPDATE fact SET value_text = 'x'
             WHERE id = (SELECT f.id FROM fact f
                           JOIN snapshot s ON s.id = f.snapshot_id
                          WHERE s.status = 'CLOSED' LIMIT 1)`,
      )
      .then(
        () => null,
        // O drizzle embrulha o erro do banco; a mensagem do gatilho está na causa.
        (err: Error & { cause?: Error }) => err.cause?.message ?? err.message,
      );

    expect(recusa).toMatch(/facts are immutable/i);
  });

  it("fica registrada, com contagem e autor", async () => {
    const feito = await registro(idDaCorrecao);

    expect(feito.fromEntityType).toBe("MODELOCAVALO");
    expect(feito.toEntityType).toBe("CAVALO");
    expect(feito.attributesRenamed).toBeGreaterThan(0);
    expect(feito.entitiesRenamed).toBeGreaterThan(0);
    expect(feito.snapshotsRenamed).toBeGreaterThan(0);
    expect(feito.appliedBy).toBe("test");
    expect(feito.skipped).toEqual([]);
  });
});

describe("o que a correção se recusa a fazer", () => {
  it("não renomeia por cima de uma coluna que já existe — diz qual e segue", async () => {
    await corrigir("CAVALO", "MODELOCAVALO");

    // Uma coluna `cavalo.chassi` nova, sem fato nenhum: é o caso em que os dois
    // nomes existem ao mesmo tempo. Fundir as duas exigiria reapontar fatos
    // imutáveis, então a correção deixa as duas e nomeia o par.
    await ctx.db.insert(attributeTable).values({
      code: "cavalo.chassi",
      sourceName: "Chassi",
      displayName: "Chassi",
      entityType: "CAVALO",
      dataType: "TEXT",
    });

    const feito = await registro(await corrigir("MODELOCAVALO", "CAVALO"));

    expect(feito.attributesSkipped).toBe(1);
    expect(feito.attributesRenamed).toBeGreaterThan(0);
    const recusa = (feito.skipped as { kind: string; code: string; wouldBecome: string }[])[0];
    expect(recusa.kind).toBe("attribute");
    expect(recusa.code).toBe("modelocavalo.chassi");
    expect(recusa.wouldBecome).toBe("cavalo.chassi");

    // A coluna recusada continua existindo, com os fatos dela intactos.
    const sobreviventes = await ctx.db
      .select({ code: attributeTable.code })
      .from(attributeTable)
      .where(sql`${attributeTable.code} = 'modelocavalo.chassi'`);
    expect(sobreviventes).toHaveLength(1);
  });
});
