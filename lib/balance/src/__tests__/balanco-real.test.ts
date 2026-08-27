import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  captureRaw,
  preview,
  receiveFile,
  stage,
} from "@workspace/ingest";
import {
  criarBancoComModelosPromovidos,
  realExportPath,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { balancoDaImportacao, listarBalancos } from "../balanco";
import { DESTINOS, ORDEM_DESTINOS } from "../destinos";

/**
 * O Rastreio de Dados sobre o export real.
 *
 * Este arquivo é o que dá direito à tela de existir. Um balanço que não fecha
 * sobre o próprio arquivo do cliente não é uma tela imprecisa: é uma tela que
 * afirma conservação sem ter conferido, o que é pior que não afirmar nada.
 *
 * As três afirmações que ele prova, e que nenhuma outra suíte prova:
 *
 * 1. **Nenhuma célula some.** A soma dos destinos declarados é exatamente o
 *    número de células capturadas em RAW, e o resíduo é zero.
 * 2. **Os totais das telas concordam entre si.** A lista e o detalhe são a
 *    mesma classificação; se um dia divergirem, é aqui que se descobre.
 * 3. **A etapa 2 distingue esperar de perder.** Uma importação conferida e não
 *    aprovada tem toda a massa parada no STAGING — e isso fecha, com o motivo
 *    escrito, em vez de aparecer como perda.
 */

let ctx: TestDb;
/** A importação que fica em PREVIEWED de propósito: massa esperando aprovação. */
let runNaoPromovido: string;

beforeAll(async () => {
  ctx = await criarBancoComModelosPromovidos("balance_real");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  // O export combinado, lido e conferido, e deliberadamente não aprovado.
  const recebido = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId);
  runNaoPromovido = recebido.importRunId;
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("etapa 1 — arquivo → staging", () => {
  it("dá destino declarado a cada célula capturada, e não sobra nenhuma", async () => {
    const balancos = await listarBalancos(ctx.db);
    expect(balancos).toHaveLength(3);

    for (const balanco of balancos) {
      const somaDosDestinos = balanco.destinos.reduce((t, d) => t + d.celulas, 0);

      expect(balanco.entrada).toBeGreaterThan(0);
      expect(somaDosDestinos).toBe(balanco.entrada);
      expect(balanco.entrada).toBe(balanco.entradaRegistrada);
      expect(balanco.capturaConfere).toBe(true);
      expect(balanco.residuo).toBe(0);
      expect(balanco.fecha).toBe(true);
    }
  });

  it("confere com a contagem crua de RAW, importação por importação", async () => {
    const balancos = await listarBalancos(ctx.db);
    const { rows } = await ctx.db.execute<{ run_id: string; celulas: number }>(sql`
      SELECT s.import_run_id AS run_id, count(*)::int AS celulas
      FROM raw_sheet s
      JOIN raw_row r  ON r.raw_sheet_id = s.id
      JOIN raw_cell c ON c.raw_row_id = r.id
      GROUP BY s.import_run_id
    `);
    const cruas = new Map(rows.map((r) => [r.run_id, r.celulas]));

    for (const balanco of balancos) {
      expect(balanco.entrada).toBe(cruas.get(balanco.importRunId));
    }
  });

  it("só emite destinos que a lista declara", async () => {
    /*
      A consulta e `destinos.ts` são duas declarações da mesma coisa, e é
      possível mexer numa sem mexer na outra. Um ramo novo no `CASE` sem entrada
      na lista faz `destino()` recusar — e é essa recusa que este caso exercita
      sobre o arquivo real, em vez de deixá-la para o dia em que a tela somasse
      menos do que classificou, em silêncio.
    */
    expect(ORDEM_DESTINOS).toEqual(DESTINOS.map((d) => d.code));
    expect(new Set(ORDEM_DESTINOS).size).toBe(ORDEM_DESTINOS.length);

    const balancos = await listarBalancos(ctx.db);
    for (const balanco of balancos) {
      expect(balanco.destinos.map((d) => d.code)).toEqual(ORDEM_DESTINOS);
    }
  });

  it("classifica a massa do export do cliente como fato, cabeçalho e grão", async () => {
    const balancos = await listarBalancos(ctx.db);
    const balanco = balancos.find((b) => b.importRunId === runNaoPromovido)!;

    // O export real não tem aba de pivô nem coluna órfã: tudo o que ele traz é
    // fato, o cabeçalho que nomeia as colunas, e as duas colunas de grão.
    expect(balanco.porNatureza.FATO).toBeGreaterThan(0);
    expect(balanco.porNatureza.OUTRO_PAPEL).toBeGreaterThan(0);
    expect(balanco.porNatureza.PERDA).toBe(0);
    expect(balanco.porNatureza.RESIDUO).toBe(0);
  });

  it("quebra por aba sem perder nem inventar célula", async () => {
    const detalhe = (await balancoDaImportacao(ctx.db, runNaoPromovido))!;
    const somaDasAbas = detalhe.etapa1.porAba.reduce((t, a) => t + a.celulas, 0);
    expect(somaDasAbas).toBe(detalhe.entrada);
    expect(detalhe.etapa1.porAba.length).toBeGreaterThan(0);
  });
});

describe("lista e detalhe", () => {
  it("contam a mesma coisa sobre a mesma importação", async () => {
    const balancos = await listarBalancos(ctx.db);
    for (const resumo of balancos) {
      const detalhe = (await balancoDaImportacao(ctx.db, resumo.importRunId))!;
      expect(detalhe.entrada).toBe(resumo.entrada);
      expect(detalhe.residuo).toBe(resumo.residuo);
      expect(detalhe.fecha).toBe(resumo.fecha);
      expect(detalhe.destinos).toEqual(resumo.destinos);
    }
  });

  it("responde nulo para uma importação que não existe", async () => {
    const inexistente = "00000000-0000-4000-8000-000000000000";
    expect(await balancoDaImportacao(ctx.db, inexistente)).toBeNull();
  });
});

describe("etapa 2 — staging → canônico", () => {
  it("promove tudo o que preparou, vigência por vigência", async () => {
    const balancos = await listarBalancos(ctx.db);
    const promovidos = balancos.filter((b) => b.status === "PROMOTED");
    expect(promovidos.length).toBe(2);

    for (const resumo of promovidos) {
      const { etapa2 } = (await balancoDaImportacao(ctx.db, resumo.importRunId))!;

      expect(etapa2.preparados).toBeGreaterThan(0);
      // Uma célula, um fato: se estes dois números divergirem, alguma célula
      // originou dois fatos — e um deles está contando massa que não existe.
      expect(etapa2.celulasDeOrigem).toBe(etapa2.preparados);
      expect(etapa2.promovidos).toBe(etapa2.preparados);
      expect(etapa2.naoPromovidos).toBe(0);
      expect(etapa2.porQueNaoPromoveu).toBeNull();
      expect(etapa2.fecha).toBe(true);

      expect(etapa2.vigencias.length).toBeGreaterThan(0);
      for (const vigencia of etapa2.vigencias) {
        expect(vigencia.snapshotId).not.toBeNull();
        expect(vigencia.promovidos).toBe(vigencia.preparados);
        expect(vigencia.declarados).toBe(vigencia.promovidos);
        // Todo fato promovido aponta para uma célula deste mesmo arquivo.
        expect(vigencia.comLastroNoArquivo).toBe(vigencia.promovidos);
        expect(vigencia.fecha).toBe(true);
      }
    }
  });

  it("chama de espera, e não de perda, a importação ainda não aprovada", async () => {
    const { etapa2, status } = (await balancoDaImportacao(ctx.db, runNaoPromovido))!;

    expect(status).toBe("PREVIEWED");
    expect(etapa2.preparados).toBeGreaterThan(0);
    expect(etapa2.promovidos).toBe(0);
    expect(etapa2.naoPromovidos).toBe(etapa2.preparados);
    expect(etapa2.porQueNaoPromoveu).toMatch(/aguardando aprovação/i);
    expect(etapa2.fecha).toBe(true);

    // Os rótulos aparecem mesmo sem vigência: massa parada tem endereço.
    expect(etapa2.vigencias.length).toBeGreaterThan(0);
    for (const vigencia of etapa2.vigencias) {
      expect(vigencia.snapshotId).toBeNull();
      expect(vigencia.preparados).toBeGreaterThan(0);
    }
  });
});

describe("etapa 3 — o portão da semântica", () => {
  it("separa o que pode ser somado do que ainda não pode", async () => {
    const balancos = await listarBalancos(ctx.db);
    const promovido = balancos.find((b) => b.status === "PROMOTED")!;
    const { etapa2, etapa3 } = (await balancoDaImportacao(ctx.db, promovido.importRunId))!;

    expect(etapa3.fatos).toBe(etapa2.promovidos);
    expect(etapa3.podeSomar + etapa3.semPreco).toBe(etapa3.fatos);
    expect(etapa3.podeSomar).toBeGreaterThan(0);
    expect(etapa3.ausencias).toBeLessThanOrEqual(etapa3.fatos);

    const soma = etapa3.porSemantica.reduce((t, s) => t + s.fatos, 0);
    expect(soma).toBe(etapa3.fatos);
  });

  it("não conta fato nenhum onde nada foi promovido", async () => {
    const { etapa3 } = (await balancoDaImportacao(ctx.db, runNaoPromovido))!;
    expect(etapa3.fatos).toBe(0);
    expect(etapa3.podeSomar).toBe(0);
    expect(etapa3.semPreco).toBe(0);
    expect(etapa3.porSemantica).toEqual([]);
  });
});
