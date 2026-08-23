import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encerrarPoolDoProcesso } from "@workspace/db";

/**
 * O banco desligado, com o app de verdade — e as três frases que não podem se
 * confundir.
 *
 * ---------------------------------------------------------------------------
 * O que se está distinguindo, e por que importa
 * ---------------------------------------------------------------------------
 * Três coisas muito diferentes chegavam à tela de login como a mesma coisa:
 *
 *   1. **o servidor fora do ar** — a requisição não completa, e quem responde
 *      (se alguém responder) é uma camada antes da API. É o eixo do transporte,
 *      classificado no navegador, e tem prova em `lib/transporte.ts`.
 *   2. **o banco fora do ar** — o servidor está de pé, atende, e a consulta não
 *      chega ao banco. É este arquivo.
 *   3. **a senha errada** — tudo funcionando, e a credencial não confere.
 *
 * A 2 respondia "Não foi possível concluir o login", que quem lê entende como
 * 3; ou "O servidor falhou ao processar este pedido", que manda procurar
 * defeito onde não há. Nos dois casos a pessoa é mandada a fazer alguma coisa
 * com a própria senha por causa de um banco desligado.
 *
 * ---------------------------------------------------------------------------
 * Sem Postgres, de propósito
 * ---------------------------------------------------------------------------
 * A `DATABASE_URL` aponta para uma porta onde não há ninguém. É a reprodução
 * mais fiel possível do caso — `ECONNREFUSED` é exatamente o que o driver
 * levanta quando o banco caiu — e não depende de haver banco na máquina que
 * roda a suíte, o que faz deste um teste que sempre roda.
 */

/** Uma porta fechada: o driver responde `ECONNREFUSED` sem esperar ninguém. */
const NINGUEM_ATRAS = "postgresql://ninguem:nada@127.0.0.1:1/nao_existe";

let servidor: Server;
let base: string;

interface Resposta {
  status: number;
  body: any;
  retryAfter: string | null;
}

async function pedir(caminho: string, init?: RequestInit): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, init);
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    retryAfter: res.headers.get("retry-after"),
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = NINGUEM_ATRAS;
  process.env.DB_MIGRATE_ON_BOOT = "0";

  const { default: app } = await import("../app");
  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await encerrarPoolDoProcesso().catch(() => {});
});

describe("o banco fora do ar", () => {
  it("o liveness continua verde — ele não fala do banco, e é a razão de existir", async () => {
    const health = await pedir("/api/healthz");

    /*
      Se esta rota falhasse junto com o banco, o deployment nunca ficaria de pé
      — o startup probe aponta para cá — e o roteador voltaria a responder 502
      sem corpo, que é o estado que estas rotas existem para tornar legível.
    */
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(typeof health.body.uptimeSeconds).toBe("number");
    /* E não fala do banco: nem para dizer que ele está fora. */
    expect(health.body.database).toBeUndefined();
  });

  it("a prontidão fica vermelha, e diz por quê", async () => {
    /*
      **A regressão que a separação entre prontidão e portão corrige.** Este
      caso respondia `ready: true`: o portão não fecha com o banco fora (e não
      deve fechar — ver `lib/prontidao.ts`), e prontidão era o mesmo campo. A
      tela consultava a prontidão para explicar por que a chamada dela falhou e
      recebia "está tudo pronto".
    */
    const ready = await pedir("/api/readyz");

    expect(ready.status).toBe(503);
    expect(ready.body.ready).toBe(false);
    expect(ready.body.diagnostico.estado).toBe("INDISPONIVEL");
    expect(ready.retryAfter).toBe("5");
  });

  it("o login não diz nada sobre a senha — 503 com o diagnóstico do ambiente", async () => {
    const { status, body, retryAfter } = await pedir("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "guy@freightcheck",
        password: "a-senha-certa",
      }),
    });

    expect(status).toBe(503);
    /* Nem a frase de credencial… */
    expect(status).not.toBe(401);
    expect(JSON.stringify(body)).not.toMatch(/senha incorret|credenc/i);
    /* …nem a de defeito nosso. */
    expect(status).not.toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/servidor falhou ao processar/i);

    expect(body.code).toBe("BANCO_INDISPONIVEL");
    expect(body.diagnostico.estado).toBe("INDISPONIVEL");
    expect(body.diagnostico.acao.quem).toBe("plataforma");
    expect(retryAfter).toBe("5");
    /* E a chamada que parou é nomeada: "o que eu tentei fazer aconteceu?" */
    expect(body.contexto).toContain("POST /api/auth/login");
    expect(body.contexto).toMatch(/nada foi gravado/i);
  });

  it("a frase principal é para quem está na tela, sem endpoint nem comando", async () => {
    /*
      A regra do campo `humano` (ver `@workspace/db/diagnostico`), verificada
      onde ela importa: no corpo que a tela de login vai desenhar. O nome da
      migration, o comando e o SQLSTATE continuam existindo — em `resumo`,
      `acao.comando` e `evidencia` —, e a interface os guarda atrás de
      "Detalhes técnicos".
    */
    const { body } = await pedir("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "guy@freightcheck", password: "x" }),
    });

    const humano: string = body.diagnostico.humano;
    expect(humano).not.toMatch(/healthz|readyz|\/api\//);
    expect(humano).not.toMatch(/migration|pnpm|SQLSTATE|DATABASE_URL/i);
    expect(humano).toMatch(/banco de dados/i);
    /* A pergunta que quem acabou de clicar faz primeiro. */
    expect(humano).toMatch(/nada.*gravado|nada se perdeu/i);
  });

  it("a sessão também: 503 com diagnóstico, e não 500 nem 401", async () => {
    /*
      `GET /auth/session` é o primeiro pedido que a interface faz. Ele
      respondia 503 com "Confira /api/healthz" — o produto entregando um
      endpoint técnico a quem só queria entrar — e agora responde o mesmo
      diagnóstico de todo o resto.

      O cookie precisa existir: sem token não há o que resolver, e a resposta
      correta continua sendo `{ user: null }` sem tocar no banco.
    */
    const { status, body } = await pedir("/api/auth/session", {
      headers: { Cookie: "freightcheck_session=um-token-qualquer" },
    });

    expect(status).toBe(503);
    expect(status).not.toBe(401);
    expect(body.code).toBe("BANCO_INDISPONIVEL");
    expect(body.diagnostico.estado).toBe("INDISPONIVEL");
    expect(JSON.stringify(body)).not.toMatch(/healthz|readyz/);
  });

  it("sem cookie, a sessão responde que não há ninguém logado — sem tocar no banco", async () => {
    const { status, body } = await pedir("/api/auth/session");

    expect(status).toBe(200);
    expect(body.user).toBeNull();
  });

  it("uma rota de produto, com cookie, recebe o mesmo diagnóstico", async () => {
    /*
      A classificação é do contrato de erro, e não de cada rota: o que vale
      para o login vale para toda chamada que morrer sem chegar ao banco. É o
      que impede a próxima rota escrita de inventar a própria frase.

      O cookie é necessário e é o ponto: sem ele a resposta é 401 antes de
      qualquer consulta — ninguém está logado, e isso se sabe sem banco. Com
      ele, resolver a sessão é a primeira coisa que precisa do banco, e é aí
      que a distinção importa: **quem já está logado não pode ser mandado para
      a tela de login porque o banco caiu.**
    */
    const { status, body } = await pedir("/api/imports", {
      headers: { Cookie: "freightcheck_session=um-token-qualquer" },
    });

    expect(status).toBe(503);
    expect(status).not.toBe(401);
    expect(body.code).toBe("BANCO_INDISPONIVEL");
    expect(body.diagnostico.estado).toBe("INDISPONIVEL");
  });

  it("sem cookie, continua sendo 401 — e isso se sabe sem banco nenhum", async () => {
    const { status, body } = await pedir("/api/imports");

    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });
});
