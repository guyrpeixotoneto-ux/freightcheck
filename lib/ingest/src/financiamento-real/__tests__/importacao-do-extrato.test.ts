import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";
import { captureRaw, preview, promote, receiveFile, stage } from "../../pipeline";
import { createTestDatabase, type TestDb } from "../../testing";
import { DATASET_FAMILY_FINANCIAMENTO_REAL } from "../../tipos";
import { estagiarExtratoReal, vincularLancamentosAosFatos } from "../estagio";

/**
 * O extrato de verdade atravessando o pipeline oficial, do arquivo ao fato.
 *
 * O que este arquivo prova é a costura: que o razão contábil entra por
 * `receiveFile` / `captureRaw` como qualquer outro arquivo, que o estágio o
 * consolida em `staged_fact`, e que dali em diante quem trabalha é o `promote`
 * de sempre — sem exceção para o acervo Real dentro dele.
 *
 * A regra de agregação em si é testada sem banco, em `extrato-real.test.ts`.
 * Aqui o que interessa é o que só o Postgres pode responder: a vigência mensal
 * que nasce, o escopo que fecha, o fato que aponta para a célula certa, a
 * revisão que a reimportação abre em vez de duplicar, e o rastreio que leva do
 * número consolidado de volta a cada lançamento.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ACERVO = path.resolve(AQUI, "../../../../../attached_assets");
const EXTRATO = path.join(ACERVO, "Finames_Real_2026.xlsx");
/**
 * O export de remuneração de verdade, importado **antes** do extrato.
 *
 * Não é cenário de conveniência: é a ordem em que as coisas acontecem na
 * operação, e é dela que sai o cadastro que resolve o tipo de cada placa. Das
 * 104 placas do extrato, 55 estão neste arquivo e 49 não — de modo que o mesmo
 * teste que prova o cruzamento prova também a fila de classificação, sem
 * nenhuma placa inventada dos dois lados.
 */
const REMUNERADO = path.join(ACERVO, "Modelo_Cavalo.xlsx");

/** A unidade que o envio declara — o extrato traz o nome, não o CNPJ. */
const UNIDADE_CNPJ = "07526557001505";
const UNIDADE_NOME = "CAMAÇARI";

let ctx: TestDb;

async function importarExtrato(arquivo = EXTRATO): Promise<{
  importRunId: string;
  duplicado: boolean;
  estagio: Awaited<ReturnType<typeof estagiarExtratoReal>> | null;
}> {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType: "CAVALO",
    declaredFamily: DATASET_FAMILY_FINANCIAMENTO_REAL,
  });
  /*
    O arquivo idêntico já é reconhecido pelo SHA-256 antes de qualquer leitura —
    é a primeira das três camadas de idempotência, e ela responde sem trabalho
    nenhum. Quando ela dispara, não há o que capturar nem estagiar.
  */
  if (recebido.isDuplicate) {
    return { importRunId: recebido.importRunId, duplicado: true, estagio: null };
  }
  await captureRaw(ctx.db, recebido.importRunId);
  const estagio = await estagiarExtratoReal(ctx.db, recebido.importRunId, {
    unidadeCnpj: UNIDADE_CNPJ,
    unidadeNome: UNIDADE_NOME,
  });
  /*
    A pré-visualização é a mesma de sempre: é ela que transforma staging em
    "pronto para promover", com os impedimentos na mão de quem aprova. O acervo
    Real não a pula — se pulasse, teria um caminho de aprovação só dele.
  */
  await preview(ctx.db, recebido.importRunId);
  return { importRunId: recebido.importRunId, duplicado: false, estagio };
}

/** O acervo remunerado, pelo caminho de sempre: é ele que povoa a frota. */
async function importarRemunerado(): Promise<void> {
  const recebido = await receiveFile(ctx.db, {
    filePath: REMUNERADO,
    declaredType: "CAVALO",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId);
  await promote(ctx.db, recebido.importRunId);
}

beforeAll(async () => {
  ctx = await createTestDatabase("extrato_financiamento_real");
  await importarRemunerado();
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o extrato do ERP entra pelo pipeline oficial", () => {
  let importRunId: string;
  let estagio: Awaited<ReturnType<typeof estagiarExtratoReal>>;

  beforeAll(async () => {
    const resultado = await importarExtrato();
    importRunId = resultado.importRunId;
    estagio = resultado.estagio!;
    await promote(ctx.db, importRunId);
    await vincularLancamentosAosFatos(ctx.db, importRunId);
  }, 600_000);

  it("captura as duas abas em RAW, inclusive a que não participa da apuração", async () => {
    /*
      A Planilha2 é um de-para de 24 mil linhas que não entra em conta nenhuma.
      Ela não é descartada em silêncio: fica em RAW, com o papel e o motivo
      gravados, e é assim que o relatório pode dizer "recebida e não apurada".
    */
    const { rows } = await ctx.db.execute<{
      sheet_name: string;
      role: string;
      role_reason: string;
    }>(sql`
      SELECT sheet_name, role, role_reason
        FROM raw_sheet
       WHERE import_run_id = ${importRunId}::uuid
       ORDER BY sheet_index
    `);
    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe("SOURCE");
    expect(rows[0].role_reason).toContain("razão contábil do ERP");
    expect(rows[1].role).toBe("PIVOT");
  });

  it("abre uma vigência mensal por competência, e nenhuma quinzenal", async () => {
    const { rows } = await ctx.db.execute<{
      source_label: string;
      effective_date: string;
      granularidade: string | null;
      dataset_family: string;
      canal: string;
    }>(sql`
      SELECT source_label, effective_date::text, granularidade, dataset_family, canal
        FROM snapshot
       WHERE import_run_id = ${importRunId}::uuid AND status <> 'SUPERSEDED'
       ORDER BY effective_date
    `);

    expect(rows).toHaveLength(9);
    expect(rows[0].source_label).toBe("EMPURRADA_MENSAL_1_2026");
    expect(rows[0].effective_date).toBe("2026-01-01");
    // A marca que distingue esta vigência da 1ª quinzena, que cai no mesmo dia.
    expect(rows.every((r) => r.granularidade === "MENSAL")).toBe(true);
    expect(rows.every((r) => r.dataset_family === DATASET_FAMILY_FINANCIAMENTO_REAL)).toBe(
      true,
    );
    expect(rows.every((r) => r.canal === "EMPURRADA")).toBe(true);
  });

  it("a unidade declarada no envio fecha o escopo obrigatório da vigência", async () => {
    const { rows } = await ctx.db.execute<{ scope_type: string; code: string }>(sql`
      SELECT s.scope_type, s.code
        FROM snapshot_scope ss
        JOIN scope s ON s.id = ss.scope_id
        JOIN snapshot sn ON sn.id = ss.snapshot_id
       WHERE sn.import_run_id = ${importRunId}::uuid
       GROUP BY s.scope_type, s.code
    `);
    expect(rows).toEqual([{ scope_type: "UNIDADE", code: UNIDADE_CNPJ }]);
  });

  it("grava um fato por placa por competência — o consolidado, não o lançamento", async () => {
    const { rows } = await ctx.db.execute<{ n: string; codigo: string }>(sql`
      SELECT count(*)::text AS n, a.code AS codigo
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id
        JOIN snapshot s ON s.id = f.snapshot_id
       WHERE s.import_run_id = ${importRunId}::uuid AND a.code LIKE '%finame_real'
       GROUP BY a.code
    `);
    const total = rows.reduce((soma, r) => soma + Number(r.n), 0);
    expect(total).toBe(estagio.apuracao.consolidados.length);
    // 903 lançamentos viraram menos fatos: é a agregação acontecendo.
    expect(total).toBeLessThan(903);
  });

  it("o fato aponta para a célula do valor, e os lançamentos levam ao resto", async () => {
    /*
      `fact.raw_cell_id` é uma célula só, e um consolidado nasce de várias. O
      fato ancora na primeira linha aceita do grupo; `finame_real_lancamento`
      guarda todas, com o documento contábil de cada uma. É isso que faz "clicar
      no número e ver de onde ele veio" ser uma consulta, e não uma promessa.
    */
    const { rows } = await ctx.db.execute<{
      coluna: string;
      valor: string;
      lancamentos: string;
    }>(sql`
      SELECT c.column_header AS coluna,
             f.value_numeric::text AS valor,
             (SELECT count(*)::text
                FROM finame_real_lancamento l
               WHERE l.import_run_id = ${importRunId}::uuid
                 AND l.grupo_hash = (
                   SELECT l2.grupo_hash FROM finame_real_lancamento l2
                    WHERE l2.raw_row_id = c.raw_row_id
                 )) AS lancamentos
        FROM fact f
        JOIN raw_cell c ON c.id = f.raw_cell_id
        JOIN attribute a ON a.id = f.attribute_id
       WHERE a.code LIKE '%finame_real'
       ORDER BY (SELECT count(*) FROM finame_real_lancamento l3
                  WHERE l3.grupo_hash = (SELECT l4.grupo_hash FROM finame_real_lancamento l4
                                          WHERE l4.raw_row_id = c.raw_row_id)) DESC
       LIMIT 1
    `);
    expect(rows[0].coluna).toBe("VLRREA");
    // O grupo mais cheio tem mais de um lançamento — a agregação real.
    expect(Number(rows[0].lancamentos)).toBeGreaterThan(1);
  });

  it("guarda todos os 903 lançamentos, com status e motivo", async () => {
    const { rows } = await ctx.db.execute<{ status: string; n: string }>(sql`
      SELECT status, count(*)::text AS n
        FROM finame_real_lancamento
       WHERE import_run_id = ${importRunId}::uuid
       GROUP BY status
       ORDER BY status
    `);
    const total = rows.reduce((soma, r) => soma + Number(r.n), 0);
    expect(total).toBe(903);

    const duplicadas = rows.find((r) => r.status === "DUPLICATA_PROVAVEL");
    expect(Number(duplicadas?.n ?? 0)).toBe(5);

    const { rows: semMotivo } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
        FROM finame_real_lancamento
       WHERE import_run_id = ${importRunId}::uuid
         AND status <> 'ACEITO' AND motivo IS NULL
    `);
    // Nenhum lançamento fora da soma sem dizer por quê.
    expect(semMotivo[0].n).toBe("0");
  });

  it("a duplicata provável não entra no fato, e continua no banco", async () => {
    const { rows } = await ctx.db.execute<{ placa: string; n: string }>(sql`
      SELECT placa, count(*)::text AS n
        FROM finame_real_lancamento
       WHERE import_run_id = ${importRunId}::uuid AND status = 'DUPLICATA_PROVAVEL'
       GROUP BY placa
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBe("5");
    // Sem snapshot e sem fato: ficou de fora da vigência, e não sumiu.
    const { rows: soltas } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
        FROM finame_real_lancamento
       WHERE import_run_id = ${importRunId}::uuid
         AND status = 'DUPLICATA_PROVAVEL' AND fact_id IS NOT NULL
    `);
    expect(soltas[0].n).toBe("0");
  });

  it("cada lançamento aceito aponta para o fato que compõe", async () => {
    /*
      O rastreio só fecha depois da promoção: no estágio o fato ainda não
      existe. Sem este passo a tela mostraria o consolidado sem conseguir dizer
      de quantos documentos ele veio — a soma sem origem que este produto não
      entrega. O defeito apareceu na tela, e não no teste: a expansão da placa
      dizia "0 lançamentos" ao lado de um valor que tinha dois.
    */
    const { rows } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
        FROM finame_real_lancamento
       WHERE import_run_id = ${importRunId}::uuid
         AND status = 'ACEITO' AND fact_id IS NULL
    `);
    expect(rows[0].n).toBe("0");

    /* E o inverso: todo fato do Real tem pelo menos um lançamento por trás. */
    const { rows: orfaos } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
        JOIN snapshot s ON s.id = f.snapshot_id
       WHERE s.import_run_id = ${importRunId}::uuid
         AND NOT EXISTS (
           SELECT 1 FROM finame_real_lancamento l WHERE l.fact_id = f.id
         )
    `);
    expect(orfaos[0].n).toBe("0");
  });

  it("a reconciliação fecha com o razão de origem", () => {
    expect(estagio.reconciliacao.fecha).toBe(true);
    expect(estagio.reconciliacao.totalDoExtrato).toBeCloseTo(10198831.18, 1);
  });

  it("a placa do real é a mesma entidade da placa do remunerado", async () => {
    /*
      A metade que o `entity_type` sustenta: `entity_identifier` é único por
      (tipo, valor), então a placa que o extrato traz com hífen precisa cair na
      mesma chave normalizada do export de remuneração. Sem isso o real falaria
      de veículos que o remunerado não conhece.
    */
    const { rows } = await ctx.db.execute<{ valor: string; n: string }>(sql`
      SELECT identifier_value AS valor, count(*)::text AS n
        FROM entity_identifier
       WHERE identifier_type = 'PLACA'
       GROUP BY identifier_value
      HAVING count(*) > 1
    `);
    expect(rows).toEqual([]);

    const { rows: comHifen } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
        FROM entity_identifier
       WHERE identifier_type = 'PLACA' AND identifier_value LIKE '%-%'
    `);
    expect(comHifen[0].n).toBe("0");

    /*
      E o cruzamento propriamente dito: placas que têm remuneração **e**
      realizado, na mesma entidade. Sem a normalização da placa este número
      seria zero, e a auditoria não teria o que comparar.
    */
    const { rows: cruzadas } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM (
        SELECT f.entity_id
          FROM fact f
          JOIN snapshot s ON s.id = f.snapshot_id
         GROUP BY f.entity_id
        HAVING count(DISTINCT s.dataset_family) > 1
      ) AS ambos
    `);
    expect(Number(cruzadas[0].n)).toBeGreaterThan(50);
  });
});

describe("a reimportação", () => {
  it("o mesmo arquivo é reconhecido pelo SHA-256, sem reler nada", async () => {
    const antes = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM snapshot WHERE status <> 'SUPERSEDED'
    `);

    const segundo = await importarExtrato();
    expect(segundo.duplicado).toBe(true);

    const depois = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM snapshot WHERE status <> 'SUPERSEDED'
    `);
    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  }, 600_000);

  it("outro arquivo com o mesmo conteúdo não abre uma segunda vigência ativa", async () => {
    /*
      A camada seguinte, e a que importa de verdade: o ERP reexporta o mesmo mês
      e o arquivo sai com outros bytes — outra data de geração, outra ordem de
      linhas. O SHA-256 não pega isso. O que pega é a identidade canônica da
      vigência mais o hash do conteúdo normalizado: mesmo dado, mesma vigência,
      nenhuma revisão aberta e nada duplicado.
    */
    const original = XLSX.read(readFileSync(EXTRATO), { type: "buffer" });
    const copia = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(copia, original.Sheets["Planilha1"], "Planilha1");
    const caminho = path.join(tmpdir(), `extrato-reexportado-${Date.now()}.xlsx`);
    writeFileSync(caminho, XLSX.write(copia, { type: "buffer", bookType: "xlsx" }));

    const antes = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM snapshot WHERE status <> 'SUPERSEDED'
    `);

    const reexportado = await importarExtrato(caminho);
    expect(reexportado.duplicado).toBe(false);
    // O estágio continua determinístico: as mesmas 903 linhas, o mesmo total.
    expect(reexportado.estagio!.apuracao.lancamentos).toHaveLength(903);
    expect(reexportado.estagio!.reconciliacao.fecha).toBe(true);

    await promote(ctx.db, reexportado.importRunId);

    const depois = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM snapshot WHERE status <> 'SUPERSEDED'
    `);
    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  }, 600_000);
});
