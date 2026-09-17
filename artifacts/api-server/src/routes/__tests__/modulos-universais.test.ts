import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * Os módulos universais, atravessados por HTTP.
 *
 * A camada nova é a da **casa**: o que ela desliga não aparece para ninguém.
 * Quatro coisas provam que isso é verdade, e não desenho:
 *
 * 1. **Vazio é tudo ligado.** A tabela nasce sem linha, e uma instalação recém
 *    migrada escreve como escrevia antes — a mesma propriedade que impede as
 *    outras duas camadas de virarem apagão no dia do deploy.
 * 2. **Desligar vence o papel e a exceção.** Não basta a linha existir: a soma
 *    que o portão e o menu leem tem de sair `SEM_ACESSO` mesmo para um
 *    administrador, e o portão tem de recusar a escrita daquele módulo.
 * 3. **Ligar de volta devolve exatamente o que havia**, e não `EDITAR` para
 *    todo mundo: a exceção da pessoa e o papel dela continuam valendo por baixo.
 * 4. **Configurações não se desliga** — é a porta trancada por dentro, e a
 *    recusa é 409 com a frase que explica por quê.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CONTAS: Record<string, SessionUser> = {};

async function criarConta(email: string, role: string): Promise<SessionUser> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO "app_user" ("name","email","password_hash","role","empresa_id")
     VALUES ($1,$1,'scrypt$x',$2,(SELECT "id" FROM "empresa" ORDER BY "criada_em" LIMIT 1)) RETURNING id`,
    [email, role],
  );
  const user = { id: rows[0].id, name: email, email, role };
  CONTAS[email] = user;
  return user;
}

const como = (email: string) => ({
  "x-teste-como": email,
  "Content-Type": "application/json",
});

beforeAll(async () => {
  ctx = await createTestDatabase("modulos_universais");
  process.env.DATABASE_URL = ctx.url;

  await criarConta("chefe@x.com", "ADMIN");
  await criarConta("op@x.com", "OPERADOR");

  const { default: usersRouter } = await import("../users");
  const { default: modulosRouter } = await import("../modulos-universais");
  const { portaoDePermissao } = await import(
    "../../middlewares/portao-de-permissao"
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    const quem = req.header("x-teste-como");
    if (quem && CONTAS[quem]) req.user = CONTAS[quem];
    next();
  });
  app.use(portaoDePermissao);
  app.use(modulosRouter);
  app.use(usersRouter);
  /* Uma escrita de Importações, só para o portão ter o que recusar. */
  app.post("/imports/qualquer", (_req, res) => {
    res.json({ passou: true });
  });

  servidor = app.listen(0);
  const endereco = servidor.address();
  base = `http://127.0.0.1:${typeof endereco === "object" && endereco ? endereco.port : 0}`;
}, 120_000);

afterAll(async () => {
  await new Promise((r) => servidor?.close(r));
  const { encerrarPoolDoProcesso } = await import("@workspace/db");
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

/** Liga ou desliga chaves como a tela faria. */
async function definir(
  quem: string,
  chaves: Record<string, boolean>,
  motivo?: string,
): Promise<Response> {
  return fetch(`${base}/modulos-universais`, {
    method: "PUT",
    headers: como(quem),
    body: JSON.stringify({ chaves, motivo }),
  });
}

/** Arquiva ou devolve à lista, como a gaveta da matriz faria. */
async function arquivar(
  quem: string,
  chaves: Record<string, boolean>,
): Promise<Response> {
  return fetch(`${base}/modulos-universais/arquivadas`, {
    method: "PUT",
    headers: como(quem),
    body: JSON.stringify({ chaves }),
  });
}

/** O que vale para uma conta — a soma que o portão e o menu leem. */
async function efetivas(id: string): Promise<Record<string, string>> {
  const res = await fetch(`${base}/users/${id}/permissoes`, {
    headers: como("chefe@x.com"),
  });
  return ((await res.json()) as { permissoes: Record<string, string> })
    .permissoes;
}

describe("a instalação nasce inteira no ar", () => {
  it("nenhuma chave desligada, e a escrita passa", async () => {
    const res = await fetch(`${base}/modulos-universais`, {
      headers: como("op@x.com"),
    });
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      desligadas: unknown[];
      protegidas: string[];
      historico: unknown[];
    };
    expect(corpo.desligadas).toEqual([]);
    expect(corpo.historico).toEqual([]);
    expect(corpo.protegidas).toContain("/configuracoes");

    const escrita = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("op@x.com"),
    });
    expect(escrita.status).toBe(200);
  });

  it("só administrador liga e desliga", async () => {
    const res = await definir("op@x.com", { "/importacoes": false });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /administradores/i,
    );
  });
});

describe("desligar vale para todo mundo, inclusive para quem administra", () => {
  it("some da soma de acesso e o portão recusa a escrita", async () => {
    const res = await definir(
      "chefe@x.com",
      { "/importacoes": false },
      "esta casa não importa planilha",
    );
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      desligadas: Array<{ chave: string; desligadoPor: string; motivo: string | null }>;
    };
    expect(corpo.desligadas).toEqual([
      expect.objectContaining({
        chave: "/importacoes",
        desligadoPor: "chefe@x.com",
        motivo: "esta casa não importa planilha",
      }),
    ]);

    /* O administrador que desligou também perde o módulo: é a casa, não uma
       decisão sobre gente. */
    expect((await efetivas(CONTAS["chefe@x.com"].id))["/importacoes"]).toBe(
      "SEM_ACESSO",
    );
    expect((await efetivas(CONTAS["op@x.com"].id))["/importacoes"]).toBe(
      "SEM_ACESSO",
    );

    const escrita = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("chefe@x.com"),
    });
    expect(escrita.status).toBe(403);
  });

  it("nenhuma exceção de conta devolve o módulo desligado", async () => {
    const res = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ niveis: { "/importacoes": "EDITAR" } }),
    });
    expect(res.status).toBe(200);
    expect((await efetivas(CONTAS["op@x.com"].id))["/importacoes"]).toBe(
      "SEM_ACESSO",
    );
  });

  it("ligar de volta devolve o que havia por baixo, e não edição para todos", async () => {
    /* Uma exceção que existia antes do desligamento tem de reaparecer. */
    expect(
      (
        await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
          method: "PUT",
          headers: como("chefe@x.com"),
          body: JSON.stringify({ niveis: { "/curadoria": "VISUALIZAR" } }),
        })
      ).status,
    ).toBe(200);
    expect((await definir("chefe@x.com", { "/curadoria": false })).status).toBe(200);
    expect((await efetivas(CONTAS["op@x.com"].id))["/curadoria"]).toBe(
      "SEM_ACESSO",
    );

    expect((await definir("chefe@x.com", { "/curadoria": true })).status).toBe(200);
    expect((await efetivas(CONTAS["op@x.com"].id))["/curadoria"]).toBe(
      "VISUALIZAR",
    );
    expect((await efetivas(CONTAS["chefe@x.com"].id))["/curadoria"]).toBe(
      undefined,
    );
  });

  it("o histórico guarda quem desligou, quem ligou e por quê", async () => {
    const res = await fetch(`${base}/modulos-universais`, {
      headers: como("op@x.com"),
    });
    const { historico } = (await res.json()) as {
      historico: Array<{ chave: string; ligado: boolean; por: string; motivo: string | null }>;
    };
    expect(historico).toContainEqual(
      expect.objectContaining({ chave: "/curadoria", ligado: true, por: "chefe@x.com" }),
    );
    expect(historico).toContainEqual(
      expect.objectContaining({
        chave: "/importacoes",
        ligado: false,
        motivo: "esta casa não importa planilha",
      }),
    );
  });
});

describe("os becos", () => {
  it("Configurações não se desliga — seria trancar a porta por dentro", async () => {
    const res = await definir("chefe@x.com", { "/configuracoes": false });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /não pode ser desligado/i,
    );
    expect((await efetivas(CONTAS["chefe@x.com"].id))["/configuracoes"]).toBe(
      undefined,
    );
  });

  it("estado que não é ligado nem desligado é 400", async () => {
    const res = await fetch(`${base}/modulos-universais`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ chaves: { "/qlp": "SEM_ACESSO" } }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * A seção como decisão da casa — o outro lado do que a lateral esconde.
 *
 * Esconder é conveniência; recusar é a garantia. Enquanto a seção era um atalho
 * para escrever N chaves de módulo, o portão continuava funcionando por
 * acidente: as chaves gravadas eram as dos módulos, e ele já sabia lê-las. Com
 * a seção virando decisão própria, o portão precisou aprender a pergunta nova —
 * senão desligar uma seção tiraria as telas do menu e continuaria aceitando a
 * escrita delas por chamada direta, que é uma decisão administrativa que vale
 * só enquanto ninguém tenta.
 */
describe("a seção desligada fecha o portão, e não só o menu", () => {
  /*
    Os describes acima compartilham o mesmo banco e deixam decisões de pé — é o
    desenho deste arquivo, e ele lê como uma história. Este bloco começa
    declarando a linha de base de que precisa, em vez de herdá-la: sem isto, ele
    passaria ou falharia conforme a ordem dos testes de cima.
  */
  beforeAll(async () => {
    await definir("chefe@x.com", {
      "/importacoes": true,
      "#dados-governanca": true,
    });
  });

  it("desligar a seção recusa a escrita dos módulos dela", async () => {
    /* Importações vive em Dados & governança; nada foi decidido sobre ela. */
    const antes = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("chefe@x.com"),
    });
    expect(antes.status).toBe(200);

    const res = await definir(
      "chefe@x.com",
      { "#dados-governanca": false },
      "esta casa não governa dado aqui",
    );
    expect(res.status).toBe(200);

    const depois = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("chefe@x.com"),
    });
    expect(depois.status).toBe(403);
  });

  it("nem exceção de conta nem papel devolvem o módulo de uma seção desligada", async () => {
    const res = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
      method: "PUT",
      headers: como("chefe@x.com"),
      body: JSON.stringify({ niveis: { "/importacoes": "EDITAR" } }),
    });
    expect(res.status).toBe(200);

    const escrita = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("op@x.com"),
    });
    expect(escrita.status).toBe(403);
  });

  it("ligar a seção de volta devolve a escrita — e o histórico guarda as duas decisões", async () => {
    const res = await definir("chefe@x.com", { "#dados-governanca": true });
    expect(res.status).toBe(200);

    const escrita = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("chefe@x.com"),
    });
    expect(escrita.status).toBe(200);

    const corpo = (await res.json()) as {
      historico: Array<{ chave: string; ligado: boolean; por: string }>;
    };
    const daSecao = corpo.historico.filter((h) => h.chave === "#dados-governanca");
    expect(daSecao.map((h) => h.ligado)).toEqual([true, false]);
    expect(daSecao.every((h) => h.por === "chefe@x.com")).toBe(true);
  });

  it("a seção da Administração não se desliga — é onde a tela mora", async () => {
    /*
      Proteger `/configuracoes` e deixar `#administracao` aberta seria proteger a
      fechadura e não a porta: a seção desligada esconde o módulo sem nunca
      tocar na chave dele.
    */
    const res = await definir("chefe@x.com", { "#administracao": false });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /não pode ser desligado/i,
    );
  });

  it("chave fora das três formas conhecidas é recusada na escrita", async () => {
    /*
      Uma chave sem `/`, `@` ou `#` não desliga nada — ninguém pergunta por ela
      — e ficaria no banco parecendo uma decisão que vale, com autor e carimbo.
    */
    const res = await definir("chefe@x.com", { "visao-executiva": false });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /não é uma chave conhecida/i,
    );
  });

  it("a seção é oferecida como protegida para a tela saber o que não pedir", async () => {
    const res = await fetch(`${base}/modulos-universais`, { headers: como("op@x.com") });
    const corpo = (await res.json()) as { protegidas: string[] };
    expect(corpo.protegidas).toContain("/configuracoes");
    expect(corpo.protegidas).toContain("#administracao");
  });
});

/**
 * Arquivar — a decisão sobre a **lista**, e não sobre o acesso.
 *
 * Desligar já tira do menu de todo mundo, e não tira da tela onde a decisão se
 * toma: uma casa que não usa dois terços do produto administra acesso dentro de
 * uma matriz em que quase tudo está riscado. Arquivar tira dali, e quatro
 * coisas provam que isso não é uma exclusão com outro nome:
 *
 * 1. **A linha continua inteira** — quem desligou, quando e por quê seguem na
 *    resposta, agora com quem arquivou e quando;
 * 2. **o acesso não muda** — quem estava fora do ar continua fora, nem mais nem
 *    menos, e o portão recusa a mesma escrita de antes;
 * 3. **só se arquiva o que está desligado** — pedir sobre uma chave no ar é 409,
 *    porque arrumar a lista não pode derrubar tela de ninguém por tabela;
 * 4. **desarquivar devolve à lista** sem religar nada.
 */
describe("arquivar tira da lista, e não do banco", () => {
  it("só administrador arquiva", async () => {
    expect((await definir("chefe@x.com", { "/fluxos": false })).status).toBe(200);
    const res = await arquivar("op@x.com", { "/fluxos": true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /administradores/i,
    );
  });

  it("não se arquiva o que está no ar — arrumar a lista não desliga ninguém", async () => {
    const res = await arquivar("chefe@x.com", { "/book-operador": true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /está no ar/i,
    );

    /* E nada foi escrito: a chave não entrou na lista do que a casa desligou. */
    const lista = await fetch(`${base}/modulos-universais`, {
      headers: como("chefe@x.com"),
    });
    const corpo = (await lista.json()) as { desligadas: Array<{ chave: string }> };
    expect(corpo.desligadas.map((d) => d.chave)).not.toContain("/book-operador");
  });

  it("arquivar guarda quem e quando, e não mexe no acesso", async () => {
    const antes = (await efetivas(CONTAS["op@x.com"].id))["/fluxos"];
    expect(antes).toBe("SEM_ACESSO");

    const res = await arquivar("chefe@x.com", { "/fluxos": true });
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      desligadas: Array<{
        chave: string;
        desligadoPor: string;
        arquivadoEm: string | null;
        arquivadoPor: string | null;
      }>;
      historico: Array<{ chave: string; ligado: boolean; arquivado: boolean | null }>;
    };

    const linha = corpo.desligadas.find((d) => d.chave === "/fluxos");
    expect(linha).toBeDefined();
    /* A decisão de quem desligou continua ali — arquivar não a substitui. */
    expect(linha!.desligadoPor).toBe("chefe@x.com");
    expect(linha!.arquivadoPor).toBe("chefe@x.com");
    expect(linha!.arquivadoEm).not.toBeNull();

    /* O evento diz que o gesto foi sobre a lista, e que a chave segue fora do ar. */
    expect(corpo.historico[0]).toMatchObject({
      chave: "/fluxos",
      ligado: false,
      arquivado: true,
    });

    expect((await efetivas(CONTAS["op@x.com"].id))["/fluxos"]).toBe("SEM_ACESSO");
  });

  it("arquivar de novo não escreve nada — o histórico é de decisões, não de cliques", async () => {
    const quantos = async () => {
      const res = await fetch(`${base}/modulos-universais`, {
        headers: como("chefe@x.com"),
      });
      const corpo = (await res.json()) as {
        historico: Array<{ chave: string; arquivado: boolean | null }>;
      };
      return corpo.historico.filter(
        (h) => h.chave === "/fluxos" && h.arquivado !== null,
      ).length;
    };

    const antes = await quantos();
    expect((await arquivar("chefe@x.com", { "/fluxos": true })).status).toBe(200);
    expect(await quantos()).toBe(antes);
  });

  it("desarquivar devolve à lista e não religa nada", async () => {
    const res = await arquivar("chefe@x.com", { "/fluxos": false });
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      desligadas: Array<{ chave: string; arquivadoEm: string | null }>;
      historico: Array<{ chave: string; ligado: boolean; arquivado: boolean | null }>;
    };

    const linha = corpo.desligadas.find((d) => d.chave === "/fluxos");
    expect(linha?.arquivadoEm).toBeNull();
    expect(corpo.historico[0]).toMatchObject({
      chave: "/fluxos",
      ligado: false,
      arquivado: false,
    });

    /* Continua fora do ar: quem devolve ao menu é o outro gesto. */
    expect((await efetivas(CONTAS["op@x.com"].id))["/fluxos"]).toBe("SEM_ACESSO");
  });

  it("ligar de volta desarquiva junto — a linha some inteira", async () => {
    expect((await arquivar("chefe@x.com", { "/fluxos": true })).status).toBe(200);
    expect((await definir("chefe@x.com", { "/fluxos": true })).status).toBe(200);

    const res = await fetch(`${base}/modulos-universais`, {
      headers: como("chefe@x.com"),
    });
    const corpo = (await res.json()) as {
      desligadas: Array<{ chave: string }>;
    };
    expect(corpo.desligadas.map((d) => d.chave)).not.toContain("/fluxos");

    /* E arquivar depois disso é recusado, porque a chave voltou ao ar. */
    expect((await arquivar("chefe@x.com", { "/fluxos": true })).status).toBe(409);
  });

  it("a seção inteira também se arquiva, e a chave é a dela", async () => {
    expect((await definir("chefe@x.com", { "#processos": false })).status).toBe(200);
    const res = await arquivar("chefe@x.com", { "#processos": true });
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      desligadas: Array<{ chave: string; arquivadoPor: string | null }>;
    };
    expect(
      corpo.desligadas.find((d) => d.chave === "#processos")?.arquivadoPor,
    ).toBe("chefe@x.com");
  });

  it("chave fora das três formas conhecidas é recusada aqui também", async () => {
    const res = await arquivar("chefe@x.com", { "visao-executiva": true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /não é uma chave conhecida/i,
    );
  });
});
