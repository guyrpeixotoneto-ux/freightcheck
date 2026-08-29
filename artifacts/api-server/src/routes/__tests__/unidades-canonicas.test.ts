import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { encerrarPoolDoProcesso } from "@workspace/db";
import { erroEmJson } from "../../middlewares/contrato-json";

/**
 * `PUT /unidades/canonicas/:id` — corrigir um cadastro já feito.
 *
 * O `POST` cria identidade; esta rota corrige a afirmação de uma identidade
 * que já existe, com as mesmas recusas — nome vazio, CNPJ inválido, CNPJ de
 * outra unidade — e um `id` desconhecido vira `404`, não `400`: o corpo pode
 * estar perfeito e ainda assim não haver o que editar.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

interface Resposta {
  status: number;
  body: any;
}

async function cadastrar(corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}/unidades/canonicas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

async function editar(id: string, corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}/unidades/canonicas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

const CNPJ_A = "11.222.333/0001-81";
const CNPJ_B = "22.333.444/0001-81";

beforeAll(async () => {
  ctx = await createTestDatabase("api_unidades_canonicas");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: unidadesRouter } = await import("../unidades");

  const app = express();
  app.use(express.json());
  app.use(unidadesRouter);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 300_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await ctx?.drop().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});
}, 60_000);

beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE unidade CASCADE`);
});

describe("editar uma unidade cadastrada", () => {
  it("corrige o nome, mantendo o mesmo id", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", cnpj: CNPJ_A });
    expect(criada.status).toBe(201);

    const editada = await editar(criada.body.id, { nome: "CDD BELÉM", cnpj: CNPJ_A });

    expect(editada.status).toBe(200);
    expect(editada.body.id).toBe(criada.body.id);
    expect(editada.body.nome).toBe("CDD BELÉM");
    expect(editada.body.cnpj).toBe(criada.body.cnpj);
  });

  it("corrige o CNPJ de um dígito trocado", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", cnpj: CNPJ_A });

    const editada = await editar(criada.body.id, { nome: "CDD BELEM", cnpj: CNPJ_B });

    expect(editada.status).toBe(200);
    expect(editada.body.cnpj).not.toBe(criada.body.cnpj);
  });

  it("reenviar o próprio CNPJ não é conflito consigo mesma", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", cnpj: CNPJ_A });

    const editada = await editar(criada.body.id, { nome: "CDD BELEM NOVO", cnpj: CNPJ_A });

    expect(editada.status).toBe(200);
    expect(editada.body.nome).toBe("CDD BELEM NOVO");
  });

  it("recusa o CNPJ de outra unidade já cadastrada", async () => {
    const a = await cadastrar({ nome: "CDD BELEM", cnpj: CNPJ_A });
    await cadastrar({ nome: "CDD OUTRO", cnpj: CNPJ_B });

    const editada = await editar(a.body.id, { nome: "CDD BELEM", cnpj: CNPJ_B });

    expect(editada.status).toBe(409);
    expect(editada.body.codigo).toBe("CNPJ_JA_CADASTRADO");
  });

  it("recusa nome vazio", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", cnpj: CNPJ_A });

    const editada = await editar(criada.body.id, { nome: "  ", cnpj: CNPJ_A });

    expect(editada.status).toBe(400);
    expect(editada.body.codigo).toBe("UNIDADE_SEM_NOME");
  });

  it("recusa CNPJ inválido", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", cnpj: CNPJ_A });

    const editada = await editar(criada.body.id, { nome: "CDD BELEM", cnpj: "123" });

    expect(editada.status).toBe(400);
    expect(editada.body.codigo).toBe("CNPJ_TAMANHO");
  });

  it("um id desconhecido não é encontrado — o corpo pode estar certo mesmo assim", async () => {
    const editada = await editar("00000000-0000-0000-0000-000000000000", {
      nome: "CDD BELEM",
      cnpj: CNPJ_A,
    });

    expect(editada.status).toBe(404);
    expect(editada.body.codigo).toBe("UNIDADE_NAO_ENCONTRADA");
  });
});

/**
 * O CADASTRO POR CÓDIGO GERENCIAL — a unidade que o CNPJ obrigatório barrava.
 *
 * A regra que continua valendo é "uma unidade, uma identidade": os dois campos
 * são únicos e ao menos um tem de vir. O que deixou de valer é que a
 * identidade tenha de ser sempre um documento — e é isto que estes casos
 * separam do resto, porque a recusa antiga (`CNPJ_VAZIO`) mandava procurar um
 * CNPJ que, para estas unidades, não existe.
 */
describe("cadastrar pela outra identidade", () => {
  it("cadastra com código gerencial e sem CNPJ", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", codigoGerencial: "081-0443" });

    expect(criada.status).toBe(201);
    expect(criada.body.cnpj).toBeNull();
    expect(criada.body.codigoGerencial).toBe("081-0443");
  });

  it("guarda o código normalizado — o espaço e a caixa não criam duas unidades", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", codigoGerencial: "  cdd-belem " });
    expect(criada.body.codigoGerencial).toBe("CDD-BELEM");

    const outra = await cadastrar({ nome: "OUTRO", codigoGerencial: "cdd-belem" });
    expect(outra.status).toBe(409);
    expect(outra.body.codigo).toBe("CODIGO_GERENCIAL_JA_CADASTRADO");
  });

  it("aceita os dois juntos — é o melhor caso, não um conflito", async () => {
    const criada = await cadastrar({
      nome: "CDD BELEM",
      cnpj: CNPJ_A,
      codigoGerencial: "443",
    });

    expect(criada.status).toBe(201);
    expect(criada.body.cnpj).toBe("11222333000181");
    expect(criada.body.codigoGerencial).toBe("443");
  });

  it("recusa o cadastro sem identidade nenhuma, e não por falta de CNPJ", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM" });

    expect(criada.status).toBe(400);
    expect(criada.body.codigo).toBe("UNIDADE_SEM_IDENTIDADE");
  });

  it("recusa um CNPJ digitado no campo do código — ele tem campo próprio", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", codigoGerencial: CNPJ_A });

    expect(criada.status).toBe(400);
    expect(criada.body.codigo).toBe("CODIGO_GERENCIAL_E_CNPJ");
  });

  it("o nome continua obrigatório — identidade não substitui descrição", async () => {
    const criada = await cadastrar({ nome: "  ", codigoGerencial: "443" });

    expect(criada.status).toBe(400);
    expect(criada.body.codigo).toBe("UNIDADE_SEM_NOME");
  });

  it("editar acrescenta o CNPJ descoberto depois, sem trocar o id", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", codigoGerencial: "443" });

    const editada = await editar(criada.body.id, {
      nome: "CDD BELEM",
      cnpj: CNPJ_A,
      codigoGerencial: "443",
    });

    expect(editada.status).toBe(200);
    expect(editada.body.id).toBe(criada.body.id);
    expect(editada.body.cnpj).toBe("11222333000181");
  });

  it("editar não deixa a unidade ficar sem identidade nenhuma", async () => {
    const criada = await cadastrar({ nome: "CDD BELEM", codigoGerencial: "443" });

    const editada = await editar(criada.body.id, { nome: "CDD BELEM" });

    expect(editada.status).toBe(400);
    expect(editada.body.codigo).toBe("UNIDADE_SEM_IDENTIDADE");
  });

  it("a unidade sem CNPJ aparece na lista, cadastrada e sem importação", async () => {
    await cadastrar({ nome: "CDD BELEM", codigoGerencial: "081-0443" });

    const res = await fetch(`${base}/unidades/canonicas`);
    const linhas = (await res.json()) as any[];

    /*
      Procurada pelo código, e não pela posição: a lista também traz o que o
      acervo do banco de teste detectou, e `TRUNCATE unidade` não apaga acervo.
    */
    const nossa = linhas.find((l) => l.codigoGerencial === "081-0443");
    expect(nossa).toBeDefined();
    expect(nossa.cnpj).toBeNull();
    expect(nossa.cnpjFormatado).toBe("");
    expect(nossa.estado).toBe("CADASTRADA");
  });
});
