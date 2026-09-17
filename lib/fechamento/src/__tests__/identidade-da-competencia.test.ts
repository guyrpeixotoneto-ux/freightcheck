import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  cadastrarUnidade,
  fechamentoCompetenciaTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";

import {
  abrirCompetencia,
  apurarCompetencia,
  associarUnidadeDaCompetencia,
  encerrarCompetencia,
  receberDocumento,
} from "../persistencia";
import {
  conciliarIdentidadeDasCompetencias,
  identidadeDaCompetencia,
} from "../identidade-da-competencia";

/**
 * A IDENTIDADE QUE SE PROPAGA — e a que se recusa a adivinhar.
 *
 * O caso real que originou este arquivo: julho/2026 do CDD Belém, as duas
 * quinzenas abertas com o texto `CDD Belém` no campo de código, a 1ª associada
 * à mão e a 2ª não. As duas pediam o contrato da mesma unidade e só uma o
 * alcançava — e a 2ª ficava esperando um segundo clique que a tela, com painel
 * comparado já montado, tinha deixado de oferecer.
 *
 * O que se prende aqui é a fronteira: **propagar uma decisão não é inferir uma
 * identidade.** Associar por CNPJ no próprio texto e por decisão que alguém já
 * tomou sobre o mesmo texto é afirmar o que já foi afirmado; associar por nome
 * parecido seria escolher no lugar de quem pode escolher. Os dois primeiros
 * escrevem; o terceiro nunca acontece.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_identidade_${process.pid}`;

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

const CNPJ_BELEM = "11.177.288/0001-90";
const CNPJ_OUTRA = "11.222.333/0001-81";

describe.skipIf(!temBanco)("a identidade de uma competência", () => {
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

  async function limpar() {
    await db.execute("DELETE FROM fechamento_competencia");
    await db.execute("DELETE FROM unidade");
  }

  const competencia = (id: string) =>
    db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, id))
      .then(([c]) => c!);

  const abrir = (quinzena: 1 | 2, codigo: string, mes = 7) =>
    abrirCompetencia(db, {
      ano: 2026,
      mes,
      quinzena,
      tipoDeOperacao: "ROTA",
      unidade: { codigo, nome: "CDD BELEM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });

  /* --- o CNPJ no próprio texto ------------------------------------------ */

  it("nasce associada quando o texto é o CNPJ de uma unidade cadastrada", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });

    /* A grafia com máscara é a mesma identidade — é o que `lerCnpj` decide. */
    const c = await abrir(1, CNPJ_BELEM);

    expect(c.unidadeId).toBe(u.id);
  });

  it("não nasce associada quando a unidade canônica ainda não existe", async () => {
    await limpar();
    const c = await abrir(1, CNPJ_BELEM);
    expect(c.unidadeId).toBeNull();
  });

  /* --- a decisão que alguém já tomou ------------------------------------ */

  /**
   * O CASO REAL, EM DUAS LINHAS.
   *
   * A 1ª quinzena existe sem identidade, alguém a associa, e a 2ª — aberta
   * depois, com o mesmo texto — nasce apontando para a mesma unidade. Antes
   * disto ela nascia nula e ficava esperando um clique próprio.
   */
  it("a 2ª quinzena nasce com a identidade que a 1ª já tinha", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });
    const primeira = await abrir(1, "CDD Belém");
    expect(primeira.unidadeId).toBeNull();

    await associarUnidadeDaCompetencia(db, primeira.id, u.id);

    const segunda = await abrir(2, "CDD Belém");
    expect(segunda.unidadeId).toBe(u.id);
  });

  /**
   * E a ordem inversa — a 2ª já existia quando a 1ª foi associada.
   *
   * É a situação de julho/2026: as duas competências abertas há semanas, e a
   * decisão chegando depois das duas. Associar uma passa a alcançar a outra.
   */
  it("associar uma quinzena alcança a irmã do mesmo texto que já existia", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });
    const primeira = await abrir(1, "CDD Belém");
    const segunda = await abrir(2, "CDD Belém");
    expect(segunda.unidadeId).toBeNull();

    await associarUnidadeDaCompetencia(db, primeira.id, u.id);

    expect((await competencia(segunda.id)).unidadeId).toBe(u.id);
  });

  it("salvar de novo não reescreve nada — a conciliação é idempotente", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });
    const primeira = await abrir(1, "CDD Belém");
    await associarUnidadeDaCompetencia(db, primeira.id, u.id);
    await abrir(2, "CDD Belém");

    /* Nada mais a fazer: as três listas vazias é a resposta de banco em dia. */
    const segunda = await conciliarIdentidadeDasCompetencias(db);
    expect(segunda).toEqual({ associadas: [], ambiguas: [], encerradas: [] });

    /* E reabrir o mesmo endereço devolve a mesma linha, com a mesma unidade. */
    const denovo = await abrir(1, "CDD Belém");
    expect(denovo.id).toBe(primeira.id);
    expect(denovo.unidadeId).toBe(u.id);
  });

  /* --- o que ela se recusa a fazer -------------------------------------- */

  /**
   * O NOME NUNCA DECIDE — nem quando é igualzinho.
   *
   * A unidade canônica chama-se `CDD BELEM` e a competência carrega o texto
   * `CDD Belém`. Um casamento por nome resolveria este caso e quebraria o
   * seguinte, que é o de dois CDDs homônimos em estados diferentes. A
   * competência fica sem identidade, e a tela oferece a associação com o CNPJ
   * ao lado — que é a única coisa que distingue duas unidades de mesmo nome.
   */
  it("nome igual não associa — nem com uma única unidade cadastrada", async () => {
    await limpar();
    await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });

    const c = await abrir(1, "CDD Belém");

    expect(c.unidadeId).toBeNull();
    expect(await identidadeDaCompetencia(db, { unidadeCodigo: "CDD Belém" })).toEqual({
      tipo: "DESCONHECIDA",
    });
  });

  /**
   * A AMBIGUIDADE REAL — duas respostas para o mesmo texto.
   *
   * Alguém associou duas competências de mesmo `unidade_codigo` a unidades
   * diferentes. É um erro humano, e um que só uma pessoa desfaz: escolher uma
   * das duas aqui poria o contrato de uma unidade a responder pelo fechamento
   * da outra, em silêncio.
   */
  it("duas decisões diferentes sobre o mesmo texto não escolhem nenhuma", async () => {
    await limpar();
    const belem = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });
    const outra = await cadastrarUnidade(db, { nome: "CDD OUTRA", cnpj: CNPJ_OUTRA });

    const julho = await abrir(1, "CDD Belém", 7);
    const agosto = await abrir(1, "CDD Belém", 8);
    await associarUnidadeDaCompetencia(db, julho.id, belem.id);
    /*
      A segunda associação é o erro sendo cometido — e ela é aceita, porque um
      humano pode estar corrigindo a primeira. O que a conciliação faz é parar
      de propagar a partir daí.
    */
    await associarUnidadeDaCompetencia(db, agosto.id, outra.id);

    const setembro = await abrir(1, "CDD Belém", 9);
    expect(setembro.unidadeId).toBeNull();

    const identidade = await identidadeDaCompetencia(db, {
      unidadeCodigo: "CDD Belém",
      competenciaId: setembro.id,
    });
    expect(identidade.tipo).toBe("AMBIGUA");

    const conciliacao = await conciliarIdentidadeDasCompetencias(db);
    expect(conciliacao.associadas).toEqual([]);
    expect(conciliacao.ambiguas.map((a) => a.competenciaId)).toEqual([setembro.id]);
    expect(conciliacao.ambiguas[0]?.candidatas).toHaveLength(2);
  });

  /**
   * A ENCERRADA É LISTADA, E NÃO TOCADA.
   *
   * Associar faz o Resumo achar o contrato e recalcular o devido — e uma
   * quinzena congelada que muda de número é o que o encerramento existe para
   * impedir. A conciliação não a silencia: devolve-a com a unidade que ela
   * teria, para a tela poder dizer que o conserto é reabrir com motivo.
   */
  it("a competência encerrada sai listada, com a unidade que ela teria", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });
    const primeira = await abrir(1, "CDD Belém");
    const segunda = await abrir(2, "CDD Belém");

    /* Encerrar exige apuração vigente — a quinzena precisa saber quanto vale. */
    await receberDocumento(db, {
      competenciaId: segunda.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "vazio.txt",
      conteudo: Buffer.from(""),
    });
    await apurarCompetencia(db, segunda.id);
    await encerrarCompetencia(db, segunda.id);

    await associarUnidadeDaCompetencia(db, primeira.id, u.id);

    const depois = await competencia(segunda.id);
    expect(depois.unidadeId).toBeNull();

    const conciliacao = await conciliarIdentidadeDasCompetencias(db);
    expect(conciliacao.associadas).toEqual([]);
    expect(conciliacao.encerradas.map((e) => e.competenciaId)).toEqual([segunda.id]);
    expect(conciliacao.encerradas[0]?.unidade.id).toBe(u.id);
  });

  /* --- a afirmação de quem cadastra ------------------------------------- */

  /**
   * O CÓDIGO QUE O EXPORT USA — afirmado no cadastro de Remuneração.
   *
   * `443` não é CNPJ e não casa com nada. Quando alguém registra a remuneração
   * de uma unidade canônica **escrevendo esse código**, está dizendo que aquela
   * grafia é daquela unidade — e é essa afirmação, não uma dedução, que a
   * conciliação propaga.
   */
  it("o código afirmado por quem cadastra alcança as competências daquele texto", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_BELEM });
    const c = await abrir(1, "443");
    expect(c.unidadeId).toBeNull();

    const conciliacao = await conciliarIdentidadeDasCompetencias(db, {
      unidadeId: u.id,
      codigos: ["443"],
    });

    expect(conciliacao.associadas.map((a) => a.competenciaId)).toEqual([c.id]);
    expect(conciliacao.associadas[0]?.como).toBe("CODIGO_AFIRMADO");
    expect((await competencia(c.id)).unidadeId).toBe(u.id);
  });
});
