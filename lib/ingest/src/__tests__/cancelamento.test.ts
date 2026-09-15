import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { factTable, importCancelamentoTable, importRunTable, snapshotTable } from "@workspace/db";
import {
  captureRaw,
  devolverAoPreview,
  preview,
  promote,
  receiveFile,
  reservarPromocao,
  stage,
} from "../pipeline";
import {
  ImportacaoCancelada,
  encerrarComoCancelada,
  pedirCancelamento,
  porQueNaoCancelar,
} from "../cancelamento";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type LinhaSpec } from "./planilha-sintetica";

/**
 * Parar uma importação — e a prova de que parar não deixa meio dado entrar.
 *
 * ---------------------------------------------------------------------------
 * O caso que trouxe isto
 * ---------------------------------------------------------------------------
 * Uma planilha de trecho com 198.720 fatos, aprovada pela tela, e a tela
 * voltando a pedir a aprovação minutos depois — com a auditoria de Km Rodado
 * dizendo, do outro lado, que a unidade não tinha vigência de trecho nenhuma.
 * As duas coisas eram a mesma: a promoção rodava dentro da requisição, a
 * conexão caía antes do fim, a transação voltava atrás inteira e o run
 * reaparecia em PREVIEWED. Nada tinha entrado, e ninguém dizia isso.
 *
 * A correção tem duas metades, e este arquivo prende as duas:
 *
 *  - a promoção passa a ser **reservada** e a rodar fora da requisição
 *    (`reservarPromocao` + `promote(..., { reservado: true })`), de modo que o
 *    desfecho não dependa de a conexão sobreviver;
 *  - e o que demora passa a poder ser **parado**, que era o único gesto que o
 *    pipeline não tinha.
 *
 * ---------------------------------------------------------------------------
 * O que cada teste afirma
 * ---------------------------------------------------------------------------
 * Nunca "o botão some": sempre o estado do banco. Parar é uma promessa sobre o
 * acervo — nada entrou —, e é no acervo que ela se verifica.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("cancelamento");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const COLUNAS = ["Custo Fixo", "Custo Variavel"];

/** Um arquivo lido até o preview, pronto para a decisão. */
async function ateOPreview(vigencia: string, linhas = 40): Promise<string> {
  const spec: LinhaSpec[] = Array.from({ length: linhas }, (_, i) => ({
    placa: `TRECHO-${vigencia}-${i}`,
    valores: { "Custo Fixo": 1000 + i, "Custo Variavel": 2000 + i },
  }));
  const caminho = escreverPlanilha({
    vigencia,
    abas: [
      {
        nome: "trechos",
        identificador: "chaveTrecho",
        colunas: COLUNAS,
        linhas: spec,
      },
    ],
  });
  const recebido = await receiveFile(ctx.db, { filePath: caminho });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId);
  return recebido.importRunId;
}

async function estadoDe(importRunId: string): Promise<string> {
  const [run] = await ctx.db
    .select({ status: importRunTable.status })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  return run.status;
}

async function fatosDoRun(importRunId: string): Promise<number> {
  const [linha] = await ctx.db
    .select({ quantos: sql<number>`count(*)::int` })
    .from(factTable)
    .innerJoin(snapshotTable, eq(snapshotTable.id, factTable.snapshotId))
    .where(eq(snapshotTable.importRunId, importRunId));
  return linha?.quantos ?? 0;
}

describe("cancelar o que ainda não entrou", () => {
  it("uma importação conferida para na hora — não há ninguém trabalhando nela", async () => {
    const runId = await ateOPreview("EMPURRADA_1_3_2040");

    const pedido = await pedirCancelamento(ctx.db, runId, { por: "guy@ambev" });

    // `encerradoAgora` é a diferença entre "parei" e "vai parar": em PREVIEWED
    // não há leitor nem transação, e esperar um ponto de checagem que nunca vem
    // deixaria o cartão dizendo "parando…" para sempre.
    expect(pedido).toMatchObject({ status: "PREVIEWED", encerradoAgora: true });
    expect(await estadoDe(runId)).toBe("CANCELLED");
    expect(await fatosDoRun(runId)).toBe(0);

    const [registro] = await ctx.db
      .select()
      .from(importCancelamentoTable)
      .where(eq(importCancelamentoTable.importRunId, runId));
    expect(registro.pedidoPor).toBe("guy@ambev");
    // Atendido, e não só pedido: é o que separa o cancelamento que cancelou do
    // que chegou tarde.
    expect(registro.atendidoEm).not.toBeNull();
  });

  it("uma importação já cancelada não pode ser aprovada nem cancelada de novo", async () => {
    const runId = await ateOPreview("EMPURRADA_1_4_2040");
    await pedirCancelamento(ctx.db, runId);

    expect(porQueNaoCancelar(await estadoDe(runId))).toMatch(/já foi cancelada/i);
    // A reserva é a porta da promoção: fechada, não há promoção possível.
    expect(await reservarPromocao(ctx.db, runId)).toBe(false);
  });

  it("parar no meio da gravação não deixa meia vigência no acervo", async () => {
    const runId = await ateOPreview("EMPURRADA_1_5_2040");
    expect(await reservarPromocao(ctx.db, runId)).toBe(true);

    // O pedido chega enquanto a promoção ainda não começou a escrever. É a
    // mesma porta que ela encontraria no meio do caminho — a publicação de
    // progresso —, só que exercitada no primeiro ponto em vez de num ponto
    // sorteado, para que o teste afirme sempre a mesma coisa.
    await pedirCancelamento(ctx.db, runId, { por: "guy@ambev" });

    await expect(
      promote(ctx.db, runId, { reservado: true, confirmNewEntityTypes: ["TRECHO"] }),
    ).rejects.toBeInstanceOf(ImportacaoCancelada);

    // A transação voltou atrás inteira: nenhuma vigência, nenhum fato. É o que
    // torna parar seguro em qualquer ponto — o banco desfaz, não o código.
    const vigencias = await ctx.db
      .select({ id: snapshotTable.id })
      .from(snapshotTable)
      .where(eq(snapshotTable.importRunId, runId));
    expect(vigencias).toHaveLength(0);
    expect(await fatosDoRun(runId)).toBe(0);

    expect(await encerrarComoCancelada(ctx.db, runId)).toBe(true);
    expect(await estadoDe(runId)).toBe("CANCELLED");
  });

  it("uma importação que já entrou não se cancela — se exclui", async () => {
    const runId = await ateOPreview("EMPURRADA_1_6_2040");
    expect(await reservarPromocao(ctx.db, runId)).toBe(true);
    await promote(ctx.db, runId, { reservado: true, confirmNewEntityTypes: ["TRECHO"] });
    expect(await estadoDe(runId)).toBe("PROMOTED");

    const pedido = await pedirCancelamento(ctx.db, runId);
    expect(pedido).toMatchObject({ status: "PROMOTED", encerradoAgora: false });
    expect(porQueNaoCancelar("PROMOTED")).toMatch(/Excluir/);
    // E o estado não se mexeu: cancelar nunca desfaz o que foi aprovado.
    expect(await estadoDe(runId)).toBe("PROMOTED");
  });
});

describe("a reserva, que é o que tira a promoção de dentro da requisição", () => {
  it("promove sem travar a linha, e grava o mesmo que sempre gravou", async () => {
    const runId = await ateOPreview("EMPURRADA_1_7_2040");

    expect(await reservarPromocao(ctx.db, runId)).toBe(true);
    // Comitada antes de a promoção começar: é isso que faz a tela ter o que
    // mostrar mesmo que o processo morra no passo seguinte.
    expect(await estadoDe(runId)).toBe("PROMOTING");

    const resultado = await promote(ctx.db, runId, {
      reservado: true,
      confirmNewEntityTypes: ["TRECHO"],
    });

    expect(resultado.snapshots).toHaveLength(1);
    expect(await estadoDe(runId)).toBe("PROMOTED");
    expect(await fatosDoRun(runId)).toBeGreaterThan(0);

    // A barra não sobrevive ao desfecho: um progresso guardado aqui afirmaria
    // trabalho em curso que não existe mais.
    const [run] = await ctx.db
      .select({
        step: importRunTable.progressStep,
        total: importRunTable.progressTotal,
      })
      .from(importRunTable)
      .where(eq(importRunTable.id, runId));
    expect(run.step).toBeNull();
    expect(run.total).toBe(0);
  });

  it("a barra da promoção é legível de fora enquanto ela corre", async () => {
    // Grande o bastante para a gravação passar por mais de um lote — é entre um
    // lote e o seguinte que a medida é publicada, e é lá que o pedido de parar
    // é lido. Pequeno o bastante para o teste não virar um perfil de carga.
    const runId = await ateOPreview("EMPURRADA_1_11_2040", 3000);
    await reservarPromocao(ctx.db, runId);

    /*
      O ponto inteiro desta metade da correção: a medida sai por **fora** da
      transação. Escrita lá dentro, ela só apareceria no commit — que é
      exatamente quando ela deixa de importar. Quem lê aqui é uma segunda
      conexão, como a tela lê.
    */
    let viuMedida = false;
    const espiar = setInterval(() => {
      void ctx.db
        .select({ step: importRunTable.progressStep })
        .from(importRunTable)
        .where(eq(importRunTable.id, runId))
        .then(([run]) => {
          if (run?.step === "PROMOCAO") viuMedida = true;
        })
        .catch(() => {
          // A conexão pode cair junto com o fim do teste; não é o que se afirma.
        });
    }, 15);

    try {
      await promote(ctx.db, runId, {
        reservado: true,
        confirmNewEntityTypes: ["TRECHO"],
      });
    } finally {
      clearInterval(espiar);
    }

    expect(viuMedida).toBe(true);
    expect(await estadoDe(runId)).toBe("PROMOTED");
  });

  it("dois cliques disputam a reserva, e só um a leva", async () => {
    const runId = await ateOPreview("EMPURRADA_1_8_2040");

    const [primeiro, segundo] = await Promise.all([
      reservarPromocao(ctx.db, runId),
      reservarPromocao(ctx.db, runId),
    ]);

    // Um `UPDATE … WHERE status = 'PREVIEWED'` é atômico: o segundo não
    // encontra mais o estado que procurava. Era a corrida que a trava de linha
    // dentro da transação resolvia — e que ela só resolvia porque a promoção
    // inteira acontecia dentro da requisição.
    expect([primeiro, segundo].filter(Boolean)).toHaveLength(1);
    expect(await estadoDe(runId)).toBe("PROMOTING");
  });

  it("uma falha inesperada devolve o run a quem esperava decisão, com o motivo", async () => {
    const runId = await ateOPreview("EMPURRADA_1_9_2040");
    await reservarPromocao(ctx.db, runId);

    // A reserva é comitada, então o ROLLBACK da transação já não a desfaz. Sem
    // este passo, um erro no meio deixaria o run em PROMOTING para sempre.
    await devolverAoPreview(ctx.db, runId, "O banco recusou a escrita.");

    const [run] = await ctx.db
      .select({
        status: importRunTable.status,
        motivo: importRunTable.failureReason,
      })
      .from(importRunTable)
      .where(eq(importRunTable.id, runId));
    expect(run.status).toBe("PREVIEWED");
    expect(run.motivo).toBe("O banco recusou a escrita.");
    // E continua aprovável: a falha não consumiu a decisão de ninguém.
    expect(await reservarPromocao(ctx.db, runId)).toBe(true);
  });
});
