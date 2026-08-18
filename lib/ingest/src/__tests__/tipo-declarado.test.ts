import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  captureRaw,
  exigirTipoDeclarado,
  preview,
  promote,
  receiveFile,
  stage,
} from "../pipeline";
import { createTestDatabase, modelExportPaths, type TestDb } from "../testing";
import { corrigirValoresNumericos, escreverPlanilha } from "./planilha-sintetica";

/**
 * A declaração é promessa; a importação é quem confere.
 *
 * A identidade por conteúdo (`identidade-por-conteudo.test.ts`) prova o que o
 * pipeline faz quando ninguém diz nada. Este prova o que ele faz quando alguém
 * diz — e o que importa aqui não é a declaração ser aceita, é ela **não** ser
 * aceita quando o arquivo desmente: uma planilha de carreta enviada pela aba do
 * Cavalo não pode entrar como cavalo porque alguém clicou na aba errada.
 */

let ctx: TestDb;

async function importar(arquivo: string, declaredType?: string) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType,
  });
  await captureRaw(ctx.db, recebido.importRunId);
  const staged = await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  return { importRunId: recebido.importRunId, staged, relatorio };
}

const planilhaDeTrecho = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      {
        nome: "Planilha1",
        identificador: "chaveTrecho",
        linhas: [{ placa: "CAMACARI-SALVADOR" }, { placa: "CAMACARI-FEIRA" }],
      },
    ],
  });

/**
 * O caso que a chave composta existe para sustentar.
 *
 * Duas unidades, o mesmo cargo, a mesma vigência, o mesmo arquivo. Com a chave
 * sendo só o cargo, as duas linhas seriam a mesma entidade discordando de si
 * mesma — e a importação inteira pararia em ENTIDADE_DUPLICADA_CONFLITANTE.
 */
const planilhaDeQlpOperacional = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      {
        nome: "Planilha1",
        identificador: "cargoEquipeEmpurrada",
        linhas: [
          { placa: "MOTORISTA", turno: "1" },
          { placa: "MOTORISTA", turno: "2" },
          {
            placa: "MOTORISTA",
            turno: "1",
            unidadeCnpj: "20.618.821/0007-99",
            valores: { "Custo Fixo": 2000 },
          },
        ],
      },
    ],
  });

beforeAll(async () => {
  ctx = await createTestDatabase("tipo_declarado");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o que pode ser declarado", () => {
  it("aceita os cinco tipos que a tela oferece", () => {
    for (const code of [
      "CAVALO",
      "CARRETA",
      "TRECHO",
      "QLP_ADMINISTRATIVO",
      "QLP_OPERACIONAL",
    ]) {
      expect(exigirTipoDeclarado(code).code).toBe(code);
    }
  });

  it("recusa um código que não é tipo nenhum", () => {
    expect(() => exigirTipoDeclarado("BITREM")).toThrow(/não é um tipo/);
  });
});

describe("a declaração que o arquivo sustenta", () => {
  it("entra como o tipo declarado, e a decisão diz que foi declarada", async () => {
    const { staged, relatorio, importRunId } = await importar(
      modelExportPaths().carreta,
      "CARRETA",
    );

    expect(staged.identities[0].decision.source).toBe("DECLARADO");
    expect(staged.identities[0].decision.entityType).toBe("CARRETA");
    expect(relatorio.blockingErrors).toBe(0);

    const { rows } = await ctx.db.execute<{ declared_type: string }>(
      sql`SELECT declared_type FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    expect(rows[0].declared_type).toBe("CARRETA");

    // Promovida de propósito: é a promoção que escreve o dicionário, e é
    // contra o dicionário que a divergência mais abaixo se prova.
    await promote(ctx.db, importRunId);
  });

  it("abre o trecho num banco que nunca viu um, sem pedir confirmação depois", async () => {
    const { staged, relatorio } = await importar(planilhaDeTrecho(), "TRECHO");

    expect(staged.identities[0].decision.entityType).toBe("TRECHO");
    // A aba se chama "Planilha1": sem a declaração, o nome criaria o
    // equipamento PLANILHA1 e a promoção pararia para alguém confirmá-lo.
    expect(relatorio.pendingIdentities).toEqual([]);
    expect(relatorio.blockingErrors).toBe(0);
    expect(staged.stagedFacts).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{ entity_key: string }>(sql`
      SELECT DISTINCT entity_key FROM staged_fact WHERE entity_type = 'TRECHO' ORDER BY 1
    `);
    expect(rows.map((r) => r.entity_key)).toEqual([
      "CAMACARIFEIRA",
      "CAMACARISALVADOR",
    ]);
  });
});

describe("o quadro de pessoal, cuja chave não cabe numa coluna", () => {
  it("separa cargo, turno e unidade — três linhas, três entidades", async () => {
    const { staged, relatorio, importRunId } = await importar(
      planilhaDeQlpOperacional(),
      "QLP_OPERACIONAL",
    );

    expect(staged.identities[0].decision.entityType).toBe("QLP_OPERACIONAL");
    expect(relatorio.blockingErrors).toBe(0);
    expect(relatorio.pendingIdentities).toEqual([]);

    const { rows } = await ctx.db.execute<{ entity_key: string; entity_key_raw: string }>(sql`
      SELECT DISTINCT entity_key, entity_key_raw
        FROM staged_fact
       WHERE import_run_id = ${importRunId}::uuid
       ORDER BY 1
    `);

    // O CNPJ entra com 14 dígitos e o cargo emendado depois: a mesma unidade
    // escrita mascarada ou como número produz a mesma chave.
    expect(rows.map((r) => r.entity_key)).toEqual([
      "07526557001505MOTORISTA1",
      "07526557001505MOTORISTA2",
      "20618821000799MOTORISTA1",
    ]);
    // A forma legível fica guardada — é ela que vira `identifier_value_raw`.
    expect(rows[0].entity_key_raw).toContain("MOTORISTA");
  });

  it("mantém a unidade como fato, senão a vigência não teria de quem ser", async () => {
    // A unidade é metade da chave **e** continua sendo fato: é dela que o
    // escopo da vigência sai, e sem escopo a promoção recusa.
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM staged_fact
       WHERE entity_type = 'QLP_OPERACIONAL'
         AND attribute_code = 'qlp_operacional.unidade_cnpj'
    `);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("promove numa família própria, sem virar revisão da vigência de equipamento", async () => {
    const { importRunId } = await importar(
      escreverPlanilha({
        vigencia: "EMPURRADA_2_8_2026",
        abas: [
          {
            nome: "Planilha1",
            identificador: "Cargo",
            linhas: [{ placa: "COORDENADOR" }, { placa: "ANALISTA" }],
          },
        ],
      }),
      "QLP_ADMINISTRATIVO",
    );
    await promote(ctx.db, importRunId);

    const { rows } = await ctx.db.execute<{ dataset_family: string; status: string }>(sql`
      SELECT dataset_family, status FROM snapshot WHERE import_run_id = ${importRunId}::uuid
    `);
    expect(rows[0].dataset_family).toBe("QUADRO_DE_PESSOAL");
    expect(rows[0].status).not.toBe("SUPERSEDED");

    // E a vigência de equipamento continua ativa: as duas convivem porque a
    // família faz parte da identidade.
    const { rows: equipamento } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM snapshot
       WHERE dataset_family = 'REMUNERACAO_EQUIPAMENTO' AND status <> 'SUPERSEDED'
    `);
    expect(equipamento[0].n).toBeGreaterThan(0);
  });
});

describe("a declaração que o arquivo desmente", () => {
  it("recusa a planilha de carreta enviada pela aba do Cavalo", async () => {
    /*
      O dicionário já conhece CARRETA — o primeiro teste a promoveu. É essa a
      condição em que o conteúdo consegue desmentir a declaração: cavalo e
      carreta se identificam os dois por placa, e o grão não os separa.

      O arquivo é uma cópia com os números somados de 1, e não o original: os
      mesmos bytes seriam recusados antes de chegar à conferência, pelo SHA-256.
    */
    const { relatorio, importRunId } = await importar(
      corrigirValoresNumericos(modelExportPaths().carreta),
      "CAVALO",
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{ status: string; failure_reason: string }>(
      sql`SELECT status, failure_reason FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    expect(rows[0].status).toBe("VALIDATION_ERROR");
    expect(rows[0].failure_reason).toMatch(/Você escolheu Cavalo/);
    expect(rows[0].failure_reason).toMatch(/aba do tipo certo/);

    await expect(promote(ctx.db, importRunId)).rejects.toThrow();
  });

  it("recusa a planilha de placa enviada pela aba do Trecho, pelo grão", async () => {
    const { relatorio, importRunId } = await importar(
      modelExportPaths().cavalo,
      "TRECHO",
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{ failure_reason: string }>(
      sql`SELECT failure_reason FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    // A recusa cita a coluna que falta, e não o dicionário: é a conferência que
    // funciona no primeiro arquivo de um tipo, quando não há o que consultar.
    expect(rows[0].failure_reason).toMatch(/chaveTrecho/);
    expect(rows[0].failure_reason).toMatch(/não traz/);
  });

  it("recusa a planilha de equipamento enviada pela aba do QLP", async () => {
    const { relatorio, importRunId } = await importar(
      corrigirValoresNumericos(modelExportPaths().cavalo),
      "QLP_OPERACIONAL",
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{ failure_reason: string }>(
      sql`SELECT failure_reason FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    // A unidade está lá — ela é escopo de toda aba —, e mesmo assim a recusa
    // acontece: a identidade é o conjunto, e falta o cargo e o turno.
    expect(rows[0].failure_reason).toMatch(/cargoEquipeEmpurrada/);
    expect(rows[0].failure_reason).toMatch(/turnoEmpurrada/);
  });
});
