import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { getImportRun, listImportRuns } from "../history";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type PlanilhaSpec } from "./planilha-sintetica";

/**
 * DE QUE UNIDADE É UMA IMPORTAÇÃO — e por que a resposta é uma lista.
 *
 * A tela de Importações recorta por acervo e por tipo, e os dois são
 * **declaração**: enviar por aquela aba diz o que o arquivo traz, e o pipeline
 * confere a declaração contra o conteúdo. A unidade não é nada disso — ela
 * nasce do conteúdo (`REQUIRED_SCOPE_TYPES`), ninguém a declara no envio, e o
 * export consolidado da Ambev traz cinco na mesma aba. Uma aba por unidade
 * poria essa importação em cinco abas ao mesmo tempo, ou em nenhuma.
 *
 * O que ela é, então, é **procedência**: o histórico diz de quem é cada arquivo
 * que entrou, e a lateral recorta por unidade como já recorta as outras telas.
 * Este arquivo fixa a leitura que sustenta as duas coisas.
 */

let ctx: TestDb;

async function importar(db: Database, caminho: string) {
  const recebido = await receiveFile(db, { filePath: caminho });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  await promote(db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
  return recebido.importRunId;
}

/** As unidades como a tela as escreve, para o `expect` falar a língua dela. */
async function unidadesDe(importRunId: string): Promise<string[]> {
  const run = await getImportRun(ctx.db, importRunId);
  return (run?.unidades ?? []).map((u) => u.name ?? u.code);
}

beforeAll(async () => {
  ctx = await createTestDatabase("unidadesdaimportacao");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a procedência de uma importação", () => {
  it("o arquivo de uma unidade é de uma; o consolidado é de todas as que traz", async () => {
    const CAMACARI = "07.526.557/0015-05";
    const MANAUS = "03.134.910/0002-36";

    const deUma: PlanilhaSpec = {
      vigencia: "EMPURRADA_1_8_2041",
      unidadeNome: "CAMACARI",
      abas: [{ nome: "cavalos", linhas: [{ placa: "UMA1A11" }, { placa: "UMA2A22" }] }],
    };

    const consolidado: PlanilhaSpec = {
      vigencia: "EMPURRADA_2_8_2041",
      unidadeNome: "CAMACARI",
      abas: [
        {
          nome: "cavalos",
          linhas: [
            { placa: "CON1A11", unidadeCnpj: CAMACARI, unidadeNome: "CAMACARI" },
            { placa: "CON2A22", unidadeCnpj: MANAUS, unidadeNome: "MANAUS" },
          ],
        },
      ],
    };

    const runDeUma = await importar(ctx.db, escreverPlanilha(deUma));
    const runConsolidado = await importar(ctx.db, escreverPlanilha(consolidado));

    expect(await unidadesDe(runDeUma)).toEqual(["CAMACARI"]);
    // Ordenada e sem repetição: duas linhas de Camaçari não são duas unidades.
    expect(await unidadesDe(runConsolidado)).toEqual(["CAMACARI", "MANAUS"]);
  });

  it("o código vem como a planilha o escreveu, ao lado do nome", async () => {
    const spec: PlanilhaSpec = {
      vigencia: "EMPURRADA_1_9_2041",
      unidadeNome: "CAMACARI",
      abas: [{ nome: "cavalos", linhas: [{ placa: "COD1A11" }] }],
    };

    const run = await getImportRun(ctx.db, await importar(ctx.db, escreverPlanilha(spec)));
    expect(run?.unidades).toHaveLength(1);
    expect(run?.unidades[0].code).not.toBe("");
    expect(run?.unidades[0].name).toBe("CAMACARI");
  });

  it("a importação que ainda não promoveu não é de unidade nenhuma", async () => {
    const spec: PlanilhaSpec = {
      vigencia: "EMPURRADA_2_9_2041",
      unidadeNome: "CAMACARI",
      abas: [{ nome: "cavalos", linhas: [{ placa: "PEN1A11" }] }],
    };

    const recebido = await receiveFile(ctx.db, { filePath: escreverPlanilha(spec) });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    await preview(ctx.db, recebido.importRunId);

    /*
      Vazio, e não "CAMAÇARI": enquanto a vigência não entrou, não há unidade de
      que a importação seja. Dizer a do arquivo aqui seria afirmar, na lista, um
      escopo que a promoção ainda pode recusar.
    */
    expect(await unidadesDe(recebido.importRunId)).toEqual([]);

    const lista = await listImportRuns(ctx.db);
    const naLista = lista.find((r) => r.importRunId === recebido.importRunId);
    expect(naLista?.unidades).toEqual([]);
  });
});
