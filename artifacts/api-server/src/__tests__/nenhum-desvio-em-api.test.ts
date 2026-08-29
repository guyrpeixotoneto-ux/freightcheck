import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encerrarPoolDoProcesso } from "@workspace/db";

/**
 * `/api/*` nunca redireciona — a propriedade em que a interface inteira se
 * apoia, provada aqui em vez de prometida nos comentários.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo existe para impedir
 * ---------------------------------------------------------------------------
 * A tela de erro que motivou este trabalho diz, em bom português, que a chamada
 * da Visão Geral foi **desviada para outra origem antes de chegar à API**. Essa
 * frase só é um diagnóstico — e não um chute — porque uma afirmação a sustenta:
 * *esta API não redireciona em rota nenhuma*. Se ela redirecionasse em alguma,
 * a tela estaria acusando a plataforma por um comportamento nosso, e quem
 * investigasse iria procurar proxy onde havia código.
 *
 * A afirmação vivia em três comentários (`lib/transporte.ts`, `lib/api.ts`,
 * `middlewares/contrato-json.ts`) e em nenhum teste. Comentário não segura
 * propriedade: bastava alguém escrever um `res.redirect("/login")` numa rota
 * nova — o reflexo de quem vem de aplicação com sessão — para a frase virar
 * mentira, e para a tela passar a culpar a infraestrutura por uma linha nossa.
 *
 * ---------------------------------------------------------------------------
 * Duas réguas, e as duas são necessárias
 * ---------------------------------------------------------------------------
 * 1. **Sobre o servidor de verdade**: as chamadas que montam a Visão Geral,
 *    feitas contra o app real, sem sessão e com o banco fora — o pior caso, e
 *    o único em que um servidor "normal" mandaria alguém para a tela de login.
 *    Nenhuma pode responder 3xx, nenhuma pode mandar `Location`, todas
 *    respondem JSON, e todas trazem o carimbo que identifica quem respondeu.
 * 2. **Sobre o texto-fonte**: nenhum arquivo do servidor chama `res.redirect`
 *    nem escreve `Location`. É a régua que pega a rota que ainda não existe —
 *    a que será escrita na semana que vem, e que o teste de comportamento
 *    acima não conhece.
 *
 * O banco fora do ar é de propósito: ele é o estado em que mais se erra. Sem
 * banco não há sessão a validar, e um servidor que traduzisse "não consegui
 * verificar a sessão" em "vá para o login" produziria exatamente o 3xx que
 * este arquivo proíbe.
 */

const NINGUEM_ATRAS = "postgresql://ninguem:nada@127.0.0.1:1/nao_existe";

/**
 * As chamadas que a Visão Geral dispara, rastreadas do componente até a rota.
 *
 * `pages/inicio.tsx` monta a tela; `lib/families-overview.ts` pede
 * `/changes/families/overview`, e as outras saem do mesmo componente e da
 * casca que o envolve (`components/layout`). O prefixo `/api` é o que o
 * roteador da plataforma encaminha para este processo, e é o que `getApiUrl`
 * monta — sempre relativo, sempre na mesma origem.
 */
const CHAMADAS_DA_VISAO_GERAL = [
  "/api/healthz",
  "/api/readyz",
  "/api/build",
  "/api/contexts",
  "/api/changes/families/overview?period=2026-08&operacao=rota",
  "/api/changes/families",
  "/api/balance",
  "/api/imports",
  // Um caminho que não existe: o 404 do contrato também não pode desviar.
  "/api/rota-que-nao-existe",
];

let servidor: Server;
let base: string;

beforeAll(async () => {
  process.env.DATABASE_URL = NINGUEM_ATRAS;
  process.env.DB_MIGRATE_ON_BOOT = "0";
  delete process.env.API_ORIGENS_PERMITIDAS;

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

describe("nenhuma chamada de /api é desviada", () => {
  it.each(CHAMADAS_DA_VISAO_GERAL)(
    "%s responde JSON, sem redirect e com o carimbo da API",
    async (caminho) => {
      const res = await fetch(`${base}${caminho}`, {
        redirect: "manual",
        headers: { Origin: base, Accept: "application/json" },
      });

      /*
        A asserção central. Um 3xx aqui é a tela de DESVIADA acusando a
        plataforma por algo que saiu daqui.
      */
      const ehRedirect = res.status >= 300 && res.status < 400;
      expect(ehRedirect, `${caminho} respondeu ${res.status}`).toBe(false);
      expect(res.headers.get("location")).toBeNull();

      // Toda resposta desta API é JSON, mesmo quando é erro.
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      await expect(res.json()).resolves.toBeTypeOf("object");

      /*
        E toda resposta se identifica: é o carimbo que permite ao navegador
        dizer "chegou ao Express" sem inferir nada do formato do corpo.
      */
      expect(res.headers.get("x-freightcheck-api")).toBe("1");
      expect(res.headers.get("x-request-id")).toBeTruthy();
    },
  );

  it("sem sessão a resposta é 401 em JSON — e não um desvio para o login", async () => {
    const res = await fetch(`${base}/api/contexts`, { redirect: "manual" });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
    // O identificador que costura esta tela à linha de log deste processo.
    expect(body.requestId).toBeDefined();
    expect(res.headers.get("location")).toBeNull();
  });

  it("o CORS não é curinga — a arquitetura é de mesma origem", async () => {
    const res = await fetch(`${base}/api/healthz`, {
      headers: { Origin: "https://outra-origem.example" },
    });

    /*
      `cors()` sem argumento respondia `*` em toda rota. Não era permissão que
      alguém usasse — o cliente deste produto é sempre da mesma origem — e era
      inútil onde pareceria útil: com `*` o navegador recusa requisição com
      credencial, e toda chamada daqui leva cookie de sessão.
    */
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("uma origem declarada em API_ORIGENS_PERMITIDAS é atendida com credencial", async () => {
    /*
      A lista existe para o cliente cross-origin que ainda não existe. O teste a
      exercita num app próprio para não vazar configuração para os demais: o
      importante é que a permissão seja **nominal**, e que ela venha com
      `credentials`, sem o que a lista prometeria um acesso que a sessão por
      cookie não conseguiria usar.
    */
    process.env.API_ORIGENS_PERMITIDAS = "https://parceiro.example";
    const { corsDaArquitetura } =
      await import("../middlewares/cors-da-arquitetura");
    const express = (await import("express")).default;
    const outro = express();
    outro.use(corsDaArquitetura());
    outro.get("/api/healthz", (_req, res) => {
      res.json({ status: "ok" });
    });
    const s = await new Promise<Server>((resolve) => {
      const servidorLocal = outro.listen(0, "127.0.0.1", () =>
        resolve(servidorLocal),
      );
    });
    const porta = (s.address() as AddressInfo).port;

    try {
      const permitida = await fetch(`http://127.0.0.1:${porta}/api/healthz`, {
        headers: { Origin: "https://parceiro.example" },
      });
      expect(permitida.headers.get("access-control-allow-origin")).toBe(
        "https://parceiro.example",
      );
      expect(permitida.headers.get("access-control-allow-credentials")).toBe(
        "true",
      );

      const recusada = await fetch(`http://127.0.0.1:${porta}/api/healthz`, {
        headers: { Origin: "https://estranho.example" },
      });
      expect(recusada.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      delete process.env.API_ORIGENS_PERMITIDAS;
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FONTE = path.join(AQUI, "..");

function arquivosTypeScript(diretorio: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(diretorio)) {
    const completo = path.join(diretorio, nome);
    if (statSync(completo).isDirectory()) {
      if (nome === "__tests__") continue;
      achados.push(...arquivosTypeScript(completo));
    } else if (nome.endsWith(".ts")) {
      achados.push(completo);
    }
  }
  return achados;
}

describe("o texto-fonte do servidor não emite redirect", () => {
  it("nenhum arquivo chama res.redirect nem escreve Location", () => {
    const culpados: string[] = [];
    for (const arquivo of arquivosTypeScript(FONTE)) {
      const texto = readFileSync(arquivo, "utf8");
      /*
        `res.redirect(` e `res.location(` são as duas portas do Express para
        um 3xx; `Location` escrito à mão é a terceira, por `setHeader` ou por
        `writeHead`. As três são procuradas fora de comentário — um comentário
        que **cita** o assunto (e este repositório os tem aos montes) não pode
        derrubar a suíte.
      */
      const semComentarios = texto
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (
        /\bres\s*\.\s*(redirect|location)\s*\(/.test(semComentarios) ||
        /["'`]Location["'`]\s*[,:]/i.test(semComentarios)
      ) {
        culpados.push(path.relative(FONTE, arquivo));
      }
    }

    expect(
      culpados,
      `Estes arquivos redirecionam, e a interface conta com o contrário: ${culpados.join(", ")}`,
    ).toEqual([]);
  });
});
