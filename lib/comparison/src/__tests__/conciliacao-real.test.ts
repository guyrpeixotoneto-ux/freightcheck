import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { readTicketImport, receiveTicketFile } from "@workspace/ingest";
import {
  baseAtualizadaPath,
  chamadosExportPath,
  createTestDatabase,
  importFixture,
  type TestDb,
} from "@workspace/ingest/testing";
import { computeChangeSet } from "../engine";
import {
  linhasDaConciliacao,
  linhasPorParametro,
  resumoDaConciliacao,
  resumoPorParametro,
} from "../conciliacao-de-chamados";

/**
 * A CONCILIAÇÃO CONTRA OS DOIS ARQUIVOS DE VERDADE.
 *
 * Este é o primeiro teste do repositório que põe um export de chamados real de
 * um lado e a base de vigências real do outro. Enquanto ele não existiu, o
 * caminho dos chamados só foi exercitado contra fixtures inventadas — e três
 * coisas que nenhuma delas tinha só apareceram quando os arquivos chegaram:
 *
 * 1. **O arquivo tem mais de uma aba.** A leitura parava em `SheetNames[0]` e
 *    2.349 dos 3.400 chamados sumiam sem entrar em conta nenhuma.
 * 2. **O chamado quase nunca nomeia a placa.** `Item` vem com `-` em 3.394 das
 *    3.400 linhas, e o grão `(placa, parâmetro)` não alcança nada.
 * 3. **`Campo Alteração` é o vocabulário da base.** Vem em camelCase
 *    (`placaCarreta`, `dataFimContrato`), igual ao cabeçalho da planilha de
 *    vigência, e é isso que torna o grão por parâmetro possível.
 *
 * Os números abaixo foram medidos nos próprios arquivos, fora deste código,
 * antes de serem esperados aqui — contando linha a linha nas duas planilhas.
 * Eles são o contrato: se mudarem, ou o arquivo mudou ou a leitura regrediu, e
 * as duas coisas precisam de alguém olhando.
 */

let ctx: TestDb;
let envioId: string;
/** As duas comparações que o envio de chamados cobre. */
let agosto: string;
let setembro: string;

beforeAll(async () => {
  ctx = await createTestDatabase("conciliacao_real");
  await importFixture(ctx.db, baseAtualizadaPath());
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const recebido = await receiveTicketFile(ctx.db, {
    filePath: chamadosExportPath(),
  });
  envioId = recebido.ticketImportId;
  await readTicketImport(ctx.db, envioId);

  const { rows } = await ctx.db.execute<{
    id: string;
    source_label: string;
  }>(sql`
    SELECT id, source_label FROM snapshot
  `);
  const porRotulo = new Map(rows.map((r) => [r.source_label, r.id]));
  const id = (rotulo: string) => {
    const encontrado = porRotulo.get(rotulo);
    if (!encontrado) throw new Error(`A base não tem a vigência ${rotulo}.`);
    return encontrado;
  };

  agosto = (
    await computeChangeSet(
      ctx.db,
      id("EMPURRADA_1_8_2026"),
      id("EMPURRADA_2_8_2026"),
    )
  ).id;
  setembro = (
    await computeChangeSet(
      ctx.db,
      id("EMPURRADA_2_8_2026"),
      id("EMPURRADA_1_9_2026"),
    )
  ).id;
}, 900_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o export de chamados entra inteiro", () => {
  it("lê as duas abas, e a conta fecha sobre o arquivo todo", async () => {
    const { rows } = await ctx.db.execute<Record<string, unknown>>(sql`
      SELECT row_count, ticket_count, ignored_row_count
        FROM ticket_import WHERE id = ${envioId}::uuid
    `);
    /* 2.349 em Agosto_EXPORTACAO_HISTORICO e 1.051 em Setembro_. Enquanto a
       leitura parava na primeira aba, este número era 1.051 — e nada dizia que
       faltavam dois terços do arquivo. */
    expect(Number(rows[0].row_count)).toBe(3400);
    expect(Number(rows[0].ticket_count)).toBe(3400);
    expect(Number(rows[0].ignored_row_count)).toBe(0);
  });

  it("guarda de que aba veio cada chamado, e a linha dentro dela", async () => {
    const { rows } = await ctx.db.execute<{
      source_sheet: string;
      n: string;
      primeira: string;
    }>(sql`
      SELECT source_sheet, count(*) AS n, min(source_sheet_row) AS primeira
        FROM ticket WHERE ticket_import_id = ${envioId}::uuid
       GROUP BY 1 ORDER BY 1
    `);
    expect(rows.map((r) => [r.source_sheet, Number(r.n)])).toEqual([
      ["Agosto_EXPORTACAO_HISTORICO", 2349],
      ["Setembro_EXPORTACAO_HISTORICO", 1051],
    ]);
    /* A linha 2 nas duas — a primeira depois do cabeçalho, que é o número que
       quem abrir a planilha vê ao clicar em cada aba. */
    expect(rows.map((r) => Number(r.primeira))).toEqual([2, 2]);

    /* Já `source_row_index` conta o arquivo inteiro, e é por isso que ele
       continua único por envio com várias abas. */
    const { rows: posicoes } = await ctx.db.execute<{
      n: string;
      distintas: string;
    }>(sql`
      SELECT count(*) AS n, count(DISTINCT source_row_index) AS distintas
        FROM ticket WHERE ticket_import_id = ${envioId}::uuid
    `);
    expect(Number(posicoes[0].distintas)).toBe(Number(posicoes[0].n));
  });

  it("cobre as três vigências que o arquivo nomeia", async () => {
    const { rows } = await ctx.db.execute<{
      vigencia_label: string;
      n: string;
    }>(sql`
      SELECT vigencia_label, count(*) AS n
        FROM ticket WHERE ticket_import_id = ${envioId}::uuid
       GROUP BY 1 ORDER BY 1
    `);
    /* `Vig. Abertura` casa com `snapshot.source_label` — é o vocabulário comum
       entre os dois arquivos, e é o que o recorte por vigência usa. */
    expect(rows.map((r) => [r.vigencia_label, Number(r.n)])).toEqual([
      ["EMPURRADA_1_8_2026", 1225],
      ["EMPURRADA_1_9_2026", 1051],
      ["EMPURRADA_2_8_2026", 1124],
    ]);
  });
});

describe("o que o arquivo permite conciliar, e o que ele não permite", () => {
  it("quase nenhum chamado nomeia placa — e é isso que o grão por ativo precisa", async () => {
    const { rows } = await ctx.db.execute<Record<string, unknown>>(sql`
      SELECT count(*)                                          AS total,
             count(*) FILTER (WHERE t.entity_label IS NOT NULL) AS com_placa,
             count(*) FILTER (WHERE tc.attribute_code IS NOT NULL) AS com_parametro
        FROM ticket_change tc
        JOIN ticket t ON t.id = tc.ticket_id
       WHERE tc.ticket_import_id = ${envioId}::uuid
    `);
    expect(Number(rows[0].total)).toBe(3400);
    /* Seis. As únicas linhas em que `Item` traz "Placa: … | Placa Carreta: …". */
    expect(Number(rows[0].com_placa)).toBe(6);
    /* 153 têm parâmetro que o dicionário da base reconhece. Os outros 3.247 são
       quase todos `freteReaisViagemPedagio`, que é parâmetro de frete e não
       existe na base de equipamentos — eles não são conciliáveis contra ela, e
       o resumo os publica em vez de escondê-los. */
    expect(Number(rows[0].com_parametro)).toBe(153);
  });

  it("o grão por ativo não alcança este arquivo, e o diz sem disfarce", async () => {
    const resumo = await resumoDaConciliacao(ctx.db, {
      changeSetId: agosto,
      ticketImportId: envioId,
    });

    /* Nenhum par conciliado — não porque os dois lados discordem, mas porque
       não há placa nos chamados por que cruzá-los. */
    expect(resumo.conciliadas).toBe(0);
    expect(resumo.placasEmComum).toBe(0);
    /* E o número que explica isso vem ao lado, no mesmo resumo: 3.394 das 3.400
       alterações de chamado ficaram fora por falta de chave. Sem ele, os 103
       SEM_CHAMADO leriam como "a Ambev mudou 103 coisas e ninguém pediu". */
    expect(resumo.chamados.foraDaConciliacao).toBe(3394);
    expect(resumo.semChamado).toBe(103);
  });

  /**
   * O achado que só o grão por parâmetro produz, e o motivo de ele existir.
   *
   * Em `EMPURRADA_2_8_2026` a Ambev trocou a carreta acoplada de 22 cavalos, e
   * o envio traz 22 chamados `SET` em `placaCarreta`. Os dois lados batem, e
   * nenhuma das duas telas anteriores dizia isso: a de comparação mostra 22
   * alterações, a de chamados mostra 22 pedidos, e ninguém as confrontava.
   */
  it("concilia placaCarreta: 22 trocas na planilha, 22 chamados que as pediram", async () => {
    const { linhas } = await linhasPorParametro(
      ctx.db,
      { changeSetId: agosto, ticketImportId: envioId },
      { search: "placa_carreta" },
    );
    const placaCarreta = linhas.find(
      (l) => l.attributeCode === "cavalo.placa_carreta",
    )!;

    expect(placaCarreta.situacao).toBe("CONCILIADA");
    expect(placaCarreta.alteracoesNaPlanilha).toBe(22);
    expect(placaCarreta.placasNaPlanilha).toBe(22);
    expect(placaCarreta.chamados).toBe(22);
    expect(placaCarreta.operacoes).toEqual([
      { changeKind: "SET", chamados: 22 },
    ]);
    /* O rótulo cru do arquivo, que é por onde quem opera procura. */
    expect(placaCarreta.parameterLabel).toBe("placaCarreta");
    /* E a força de prova, dita: nenhum dos 22 chamados nomeia a placa, então o
       que se afirma é que os totais batem — não que este chamado é daquele
       cavalo. */
    expect(placaCarreta.chamadosComPlaca).toBe(0);
  });

  it("o mesmo par continua invisível para o grão por ativo", async () => {
    const { linhas } = await linhasDaConciliacao(
      ctx.db,
      { changeSetId: agosto, ticketImportId: envioId },
      { search: "placa_carreta" },
    );
    expect(linhas).not.toHaveLength(0);
    /* Todas as 22, sem exceção, como "a planilha mudou e ninguém pediu" — que é
       falso, e é o que o outro grão corrige. */
    expect(linhas.every((l) => l.situacao === "SEM_CHAMADO")).toBe(true);
  });

  it("publica o que ficou fora, e as situações somam o total", async () => {
    const resumo = await resumoPorParametro(ctx.db, {
      changeSetId: agosto,
      ticketImportId: envioId,
    });

    expect(
      resumo.conciliados +
        resumo.divergentes +
        resumo.semChamado +
        resumo.semAlteracao,
    ).toBe(resumo.parametros);
    expect(resumo.chamados).toBe(153);
    expect(resumo.chamadosForaDaConciliacao).toBe(3247);
    /* 153 + 3.247 = 3.400: o total do arquivo fecha, que é a única defesa
       contra esta tela parecer completa sobre o que ela lê em 4%. */
    expect(resumo.chamados + resumo.chamadosForaDaConciliacao).toBe(3400);
    /* A planilha continua com o mesmo total do outro grão. */
    expect(resumo.alteracoesNaPlanilha).toBe(103);
    expect(resumo.conciliados).toBe(1);
  });

  it("recorta pela vigência comparada, e o recorte alcança os chamados", async () => {
    /* Sem recorte, os chamados das três vigências do arquivo entram. Com ele,
       só os que nomeiam uma das duas vigências desta comparação — e a diferença
       é grande o bastante para valer a pergunta na tela. */
    const inteiro = await resumoPorParametro(ctx.db, {
      changeSetId: setembro,
      ticketImportId: envioId,
    });
    const recortado = await resumoPorParametro(ctx.db, {
      changeSetId: setembro,
      ticketImportId: envioId,
      somenteVigenciaComparada: true,
    });

    expect(inteiro.chamados).toBe(153);
    expect(recortado.chamados).toBe(22);
    expect(recortado.chamados).toBeLessThan(inteiro.chamados);
  });
});
