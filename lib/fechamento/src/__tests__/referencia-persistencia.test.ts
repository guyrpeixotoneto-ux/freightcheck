import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as XLSX from "xlsx";
import {
  fechamentoReferenciaConteudoTable,
  fechamentoReferenciaLinhaTable,
  fechamentoReferenciaTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";

import { abrirCompetencia, lerResumoDoMes } from "../persistencia";

import { ABA_DO_RESUMO, COLUNA_DA_QUINZENA, LINHA_NO_RESUMO } from "../referencia";
import {
  anexarReferencia,
  ativarReferencia,
  lerConteudoDaReferencia,
  listarReferenciasDoMes,
  referenciaAtivaDoMes,
  ReferenciaJaAnexada,
  type MesDaReferencia,
} from "../referencia-persistencia";

/**
 * A GUARDA DA RÉGUA — contra Postgres de verdade.
 *
 * O que se prova aqui é o schema e a regra de versão, não a leitura (essa está
 * em `referencia.test.ts`): que **uma** referência fica ativa por mês, que
 * anexar de novo versiona em vez de sobrescrever, que o histórico sobrevive, e
 * que um arquivo só serve às duas quinzenas com os bytes guardados uma vez.
 *
 * Precisa de banco porque o que sustenta a regra é o índice parcial
 * `fechamento_referencia_ativa_unica` — se a aplicação errar, é o Postgres que
 * tem de recusar. Um banco fingido provaria que o TypeScript compila.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_referencia_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function alcancavel(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const temBanco = await alcancavel();
const noCi = process.env.CI === "true" || process.env.CI === "1";
if (!temBanco && noCi) {
  throw new Error("O CI declara um Postgres e ele não respondeu.");
}

const JULHO: MesDaReferencia = {
  unidade: "CDD Belém",
  transportadora: "36",
  tipoDeOperacao: "ROTA",
  ano: 2026,
  mes: 7,
};

/** Uma planilha válida cujos números derivam de `base` — arquivos distinguíveis. */
function planilha(base: number): Buffer {
  const aba: XLSX.WorkSheet = { "!ref": "A1:BZ100" };
  for (const quinzena of [1, 2] as const) {
    Object.entries(LINHA_NO_RESUMO).forEach(([, linha], i) => {
      aba[`${COLUNA_DA_QUINZENA[quinzena]}${linha}`] = {
        t: "n",
        v: base + i + (quinzena === 2 ? 1000 : 0),
      };
    });
  }
  const pasta = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(pasta, aba, ABA_DO_RESUMO);
  return XLSX.write(pasta, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe.skipIf(!temBanco)("a referência de conferência", () => {
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`);
    await admin.query(`CREATE DATABASE "${NOME_DO_BANCO}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME_DO_BANCO);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  const limpar = async () => {
    await db.delete(fechamentoReferenciaTable);
  };

  it("a migration cria as três tabelas vazias — nada nasce de backfill", async () => {
    await limpar();
    expect(await db.select().from(fechamentoReferenciaTable)).toEqual([]);
    expect(await db.select().from(fechamentoReferenciaLinhaTable)).toEqual([]);
    expect(await db.select().from(fechamentoReferenciaConteudoTable)).toEqual([]);
  });

  it("sem referência anexada, o mês responde `null` — e isso é normal", async () => {
    await limpar();
    expect(await referenciaAtivaDoMes(db, JULHO)).toBeNull();
    expect(await listarReferenciasDoMes(db, JULHO)).toEqual([]);
  });

  /* --- CRITÉRIO 2: a associação é declarada e fica auditável ------------- */

  it("guarda sha256, arquivo, quem e quando — a procedência inteira", async () => {
    await limpar();
    const v = await anexarReferencia(db, {
      mes: JULHO,
      nomeDoArquivo: "Fechamento_Remuneracao.xlsb",
      conteudo: planilha(100),
      anexadaPor: "00000000-0000-0000-0000-0000000000aa",
    });

    expect(v.versao).toBe(1);
    expect(v.ativa).toBe(true);
    expect(v.nomeDoArquivo).toBe("Fechamento_Remuneracao.xlsb");
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.anexadaPor).toBe("00000000-0000-0000-0000-0000000000aa");
    expect(new Date(v.anexadaEm).getTime()).toBeGreaterThan(0);
    expect(v.tamanhoEmBytes).toBeGreaterThan(0);
  });

  /* --- CRITÉRIO 6: um arquivo, duas quinzenas, bytes uma vez ------------- */

  it("uma referência mensal serve às duas quinzenas, com os bytes guardados uma vez", async () => {
    await limpar();
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "p.xlsb", conteudo: planilha(100) });

    const ativa = (await referenciaAtivaDoMes(db, JULHO))!;
    const dvs = ativa.numeros["rota_dvs"]!;
    expect(dvs.primeira).toBe(100);
    expect(dvs.segunda).toBe(1100);

    /* Um `.xlsb`, uma linha de conteúdo — não duas, uma por quinzena. */
    const conteudos = await db.select().from(fechamentoReferenciaConteudoTable);
    expect(conteudos).toHaveLength(1);

    /* E as linhas extraídas são 18 chaves × 2 quinzenas, num vínculo só. */
    const linhas = await db.select().from(fechamentoReferenciaLinhaTable);
    expect(linhas).toHaveLength(Object.keys(LINHA_NO_RESUMO).length * 2);
    expect(new Set(linhas.map((l) => l.referenciaId)).size).toBe(1);
  });

  it("cada número volta com a célula de onde saiu", async () => {
    await limpar();
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "p.xlsb", conteudo: planilha(100) });
    const ativa = (await referenciaAtivaDoMes(db, JULHO))!;
    expect(ativa.celulas["rota_dvs"]).toEqual({ primeira: "AI7", segunda: "AJ7" });
  });

  /* --- CRITÉRIO 8: versão explícita, histórico preservado ---------------- */

  it("anexar de novo versiona: a nova fica ativa, a anterior fica no histórico", async () => {
    await limpar();
    const v1 = await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v1.xlsb", conteudo: planilha(100) });
    const v2 = await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v2.xlsb", conteudo: planilha(500) });

    expect(v2.versao).toBe(2);
    const historico = await listarReferenciasDoMes(db, JULHO);
    expect(historico.map((h) => h.versao)).toEqual([2, 1]);
    expect(historico.find((h) => h.id === v1.id)!.ativa).toBe(false);
    expect(historico.find((h) => h.id === v2.id)!.ativa).toBe(true);

    /* A v1 continua com os números dela — o histórico não é só a linha. */
    const linhasDaV1 = await db.select().from(fechamentoReferenciaLinhaTable);
    expect(new Set(linhasDaV1.map((l) => l.referenciaId)).size).toBe(2);
  });

  it("a ativa é a última anexada, e é ela que a tela lê", async () => {
    await limpar();
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v1.xlsb", conteudo: planilha(100) });
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v2.xlsb", conteudo: planilha(500) });

    const ativa = (await referenciaAtivaDoMes(db, JULHO))!;
    expect(ativa.procedencia.versao).toBe(2);
    expect(ativa.numeros["rota_dvs"]!.primeira).toBe(500);
  });

  it("dá para voltar para uma versão anterior sem perder a mais nova", async () => {
    await limpar();
    const v1 = await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v1.xlsb", conteudo: planilha(100) });
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v2.xlsb", conteudo: planilha(500) });

    await ativarReferencia(db, v1.id);

    const ativa = (await referenciaAtivaDoMes(db, JULHO))!;
    expect(ativa.procedencia.versao).toBe(1);
    expect(ativa.numeros["rota_dvs"]!.primeira).toBe(100);
    /* E a v2 continua listada — desativar não é apagar. */
    expect((await listarReferenciasDoMes(db, JULHO)).map((h) => h.versao)).toEqual([2, 1]);
  });

  /**
   * A trava está no banco, e não só na aplicação.
   *
   * Se `anexarReferencia` tivesse um defeito e deixasse duas ativas, é o índice
   * parcial que recusa. Este teste força a situação por SQL direto, passando por
   * fora da aplicação inteira — é a única forma de provar que a garantia não
   * depende de o código estar certo.
   */
  it("o banco recusa duas ativas no mesmo mês, mesmo por SQL direto", async () => {
    await limpar();
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v1.xlsb", conteudo: planilha(100) });
    const v2 = await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v2.xlsb", conteudo: planilha(500) });

    await expect(
      pool.query(`UPDATE fechamento_referencia SET ativa = true WHERE id <> $1`, [v2.id]),
    ).rejects.toThrow(/fechamento_referencia_ativa_unica/);
  });

  it("o mesmo arquivo não vira duas versões do mesmo mês", async () => {
    await limpar();
    const bytes = planilha(100);
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v1.xlsb", conteudo: bytes });
    await expect(
      anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "outro-nome.xlsb", conteudo: bytes }),
    ).rejects.toThrow(ReferenciaJaAnexada);
  });

  it("meses diferentes não se enxergam", async () => {
    await limpar();
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "julho.xlsb", conteudo: planilha(100) });
    const agosto = { ...JULHO, mes: 8 };
    expect(await referenciaAtivaDoMes(db, agosto)).toBeNull();

    /* E o mesmo arquivo pode ser anexado a outro mês — quem declara é quem anexa. */
    const v = await anexarReferencia(db, { mes: agosto, nomeDoArquivo: "julho.xlsb", conteudo: planilha(100) });
    expect(v.versao).toBe(1);
  });

  /* --- CRITÉRIO 3: a porta recusa antes de gravar ------------------------ */

  it("arquivo recusado não deixa rastro nenhum no banco", async () => {
    await limpar();
    const pasta = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(pasta, XLSX.utils.aoa_to_sheet([[1]]), "Aba Errada");
    const ruim = XLSX.write(pasta, { type: "buffer", bookType: "xlsx" }) as Buffer;

    await expect(
      anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "ruim.xlsb", conteudo: ruim }),
    ).rejects.toThrow(/Resumo Geral/);

    expect(await db.select().from(fechamentoReferenciaTable)).toEqual([]);
    expect(await db.select().from(fechamentoReferenciaConteudoTable)).toEqual([]);
    expect(await db.select().from(fechamentoReferenciaLinhaTable)).toEqual([]);
  });

  it("uma recusa não derruba a referência que já estava lá", async () => {
    await limpar();
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "boa.xlsb", conteudo: planilha(100) });

    const celulas = planilha(100);
    const pasta = XLSX.read(celulas, { type: "buffer" });
    delete pasta.Sheets[ABA_DO_RESUMO]!["AI7"];
    const quebrada = XLSX.write(pasta, { type: "buffer", bookType: "xlsx" }) as Buffer;

    await expect(
      anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "quebrada.xlsb", conteudo: quebrada }),
    ).rejects.toThrow(/AI7/);

    const ativa = (await referenciaAtivaDoMes(db, JULHO))!;
    expect(ativa.procedencia.versao).toBe(1);
    expect(ativa.procedencia.nomeDoArquivo).toBe("boa.xlsb");
  });

  /* --- a evidência volta inteira ----------------------------------------- */

  it("o arquivo guardado volta byte a byte, conferido pelo sha256", async () => {
    await limpar();
    const bytes = planilha(100);
    const v = await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "p.xlsb", conteudo: bytes });

    const voltou = (await lerConteudoDaReferencia(db, v.id))!;
    expect(voltou.nomeDoArquivo).toBe("p.xlsb");
    expect(Buffer.compare(voltou.conteudo, bytes)).toBe(0);
  });

  /**
   * CRITÉRIO 1, no banco — a prova que fecha o argumento.
   *
   * `painel-referencia.test.ts` já prova que o **enxerto** não altera o
   * cálculo. Este prova o degrau anterior e mais forte: `lerResumoDoMes`,
   * lendo o banco de verdade, devolve saída **idêntica** com e sem referência
   * anexada — e com uma referência trocada por outra completamente diferente.
   *
   * Não é redundância com a varredura estática de `contaminacao.test.ts`: lá se
   * prova que `persistencia.ts` não importa nem menciona a régua; aqui se prova
   * o efeito, contra Postgres, com a régua de fato gravada em três tabelas ao
   * lado. Se algum dia um `JOIN` distraído alcançar essas tabelas, é este teste
   * que cai.
   */
  it("com a referência gravada no banco, o resumo calculado sai idêntico", async () => {
    await limpar();
    for (const quinzena of [1, 2] as const) {
      await abrirCompetencia(db, {
        ano: JULHO.ano,
        mes: JULHO.mes,
        quinzena,
        unidade: { codigo: JULHO.unidade },
        transportadora: { codigo: JULHO.transportadora },
        tipoDeOperacao: JULHO.tipoDeOperacao,
      });
    }

    const alvo = {
      unidade: JULHO.unidade,
      transportadora: JULHO.transportadora,
      tipoDeOperacao: JULHO.tipoDeOperacao,
      ano: JULHO.ano,
      mes: JULHO.mes,
    };
    const semReferencia = await lerResumoDoMes(db, alvo);

    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v1.xlsb", conteudo: planilha(100) });
    const comV1 = await lerResumoDoMes(db, alvo);

    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v2.xlsb", conteudo: planilha(9_000_000) });
    const comV2 = await lerResumoDoMes(db, alvo);

    await pool.query(`DELETE FROM fechamento_referencia`);
    const removida = await lerResumoDoMes(db, alvo);

    expect(comV1, "anexar mudou o resumo calculado").toEqual(semReferencia);
    expect(comV2, "trocar mudou o resumo calculado").toEqual(semReferencia);
    expect(removida, "remover mudou o resumo calculado").toEqual(semReferencia);
  });

  it("e a referência estava mesmo lá — senão o teste acima é vazio", async () => {
    await limpar();
    await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "v1.xlsb", conteudo: planilha(100) });
    const ativa = await referenciaAtivaDoMes(db, JULHO);
    expect(ativa).not.toBeNull();
    expect(ativa!.numeros["rota_dvs"]!.primeira).toBe(100);
  });

  it("apagar a referência leva conteúdo e linhas junto — sem órfão", async () => {
    await limpar();
    const v = await anexarReferencia(db, { mes: JULHO, nomeDoArquivo: "p.xlsb", conteudo: planilha(100) });
    await pool.query(`DELETE FROM fechamento_referencia WHERE id = $1`, [v.id]);

    expect(await db.select().from(fechamentoReferenciaConteudoTable)).toEqual([]);
    expect(await db.select().from(fechamentoReferenciaLinhaTable)).toEqual([]);
  });
});
