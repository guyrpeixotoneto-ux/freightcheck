import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Database } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  abrirCompetencia,
  apurarCompetencia,
  lerApuracaoVigente,
  listarDocumentos,
  receberDocumento,
  RecusaDeFechamento,
} from "../persistencia";
import {
  fixtureConciliacao,
  fixtureCtes,
  fixtureDisponibilidade,
  fixtureOperacao,
  fixtureRequisicoes,
} from "./fixtures";

/**
 * A prova de que a apuração roda **sobre o que o banco guardou**.
 *
 * Os testes de `fechamento.test.ts` conferem a aritmética sem banco nenhum, que
 * é o certo para aritmética. Este confere a outra metade: que o documento
 * recebido vira linha gravada, que a linha gravada volta como fonte, e que a
 * conta refeita a partir dela é a mesma. Sem ele, os dois lados poderiam
 * divergir sem que nada acusasse.
 *
 * Precisa de um Postgres. Sem ele o arquivo é pulado inteiro em vez de falhar:
 * quem roda `vitest` para conferir uma mudança no leitor não deveria precisar
 * de banco para isso.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_fechamento_${process.pid}`;

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

const temBanco = await bancoAlcancavel();

describe.skipIf(!temBanco)("a apuração a partir do banco", () => {
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await admin.query(`CREATE DATABASE "${NOME}"`);
    await admin.end();
    const url = ADMIN.replace(/\/[^/?]+\?/, `/${NOME}?`);
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

  it("abrir a mesma competência duas vezes devolve a mesma", async () => {
    const a = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    const b = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    expect(b.id).toBe(a.id);
    expect(a.chave).toBe("2026-07-Q2");
  });

  it("recebe as cinco fontes e reproduz, do banco, a conta que a aritmética dá", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    const fontes = [
      ["OPERACAO", "2art.xlsx", fixtureOperacao()],
      ["CTE", "03.08.15.xlsx", fixtureCtes()],
      ["REQUISICOES", "03.08.12.09.csv", fixtureRequisicoes()],
      ["DISPONIBILIDADE", "03.08.18.xlsx", fixtureDisponibilidade()],
      ["CONCILIACAO", "03.02.59.02.txt", Buffer.from(fixtureConciliacao(), "latin1")],
    ] as const;
    for (const [tipo, nome, conteudo] of fontes) {
      await receberDocumento(db, {
        competenciaId: comp.id,
        tipo,
        nomeDoArquivo: nome,
        conteudo: conteudo as Buffer,
      });
    }

    await apurarCompetencia(db, comp.id);
    const apuracao = (await lerApuracaoVigente(db, comp.id))!;

    expect(apuracao.fontesAusentes).toEqual([]);
    /* Os mesmos números do teste sem banco — é essa igualdade que importa. */
    expect(apuracao.totais.emitido).toBe(4450);
    expect(apuracao.totais.naoConferido).toBe(2000);
    expect(apuracao.verbas.find((v) => v.vbz === 7)?.esperado).toBe(750);
    expect(apuracao.verbas.find((v) => v.vbz === 1)?.esperado).toBeNull();
    expect(apuracao.divergencias.some((d) => d.tipo === "DESCONTO_FRETE_MINIMO" && d.valor === 200)).toBe(true);
  }, 60_000);

  it("guarda a memória de cálculo de cada parcela, com o fator medido", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    const apuracao = (await lerApuracaoVigente(db, comp.id))!;
    const freteiro = apuracao.verbas.find((v) => v.vbz === 7)!;
    expect(freteiro.memoria).toHaveLength(2);
    const daRequisicao = freteiro.memoria.find((m) => m.origem === "REQUISICOES")!;
    expect(daRequisicao.semImposto).toBe(200);
    expect(daRequisicao.comImposto).toBe(250);
    expect(daRequisicao.fator).toBeCloseTo(1.25, 6);
  });

  it("recusa o mesmo arquivo duas vezes — recebê-lo de novo dobraria a conta", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 7, quinzena: 2, unidade, transportadora });
    await expect(
      receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "CTE",
        nomeDoArquivo: "03.08.15 (cópia).xlsx",
        conteudo: fixtureCtes(),
      }),
    ).rejects.toBeInstanceOf(RecusaDeFechamento);
  });

  it("reenviar uma exportação corrigida substitui a anterior e mantém as duas no histórico", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 8, quinzena: 1, unidade, transportadora });
    await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "REQUISICOES",
      nomeDoArquivo: "requisicoes.csv",
      conteudo: fixtureRequisicoes(),
    });
    const corrigido = Buffer.concat([
      fixtureRequisicoes(),
      Buffer.from(
        "\r\n443;CDD FICTICIO;GEO NO;3006;16/07/2026;Rota;Não;Não;036;TRANSPORTES FICTICIA;013;Incentivo;000009;Rota - Outras Despesas;Incentivo esquecido;Aprovada;10,00;27/07/2026;21:21;28/07/2026;15:45;;;1;2;;;;;;",
        "latin1",
      ),
    ]);
    const segundo = await receberDocumento(db, {
      competenciaId: comp.id,
      tipo: "REQUISICOES",
      nomeDoArquivo: "requisicoes (corrigido).csv",
      conteudo: corrigido,
    });

    expect(segundo.substituiu).not.toBeNull();
    const documentos = await listarDocumentos(db, comp.id);
    expect(documentos).toHaveLength(2);
    expect(documentos.filter((d) => d.vigente)).toHaveLength(1);
    expect(documentos.find((d) => d.vigente)?.linhasLidas).toBe(6);
  }, 60_000);

  it("uma competência encerrada não aceita documento", async () => {
    const comp = await abrirCompetencia(db, { ano: 2026, mes: 9, quinzena: 1, unidade, transportadora });
    await pool.query("update fechamento_competencia set estado = 'ENCERRADA' where id = $1", [comp.id]);
    await expect(
      receberDocumento(db, {
        competenciaId: comp.id,
        tipo: "CTE",
        nomeDoArquivo: "tarde-demais.xlsx",
        conteudo: fixtureCtes(),
      }),
    ).rejects.toMatchObject({ codigo: "COMPETENCIA_ENCERRADA" });
  });
});
