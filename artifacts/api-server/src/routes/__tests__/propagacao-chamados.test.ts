import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
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
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { encerrarPoolDoProcesso, type Database } from "@workspace/db";

/**
 * O "antes" de um chamado — divergência B6 da auditoria.
 *
 * Um chamado traz o valor novo de um parâmetro e quase nunca o antigo. O
 * produto completa: procura o último valor daquela placa no canônico e grava
 * `before_source = 'VIGENCIA'` com o rótulo em `before_reference`, para que a
 * tela possa dizer de onde o número veio.
 *
 * Quem era "o último valor" estava escrito em `chamados.ts` como
 * `DISTINCT ON (scope_hash, entity_type_set)` — uma definição de série com os
 * três defeitos da auditoria de uma vez:
 *
 * - `scope_hash` cru parte a unidade em duas quando o CNPJ muda de grafia (D1);
 * - `entity_type_set` elege **duas** "mais recentes" quando uma entrega passa
 *   a trazer outro equipamento, e a chave de leitura — `placa|parâmetro` — não
 *   distingue as duas: uma sobrescrevia a outra na ordem em que as linhas
 *   voltassem do banco (D3);
 * - **o canal não entrava**, de modo que o "antes" podia vir de outra
 *   remuneração e ser gravado como se fosse o certo (D2).
 *
 * Os cenários abaixo são um por defeito, mais o caso comum que não pode ter
 * mudado. **Nem todos falham na versão anterior, e a diferença importa:**
 *
 * - o caso comum passava antes e passa agora — é prova de não-regressão;
 * - o do canal **falha** na versão anterior, e é a prova negativa deste PR;
 * - o da cobertura de equipamento também passava antes, e passava por sorte:
 *   a versão anterior elegia duas "mais recentes" que se sobrescreviam, e qual
 *   delas ficava dependia da ordem física das linhas. Está escrito lá por quê,
 *   e o que ele prova é o que dá para provar — que a resposta agora sai de uma
 *   regra, e não de uma ordem.
 */

const COLUNAS_FIXAS = [
  "Vigencia",
  "Unidade - CNPJ",
  "Unidade - Nome",
  "Unidade - Regional",
  "Operador - CNPJ",
  "Operador - Nome",
  "Placa",
  "chassi",
];

/** Vinte colunas próprias: menos que isso e a aba é classificada errado. */
const CARRETA = Array.from({ length: 20 }, (_, i) => `Custo Carreta ${i}`);
const CAVALO = Array.from({ length: 20 }, (_, i) => `Custo Cavalo ${i}`);

/** O parâmetro sobre o qual os chamados falam, com o rótulo do arquivo. */
const PARAMETRO = "Custo Carreta 0";

interface AbaSpec {
  nome: string;
  placas: string[];
  colunas: string[];
  /** O valor de todas as colunas desta aba, para poder variar por vigência. */
  base: number;
}

function planilha(spec: { vigencia: string; cnpj?: string; abas: AbaSpec[] }): string {
  const wb = XLSX.utils.book_new();
  for (const aba of spec.abas) {
    const linhas: (string | number)[][] = [[...COLUNAS_FIXAS, ...aba.colunas]];
    for (const placa of aba.placas) {
      linhas.push([
        spec.vigencia,
        spec.cnpj ?? "07.526.557/0015-05",
        "CAMACARI",
        "GEO NE",
        "20.618.821/0007-99",
        "OPERADOR TESTE",
        placa,
        `CHASSI${placa}`,
        ...aba.colunas.map((_, i) => aba.base + i),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba.nome);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "chamados-antes-"));
  const arquivo = path.join(dir, `${spec.vigencia}.xlsx`);
  XLSX.writeFile(wb, arquivo);
  return arquivo;
}

async function importar(db: Database, filePath: string): Promise<void> {
  const recebido = await receiveFile(db, { filePath });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  await promote(db, recebido.importRunId, {
    onExistingSnapshot: "NEW_REVISION",
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
}

interface Alteracao {
  beforeSource: string;
  beforeReference: string | null;
  valueBeforeRaw: string | null;
}

/**
 * Um chamado sobre uma placa, sem trazer o "antes" — e o que o produto completou.
 *
 * `Vig. Abertura` fica vazia de propósito na maioria dos casos: é ela que dá a
 * saída correta quando a resposta é ambígua, e testar a ambiguidade exige o
 * caso em que ela não foi preenchida.
 */
async function chamadoSobre(
  ctx: TestDb,
  opcoes: { placa: string; depois: number; vigencia?: string; id: string },
): Promise<Alteracao[]> {
  const dir = mkdtempSync(path.join(tmpdir(), "chamados-csv-"));
  const arquivo = path.join(dir, `${opcoes.id}.csv`);
  writeFileSync(
    arquivo,
    [
      `Chamado,Status,Item,Vig. Abertura,Operação,"${PARAMETRO}"`,
      `${opcoes.id},Concluído,Placa: ${opcoes.placa},${opcoes.vigencia ?? ""},SET,${opcoes.depois}`,
    ].join("\n"),
    "utf8",
  );

  const recebido = await receiveTicketFile(ctx.db, {
    filePath: arquivo,
    filename: `${opcoes.id}.csv`,
  });
  await readTicketImport(ctx.db, recebido.ticketImportId);

  const { rows } = await ctx.db.execute<{
    before_source: string;
    before_reference: string | null;
    value_before_raw: string | null;
  }>(sql`
    SELECT tc.before_source::text AS before_source,
           tc.before_reference,
           tc.value_before_raw
      FROM ticket_change tc
      JOIN ticket t ON t.id = tc.ticket_id
     WHERE t.external_id = ${opcoes.id}
  `);
  return rows.map((r) => ({
    beforeSource: r.before_source,
    beforeReference: r.before_reference,
    valueBeforeRaw: r.value_before_raw,
  }));
}

// ---------------------------------------------------------------------------

describe("o caso comum: uma série, e o antes é a última entrega dela", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("chamados_antes_comum");
    // Janeiro e fevereiro, mesma unidade, mesmo canal, valores diferentes.
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_1_2026",
        abas: [{ nome: "carretas", placas: ["AAA1A11"], colunas: CARRETA, base: 1000 }],
      }),
    );
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_2_2026",
        abas: [{ nome: "carretas", placas: ["AAA1A11"], colunas: CARRETA, base: 2000 }],
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("o antes vem de fevereiro, e a procedência diz isso", async () => {
    const [alteracao] = await chamadoSobre(ctx, {
      id: "CH-COMUM",
      placa: "AAA1A11",
      depois: 3000,
    });

    expect(alteracao.beforeSource).toBe("VIGENCIA");
    expect(alteracao.beforeReference).toBe("EMPURRADA_1_2_2026");
    // 2000, e não 1000: a última entrega da série, não a primeira.
    expect(Number(alteracao.valueBeforeRaw)).toBe(2000);
  }, 300_000);
});

describe("D3 — a cobertura de equipamento não elege duas mais recentes", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("chamados_antes_cobertura");
    /*
      Janeiro só carretas; fevereiro carretas e cavalos.

      Com `DISTINCT ON (scope_hash, entity_type_set)`, janeiro (`CARRETA`) e
      fevereiro (`CARRETA+CAVALO`) eram **duas** séries, cada uma com a sua
      "mais recente" — e as duas trazem a placa AAA1A11. A chave de leitura é
      `placa|parâmetro`: as duas escreviam na mesma posição do mapa, e qual
      ficava dependia da ordem em que o Postgres devolvesse as linhas.

      **Este caso não falha na versão anterior**, e é honesto dizer por quê:
      naquele banco, naquele plano de consulta, a linha de fevereiro chegava
      por último e o resultado saía certo. O defeito era a ausência de regra,
      não uma resposta fixa errada — e ausência de regra não vira asserção
      vermelha, vira um dia em que o plano muda. O que este teste prende é o
      lado que dá para prender: a resposta agora é a última entrega da série,
      por definição, e a montagem que produzia o empate continua montada aqui
      para que uma regressão futura tenha onde bater.
    */
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_1_2026",
        abas: [{ nome: "carretas", placas: ["AAA1A11"], colunas: CARRETA, base: 1000 }],
      }),
    );
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_2_2026",
        abas: [
          { nome: "carretas", placas: ["AAA1A11"], colunas: CARRETA, base: 2000 },
          { nome: "cavalos", placas: ["BBB1B11"], colunas: CAVALO, base: 5000 },
        ],
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("as duas coberturas são uma série só, e o antes é a última entrega dela", async () => {
    const { rows } = await ctx.db.execute<{ series: number; coberturas: number }>(sql`
      SELECT count(DISTINCT freightcheck_snapshot_key(
               s.source_system, s.dataset_family, s.canal,
               '1900-01-01'::date, s.canonical_scope))::int AS series,
             count(DISTINCT s.entity_type_set)::int         AS coberturas
        FROM snapshot s
       WHERE s.status = 'CLOSED'
    `);
    // Uma série, duas coberturas: é a montagem que o defeito exigia.
    expect(Number(rows[0].series)).toBe(1);
    expect(Number(rows[0].coberturas)).toBe(2);

    const [alteracao] = await chamadoSobre(ctx, {
      id: "CH-COBERTURA",
      placa: "AAA1A11",
      depois: 3000,
    });

    expect(alteracao.beforeSource).toBe("VIGENCIA");
    expect(alteracao.beforeReference).toBe("EMPURRADA_1_2_2026");
    expect(Number(alteracao.valueBeforeRaw)).toBe(2000);
  }, 300_000);
});

describe("D2/B6 — a placa que vive em dois canais não tem um antes", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("chamados_antes_canal");
    /*
      A mesma placa, a mesma unidade, dois canais — e o de ROTA é mais novo.

      Antes, a série não incluía o canal: as duas entregas caíam na mesma
      "série" e a mais recente ganhava. O chamado sobre esta placa recebia o
      valor da remuneração de ROTA e gravava `before_reference = ROTA_...`
      como se fosse a resposta certa. Ela não é errada nem certa: o chamado não
      diz de que remuneração fala.
    */
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_1_2026",
        abas: [{ nome: "carretas", placas: ["AAA1A11"], colunas: CARRETA, base: 1000 }],
      }),
    );
    await importar(
      ctx.db,
      planilha({
        vigencia: "ROTA_1_2_2026",
        abas: [{ nome: "carretas", placas: ["AAA1A11"], colunas: CARRETA, base: 7000 }],
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("dois canais, duas séries — a montagem que o defeito exigia", async () => {
    const { rows } = await ctx.db.execute<{ canais: number; escopos: number }>(sql`
      SELECT count(DISTINCT s.canal)::int                    AS canais,
             count(DISTINCT s.canonical_scope::text)::int    AS escopos
        FROM snapshot s
       WHERE s.status = 'CLOSED'
    `);
    expect(Number(rows[0].canais)).toBe(2);
    expect(Number(rows[0].escopos)).toBe(1);
  }, 300_000);

  it("o chamado que não nomeia a vigência fica sem antes, em vez de receber o do outro canal", async () => {
    const [alteracao] = await chamadoSobre(ctx, {
      id: "CH-AMBIGUO",
      placa: "AAA1A11",
      depois: 9000,
    });

    expect(alteracao.beforeSource).toBe("AUSENTE");
    expect(alteracao.beforeReference).toBeNull();
    expect(alteracao.valueBeforeRaw).toBeNull();
  }, 300_000);

  it("o chamado que nomeia a vigência continua sendo respondido por ela", async () => {
    /*
      A saída, e a razão de recusar não ser o mesmo que desistir. Quem sabe de
      que remuneração está falando diz — e a coluna `Vig. Abertura` é onde se
      diz. A ambiguidade só apaga o palpite, não a informação.
    */
    const [alteracao] = await chamadoSobre(ctx, {
      id: "CH-NOMEADO",
      placa: "AAA1A11",
      depois: 9000,
      vigencia: "EMPURRADA_1_1_2026",
    });

    expect(alteracao.beforeSource).toBe("VIGENCIA");
    expect(alteracao.beforeReference).toBe("EMPURRADA_1_1_2026");
    expect(Number(alteracao.valueBeforeRaw)).toBe(1000);
  }, 300_000);
});

afterAll(async () => {
  await encerrarPoolDoProcesso();
});
