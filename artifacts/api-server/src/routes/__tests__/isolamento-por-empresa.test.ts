import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * ISOLAMENTO ENTRE EMPRESAS — os testes negativos, escritos antes do corte.
 *
 * ---------------------------------------------------------------------------
 * O que estes casos provam, e o que eles deliberadamente ainda não provam
 * ---------------------------------------------------------------------------
 *
 * Eles provam que **o cálculo do escopo está certo**: que a conta da empresa A
 * jamais recebe uma unidade, um `scope_hash` ou um veredito favorável sobre
 * nada da empresa B — por parâmetro forjado, por parâmetro omitido, por
 * combinação manipulada, ou por qualquer caminho que o cliente escolha. É a
 * camada em que a garantia tem de morar, porque é a única que não depende de
 * cada rota lembrar de aplicá-la.
 *
 * O que eles **não** provam é que as rotas recusam, porque nesta fase elas não
 * recusam: o corte está em modo de observação por decisão, e ligá-lo em ~40
 * rotas de leitura sem medir é a forma conhecida de este produto quebrar (ver
 * `middlewares/escopo-em-observacao.ts`). O que o modo de observação promete —
 * e o que estes casos verificam — é que o **veredito** já é o certo. Quando o
 * corte ligar, o que muda é o que se faz com o veredito, não qual ele é.
 *
 * Por isso há, no fim, um caso que mede exatamente essa fronteira: hoje a
 * leitura ainda passa, e o teste diz isso em voz alta em vez de fingir uma
 * garantia que a fase não tem. É ele que vai mudar de sinal no dia do corte.
 *
 * ---------------------------------------------------------------------------
 * Por que duas empresas de verdade, e não uma simulada
 * ---------------------------------------------------------------------------
 *
 * O banco deste teste tem duas empresas, duas unidades, dois `scope_hash` e
 * duas contas — cada coisa realmente pendurada na sua. Um teste que simulasse
 * o segundo tenant trocando um id na chamada mediria a aritmética do próprio
 * teste; aqui o vínculo passa pelas mesmas tabelas e pelas mesmas chaves
 * estrangeiras que a produção usa, e é isso que faz a prova valer.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CONTAS: Record<string, SessionUser> = {};
let empresaA = "";
let empresaB = "";
let unidadeA = "";
let unidadeB = "";
const HASH_A = "hash-da-empresa-a";
const HASH_B = "hash-da-empresa-b";

let escopoEfetivo: typeof import("../../lib/escopo-efetivo").escopoEfetivo;
let vereditoDoHash: typeof import("../../lib/escopo-efetivo").vereditoDoHash;
let estreitar: typeof import("../../lib/escopo-efetivo").estreitar;

beforeAll(async () => {
  ctx = await createTestDatabase("isolamento_por_empresa");
  process.env.DATABASE_URL = ctx.url;

  const { db, empresaPrincipal } = await import("@workspace/db");
  const { empresaTable, unidadeTable, appUserTable, remuneracaoUnidadeTable, acessoAUnidadeTable } =
    await import("@workspace/db");
  ({ escopoEfetivo, vereditoDoHash, estreitar } = await import("../../lib/escopo-efetivo"));

  /* A empresa que a `0101` criou é a A; a B nasce aqui, ao lado dela. */
  empresaA = (await empresaPrincipal(db)).id;
  const [b] = await db.insert(empresaTable).values({ nome: "Transportadora B" }).returning();
  empresaB = b!.id;

  const [uA] = await db
    .insert(unidadeTable)
    .values({ empresaId: empresaA, nome: "CDD A", codigoGerencial: "A-001" })
    .returning();
  const [uB] = await db
    .insert(unidadeTable)
    .values({ empresaId: empresaB, nome: "CDD B", codigoGerencial: "B-001" })
    .returning();
  unidadeA = uA!.id;
  unidadeB = uB!.id;

  /*
    A ponte `scope_hash` → unidade, que é por onde o acervo se liga ao tenant.
    Ela já existia e é curada por gente; o que muda com a `0101` é que agora ela
    tem um dono do outro lado.
  */
  await db.insert(remuneracaoUnidadeTable).values([
    {
      scopeHash: HASH_A,
      unidadeId: unidadeA,
      codigo: "A-001",
      nome: "CDD A",
      canal: "EMPURRADA",
      vigenciaInicial: "2026-08-01",
    },
    {
      scopeHash: HASH_B,
      unidadeId: unidadeB,
      codigo: "B-001",
      nome: "CDD B",
      canal: "EMPURRADA",
      vigenciaInicial: "2026-08-01",
    },
  ]);

  const criar = async (email: string, empresaId: string) => {
    const [linha] = await db
      .insert(appUserTable)
      .values({ empresaId, name: email, email, passwordHash: "scrypt$x", role: "OPERADOR" })
      .returning();
    CONTAS[email] = {
      id: linha!.id,
      name: email,
      email,
      role: "OPERADOR",
    } as SessionUser;
  };
  await criar("ana@empresa-a.com", empresaA);
  await criar("bruno@empresa-b.com", empresaB);
  await criar("carla@empresa-a.com", empresaA);

  /* Carla tem concessão explícita — e só à unidade da própria empresa. */
  await db.insert(acessoAUnidadeTable).values({
    userId: CONTAS["carla@empresa-a.com"]!.id,
    unidadeId: unidadeA,
    nivel: "VER",
    concedidoPor: "teste",
  });

  const { escopoEmObservacao } = await import("../../middlewares/escopo-em-observacao");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { error: () => {}, warn: () => {}, info: () => {} };
    const quem = req.header("x-teste-como");
    if (quem && CONTAS[quem]) req.user = CONTAS[quem];
    next();
  });
  app.use(escopoEmObservacao);
  /* Uma leitura qualquer, só para o middleware ter o que observar. */
  app.get("/changes", (req, res) => {
    res.json({ escopo: req.escopo ?? null });
  });

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === "string") throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 180_000);

afterAll(async () => {
  await new Promise((r) => servidor?.close(r));
  const { encerrarPoolDoProcesso } = await import("@workspace/db");
  await encerrarPoolDoProcesso();
  await ctx?.drop();
}, 60_000);

// ── O cálculo do escopo ─────────────────────────────────────────────────────

describe("o escopo sai da sessão, e a empresa é a fronteira", () => {
  it("a conta da empresa A alcança só a unidade de A", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    expect(escopo.empresaId).toBe(empresaA);
    expect(escopo.unidadesPermitidas).toEqual([unidadeA]);
    expect(escopo.unidadesPermitidas).not.toContain(unidadeB);
  });

  it("a conta da empresa B alcança só a unidade de B", async () => {
    const escopo = await escopoEfetivo(CONTAS["bruno@empresa-b.com"]!.id);
    expect(escopo.empresaId).toBe(empresaB);
    expect(escopo.unidadesPermitidas).toEqual([unidadeB]);
  });

  it("o fallback concede dentro da empresa — e só dentro dela", async () => {
    const ana = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    /*
      Ana não tem nenhuma linha em `acesso_a_unidade`: ela alcança a empresa
      dela inteira, que é a regra de compatibilidade. O que o fallback **não**
      faz é virar "todas as unidades" — é a diferença entre as duas frases que
      este caso existe para travar.
    */
    expect(ana.porFallback).toBe(true);
    expect(ana.unidadesPermitidas).not.toContain(unidadeB);
  });

  it("a concessão explícita não amplia para fora da empresa", async () => {
    const carla = await escopoEfetivo(CONTAS["carla@empresa-a.com"]!.id);
    expect(carla.porFallback).toBe(false);
    expect(carla.unidadesPermitidas).toEqual([unidadeA]);
  });
});

// ── A manipulação de scopeHash ──────────────────────────────────────────────

describe("o scopeHash do cliente estreita, e nunca amplia", () => {
  it("o hash da própria empresa é DENTRO", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    expect(vereditoDoHash(escopo, HASH_A)).toBe("DENTRO");
  });

  it("o hash da outra empresa é FORA — é o caso que o desenho existe para pegar", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    expect(vereditoDoHash(escopo, HASH_B)).toBe("FORA");
    expect(escopo.scopeHashesPermitidos).not.toContain(HASH_B);
  });

  it("pedir o hash da outra empresa devolve conjunto vazio, não o hash pedido", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    /*
      É aqui que "estreitar, nunca ampliar" vira uma linha executável: a
      interseção com um hash de fora é vazia. Uma implementação que devolvesse
      o pedido passaria em todos os outros casos e falharia só neste.
    */
    expect(estreitar(escopo, { scopeHash: HASH_B })).toEqual([]);
    expect(estreitar(escopo, { scopeHash: HASH_A })).toEqual([HASH_A]);
  });

  it("omitir o scopeHash não abre a outra empresa", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    const semPedido = estreitar(escopo, {});
    expect(semPedido).toEqual([HASH_A]);
    expect(semPedido).not.toContain(HASH_B);
  });

  it("um hash inventado não é DENTRO nem por acaso", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    expect(vereditoDoHash(escopo, "hash-que-nao-existe")).toBe("FORA");
    expect(estreitar(escopo, { scopeHash: "hash-que-nao-existe" })).toEqual([]);
  });

  it("o inverso vale igual: B não alcança A", async () => {
    const escopo = await escopoEfetivo(CONTAS["bruno@empresa-b.com"]!.id);
    expect(vereditoDoHash(escopo, HASH_A)).toBe("FORA");
    expect(estreitar(escopo, { scopeHash: HASH_A })).toEqual([]);
  });
});

// ── O caminho HTTP, e o do Assistente ───────────────────────────────────────

describe("pela API, e pelo Assistente, o escopo é o mesmo objeto", () => {
  const ler = (quem: string, consulta = "") =>
    fetch(`${base}/changes${consulta}`, { headers: { "x-teste-como": quem } });

  it("a requisição carrega o escopo calculado da sessão", async () => {
    const res = await ler("ana@empresa-a.com");
    const corpo = (await res.json()) as { escopo: { empresaId: string; unidadesPermitidas: string[] } };
    expect(corpo.escopo.empresaId).toBe(empresaA);
    expect(corpo.escopo.unidadesPermitidas).toEqual([unidadeA]);
  });

  it("declarar o scopeHash da outra empresa na consulta não muda o escopo da sessão", async () => {
    const res = await ler("ana@empresa-a.com", `?scopeHash=${HASH_B}`);
    const corpo = (await res.json()) as { escopo: { empresaId: string; unidadesPermitidas: string[] } };
    /*
      O parâmetro não entra no cálculo — ele é conferido *contra* o cálculo. Se
      um dia alguém o fizer participar, é este caso que muda de cor.
    */
    expect(corpo.escopo.empresaId).toBe(empresaA);
    expect(corpo.escopo.unidadesPermitidas).toEqual([unidadeA]);
  });

  it("o Assistente não tem caminho paralelo: mesma função, mesmo resultado", async () => {
    /*
      A rota do Assistente lê `req.escopo` — o objeto que este middleware põe —
      e é essa identidade que se mede aqui. Um segundo cálculo para o
      Assistente seria um segundo lugar para divergir, e é de onde o vazamento
      sairia: a superfície que agrega é a que menos pode ter regra própria.
    */
    const daApi = await escopoEfetivo(CONTAS["ana@empresa-a.com"]!.id);
    const res = await ler("ana@empresa-a.com");
    const corpo = (await res.json()) as { escopo: { scopeHashesPermitidos: string[] } };
    expect(corpo.escopo.scopeHashesPermitidos).toEqual(daApi.scopeHashesPermitidos);
  });
});

// ── A fronteira desta fase, dita em voz alta ────────────────────────────────

describe("o que ainda NÃO está ligado — e este caso é o marcador", () => {
  it("REGISTRA A FASE: o veredito já é FORA, mas a leitura ainda passa", async () => {
    const { relatorioDeEscopo } = await import("../../middlewares/escopo-em-observacao");

    const res = await fetch(`${base}/changes?scopeHash=${HASH_B}`, {
      headers: { "x-teste-como": "ana@empresa-a.com" },
    });

    /*
      200, e não 403: o corte está em observação. O que já está certo é o
      veredito — o relatório registra `RECUSARIA` para esta requisição —, e é
      ele que o corte vai passar a honrar.

      **Quando o enforcement ligar, este caso tem de virar `expect(403)`.** Ele
      está escrito assim para que a mudança de fase seja uma linha visível num
      diff, e não um comportamento que alguém descobre em produção.
    */
    expect(res.status).toBe(200);

    const relatorio = relatorioDeEscopo();
    const desta = relatorio.rotas.find((r) => r.rota === "GET /changes");
    expect(desta, "a requisição tinha de ter sido observada").toBeTruthy();
    expect(
      desta!.recusaria,
      "o modo de observação precisa estar contando esta como recusa futura",
    ).toBeGreaterThan(0);
  });
});
