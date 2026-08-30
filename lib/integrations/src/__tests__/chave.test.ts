import { describe, expect, it } from "vitest";
import {
  CABECALHO_DA_CHAVE,
  FORMATO_DA_CHAVE,
  chaveApresentada,
  chaveConfere,
  emitirChave,
  hashDaChave,
  prefixoDe,
} from "../chave";

/**
 * O que uma chave promete, provado sem servidor nenhum de pé.
 *
 * Três promessas, e cada uma corresponde a um jeito conhecido de vazar
 * credencial: ela é imprevisível, o banco não guarda o segredo, e nada que
 * chegue de fora vira consulta antes de ter o formato certo.
 */
describe("a chave emitida", () => {
  it("tem o formato do produto e um prefixo que a identifica", () => {
    const chave = emitirChave();
    expect(chave.segredo).toMatch(FORMATO_DA_CHAVE);
    expect(chave.segredo.startsWith(`${chave.prefixo}_`)).toBe(true);
    expect(chave.prefixo).toMatch(/^fck_[0-9a-f]{12}$/);
  });

  it("nunca sai igual duas vezes", () => {
    const emitidas = new Set(
      Array.from({ length: 200 }, () => emitirChave().segredo),
    );
    expect(emitidas.size).toBe(200);
  });

  it("guarda o hash, e o hash não contém a chave", () => {
    const chave = emitirChave();
    expect(chave.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(chave.hash).not.toContain(chave.segredo.split("_")[2]);
    expect(hashDaChave(chave.segredo)).toBe(chave.hash);
  });
});

describe("a conferência", () => {
  it("aceita a mesma chave e recusa qualquer outra", () => {
    const chave = emitirChave();
    expect(chaveConfere(hashDaChave(chave.segredo), chave.hash)).toBe(true);
    expect(chaveConfere(hashDaChave(`${chave.segredo}x`), chave.hash)).toBe(false);
    expect(chaveConfere(hashDaChave(emitirChave().segredo), chave.hash)).toBe(false);
  });

  it("recusa hash vazio ou de tamanho diferente sem lançar", () => {
    const chave = emitirChave();
    expect(chaveConfere("", chave.hash)).toBe(false);
    expect(chaveConfere("ab", chave.hash)).toBe(false);
    expect(chaveConfere(chave.hash, "")).toBe(false);
  });
});

describe("o formato recusa antes de tocar o banco", () => {
  it.each([
    ["vazia", ""],
    ["um JWT de outro sistema", "eyJhbGciOiJIUzI1NiJ9.e30.abc"],
    ["a chave pela metade", "fck_a1b2c3d4e5f6"],
    ["carimbo de outro produto", "sk_live_a1b2c3d4e5f6_" + "0".repeat(64)],
    ["hex maiúsculo", "fck_A1B2C3D4E5F6_" + "0".repeat(64)],
  ])("%s não tem prefixo reconhecível", (_caso, valor) => {
    expect(prefixoDe(valor)).toBeNull();
  });

  it("a chave inteira devolve o prefixo público", () => {
    const chave = emitirChave();
    expect(prefixoDe(chave.segredo)).toBe(chave.prefixo);
  });
});

describe("o cabeçalho", () => {
  const chave = "fck_a1b2c3d4e5f6_" + "9".repeat(64);

  it("lê o Bearer", () => {
    expect(chaveApresentada({ authorization: `Bearer ${chave}` })).toBe(chave);
    expect(chaveApresentada({ authorization: `bearer ${chave}` })).toBe(chave);
  });

  it("lê o cabeçalho próprio quando não há Authorization", () => {
    expect(chaveApresentada({ chavePropria: chave })).toBe(chave);
    expect(CABECALHO_DA_CHAVE).toBe("x-freightcheck-key");
  });

  it("não lê Basic nem cabeçalho ausente", () => {
    expect(chaveApresentada({ authorization: "Basic dXNlcjpwYXNz" })).toBeNull();
    expect(chaveApresentada({})).toBeNull();
  });
});
