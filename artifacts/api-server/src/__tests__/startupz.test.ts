import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encerrarPoolDoProcesso } from "@workspace/db";
import {
  esquecerPartida,
  tentativaComecou,
  tentativaTerminou,
} from "../lib/partida";

/**
 * `/api/startupz` — o fato que decide a promoção, sem tocar banco, e
 * fail-closed sem prazo de validade.
 *
 * ---------------------------------------------------------------------------
 * Por que sem Postgres, de propósito
 * ---------------------------------------------------------------------------
 * A garantia central deste módulo é que ele **não** é uma segunda autoridade
 * sobre o banco: `estadoDaPromocao` não chama `observarBanco` nem
 * `diagnosticar`. A prova mais forte disso é rodar com uma `DATABASE_URL` que
 * não leva a lugar nenhum e mostrar que a rota responde do mesmo jeito — o
 * mesmo argumento de `banco-fora-do-ar.test.ts`.
 *
 * O que dirige a fase (`tentativaComecou`/`tentativaTerminou`) é chamado à mão
 * aqui, porque este arquivo monta `app` diretamente — como todo teste desta
 * pasta — e não importa `index.ts`, que tem efeito colateral no import (chama
 * `app.listen` incondicionalmente). Quem prova que o `index.ts` de verdade
 * invoca essas duas funções em volta de `applyMigrationsInBackground`, sempre
 * — inclusive nos retornos antecipados — é `ciclo-de-partida-fiacao.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * O cenário de migration com erro — as três perguntas, respondidas juntas
 * ---------------------------------------------------------------------------
 * Terminar com falha ainda é terminar, e por isso `/startupz` libera (200): o
 * processo sobe para ser diagnosticável, em vez de travar uma publicação para
 * sempre por causa de uma migration que o banco recusou. Isso só é seguro
 * porque promoção e admissão de tráfego são **portas diferentes**. As três
 * perguntas — o que `/startupz` diz, o que o portão diz, e se alguma rota de
 * negócio pode atravessar — são respondidas juntas em
 * `migration-com-erro-tres-perguntas.test.ts`, com um Postgres de verdade:
 * este arquivo não usa banco algum, e uma rota de negócio sem sessão dá 401
 * por falta de cookie antes de chegar perto do portão — não é o que a
 * pergunta 3 precisa medir.
 */
const NINGUEM_ATRAS = "postgresql://ninguem:nada@127.0.0.1:1/nao_existe";

let servidor: Server;
let base: string;

interface Resposta {
  status: number;
  body: any;
}

async function pedir(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json().catch(() => null) };
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

afterEach(() => {
  esquecerPartida();
  delete process.env.STARTUP_PROBE_MAX_WAIT_MS;
});

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await encerrarPoolDoProcesso().catch(() => {});
});

describe("respostas imediatas — /startupz não segura a conexão", () => {
  /*
    O relógio da requisição, não o do módulo: se a rota estivesse esperando a
    fila terminar (um `await` sobre uma promise pendente, um polling, um
    setTimeout), a resposta chegaria depois do tempo que a fila leva — que
    pode ser minutos. Aqui não há fila nenhuma rodando de verdade; o que se
    mede é que a rota nunca introduz latência própria, em nenhum dos dois
    códigos.
  */
  it("503, em voo: chega em poucos milissegundos, não quando algo terminar", async () => {
    tentativaComecou();
    const antes = Date.now();
    const r = await pedir("/api/startupz");
    const decorrido = Date.now() - antes;
    expect(r.status).toBe(503);
    expect(decorrido).toBeLessThan(200);
  });

  it("200, terminada: chega em poucos milissegundos", async () => {
    tentativaComecou();
    tentativaTerminou("Nenhuma migration pendente.");
    const antes = Date.now();
    const r = await pedir("/api/startupz");
    const decorrido = Date.now() - antes;
    expect(r.status).toBe(200);
    expect(decorrido).toBeLessThan(200);
  });

  it("mesmo com a tentativa em voo há muito tempo — além do teto — a resposta continua imediata", async () => {
    process.env.STARTUP_PROBE_MAX_WAIT_MS = "10";
    tentativaComecou(Date.now() - 60_000); // "em voo" há um minuto inteiro
    const antes = Date.now();
    const r = await pedir("/api/startupz");
    const decorrido = Date.now() - antes;
    expect(r.status).toBe(503);
    expect(decorrido).toBeLessThan(200);
  });
});

describe("o print de 24/08/2026, reproduzido pela fase da partida", () => {
  it("não iniciada: retém a promoção", async () => {
    const r = await pedir("/api/startupz");
    expect(r.status).toBe(503);
    expect(r.body.fase).toBe("NAO_INICIADA");
    expect(r.body.liberar).toBe(false);
  });

  it("em voo — a fila deste build está sendo aplicada agora: retém", async () => {
    tentativaComecou();
    const r = await pedir("/api/startupz");
    expect(r.status).toBe(503);
    expect(r.body.fase).toBe("EM_VOO");
  });

  it("terminada por convergência: libera", async () => {
    tentativaComecou();
    tentativaTerminou("Nenhuma migration pendente.");
    const r = await pedir("/api/startupz");
    expect(r.status).toBe(200);
    expect(r.body.liberar).toBe(true);
    expect(r.body.fase).toBe("TERMINADA");
  });
});

describe("migration demorada além do teto — continua fail-closed, sem prazo de validade", () => {
  it("em voo além do teto: 503 continua, e o corpo sinaliza a anomalia sem liberar", async () => {
    process.env.STARTUP_PROBE_MAX_WAIT_MS = "80";
    tentativaComecou();

    const antes = await pedir("/api/startupz");
    expect(antes.status).toBe(503);
    expect(antes.body.alemDoTeto).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 130));

    const depois = await pedir("/api/startupz");
    // A garantia central deste ponto: o teto NUNCA vira 200 sozinho.
    expect(depois.status).toBe(503);
    expect(depois.body.liberar).toBe(false);
    expect(depois.body.fase).toBe("EM_VOO");
    expect(depois.body.alemDoTeto).toBe(true);
    expect(depois.body.detail).toMatch(/teto informativo de 80 ms/);
    expect(depois.body.detail).toMatch(/nunca por tempo decorrido/);
  }, 10_000);

  it("continua 503 arbitrariamente além do teto — dez vezes o valor, ainda em voo", async () => {
    process.env.STARTUP_PROBE_MAX_WAIT_MS = "20";
    tentativaComecou(Date.now() - 200); // já "em voo" há 10x o teto configurado

    const r = await pedir("/api/startupz");
    expect(r.status).toBe(503);
    expect(r.body.alemDoTeto).toBe(true);
  });

  it("só termina liberando quando tentativaTerminou() for chamada — nunca antes, por mais que o tempo passe", async () => {
    process.env.STARTUP_PROBE_MAX_WAIT_MS = "50";
    tentativaComecou();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await pedir("/api/startupz")).status).toBe(503);

    tentativaTerminou("Nenhuma migration pendente.");
    expect((await pedir("/api/startupz")).status).toBe(200);
  }, 10_000);
});

describe("não é uma segunda autoridade sobre o banco", () => {
  it("responde sem tocar o banco — com uma DATABASE_URL inalcançável", async () => {
    tentativaComecou();
    tentativaTerminou("x");
    const r = await pedir("/api/startupz");
    // O corpo não carrega nada do vocabulário de `diagnosticar`.
    expect(r.body).not.toHaveProperty("diagnostico");
    expect(r.body).not.toHaveProperty("database");
  });
});

describe("depois de startupz=200, o portão já responde pelo estado real — sem intervalo de inicialização própria", () => {
  it("na mesma tick em que a promoção libera, o portão já está apto a responder (não trava, não erra)", async () => {
    tentativaComecou();
    tentativaTerminou("Nenhuma migration pendente.");

    // Duas chamadas em sequência imediata, sem esperar nada entre elas: se
    // houvesse uma janela em que o portão ainda estivesse "se preparando",
    // uma dessas duas chamadas cairia nela.
    const [startupz, readyz] = await Promise.all([
      pedir("/api/startupz"),
      pedir("/api/readyz"),
    ]);
    expect(startupz.status).toBe(200);
    // 503 aqui é a resposta *correta* do portão sobre um banco inalcançável —
    // não um erro de inicialização do próprio portão. A prova de que é a
    // resposta correta, e não um estado transitório, é que ela é estável:
    // chamar de novo dá o mesmo resultado, sem nunca oscilar para "ainda
    // carregando" ou 500.
    expect(readyz.status).toBe(503);
    expect(readyz.body.diagnostico).toBeDefined();
    const outraVez = await pedir("/api/readyz");
    expect(outraVez.status).toBe(503);
    expect(outraVez.body.diagnostico.estado).toBe(readyz.body.diagnostico.estado);
  });
});
