import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";

/**
 * A superfície de Cavalo 360° e Carreta 360°, sobre o export real.
 *
 * O cálculo está coberto em `@workspace/comparison`; o que se protege aqui é o
 * contrato da rota, e ele tem uma armadilha própria que nenhum teste de
 * biblioteca alcança: **`entityType` já queria dizer outra coisa**. Em
 * `/changes/consolidated` ele sempre foi filtro de linha — a Visão geral manda
 * esse parâmetro desde que existe, e o que ele faz é encolher a lista deixando
 * os cartões descrevendo a frota. Nas telas 360° o mesmo nome passa a querer
 * dizer "esta tela inteira é do cavalo, recontem tudo".
 *
 * `escopo=1` é o que separa as duas leituras, e os dois primeiros casos abaixo
 * são o par que importa: sem a chave, a resposta é byte a byte a de sempre; com
 * ela, vem `totais` recontado ao lado. Se alguém "simplificar" isso um dia
 * fazendo `entityType` sozinho recontar, todo link antigo da Visão geral muda
 * de significado em silêncio — e o número que ele mostra continua parecendo
 * certo.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

interface Resposta {
  status: number;
  body: any;
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_frota_360");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const { default: frotaRouter } = await import("../frota");
  const { default: changesRouter } = await import("../changes");
  const { default: impactoRouter } = await import("../impacto");
  const { default: composicaoRouter } = await import("../composition");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(frotaRouter);
  app.use(changesRouter);
  app.use(impactoRouter);
  app.use(composicaoRouter);

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

describe("GET /frota/ativos", () => {
  it("lista a frota do equipamento, com placa e histórico", async () => {
    const res = await get("/frota/ativos?entityType=CAVALO");
    expect(res.status).toBe(200);
    expect(res.body.entityType).toBe("CAVALO");
    expect(res.body.ativos.length).toBeGreaterThan(0);

    const primeiro = res.body.ativos[0];
    expect(primeiro.plate).toMatch(/^[A-Z0-9]+$/);
    expect(primeiro.periods).toBeGreaterThan(0);
    expect(primeiro.firstLabel).toMatch(/^EMPURRADA_/);
  });

  it("não mistura equipamentos", async () => {
    const [cavalos, carretas] = await Promise.all([
      get("/frota/ativos?entityType=CAVALO"),
      get("/frota/ativos?entityType=CARRETA"),
    ]);

    const placasDeCavalo = new Set(cavalos.body.ativos.map((a: any) => a.plate));
    const cruzadas = carretas.body.ativos.filter((a: any) =>
      placasDeCavalo.has(a.plate),
    );
    expect(cruzadas).toEqual([]);
  });

  it("conhece o ativo que nunca mudou", async () => {
    /*
      A razão de existir desta rota. As quatro leituras de Alterações só
      conhecem o ativo que aparece numa alteração; um seletor de placa montado
      sobre elas ofereceria uma frota menor do que a real, e quem procurasse o
      cavalo parado no pátio concluiria que ele não está na base.
    */
    const frota = await get("/frota/ativos?entityType=CAVALO");
    const alteracoes = await get(
      "/changes/consolidated?escopo=1&entityType=CAVALO&limit=500",
    );

    const comAlteracao = new Set(
      alteracoes.body.rows.map((r: any) => r.entityLabel).filter(Boolean),
    );
    expect(frota.body.ativos.length).toBeGreaterThan(comAlteracao.size);
  });

  it("recusa o pedido sem equipamento em vez de escolher um", async () => {
    // Um padrão silencioso aqui abriria Carreta 360° com a frota de cavalos.
    const res = await get("/frota/ativos");
    expect(res.status).toBe(400);
  });
});

describe("o escopo em /changes/consolidated", () => {
  it("sem `escopo`, responde exatamente como sempre respondeu", async () => {
    const semNada = await get("/changes/consolidated");
    const comFiltro = await get("/changes/consolidated?entityType=CAVALO");

    // O filtro encolhe a lista e **não** toca nos cartões: é o contrato antigo,
    // e é dele que dependem os links da Visão geral.
    expect(comFiltro.body.totais).toBeUndefined();
    expect(comFiltro.body.view.totals).toEqual(semNada.body.view.totals);
    expect(comFiltro.body.total).toBeLessThan(semNada.body.total);
  });

  it("com `escopo`, reconta os totais ao lado — sem reescrever a view", async () => {
    const tudo = await get("/changes/consolidated");
    const cavalo = await get("/changes/consolidated?escopo=1&entityType=CAVALO");

    expect(cavalo.body.escopo).toEqual({ entityType: "CAVALO" });
    expect(cavalo.body.totais).toBeDefined();
    expect(cavalo.body.totais.valueChanges).toBeLessThan(
      tudo.body.view.totals.valueChanges,
    );
    // A `view` continua descrevendo o período inteiro: é ela que diz qual série
    // faltou, e recortá-la apagaria esse aviso justamente de quem mais precisa
    // dele — uma tela de cavalos sem o cavalo daquela quinzena.
    expect(cavalo.body.view.totals).toEqual(tudo.body.view.totals);
  });

  it("cavalo mais carreta somam o todo", async () => {
    const [tudo, cavalo, carreta] = await Promise.all([
      get("/changes/consolidated?escopo=1"),
      get("/changes/consolidated?escopo=1&entityType=CAVALO"),
      get("/changes/consolidated?escopo=1&entityType=CARRETA"),
    ]);

    expect(
      cavalo.body.totais.valueChanges + carreta.body.totais.valueChanges,
    ).toBe(tudo.body.totais.valueChanges);
  });

  it("a placa recorta a lista e os cartões juntos", async () => {
    const frota = await get("/frota/ativos?entityType=CAVALO");
    const placa = frota.body.ativos[0].plate as string;

    const res = await get(
      `/changes/consolidated?escopo=1&entityType=CAVALO&placa=${placa}&limit=500`,
    );

    // A promessa que um cartão faz quando está em cima de uma lista: os dois
    // falam da mesma população.
    expect(res.body.rows.every((r: any) => r.entityLabel === placa)).toBe(true);
    expect(res.body.totais.valueChanges).toBeLessThanOrEqual(res.body.total);
  });
});

describe("a placa em /impacto/quinzenas", () => {
  it("reduz a matriz ao ativo e recalcula o rodapé dele", async () => {
    const frota = await get("/frota/ativos?entityType=CAVALO");
    const placa = frota.body.ativos[0].plate as string;

    const inteira = await get("/impacto/quinzenas?entityType=CAVALO");
    const doAtivo = await get(`/impacto/quinzenas?entityType=CAVALO&placa=${placa}`);

    expect(doAtivo.body.plate).toBe(placa);
    expect(doAtivo.body.entities).toBe(1);
    expect(inteira.body.plate).toBeNull();

    const linhas = doAtivo.body.groups.flatMap((g: any) => g.rows);
    expect(linhas.map((l: any) => l.plate)).toEqual([placa]);

    // O rodapé é do ativo, e não da frota: filtrar as linhas depois de somadas
    // deixaria a tabela com uma linha e o total de 64 cavalos embaixo.
    const somaDaLinha = linhas[0].cells
      .filter((c: any) => c.state === "VALOR")
      .reduce((s: number, c: any) => s + c.value, 0);
    expect(doAtivo.body.grandTotal).toBeCloseTo(somaDaLinha, 2);
    expect(doAtivo.body.grandTotal).toBeLessThan(inteira.body.grandTotal);
  });

  it("volta à frota quando a placa não é deste equipamento, e diz que voltou", async () => {
    const carretas = await get("/frota/ativos?entityType=CARRETA");
    const daCarreta = carretas.body.ativos[0].plate as string;

    const res = await get(
      `/impacto/quinzenas?entityType=CAVALO&placa=${daCarreta}`,
    );

    // `plate: null` é o que impede o silêncio: a tela sabe que não está
    // mostrando o ativo pedido, em vez de exibir a frota sob o nome dele.
    expect(res.body.plate).toBeNull();
    expect(res.body.entities).toBeGreaterThan(1);
  });
});

/**
 * O panorama — a porta das telas 360°, e o único lugar onde três autoridades se
 * encontram.
 *
 * A rota junta por placa o que a Composição apura, o que a comparação contou e
 * o que os chamados pediram. O que estes casos protegem é que ela continue
 * **juntando** e não passe a calcular: o valor de cada card tem de ser byte a
 * byte o mesmo que `/composition/fleet` devolve para a mesma placa. No dia em
 * que os dois divergirem, a tela de Composição e a de Cavalo 360° passam a
 * mostrar duas remunerações para o mesmo cavalo — e nada na tela dirá qual é a
 * certa.
 */
describe("GET /frota/panorama", () => {
  it("traz um card por ativo, com as três leituras", async () => {
    const res = await get("/frota/panorama?entityType=CAVALO");
    expect(res.status).toBe(200);
    expect(res.body.ativos.length).toBeGreaterThan(0);
    expect(res.body.resumo.equipamentos).toBe(res.body.ativos.length);

    const comAlteracao = res.body.ativos.filter((a: any) => a.alteracoes > 0);
    expect(comAlteracao.length).toBeGreaterThan(0);
    // A história do ativo: o card diz o que mudou, não só quantas vezes.
    expect(comAlteracao[0].maiorAlteracao).not.toBeNull();
    expect(comAlteracao[0].maiorAlteracao.attributeCode).toMatch(/^cavalo\./);
  });

  it("dá a mesma remuneração que a Composição, placa a placa", async () => {
    const [panorama, composicao] = await Promise.all([
      get("/frota/panorama?entityType=CAVALO"),
      get("/composition/fleet?entityType=CAVALO"),
    ]);

    const daComposicao = new Map<string, number | null>(
      composicao.body.linhas.map((l: any) => [l.placa, l.mensal]),
    );
    expect(daComposicao.size).toBeGreaterThan(0);

    for (const ativo of panorama.body.ativos) {
      expect(daComposicao.get(ativo.placa)).toBe(ativo.mensal);
    }
    expect(panorama.body.resumo.mensalTotal).toBe(composicao.body.resumo.mensalTotal);
  });

  it("conta as alterações do mesmo período que a remuneração descreve", async () => {
    const panorama = await get("/frota/panorama?entityType=CAVALO");
    // O card diz "R$ X em agosto" e "N alterações": as duas frases têm de ser do
    // mesmo mês, ou o card mistura dois períodos sem dizer.
    expect(panorama.body.procedencia.comparacao.period).toBe(
      panorama.body.effectiveDate,
    );

    const escopado = await get("/changes/consolidated?escopo=1&entityType=CAVALO");
    const soma = panorama.body.ativos.reduce(
      (s: number, a: any) => s + a.alteracoes,
      0,
    );
    // A soma dos cards é a da comparação escopada, menos o que não tem placa —
    // então nunca a ultrapassa, e não é zero numa base que mudou.
    expect(soma).toBeGreaterThan(0);
    expect(soma).toBeLessThanOrEqual(escopado.body.totais.valueChanges);
  });

  it("recusa equipamento sem regra de remuneração em vez de mostrar cards vazios", async () => {
    const semTipo = await get("/frota/panorama");
    expect(semTipo.status).toBe(400);

    const semRegra = await get("/frota/panorama?entityType=REBOQUE");
    expect(semRegra.status).toBe(400);
    expect(semRegra.body.error).toContain("regra de remuneração");
  });
});
