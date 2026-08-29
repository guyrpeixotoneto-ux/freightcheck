import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { visualizacaoSomenteLeitura } from "../visualizacao-como";

/**
 * A recusa de escrita durante uma visualização, provada sem banco e sem HTTP.
 *
 * O que está em jogo não é uma preferência de interface: é a promessa de que
 * todo `actor` gravado por este produto corresponde a alguém que clicou. Uma
 * escrita atravessando este portão gravaria o nome de quem não clicou —
 * exatamente o defeito que fez o login existir.
 */

interface Resposta {
  status: number | null;
  corpo: unknown;
}

function correr(req: Partial<Request>): { seguiu: boolean; res: Resposta } {
  const res: Resposta = { status: null, corpo: null };
  let seguiu = false;
  const resposta = {
    status(codigo: number) {
      res.status = codigo;
      return this;
    },
    json(corpo: unknown) {
      res.corpo = corpo;
      return this;
    },
  } as unknown as Response;

  visualizacaoSomenteLeitura(req as Request, resposta, () => {
    seguiu = true;
  });

  return { seguiu, res };
}

const visualizando = {
  visualizacaoDesde: new Date(),
  user: { id: "u", name: "Bruno", email: "bruno@x.com", role: "OPERADOR" },
};

describe("fora de uma visualização, o portão não existe", () => {
  it("deixa passar qualquer escrita", () => {
    expect(correr({ method: "POST", path: "/curation/confirmar" }).seguiu).toBe(true);
  });
});

describe("durante uma visualização", () => {
  it("deixa passar leitura", () => {
    expect(correr({ ...visualizando, method: "GET", path: "/users" }).seguiu).toBe(true);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("recusa %s", (method) => {
    const { seguiu, res } = correr({ ...visualizando, method, path: "/curation/confirmar" });

    expect(seguiu).toBe(false);
    expect(res.status).toBe(403);
    expect(res.corpo).toMatchObject({ code: "VISUALIZANDO_COMO" });
    // A frase diz de quem é a máscara e onde fica a saída.
    expect(String((res.corpo as { error: string }).error)).toContain("Bruno");
  });

  /*
    As três saídas. Um portão que trancasse a porta por onde se sai deixaria a
    sessão presa dentro de outra conta até o cookie expirar — sete dias.
  */
  it.each([
    "/auth/visualizar-como",
    "/auth/visualizar-como/parar",
    "/auth/visualizar-como/parar/",
    "/auth/logout",
  ])("deixa passar a saída %s", (path) => {
    expect(correr({ ...visualizando, method: "POST", path }).seguiu).toBe(true);
  });
});
