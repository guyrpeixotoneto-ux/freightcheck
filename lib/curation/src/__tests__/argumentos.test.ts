/**
 * O responsável da curadoria, travado contra o dia em que ele virou `--`.
 *
 * `pnpm run curar:direcao-economica-trecho -- "seu@email.com"` entrega ao
 * processo `["--", "seu@email.com"]`. A validação antiga lia `argv[2]` e só
 * perguntava se estava vazio — `"--"` não está —, e a rodada de 26/08/2026
 * anunciou `como --…`. Se o banco tivesse respondido, os 110 `curation_event`
 * teriam sido assinados por `--`: uma curadoria com aparência de auditada e
 * sem dono, que é o estado que `definirDirecaoEconomica` exige responsável
 * justamente para impedir.
 */
import { describe, expect, it } from "vitest";
import { argumentosPosicionais, atorDosArgumentos } from "../cli/argumentos";

describe("o separador do pnpm nunca vira ator", () => {
  it("descarta o `--` que o pnpm repassa e fica com o e-mail", () => {
    expect(atorDosArgumentos(["--", "guyrpeixoto.neto@gmail.com"])).toBe(
      "guyrpeixoto.neto@gmail.com",
    );
  });

  it("funciona igual quando o pnpm não repassa nada", () => {
    expect(atorDosArgumentos(["guyrpeixoto.neto@gmail.com"])).toBe("guyrpeixoto.neto@gmail.com");
  });

  it("`--` sozinho é ausência de responsável, e não um responsável chamado `--`", () => {
    expect(atorDosArgumentos(["--"])).toBeNull();
  });

  it("dois separadores seguidos continuam sendo ausência", () => {
    expect(atorDosArgumentos(["--", "--"])).toBeNull();
  });

  it("sem argumento nenhum, é null", () => {
    expect(atorDosArgumentos([])).toBeNull();
  });

  /*
    O critério é "começa por `-`", e não uma lista de separadores conhecidos:
    uma bandeira futura (`--dry-run`) entraria na lista velha como ator.
  */
  it("uma bandeira qualquer não é ator", () => {
    expect(atorDosArgumentos(["--dry-run", "guyrpeixoto.neto@gmail.com"])).toBe(
      "guyrpeixoto.neto@gmail.com",
    );
    expect(atorDosArgumentos(["-f"])).toBeNull();
  });

  it("espaço em branco não vira responsável", () => {
    expect(atorDosArgumentos(["   "])).toBeNull();
    expect(atorDosArgumentos(["--", "  "])).toBeNull();
  });

  it("o e-mail sai sem os espaços das bordas", () => {
    expect(atorDosArgumentos(["--", "  guyrpeixoto.neto@gmail.com  "])).toBe(
      "guyrpeixoto.neto@gmail.com",
    );
  });

  it("preserva a ordem dos posicionais para quem precisar de mais de um", () => {
    expect(argumentosPosicionais(["--", "a", "--flag", "b"])).toEqual(["a", "b"]);
  });
});
