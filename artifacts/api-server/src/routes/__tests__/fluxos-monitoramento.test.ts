/**
 * A EXPOSIÇÃO DO MONITORAMENTO — o que a rota acrescenta, e o que ela promete
 * não acrescentar.
 *
 * O motor tem a bateria dele em `lib/fluxos/src/__tests__/monitoramento.test.ts`,
 * sem banco e sem HTTP: é lá que se prova a cor, a validade, o isolamento do
 * coletor quebrado e o corte do lento. Repetir aquilo aqui só provaria de novo o
 * mesmo `switch`.
 *
 * O que **só** aqui pode ser provado são duas coisas diferentes, e por isso este
 * arquivo tem dois blocos:
 *
 * 1. **pela rota** — o portão de sessão cobre os três endereços, a empresa vem
 *    do escopo e nunca do corpo, fluxo de outra empresa é 404, `apuradoEm` chega
 *    ao navegador, a resposta nunca fica verde por ausência, nenhuma recusa vira
 *    5xx, e o painel cruzado não é engolido pelo `GET /fluxos/:id`;
 * 2. **pela cadeia real** — `lerFluxo` (o repositório, com o `where empresa_id`)
 *    ligado a `monitorarFluxo` sobre um fluxo que está mesmo no banco, com
 *    coletores sintéticos. É o único lugar em que os casos do coletor (sem
 *    resposta, erro, tempo limite, leitura vencida, chave fora do prefixo) podem
 *    ser provados **sobre dado gravado** — a rota usa o registro real da
 *    instalação, e abrir uma porta para trocá-lo em tempo de execução seria
 *    criar exatamente a dependência global frágil que `lib/monitoramento.ts`
 *    recusa.
 *
 * E há uma afirmação que atravessa os dois: **monitorar não escreve**. Ela é
 * medida contando as linhas das seis tabelas de fluxo e o carimbo de
 * `atualizado_em` antes e depois de exercitar tudo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso, unidadeTable } from "@workspace/db";
import {
  CTE_ATE_RECEBIMENTO,
  coletorFixo,
  importarFluxo,
  lerFluxo,
  monitorarFluxo,
  registroDeColetores,
  type Coletor,
  type EstadoDaEtapa,
  type FluxoCompleto,
  type Leitura,
  type Monitoramento,
} from "@workspace/fluxos";

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;
let cookie: string;
let empresaA: string;
let empresaB: string;
/** O fluxo do CTe na empresa A — 18 etapas, 18 chaves, 1 coberta. */
let fluxoDaA: string;
/** Um fluxo da empresa B, para provar que a A não o alcança. */
let fluxoDaB: string;
/** Um fluxo sem chave nenhuma, para o caso do processo que ninguém pediu para medir. */
let fluxoSemChave: string;

interface Resposta {
  status: number;
  tipo: string;
  json: Record<string, unknown>;
}

async function chamar(
  caminho: string,
  init: RequestInit = {},
  comSessao = true,
): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, {
    ...init,
    headers: {
      ...(comSessao && cookie ? { cookie } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const texto = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = texto === "" ? {} : (JSON.parse(texto) as Record<string, unknown>);
  } catch {
    json = { __naoEhJson: texto };
  }
  return { status: res.status, tipo: res.headers.get("content-type") ?? "", json };
}

const AUTOR = { email: "monitoramento@teste.local" };

beforeAll(async () => {
  ctx = await createTestDatabase("api_fluxos_monitoramento");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { createUser, startSession, SESSION_COOKIE } = await import("../../lib/session");
  const pessoa = await createUser(ctx.db, {
    name: "Monitoramento",
    email: "monitoramento@teste.local",
    password: "SenhaDeTeste#12345",
  });
  const { token } = await startSession(ctx.db, pessoa.id);
  cookie = `${SESSION_COOKIE}=${token}`;

  const [a] = await ctx.db
    .insert(unidadeTable)
    .values({ nome: "Transportes A", cnpj: "11111111000191" })
    .returning();
  const [b] = await ctx.db
    .insert(unidadeTable)
    .values({ nome: "Transportes B", cnpj: "22222222000172" })
    .returning();
  empresaA = a.id;
  empresaB = b.id;

  fluxoDaA = (await importarFluxo(ctx.db, empresaA, CTE_ATE_RECEBIMENTO, AUTOR)).id;
  fluxoDaB = (await importarFluxo(ctx.db, empresaB, CTE_ATE_RECEBIMENTO, AUTOR)).id;
  fluxoSemChave = (
    await importarFluxo(
      ctx.db,
      empresaA,
      {
        nome: "Processo de mesa",
        slug: "processo-de-mesa",
        categoria: "ADMINISTRATIVO",
        etapas: [
          { chave: "a", nome: "Conferir à mão" },
          { chave: "b", nome: "Arquivar" },
        ],
        conexoes: [{ de: "a", para: "b" }],
      },
      AUTOR,
    )
  ).id;

  const { default: app } = await import("../../app");
  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 600_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await ctx?.pool.end().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});

  const admin = createDb(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433",
  );
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nomeDoBanco],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`);
  await admin.pool.end();
}, 60_000);

// ---------------------------------------------------------------------------
// 1. Pela rota
// ---------------------------------------------------------------------------

describe("o portão", () => {
  it("sem sessão, nenhum dos três endereços responde dado", async () => {
    for (const caminho of [
      `/api/fluxos/${fluxoDaA}/monitoramento?empresaId=${empresaA}`,
      `/api/fluxos/${fluxoDaA}/cobertura?empresaId=${empresaA}`,
      `/api/monitoramento/fluxos?empresaId=${empresaA}`,
    ]) {
      const r = await chamar(caminho, {}, false);
      expect(r.status).toBe(401);
      expect(r.json.code).toBe("UNAUTHENTICATED");
    }
  });
});

describe("o isolamento por empresa", () => {
  it("monitorar o fluxo da B como A é 404 — não confirmamos que ele existe", async () => {
    const r = await chamar(
      `/api/fluxos/${fluxoDaB}/monitoramento?empresaId=${empresaA}`,
    );
    expect(r.status).toBe(404);
    expect(r.tipo).toContain("application/json");
  });

  it("a cobertura do fluxo da B como A também é 404", async () => {
    const r = await chamar(`/api/fluxos/${fluxoDaB}/cobertura?empresaId=${empresaA}`);
    expect(r.status).toBe(404);
  });

  it("o painel cruzado da A não traz nenhum fluxo da B", async () => {
    const r = await chamar(`/api/monitoramento/fluxos?empresaId=${empresaA}`);
    expect(r.status).toBe(200);
    const fluxos = r.json.fluxos as { fluxo: { id: string } }[];
    const ids = fluxos.map((f) => f.fluxo.id);
    expect(ids).toContain(fluxoDaA);
    expect(ids).not.toContain(fluxoDaB);
    expect(r.json.empresaId).toBe(empresaA);
  });

  it("a empresa vem do escopo, e um corpo não pode trocá-la", async () => {
    const r = await chamar(
      `/api/fluxos/${fluxoDaB}/monitoramento?empresaId=${empresaA}`,
      { method: "GET", headers: { "x-empresa-id": empresaB } },
    );
    expect(r.status).toBe(404);
  });
});

describe("o fluxo que não existe", () => {
  it("um id qualquer é 404 nas duas leituras, com corpo JSON", async () => {
    const inexistente = "00000000-0000-0000-0000-000000000000";
    for (const sufixo of ["monitoramento", "cobertura"]) {
      const r = await chamar(
        `/api/fluxos/${inexistente}/${sufixo}?empresaId=${empresaA}`,
      );
      expect(r.status).toBe(404);
      expect(r.tipo).toContain("application/json");
    }
  });

  it("uma empresa inexistente é recusada com 400, e nunca com 5xx próprio", async () => {
    for (const caminho of [
      `/api/fluxos/${fluxoDaA}/monitoramento`,
      `/api/fluxos/${fluxoDaA}/cobertura`,
      `/api/monitoramento/fluxos`,
    ]) {
      const r = await chamar(
        `${caminho}?empresaId=00000000-0000-0000-0000-000000000000`,
      );
      expect(r.status).toBe(400);
      expect(r.status).toBeLessThan(500);
      expect(r.tipo).toContain("application/json");
    }
  });
});

describe("a resposta do monitoramento", () => {
  it("carrega apuradoEm, e ele é de agora — a tela não finge tempo real", async () => {
    const antes = Date.now();
    const r = await chamar(
      `/api/fluxos/${fluxoDaA}/monitoramento?empresaId=${empresaA}`,
    );
    const depois = Date.now();

    expect(r.status).toBe(200);
    expect(r.json.fluxoId).toBe(fluxoDaA);
    const apuradoEm = Date.parse(String(r.json.apuradoEm));
    expect(Number.isNaN(apuradoEm)).toBe(false);
    /* Um segundo de folga para o arredondamento do relógio da resposta. */
    expect(apuradoEm).toBeGreaterThanOrEqual(antes - 1_000);
    expect(apuradoEm).toBeLessThanOrEqual(depois + 1_000);
  });

  it("nada fica verde sem coletor: 18 chaves, 1 com dono, e nenhuma cor acesa", async () => {
    /*
      O retrato honesto do estado de hoje, e a razão de esta rota poder ser
      ligada antes de existir o segundo coletor. O único coletor real lê o
      extrato fiscal, que neste banco não existe — então ele não devolve nada, e
      o silêncio dele é `sem_resposta`, nunca verde.
    */
    const r = await chamar(
      `/api/fluxos/${fluxoDaA}/monitoramento?empresaId=${empresaA}`,
    );
    const resumo = r.json.resumo as Record<string, number>;
    const etapas = r.json.etapas as { farol: string; motivo: string | null; chave: string | null }[];

    expect(resumo.etapas).toBe(18);
    expect(resumo.medidas).toBe(0);
    expect(resumo.semDado).toBe(18);
    expect(resumo.respondidas).toBe(0);
    expect(resumo.vencidas).toBe(0);
    expect(r.json.resumo).toMatchObject({ pior: null });
    expect(etapas.every((e) => e.farol === "SEM_DADO")).toBe(true);
    expect(etapas.some((e) => e.farol === "VERDE")).toBe(false);

    /* As 17 chaves sem dono aparecem como sem dono, e não como cinza mudo. */
    const semColetor = r.json.semColetor as string[];
    expect(semColetor).toHaveLength(17);
    expect(semColetor).not.toContain("cte.autorizacao_sefaz");
    const daSefaz = etapas.find((e) => e.chave === "cte.autorizacao_sefaz");
    expect(daSefaz?.motivo).toBe("sem_resposta");
    expect(etapas.filter((e) => e.motivo === "sem_coletor")).toHaveLength(17);
  });

  it("as falhas viajam sempre na resposta, mesmo vazias", async () => {
    const r = await chamar(
      `/api/fluxos/${fluxoDaA}/monitoramento?empresaId=${empresaA}`,
    );
    expect(Array.isArray(r.json.falhas)).toBe(true);
    expect(Array.isArray(r.json.semColetor)).toBe(true);
  });

  it("um fluxo sem chave nenhuma diz sem_chave, e não fica bem por omissão", async () => {
    const r = await chamar(
      `/api/fluxos/${fluxoSemChave}/monitoramento?empresaId=${empresaA}`,
    );
    expect(r.status).toBe(200);
    const etapas = r.json.etapas as { farol: string; motivo: string; chave: null }[];
    expect(etapas).toHaveLength(2);
    expect(etapas.every((e) => e.motivo === "sem_chave" && e.chave === null)).toBe(true);
    expect(r.json.resumo).toMatchObject({ etapas: 2, medidas: 0, semDado: 2, pior: null });
    expect(r.json.semColetor).toEqual([]);
  });
});

describe("a cobertura", () => {
  it("separa as sete contas que o diagnóstico precisa distinguir", async () => {
    const r = await chamar(`/api/fluxos/${fluxoDaA}/cobertura?empresaId=${empresaA}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      fluxoId: fluxoDaA,
      etapas: 18,
      etapasComChave: 18,
      etapasCobertas: 1,
      malFormadas: [],
    });
    expect(r.json.semColetor).toHaveLength(17);

    const chaves = r.json.chaves as { chave: string; coletor: string | null }[];
    const sefaz = chaves.find((c) => c.chave === "cte.autorizacao_sefaz");
    expect(sefaz?.coletor).toBe("extrato-fiscal-03.08.15");
    expect(chaves.filter((c) => c.coletor === null)).toHaveLength(17);
  });

  it("o fluxo sem chave devolve zeros, e não um erro", async () => {
    const r = await chamar(`/api/fluxos/${fluxoSemChave}/cobertura?empresaId=${empresaA}`);
    expect(r.json).toMatchObject({
      etapas: 2,
      etapasComChave: 0,
      etapasCobertas: 0,
      chaves: [],
      semColetor: [],
      malFormadas: [],
    });
  });
});

describe("o endereço do painel cruzado", () => {
  /*
    A colisão que este bloco impede: se o painel morasse em
    `/fluxos/monitoramento`, ele seria um segundo padrão disputando o mesmo
    endereço de `GET /fluxos/:id` — e quem ganha seria a ordem de declaração no
    arquivo, que muda num rebase sem ninguém perceber.
  */
  it("`monitoramento` nunca é lido como um id de fluxo — e nunca devolve o painel", async () => {
    /*
      O endereço que teria colidido cai onde qualquer outro texto cairia: no
      `GET /fluxos/:id`, tratado como um id que não é um id. O que importa aqui
      é o que ele **não** devolve — o painel. E que se comporte igual a um texto
      qualquer, o que prova que "monitoramento" não tem tratamento especial
      nenhum neste roteador.
    */
    const comoPainel = await chamar(`/api/fluxos/monitoramento?empresaId=${empresaA}`);
    const textoQualquer = await chamar(`/api/fluxos/xpto-nao-eh-id?empresaId=${empresaA}`);

    expect(comoPainel.status).toBe(textoQualquer.status);
    expect(comoPainel.status).not.toBe(200);
    expect(comoPainel.json).not.toHaveProperty("fluxos");
    expect(comoPainel.tipo).toContain("application/json");
  });

  it("o painel não depende da ordem das declarações — o namespace é outro", async () => {
    /*
      A prova positiva do mesmo ponto: o painel responde no endereço dele, e
      nenhum `:id` alcança `/monitoramento/fluxos`. Não existe ordem de
      declaração capaz de trocar um pelo outro, porque não há dois padrões
      disputando o mesmo caminho.
    */
    const painel = await chamar(`/api/monitoramento/fluxos?empresaId=${empresaA}`);
    expect(painel.status).toBe(200);
    expect(Array.isArray(painel.json.fluxos)).toBe(true);
  });

  it("o painel responde no namespace próprio, com um monitoramento por fluxo", async () => {
    const r = await chamar(`/api/monitoramento/fluxos?empresaId=${empresaA}`);
    expect(r.status).toBe(200);
    const fluxos = r.json.fluxos as {
      fluxo: { id: string; nome: string; slug: string };
      monitoramento: { fluxoId: string; apuradoEm: string; resumo: Record<string, number> };
    }[];
    expect(fluxos).toHaveLength(2);
    for (const item of fluxos) {
      expect(item.monitoramento.fluxoId).toBe(item.fluxo.id);
      expect(Number.isNaN(Date.parse(item.monitoramento.apuradoEm))).toBe(false);
    }
    /* Uma colheita só: todos os fluxos datados no mesmo instante. */
    const instantes = new Set(fluxos.map((f) => f.monitoramento.apuradoEm));
    expect(instantes.size).toBe(1);
  });

  it("o painel de uma empresa sem fluxo é uma lista vazia, e não um erro", async () => {
    const [c] = await ctx.db
      .insert(unidadeTable)
      .values({ nome: "Transportes C", cnpj: "33333333000153" })
      .returning();
    const r = await chamar(`/api/monitoramento/fluxos?empresaId=${c.id}`);
    expect(r.status).toBe(200);
    expect(r.json.fluxos).toEqual([]);
  });
});

describe("monitorar não escreve", () => {
  const TABELAS = [
    "fluxo_operacional",
    "fluxo_etapa",
    "fluxo_conexao",
    "fluxo_etapa_item",
    "fluxo_etapa_indicador",
    "fluxo_etapa_acao",
  ];

  async function retrato(): Promise<string> {
    const partes: string[] = [];
    for (const tabela of TABELAS) {
      const { rows } = await ctx.pool.query<{ n: string }>(
        `select count(*)::text as n from ${tabela}`,
      );
      partes.push(`${tabela}=${rows[0]!.n}`);
    }
    const { rows } = await ctx.pool.query<{ carimbo: string }>(
      `select coalesce(max(atualizado_em)::text, '-') as carimbo from fluxo_operacional`,
    );
    partes.push(`atualizado_em=${rows[0]!.carimbo}`);
    return partes.join(" ");
  }

  it("nenhuma linha muda, e nenhum carimbo avança, por mais que se leia", async () => {
    const antes = await retrato();
    for (let i = 0; i < 3; i += 1) {
      await chamar(`/api/fluxos/${fluxoDaA}/monitoramento?empresaId=${empresaA}`);
      await chamar(`/api/fluxos/${fluxoDaA}/cobertura?empresaId=${empresaA}`);
      await chamar(`/api/monitoramento/fluxos?empresaId=${empresaA}`);
    }
    expect(await retrato()).toBe(antes);
  });
});

// ---------------------------------------------------------------------------
// 2. Pela cadeia real: repositório + motor, sobre dado gravado
// ---------------------------------------------------------------------------

describe("a cadeia repositório → motor", () => {
  /** A chave da etapa "Autorização SEFAZ" do fluxo do CTe, que está no banco. */
  const CHAVE = "cte.autorizacao_sefaz";
  const VALIDADE_CURTA = 60;

  async function fluxo(empresaId: string, id: string): Promise<FluxoCompleto> {
    const completo = await lerFluxo(ctx.db, empresaId, id);
    if (!completo) throw new Error("o fluxo do cenário não foi lido");
    return completo;
  }

  async function apurar(coletores: Coletor[], empresaId = empresaA) {
    return monitorarFluxo(
      registroDeColetores(...coletores),
      empresaId,
      await fluxo(empresaId, fluxoDaA),
      { validadePadraoEmSegundos: VALIDADE_CURTA },
    );
  }

  function daChave(
    resultado: Monitoramento,
    chave: string,
  ): EstadoDaEtapa | undefined {
    return resultado.etapas.find((e) => e.chave === chave);
  }

  function agoraMenos(segundos: number): Leitura["medidoEm"] {
    return new Date(Date.now() - segundos * 1_000).toISOString();
  }

  it("o repositório não entrega o fluxo da B para a A — a cadeia inteira respeita a empresa", async () => {
    expect(await lerFluxo(ctx.db, empresaA, fluxoDaB)).toBeNull();
    expect(await lerFluxo(ctx.db, empresaB, fluxoDaA)).toBeNull();
    /* E o fluxo da B, lido pela B, é o mesmo processo — não é o da A. */
    const daB = await fluxo(empresaB, fluxoDaB);
    expect(daB.fluxo.empresaId).toBe(empresaB);
    expect(daB.etapas).toHaveLength(18);
  });

  it("leitura válida acende a etapa que está no banco", async () => {
    const resultado = await apurar([
      coletorFixo([{ chave: CHAVE, farol: "VERDE", medidoEm: agoraMenos(5) }], {
        nome: "fiscal",
      }),
    ]);
    expect(daChave(resultado, CHAVE)).toMatchObject({
      farol: "VERDE",
      vencida: false,
      motivo: null,
    });
    expect(resultado.resumo).toMatchObject({ medidas: 1, respondidas: 1, vencidas: 0 });
  });

  it("leitura vencida apaga o farol sem perder a medição", async () => {
    const resultado = await apurar([
      coletorFixo(
        [{ chave: CHAVE, farol: "VERMELHO", medidoEm: agoraMenos(VALIDADE_CURTA * 10) }],
        { nome: "fiscal" },
      ),
    ]);
    const etapa = daChave(resultado, CHAVE);
    expect(etapa).toMatchObject({ farol: "SEM_DADO", vencida: true, motivo: "vencida" });
    expect(etapa?.leitura?.farol).toBe("VERMELHO");
    expect(resultado.resumo).toMatchObject({ medidas: 0, respondidas: 1, vencidas: 1 });
  });

  it("chave sem coletor fica sem_coletor, e nunca verde", async () => {
    const resultado = await apurar([
      coletorFixo([{ chave: CHAVE, farol: "VERDE", medidoEm: agoraMenos(5) }], {
        nome: "fiscal",
      }),
    ]);
    const orfas = resultado.etapas.filter((e) => e.motivo === "sem_coletor");
    expect(orfas).toHaveLength(17);
    expect(orfas.every((e) => e.farol === "SEM_DADO")).toBe(true);
    expect(resultado.semColetor).toHaveLength(17);
  });

  it("coletor que não responde pela chave dele fica sem_resposta", async () => {
    const mudo: Coletor = { nome: "fiscal", prefixos: [CHAVE], ler: async () => [] };
    const resultado = await apurar([mudo]);
    expect(daChave(resultado, CHAVE)).toMatchObject({
      farol: "SEM_DADO",
      motivo: "sem_resposta",
    });
    expect(resultado.falhas).toEqual([]);
  });

  it("coletor que lança erro não contamina os outros, e a falha vai na resposta", async () => {
    const resultado = await apurar([
      coletorFixo([{ chave: CHAVE, farol: "VERDE", medidoEm: agoraMenos(5) }], {
        nome: "fiscal",
        falharCom: "conexão recusada",
      }),
      coletorFixo([{ chave: "cte.emissao", farol: "AMARELO", medidoEm: agoraMenos(5) }], {
        nome: "emissao",
      }),
    ]);
    expect(daChave(resultado, CHAVE)).toMatchObject({
      farol: "SEM_DADO",
      motivo: "coletor_falhou",
    });
    expect(daChave(resultado, "cte.emissao")).toMatchObject({ farol: "AMARELO" });
    expect(resultado.falhas[0]).toMatchObject({ coletor: "fiscal" });
    expect(String(resultado.falhas[0]?.mensagem)).toContain("conexão recusada");
  });

  it("coletor que estoura o tempo limite é cortado, e o resto continua aceso", async () => {
    const resultado = await monitorarFluxo(
      registroDeColetores(
        coletorFixo([{ chave: CHAVE, farol: "VERDE", medidoEm: agoraMenos(5) }], {
          nome: "lento",
          demorarEmMs: 200,
        }),
        coletorFixo([{ chave: "cte.emissao", farol: "VERDE", medidoEm: agoraMenos(5) }], {
          nome: "rapido",
        }),
      ),
      empresaA,
      await fluxo(empresaA, fluxoDaA),
      { validadePadraoEmSegundos: VALIDADE_CURTA, tempoLimiteEmMs: 20 },
    );
    expect(daChave(resultado, CHAVE)).toMatchObject({
      farol: "SEM_DADO",
      motivo: "coletor_falhou",
    });
    expect(daChave(resultado, "cte.emissao")).toMatchObject({ farol: "VERDE" });
    expect(resultado.falhas.map((f) => f.coletor)).toContain("lento");
  });

  it("leitura de chave fora do prefixo do coletor é descartada, e vira falha", async () => {
    const invasor: Coletor = {
      nome: "invasor",
      prefixos: [CHAVE],
      ler: async () => [
        { chave: CHAVE, farol: "VERDE", medidoEm: agoraMenos(5) },
        /* A etapa "Emissão do CTe" não é dele, e ele não pode pintá-la. */
        { chave: "cte.emissao", farol: "VERDE", medidoEm: agoraMenos(5) },
      ],
    };
    const resultado = await apurar([invasor]);
    expect(daChave(resultado, CHAVE)).toMatchObject({ farol: "VERDE" });
    expect(daChave(resultado, "cte.emissao")).toMatchObject({
      farol: "SEM_DADO",
      motivo: "sem_coletor",
    });
    expect(resultado.falhas.map((f) => f.coletor)).toContain("invasor");
  });

  it("o resumo devolve o pior farol aceso, e a ausência não entra na régua", async () => {
    const resultado = await apurar([
      coletorFixo(
        [
          { chave: CHAVE, farol: "VERDE", medidoEm: agoraMenos(5) },
          { chave: "cte.emissao", farol: "VERMELHO", medidoEm: agoraMenos(5) },
          { chave: "cte.validacao", farol: "AMARELO", medidoEm: agoraMenos(5) },
        ],
        { nome: "fiscal" },
      ),
    ]);
    expect(resultado.resumo).toMatchObject({
      etapas: 18,
      medidas: 3,
      respondidas: 3,
      vencidas: 0,
      semDado: 15,
      pior: "VERMELHO",
    });
    expect(resultado.resumo.porFarol).toMatchObject({
      VERDE: 1,
      AMARELO: 1,
      VERMELHO: 1,
      SEM_DADO: 15,
    });
  });

  it("apuradoEm é o instante da colheita, e é coerente com o relógio", async () => {
    const antes = Date.now();
    const resultado = await apurar([]);
    const depois = Date.now();
    const apuradoEm = Date.parse(resultado.apuradoEm);
    expect(apuradoEm).toBeGreaterThanOrEqual(antes - 1_000);
    expect(apuradoEm).toBeLessThanOrEqual(depois + 1_000);
  });
});
