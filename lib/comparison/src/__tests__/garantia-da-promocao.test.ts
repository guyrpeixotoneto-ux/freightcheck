import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha, type PlanilhaSpec } from "@workspace/ingest/testing/planilha";
import { seedTaxonomy } from "@workspace/curation";
import { garantirComparacoesDaPromocao, type GarantiaDaPromocao } from "../garantia";
import { listarVigenciasDaAuditoria } from "../gerencial";
import { listChangeSets } from "../query";

/**
 * O caso real, escrito como teste: **EMPURRADA_Cavalo**.
 *
 * Cinco unidades num arquivo consolidado, seis vigências quinzenais de junho a
 * agosto, e portanto 25 transições consecutivas — cinco séries de cinco. Antes
 * desta garantia, a importação terminava com **nenhuma** delas materializada:
 * `change_set` só nascia quando alguém abria a tela de Alterações, e essa tela
 * calcula um par por vez (o mais recente da série). A Visão Gerencial, que por
 * decisão de projeto só lê o que está gravado, publicava o resultado disso na
 * home — "4% · 1 de 25 vigências comparada" e cinco cartões em "sem
 * comparação" — sem que nada tivesse dado errado na importação.
 *
 * O que este arquivo prova, na ordem em que a promessa foi feita:
 *
 * 1. promover as seis vigências deixa as 25 comparações prontas — 25/25, e não
 *    o último par de cada unidade;
 * 2. promover de novo não recalcula nem duplica nada;
 * 3. as cinco primeiras vigências de série continuam sem comparação, porque
 *    não há anterior — e as quinzenas anteriores a junho continuam sem
 *    vigência nenhuma, que é ausência de histórico e não trabalho atrasado.
 */

let ctx: TestDb;

const UNIDADES = [
  { nome: "CAMAÇARI", cnpj: "07.526.557/0015-05", placas: ["CAM1A11", "CAM2A22"] },
  { nome: "PERNAMBUCO", cnpj: "07.526.557/0134-02", placas: ["PER1B11", "PER2B22"] },
  { nome: "CDD CEBRASA", cnpj: "07.526.557/0221-30", placas: ["CEB1C11", "CEB2C22"] },
  { nome: "EQUATORIAL", cnpj: "07.526.557/0310-08", placas: ["EQU1D11", "EQU2D22"] },
  { nome: "MANAUS", cnpj: "03.134.910/0002-36", placas: ["MAN1E11", "MAN2E22"] },
];

/** As seis quinzenas que o arquivo real trouxe, na ordem em que chegaram. */
const VIGENCIAS = [
  { label: "EMPURRADA_1_6_2026", data: "2026-06-01" },
  { label: "EMPURRADA_2_6_2026", data: "2026-06-02" },
  { label: "EMPURRADA_1_7_2026", data: "2026-07-01" },
  { label: "EMPURRADA_2_7_2026", data: "2026-07-02" },
  { label: "EMPURRADA_1_8_2026", data: "2026-08-01" },
  { label: "EMPURRADA_2_8_2026", data: "2026-08-02" },
];

const UNIDADES_NO_ARQUIVO = UNIDADES.length;
const PARES_ESPERADOS = UNIDADES_NO_ARQUIVO * (VIGENCIAS.length - 1);

/**
 * O arquivo consolidado de uma quinzena: as cinco unidades na mesma aba.
 *
 * O custo fixo sobe a cada vigência para que a comparação tenha o que
 * encontrar — uma série de valores idênticos daria 25 comparações de zero
 * alterações, que é verdade demais para provar que o motor rodou.
 */
function planilhaDaQuinzena(indice: number): PlanilhaSpec {
  const { label } = VIGENCIAS[indice];
  return {
    vigencia: label,
    abas: [
      {
        nome: "cavalos",
        linhas: UNIDADES.flatMap((unidade) =>
          unidade.placas.map((placa) => ({
            placa,
            unidadeCnpj: unidade.cnpj,
            unidadeNome: unidade.nome,
            valores: { "Custo Fixo": 4000 + indice * 100, "Custo Variavel": 900 + indice * 10 },
          })),
        ),
      },
    ],
  };
}

async function importarEPromover(db: Database, spec: PlanilhaSpec): Promise<GarantiaDaPromocao> {
  const recebido = await receiveFile(db, { filePath: escreverPlanilha(spec) });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  const promovido = await promote(db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });

  expect(promovido.snapshots).toHaveLength(UNIDADES_NO_ARQUIVO);

  // É exatamente o que a rota POST /imports/:id/promote faz depois do commit.
  return garantirComparacoesDaPromocao(db, promovido.snapshotIds, {
    computedBy: "test:promocao",
  });
}

/** Quantos `change_set` existem no banco, sem filtro nenhum. */
async function totalDeChangeSets(): Promise<number> {
  const { rows } = await ctx.db.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM change_set`,
  );
  return rows[0].total;
}

let ultimaGarantia: GarantiaDaPromocao;

beforeAll(async () => {
  ctx = await createTestDatabase("garantia_promocao");
  await seedTaxonomy(ctx.db, "test");

  for (let i = 0; i < VIGENCIAS.length; i += 1) {
    ultimaGarantia = await importarEPromover(ctx.db, planilhaDaQuinzena(i));
  }
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("cinco unidades, seis vigências, vinte e cinco pares", () => {
  it("a promoção sai com todas as comparações consecutivas materializadas", async () => {
    const vigencias = await listarVigenciasDaAuditoria(ctx.db);

    expect(vigencias).toHaveLength(UNIDADES_NO_ARQUIVO * VIGENCIAS.length);

    const comparadas = vigencias.filter((v) => v.comparacao?.status === "DONE");
    const primeiras = vigencias.filter((v) => v.anterior === null);
    const pendentes = vigencias.filter((v) => v.anterior !== null && v.comparacao === null);

    // 25 de 25 — a conta que a home publicava como 1 de 25.
    expect(comparadas).toHaveLength(PARES_ESPERADOS);
    expect(primeiras).toHaveLength(UNIDADES_NO_ARQUIVO);
    expect(pendentes).toHaveLength(0);

    // E por unidade, para que "25" não possa ser 25 numa série só.
    const porUnidade = new Map<string, number>();
    for (const vigencia of comparadas) {
      const chave = vigencia.contexto.label;
      porUnidade.set(chave, (porUnidade.get(chave) ?? 0) + 1);
    }
    expect([...porUnidade.values()]).toEqual(Array(UNIDADES_NO_ARQUIVO).fill(VIGENCIAS.length - 1));
    expect([...porUnidade.keys()].sort()).toEqual(
      UNIDADES.map((u) => `${u.nome} · EMPURRADA`).sort(),
    );

    // O motor rodou de verdade: uma transição sem nenhuma alteração seria um
    // 25/25 que não compara coisa nenhuma.
    expect(comparadas.every((v) => v.comparacao!.alteracoes > 0)).toBe(true);
  });

  it("o retorno da promoção diz o que fez, por unidade", () => {
    expect(ultimaGarantia.unidades).toHaveLength(UNIDADES_NO_ARQUIVO);
    expect(ultimaGarantia.unidades.map((u) => u.rotulo).sort()).toEqual(
      UNIDADES.map((u) => `${u.nome} · EMPURRADA`).sort(),
    );

    // Na sexta promoção, cada unidade tinha quatro pares prontos e ganhou o
    // quinto — e nenhuma delas tem primeira de série a estrear de novo.
    expect(ultimaGarantia).toMatchObject({
      paresElegiveis: PARES_ESPERADOS,
      jaExistiam: PARES_ESPERADOS - UNIDADES_NO_ARQUIVO,
      calculados: UNIDADES_NO_ARQUIVO,
      semAnterior: UNIDADES_NO_ARQUIVO,
      falhas: [],
    });
    expect(ultimaGarantia.paresElegiveis).toBe(
      ultimaGarantia.jaExistiam + ultimaGarantia.calculados + ultimaGarantia.falhas.length,
    );
  });

  it("garantir de novo não recalcula nem duplica", async () => {
    const antes = await totalDeChangeSets();
    expect(antes).toBe(PARES_ESPERADOS);

    const { rows: ids } = await ctx.db.execute<{ id: string }>(sql`
      SELECT s.id FROM snapshot s
       WHERE s.status <> 'SUPERSEDED' AND s.effective_date = '2026-08-02'::date
    `);

    const denovo = await garantirComparacoesDaPromocao(
      ctx.db,
      ids.map((r) => r.id),
      { computedBy: "test:promocao" },
    );

    expect(denovo).toMatchObject({
      paresElegiveis: PARES_ESPERADOS,
      jaExistiam: PARES_ESPERADOS,
      calculados: 0,
      semAnterior: UNIDADES_NO_ARQUIVO,
      falhas: [],
    });
    expect(await totalDeChangeSets()).toBe(antes);
  });

  it("reimportar a mesma quinzena não inventa um par a mais", async () => {
    const antes = await totalDeChangeSets();

    // A mesma vigência de novo, com valores diferentes: é uma correção, e
    // correção se declara — a revisão anterior é superseded, não duplicada.
    const spec = planilhaDaQuinzena(VIGENCIAS.length - 1);
    spec.abas[0].linhas = spec.abas[0].linhas.map((linha) => ({
      ...linha,
      valores: { "Custo Fixo": 9999, "Custo Variavel": 111 },
    }));

    const recebido = await receiveFile(ctx.db, { filePath: escreverPlanilha(spec) });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    const promovido = await promote(ctx.db, recebido.importRunId, {
      onExistingSnapshot: "NEW_REVISION",
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    const garantia = await garantirComparacoesDaPromocao(ctx.db, promovido.snapshotIds, {
      computedBy: "test:promocao",
    });

    // A revisão nova entra no lugar da anterior: continuam 25 transições vivas,
    // e as cinco recalculadas são as da quinzena corrigida.
    expect(garantia).toMatchObject({
      paresElegiveis: PARES_ESPERADOS,
      calculados: UNIDADES_NO_ARQUIVO,
      jaExistiam: PARES_ESPERADOS - UNIDADES_NO_ARQUIVO,
      falhas: [],
    });

    const vigencias = await listarVigenciasDaAuditoria(ctx.db);
    expect(vigencias.filter((v) => v.comparacao?.status === "DONE")).toHaveLength(PARES_ESPERADOS);
    expect(vigencias.filter((v) => v.anterior !== null && v.comparacao === null)).toHaveLength(0);

    // O par da revisão superseded não some — ele é o histórico daquela
    // comparação —, mas nenhum par **vivo** foi duplicado.
    expect(await totalDeChangeSets()).toBeGreaterThanOrEqual(antes);
    const { rows } = await ctx.db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
        FROM change_set cs
        JOIN snapshot a ON a.id = cs.snapshot_a_id AND a.status <> 'SUPERSEDED'
        JOIN snapshot b ON b.id = cs.snapshot_b_id AND b.status <> 'SUPERSEDED'
    `);
    expect(rows[0].total).toBe(PARES_ESPERADOS);
  });

  it("reimportar uma quinzena não a duplica no seletor de vigência", async () => {
    // O seletor de vigência de Justificativas lê daqui (`listChangeSets`). A
    // quinzena reimportada no teste anterior tem uma revisão SUPERSEDED e uma
    // viva apontando pro mesmo `source_label`/`effective_date` — cada uma com
    // um `change_set` próprio. Sem filtrar a revisão morta, ela aparecia duas
    // vezes na lista, uma por `change_set`.
    const comparacoes = await listChangeSets(ctx.db);
    const rotulo = VIGENCIAS[VIGENCIAS.length - 1].label;
    const ocorrencias = comparacoes.filter((c) => c.snapshot_b_label === rotulo);

    expect(ocorrencias).toHaveLength(UNIDADES_NO_ARQUIVO);
  });

  it("o que não tem anterior continua sem comparação, e maio continua sem vigência", async () => {
    const vigencias = await listarVigenciasDaAuditoria(ctx.db);

    // A primeira quinzena de junho é a estreia de cada série: sem anterior,
    // sem comparação, e isso não é pendência.
    const estreias = vigencias.filter((v) => v.effectiveDate === "2026-06-01");
    expect(estreias).toHaveLength(UNIDADES_NO_ARQUIVO);
    expect(estreias.every((v) => v.anterior === null && v.comparacao === null)).toBe(true);

    // E antes de junho não há vigência nenhuma para comparar: a faixa do ano
    // desenha ausência, e a garantia não inventou uma série que a fonte não
    // publicou.
    const datas = [...new Set(vigencias.map((v) => v.effectiveDate))].sort();
    expect(datas).toEqual(VIGENCIAS.map((v) => v.data));
    expect(datas.filter((d) => d < "2026-06-01")).toHaveLength(0);
  });
});
