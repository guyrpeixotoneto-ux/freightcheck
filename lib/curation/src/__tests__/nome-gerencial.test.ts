import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  desfazerNormalizacaoDoNomeGerencial,
  normalizarNomeGerencial,
  preflightNomeGerencial,
} from "../nome-gerencial";
import { saveMeaning } from "../meaning";

/**
 * Normalizar o Nome Gerencial sem apagar o que uma pessoa escreveu.
 *
 * A rotina apaga a cópia que a promoção antiga fazia de `source_name`. O risco
 * inteiro está numa coincidência banal: alguém pode ter salvo, à mão,
 * exatamente o nome que já estava lá. Pelo valor as duas linhas são idênticas —
 * o que as separa é o `curation_event` que `saveMeaning` grava.
 *
 * E há uma segunda dúvida, que nenhum rastro resolve: o produto rodou em
 * produção antes de existir a história do git, e naquele período "não há
 * evento" não prova nada. Por isso o modo padrão é conservador — deixa de fora
 * tudo que nasceu antes do primeiro evento de curadoria do banco — e a
 * inclusão dessas linhas é uma decisão explícita de quem viu o preflight.
 *
 * O que este arquivo prova:
 *
 * 1. o preflight mede e **não escreve**;
 * 2. o nome salvo à mão fica, mesmo idêntico ao de origem;
 * 3. a janela cega fica de fora por padrão, e entra quando se pede;
 * 4. a volta atrás restaura exatamente o conjunto tocado — e nada além dele.
 */

let ctx: TestDb;

const COPIA = "cavalo.copia_da_maquina";
const IGUAL_A_MAO = "cavalo.salvo_a_mao_igual";
const APELIDO = "cavalo.apelido_de_verdade";
const NULO = "cavalo.nunca_teve_nome";
const ANTIGO = "cavalo.anterior_ao_log";

async function nomeDe(code: string): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ display_name: string | null }>(
    `SELECT display_name FROM attribute WHERE code = $1`,
    [code],
  );
  return rows[0].display_name;
}

beforeAll(async () => {
  ctx = await createTestDatabase("nome-gerencial");

  // Todas nascem como a promoção antiga as criava, menos as duas que existem
  // para provar que a rotina não as alcança. `IGUAL_A_MAO` nasce sem nome de
  // propósito: é a pessoa que vai escrevê-lo, logo abaixo.
  await ctx.pool.query(
    `INSERT INTO attribute (code, source_name, display_name, entity_type, data_type)
     VALUES ($1, 'copiaDaMaquina',   'copiaDaMaquina',   'CAVALO', 'TEXT'),
            ($2, 'salvoAMaoIgual',   NULL,               'CAVALO', 'TEXT'),
            ($3, 'apelidoDeVerdade', 'Nome que alguém escolheu', 'CAVALO', 'TEXT'),
            ($4, 'nuncaTeveNome',    NULL,               'CAVALO', 'TEXT'),
            ($5, 'anteriorAoLog',    'anteriorAoLog',    'CAVALO', 'TEXT')`,
    [COPIA, IGUAL_A_MAO, APELIDO, NULO, ANTIGO],
  );

  // O caso perigoso, montado pelo caminho de verdade: uma pessoa escolhe, à
  // mão, exatamente o texto do nome de origem. O estado final é indistinguível
  // da cópia da máquina — e `saveMeaning` grava o `curation_event` que é a
  // única coisa que os separa.
  await saveMeaning(ctx.db, {
    code: IGUAL_A_MAO,
    actor: "quem.curou@exemplo.com",
    displayName: "salvoAMaoIgual",
  });

  // As datas, depois do evento: quatro colunas nasceram na era do log, e uma
  // antes dela — a janela em que a ausência de rastro não prova nada.
  await ctx.db.execute(sql`
    UPDATE attribute SET created_at = now() WHERE code <> ${ANTIGO}`);
  await ctx.db.execute(sql`
    UPDATE attribute SET created_at = now() - interval '30 days'
     WHERE code = ${ANTIGO}`);
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o preflight", () => {
  it("mede sem escrever uma linha", async () => {
    const antes = await ctx.pool.query(`SELECT * FROM attribute ORDER BY code`);
    const p = await preflightNomeGerencial(ctx.db);
    const depois = await ctx.pool.query(`SELECT * FROM attribute ORDER BY code`);

    expect(depois.rows).toEqual(antes.rows);

    expect(p.totalDeAtributos).toBe(5);
    // COPIA, IGUAL_A_MAO e ANTIGO — o apelido de verdade e o nulo não contam.
    expect(p.iguaisAoNomeDeOrigem).toBe(3);
    expect(p.comEventoDeNomeGerencial).toBe(1);
    expect(p.anterioresAoPrimeiroEvento).toBe(1);
    // Só a cópia sem rastro e dentro da janela auditável.
    expect(p.seriamNormalizados).toBe(1);
    // Com a janela cega, a antiga entra junto.
    expect(p.seriamNormalizadosIncluindoAnteriores).toBe(2);
    expect(p.jaNormalizados).toBe(0);
    expect(p.primeiroEventoDeCuradoria).not.toBeNull();
  });

  it("recusa executar sem responsável", async () => {
    await expect(
      normalizarNomeGerencial(ctx.db, { actor: "  " }),
    ).rejects.toThrow(/responsável/);
  });
});

describe("a normalização", () => {
  it("apaga a cópia da máquina e preserva o nome salvo à mão", async () => {
    const r = await normalizarNomeGerencial(ctx.db, {
      actor: "quem.normalizou@exemplo.com",
    });

    expect(r.normalizados).toBe(1);
    expect(r.codigos).toEqual([COPIA]);

    expect(await nomeDe(COPIA)).toBeNull();
    // O caso perigoso: mesmo valor, mesma aparência — e fica.
    expect(await nomeDe(IGUAL_A_MAO)).toBe("salvoAMaoIgual");
    expect(await nomeDe(APELIDO)).toBe("Nome que alguém escolheu");
    // E a janela cega ficou de fora sem ninguém precisar pedir.
    expect(await nomeDe(ANTIGO)).toBe("anteriorAoLog");
  });

  it("registra o que apagou, com valor e responsável", async () => {
    const { rows } = await ctx.pool.query<{
      attribute_code: string;
      display_name_antes: string;
      normalizado_por: string;
      restaurado_em: Date | null;
    }>(`SELECT attribute_code, display_name_antes, normalizado_por, restaurado_em
          FROM nome_gerencial_normalizado ORDER BY attribute_code`);

    expect(rows).toHaveLength(1);
    expect(rows[0].attribute_code).toBe(COPIA);
    expect(rows[0].display_name_antes).toBe("copiaDaMaquina");
    expect(rows[0].normalizado_por).toBe("quem.normalizou@exemplo.com");
    expect(rows[0].restaurado_em).toBeNull();
  });

  it("é idempotente: a segunda passada não acha mais nada", async () => {
    const r = await normalizarNomeGerencial(ctx.db, {
      actor: "quem.normalizou@exemplo.com",
    });
    expect(r.normalizados).toBe(0);

    const { rows } = await ctx.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM nome_gerencial_normalizado`,
    );
    expect(Number(rows[0].n)).toBe(1);
  });
});

describe("a volta atrás", () => {
  it("restaura exatamente o conjunto tocado, e nada além dele", async () => {
    const r = await desfazerNormalizacaoDoNomeGerencial(ctx.db);

    expect(r.restaurados).toBe(1);
    expect(await nomeDe(COPIA)).toBe("copiaDaMaquina");

    // O que nunca teve nome continua sem nome: é a diferença entre esta volta
    // atrás e o `WHERE display_name IS NULL`, que reinstalaria o defeito num
    // conjunto maior do que o que foi alterado.
    expect(await nomeDe(NULO)).toBeNull();
    expect(await nomeDe(IGUAL_A_MAO)).toBe("salvoAMaoIgual");
    expect(await nomeDe(APELIDO)).toBe("Nome que alguém escolheu");
  });

  it("marca o registro como restaurado, sem apagá-lo", async () => {
    const { rows } = await ctx.pool.query<{ restaurado_em: Date | null }>(
      `SELECT restaurado_em FROM nome_gerencial_normalizado`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].restaurado_em).not.toBeNull();
  });

  it("desfazer duas vezes não desfaz nada de novo", async () => {
    const r = await desfazerNormalizacaoDoNomeGerencial(ctx.db);
    expect(r.restaurados).toBe(0);
    expect(await nomeDe(COPIA)).toBe("copiaDaMaquina");
  });
});

describe("a janela cega, quando alguém decide incluí-la", () => {
  it("normaliza também o que nasceu antes do primeiro evento", async () => {
    const r = await normalizarNomeGerencial(ctx.db, {
      actor: "quem.normalizou@exemplo.com",
      incluirAnterioresAoLog: true,
    });

    expect(r.normalizados).toBe(2);
    expect(r.codigos).toEqual([ANTIGO, COPIA]);
    expect(await nomeDe(ANTIGO)).toBeNull();
    expect(await nomeDe(COPIA)).toBeNull();

    // E o nome salvo à mão continua fora de alcance, em qualquer modo.
    expect(await nomeDe(IGUAL_A_MAO)).toBe("salvoAMaoIgual");
  });

  it("e continua reversível linha a linha", async () => {
    const r = await desfazerNormalizacaoDoNomeGerencial(ctx.db);
    expect(r.restaurados).toBe(2);
    expect(await nomeDe(ANTIGO)).toBe("anteriorAoLog");
    expect(await nomeDe(COPIA)).toBe("copiaDaMaquina");
    expect(await nomeDe(NULO)).toBeNull();
  });
});
