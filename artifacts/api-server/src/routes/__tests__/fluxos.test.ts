/**
 * A superfície HTTP de Fluxos Operacionais — pelo app de verdade.
 *
 * O motor já tem a sua bateria em `lib/fluxos`, e ela cobre regra e isolamento
 * contra o banco. O que **só** aqui pode ser provado é o que a rota acrescenta:
 * que o portão de sessão a cobre, que a empresa vem do escopo e nunca do corpo,
 * que cada recusa nomeada chega ao navegador com o número certo e um corpo JSON
 * legível, e que os contratos são explícitos — sem `PATCH /qualquer-coisa/:id`.
 *
 * O app inteiro é montado (`app.ts`), com `requireSession`, o parser de corpo e
 * os dois handlers de contrato na mesma ordem de produção. Um teste que
 * chamasse o router isolado não veria nenhuma dessas três coisas.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso, unidadeTable } from "@workspace/db";
import { CTE_ATE_RECEBIMENTO } from "@workspace/fluxos";

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;
let cookie: string;
let empresaA: string;
let empresaB: string;

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
    /*
      Corpo não-JSON é o defeito que `contrato-json.ts` existe para impedir.
      Guardar o texto cru aqui faz a falha aparecer legível na asserção, em vez
      de virar um `SyntaxError` sem contexto.
    */
    json = { __naoEhJson: texto };
  }
  return { status: res.status, tipo: res.headers.get("content-type") ?? "", json };
}

const post = (c: string, corpo: unknown) =>
  chamar(c, { method: "POST", body: JSON.stringify(corpo) });
const put = (c: string, corpo: unknown) =>
  chamar(c, { method: "PUT", body: JSON.stringify(corpo) });

beforeAll(async () => {
  ctx = await createTestDatabase("api_fluxos");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { createUser, startSession, SESSION_COOKIE } = await import("../../lib/session");
  const pessoa = await createUser(ctx.db, {
    name: "Fluxos",
    email: "fluxos@teste.local",
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

describe("o portão", () => {
  it("sem sessão, nenhuma rota de fluxos responde dado", async () => {
    const r = await chamar(`/api/fluxos?empresaId=${empresaA}`, {}, false);
    expect(r.status).toBe(401);
    expect(r.tipo).toContain("application/json");
    expect(r.json.code).toBe("UNAUTHENTICATED");
  });

  it("o catálogo também exige sessão — ele é vocabulário, não página pública", async () => {
    expect((await chamar("/api/fluxos/catalogo", {}, false)).status).toBe(401);
  });
});

describe("o catálogo", () => {
  it("serve o vocabulário para a tela não ter cópia própria", async () => {
    const r = await chamar("/api/fluxos/catalogo");
    expect(r.status).toBe(200);
    const tipos = r.json.tiposDeEtapa as { valor: string }[];
    expect(tipos.map((t) => t.valor)).toContain("DECISAO");
    const conexoes = r.json.tiposDeConexao as { valor: string }[];
    expect(conexoes.map((t) => t.valor)).toContain("RETRABALHO");
    const modelos = r.json.modelos as { slug: string }[];
    expect(modelos.map((m) => m.slug)).toContain("cte-ate-recebimento");
  });
});

describe("o escopo de empresa", () => {
  it("com mais de uma unidade cadastrada, exige a escolha em vez de adivinhar", async () => {
    const r = await chamar("/api/fluxos");
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain("Escolha a empresa");
  });

  it("uma empresa que não existe é recusada com a frase que manda para Unidades", async () => {
    const r = await chamar("/api/fluxos?empresaId=00000000-0000-0000-0000-000000000000");
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain("Unidades");
  });

  it("a empresa NUNCA vem do corpo — mandar `empresaId` no POST não muda nada", async () => {
    const r = await post(`/api/fluxos?empresaId=${empresaA}`, {
      nome: "Tentativa de escopo pelo corpo",
      categoria: "Teste",
      empresaId: empresaB,
    });
    expect(r.status).toBe(201);
    expect(r.json.empresaId).toBe(empresaA);
  });
});

describe("o ciclo de um fluxo pela API", () => {
  let fluxoId: string;

  it("cria", async () => {
    const r = await post(`/api/fluxos?empresaId=${empresaA}`, {
      nome: "Conciliação bancária",
      categoria: "Financeiro",
      objetivo: "Casar extrato com títulos.",
    });
    expect(r.status).toBe(201);
    expect(r.json.slug).toBe("conciliacao-bancaria");
    expect(r.json.status).toBe("RASCUNHO");
    fluxoId = r.json.id as string;
  });

  it("recusa nome em branco com 400 e a frase do domínio", async () => {
    const r = await post(`/api/fluxos?empresaId=${empresaA}`, { nome: " ", categoria: "X" });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain("nome");
  });

  it("recusa o slug repetido com 409", async () => {
    const r = await post(`/api/fluxos?empresaId=${empresaA}`, {
      nome: "Conciliação bancária",
      categoria: "Financeiro",
    });
    expect(r.status).toBe(409);
  });

  it("lista com as contagens", async () => {
    const r = await chamar(`/api/fluxos?empresaId=${empresaA}`);
    const fluxos = r.json.fluxos as { id: string; etapas: number }[];
    expect(fluxos.find((f) => f.id === fluxoId)?.etapas).toBe(0);
  });

  it("cria etapas, conecta, e devolve o fluxo inteiro", async () => {
    const inicio = await post(`/api/fluxos/${fluxoId}/etapas?empresaId=${empresaA}`, {
      nome: "Importar extrato",
      tipo: "INICIO",
      ordem: 0,
    });
    const decisao = await post(`/api/fluxos/${fluxoId}/etapas?empresaId=${empresaA}`, {
      nome: "Casou?",
      tipo: "DECISAO",
      ordem: 1,
    });
    const pendencia = await post(`/api/fluxos/${fluxoId}/etapas?empresaId=${empresaA}`, {
      nome: "Tratar divergência",
      tipo: "PENDENCIA",
      ordem: 2,
    });
    expect(inicio.status).toBe(201);

    const seta = await post(`/api/fluxos/${fluxoId}/conexoes?empresaId=${empresaA}`, {
      origemEtapaId: inicio.json.id,
      destinoEtapaId: decisao.json.id,
    });
    expect(seta.status).toBe(201);
    await post(`/api/fluxos/${fluxoId}/conexoes?empresaId=${empresaA}`, {
      origemEtapaId: decisao.json.id,
      destinoEtapaId: pendencia.json.id,
      tipo: "DECISAO_NAO",
      rotulo: "Não",
    });
    /* A volta — o retrabalho, que é o que faz o processo não ser uma lista. */
    const volta = await post(`/api/fluxos/${fluxoId}/conexoes?empresaId=${empresaA}`, {
      origemEtapaId: pendencia.json.id,
      destinoEtapaId: decisao.json.id,
      tipo: "RETRABALHO",
      rotulo: "Corrigido",
    });
    expect(volta.status).toBe(201);

    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    expect((completo.json.etapas as unknown[]).length).toBe(3);
    expect((completo.json.conexoes as unknown[]).length).toBe(3);
  });

  it("recusa a seta duplicada com 409", async () => {
    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const [a, b] = completo.json.etapas as { id: string }[];
    const r = await post(`/api/fluxos/${fluxoId}/conexoes?empresaId=${empresaA}`, {
      origemEtapaId: a.id,
      destinoEtapaId: b.id,
    });
    expect(r.status).toBe(409);
  });

  it("recusa o laço de uma etapa nela mesma com 400", async () => {
    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const [a] = completo.json.etapas as { id: string }[];
    const r = await post(`/api/fluxos/${fluxoId}/conexoes?empresaId=${empresaA}`, {
      origemEtapaId: a.id,
      destinoEtapaId: a.id,
    });
    expect(r.status).toBe(400);
  });

  it("grava as posições em lote", async () => {
    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const etapas = completo.json.etapas as { id: string }[];
    const r = await put(`/api/fluxos/${fluxoId}/posicoes?empresaId=${empresaA}`, {
      posicoes: etapas.map((e, i) => ({ etapaId: e.id, posX: i * 100, posY: i * 150 })),
    });
    expect(r.status).toBe(200);
    expect(r.json.gravadas).toBe(etapas.length);

    const depois = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const primeira = (depois.json.etapas as { posX: number }[])[0];
    expect(primeira.posX).toBe(0);
  });

  it("guarda o material da etapa por espécie, e devolve a etapa atualizada", async () => {
    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const etapa = (completo.json.etapas as { id: string }[])[0];

    const r = await put(
      `/api/fluxos/${fluxoId}/etapas/${etapa.id}/itens/SISTEMA?empresaId=${empresaA}`,
      { itens: [{ nome: "Banco", link: "https://banco.exemplo.com" }, { nome: "ERP" }] },
    );
    expect(r.status).toBe(200);
    const itens = r.json.itens as { nome: string; especie: string }[];
    expect(itens.filter((i) => i.especie === "SISTEMA").map((i) => i.nome)).toEqual([
      "Banco",
      "ERP",
    ]);
  });

  it("recusa espécie fora do catálogo com 400", async () => {
    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const etapa = (completo.json.etapas as { id: string }[])[0];
    const r = await put(
      `/api/fluxos/${fluxoId}/etapas/${etapa.id}/itens/CONTROLE?empresaId=${empresaA}`,
      { itens: [] },
    );
    expect(r.status).toBe(400);
  });

  it("guarda ações e recusa rota externa com 400", async () => {
    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const etapa = (completo.json.etapas as { id: string }[])[0];

    const boa = await put(
      `/api/fluxos/${fluxoId}/etapas/${etapa.id}/acoes?empresaId=${empresaA}`,
      { acoes: [{ titulo: "Abrir conciliação", rota: "/fechamento/conciliacao" }] },
    );
    expect(boa.status).toBe(200);
    expect((boa.json.acoes as { rota: string }[])[0].rota).toBe("/fechamento/conciliacao");

    const ma = await put(
      `/api/fluxos/${fluxoId}/etapas/${etapa.id}/acoes?empresaId=${empresaA}`,
      { acoes: [{ titulo: "Sair", rota: "https://exemplo.com" }] },
    );
    expect(ma.status).toBe(400);

    /* E o que já estava gravado continua lá — o lote inválido não gravou meio. */
    const depois = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const etapaDepois = (depois.json.etapas as { id: string; acoes: unknown[] }[]).find(
      (e) => e.id === etapa.id,
    )!;
    expect(etapaDepois.acoes).toHaveLength(1);
  });

  it("exclui uma etapa e as setas dela somem junto", async () => {
    const completo = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    const etapas = completo.json.etapas as { id: string }[];
    const r = await chamar(
      `/api/fluxos/${fluxoId}/etapas/${etapas[2].id}?empresaId=${empresaA}`,
      { method: "DELETE" },
    );
    expect(r.status).toBe(204);

    const depois = await chamar(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`);
    expect((depois.json.etapas as unknown[]).length).toBe(2);
    expect((depois.json.conexoes as unknown[]).length).toBe(1);
  });

  it("edita, arquiva e desarquiva", async () => {
    const editado = await put(`/api/fluxos/${fluxoId}?empresaId=${empresaA}`, {
      nome: "Conciliação bancária",
      categoria: "Financeiro",
      status: "ATIVO",
    });
    expect(editado.json.status).toBe("ATIVO");
    expect(editado.json.atualizadoPor).toBe("fluxos@teste.local");

    const arquivado = await post(`/api/fluxos/${fluxoId}/arquivar?empresaId=${empresaA}`, {});
    expect(arquivado.json.status).toBe("ARQUIVADO");

    const lista = await chamar(`/api/fluxos?empresaId=${empresaA}`);
    expect((lista.json.fluxos as { id: string }[]).map((f) => f.id)).not.toContain(fluxoId);

    const comArquivados = await chamar(`/api/fluxos?empresaId=${empresaA}&incluirArquivados=1`);
    expect((comArquivados.json.fluxos as { id: string }[]).map((f) => f.id)).toContain(fluxoId);

    const voltou = await post(`/api/fluxos/${fluxoId}/desarquivar?empresaId=${empresaA}`, {});
    expect(voltou.json.status).toBe("RASCUNHO");
  });

  it("duplica", async () => {
    const r = await post(`/api/fluxos/${fluxoId}/duplicar?empresaId=${empresaA}`, {
      nome: "Conciliação bancária (cópia)",
    });
    expect(r.status).toBe(201);
    expect(r.json.id).not.toBe(fluxoId);
    expect(r.json.status).toBe("RASCUNHO");
  });
});

describe("o modelo do CTe entra pela API, sem caminho especial", () => {
  let doCte: string;

  it("cria o fluxo com as dezesseis etapas e os retornos", async () => {
    const r = await post(`/api/fluxos/de-modelo?empresaId=${empresaB}`, {
      modelo: "cte-ate-recebimento",
    });
    expect(r.status).toBe(201);
    doCte = r.json.id as string;

    const completo = await chamar(`/api/fluxos/${doCte}?empresaId=${empresaB}`);
    const etapas = completo.json.etapas as { nome: string }[];
    const conexoes = completo.json.conexoes as { tipo: string }[];
    expect(etapas).toHaveLength(CTE_ATE_RECEBIMENTO.etapas.length);
    expect(etapas.map((e) => e.nome)).toContain("Autorização SEFAZ");
    expect(conexoes.some((c) => c.tipo === "RETRABALHO")).toBe(true);
  });

  it("pedir um modelo que não existe é 400, e não 500", async () => {
    const r = await post(`/api/fluxos/de-modelo?empresaId=${empresaB}`, { modelo: "inventado" });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toContain("inventado");
  });

  it("chamar de novo devolve o mesmo fluxo, sem duplicar", async () => {
    const r = await post(`/api/fluxos/de-modelo?empresaId=${empresaB}`, {
      modelo: "cte-ate-recebimento",
    });
    expect(r.json.id).toBe(doCte);
  });
});

describe("nenhuma rota permite quebrar o isolamento", () => {
  let daB: string;
  let etapaDaB: string;

  beforeAll(async () => {
    const criado = await post(`/api/fluxos?empresaId=${empresaB}`, {
      nome: "Processo só da B",
      categoria: "Reservado",
    });
    daB = criado.json.id as string;
    const etapa = await post(`/api/fluxos/${daB}/etapas?empresaId=${empresaB}`, {
      nome: "Etapa da B",
    });
    etapaDaB = etapa.json.id as string;
  });

  it("a lista da A não traz o fluxo da B", async () => {
    const r = await chamar(`/api/fluxos?empresaId=${empresaA}&incluirArquivados=1`);
    expect((r.json.fluxos as { id: string }[]).map((f) => f.id)).not.toContain(daB);
  });

  it("ler o fluxo da B como A é 404, e não 403 — não confirmamos que ele existe", async () => {
    const r = await chamar(`/api/fluxos/${daB}?empresaId=${empresaA}`);
    expect(r.status).toBe(404);
  });

  it("editar é 404", async () => {
    const r = await put(`/api/fluxos/${daB}?empresaId=${empresaA}`, {
      nome: "Tomado",
      categoria: "X",
    });
    expect(r.status).toBe(404);
  });

  it("arquivar é 404", async () => {
    expect((await post(`/api/fluxos/${daB}/arquivar?empresaId=${empresaA}`, {})).status).toBe(404);
  });

  it("criar etapa dentro é 404", async () => {
    const r = await post(`/api/fluxos/${daB}/etapas?empresaId=${empresaA}`, { nome: "Invasora" });
    expect(r.status).toBe(404);
  });

  it("editar e excluir a etapa alheia é 404", async () => {
    expect(
      (await put(`/api/fluxos/${daB}/etapas/${etapaDaB}?empresaId=${empresaA}`, { nome: "X" }))
        .status,
    ).toBe(404);
    expect(
      (
        await chamar(`/api/fluxos/${daB}/etapas/${etapaDaB}?empresaId=${empresaA}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("reposicionar a etapa alheia é 404", async () => {
    const r = await put(`/api/fluxos/${daB}/posicoes?empresaId=${empresaA}`, {
      posicoes: [{ etapaId: etapaDaB, posX: 1, posY: 1 }],
    });
    expect(r.status).toBe(404);
  });

  it("conectar uma etapa própria à etapa alheia é 404", async () => {
    const meu = await post(`/api/fluxos?empresaId=${empresaA}`, {
      nome: "Meu fluxo para a tentativa",
      categoria: "X",
    });
    const minha = await post(`/api/fluxos/${meu.json.id}/etapas?empresaId=${empresaA}`, {
      nome: "Minha",
    });
    const r = await post(`/api/fluxos/${meu.json.id}/conexoes?empresaId=${empresaA}`, {
      origemEtapaId: minha.json.id,
      destinoEtapaId: etapaDaB,
    });
    expect(r.status).toBe(404);
  });

  it("gravar material na etapa alheia é 404", async () => {
    expect(
      (
        await put(
          `/api/fluxos/${daB}/etapas/${etapaDaB}/itens/FALHA?empresaId=${empresaA}`,
          { itens: [{ nome: "x" }] },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await put(`/api/fluxos/${daB}/etapas/${etapaDaB}/acoes?empresaId=${empresaA}`, {
          acoes: [{ titulo: "x", rota: "/x" }],
        })
      ).status,
    ).toBe(404);
  });

  it("depois de tudo, o fluxo da B está intacto", async () => {
    const r = await chamar(`/api/fluxos/${daB}?empresaId=${empresaB}`);
    expect(r.status).toBe(200);
    expect(r.json.fluxo).toMatchObject({ nome: "Processo só da B" });
    expect((r.json.etapas as unknown[]).length).toBe(1);
  });
});

describe("importar uma declaração inteira", () => {
  it("cria fluxo, etapas e conexões numa chamada", async () => {
    const r = await post(`/api/fluxos/importar?empresaId=${empresaA}`, {
      nome: "Tratamento de divergências",
      categoria: "Controle",
      etapas: [
        { chave: "abre", nome: "Abrir ocorrência", tipo: "INICIO" },
        { chave: "analisa", nome: "Analisar", tipo: "VALIDACAO" },
        { chave: "fecha", nome: "Encerrar", tipo: "FIM" },
      ],
      conexoes: [
        { de: "abre", para: "analisa" },
        { de: "analisa", para: "fecha" },
      ],
    });
    expect(r.status).toBe(201);

    const completo = await chamar(`/api/fluxos/${r.json.id}?empresaId=${empresaA}`);
    expect((completo.json.etapas as unknown[]).length).toBe(3);
    expect((completo.json.conexoes as unknown[]).length).toBe(2);
  });

  it("uma conexão que cita etapa inexistente derruba a importação inteira", async () => {
    const r = await post(`/api/fluxos/importar?empresaId=${empresaA}`, {
      nome: "Declaração quebrada",
      categoria: "Controle",
      etapas: [{ chave: "a", nome: "A" }],
      conexoes: [{ de: "a", para: "fantasma" }],
    });
    expect(r.status).toBe(400);

    const lista = await chamar(`/api/fluxos?empresaId=${empresaA}&incluirArquivados=1`);
    expect(
      (lista.json.fluxos as { nome: string }[]).map((f) => f.nome),
    ).not.toContain("Declaração quebrada");
  });

  it("sem `etapas`, recusa com 400 em vez de criar um fluxo vazio por engano", async () => {
    const r = await post(`/api/fluxos/importar?empresaId=${empresaA}`, {
      nome: "Sem etapas",
      categoria: "X",
    });
    expect(r.status).toBe(400);
  });
});
