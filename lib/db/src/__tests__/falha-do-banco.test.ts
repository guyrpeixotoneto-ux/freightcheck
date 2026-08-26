/**
 * A causa real, travada contra o dia em que ela sumiu.
 *
 * Em 26/08/2026 `curar:direcao-economica-trecho` devolveu 110 linhas assim:
 *
 *     Failed query: select "id", "code", … from "attribute" where "attribute"."code" = $1
 *     params: trecho.frete_liquido
 *
 * Esse texto foi reproduzido neste repositório a partir de **duas** causas que
 * pedem ações opostas — `ALTER TABLE attribute DROP COLUMN change_rule`
 * (SQLSTATE 42703) e uma porta fechada (ECONNREFUSED) — e as duas saídas eram
 * indistinguíveis. Os testes abaixo existem para que voltar a mascarar a causa
 * quebre a suíte, e não a operação.
 *
 * Metade deles não usa mock: o embrulho é do driver, então um mock provaria
 * apenas que o mock imita o que se acredita que o driver faça. O caso de rede
 * roda sempre (só precisa de uma porta fechada); o de SQLSTATE roda quando há
 * banco.
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "../index";
import { descreverFalhaDoBanco, textoDaFalhaDoBanco } from "../falha-do-banco";

const temBanco = Boolean(process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL);
const URL_DO_BANCO = process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

/** O envelope do drizzle, com a causa que o Postgres devolve. */
function comoODrizzleEmbrulha(causa: Error): Error {
  const envelope = new Error(
    'Failed query: select "id", "code" from "attribute" where "attribute"."code" = $1\nparams: trecho.frete_liquido',
  );
  envelope.cause = causa;
  return envelope;
}

function erroDoPostgres(mensagem: string, code: string): Error {
  return Object.assign(new Error(mensagem), { code, severity: "ERROR" });
}

describe("separar SQLSTATE de código de rede", () => {
  it("coluna ausente é schema atrasado, com o SQLSTATE e o objeto nomeados", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(erroDoPostgres('column "change_rule" does not exist', "42703")),
    );

    expect(falha.classe).toBe("SCHEMA_ATRASADO");
    expect(falha.sqlstate).toBe("42703");
    expect(falha.codigoDeRede).toBeNull();
    expect(falha.objetoAusente).toBe("change_rule");
    expect(falha.estrutural).toBe(true);
  });

  it("tabela ausente também é schema atrasado", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(erroDoPostgres('relation "attribute" does not exist', "42P01")),
    );

    expect(falha.classe).toBe("SCHEMA_ATRASADO");
    expect(falha.objetoAusente).toBe("attribute");
  });

  it("banco inexistente não é schema atrasado — a ação é outra", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(erroDoPostgres('database "x" does not exist', "3D000")),
    );

    expect(falha.classe).toBe("BANCO_INEXISTENTE");
    expect(falha.sqlstate).toBe("3D000");
  });

  it("statement_timeout é TIMEOUT, e não conexão: o banco respondeu", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(
        erroDoPostgres("canceling statement due to statement timeout", "57014"),
      ),
    );

    expect(falha.classe).toBe("TIMEOUT");
    expect(falha.sqlstate).toBe("57014");
  });

  it("porta fechada é conexão, e não schema: nada foi lido", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:59999"), {
          code: "ECONNREFUSED",
        }),
      ),
    );

    expect(falha.classe).toBe("CONEXAO");
    expect(falha.codigoDeRede).toBe("ECONNREFUSED");
    expect(falha.sqlstate).toBeNull();
  });

  it("timeout de conexão do pg chega sem código nenhum, e ainda assim é estrutural", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(new Error("Connection terminated due to connection timeout")),
    );

    expect(falha.classe).toBe("TIMEOUT");
    expect(falha.estrutural).toBe(true);
  });

  /*
    `EPIPE` tem cinco caracteres, como um SQLSTATE. Sem a âncora no dígito
    inicial ele seria lido como código do Postgres e a saída diria "o Postgres
    recusou" sobre um socket que caiu.
  */
  it("EPIPE tem cinco caracteres e mesmo assim não é confundido com SQLSTATE", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })),
    );

    expect(falha.classe).toBe("CONEXAO");
    expect(falha.sqlstate).toBeNull();
    expect(falha.codigoDeRede).toBe("EPIPE");
  });
});

describe("falha da aplicação não é falha do banco", () => {
  /*
    `definirDirecaoEconomica` lança esta frase quando o código não existe na
    tabela. Ela fala de uma linha; classificá-la como estrutural faria a
    rodada parar no primeiro atributo obsoleto do dicionário.
  */
  it('"Atributo não encontrado" não é estrutural', () => {
    const falha = descreverFalhaDoBanco(new Error('Atributo "trecho.x" não encontrado.'));

    expect(falha.classe).toBe("FALHA_DA_APLICACAO");
    expect(falha.estrutural).toBe(false);
    expect(falha.mensagem).toBe('Atributo "trecho.x" não encontrado.');
  });
});

describe("a saída publicada carrega a causa", () => {
  /*
    O teste que fecha a porta do defeito: não basta classificar certo, o texto
    impresso tem de conter o motivo. A saída antiga continha o SQL e nada mais.
    Se alguém voltar a publicar só o envelope, isto quebra.
    */
  it("imprime SQLSTATE e a mensagem do Postgres, nunca o SQL do envelope", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(erroDoPostgres('column "change_rule" does not exist', "42703")),
    );
    const texto = textoDaFalhaDoBanco(falha).join("\n");

    expect(texto).toContain("42703");
    expect(texto).toContain('column "change_rule" does not exist');
    expect(texto).toContain("change_rule");
    expect(texto).not.toContain("Failed query");
  });

  it("sem SQLSTATE, publica o código de rede — nunca 'sem código' calado", () => {
    const falha = descreverFalhaDoBanco(
      comoODrizzleEmbrulha(
        Object.assign(new Error("getaddrinfo ENOTFOUND host.invalido"), { code: "ENOTFOUND" }),
      ),
    );
    const texto = textoDaFalhaDoBanco(falha).join("\n");

    expect(texto).toContain("ENOTFOUND");
    expect(texto).toContain("getaddrinfo ENOTFOUND host.invalido");
  });
});

/*
  Contra o driver de verdade. O embrulho é dele, e a garantia que interessa é
  a de que `cause` continua chegando onde este módulo a procura — coisa que
  nenhum mock pode provar.
*/
describe("contra o driver, sem mock", () => {
  it("porta fechada chega classificada como conexão", async () => {
    const anterior = process.env.DB_CONNECT_TIMEOUT_MS;
    process.env.DB_CONNECT_TIMEOUT_MS = "2000";
    const { db, pool } = createDb("postgres://postgres@127.0.0.1:1/nao_existe");
    try {
      await db.execute(sql`select 1`);
      expect.unreachable("a porta 1 não deveria aceitar conexão");
    } catch (err) {
      const falha = descreverFalhaDoBanco(err);
      expect(falha.estrutural).toBe(true);
      expect(["CONEXAO", "TIMEOUT"]).toContain(falha.classe);
      expect(falha.classe).not.toBe("SCHEMA_ATRASADO");
    } finally {
      await pool.end();
      if (anterior === undefined) delete process.env.DB_CONNECT_TIMEOUT_MS;
      else process.env.DB_CONNECT_TIMEOUT_MS = anterior;
    }
  });

  it.skipIf(!temBanco)("coluna inexistente chega com SQLSTATE 42703", async () => {
    const { db, pool } = createDb(URL_DO_BANCO);
    try {
      await db.execute(sql`select coluna_que_nao_existe from information_schema.tables`);
      expect.unreachable("o Postgres deveria ter recusado a coluna");
    } catch (err) {
      const falha = descreverFalhaDoBanco(err);
      expect(falha.sqlstate).toBe("42703");
      expect(falha.classe).toBe("SCHEMA_ATRASADO");
      expect(falha.objetoAusente).toBe("coluna_que_nao_existe");
    } finally {
      await pool.end();
    }
  });
});
