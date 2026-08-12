/**
 * As três coisas que, se estiverem erradas, deixam a porta aberta sem que nada
 * pareça quebrado: a senha conferir quando não devia, o token de sessão ser
 * comparável a olho, e uma rota nova nascer pública por engano.
 */
import { describe, expect, it } from "vitest";
import {
  describeEmailProblem,
  describePasswordProblem,
  hashPassword,
  hashSessionToken,
  isPublicPath,
  newSessionToken,
  normalizeEmail,
  verifyPassword,
  whyCannotDisable,
} from "../auth";
import { isUniqueViolation } from "../session";

describe("hash de senha", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const hash = await hashPassword("uma senha de verdade");

    expect(await verifyPassword("uma senha de verdade", hash)).toBe(true);
    expect(await verifyPassword("uma senha de verdadE", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("nunca guarda a senha em claro, e o sal muda a cada gravação", async () => {
    const a = await hashPassword("senha repetida");
    const b = await hashPassword("senha repetida");

    expect(a).not.toContain("senha repetida");
    // Sal por usuário: duas contas com a mesma senha não têm o mesmo hash, que
    // é o que impede olhar a tabela e ver quem repetiu senha com quem.
    expect(a).not.toBe(b);
    expect(await verifyPassword("senha repetida", b)).toBe(true);
  });

  it("um hash ilegível é senha que não confere, e não uma exceção", async () => {
    for (const lixo of ["", "abc", "scrypt$x$8$1$c2Fs$a2V5", "bcrypt$2$3$4$5$6"]) {
      await expect(verifyPassword("qualquer", lixo)).resolves.toBe(false);
    }
  });

  it("os parâmetros de custo vêm do hash, não do código", async () => {
    const hash = await hashPassword("outra senha qualquer");
    const [algoritmo, N, r, p] = hash.split("$");

    expect(algoritmo).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16384);
    expect([Number(r), Number(p)]).toEqual([8, 1]);
  });
});

describe("token de sessão", () => {
  it("é aleatório e o que vai ao banco é o hash", () => {
    const token = newSessionToken();

    expect(token).not.toBe(newSessionToken());
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});

describe("normalização e recusas", () => {
  it("o mesmo e-mail escrito de duas formas é a mesma conta", () => {
    expect(normalizeEmail("  Guy@Empresa.COM ")).toBe("guy@empresa.com");
  });

  it("recusa o que não é endereço e aceita o que é", () => {
    expect(describeEmailProblem("guy@empresa.com")).toBeNull();
    expect(describeEmailProblem("guy")).toMatch(/endereço/i);
    expect(describeEmailProblem("")).toMatch(/Informe/);
    expect(describeEmailProblem(undefined)).toMatch(/Informe/);
  });

  it("senha curta é recusada com o motivo, não com um 'inválido'", () => {
    expect(describePasswordProblem("123456789")).toMatch(/10 caracteres/);
    expect(describePasswordProblem("1234567890")).toBeNull();
    expect(describePasswordProblem("x".repeat(201))).toMatch(/200/);
  });
});

describe("quem responde sem sessão", () => {
  it("é só a lista, e ela não cresce por acidente", () => {
    expect(isPublicPath("/healthz")).toBe(true);
    expect(isPublicPath("/auth/login")).toBe(true);
    expect(isPublicPath("/auth/session/")).toBe(true);

    // O que o produto faz fica atrás do login — inclusive ler.
    for (const rota of [
      "/imports",
      "/curation/summary",
      "/changes",
      "/overview",
      "/fleet-analysis/summary",
      "/auth",
      "/auth/session/extra",
    ]) {
      expect(isPublicPath(rota)).toBe(false);
    }
  });

  it("criar conta não é público — nem por /users, nem pelo antigo /auth/setup", () => {
    // O "primeiro acesso" existiu e foi removido: contas nascem em
    // Configurações, por quem já entrou. Se este caminho voltar a responder
    // sem sessão, qualquer pessoa com a URL se cadastra.
    expect(isPublicPath("/auth/setup")).toBe(false);
    expect(isPublicPath("/users")).toBe(false);
    expect(isPublicPath("/auth/password")).toBe(false);
  });
});

describe("e-mail repetido", () => {
  /**
   * O código do Postgres chega embrulhado: o Drizzle envolve o erro do driver
   * e põe o original em `cause`. Procurá-lo só no topo fazia a rota responder
   * 500 "não foi possível criar a conta" no caso mais comum que ela tem, em
   * vez de "já existe uma conta com esse e-mail".
   */
  it("é reconhecido mesmo embrulhado pelo Drizzle", () => {
    const doDriver = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    const doDrizzle = Object.assign(new Error("Failed query"), {
      cause: doDriver,
    });

    expect(isUniqueViolation(doDrizzle)).toBe(true);
    expect(isUniqueViolation(doDriver)).toBe(true);
  });

  it("não confunde outro erro de banco com e-mail repetido", () => {
    expect(isUniqueViolation(new Error("qualquer coisa"))).toBe(false);
    expect(
      isUniqueViolation(Object.assign(new Error("x"), { code: "23503" })),
    ).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("desativar conta", () => {
  const outra = { targetId: "b", actorId: "a", activeUsers: 3 };

  it("deixa desativar outra pessoa quando há mais contas ativas", () => {
    expect(whyCannotDisable(outra)).toBeNull();
  });

  it("recusa desativar a si mesmo", () => {
    expect(whyCannotDisable({ ...outra, targetId: "a" })).toMatch(
      /própria conta/i,
    );
  });

  it("recusa esvaziar o sistema, mesmo sendo outra pessoa", () => {
    // O desfecho que as duas recusas existem para impedir é o mesmo: um
    // sistema em que já não há como entrar, e cujo conserto é terminal.
    expect(whyCannotDisable({ ...outra, activeUsers: 1 })).toMatch(
      /última conta ativa/i,
    );
  });
});
