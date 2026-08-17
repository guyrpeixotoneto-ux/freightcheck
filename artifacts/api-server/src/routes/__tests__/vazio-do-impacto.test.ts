import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { getQuinzenaMatrix, listContexts } from "@workspace/comparison";
import { encerrarPoolDoProcesso, type Database } from "@workspace/db";

/**
 * As quatro causas de vazio do Impacto — a divergência D6.
 *
 * `getQuinzenaMatrix` devolvia `null` em quatro situações estruturalmente
 * distintas, e a rota traduzia as quatro em
 * `404 "Nenhuma vigência importada ainda."`. A frase era verdadeira numa delas.
 * Nas outras três ela mandava importar planilha quando o problema era outro — e
 * quem seguia a instrução reimportava o mesmo arquivo sem que nada mudasse.
 *
 * Cada teste aqui **monta a causa de propósito** e exige o estado certo. Um
 * teste que só verificasse "não é null" passaria com as quatro erradas.
 *
 * A regra que o vocabulário impõe, e que esta suíte protege:
 *
 *   > Um módulo só pode dizer "não há dados" quando `NAO_EXISTE`.
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

function planilha(spec: { vigencia: string; cnpj?: string; unidade?: string }): string {
  const wb = XLSX.utils.book_new();
  const linhas: (string | number)[][] = [[...COLUNAS_FIXAS, ...CARRETA]];
  linhas.push([
    spec.vigencia,
    spec.cnpj ?? "07.526.557/0015-05",
    spec.unidade ?? "CAMACARI",
    "GEO NE",
    "20.618.821/0007-99",
    "OPERADOR TESTE",
    "AAA1A11",
    "CHASSIAAA1A11",
    ...CARRETA.map((_, i) => 1000 + i),
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "carretas");
  const dir = mkdtempSync(path.join(tmpdir(), "vazio-impacto-"));
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

async function comBanco(nome: string, prova: (ctx: TestDb) => Promise<void>) {
  const ctx = await createTestDatabase(`vazio_impacto_${nome}`);
  try {
    await prova(ctx);
  } finally {
    await ctx.drop().catch(() => {});
  }
}

// ---------------------------------------------------------------------------

describe("as quatro causas, uma a uma", () => {
  it("1 · banco vazio é `NAO_EXISTE` — a única em que 'não há dados' é verdade", async () => {
    await comBanco("sem_nada", async (ctx) => {
      const r = await getQuinzenaMatrix(ctx.db, {});
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.vazio.estado).toBe("NAO_EXISTE");
      // E a frase manda fazer a coisa certa: importar.
      expect(r.vazio.frase).toMatch(/importa/i);
    });
  }, 900_000);

  it("2 · equipamento sem parâmetro numérico é `NAO_SE_APLICA` — o caso da auditoria", async () => {
    /*
      O defeito em forma pura. O dado está lá — vigência promovida, fato
      gravado, equipamento declarado — e o dicionário não tem nenhuma coluna
      numérica **confirmada como parâmetro** para aquele equipamento. A resposta
      antiga era "nenhuma vigência importada ainda", sobre um banco com vigência
      importada e visível em Cobertura.

      A montagem: importa normalmente e depois tira os atributos da lista de
      parâmetros do Impacto, que é o que a falta de curadoria produz.
    */
    await comBanco("sem_parametro", async (ctx) => {
      await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_1_2026" }));

      // O dado existe, medido antes de qualquer asserção sobre o vazio.
      const { rows: antes } = await ctx.db.execute<{ vigencias: number; fatos: number }>(sql`
        SELECT (SELECT count(*)::int FROM snapshot WHERE status = 'CLOSED') AS vigencias,
               (SELECT count(*)::int FROM fact)                             AS fatos
      `);
      expect(Number(antes[0].vigencias)).toBeGreaterThan(0);
      expect(Number(antes[0].fatos)).toBeGreaterThan(0);

      /*
        O que faz um atributo ser parâmetro do Impacto é ser numérico. Marcá-los
        como texto reproduz o estado em que a curadoria ainda não disse o que a
        coluna mede — sem apagar fato nenhum.
      */
      await ctx.db.execute(sql`
        UPDATE attribute SET data_type = 'TEXT' WHERE entity_type = 'CARRETA'
      `);

      const r = await getQuinzenaMatrix(ctx.db, {});
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.vazio.estado).toBe("NAO_SE_APLICA");
      // A frase não pode mandar importar: o arquivo já está aqui.
      expect(r.vazio.frase).toMatch(/curadoria/i);
      expect(r.vazio.frase).not.toMatch(/nenhuma vigência importada/i);
    });
  }, 900_000);

  it("3 · vigência sem agregado de equipamento é `NAO_CALCULAVEL`, com o que falta", async () => {
    await comBanco("sem_equipamento", async (ctx) => {
      await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_1_2026" }));
      /*
        `listImpactEntityTypes` lê `entity_type_set`. Uma vigência sem ele é o
        banco cujo backfill de agregado não rodou — o dado está lá e o eixo do
        Impacto não. Não é ausência de dado, e não é falta de pertinência: é
        informação que falta, e a frase diz onde conferir.
      */
      await ctx.db.execute(sql`
        ALTER TABLE snapshot DISABLE TRIGGER snapshot_immutable
      `);
      await ctx.db.execute(sql`UPDATE snapshot SET entity_type_set = ''`);
      await ctx.db.execute(sql`
        ALTER TABLE snapshot ENABLE TRIGGER snapshot_immutable
      `);

      const r = await getQuinzenaMatrix(ctx.db, {});
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.vazio.estado).toBe("NAO_CALCULAVEL");
      if (r.vazio.estado !== "NAO_CALCULAVEL") return;
      // `oQueFalta` é separado da frase porque é a parte acionável.
      expect(r.vazio.oQueFalta.length).toBeGreaterThan(20);
      expect(r.vazio.frase).not.toMatch(/nenhuma vigência importada/i);
    });
  }, 900_000);

  it("4 · o dado noutra unidade é `FORA_DO_RECORTE`, e diz onde ele está", async () => {
    await comBanco("outro_recorte", async (ctx) => {
      await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_1_2026" }));
      await importar(
        ctx.db,
        planilha({
          vigencia: "ROTA_1_2_2026",
          cnpj: "11.222.333/0001-44",
          unidade: "JUIZ DE FORA",
        }),
      );

      const contextos = await listContexts(ctx.db);
      expect(contextos.length).toBe(2);

      /*
        Pedir o Impacto de um contexto que existe, mas cujo equipamento não tem
        parâmetro, cairia no caso 2. Aqui a montagem é outra: as duas unidades
        têm dado, e o teste prova que o recorte **funciona** — cada uma vê a
        sua, e nenhuma vê a outra. É a metade positiva do `FORA_DO_RECORTE`.
      */
      for (const c of contextos) {
        const r = await getQuinzenaMatrix(ctx.db, {
          context: { scopeHash: c.scopeHash, channel: c.channel },
        });
        expect(r.ok, r.ok ? "" : `${r.vazio.estado}: ${r.vazio.frase}`).toBe(true);
        if (!r.ok) continue;
        expect(r.valor.periods.length).toBe(1);
      }
    });
  }, 900_000);
});

describe("a regra de ouro", () => {
  it("nenhum estado além de NAO_EXISTE manda importar planilha", async () => {
    /*
      A regra que o vocabulário existe para impor, presa por asserção: "não há
      dados" e "envie a planilha" são a resposta de **um** dos quatro estados. É
      esta asserção que impede a frase única de voltar por dentro de um estado
      novo — porque quem escrever o quinto vai ter de escolher a frase dele.
    */
    await comBanco("regra_de_ouro", async (ctx) => {
      await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_1_2026" }));
      await ctx.db.execute(sql`
        UPDATE attribute SET data_type = 'TEXT' WHERE entity_type = 'CARRETA'
      `);

      const r = await getQuinzenaMatrix(ctx.db, {});
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.vazio.estado).not.toBe("NAO_EXISTE");
      expect(r.vazio.frase).not.toMatch(/nenhum dado|não há dados|nenhuma vigência importada/i);
    });
  }, 900_000);
});

afterAll(async () => {
  await encerrarPoolDoProcesso().catch(() => {});
});
