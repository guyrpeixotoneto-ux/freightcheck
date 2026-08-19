import { describe, expect, it } from "vitest";
import { AMBIENTES, ambienteDe, descricaoDoAmbiente } from "../ambiente";

/**
 * A regra que separa os dois espaços de trabalho é uma só — tudo sob
 * `/fechamento` é Fechamento, o resto é Auditoria — e este teste a guarda nos
 * pontos onde ela quebraria em silêncio: o prefixo que casa por engano
 * (`/fechamentos` não é o ambiente) e a raiz exata.
 */
describe("ambienteDe", () => {
  it("lê a raiz e tudo abaixo dela como Fechamento", () => {
    expect(ambienteDe("/fechamento")).toBe("fechamento");
    expect(ambienteDe("/fechamento/apuracao")).toBe("fechamento");
    expect(ambienteDe("/fechamento/competencias")).toBe("fechamento");
  });

  it("lê todo o resto como Auditoria — inclusive o quase-prefixo", () => {
    expect(ambienteDe("/")).toBe("auditoria");
    expect(ambienteDe("/alteracoes")).toBe("auditoria");
    expect(ambienteDe("/dre/abc-123")).toBe("auditoria");
    expect(ambienteDe("/fechamentos")).toBe("auditoria");
  });
});

describe("os ambientes", () => {
  it("são dois, e a home de cada um vive no ambiente que ela abre", () => {
    expect(AMBIENTES.map((a) => a.id)).toEqual(["auditoria", "fechamento"]);
    for (const ambiente of AMBIENTES) {
      expect(ambienteDe(ambiente.home)).toBe(ambiente.id);
    }
  });

  it("descreve cada id com o próprio registro", () => {
    expect(descricaoDoAmbiente("auditoria").nome).toBe("Auditoria");
    expect(descricaoDoAmbiente("fechamento").nome).toBe("Fechamento");
  });
});
