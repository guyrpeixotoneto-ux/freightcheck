import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";
import { DATASET_FAMILY_FINANCIAMENTO_REAL } from "../tipos";

/**
 * O real e o remunerado do mesmo veículo, na mesma data — e por que eles não
 * colidem.
 *
 * A identidade canônica de uma vigência é (sistema, família, canal, data,
 * escopo), e o índice único dela é gerado pelo próprio Postgres. Enquanto a
 * **família** era derivada do `entity_type`, um extrato de financiamento do
 * cavalo tinha a mesma identidade da remuneração do cavalo daquela quinzena:
 * eram a mesma vigência, do ponto de vista do banco, e a segunda entrega
 * substituía ou recusava a primeira.
 *
 * Trocar o `entity_type` para não colidir teria custado o que este arquivo
 * também prova: `entity_identifier` é único por (tipo, valor), então um
 * `CAVALO_REAL` faria a placa do real ser uma **entidade diferente** da mesma
 * placa no remunerado — e a auditoria do real existe exatamente para cruzar as
 * duas.
 *
 * Os dois testes abaixo são as duas metades disso: as vigências separadas, e a
 * entidade compartilhada.
 */

let ctx: TestDb;

/** Uma planilha de cavalo, com o valor mexido para o sha256 mudar. */
const planilhaDeCavalo = (custoFixo: number, vigencia = "EMPURRADA_1_8_2026") =>
  escreverPlanilha({
    vigencia,
    abas: [
      {
        nome: "Planilha1",
        identificador: "Placa",
        linhas: [{ placa: "ABC1D23", valores: { "Custo Fixo": custoFixo } }],
      },
    ],
  });

async function importar(
  arquivo: string,
  declaredType: string,
  declaredFamily?: string,
) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType,
    declaredFamily,
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId);
  return recebido.importRunId;
}

beforeAll(async () => {
  ctx = await createTestDatabase("familia_declarada");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a família declarada separa os acervos", () => {
  it("o real e o remunerado da mesma data viram duas vigências ativas", async () => {
    const remunerado = await importar(planilhaDeCavalo(1000), "CAVALO");
    await promote(ctx.db, remunerado);

    // Mesma placa, mesma vigência, mesmo tipo — e mesmo assim entra, porque a
    // declaração diz que é outro acervo.
    const real = await importar(
      planilhaDeCavalo(1750),
      "CAVALO",
      DATASET_FAMILY_FINANCIAMENTO_REAL,
    );
    await promote(ctx.db, real);

    const { rows } = await ctx.db.execute<{
      dataset_family: string;
      effective_date: string;
    }>(sql`
      SELECT dataset_family, effective_date::text
        FROM snapshot
       WHERE status <> 'SUPERSEDED'
       ORDER BY dataset_family
    `);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dataset_family)).toEqual([
      DATASET_FAMILY_FINANCIAMENTO_REAL,
      "REMUNERACAO_EQUIPAMENTO",
    ]);
    // A mesma data nas duas: é justamente o que colidia antes.
    expect(new Set(rows.map((r) => r.effective_date)).size).toBe(1);
  });

  it("a placa continua sendo uma entidade só, compartilhada pelos dois", async () => {
    // A metade que o `entity_type` sustenta. Sem ela não haveria o que cruzar:
    // o real falaria de uma ABC1D23 que o remunerado não conhece.
    const { rows } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
        FROM entity_identifier
       WHERE identifier_value = 'ABC1D23'
    `);
    expect(rows[0].n).toBe("1");
  });
});

describe("sem a declaração, é a colisão de sempre", () => {
  it("o mesmo veículo na mesma data recusa a segunda entrega", async () => {
    /*
      O controle do primeiro teste: o que separa as duas vigências é a
      declaração, e nada mais. Sem ela, o segundo arquivo descreve a vigência
      que já está ativa — e `promote` recusa em vez de fundir.

      Outra quinzena porque a primeira já tem as duas vigências do teste
      anterior ativas: o que se quer medir aqui é a segunda entrega colidindo
      com a primeira, e não com o que ficou de lá.
    */
    const quinzena = "EMPURRADA_2_8_2026";
    const primeiro = await importar(planilhaDeCavalo(2000, quinzena), "CAVALO");
    await promote(ctx.db, primeiro);

    const segundo = await importar(planilhaDeCavalo(2500, quinzena), "CAVALO");
    await expect(promote(ctx.db, segundo)).rejects.toThrow();
  });
});
