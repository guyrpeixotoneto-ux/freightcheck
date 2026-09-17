import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { importRunTable } from "@workspace/db";
import {
  captureRaw,
  exigirQuinzenaDeclarada,
  preview,
  promote,
  receiveFile,
  stage,
} from "../pipeline";
import { getImportRunStatus } from "../history";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type PlanilhaSpec } from "./planilha-sintetica";

/**
 * A QUINZENA DECLARADA NO ENVIO — o engano que entrava calado.
 *
 * A tela de Importações sempre conferiu a declaração contra o conteúdo: a aba
 * diz o tipo, o acervo diz a família, e o arquivo que não é o que disse ser é
 * recusado antes de qualquer fato entrar. A quinzena era a exceção — ela saía
 * inteira do rótulo de dentro do arquivo, sem ninguém do lado de fora para
 * discordar.
 *
 * O preço era um erro perfeitamente silencioso. O export da Ambev chega quinzena
 * a quinzena, com nomes de arquivo que diferem em um dígito; reenviar a 1ª
 * achando que se manda a 2ª **entrava**, porque o arquivo é mesmo da vigência
 * que o rótulo dele diz. Ninguém errou de tipo, ninguém errou de unidade, o
 * pipeline estava certo — e agosto ficava com uma quinzena lida duas vezes e
 * outra que nunca chegou, descoberto semanas depois na comparação.
 *
 * Este arquivo prende as duas pontas: com a declaração, a divergência é recusa
 * nomeada; sem ela, nada muda — o arquivo continua entrando pela quinzena que o
 * rótulo disser, como sempre entrou.
 */

let ctx: TestDb;

const planilha = (vigencia: string, placa: string): string =>
  escreverPlanilha({
    vigencia,
    unidadeNome: "CAMACARI",
    abas: [{ nome: "cavalos", linhas: [{ placa }] }],
  } satisfies PlanilhaSpec);

/** Recebe, lê e confere — o caminho até a decisão, sem promover. */
async function lerAteConferir(arquivo: string, declaredPeriod?: string) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    receivedBy: "quem.opera@exemplo.com",
    declaredType: "CAVALO",
    declaredPeriod,
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  const [run] = await ctx.db
    .select({ status: importRunTable.status, failureReason: importRunTable.failureReason })
    .from(importRunTable)
    .where(eq(importRunTable.id, recebido.importRunId));
  return { importRunId: recebido.importRunId, relatorio, run };
}

beforeAll(async () => {
  ctx = await createTestDatabase("quinzenadeclarada");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a quinzena declarada é conferida contra o rótulo do arquivo", () => {
  it("o arquivo da quinzena certa entra, como sempre entrou", async () => {
    const { relatorio, run } = await lerAteConferir(
      planilha("EMPURRADA_1_8_2041", "CER1A11"),
      "2041-08-01",
    );

    expect(run.status).toBe("PREVIEWED");
    expect(relatorio.blockingErrors).toBe(0);
    expect(relatorio.issuesByCode.map((i) => i.code)).not.toContain(
      "QUINZENA_DIVERGE_DA_DECLARACAO",
    );
  });

  it("o arquivo da outra quinzena é recusado, e a recusa diz as duas datas", async () => {
    // O engano real: mandar a 1ª quinzena na linha da 2ª.
    const { importRunId, relatorio, run } = await lerAteConferir(
      planilha("EMPURRADA_1_9_2041", "ERR1A11"),
      "2041-09-16",
    );

    expect(run.status).toBe("VALIDATION_ERROR");
    expect(relatorio.blockingErrors).toBe(1);

    const apontamento = relatorio.issuesByCode.find(
      (i) => i.code === "QUINZENA_DIVERGE_DA_DECLARACAO",
    );
    expect(apontamento?.severity).toBe("ERROR");
    // As duas quinzenas na frase: a escolhida e a que o arquivo traz.
    expect(apontamento?.sample).toContain("2ª quinzena de 09/2041");
    expect(apontamento?.sample).toContain("1ª quinzena de 09/2041");
    expect(apontamento?.sample).toContain("EMPURRADA_1_9_2041");

    // E o motivo gravado manda pela linha certa, não pela aba certa.
    expect(run.failureReason).toContain("linha da quinzena");

    // A promoção não é uma segunda chance: o estado recusa antes dela.
    await expect(promote(ctx.db, importRunId, {})).rejects.toThrow();
  });

  it("sem declaração, nada muda — o rótulo continua mandando sozinho", async () => {
    const { relatorio, run } = await lerAteConferir(
      planilha("EMPURRADA_2_9_2041", "SEM1A11"),
    );

    expect(run.status).toBe("PREVIEWED");
    expect(relatorio.blockingErrors).toBe(0);
  });

  it("conferir de novo não acumula apontamento", async () => {
    /*
      Duas travas, e a segunda é a que importa aqui.

      A primeira é a máquina de estados: o run recusado fica em
      VALIDATION_ERROR, e `preview` só aceita STAGED ou PREVIEWED — reconferir o
      arquivo que já foi recusado nem é possível. A segunda é a conferência em
      si, que apaga os apontamentos anteriores do próprio código antes de
      escrever: é ela que segura o caso em que o run **passa** e a tela
      repergunta o estado, e é ela que continuaria segurando se um dia a
      primeira mudar.
    */
    const { importRunId } = await lerAteConferir(
      planilha("EMPURRADA_1_10_2041", "DOI1A11"),
      "2041-10-01",
    );

    await preview(ctx.db, importRunId);
    await preview(ctx.db, importRunId);

    const estado = await getImportRunStatus(ctx.db, importRunId);
    expect(estado?.status).toBe("PREVIEWED");
    expect(estado?.blockingErrors).toBe(0);

    const recusado = await lerAteConferir(
      planilha("EMPURRADA_2_10_2041", "DOI2A22"),
      "2041-10-01",
    );
    expect(recusado.run.status).toBe("VALIDATION_ERROR");
    await expect(preview(ctx.db, recusado.importRunId)).rejects.toThrow(
      /requires STAGED or PREVIEWED/,
    );
    const estadoRecusado = await getImportRunStatus(ctx.db, recusado.importRunId);
    expect(estadoRecusado?.blockingErrors).toBe(1);
  });
});

describe("a quinzena declarada, recusada antes de abrir o arquivo", () => {
  it("aceita o dia em que cada quinzena começa", () => {
    expect(exigirQuinzenaDeclarada("2026-08-01")).toBe("2026-08-01");
    expect(exigirQuinzenaDeclarada("2026-08-16")).toBe("2026-08-16");
  });

  it("recusa um dia que não começa quinzena nenhuma", () => {
    // Aceitar `2026-08-07` criaria uma conferência que nunca casa: todo arquivo
    // seria recusado por divergir de uma quinzena que não existe.
    expect(() => exigirQuinzenaDeclarada("2026-08-07")).toThrow(/não começa uma quinzena/);
  });

  it("recusa o que não é data", () => {
    expect(() => exigirQuinzenaDeclarada("agosto")).toThrow(/AAAA-MM-DD/);
  });
});
