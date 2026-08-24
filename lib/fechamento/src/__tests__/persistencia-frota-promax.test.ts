import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { fechamentoFrotaPromaxTable, type Database } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  abrirCompetencia,
  compararFrotaDaCompetencia,
  descartarDadosDaCompetencia,
  excluirCompetencia,
  lerFrotaPromaxDaCompetencia,
  listarDocumentos,
  receberDocumento,
  RecusaDeFechamento,
} from "../persistencia";

/**
 * A FROTA PROMAX, GRAVADA — importação, cascata, isolamento e conflito, contra
 * um banco de verdade.
 *
 * Cobre os itens 8, 9 e 10 do checklist de regressão: a tabela nova
 * (`fechamento_frota_promax`) rastreia até competência/documento/linha, a
 * exclusão em cascata funciona pela porta pública (`receberDocumento` →
 * `excluirCompetencia`, não SQL direto), e duas competências não vazam linha
 * uma para a outra.
 *
 * Mesmo padrão de banco descartável de `persistencia.test.ts`: pula fora do
 * CI quando não há Postgres alcançável.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_frota_promax_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function bancoAlcancavel(): Promise<boolean> {
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

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

function planilhaFrota(linhas: [string, string, string, string][]): Buffer {
  const wb = XLSX.utils.book_new();
  const matriz = [["Unidade", "Placa", "Modelo", "Categoria"], ...linhas];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), "Frota");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe.skipIf(!temBanco)("a frota Promax, do envio ao banco", () => {
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await admin.query(`CREATE DATABASE "${NOME}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  const unidade = { codigo: "443", nome: "CDD FICTICIO" };
  const transportadora = { codigo: "36", nome: "TRANSPORTES FICTICIA LTDA" };
  const tipoDeOperacao = "EMPURRADA";

  it("recebe o 01.22.02.00 e grava uma linha por veículo, rastreável até a linha do arquivo", async () => {
    const competencia = await abrirCompetencia(db, {
      ano: 2026, mes: 8, quinzena: 1, unidade, transportadora, tipoDeOperacao,
    });

    const recebido = await receberDocumento(db, {
      competenciaId: competencia.id,
      tipo: "FROTA_PROMAX_ATIVA",
      nomeDoArquivo: "01.22.02.00.xlsx",
      conteudo: planilhaFrota([
        ["443", "ABC1D23", "TRUCK VW", "FF"],
        ["443", "XYZ9W88", "VAN FIORINO", "VAN"],
      ]),
    });

    expect(recebido.desfecho).toBe("PROMOVIDO");
    expect(recebido.linhasLidas).toBe(2);

    const veiculos = await lerFrotaPromaxDaCompetencia(db, competencia.id);
    expect(veiculos).toHaveLength(2);
    expect(veiculos.map((v) => v.placa).sort()).toEqual(["ABC1D23", "XYZ9W88"]);
    for (const v of veiculos) {
      expect(v.situacao).toBe("ATIVA");
      expect(v.linha).toBeGreaterThan(1);
    }
  });

  it("recebe o 01.22.08.00 na mesma competência sem apagar as linhas da ativa", async () => {
    const competencia = await abrirCompetencia(db, {
      ano: 2026, mes: 8, quinzena: 2, unidade, transportadora, tipoDeOperacao,
    });

    await receberDocumento(db, {
      competenciaId: competencia.id,
      tipo: "FROTA_PROMAX_ATIVA",
      nomeDoArquivo: "01.22.02.00.xlsx",
      conteudo: planilhaFrota([["443", "ABC1D23", "TRUCK VW", "FF"]]),
    });
    await receberDocumento(db, {
      competenciaId: competencia.id,
      tipo: "FROTA_PROMAX_INATIVA",
      nomeDoArquivo: "01.22.08.00.xlsx",
      conteudo: planilhaFrota([["443", "OLD2K11", "TRUCK VW", "FF"]]),
    });

    const veiculos = await lerFrotaPromaxDaCompetencia(db, competencia.id);
    expect(veiculos).toHaveLength(2);
    expect(veiculos.find((v) => v.placa === "ABC1D23")?.situacao).toBe("ATIVA");
    expect(veiculos.find((v) => v.placa === "OLD2K11")?.situacao).toBe("INATIVA");

    const documentos = await listarDocumentos(db, competencia.id);
    const tipos = documentos.map((d) => d.tipo).sort();
    expect(tipos).toEqual(["FROTA_PROMAX_ATIVA", "FROTA_PROMAX_INATIVA"]);
  });

  it("um arquivo sem cabeçalho reconhecível não promove nada — vai para quarentena, e o anterior continua de pé", async () => {
    const competencia = await abrirCompetencia(db, {
      ano: 2026, mes: 8, quinzena: 1, unidade: { codigo: "999", nome: "CDD QUARENTENA" },
      transportadora, tipoDeOperacao,
    });

    await receberDocumento(db, {
      competenciaId: competencia.id,
      tipo: "FROTA_PROMAX_ATIVA",
      nomeDoArquivo: "01.22.02.00-primeiro.xlsx",
      conteudo: planilhaFrota([["443", "ABC1D23", "TRUCK VW", "FF"]]),
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Coluna X", "Coluna Y"], ["a", "b"]]),
      "Sheet1",
    );
    const arquivoErrado = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    await expect(
      receberDocumento(db, {
        competenciaId: competencia.id,
        tipo: "FROTA_PROMAX_ATIVA",
        nomeDoArquivo: "arquivo-errado.xlsx",
        conteudo: arquivoErrado,
      }),
    ).rejects.toThrow(RecusaDeFechamento);

    /* O primeiro documento, e a linha dele, continuam de pé — a recusa não
       apagou o que já valia. */
    const veiculos = await lerFrotaPromaxDaCompetencia(db, competencia.id);
    expect(veiculos).toHaveLength(1);
    expect(veiculos[0]!.placa).toBe("ABC1D23");
  });

  describe("cascata e isolamento — a mesma proteção das demais fontes", () => {
    it("descartar os dados da competência apaga as linhas de frota junto", async () => {
      const competencia = await abrirCompetencia(db, {
        ano: 2026, mes: 9, quinzena: 1, unidade, transportadora, tipoDeOperacao,
      });
      await receberDocumento(db, {
        competenciaId: competencia.id,
        tipo: "FROTA_PROMAX_ATIVA",
        nomeDoArquivo: "01.22.02.00.xlsx",
        conteudo: planilhaFrota([
          ["443", "AAA1A11", "TRUCK", "FF"],
          ["443", "BBB2B22", "TRUCK", "FF"],
        ]),
      });

      const descartado = await descartarDadosDaCompetencia(db, competencia.id);
      expect(descartado.linhas.FROTA_PROMAX_ATIVA).toBe(2);

      const veiculos = await lerFrotaPromaxDaCompetencia(db, competencia.id);
      expect(veiculos).toHaveLength(0);
    });

    it("excluir a competência leva as linhas de frota — cascade até o fim", async () => {
      const competencia = await abrirCompetencia(db, {
        ano: 2026, mes: 9, quinzena: 2, unidade, transportadora, tipoDeOperacao,
      });
      await receberDocumento(db, {
        competenciaId: competencia.id,
        tipo: "FROTA_PROMAX_INATIVA",
        nomeDoArquivo: "01.22.08.00.xlsx",
        conteudo: planilhaFrota([["443", "CCC3C33", "TRUCK", "FF"]]),
      });

      await excluirCompetencia(db, competencia.id);

      /* Não há mais competência para perguntar via `lerFrotaPromaxDaCompetencia`
         (ela lançaria) — a prova direta é que a linha não sobrevive no banco. */
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM "fechamento_frota_promax" WHERE "competencia_id" = $1`,
        [competencia.id],
      );
      expect(rows[0].n).toBe(0);
    });

    it("duas competências não compartilham linha nenhuma de frota — multi-tenant pela competência", async () => {
      const a = await abrirCompetencia(db, {
        ano: 2026, mes: 10, quinzena: 1, unidade, transportadora, tipoDeOperacao,
      });
      const b = await abrirCompetencia(db, {
        ano: 2026, mes: 10, quinzena: 1,
        unidade: { codigo: "081", nome: "OUTRO CDD" },
        transportadora: { codigo: "77", nome: "OUTRA TRANSPORTADORA" },
        tipoDeOperacao,
      });

      await receberDocumento(db, {
        competenciaId: a.id,
        tipo: "FROTA_PROMAX_ATIVA",
        nomeDoArquivo: "01.22.02.00.xlsx",
        conteudo: planilhaFrota([["443", "AAA1A11", "TRUCK", "FF"]]),
      });
      await receberDocumento(db, {
        competenciaId: b.id,
        tipo: "FROTA_PROMAX_ATIVA",
        nomeDoArquivo: "01.22.02.00.xlsx",
        conteudo: planilhaFrota([
          ["081", "BBB2B22", "TRUCK", "FF"],
          ["081", "CCC3C33", "TRUCK", "FF"],
        ]),
      });

      const veiculosDeA = await lerFrotaPromaxDaCompetencia(db, a.id);
      const veiculosDeB = await lerFrotaPromaxDaCompetencia(db, b.id);
      expect(veiculosDeA).toHaveLength(1);
      expect(veiculosDeB).toHaveLength(2);
      expect(veiculosDeA.map((v) => v.placa)).not.toEqual(
        expect.arrayContaining(veiculosDeB.map((v) => v.placa)),
      );

      /* Descartar A não toca em B. */
      await descartarDadosDaCompetencia(db, a.id);
      const veiculosDeBDepois = await lerFrotaPromaxDaCompetencia(db, b.id);
      expect(veiculosDeBDepois).toHaveLength(2);
    });
  });

  describe("a comparação contra o contrato — via a porta pública", () => {
    it("sem cadastro (SEM_CADASTRO por padrão), a comparação aparece sem referência nenhuma", async () => {
      const competencia = await abrirCompetencia(db, {
        ano: 2026, mes: 11, quinzena: 1, unidade, transportadora, tipoDeOperacao,
      });
      await receberDocumento(db, {
        competenciaId: competencia.id,
        tipo: "FROTA_PROMAX_ATIVA",
        nomeDoArquivo: "01.22.02.00.xlsx",
        conteudo: planilhaFrota([["443", "AAA1A11", "TRUCK", "FF"]]),
      });

      const { comparacao } = await compararFrotaDaCompetencia(db, competencia.id);
      expect(comparacao.grupos).toHaveLength(1);
      expect(comparacao.grupos[0]!.quantidadePromax).toBe(1);
      expect(comparacao.grupos[0]!.referencias).toEqual([]);
    });

    it("com cadastro, compara contra os números do contrato", async () => {
      const competencia = await abrirCompetencia(db, {
        ano: 2026, mes: 11, quinzena: 2, unidade, transportadora, tipoDeOperacao,
      });
      await receberDocumento(db, {
        competenciaId: competencia.id,
        tipo: "FROTA_PROMAX_ATIVA",
        nomeDoArquivo: "01.22.02.00.xlsx",
        conteudo: planilhaFrota([
          ["443", "AAA1A11", "TRUCK", "FF"],
          ["443", "BBB2B22", "TRUCK", "FF"],
        ]),
      });

      const cadastroEmMemoria = {
        async resolver() {
          return {
            resposta: {
              parametros: {
                frotaFixaAtiva: 3,
                frotaFixaInativa: 0,
                vansAtivas: 0,
                vansInativas: 0,
              },
              custoVariavelPrevistoPor25Viagens: 0,
              identidade: null,
            },
            diagnostico: null,
          } as never;
        },
      };

      const { comparacao } = await compararFrotaDaCompetencia(db, competencia.id, cadastroEmMemoria);
      const grupo = comparacao.grupos[0]!;
      expect(grupo.quantidadePromax).toBe(2);
      expect(grupo.referencias[0]!.quantidade).toBe(3);
      expect(grupo.referencias[0]!.movimento).toBe("DESCEU");
      expect(grupo.referencias[0]!.diferenca).toBe(-1);
    });
  });
});
