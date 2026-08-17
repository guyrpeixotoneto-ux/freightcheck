import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  ContextNotFoundError,
  getOverview,
  listContexts,
} from "@workspace/comparison";
import { visaoDaCobertura } from "@workspace/coverage";
import { encerrarPoolDoProcesso, type Database } from "@workspace/db";

/**
 * O Painel — e por que ele era a tela mais fácil de acreditar e a mais errada.
 *
 * `getOverview` tinha doze contadores e nove liam o banco inteiro: os fatos de
 * revisões substituídas entravam na conta, os ativos vinham de `entity` (que é
 * global por construção), as comparações somavam pares cujas vigências já
 * tinham saído de cena. A auditoria mediu isso, e o efeito não é um número
 * grande demais em abstrato: o Painel é a primeira tela que alguém abre, e ela
 * discordava da Cobertura sobre quantas vigências existem.
 *
 * Os dois cenários abaixo são as duas metades do defeito — a revisão
 * substituída, que existe hoje, e a segunda unidade, que existe amanhã.
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

const CARRETA = Array.from({ length: 20 }, (_, i) => `Custo Carreta ${i}`);

function planilha(spec: {
  vigencia: string;
  cnpj?: string;
  unidade?: string;
  placas: string[];
  base: number;
}): string {
  const wb = XLSX.utils.book_new();
  const linhas: (string | number)[][] = [[...COLUNAS_FIXAS, ...CARRETA]];
  for (const placa of spec.placas) {
    linhas.push([
      spec.vigencia,
      spec.cnpj ?? "07.526.557/0015-05",
      spec.unidade ?? "CAMACARI",
      "GEO NE",
      "20.618.821/0007-99",
      "OPERADOR TESTE",
      placa,
      `CHASSI${placa}`,
      ...CARRETA.map((_, i) => spec.base + i),
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "carretas");
  const dir = mkdtempSync(path.join(tmpdir(), "painel-"));
  const arquivo = path.join(dir, `${spec.vigencia}-${spec.base}.xlsx`);
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

const n = (v: unknown) => Number(v);

// ---------------------------------------------------------------------------

describe("uma revisão substituída não conta duas vezes", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("painel_revisao");
    // A mesma vigência, duas vezes, com valores diferentes: a segunda importação
    // abre a revisão 2 e substitui a 1. É o caminho normal de uma correção.
    await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_1_2026", placas: ["AAA1A11", "AAA2A22"], base: 1000 }));
    await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_1_2026", placas: ["AAA1A11", "AAA2A22"], base: 2000 }));
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("o banco tem duas revisões, e só uma está viva", async () => {
    // A montagem, medida antes de qualquer asserção sobre o Painel: sem uma
    // revisão substituída de verdade, o resto deste describe não testa nada.
    const { rows } = await ctx.db.execute<{ vivas: number; mortas: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'CLOSED')::int     AS vivas,
             count(*) FILTER (WHERE status = 'SUPERSEDED')::int AS mortas
        FROM snapshot
    `);
    expect(n(rows[0].vivas)).toBe(1);
    expect(n(rows[0].mortas)).toBe(1);
  }, 300_000);

  it("o Painel conta uma vigência, e os fatos de uma só", async () => {
    const painel = await getOverview(ctx.db);

    expect(n(painel.totals.vigencias)).toBe(1);

    /*
      A prova que a auditoria pediu, e a mais direta de todas: os fatos do
      Painel são exatamente os das vigências vivas. Antes, `count(*) FROM fact`
      trazia os das duas revisões — o dobro, num banco em que nada foi
      importado duas vezes de verdade.
    */
    const { rows } = await ctx.db.execute<{ vivos: number; todos: number }>(sql`
      SELECT count(*) FILTER (WHERE s.status = 'CLOSED')::int AS vivos,
             count(*)::int                                    AS todos
        FROM fact f JOIN snapshot s ON s.id = f.snapshot_id
    `);
    expect(n(rows[0].todos)).toBeGreaterThan(n(rows[0].vivos));
    expect(n(painel.totals.fatos)).toBe(n(rows[0].vivos));
  }, 300_000);

  it("os ativos são os que a vigência viva entrega, não todos os que já passaram", async () => {
    const painel = await getOverview(ctx.db);
    expect(n(painel.totals.ativos)).toBe(2);
  }, 300_000);

  it("o Painel e a Cobertura concordam sobre quantas vigências existem", async () => {
    /*
      A prova de que as duas telas param de discordar. Não é uma igualdade
      inventada para o teste: a Cobertura tem uma coluna por vigência, e o
      Painel conta vigências. Se os dois usarem definições diferentes de
      "existe", este número diverge — e foi o que a auditoria encontrou.
    */
    const painel = await getOverview(ctx.db);
    const cobertura = await visaoDaCobertura(ctx.db, { vigencias: 12 });
    expect(n(painel.totals.vigencias)).toBe(cobertura.colunas.length);
  }, 300_000);
});

describe("o recorte por contexto chega ao Painel", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("painel_contexto");
    // Duas unidades. A primeira entrega duas vigências, a segunda uma.
    await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_1_2026", placas: ["AAA1A11"], base: 1000 }));
    await importar(ctx.db, planilha({ vigencia: "EMPURRADA_1_2_2026", placas: ["AAA1A11"], base: 1100 }));
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_2_2026",
        cnpj: "11.222.333/0001-44",
        unidade: "JUIZ DE FORA",
        placas: ["CCC1C11", "CCC2C22"],
        base: 3000,
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("sem recorte, o Painel é o censo — e diz que é", async () => {
    const painel = await getOverview(ctx.db);
    expect(painel.contexto).toBeNull();
    expect(n(painel.totals.vigencias)).toBe(3);
    expect(n(painel.totals.ativos)).toBe(3);
  }, 300_000);

  it("com recorte, cada unidade vê a si mesma", async () => {
    const contextos = await listContexts(ctx.db);
    expect(contextos.length).toBe(2);

    const camacari = contextos.find((c) => c.label.includes("CAMACARI"))!;
    const juizDeFora = contextos.find((c) => c.label.includes("JUIZ"))!;

    const daPrimeira = await getOverview(ctx.db, { scopeHash: camacari.scopeHash });
    const daSegunda = await getOverview(ctx.db, { scopeHash: juizDeFora.scopeHash });

    expect(n(daPrimeira.totals.vigencias)).toBe(2);
    expect(n(daPrimeira.totals.ativos)).toBe(1);
    expect(n(daSegunda.totals.vigencias)).toBe(1);
    expect(n(daSegunda.totals.ativos)).toBe(2);

    // As partes fecham com o todo: nenhum ativo ficou fora e nenhum foi contado
    // duas vezes. É a conta que denuncia um recorte que vaza.
    const censo = await getOverview(ctx.db);
    expect(n(daPrimeira.totals.ativos) + n(daSegunda.totals.ativos)).toBe(
      n(censo.totals.ativos),
    );
    expect(n(daPrimeira.totals.fatos) + n(daSegunda.totals.fatos)).toBe(
      n(censo.totals.fatos),
    );
  }, 300_000);

  it("o recorte de uma unidade não vaza a data da outra", async () => {
    const contextos = await listContexts(ctx.db);
    const juizDeFora = contextos.find((c) => c.label.includes("JUIZ"))!;
    const daSegunda = await getOverview(ctx.db, { scopeHash: juizDeFora.scopeHash });

    // Juiz de Fora só entregou em fevereiro. Com `min/max FROM snapshot` sem
    // recorte, a primeira vigência dela seria janeiro — de outra unidade.
    expect(String(daSegunda.totals.primeira_vigencia)).toContain("2026-02");
    expect(String(daSegunda.totals.ultima_vigencia)).toContain("2026-02");
  }, 300_000);

  it("pedir um contexto que não existe é erro, e não o censo com outro nome", async () => {
    /*
      A alternativa silenciosa seria devolver o banco inteiro sob o título de
      uma unidade — que é a forma mais convincente de mentir que uma tela tem.
    */
    await expect(
      getOverview(ctx.db, { scopeHash: "nao-existe-este-escopo" }),
    ).rejects.toBeInstanceOf(ContextNotFoundError);
  }, 300_000);

  it("os atributos do Painel são os entregues no recorte, e nunca mais que o dicionário", async () => {
    /*
      A mudança de significado deste PR, presa por asserção. Os três contadores
      de dicionário passaram a descrever **as colunas entregues**, porque a
      versão anterior — o dicionário inteiro — ficaria errada na segunda
      unidade. A relação que precisa continuar valendo é interna: confirmados
      nunca passam do total, e o total nunca passa do dicionário.
    */
    const contextos = await listContexts(ctx.db);
    const camacari = contextos.find((c) => c.label.includes("CAMACARI"))!;
    const painel = await getOverview(ctx.db, { scopeHash: camacari.scopeHash });

    const { rows } = await ctx.db.execute<{ dicionario: number }>(sql`
      SELECT count(*)::int AS dicionario FROM attribute
    `);

    expect(n(painel.totals.atributos)).toBeGreaterThan(0);
    expect(n(painel.totals.atributos_confirmados)).toBeLessThanOrEqual(
      n(painel.totals.atributos),
    );
    expect(n(painel.totals.atributos)).toBeLessThanOrEqual(n(rows[0].dicionario));
  }, 300_000);
});

afterAll(async () => {
  await encerrarPoolDoProcesso();
});
