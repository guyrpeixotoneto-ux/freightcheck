import { afterEach, describe, expect, it } from "vitest";
import { opcoesDoPool } from "../index";

/**
 * Os limites do pool são escritos, nunca os defaults do driver.
 *
 * O default do `pg` é esperar para sempre por conexão livre e deixar uma query
 * rodar para sempre — com dez conexões e uma consulta travada, o produto
 * inteiro pendurava em silêncio, inclusive o check de sessão. Estas provas
 * fixam que os quatro limites existem e que o operador consegue ajustá-los.
 */

const CHAVES = [
  "DB_POOL_MAX",
  "DB_CONNECT_TIMEOUT_MS",
  "DB_IDLE_TIMEOUT_MS",
  "DB_STATEMENT_TIMEOUT_MS",
];

afterEach(() => {
  for (const chave of CHAVES) delete process.env[chave];
});

describe("opcoesDoPool", () => {
  it("nenhum limite fica no default infinito do driver", () => {
    const opcoes = opcoesDoPool();
    expect(opcoes.max).toBeGreaterThan(0);
    expect(opcoes.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(opcoes.idleTimeoutMillis).toBeGreaterThan(0);
    expect(opcoes.statement_timeout).toBeGreaterThan(0);
  });

  it("o teto de statement é largo o bastante para a promoção real", () => {
    // A promoção de uma vigência grande é uma transação legítima de dezenas de
    // segundos; um teto de um minuto a mataria no meio.
    expect(opcoesDoPool().statement_timeout).toBeGreaterThanOrEqual(120_000);
  });

  it("o operador ajusta por env, e valor sem sentido cai no padrão", () => {
    process.env["DB_POOL_MAX"] = "25";
    process.env["DB_STATEMENT_TIMEOUT_MS"] = "abc";
    const opcoes = opcoesDoPool();
    expect(opcoes.max).toBe(25);
    expect(opcoes.statement_timeout).toBe(120_000);
  });
});
