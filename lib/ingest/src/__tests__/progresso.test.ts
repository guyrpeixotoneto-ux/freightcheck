import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { importRunTable } from "@workspace/db";
import { captureRaw, preview, receiveFile, stage } from "../pipeline";
import { getImportRunStatus } from "../history";
import {
  INTERVALO_DE_PUBLICACAO_MS,
  PASSOS_POR_TRECHO,
  devePublicar,
  passoDe,
} from "../progresso";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";

/**
 * O progresso da leitura — medido enquanto ela acontece, ou não é progresso.
 *
 * ---------------------------------------------------------------------------
 * O caso
 * ---------------------------------------------------------------------------
 * O cartão de upload dizia "lendo…" do primeiro segundo ao último. Num arquivo
 * de dezenas de milhares de células isso são minutos com a mesma frase, e nela
 * não há como distinguir um leitor trabalhando de um processo que morreu — que
 * é exatamente a dúvida de quem está esperando para aprovar. O que faltava não
 * era desenho: `import_run` só descrevia trabalho **terminado**, e não havia
 * número honesto para uma barra mostrar.
 *
 * O que este arquivo prende é que o número existe e é medido: que ele aparece
 * **durante** a leitura e não só no fim dela (senão seria o mesmo 0% e 100% de
 * antes, com mais código), que ele nunca anda para trás, e que ele some quando
 * o trabalho acaba — um progresso que sobrevive ao fim descreve trabalho em
 * curso que não existe mais.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("progresso");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Uma planilha grande o bastante para a leitura ter meio, e não só pontas. */
function planilhaDeMilLinhas(): string {
  return escreverPlanilha({
    vigencia: "PROGRESSO_1_1_2026",
    abas: [
      {
        nome: "Cavalo",
        linhas: Array.from({ length: 1_000 }, (_, i) => ({
          placa: `PRG${String(i).padStart(4, "0")}`,
        })),
      },
    ],
  });
}

interface Amostra {
  step: string | null;
  done: number;
  total: number;
}

/**
 * Fotografa `import_run` enquanto outra coisa acontece.
 *
 * É a única forma de provar o que interessa. Ler o progresso depois do
 * `await` responderia sobre o estado final — que é justamente o que a versão
 * anterior da barra já sabia. O que precisa ser provado é o meio: que existe
 * número publicado enquanto o pipeline ainda está trabalhando.
 */
async function amostrandoProgresso<T>(
  importRunId: string,
  trabalho: () => Promise<T>,
): Promise<{ resultado: T; amostras: Amostra[]; fim: Amostra }> {
  const amostras: Amostra[] = [];
  let rodando = true;

  const observador = (async () => {
    while (rodando) {
      const [run] = await ctx.db
        .select({
          step: importRunTable.progressStep,
          done: importRunTable.progressDone,
          total: importRunTable.progressTotal,
        })
        .from(importRunTable)
        .where(eq(importRunTable.id, importRunId));
      if (run) amostras.push(run);
      await new Promise((r) => setTimeout(r, 15));
    }
  })();

  const resultado = await trabalho();
  rodando = false;
  await observador;

  /*
    A última foto é tirada depois, e não colhida do laço.

    O observador dorme 15 ms entre leituras, então a foto final dele pode ser
    anterior à última escrita do trabalho — e a pergunta "como o trecho ficou
    ao terminar" não admite essa corrida. As amostras respondem sobre o meio;
    esta responde sobre o fim.
  */
  const [fim] = await ctx.db
    .select({
      step: importRunTable.progressStep,
      done: importRunTable.progressDone,
      total: importRunTable.progressTotal,
    })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));

  return { resultado, amostras, fim: fim! };
}

/** As amostras em que um trecho estava sendo medido, na ordem em que saíram. */
function doTrecho(amostras: Amostra[], step: string): Amostra[] {
  return amostras.filter((a) => a.step === step);
}

describe("a regra de publicação", () => {
  it("cabe nos passos declarados, qualquer que seja o tamanho", () => {
    for (const total of [50, 1_000, 40_000, 1_000_000]) {
      expect(
        Math.ceil(total / passoDe(total)),
        String(total),
      ).toBeLessThanOrEqual(PASSOS_POR_TRECHO);
    }
  });

  /*
    O piso é o que faz a planilha pequena continuar publicando.

    Com vinte passos, trinta linhas dão um passo de duas — e quinze linhas, de
    uma. O número de escritas de uma planilha pequena nunca foi o problema: o
    que este piso impede é o passo virar zero e a barra parar.
  */
  it("uma planilha pequena publica quase linha a linha", () => {
    expect(passoDe(30)).toBe(2);
    expect(passoDe(15)).toBe(1);
  });

  it("não publica de novo quando nada andou", () => {
    expect(
      devePublicar({
        feito: 500,
        publicado: 500,
        total: 1_000,
        desdeAUltimaMs: 10 * INTERVALO_DE_PUBLICACAO_MS,
      }),
    ).toBe(false);
  });

  it("segura o leitor rápido: meio passo não publica", () => {
    const passo = passoDe(1_000);
    expect(
      devePublicar({
        feito: Math.floor(passo / 2),
        publicado: 0,
        total: 1_000,
        desdeAUltimaMs: 0,
      }),
    ).toBe(false);
    expect(
      devePublicar({ feito: passo, publicado: 0, total: 1_000, desdeAUltimaMs: 0 }),
    ).toBe(true);
  });

  it("solta o leitor lento: parado tempo demais publica o que tiver", () => {
    // Sem esta porta, um trecho enorme sob banco lento deixaria a barra parada
    // justamente onde a demora é maior — que é o que este módulo existe para
    // acabar.
    expect(
      devePublicar({
        feito: 1,
        publicado: 0,
        total: 1_000_000,
        desdeAUltimaMs: INTERVALO_DE_PUBLICACAO_MS,
      }),
    ).toBe(true);
  });
});

describe("o progresso da leitura, de ponta a ponta", () => {
  it("é publicado durante o trabalho, sobe sem voltar, e some no fim", async () => {
    const recebido = await receiveFile(ctx.db, {
      filePath: planilhaDeMilLinhas(),
      receivedBy: "teste",
    });

    const captura = await amostrandoProgresso(recebido.importRunId, () =>
      captureRaw(ctx.db, recebido.importRunId),
    );
    const naCaptura = doTrecho(captura.amostras, "CAPTURA");

    // O meio, que é o ponto do exercício: existe medida publicada enquanto o
    // arquivo ainda está sendo copiado, e não só depois.
    expect(
      naCaptura.some((a) => a.done > 0 && a.done < a.total),
      `amostras: ${JSON.stringify(naCaptura.slice(0, 20))}`,
    ).toBe(true);
    expect(naCaptura.every((a) => a.total > 0)).toBe(true);
    expect(naCaptura.every((a) => a.done <= a.total)).toBe(true);
    for (let i = 1; i < naCaptura.length; i++) {
      expect(naCaptura[i]!.done).toBeGreaterThanOrEqual(naCaptura[i - 1]!.done);
    }
    // A captura fecha cheia: uma barra que para para sempre em 92% num
    // trabalho que terminou mente na direção mais confusa.
    expect(captura.fim.step).toBe("CAPTURA");
    expect(captura.fim.done).toBe(captura.fim.total);

    const preparo = await amostrandoProgresso(recebido.importRunId, () =>
      stage(ctx.db, recebido.importRunId),
    );
    const noPreparo = doTrecho(preparo.amostras, "PREPARO");
    expect(noPreparo.some((a) => a.done > 0 && a.done < a.total)).toBe(true);
    for (let i = 1; i < noPreparo.length; i++) {
      expect(noPreparo[i]!.done).toBeGreaterThanOrEqual(noPreparo[i - 1]!.done);
    }

    // Terminado o preparo, nenhum trecho está em curso — e a tela lê isso como
    // ausência, voltando ao degrau do estado.
    const depois = await getImportRunStatus(ctx.db, recebido.importRunId);
    expect(depois?.status).toBe("STAGED");
    expect(depois?.progressStep).toBeNull();
    expect(depois?.progressDone).toBe(0);

    // E o arquivo entrou inteiro: medir não pode ter mudado o que é lido.
    await preview(ctx.db, recebido.importRunId);
    const conferido = await getImportRunStatus(ctx.db, recebido.importRunId);
    expect(conferido?.status).toBe("PREVIEWED");
    expect(conferido?.progressStep).toBeNull();
    expect(conferido?.facts).toBeGreaterThan(0);
    expect(conferido?.rawCells).toBeGreaterThan(0);
  }, 600_000);
});
