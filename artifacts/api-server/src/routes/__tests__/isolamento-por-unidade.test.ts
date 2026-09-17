import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * ISOLAMENTO POR UNIDADE — os testes negativos, escritos antes do corte.
 *
 * ---------------------------------------------------------------------------
 * O que estes casos provam, e o que eles deliberadamente ainda não provam
 * ---------------------------------------------------------------------------
 *
 * Eles provam que **o cálculo do escopo está certo**: que a conta da Unidade A
 * jamais recebe uma unidade, um `scope_hash` ou um veredito favorável sobre
 * nada da Unidade B — por parâmetro forjado, omitido, inventado, mandado em
 * lista, ou por qualquer caminho que o cliente escolha. É a camada em que a
 * garantia tem de morar, porque é a única que não depende de cada rota lembrar
 * de aplicá-la.
 *
 * O que eles **não** provam é que as rotas recusam, porque nesta fase elas não
 * recusam: o corte está em observação por decisão. O que o modo de observação
 * promete — e o que estes casos verificam — é que o **veredito** já é o certo.
 * Quando o corte ligar, o que muda é o que se faz com o veredito, não qual ele
 * é. Há um caso no fim que mede exatamente essa fronteira e diz a fase em voz
 * alta, e há outro que simula o corte ligado para provar que, quando ele for
 * ligado, quem não tem concessão fica sem acesso.
 *
 * ---------------------------------------------------------------------------
 * Por que duas unidades de verdade
 * ---------------------------------------------------------------------------
 *
 * O banco deste teste tem duas unidades, dois `scope_hash`, um terceiro hash
 * sem vínculo nenhum, e quatro contas com alcances diferentes — cada coisa
 * realmente pendurada na sua, pelas mesmas tabelas e chaves estrangeiras que a
 * produção usa. Um teste que simulasse a segunda unidade trocando um id na
 * chamada mediria a aritmética do próprio teste.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CONTAS: Record<string, SessionUser> = {};
let unidadeA = "";
let unidadeB = "";
const HASH_A = "hash-da-unidade-a";
const HASH_B = "hash-da-unidade-b";
/** Acervo importado que nenhuma unidade canônica reivindica — curadoria pendente. */
const HASH_ORFAO = "hash-sem-unidade";

let escopoEfetivo: typeof import("../../lib/escopo-efetivo").escopoEfetivo;
let vereditoDoHash: typeof import("../../lib/escopo-efetivo").vereditoDoHash;
let estreitar: typeof import("../../lib/escopo-efetivo").estreitar;

beforeAll(async () => {
  ctx = await createTestDatabase("isolamento_por_unidade");
  process.env.DATABASE_URL = ctx.url;

  const { db, unidadeTable, appUserTable, remuneracaoUnidadeTable, acessoAUnidadeTable } =
    await import("@workspace/db");
  ({ escopoEfetivo, vereditoDoHash, estreitar } = await import("../../lib/escopo-efetivo"));

  const [uA] = await db
    .insert(unidadeTable)
    .values({ nome: "CDD A", codigoGerencial: "A-001" })
    .returning();
  const [uB] = await db
    .insert(unidadeTable)
    .values({ nome: "CDD B", codigoGerencial: "B-001" })
    .returning();
  unidadeA = uA!.id;
  unidadeB = uB!.id;

  /*
    A ponte `scope_hash` → unidade, que é por onde o acervo se liga à fronteira.
    O terceiro entra **sem** unidade de propósito: é o estado real de acervo
    importado antes de alguém associar a unidade canônica, e é a categoria que
    não pode ser liberada por conveniência.
  */
  await db.insert(remuneracaoUnidadeTable).values([
    { scopeHash: HASH_A, unidadeId: unidadeA, codigo: "A-001", nome: "CDD A", canal: "EMPURRADA", vigenciaInicial: "2026-08-01" },
    { scopeHash: HASH_B, unidadeId: unidadeB, codigo: "B-001", nome: "CDD B", canal: "EMPURRADA", vigenciaInicial: "2026-08-01" },
    { scopeHash: HASH_ORFAO, unidadeId: null, codigo: "ORF", nome: "Sem unidade", canal: "EMPURRADA", vigenciaInicial: "2026-08-01" },
  ]);

  const criar = async (email: string) => {
    const [linha] = await db
      .insert(appUserTable)
      .values({ name: email, email, passwordHash: "scrypt$x", role: "OPERADOR" })
      .returning();
    CONTAS[email] = { id: linha!.id, name: email, email, role: "OPERADOR" } as SessionUser;
  };
  await criar("ana@a.com");
  await criar("bruno@b.com");
  await criar("controladoria@x.com");
  await criar("recem-chegado@x.com");

  await db.insert(acessoAUnidadeTable).values([
    { userId: CONTAS["ana@a.com"]!.id, unidadeId: unidadeA, nivel: "VER", concedidoPor: "teste" },
    { userId: CONTAS["bruno@b.com"]!.id, unidadeId: unidadeB, nivel: "VER", concedidoPor: "teste" },
    /* Controladoria: duas concessões **explícitas**, e não um atalho. */
    { userId: CONTAS["controladoria@x.com"]!.id, unidadeId: unidadeA, nivel: "VER", concedidoPor: "teste" },
    { userId: CONTAS["controladoria@x.com"]!.id, unidadeId: unidadeB, nivel: "VER", concedidoPor: "teste" },
  ]);
  /* `recem-chegado` fica sem nenhuma linha — de propósito. */

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
  /*
    O Assistente, montado como no servidor: ele lê `req.escopo`, o mesmo objeto
    que a rota acima recebe. É essa identidade que o caso do fim mede.
  */
  app.post("/assistant/ask", (req, res) => {
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

// ── O cálculo ───────────────────────────────────────────────────────────────

describe("o escopo sai da sessão, e a unidade é a fronteira", () => {
  it("a Unidade A não enxerga a Unidade B", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    expect(escopo.unidadesPermitidas).toEqual([unidadeA]);
    expect(escopo.unidadesPermitidas).not.toContain(unidadeB);
    expect(escopo.scopeHashesPermitidos).toEqual([HASH_A]);
  });

  it("e o inverso vale igual", async () => {
    const escopo = await escopoEfetivo(CONTAS["bruno@b.com"]!.id);
    expect(escopo.unidadesPermitidas).toEqual([unidadeB]);
    expect(escopo.scopeHashesPermitidos).toEqual([HASH_B]);
  });

  it("sem concessão, o conjunto é vazio — não há fallback", async () => {
    const escopo = await escopoEfetivo(CONTAS["recem-chegado@x.com"]!.id);
    /*
      É o caso que separa uma fronteira de um enfeite. Se este conjunto viesse
      cheio, a tabela existiria e não decidiria nada — e é exatamente o
      comportamento que a decisão de produto recusou.
    */
    expect(escopo.unidadesPermitidas).toEqual([]);
    expect(escopo.scopeHashesPermitidos).toEqual([]);
  });

  it("controladoria consolida duas unidades — porque tem as duas concessões", async () => {
    const escopo = await escopoEfetivo(CONTAS["controladoria@x.com"]!.id);
    expect(new Set(escopo.unidadesPermitidas)).toEqual(new Set([unidadeA, unidadeB]));
    expect(new Set(escopo.scopeHashesPermitidos)).toEqual(new Set([HASH_A, HASH_B]));
  });

  it("e ela não alcança nada além do que foi concedido", async () => {
    const escopo = await escopoEfetivo(CONTAS["controladoria@x.com"]!.id);
    /*
      Consolidar não é privilégio: é a soma de concessões. O acervo sem vínculo
      continua fora do conjunto dela, como está fora do de todo mundo.
    */
    expect(escopo.scopeHashesPermitidos).not.toContain(HASH_ORFAO);
    expect(vereditoDoHash(escopo, HASH_ORFAO)).toBe("SEM_VINCULO");
  });
});

// ── A manipulação do pedido ─────────────────────────────────────────────────

describe("o scopeHash do cliente estreita, e nunca amplia", () => {
  it("o hash da própria unidade é DENTRO; o da outra é FORA", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    expect(vereditoDoHash(escopo, HASH_A)).toBe("DENTRO");
    expect(vereditoDoHash(escopo, HASH_B)).toBe("FORA");
  });

  it("hash forjado: pedir a outra unidade devolve conjunto vazio, não o pedido", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    /*
      É aqui que "estreitar, nunca ampliar" vira uma linha executável. Uma
      implementação que devolvesse o pedido passaria em todos os outros casos e
      falharia só neste.
    */
    expect(estreitar(escopo, { scopeHash: HASH_B })).toEqual([]);
    expect(estreitar(escopo, { scopeHash: HASH_A })).toEqual([HASH_A]);
  });

  it("hash omitido: entrega o autorizado, e nunca seleciona fora dele", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    const semPedido = estreitar(escopo, {});
    expect(semPedido).toEqual([HASH_A]);
    expect(semPedido).not.toContain(HASH_B);
    expect(semPedido).not.toContain(HASH_ORFAO);
  });

  it("hash omitido por quem não tem concessão entrega nada", async () => {
    const escopo = await escopoEfetivo(CONTAS["recem-chegado@x.com"]!.id);
    expect(estreitar(escopo, {})).toEqual([]);
  });

  it("hash inventado não vira DENTRO nem por acaso", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    expect(vereditoDoHash(escopo, "hash-que-nunca-existiu")).toBe("FORA");
    expect(estreitar(escopo, { scopeHash: "hash-que-nunca-existiu" })).toEqual([]);
  });

  it("lista manipulada: o legítimo não carrega o alheio junto", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    /*
      Mandar `[meu, teu]` é a forma mais óbvia de tentar ampliar — a esperança é
      que um item válido faça a lista inteira passar. A interseção devolve só o
      que era dela.
    */
    expect(estreitar(escopo, { scopeHash: [HASH_A, HASH_B] })).toEqual([HASH_A]);
    expect(estreitar(escopo, { scopeHash: [HASH_B, HASH_ORFAO] })).toEqual([]);
  });

  it("SEM_VINCULO não é liberado por conveniência", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    expect(vereditoDoHash(escopo, HASH_ORFAO)).toBe("SEM_VINCULO");
    /*
      A categoria existe para ser medida e resolvida, não para passar. Nem no
      conjunto autorizado, nem na interseção.
    */
    expect(escopo.scopeHashesPermitidos).not.toContain(HASH_ORFAO);
    expect(estreitar(escopo, { scopeHash: HASH_ORFAO })).toEqual([]);
  });
});

// ── Pela API e pelo Assistente ──────────────────────────────────────────────

describe("chamada direta à API não contorna o middleware", () => {
  const ler = (quem: string, consulta = "") =>
    fetch(`${base}/changes${consulta}`, { headers: { "x-teste-como": quem } });

  it("a requisição carrega o escopo calculado da sessão", async () => {
    const corpo = (await (await ler("ana@a.com")).json()) as {
      escopo: { unidadesPermitidas: string[] };
    };
    expect(corpo.escopo.unidadesPermitidas).toEqual([unidadeA]);
  });

  it("declarar o hash da outra unidade não muda o escopo da sessão", async () => {
    const corpo = (await (await ler("ana@a.com", `?scopeHash=${HASH_B}`)).json()) as {
      escopo: { unidadesPermitidas: string[]; scopeHashesPermitidos: string[] };
    };
    /*
      O parâmetro não entra no cálculo — ele é conferido *contra* o cálculo. Se
      um dia alguém o fizer participar, é este caso que muda de cor.
    */
    expect(corpo.escopo.unidadesPermitidas).toEqual([unidadeA]);
    expect(corpo.escopo.scopeHashesPermitidos).toEqual([HASH_A]);
  });

  it("mandar a lista inteira pela URL também não amplia", async () => {
    const corpo = (await (
      await ler("ana@a.com", `?scopeHash=${HASH_A}&scopeHash=${HASH_B}`)
    ).json()) as { escopo: { scopeHashesPermitidos: string[] } };
    expect(corpo.escopo.scopeHashesPermitidos).toEqual([HASH_A]);
  });
});

describe("o Assistente não contorna a ACL", () => {
  it("ele recebe exatamente o mesmo objeto que as rotas normais", async () => {
    const daApi = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    const res = await fetch(`${base}/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-teste-como": "ana@a.com" },
      body: JSON.stringify({ pergunta: "onde perdemos mais dinheiro?" }),
    });
    const corpo = (await res.json()) as {
      escopo: { unidadesPermitidas: string[]; scopeHashesPermitidos: string[] };
    };
    /*
      Um segundo cálculo para o Assistente seria um segundo lugar para divergir,
      e é de onde o vazamento sairia: a superfície que agrega devolve o acervo
      resumido numa frase, e não uma linha de tabela.
    */
    expect(corpo.escopo.unidadesPermitidas).toEqual(daApi.unidadesPermitidas);
    expect(corpo.escopo.scopeHashesPermitidos).toEqual(daApi.scopeHashesPermitidos);
  });

  it("pedir a outra unidade no corpo da pergunta não amplia o escopo dele", async () => {
    const res = await fetch(`${base}/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-teste-como": "ana@a.com" },
      body: JSON.stringify({ pergunta: "e a outra unidade?", scopeHash: HASH_B }),
    });
    const corpo = (await res.json()) as { escopo: { scopeHashesPermitidos: string[] } };
    expect(corpo.escopo.scopeHashesPermitidos).toEqual([HASH_A]);
    expect(corpo.escopo.scopeHashesPermitidos).not.toContain(HASH_B);
  });
});

// ── O corte, simulado ───────────────────────────────────────────────────────

describe("quando o enforcement for ligado", () => {
  /*
    O corte ainda não existe, e estes casos não fingem que existe: eles aplicam
    a regra que o corte vai aplicar — `estreitar` sobre o escopo da sessão — e
    provam o desfecho. É o que permite escrever hoje o teste de um
    comportamento que entra depois, sem inventar um bloqueio que não está lá.
  */
  const comCorte = (escopo: Awaited<ReturnType<typeof escopoEfetivo>>, pedido?: string) => {
    const permitido = estreitar(escopo, pedido ? { scopeHash: pedido } : {});
    return permitido.length === 0 ? 403 : 200;
  };

  it("usuário sem concessão fica sem acesso", async () => {
    const escopo = await escopoEfetivo(CONTAS["recem-chegado@x.com"]!.id);
    expect(comCorte(escopo)).toBe(403);
    expect(comCorte(escopo, HASH_A)).toBe(403);
  });

  it("usuário com concessão acessa a dele e só a dele", async () => {
    const escopo = await escopoEfetivo(CONTAS["ana@a.com"]!.id);
    expect(comCorte(escopo, HASH_A)).toBe(200);
    expect(comCorte(escopo, HASH_B)).toBe(403);
  });

  it("controladoria consolida as duas, e nada além", async () => {
    const escopo = await escopoEfetivo(CONTAS["controladoria@x.com"]!.id);
    expect(comCorte(escopo, HASH_A)).toBe(200);
    expect(comCorte(escopo, HASH_B)).toBe(200);
    expect(comCorte(escopo, HASH_ORFAO)).toBe(403);
  });

  it("SEM_VINCULO nunca é exposto durante o enforcement", async () => {
    for (const quem of ["ana@a.com", "bruno@b.com", "controladoria@x.com", "recem-chegado@x.com"]) {
      const escopo = await escopoEfetivo(CONTAS[quem]!.id);
      expect(comCorte(escopo, HASH_ORFAO), quem).toBe(403);
    }
  });
});

// ── A fronteira desta fase, dita em voz alta ────────────────────────────────

describe("o que ainda NÃO está ligado — e este caso é o marcador", () => {
  it("REGISTRA A FASE: o veredito já é FORA, mas a leitura ainda passa", async () => {
    const { relatorioDeEscopo } = await import("../../middlewares/escopo-em-observacao");

    const res = await fetch(`${base}/changes?scopeHash=${HASH_B}`, {
      headers: { "x-teste-como": "ana@a.com" },
    });

    /*
      200, e não 403: o corte está em observação. O que já está certo é o
      veredito — o relatório conta esta requisição como `RECUSARIA` —, e é ele
      que o corte vai passar a honrar.

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

  it("o relatório separa quem não tem concessão — é o trabalho de antes do corte", async () => {
    const { relatorioDeEscopo } = await import("../../middlewares/escopo-em-observacao");
    await fetch(`${base}/changes`, { headers: { "x-teste-como": "recem-chegado@x.com" } });

    const relatorio = relatorioDeEscopo();
    expect(relatorio.resumo.contasSemConcessao).toBeGreaterThan(0);
    const conta = relatorio.contas.find((c) => c.userId === CONTAS["recem-chegado@x.com"]!.id);
    expect(conta?.unidades).toBe(0);
  });
});
