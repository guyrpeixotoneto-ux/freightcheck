import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  captureRaw,
  preview,
  promote,
  readTicketImport,
  receiveFile,
  receiveTicketFile,
  stage,
} from "@workspace/ingest";
import {
  createTestDatabase,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import {
  computeChangeSet,
  contextFilter,
  findPreviousSnapshot,
  getQuinzenaMatrix,
  type QuinzenaMatrix,
  getTicketTotals,
  listChanges,
  listComparableSnapshots,
  listContexts,
  listImpactParameters,
  listTicketChanges,
  resolveContext,
} from "@workspace/comparison";
import { vigenciasObservadas, visaoDaCobertura } from "@workspace/coverage";
import { encerrarPoolDoProcesso } from "@workspace/db";

/**
 * A matriz do Impacto, desembrulhada — e o vazio nomeado quando não há matriz.
 *
 * Desde o PR-18 `getQuinzenaMatrix` devolve `ComVazio<...>`: quatro causas de
 * vazio com nome, em vez de um `null` que servia para as quatro. Estes testes
 * esperam matriz; quando ela não vem, a falha diz **qual** dos quatro estados
 * apareceu, que é a diferença entre "quebrou" e "quebrou aqui".
 */
async function matrizDoImpacto(
  ...args: Parameters<typeof getQuinzenaMatrix>
): Promise<QuinzenaMatrix> {
  const r = await getQuinzenaMatrix(...args);
  if (!r.ok) throw new Error(`Impacto sem matriz — ${r.vazio.estado}: ${r.vazio.frase}`);
  return r.valor;
}

/**
 * Propagação — o dado que entrou por uma das duas portas chega a todo módulo
 * que tem motivo para vê-lo.
 *
 * Estas provas não medem cálculo. Cada número desta suíte já é conferido no
 * pacote que o produz — a comparação em `lib/comparison`, a cobertura em
 * `lib/coverage`, o impacto em `impacto-real.test.ts`. O que **ninguém** estava
 * conferindo é a costura entre eles, e é uma classe de defeito própria: o dado
 * está no banco, e uma área do produto não sabe que ele existe.
 *
 * Esse defeito não aparece em teste de módulo, por construção. O teste da
 * Cobertura carrega a Cobertura e afirma sobre o que ela vê; se o Impacto vir
 * outro conjunto de vigências, os dois passam. É preciso um teste que carregue
 * os dois e os obrigue a **concordar sobre a existência do mesmo dado** — e é
 * só isso que este arquivo faz.
 *
 * A régua é sempre a mesma, e vale a pena escrevê-la uma vez: o canônico é o
 * censo. Um módulo pode legitimamente mostrar *menos* do que ele — Impacto
 * recorta por contexto, Cobertura recorta por janela — mas o recorte tem de ser
 * **declarado e verificável**, nunca a diferença entre duas consultas que
 * ninguém comparou. Onde o recorte é o mesmo, o conjunto tem de ser o mesmo.
 *
 * As divergências que hoje quebram essa regra estão em
 * `propagacao-divergencias.test.ts`, com dado sintético, porque o export real
 * não as exercita — uma unidade, um canal, entrega completa em todas as
 * vigências. Ver `docs/AUDITORIA-INGESTAO-PROPAGACAO.md`.
 */

let ctx: TestDb;

/** As vigências vivas do canônico — o censo contra o qual todo módulo é medido. */
async function vigenciasVivas(): Promise<string[]> {
  const { rows } = await ctx.db.execute<{ d: string }>(sql`
    SELECT DISTINCT effective_date::text AS d
      FROM snapshot
     WHERE status <> 'SUPERSEDED'
     ORDER BY 1
  `);
  return rows.map((r) => r.d);
}

/** Os equipamentos que o canônico tem fato de — não o que o rótulo declara. */
async function equipamentosComFato(): Promise<string[]> {
  const { rows } = await ctx.db.execute<{ t: string }>(sql`
    SELECT DISTINCT e.entity_type AS t
      FROM fact f
      JOIN entity e   ON e.id = f.entity_id
      JOIN snapshot s ON s.id = f.snapshot_id
     WHERE s.status <> 'SUPERSEDED'
     ORDER BY 1
  `);
  return rows.map((r) => r.t);
}

beforeAll(async () => {
  ctx = await createTestDatabase("propagacao_vigencia");

  // As duas entregas por equipamento, que é como o arquivo chega hoje. A
  // segunda entra como revisão da vigência que a primeira abriu — é justamente
  // essa fusão que faz o censo do canônico ser um só.
  const { carreta, cavalo } = modelExportPaths();
  for (const arquivo of [carreta, cavalo]) {
    const recebido = await receiveFile(ctx.db, { filePath: arquivo });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    await promote(ctx.db, recebido.importRunId, {
      onExistingSnapshot: "NEW_REVISION",
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });
  }

  await seedTaxonomy(ctx.db, "teste:propagacao");
  await runProposalPass(ctx.db, "teste:propagacao");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
}, 900_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});
}, 60_000);

describe("porta 1 — a vigência importada chega a todo módulo que a consome", () => {
  it("existe no canônico: vigência fechada, com fato e com equipamento", async () => {
    const datas = await vigenciasVivas();
    expect(datas.length).toBeGreaterThan(1);

    const { rows } = await ctx.db.execute<{
      status: string;
      fatos: number;
      equipamentos: number;
    }>(sql`
      SELECT s.status::text AS status,
             (SELECT count(*)::int FROM fact f WHERE f.snapshot_id = s.id) AS fatos,
             (SELECT count(*)::int FROM snapshot_entity_type t WHERE t.snapshot_id = s.id) AS equipamentos
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
    `);
    for (const linha of rows) {
      expect(linha.status).toBe("CLOSED");
      expect(Number(linha.fatos)).toBeGreaterThan(0);
      // Sem o agregado por equipamento a vigência cai fora da matriz de
      // Cobertura e vira uma linha de "incompleto" — dado presente, tela vazia.
      expect(Number(linha.equipamentos)).toBeGreaterThan(0);
    }
  }, 120_000);

  it("aparece na lista de vigências — o mesmo conjunto que o canônico tem", async () => {
    const datas = await vigenciasVivas();
    const listadas = await listComparableSnapshots(ctx.db);
    expect([...new Set(listadas.map((s) => s.effectiveDate))].sort()).toEqual(datas);
  }, 120_000);

  it("aparece no seletor de contexto, e o contexto conta os períodos que existem", async () => {
    const contextos = await listContexts(ctx.db);
    expect(contextos.length).toBeGreaterThan(0);

    const datas = await vigenciasVivas();
    const somaDosPeriodos = contextos.reduce((total, c) => total + c.periods, 0);
    // Um contexto por realidade de negócio: a soma dos períodos de todos os
    // contextos não pode passar do número de vigências que existem. Passar
    // significaria que a mesma vigência foi contada em dois contextos; ficar
    // abaixo, que alguma não tem contexto nenhum.
    expect(somaDosPeriodos).toBe(datas.length);
  }, 120_000);

  it("aparece em Cobertura — todas as vigências vivas, nenhuma a menos", async () => {
    const datas = await vigenciasVivas();
    const observadas = await vigenciasObservadas(ctx.db);
    expect([...new Set(observadas.map((v) => v.effectiveDate))].sort()).toEqual(datas);

    // E a matriz da tela mostra o mesmo, dentro da janela que ela declara.
    const visao = await visaoDaCobertura(ctx.db, { vigencias: datas.length });
    expect(visao.colunas.length).toBe(datas.length);
    expect(visao.incompleto).toEqual([]);
  }, 300_000);

  it("fica disponível para Alterações — toda vigência tem anterior, menos a primeira", async () => {
    const vivas = await ctx.db.execute<{ id: string; d: string }>(sql`
      SELECT id::text, effective_date::text AS d
        FROM snapshot
       WHERE status <> 'SUPERSEDED'
       ORDER BY effective_date
    `);
    const semAnterior: string[] = [];
    for (const s of vivas.rows) {
      if (!(await findPreviousSnapshot(ctx.db, s.id)).encontrada) semAnterior.push(s.d);
    }
    // Exatamente uma: a primeira da série. Mais de uma quer dizer que a série
    // se partiu em duas e que Alterações vai responder "não há anterior com que
    // comparar" para uma vigência que tem, sim, uma anterior no banco.
    expect(semAnterior).toEqual([vivas.rows[0].d]);
  }, 300_000);

  it("fica disponível para comparação — o par mais recente produz alterações apuradas", async () => {
    const vivas = await listComparableSnapshots(ctx.db);
    const ultima = vivas[vivas.length - 1];
    const anterior = await findPreviousSnapshot(ctx.db, ultima.id);
    expect(anterior.encontrada).toBe(true);
    if (!anterior.encontrada) return;

    const conjunto = await computeChangeSet(
      ctx.db,
      anterior.vigencia.snapshotId,
      ultima.id,
      { computedBy: "teste:propagacao" },
    );
    expect(conjunto.valueChanges).toBeGreaterThan(0);

    const { total } = await listChanges(ctx.db, conjunto.id, {});
    expect(total).toBeGreaterThan(0);
  }, 300_000);

  it("aparece em Impacto — uma coluna por vigência do contexto, e nenhuma some", async () => {
    const contexto = await resolveContext(ctx.db);
    expect(contexto).not.toBeNull();

    /*
      O recorte vem de `contextFilter`, e não de um `WHERE` escrito aqui.

      Escrevê-lo à mão era o que esta prova fazia, e foi ela que quebrou quando
      o contexto deixou de ser chaveado por `scope_hash` — pela razão certa: um
      teste que remonta a definição de contexto por conta própria é mais um
      módulo discordando dos outros, que é o defeito que a suíte existe para
      pegar. Perguntar à autoridade é o que o produto tem de fazer, e portanto é
      o que a prova tem de fazer.
    */
    const { rows } = await ctx.db.execute<{ d: string }>(sql`
      SELECT DISTINCT s.effective_date::text AS d
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", contexto!)}
       ORDER BY 1
    `);

    const matriz = await matrizDoImpacto(ctx.db, {});
    expect(matriz.periods.map((p) => p.effectiveDate)).toEqual(rows.map((r) => r.d));
  }, 300_000);

  it("todo equipamento com fato é escolhível em Impacto, e tem parâmetro", async () => {
    const equipamentos = await equipamentosComFato();
    const matriz = await matrizDoImpacto(ctx.db, {});
    expect([...matriz.entityTypes].sort()).toEqual(equipamentos);

    // Um equipamento sem parâmetro numérico fazia `getQuinzenaMatrix` devolver
    // `null`, e a rota traduzia isso em "Nenhuma vigência importada ainda." — a
    // frase errada para o estado errado. Desde o PR-18 aquele caso é
    // `NAO_SE_APLICA`, com a frase que manda conferir a curadoria.
    for (const tipo of equipamentos) {
      const parametros = await listImpactParameters(ctx.db, tipo);
      expect(parametros.length, `sem parâmetro numérico para ${tipo}`).toBeGreaterThan(0);
    }
  }, 300_000);
});

describe("porta 2 — o chamado importado chega onde chamado tem significado", () => {
  let ticketImportId: string;
  /** Uma placa e um parâmetro que **existem** no canônico, para haver "antes". */
  let placa: string;
  let parametro: string;
  let vigencia: string;
  let antes: number;
  let depois: number;

  beforeAll(async () => {
    /*
      O alvo é escolhido pelo banco, e escolhido de forma determinística.

      Precisa ser um parâmetro numérico com valor na vigência mais recente e
      cujo cabeçalho não tenha vírgula — o arquivo de chamados é um CSV, e uma
      vírgula no nome da coluna partiria a linha em duas. Não é rigor do
      produto: é o formato do fixture.
    */
    const [alvo] = (
      await ctx.db.execute<{
        placa: string;
        source_name: string;
        label: string;
        valor: string;
      }>(sql`
        SELECT ei.identifier_value  AS placa,
               a.source_name        AS source_name,
               s.source_label       AS label,
               f.value_numeric::text AS valor
          FROM fact f
          JOIN snapshot s           ON s.id = f.snapshot_id AND s.status <> 'SUPERSEDED'
          JOIN attribute a          ON a.id = f.attribute_id
          JOIN entity_identifier ei ON ei.entity_id = f.entity_id
                                   AND ei.is_current
                                   AND ei.identifier_type = 'PLACA'
         WHERE a.data_type = 'NUMERIC'
           AND NOT f.is_null
           AND a.source_name NOT LIKE '%,%'
           AND s.effective_date = (SELECT max(effective_date) FROM snapshot WHERE status <> 'SUPERSEDED')
         ORDER BY a.code, ei.identifier_value
         LIMIT 1
      `)
    ).rows;
    placa = alvo.placa;
    parametro = alvo.source_name;
    vigencia = alvo.label;
    antes = Number(alvo.valor);
    /*
      O valor pedido é deliberadamente distante do atual.

      O leitor de chamados recusa apurar impacto quando os dois lados são os
      mesmos algarismos com o separador decimal deslocado — `1,00` contra
      `100` —, porque ali a subtração mediria formatação e não custo. Um valor
      próximo cairia nessa recusa, e o teste passaria a medir a heurística em
      vez da propagação.
    */
    depois = Math.round((antes + 1234.57) * 100) / 100;

    const dir = mkdtempSync(path.join(tmpdir(), "propagacao-chamados-"));
    const arquivo = path.join(dir, "chamados.csv");
    writeFileSync(
      arquivo,
      [
        `Chamado,Status,Item,Vig. Abertura,Operação,"${parametro}"`,
        `CH-ATENDIDO,Concluído,Placa: ${placa},${vigencia},SET,${depois}`,
        `CH-ABERTO,Em atendimento,Placa: ${placa},${vigencia},SET,${depois}`,
      ].join("\n"),
      "utf8",
    );

    const recebido = await receiveTicketFile(ctx.db, {
      filePath: arquivo,
      filename: "chamados.csv",
    });
    ticketImportId = recebido.ticketImportId;
    await readTicketImport(ctx.db, ticketImportId);
  }, 300_000);

  it("aparece na aba Chamados, com os dois chamados do arquivo", async () => {
    const { rows, total } = await listTicketChanges(ctx.db, ticketImportId, {});
    expect(total).toBe(2);
    expect(rows.map((r) => r.parameterLabel)).toEqual([parametro, parametro]);
  }, 120_000);

  it("liga-se ao canônico: o parâmetro resolve no dicionário e o antes vem da vigência", async () => {
    const { rows } = await listTicketChanges(ctx.db, ticketImportId, {});
    for (const linha of rows) {
      // A ligação é o que permite a um chamado e a uma alteração de planilha
      // falarem do mesmo parâmetro. Sem ela o chamado continua existindo, e
      // deixa de ser cruzável com o resto do produto.
      expect(linha.attributeCode, "chamado não ligou ao dicionário").not.toBeNull();
      expect(linha.beforeSource).toBe("VIGENCIA");
      expect(linha.beforeReference).toBe(vigencia);
      expect(Number(linha.valueBeforeNumeric)).toBeCloseTo(antes, 6);
    }
  }, 120_000);

  it("o impacto só é afirmado no chamado atendido — o aberto fica sem número", async () => {
    const { rows } = await listTicketChanges(ctx.db, ticketImportId, {});
    const atendido = rows.find((r) => r.externalId === "CH-ATENDIDO");
    const aberto = rows.find((r) => r.externalId === "CH-ABERTO");
    expect(atendido?.impactConfidence).toBe("CALCULATED");
    expect(aberto?.impactConfidence).toBe("NOT_CALCULABLE");
    // "Sem impacto apurável" e "sem dado" são estados diferentes, e o segundo
    // não pode ser escrito no lugar do primeiro: o motivo é obrigatório.
    expect(aberto?.impactReason).toBeTruthy();

    const totais = await getTicketTotals(ctx.db, ticketImportId);
    expect(totais.calculated).toBe(1);
    expect(totais.notCalculable).toBe(1);
  }, 120_000);

  it("não vira alteração de vigência: o chamado não entra em `change`", async () => {
    // A propriedade central da tela: as duas contas nunca se somam. Um chamado
    // que virasse `change` contaria em dobro toda mudança pedida por chamado e
    // depois observada na planilha.
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM "change"
       WHERE numeric_after = ${String(depois)}::numeric
    `);
    expect(Number(rows[0].n)).toBe(0);
  }, 120_000);

  it("não entra na cobertura nem no Impacto — chamado não é fato de vigência", async () => {
    // Chamado não é dado de cobertura: ele não declara o que a vigência
    // deveria trazer, e contá-lo ali inflaria o denominador com um documento
    // que não é entrega de vigência nenhuma.
    const datas = await vigenciasVivas();
    const observadas = await vigenciasObservadas(ctx.db);
    expect([...new Set(observadas.map((v) => v.effectiveDate))].sort()).toEqual(datas);

    const contexto = await resolveContext(ctx.db);
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT s.effective_date)::int AS n
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", contexto!)}
    `);
    const matriz = await matrizDoImpacto(ctx.db, {});
    expect(matriz!.periods.length).toBe(Number(rows[0].n));
  }, 300_000);
});
