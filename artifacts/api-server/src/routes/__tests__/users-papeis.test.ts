import { describe, expect, it } from "vitest";
import { somenteAdmin } from "../users";

/**
 * O portão de papel das rotas de conta.
 *
 * O achado que ele fecha: sem papel, qualquer conta redefinia a senha de
 * qualquer outra — tomada de conta a um clique. O portão é uma função pura de
 * propósito: cada rota de mutação o chama na primeira linha, e esta prova fixa
 * os três desfechos sem depender de banco. As recusas de "último admin" rodam
 * contra o banco e são provadas ao vivo no ambiente de desenvolvimento.
 */
describe("somenteAdmin", () => {
  it("deixa o administrador passar", () => {
    expect(somenteAdmin({ user: { role: "ADMIN" } })).toBeNull();
  });

  it("recusa o operador com a frase que diz a quem pedir", () => {
    const recusa = somenteAdmin({ user: { role: "OPERADOR" } });
    expect(recusa).toMatch(/administradores/i);
  });

  it("sem usuário na requisição, recusa — fail-closed", () => {
    expect(somenteAdmin({})).not.toBeNull();
  });

  it("papel desconhecido não é admin", () => {
    expect(somenteAdmin({ user: { role: "ROOT" } })).not.toBeNull();
  });
});
