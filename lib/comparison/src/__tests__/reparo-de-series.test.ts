import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  reparoDeDadosTable,
  scopeTable,
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { processarEnvioDeChamados } from "../monitoramento-de-chamados";
import {
  REPARO_DA_SERIE,
  repararSeriesIndeterminadas,
  simularReparoDaSerie,
} from "../reparo-de-series";

/**
 * O REPARO AUTOMÁTICO DAS SÉRIES INDETERMINADAS, contra banco de verdade.
 *
 * Um backfill que roda sozinho na partida do servidor é a classe de código em
 * que um defeito não aparece como erro: aparece como dado diferente do que
 * alguém deixou. Por isso os casos abaixo são quase todos **recusas** — o que
 * ele não toca, o que ele não refaz, o que ele não adivinha —, e só depois o
 * que ele conserta.
 *
 * Cada bloco prende uma das garantias declaradas no cabeçalho de
 * `reparo-de-series.ts`.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("reparo_de_series");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

beforeEach(async () => {
  await ctx.db.execute(sql`DELETE FROM ticket_change`);
  await ctx.db.execute(sql`DELETE FROM ticket`);
  await ctx.db.execute(sql`DELETE FROM ticket_import`);
  await ctx.db.execute(sql`DELETE FROM scope`);
  await ctx.db.execute(sql`DELETE FROM reparo_de_dados`);
});

/** Um envio lido, com uma linha de chamado. O mínimo de que a série precisa. */
async function enviar({
  filename,
  unidade = null,
  recebidoEm,
  serie = null,
  serieOrigem = null,
  declarada,
  status = "READ" as const,
}: {
  filename: string;
  unidade?: string | null;
  recebidoEm: string;
  serie?: string | null;
  serieOrigem?: string | null;
  declarada?: string;
  status?: "READ" | "FAILED";
}): Promise<string> {
  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename,
      contentSha256: `sha-${filename}-${recebidoEm}`,
      byteSize: 1,
      status,
      receivedAt: new Date(recebidoEm),
      rowCount: 1,
      ticketCount: 1,
      serie,
      serieOrigem,
      ...(declarada === undefined ? {} : { serieDeclarada: declarada }),
    })
    .returning();

  const [t] = await ctx.db
    .insert(ticketTable)
    .values({
      ticketImportId: envio!.id,
      externalId: "CH-1",
      statusRaw: "Em análise",
      statusBucket: "EM_ANDAMENTO",
      unidadeRaw: unidade,
      sourceRowIndex: 1,
      changedParameterCount: 1,
    })
    .returning();

  await ctx.db.insert(ticketChangeTable).values({
    ticketId: t!.id,
    ticketImportId: envio!.id,
    parameterLabel: "Frete peso",
    valueAfterRaw: "100",
    beforeSource: "ARQUIVO",
    sourceColumnIndex: 0,
  });

  return envio!.id;
}

const cadastrar = async (...unidades: string[]) => {
  for (const [i, nome] of unidades.entries()) {
    await ctx.db
      .insert(scopeTable)
      .values({ scopeType: "UNIDADE", code: `cod-${i}`, name: nome });
  }
};

const serieDe = async (id: string) => {
  const [linha] = await ctx.db
    .select({
      serie: ticketImportTable.serie,
      origem: ticketImportTable.serieOrigem,
    })
    .from(ticketImportTable)
    .where(sql`${ticketImportTable.id} = ${id}::uuid`);
  return linha;
};

const DIA = "2026-09-04T21:19:00.000Z";
const ONTEM = "2026-09-03T21:19:00.000Z";

// ---------------------------------------------------------------------------
// O que ele conserta
// ---------------------------------------------------------------------------

describe("o reparo tira o envio da série indeterminada", () => {
  it("o caso real: `Chamados Agosto Camaçari.xlsx` com a coluna Unidade vazia", async () => {
    await cadastrar("CAMAÇARI", "PERNAMBUCO");
    const envio = await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      recebidoEm: DIA,
    });

    const r = await repararSeriesIndeterminadas(ctx.db);

    expect(r).toMatchObject({
      rodou: true,
      encontrados: 1,
      corrigidos: 1,
      ignorados: 0,
      falhas: 0,
    });
    expect(await serieDe(envio)).toMatchObject({
      serie: "CAMAÇARI",
      origem: "NOME_DO_ARQUIVO",
    });
  });

  it("grava o saldo e o detalhe, para a pergunta que se faz depois", async () => {
    await cadastrar("CAMAÇARI");
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });

    await repararSeriesIndeterminadas(ctx.db);

    const [linha] = await ctx.db.select().from(reparoDeDadosTable);
    expect(linha).toMatchObject({
      nome: REPARO_DA_SERIE,
      encontrados: 1,
      corrigidos: 1,
      falhas: 0,
    });
    expect(linha!.detalhe).toMatchObject([
      { filename: "Chamados Agosto Camaçari.xlsx", de: null, para: "CAMAÇARI" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// O que ele não toca — as recusas
// ---------------------------------------------------------------------------

describe("a série já estabelecida fica intacta", () => {
  it("não redecide um envio que já tem série, mesmo com o cadastro dizendo outra coisa", async () => {
    // O caso que faria estragos silenciosos: o cadastro conhece CAMAÇARI, o
    // arquivo se chama "Chamados Agosto Camaçari", e este envio já está em
    // `Recife`. Redecidir aqui moveria movimentações antigas para outra fila
    // sem que nada tivesse acontecido.
    await cadastrar("CAMAÇARI");
    const envio = await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      recebidoEm: DIA,
      serie: "Recife",
      serieOrigem: "ARQUIVO",
    });

    const r = await repararSeriesIndeterminadas(ctx.db);

    expect(r.encontrados).toBe(0);
    expect(await serieDe(envio)).toMatchObject({
      serie: "Recife",
      origem: "ARQUIVO",
    });
  });

  it("o recorte alcança só o indeterminado, com os dois tipos de envio no banco", async () => {
    await cadastrar("CAMAÇARI");
    const estabelecido = await enviar({
      filename: "Chamados_Recife.xlsx",
      recebidoEm: ONTEM,
      serie: "Recife",
      serieOrigem: "ARQUIVO",
    });
    const indeterminado = await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      recebidoEm: DIA,
    });

    const r = await repararSeriesIndeterminadas(ctx.db);

    expect(r.encontrados).toBe(1);
    expect(r.envios.map((e) => e.ticketImportId)).toEqual([indeterminado]);
    expect((await serieDe(estabelecido))!.serie).toBe("Recife");
  });

  it("o envio que não foi lido não entra — ele não pertence a série nenhuma", async () => {
    await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      recebidoEm: DIA,
      status: "FAILED",
    });

    expect((await repararSeriesIndeterminadas(ctx.db)).encontrados).toBe(0);
  });

  it("não apaga nem altera os chamados originais", async () => {
    await cadastrar("CAMAÇARI");
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });
    const antes = await ctx.db.select().from(ticketTable);
    const mudancasAntes = await ctx.db.select().from(ticketChangeTable);

    await repararSeriesIndeterminadas(ctx.db);

    expect(await ctx.db.select().from(ticketTable)).toEqual(antes);
    expect(await ctx.db.select().from(ticketChangeTable)).toEqual(mudancasAntes);
  });
});

describe("sem unidade correspondente, nada é vinculado em silêncio", () => {
  it("cai no texto do nome do arquivo, que não casa com unidade nenhuma", async () => {
    // Sem `CAMAÇARI` no cadastro: a série sai `Agosto Camaçari`, que separa
    // este envio dos outros e não se vincula a unidade nenhuma. É o que impede
    // os 2.349 chamados de serem somados a todas as unidades **sem** afirmar de
    // quem eles são.
    await cadastrar("PERNAMBUCO");
    const envio = await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      recebidoEm: DIA,
    });

    await repararSeriesIndeterminadas(ctx.db);

    expect(await serieDe(envio)).toMatchObject({
      serie: "Agosto Camaçari",
      origem: "NOME_DO_ARQUIVO",
    });
  });

  it("o arquivo que não diz nada continua indeterminado, e isso é `ignorados`", async () => {
    // Nem coluna, nem nome, nem declaração. A resposta certa é continuar nulo —
    // e `ignorados` é contado à parte de `falhas` justamente porque isto não é
    // uma falha.
    await cadastrar("CAMAÇARI");
    const envio = await enviar({ filename: "relatorio (3).xlsx", recebidoEm: DIA });

    const r = await repararSeriesIndeterminadas(ctx.db);

    expect(r).toMatchObject({ encontrados: 1, corrigidos: 0, ignorados: 1, falhas: 0 });
    expect((await serieDe(envio))!.serie).toBeNull();
  });

  it("duas unidades no mesmo nome não elegem nenhuma", async () => {
    await cadastrar("RECIFE", "CAMAÇARI");
    const envio = await enviar({
      filename: "Chamados Recife e Camaçari.xlsx",
      recebidoEm: DIA,
    });

    await repararSeriesIndeterminadas(ctx.db);

    // Não virou RECIFE nem CAMAÇARI: o nome inteiro, que não casa com as duas.
    expect((await serieDe(envio))!.serie).not.toBe("RECIFE");
    expect((await serieDe(envio))!.serie).not.toBe("CAMAÇARI");
  });
});

// ---------------------------------------------------------------------------
// Rodar de novo
// ---------------------------------------------------------------------------

describe("a segunda passada não produz alteração nenhuma", () => {
  it("não relê o acervo: a linha do registro já existe e o reparo sai", async () => {
    await cadastrar("CAMAÇARI");
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });
    const primeira = await repararSeriesIndeterminadas(ctx.db);

    const segunda = await repararSeriesIndeterminadas(ctx.db);

    expect(primeira.rodou).toBe(true);
    expect(segunda).toMatchObject({ rodou: false, encontrados: 0, corrigidos: 0 });
  });

  it("o estado do banco é byte a byte o mesmo depois da segunda e da terceira", async () => {
    await cadastrar("CAMAÇARI");
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });
    await enviar({ filename: "relatorio.xlsx", recebidoEm: ONTEM });
    await repararSeriesIndeterminadas(ctx.db);

    const retrato = async () => ({
      envios: await ctx.db.select().from(ticketImportTable).orderBy(ticketImportTable.receivedAt),
      registro: await ctx.db.select().from(reparoDeDadosTable),
    });
    const depoisDaPrimeira = await retrato();

    await repararSeriesIndeterminadas(ctx.db);
    await repararSeriesIndeterminadas(ctx.db);

    expect(await retrato()).toEqual(depoisDaPrimeira);
  });

  it("registra mesmo sem ter corrigido ninguém — senão reencontraria tudo em toda partida", async () => {
    // Um acervo em que nada é reparável. Sem a linha, a próxima partida
    // recomeçaria o mesmo trabalho para chegar ao mesmo lugar, para sempre.
    await enviar({ filename: "relatorio.xlsx", recebidoEm: DIA });

    const primeira = await repararSeriesIndeterminadas(ctx.db);
    const segunda = await repararSeriesIndeterminadas(ctx.db);

    expect(primeira).toMatchObject({ rodou: true, corrigidos: 0, ignorados: 1 });
    expect(segunda.rodou).toBe(false);
  });
});

describe("a falha de um envio é contida nele", () => {
  /**
   * Um `Database` que estoura na transação de um envio escolhido.
   *
   * A primeira transação da passada é a reivindicação; da segunda em diante é
   * uma por envio. Estourar a do meio é a única forma de provar, contra banco
   * de verdade, o que o `try/catch` por envio promete — que a falha de um não
   * leva os outros junto e não deixa aquele pela metade.
   */
  function comFalhaNoEnvio(db: typeof ctx.db, qual: number): typeof ctx.db {
    let n = 0;
    return new Proxy(db, {
      get(alvo, prop, receptor) {
        if (prop === "transaction") {
          return async (fn: unknown) => {
            n += 1;
            if (n === qual + 1) throw new Error("falha simulada no envio");
            return (alvo.transaction as (f: unknown) => Promise<unknown>).call(alvo, fn);
          };
        }
        return Reflect.get(alvo, prop, receptor);
      },
    }) as typeof ctx.db;
  }

  it("o envio que falha fica como estava; os outros são reparados", async () => {
    await cadastrar("CAMAÇARI", "RECIFE");
    const primeiro = await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      recebidoEm: ONTEM,
    });
    const segundo = await enviar({
      filename: "Chamados Recife.xlsx",
      recebidoEm: DIA,
    });

    const r = await repararSeriesIndeterminadas(comFalhaNoEnvio(ctx.db, 1));

    expect(r).toMatchObject({ encontrados: 2, corrigidos: 1, falhas: 1 });
    // O que falhou continua exatamente como estava — série nula.
    expect((await serieDe(primeiro))!.serie).toBeNull();
    // O outro foi em frente, que é o ponto de a transação ser por envio.
    expect((await serieDe(segundo))!.serie).toBe("RECIFE");
  });

  it("a falha vai para o registro com a mensagem, e não some no log", async () => {
    await cadastrar("CAMAÇARI");
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });

    await repararSeriesIndeterminadas(comFalhaNoEnvio(ctx.db, 1));

    const [linha] = await ctx.db.select().from(reparoDeDadosTable);
    expect(linha).toMatchObject({ falhas: 1, corrigidos: 0 });
    expect(linha!.detalhe).toMatchObject([{ erro: "falha simulada no envio" }]);
  });

  it("registra mesmo com falha — senão a partida seguinte repetiria o mesmo erro", async () => {
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });
    await repararSeriesIndeterminadas(comFalhaNoEnvio(ctx.db, 1));

    expect((await repararSeriesIndeterminadas(ctx.db)).rodou).toBe(false);
  });
});

describe("a corrida entre instâncias que sobem juntas", () => {
  it("quatro partidas simultâneas reparam uma vez só", async () => {
    // Autoscale: várias instâncias sobem ao mesmo tempo e todas chamam isto. A
    // trava é o que impede as quatro de disputarem as mesmas linhas da camada
    // derivada — e sem ela o desfecho não seria dado errado, seria deadlock.
    await cadastrar("CAMAÇARI");
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });

    const relatorios = await Promise.all([
      repararSeriesIndeterminadas(ctx.db),
      repararSeriesIndeterminadas(ctx.db),
      repararSeriesIndeterminadas(ctx.db),
      repararSeriesIndeterminadas(ctx.db),
    ]);

    expect(relatorios.filter((r) => r.rodou)).toHaveLength(1);
    expect(await ctx.db.select().from(reparoDeDadosTable)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A contagem que precede a decisão
// ---------------------------------------------------------------------------

describe("a simulação conta e não escreve", () => {
  it("diz em que cada envio viraria, sem tocar em nada", async () => {
    await cadastrar("CAMAÇARI");
    const envio = await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      recebidoEm: DIA,
    });

    const r = await simularReparoDaSerie(ctx.db);

    expect(r).toMatchObject({ rodou: false, encontrados: 1, corrigidos: 1 });
    expect(r.envios[0]).toMatchObject({ para: "CAMAÇARI", origem: "NOME_DO_ARQUIVO" });
    // Nada foi escrito: nem a série, nem a linha do registro.
    expect((await serieDe(envio))!.serie).toBeNull();
    expect(await ctx.db.select().from(reparoDeDadosTable)).toHaveLength(0);
  });

  it("não consome a execução: o reparo de verdade ainda roda depois dela", async () => {
    await cadastrar("CAMAÇARI");
    await enviar({ filename: "Chamados Agosto Camaçari.xlsx", recebidoEm: DIA });

    await simularReparoDaSerie(ctx.db);
    const r = await repararSeriesIndeterminadas(ctx.db);

    expect(r).toMatchObject({ rodou: true, corrigidos: 1 });
  });
});

// ---------------------------------------------------------------------------
// A cadeia que muda quando um envio entra numa série
// ---------------------------------------------------------------------------

describe("a régua de dias fica consistente com a série nova", () => {
  it("o envio reparado é comparado com o anterior da série em que entrou", async () => {
    // O anterior já estava em CAMAÇARI; o reparado entra nela. Sem recalcular a
    // cadeia, o dia do reparado continuaria gravado como se ele não tivesse
    // base — e a tela contaria a fila inteira como novidade.
    await cadastrar("CAMAÇARI");
    const anterior = await enviar({
      filename: "Chamados Agosto Camaçari.xlsx",
      unidade: "CAMAÇARI",
      recebidoEm: ONTEM,
    });
    await processarEnvioDeChamados(ctx.db, anterior);
    await enviar({ filename: "Chamados Agosto Camaçari (2).xlsx", recebidoEm: DIA });

    const r = await repararSeriesIndeterminadas(ctx.db);

    expect(r.corrigidos).toBe(1);
    const { rows } = await ctx.db.execute<{ tipo: string; base: string | null }>(
      sql`SELECT tipo::text AS tipo, base_import_id::text AS base
            FROM ticket_import_comparacao
           ORDER BY dia`,
    );
    // O primeiro é baseline; o reparado virou DIFF contra ele.
    expect(rows.map((l) => l.tipo)).toEqual(["BASELINE", "DIFF"]);
    expect(rows[1]!.base).toBe(anterior);
  });
});
