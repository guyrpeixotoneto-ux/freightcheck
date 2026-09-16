import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha, planilhaPadrao } from "@workspace/ingest/testing/planilha";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { sql } from "drizzle-orm";
import { listContexts } from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest";
import { filtroDosEscopos } from "@workspace/qlp";

/**
 * `/qlp/administrativo*` — o contrato da superfície, sobre o pipeline real.
 *
 * O cálculo mora em `@workspace/qlp` e a comparação no motor canônico; o que se
 * protege aqui são os estados que a tela promete sustentar, na ordem em que
 * eles acontecem na vida real:
 *
 * 1. nenhum QLP importado — 404 que aponta o caminho, mesmo com vigência de
 *    equipamento no banco;
 * 2. uma vigência — quadro inteiro, agregações travadas com o motivo, porque
 *    todo atributo nasce UNKNOWN;
 * 3. curadoria confirma efetivo e despesa — as duas métricas destravam, e só
 *    elas;
 * 4. segunda vigência com quinzena pulada — o "anterior" é o anterior real da
 *    série, a quinzena que não existe é recusa nomeada, e o buraco fica visível
 *    na régua;
 * 5. alterações — cargo que entra, cargo que sai, quantidade e dinheiro que
 *    mudam, tudo pelo change-set canônico, com proveniência dos dois lados.
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

async function post(caminho: string, corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

async function importarQlp(arquivo: string): Promise<void> {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType: "QLP_ADMINISTRATIVO",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  expect(relatorio.blockingErrors).toBe(0);
  await promote(ctx.db, recebido.importRunId);
}

/**
 * O mesmo, para o quadro **operacional** — que entra na mesma família.
 *
 * Existe para escrever o fato herdado: o operacional da mesma quinzena entra
 * como revisão que herda os fatos do administrativo, e é essa revisão que
 * apagava a quarentena da aba de Inconsistências.
 */
async function importarQlpOperacional(arquivo: string): Promise<void> {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType: "QLP_OPERACIONAL",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  expect(relatorio.blockingErrors).toBe(0);
  await promote(ctx.db, recebido.importRunId);
}

/** As colunas de fato além das duas padrão — nomes reais do dicionário. */
const COLUNAS = [
  "Quantidade Ordenados",
  "Salário Ordenados",
  "Despesa Ordenados",
  "QLP Benchmark Quantidade",
];

/**
 * As colunas de benefício do quadro operacional, e o subtotal que elas somam.
 *
 * São as que ficavam fora do catálogo: o export as trazia, o acervo as guardava
 * e nenhuma tela as mostrava. Escritas aqui com os nomes reais do dicionário da
 * tabela de equipe.
 */
const COLUNAS_OPERACIONAL = [
  "pisoSalarial",
  "premiacaoProdutividade",
  "remuneracaoVariavel",
  "assistenciaMedica",
  "cafeDaManha",
  "cestaBasica",
  "ticketRefeicaoLiquido",
  "valeTransporteLiquido",
  "seguroDeVida",
  "pcmsoPorMes",
  "diaria",
  "plr",
  "totalBeneficioFixo",
];

/** Os benefícios de um cargo, e o subtotal que a soma deles tem de dar. */
const BENEFICIOS = {
  assistenciaMedica: 421.01,
  cafeDaManha: 0,
  cestaBasica: 200,
  ticketRefeicaoLiquido: 216.88,
  valeTransporteLiquido: 260.33,
  seguroDeVida: 5.21,
  pcmsoPorMes: 59.97,
  diaria: 1954.79,
  plr: 41.67,
};
const TOTAL_DOS_BENEFICIOS = Object.values(BENEFICIOS).reduce((a, b) => a + b, 0);

const cargoOperacional = (nome: string, turno: string) => ({
  placa: nome,
  turno,
  valores: {
    pisoSalarial: 2942.26,
    premiacaoProdutividade: 2815.45,
    remuneracaoVariavel: 4391.62,
    ...BENEFICIOS,
    totalBeneficioFixo: Number(TOTAL_DOS_BENEFICIOS.toFixed(2)),
  },
});

const planilhaOperacional = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_10_2026",
    abas: [
      {
        nome: "equipe mot",
        identificador: "cargoEquipeEmpurrada",
        colunas: COLUNAS_OPERACIONAL,
        linhas: [
          cargoOperacional("MOTORISTA 28", "EQUIPE ATIVA 8x16"),
          cargoOperacional("MOTORISTA 40", "EQUIPE ATIVA 12x36"),
        ],
      },
    ],
  });

const UNIDADE_B = "20.618.821/0007-99";
/** A terceira unidade existe só para o teste de escopo do fim do arquivo. */
const UNIDADE_C = "33.041.260/0652-90";

const cargo = (
  nome: string,
  valores: { qtd: number; salario: number; despesa: number; benchmark: number },
  unidadeCnpj?: string,
) => ({
  placa: nome,
  ...(unidadeCnpj ? { unidadeCnpj } : {}),
  valores: {
    "Quantidade Ordenados": valores.qtd,
    "Salário Ordenados": valores.salario,
    "Despesa Ordenados": valores.despesa,
    "QLP Benchmark Quantidade": valores.benchmark,
  },
});

const primeiraQuinzena = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      {
        nome: "TABELA DE QLP ADM",
        identificador: "Cargo",
        colunas: COLUNAS,
        linhas: [
          cargo("COORDENADOR ADM", { qtd: 1, salario: 9800, despesa: 9800, benchmark: 1 }),
          cargo("ANALISTA ADM", { qtd: 3, salario: 4600, despesa: 13800, benchmark: 2 }),
          cargo("AUXILIAR ADM", { qtd: 4, salario: 2400, despesa: 9600, benchmark: 4 }),
          cargo(
            "COORDENADOR ADM",
            { qtd: 1, salario: 10400, despesa: 10400, benchmark: 1 },
            UNIDADE_B,
          ),
        ],
      },
    ],
  });

/*
  A quinzena seguinte importada é a de **setembro**: a 2ª de agosto não existe
  de propósito, porque o buraco na régua é um dos estados que a tela promete
  mostrar. Entre as duas: o AUXILIAR sai da unidade A, um AUXILIAR entra na
  unidade B, e o ANALISTA da A perde efetivo (3→2) e despesa (13800→9200).
*/
const quinzenaDeSetembro = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_9_2026",
    abas: [
      {
        nome: "TABELA DE QLP ADM",
        identificador: "Cargo",
        colunas: COLUNAS,
        linhas: [
          cargo("COORDENADOR ADM", { qtd: 1, salario: 9800, despesa: 9800, benchmark: 1 }),
          cargo("ANALISTA ADM", { qtd: 2, salario: 4600, despesa: 9200, benchmark: 2 }),
          cargo(
            "COORDENADOR ADM",
            { qtd: 1, salario: 10400, despesa: 10400, benchmark: 1 },
            UNIDADE_B,
          ),
          cargo(
            "AUXILIAR ADM",
            { qtd: 1, salario: 2600, despesa: 2600, benchmark: 2 },
            UNIDADE_B,
          ),
        ],
      },
    ],
  });

/*
  A quinzena de outubro carrega o caso da quarentena por chave.

  O COORDENADOR da unidade A vem duas vezes, com salários que discordam — e é
  ele, e só ele, que fica de fora. As outras três linhas entram normalmente, que
  é a diferença que a quarentena existe para produzir: antes, este arquivo
  inteiro parava, e as três linhas boas não chegavam ao quadro.

  O AUXILIAR repetido **concordando** entra junto de propósito: consolidação e
  conflito têm de continuar se distinguindo, e uma repetição que concorda não
  pode acabar em quarentena.
*/
const quinzenaComConflito = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_10_2026",
    abas: [
      {
        nome: "TABELA DE QLP ADM",
        identificador: "Cargo",
        colunas: COLUNAS,
        linhas: [
          cargo("COORDENADOR ADM", { qtd: 1, salario: 9800, despesa: 9800, benchmark: 1 }),
          cargo("COORDENADOR ADM", { qtd: 1, salario: 11500, despesa: 11500, benchmark: 1 }),
          cargo("ANALISTA ADM", { qtd: 2, salario: 4600, despesa: 9200, benchmark: 2 }),
          cargo(
            "AUXILIAR ADM",
            { qtd: 1, salario: 2600, despesa: 2600, benchmark: 2 },
            UNIDADE_B,
          ),
          cargo(
            "AUXILIAR ADM",
            { qtd: 1, salario: 2600, despesa: 2600, benchmark: 2 },
            UNIDADE_B,
          ),
        ],
      },
    ],
  });

beforeAll(async () => {
  ctx = await createTestDatabase("api_qlp");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { default: qlpRouter } = await import("../qlp");
  const { default: changesRouter } = await import("../changes");
  const { default: curationRouter } = await import("../curation");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    // A curadoria assina pela sessão; nos testes a sessão é esta.
    (req as unknown as { user: unknown }).user = { email: "teste@freightcheck" };
    next();
  });
  app.use(qlpRouter);
  app.use(changesRouter);
  app.use(curationRouter);
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

/**
 * O par de agosto e setembro **da mesma unidade** — a que as fixtures povoaram.
 *
 * `/snapshots` responde pela família inteira, e um arquivo com duas unidades
 * produz duas vigências por data, com o mesmo rótulo e a mesma cobertura. Pegar
 * a primeira de cada data casaria CAMAÇARI com a outra unidade, que é o par que
 * o motor recusa por construção — e, pior, o par que o teste passaria a fazer
 * sem dizer. A unidade escolhida é a do quadro maior: é ela que as fixtures
 * enchem de cargos, e é sobre ela que as afirmações abaixo falam.
 */
async function parDaUnidadeMaior(): Promise<{ agosto: any; setembro: any }> {
  const { body } = await get("/snapshots?datasetFamily=QUADRO_DE_PESSOAL");
  const doQuadro = body.filter((v: any) => v.entityTypeSet === "QLP_ADMINISTRATIVO");
  const maior = (data: string) =>
    doQuadro
      .filter((v: any) => v.effectiveDate === data)
      .sort((a: any, b: any) => b.entityCount - a.entityCount)[0];
  const agosto = maior("2026-08-01");
  const setembro = doQuadro.find(
    (v: any) => v.effectiveDate === "2026-09-01" && v.scopeHash === agosto?.scopeHash,
  );
  expect(agosto && setembro).toBeTruthy();
  return { agosto, setembro };
}

describe("a superfície do QLP Administrativo, na ordem em que a vida acontece", () => {
  let entityIdDoAnalista = "";
  let changeSetId = "";

  it("sem QLP nenhum: 404 com a frase que aponta o caminho", async () => {
    const quadro = await get("/qlp/administrativo");
    expect(quadro.status).toBe(404);
    expect(quadro.body.error).toMatch(/QLP Administrativo/);

    const evolucao = await get("/qlp/administrativo/evolucao");
    expect(evolucao.status).toBe(404);

    const detalhe = await get(
      "/qlp/administrativo/entidades/00000000-0000-4000-8000-000000000000",
    );
    expect(detalhe.status).toBe(404);
  });

  it("vigência de equipamento não acende o quadro — o QLP tem família própria", async () => {
    const recebido = await receiveFile(ctx.db, { filePath: escreverPlanilha(planilhaPadrao()) });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    await promote(ctx.db, recebido.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    const quadro = await get("/qlp/administrativo");
    expect(quadro.status).toBe(404);
  });

  it("uma vigência: o quadro inteiro, com as agregações travadas e o motivo escrito", async () => {
    await importarQlp(primeiraQuinzena());

    const { status, body } = await get("/qlp/administrativo");
    expect(status).toBe(200);

    expect(body.effectiveDate).toBe("2026-08-01");
    expect(body.anterior).toBeNull();
    expect(body.vigencias.map((v: any) => v.effectiveDate)).toEqual(["2026-08-01"]);
    expect(body.vigencias[0].sourceLabels).toContain("EMPURRADA_1_8_2026");

    expect(body.resumo.cargos).toBe(4);
    expect(body.resumo.unidades).toBe(2);

    // Todo atributo nasce UNKNOWN: as duas métricas vêm sem valor e com o
    // motivo por extenso — nunca um zero.
    expect(body.resumo.efetivo.valor).toBeNull();
    expect(body.resumo.efetivo.motivo).toMatch(/curadoria/i);
    expect(body.resumo.custo.valor).toBeNull();
    expect(body.resumo.custo.motivo).toMatch(/Curadoria/);
    expect(body.resumo.curadoria.confirmados).toBe(0);
    expect(body.resumo.curadoria.total).toBe(11);

    const quantidade = body.atributos.find(
      (a: any) => a.code === "qlp_administrativo.quantidade_ordenados",
    );
    expect(quantidade.semantica.status).toBe("UNKNOWN");

    const unidadeA = body.unidades.find((u: any) => u.cnpj === "07526557001505");
    expect(unidadeA.cargos.map((c: any) => c.cargo)).toEqual([
      "ANALISTA ADM",
      "AUXILIAR ADM",
      "COORDENADOR ADM",
    ]);
    const analista = unidadeA.cargos.find((c: any) => c.cargo === "ANALISTA ADM");
    expect(analista.valores["qlp_administrativo.quantidade_ordenados"]).toBe(3);
    entityIdDoAnalista = analista.entityId;

    // Filtro estreita a lista, nunca o resumo.
    const filtrado = await get("/qlp/administrativo?busca=analista");
    expect(filtrado.body.resumo.cargos).toBe(4);
    const visiveis = filtrado.body.unidades.flatMap((u: any) => u.cargos);
    expect(visiveis).toHaveLength(1);
    expect(visiveis[0].cargo).toBe("ANALISTA ADM");

    const porUnidade = await get(`/qlp/administrativo?unidade=${UNIDADE_B}`);
    expect(porUnidade.body.unidades).toHaveLength(1);
    expect(porUnidade.body.unidades[0].cnpj).toBe("20618821000799");
  });

  /*
    A Auditoria lê a família do quadro — a regressão que este teste guarda.

    A rota lia por `getEntityTable`, que resolve o contexto no padrão do
    produto: a família de equipamento. Com a vigência de equipamento importada
    no teste acima — que é a situação de qualquer acervo real —, a data mais
    recente do contexto era a do cavalo, e esta tela vinha **vazia** com o QLP
    inteiro no banco; pedindo a quinzena do QLP por `?period=`, a resposta era
    404 sobre um acervo que tinha o arquivo. As duas metades estão aqui.
  */
  it("a auditoria confere as contas da vigência de QLP, e não a do equipamento", async () => {
    const { status, body } = await get("/qlp/auditoria?quadro=ADMINISTRATIVO");
    expect(status).toBe(200);
    expect(body.serieEntregue).toBe(true);
    /* A planilha sintética traz quatro das colunas do catálogo: as que ela
       traz têm de estar conhecidas, e as que ela não traz é que ficam sem
       base — é essa a partição que a tela mostra. */
    expect(body.colunasDesconhecidas).not.toContain(
      "qlp_administrativo.quantidade_ordenados",
    );
    expect(body.colunasDesconhecidas).toContain("qlp_administrativo.vale_transporte");
    expect(body.resumo.cargos).toBe(4);
    expect(body.resumo.conferem).toBe(4);
    expect(body.resumo.divergem).toBe(0);
    expect(body.linhas).toHaveLength(4);
    // O nome legível, e não a chave normalizada, é o que a tela lista.
    expect(body.linhas.map((l: any) => l.nome)).toContain(
      "07.526.557/0015-05 · ANALISTA ADM",
    );

    // A quinzena pedida é do QLP: pedi-la não pode virar "nada importado".
    const comPeriodo = await get("/qlp/auditoria?quadro=ADMINISTRATIVO&period=2026-08-01");
    expect(comPeriodo.status).toBe(200);
    expect(comPeriodo.body.resumo.cargos).toBe(4);

    // O operacional continua sem arquivo, e a resposta continua dizendo isso.
    const operacional = await get("/qlp/auditoria?quadro=OPERACIONAL");
    expect(operacional.status).toBe(404);
    expect(operacional.body.error).toMatch(/QLP Operacional/);
  });

  it("a ficha do cargo traz cada fato com a célula de origem, no mesmo pedido", async () => {
    const { status, body } = await get(
      `/qlp/administrativo/entidades/${entityIdDoAnalista}`,
    );
    expect(status).toBe(200);
    expect(body.cargo).toBe("ANALISTA ADM");
    expect(body.chaveLegivel).toContain(" · ");
    expect(body.presente).toBe(true);
    expect(body.atributos).toHaveLength(11);

    const despesa = body.atributos.find(
      (a: any) => a.code === "qlp_administrativo.despesa_ordenados",
    );
    expect(despesa.valor).toBe(13800);
    expect(despesa.origem.aba).toBe("TABELA DE QLP ADM");
    expect(despesa.origem.linha).toBeGreaterThan(1);
    expect(despesa.origem.coluna).toBeTruthy();
    expect(despesa.origem.valorBruto).toBe("13800");
    expect(despesa.origem.arquivo).toMatch(/\.xlsx$/);

    const invalido = await get("/qlp/administrativo/entidades/nao-e-uuid");
    expect(invalido.status).toBe(400);
  });

  it("confirmar a semântica na curadoria destrava exatamente o que foi confirmado", async () => {
    const efetivo = await post(
      "/curation/attributes/qlp_administrativo.quantidade_ordenados/confirm",
      { aggregation: "SUM", isMonetary: false, reason: "teste: efetivo reconhecido" },
    );
    expect(efetivo.status).toBe(200);

    const despesa = await post(
      "/curation/attributes/qlp_administrativo.despesa_ordenados/confirm",
      {
        unit: "BRL",
        periodicity: "MENSAL",
        aggregation: "SUM",
        isMonetary: true,
        reason: "teste: montante de ordenados",
      },
    );
    expect(despesa.status).toBe(200);

    const { body } = await get("/qlp/administrativo");
    expect(body.resumo.efetivo.valor).toBe(9); // 1 + 3 + 4 + 1
    expect(body.resumo.efetivo.motivo).toBeNull();
    expect(body.resumo.custo.valor).toBe(43600); // 9800 + 13800 + 9600 + 10400
    expect(body.resumo.custo.motivo).toBeNull();
    // O resto continua pendente, e a resposta diz isso.
    expect(body.resumo.apuracaoCompleta).toBe(false);
    expect(body.resumo.numericosPendentes).toBeGreaterThan(0);
    expect(body.resumo.curadoria.confirmados).toBe(2);
  });

  it("segunda vigência com quinzena pulada: anterior real, buraco visível, quinzena inexistente é recusa", async () => {
    await importarQlp(quinzenaDeSetembro());

    const { body } = await get("/qlp/administrativo");
    expect(body.effectiveDate).toBe("2026-09-01");
    expect(body.anterior).toBe("2026-08-01");
    // A 2ª quinzena de agosto não foi importada: a régua mostra só o que
    // existe, e o buraco é a data que falta entre as duas.
    expect(body.vigencias.map((v: any) => v.effectiveDate)).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);

    const antiga = await get("/qlp/administrativo?period=2026-08-01");
    expect(antiga.status).toBe(200);
    expect(antiga.body.effectiveDate).toBe("2026-08-01");

    const inexistente = await get("/qlp/administrativo?period=2026-08-15");
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toMatch(/2026-08-15/);
  });

  it("a evolução mostra a presença: quem saiu, quem entrou, e a janela recusa ponta que não existe", async () => {
    const { status, body } = await get("/qlp/administrativo/evolucao");
    expect(status).toBe(200);
    expect(body.vigencias.map((v: any) => v.effectiveDate)).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(body.vigencias.map((v: any) => v.cargos)).toEqual([4, 4]);

    const linha = (unidade: string, cargo: string) =>
      body.quadro.find(
        (q: any) => q.unidadeCnpj === unidade && q.cargo === cargo,
      );
    expect(linha("07526557001505", "AUXILIAR ADM").presencas).toEqual([true, false]);
    expect(linha("20618821000799", "AUXILIAR ADM").presencas).toEqual([false, true]);
    expect(linha("07526557001505", "ANALISTA ADM").presencas).toEqual([true, true]);

    const recortada = await get("/qlp/administrativo/evolucao?de=2026-09-01");
    expect(recortada.body.vigencias).toHaveLength(1);

    const invalida = await get("/qlp/administrativo/evolucao?de=2026-08-15");
    expect(invalida.status).toBe(400);
  });

  it("alterações saem do change-set canônico: entrada, saída, quantidade e dinheiro", async () => {
    /*
      A família é pedida, e não recortada depois: `/snapshots` responde pela de
      equipamento quando ninguém nomeia outra, e a tela do quadro nomeia a dela.
      Sem o parâmetro, esta lista volta vazia — que é a prova de que a leitura de
      placas parou de enxergar as quinzenas de cargos.
    */
    const semFamilia = await get("/snapshots");
    expect(
      semFamilia.body.filter((s: any) => s.entityTypeSet === "QLP_ADMINISTRATIVO"),
    ).toHaveLength(0);

    const snapshots = await get("/snapshots?datasetFamily=QUADRO_DE_PESSOAL");
    const doQuadro = snapshots.body.filter(
      (s: any) => s.entityTypeSet === "QLP_ADMINISTRATIVO",
    );
    /*
      Quatro, e não dois: **duas unidades × duas quinzenas**. O snapshot é
      particionado por `scope_hash`, e uma planilha com duas unidades forma uma
      série por unidade — o quadro da tela é que consolida as duas na leitura
      (ver `filtroDosEscopos`), e a comparação não consolida nada.

      Daí duas comparações, e não uma. O motor recusa-se a comparar escopos
      diferentes (`series.ts`), e é a recusa certa: "o AUXILIAR saiu da unidade
      A e entrou na B" não é uma alteração, são duas — uma saída na série de A e
      uma entrada na série de B. Uma comparação só, atravessando as duas, diria
      que a mesma pessoa mudou de unidade, que é uma afirmação que nem o arquivo
      nem o motor fazem.
    */
    expect(doQuadro).toHaveLength(4);

    const porEscopo = new Map<string, any[]>();
    for (const s of doQuadro) {
      porEscopo.set(s.scopeHash, [...(porEscopo.get(s.scopeHash) ?? []), s]);
    }
    expect([...porEscopo.values()].map((serie) => serie.length)).toEqual([2, 2]);

    const comparar = async (serie: any[]) => {
      const ordenada = [...serie].sort((a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate),
      );
      const criado = await post("/change-sets", {
        snapshotAId: ordenada[0].id,
        snapshotBId: ordenada[1].id,
      });
      expect(criado.status).toBeLessThan(300);
      return criado.body;
    };
    const comparacoes = [];
    for (const serie of porEscopo.values()) comparacoes.push(await comparar(serie));

    /*
      Qual é qual sai do que cada uma encontrou, e não da ordem do `scope_hash`:
      a série da unidade A perde o AUXILIAR, a da B o ganha.
    */
    const daUnidadeA = comparacoes.find((c) => c.entitiesRemoved === 1)!;
    const daUnidadeB = comparacoes.find((c) => c.entitiesAdded === 1)!;
    expect(daUnidadeA).toBeDefined();
    expect(daUnidadeB).toBeDefined();
    expect(daUnidadeA.id).not.toBe(daUnidadeB.id);
    expect(daUnidadeA.entitiesAdded).toBe(0);
    expect(daUnidadeB.entitiesRemoved).toBe(0);

    changeSetId = daUnidadeA.id;

    const entradas = await get(
      `/change-sets/${daUnidadeB.id}/changes?changeType=ENTITY_ADDED`,
    );
    expect(entradas.body.rows).toHaveLength(1);
    // O motor rotula a linha com a chave normalizada da entidade — a tradução
    // para o nome legível é da apresentação (`components/qlp/apresentacao.ts`),
    // e a dívida de gravar o rótulo cru está registrada em `lib/qlp`.
    expect(entradas.body.rows[0].entityLabel).toBe("20618821000799AUXILIARADM");
    expect(entradas.body.rows[0].entityType).toBe("QLP_ADMINISTRATIVO");

    const saidas = await get(
      `/change-sets/${changeSetId}/changes?changeType=ENTITY_REMOVED`,
    );
    expect(saidas.body.rows).toHaveLength(1);
    expect(saidas.body.rows[0].entityLabel).toBe("07526557001505AUXILIARADM");

    const quantidade = await get(
      `/change-sets/${changeSetId}/changes?attributeCode=qlp_administrativo.quantidade_ordenados`,
    );
    const mudancaDeQuadro = quantidade.body.rows.find(
      (r: any) => r.changeType === "VALUE_CHANGED",
    );
    expect(Number(mudancaDeQuadro.valueBefore)).toBe(3);
    expect(Number(mudancaDeQuadro.valueAfter)).toBe(2);

    const despesa = await get(
      `/change-sets/${changeSetId}/changes?attributeCode=qlp_administrativo.despesa_ordenados`,
    );
    const mudancaDeDinheiro = despesa.body.rows.find(
      (r: any) => r.changeType === "VALUE_CHANGED",
    );
    expect(Number(mudancaDeDinheiro.valueBefore)).toBe(13800);
    expect(Number(mudancaDeDinheiro.valueAfter)).toBe(9200);

    const proveniencia = await get(`/changes/${mudancaDeDinheiro.id}/provenance`);
    expect(proveniencia.status).toBe(200);
    expect(proveniencia.body.sheet_before ?? proveniencia.body.sheetBefore).toBeTruthy();
    expect(proveniencia.body.sheet_after ?? proveniencia.body.sheetAfter).toBeTruthy();
  });

  /*
    O sexto estado: a vigência que entrou incompleta.

    É o estado que a quarentena por chave criou, e o único em que o quadro pode
    estar certo sobre si mesmo e errado sobre a unidade — o cargo em conflito
    não aparece como faltando, ele simplesmente não aparece. Por isso as três
    afirmações abaixo andam juntas e nenhuma delas basta sozinha: o arquivo
    entrou, o quadro **diz** que está incompleto, e a evidência do que falta
    está onde alguém a encontra.
  */
  it("a vigência entra incompleta, e a tela sabe o que ficou de fora", async () => {
    await importarQlp(quinzenaComConflito());

    const quadro = await get("/qlp/administrativo?period=2026-10-01");
    expect(quadro.status).toBe(200);

    // 1. O arquivo entrou: as linhas que não conflitam estão no quadro.
    const unidadeA = quadro.body.unidades.find((u: any) => u.cnpj === "07526557001505");
    expect(unidadeA.cargos.map((c: any) => c.cargo)).toEqual(["ANALISTA ADM"]);
    // A repetição que **concorda** foi consolidada, não posta em quarentena.
    const unidadeB = quadro.body.unidades.find((u: any) => u.cnpj === "20618821000799");
    expect(unidadeB.cargos.map((c: any) => c.cargo)).toEqual(["AUXILIAR ADM"]);

    // 2. E o quadro diz que está incompleto, antes de qualquer contagem.
    expect(quadro.body.registrosFaltando).toBe(1);

    // 3. A evidência: a chave legível, as linhas da planilha e os dois valores.
    const { status, body } = await get("/qlp/administrativo/inconsistencias");
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.pendencias).toHaveLength(1);

    const vigencia = body.pendencias[0];
    expect(vigencia.vigenciaLabel).toBe("EMPURRADA_1_10_2026");
    expect(vigencia.registros).toHaveLength(1);

    const registro = vigencia.registros[0];
    expect(registro.code).toBe("ENTIDADE_DUPLICADA_CONFLITANTE");
    expect(registro.chave).toContain("COORDENADOR ADM");
    expect(registro.chave).toContain("07.526.557/0015-05");
    expect(registro.apresentacao.onde).toEqual([
      { aba: "TABELA DE QLP ADM", linhas: [2, 3] },
    ]);
    const salario = registro.apresentacao.diferencas.find(
      (d: any) => d.campo === "Salário Ordenados",
    );
    expect(salario.versoes.map((v: any) => v.valor)).toEqual(["9800", "11500"]);

    /*
      A fila é do contexto inteiro, e não da quinzena selecionada: pedir agosto
      continua devolvendo a pendência de outubro. Filtrá-la pelo seletor faria a
      aba parecer vazia justamente para quem abriu o produto na quinzena errada.
    */
    const deAgosto = await get("/qlp/administrativo/inconsistencias?period=2026-08-01");
    expect(deAgosto.body.effectiveDate).toBe("2026-08-01");
    expect(deAgosto.body.total).toBe(1);

    // E as vigências sem conflito continuam completas.
    const agosto = await get("/qlp/administrativo?period=2026-08-01");
    expect(agosto.body.registrosFaltando).toBe(0);
  });

  /*
    O fato herdado não pode apagar a quarentena.

    O operacional da mesma quinzena entra na mesma família e vira **revisão** da
    vigência do administrativo, herdando os fatos dele. A leitura das pendências
    partia do `import_run` da vigência viva — que passa a ser o do operacional,
    sem conflito nenhum —, e a aba anunciava "nenhum registro ficou de fora"
    sobre um quadro a que continuava faltando um cargo. O cargo não voltou; só
    a evidência de que ele falta é que tinha sumido.
  */
  it("o operacional entra na mesma vigência e o que ficou de fora continua visível", async () => {
    await importarQlpOperacional(planilhaOperacional());

    // O operacional entrou: a auditoria dele lê os dois cargos.
    const operacional = await get("/qlp/auditoria?quadro=OPERACIONAL&period=2026-10-01");
    expect(operacional.status).toBe(200);
    expect(operacional.body.linhas).toHaveLength(2);

    /*
      E as onze colunas chegam à tela, que é a metade que o catálogo sozinho não
      garante: uma coluna no catálogo e fora de toda conta continua invisível
      aqui, porque esta tela mostra o que as contas usam.
    */
    for (const slug of [
      "assistencia_medica",
      "cafe_da_manha",
      "cesta_basica",
      "ticket_refeicao_liquido",
      "vale_transporte_liquido",
      "seguro_de_vida",
      "pcmso_por_mes",
      "diaria",
      "plr",
      "premiacao_produtividade",
      "remuneracao_variavel",
    ]) {
      expect(
        operacional.body.colunasDesconhecidas,
        `${slug} chegou no arquivo e a tela precisa conhecê-la`,
      ).not.toContain(`qlp_operacional.${slug}`);
    }

    // E a conta dos benefícios fecha nos dois cargos, com as nove parcelas.
    const beneficios = operacional.body.contas.find(
      (c: any) => c.conta === "total_beneficio_fixo",
    );
    expect(beneficios.linhas).toBe(2);
    expect(beneficios.conferem).toBe(2);
    expect(beneficios.divergem).toBe(0);
    const primeira = operacional.body.linhas[0].contas.find(
      (c: any) => c.conta === "total_beneficio_fixo",
    );
    expect(primeira.esperado).toBe(Number(TOTAL_DOS_BENEFICIOS.toFixed(2)));
    expect(primeira.confere).toBe(true);

    // E a pendência do administrativo continua onde alguém a encontra.
    const quadro = await get("/qlp/administrativo?period=2026-10-01");
    expect(quadro.body.registrosFaltando).toBe(1);

    const { body } = await get("/qlp/administrativo/inconsistencias");
    expect(body.total).toBe(1);
    expect(body.pendencias[0].vigenciaLabel).toBe("EMPURRADA_1_10_2026");
    expect(body.pendencias[0].registros[0].chave).toContain("COORDENADOR ADM");
  });

  /*
    A comparação por cargo — o recorte de rubrica aplicado ao quadro.

    Ela substituiu a aba de Alterações, que mostrava o diff genérico do motor.
    A comparação é a mesma — mesmo `change_set` — e o que muda é o grão: uma
    linha por cargo e variável, com o estado de cada uma. O par usado aqui é o
    que as fixtures já descrevem: entre a 1ª de agosto e a 1ª de setembro, o
    AUXILIAR sai da unidade A, um AUXILIAR entra na B, e o ANALISTA da A perde
    efetivo (3→2) e despesa (13.800→9.200).
  */
  it("a comparação por cargo lê o par do quadro, com o efetivo e sem impacto em reais", async () => {
    const { agosto, setembro } = await parDaUnidadeMaior();

    const { status, body } = await get(
      `/qlp/comparacao?quadro=ADMINISTRATIVO&base=${agosto.id}&comparada=${setembro.id}`,
    );
    expect(status).toBe(200);

    // O grão: uma linha por cargo e variável, e o cargo legível no dicionário.
    const doAnalista = body.linhas.filter((l: any) =>
      (body.rotulos[l.entityLabel] ?? "").includes("ANALISTA ADM"),
    );
    const efetivo = doAnalista.find(
      (l: any) => l.attributeCode === "qlp_administrativo.quantidade_ordenados",
    );
    expect(efetivo.base).toBe("3");
    expect(efetivo.comparada).toBe("2");
    expect(efetivo.estado).toBe("ALTERADO");
    expect(efetivo.papel).toBe("QUANTIDADE");

    const despesa = doAnalista.find(
      (l: any) => l.attributeCode === "qlp_administrativo.despesa_ordenados",
    );
    expect(despesa.diferenca).toBe(-4600);
    expect(despesa.medida).toBe("DINHEIRO");

    /*
      Quem entrou e quem saiu, contado do acervo e não da lista — e contado
      **desta** unidade. O AUXILIAR que entrou entrou na outra, que forma par
      próprio: uma comparação é de uma unidade só, e somar as duas aqui seria
      responder por um escopo que este par não abriu.
    */
    expect(body.resumo.novosNaVigencia).toBe(0);
    expect(body.resumo.ausentesNaComparada).toBe(1);

    /*
      A única soma é a do efetivo, e ela fecha: −1 do ANALISTA (3→2) e −4 do
      AUXILIAR que saiu do quadro desta unidade.
    */
    expect(body.resumo.efetivo.diferenca).toBe(-5);

    // E o cartão que as outras seis mostram em reais aqui é uma frase.
    expect(body.resumo).not.toHaveProperty("impacto");
    expect(body.resumo.semImpactoFinanceiro).toMatch(/curadoria/i);

    // As fatias da rosca somam os cargos comparados, nunca mais do que eles.
    const soma = body.distribuicaoPorEstado.reduce(
      (total: number, f: any) => total + f.cargos,
      0,
    );
    expect(soma).toBe(body.resumo.cargosComparados);
  });

  /*
    O recorte por rubrica — o que sustenta uma leitura por assunto.

    O administrativo traz benefício numa coluna só e o operacional o decompõe em
    saúde, refeição, transporte e o resto: pedir "saúde" no administrativo é
    pergunta sem resposta, e a recusa escrita é o que impede uma tela vazia de
    parecer "nada mudou".
  */
  it("recorta a comparação por rubrica, e recusa por escrito a que o quadro não tem", async () => {
    const { agosto, setembro } = await parDaUnidadeMaior();
    const par = `base=${agosto.id}&comparada=${setembro.id}`;

    /*
      A rubrica do trio de ordenados chama-se `salario`, que é o nome que o
      operacional usa: é a mesma pergunta nas duas alturas do quadro, e um
      recorte por assunto que mudasse de nome conforme o quadro obrigaria quem
      lê a traduzir entre os dois. A **conta** continua sendo "Ordenados".
    */
    const ordenados = await get(
      `/qlp/comparacao?quadro=ADMINISTRATIVO&rubrica=salario&${par}`,
    );
    expect(ordenados.status).toBe(200);
    expect(ordenados.body.rubrica).toBe("salario");
    /*
      As linhas de atributo são todas da rubrica pedida. As de **cargo** — quem
      entrou e quem saiu — não citam atributo e não têm rubrica: elas vêm em
      qualquer recorte de propósito, porque um cargo que entrou entra com o
      assunto todo, e é o mesmo que as seis auditorias de rubrica fazem com o
      ativo que chega.
    */
    expect(
      ordenados.body.linhas.every(
        (l: any) => l.rubrica === "salario" || l.variavel === "cargo",
      ),
    ).toBe(true);
    expect(
      ordenados.body.linhas.some((l: any) => l.rubrica === "salario"),
    ).toBe(true);

    const inexistente = await get(
      `/qlp/comparacao?quadro=ADMINISTRATIVO&rubrica=saude&${par}`,
    );
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toMatch(/não tem a rubrica/);
  });

  /*
    A fronteira da leitura consolidada.

    O quadro atravessa unidades de propósito — é o que `resumo.unidades` prova
    lá em cima. O risco que isso cria é o oposto do defeito que corrigiu: uma
    consulta que trocasse o `scope_hash` único por "toda a família" passaria a
    mostrar unidade que quem lê não deveria enxergar, e o sintoma seria dado a
    mais, que ninguém estranha.

    Por isso o filtro não é removido, é **trocado pelo conjunto autorizado**
    (`filtroDosEscopos`). Este teste é a prova de que o conjunto manda: com uma
    terceira unidade no acervo e fora da lista, ela não entra no resultado.
  */
  it("a leitura consolidada não atravessa escopo fora do conjunto autorizado", async () => {
    await importarQlp(
      escreverPlanilha({
        vigencia: "EMPURRADA_1_11_2026",
        abas: [
          {
            nome: "TABELA DE QLP ADM",
            identificador: "Cargo",
            colunas: COLUNAS,
            linhas: [
              cargo("COORDENADOR ADM", { qtd: 1, salario: 9800, despesa: 9800, benchmark: 1 }),
              cargo(
                "COORDENADOR ADM",
                { qtd: 1, salario: 12000, despesa: 12000, benchmark: 1 },
                UNIDADE_C,
              ),
            ],
          },
        ],
      }),
    );

    const contextos = await listContexts(ctx.db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    });
    expect(contextos.length).toBe(3);

    const escoposDe = async (autorizados: typeof contextos) => {
      const { rows } = await ctx.db.execute<{ scope_hash: string }>(sql`
        SELECT DISTINCT s.scope_hash
          FROM snapshot s
         WHERE s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
           AND ${filtroDosEscopos("s", autorizados)}
      `);
      return new Set(rows.map((r) => r.scope_hash));
    };

    const deFora = contextos[2]!;
    const autorizados = [contextos[0]!, contextos[1]!];

    const alcancados = await escoposDe(autorizados);
    expect(alcancados).toEqual(
      new Set(autorizados.map((c) => c.scopeHash)),
    );
    expect(alcancados.has(deFora.scopeHash)).toBe(false);

    /*
      E o conjunto vazio não degenera em "tudo": um filtro que virasse verdadeiro
      sem autorização nenhuma varreria o acervo inteiro, que é o pior desfecho
      possível para esta troca.
    */
    expect(await escoposDe([])).toEqual(new Set());
  }, 120_000);
});

/**
 * `GET /qlp/candidatos` — o que cada candidata a "De" produz contra o "Para".
 *
 * As outras seis rotas de candidatas escrevem dinheiro e contagem ao lado de
 * cada vigência do menu. Esta escreve só a contagem, e o que se protege aqui é
 * exatamente a diferença: o QLP **não mede** dinheiro, e a linha do menu não
 * pode dizer `R$ 0,00` sobre uma conta que ninguém fez. É a mesma mentira por
 * omissão que `numeros: null` evita do outro lado, com o sinal trocado.
 *
 * As promessas comuns às sete — a lista é da série do destino, o número é do
 * par, ausência nunca vira zero — continuam valendo, e as duas primeiras são o
 * que os dois recortes desta rota (família e tipo de entidade) existem para
 * sustentar.
 */
describe("GET /qlp/candidatos", () => {
  it("exige o quadro e a vigência de destino", async () => {
    expect((await get("/qlp/candidatos")).status).toBe(400);
    expect((await get("/qlp/candidatos?quadro=ADMINISTRATIVO")).status).toBe(400);
    const { setembro } = await parDaUnidadeMaior();
    expect((await get(`/qlp/candidatos?para=${setembro.id}`)).status).toBe(400);
  }, 120_000);

  /**
   * A promessa desta rota, e a razão de ela existir separada das outras seis.
   *
   * `baldes` vazio **com** a frase do porquê. Sem a frase, o cliente escreveria
   * `R$ 0,00` — e `numerosDaLinha` só sabe calar a coluna do dinheiro porque
   * este campo desce.
   */
  it("não publica dinheiro, e diz por quê em vez de escrever zero", async () => {
    const { setembro } = await parDaUnidadeMaior();
    const { status, body } = await get(
      `/qlp/candidatos?quadro=ADMINISTRATIVO&para=${setembro.id}`,
    );

    expect(status).toBe(200);
    const comNumero = body.candidatos.filter((c: any) => c.numeros !== null);
    expect(comNumero.length).toBeGreaterThan(0);

    for (const c of comNumero) {
      expect(c.numeros.impacto.baldes).toEqual([]);
      expect(c.numeros.semImpacto).toContain("sem semântica confirmada");
      expect(typeof c.numeros.alteracoes).toBe("number");
    }
  }, 120_000);

  /**
   * O recorte por família: a lista sai do acervo do quadro, e não do de frete.
   *
   * Sem `datasetFamily`, `candidatasDoPar` listaria as vigências de frete,
   * nenhuma formaria par com o "Para" do quadro, e o menu viria vazio na tela
   * que mostra oito vigências. Um menu vazio é indistinguível de "não há com o
   * que comparar", que é a resposta errada dita com a cara da certa.
   */
  it("as candidatas são vigências do quadro, da mesma unidade e cobertura", async () => {
    const { agosto, setembro } = await parDaUnidadeMaior();
    const { body } = await get(
      `/qlp/candidatos?quadro=ADMINISTRATIVO&para=${setembro.id}`,
    );

    expect(body.candidatos.length).toBeGreaterThan(0);
    expect(body.candidatos.some((c: any) => c.id === agosto.id)).toBe(true);

    const { body: todas } = await get("/snapshots?datasetFamily=QUADRO_DE_PESSOAL");
    const porId = new Map(todas.map((v: any) => [v.id, v]));
    for (const c of body.candidatos) {
      const v: any = porId.get(c.id);
      expect(v, `candidata ${c.id} não é do quadro`).toBeDefined();
      expect(v.scopeHash).toBe(setembro.scopeHash);
      expect(v.entityTypeSet).toBe(setembro.entityTypeSet);
      expect(c.id).not.toBe(setembro.id);
    }
  }, 120_000);

  /**
   * O número do menu é o mesmo de `/qlp/comparacao` para aquele par.
   *
   * A prova de que o menu não abre uma segunda régua. Vale para o quadro
   * inteiro e vale recortado por rubrica — e é o recorte que importa: com a
   * tela em "refeição", um menu que contasse o quadro inteiro prometeria
   * alterações que o clique não mostraria.
   */
  it("a contagem do menu bate com a comparação, com e sem rubrica", async () => {
    const { agosto, setembro } = await parDaUnidadeMaior();

    /* `ordenados` existe no quadro administrativo (`rubricasDoQuadro`). Uma
       rubrica inventada aqui faria o caso passar sem nunca exercitar o recorte,
       que é justamente o que ele existe para exercitar. */
    for (const recorte of ["", "&rubrica=ordenados"]) {
      const { status, body } = await get(
        `/qlp/candidatos?quadro=ADMINISTRATIVO&para=${setembro.id}${recorte}`,
      );
      expect(status, `recorte "${recorte}"`).toBe(200);

      const candidata = body.candidatos.find((c: any) => c.id === agosto.id);
      expect(candidata?.numeros, `recorte "${recorte}"`).not.toBeNull();

      const { body: comparacao } = await get(
        `/qlp/comparacao?quadro=ADMINISTRATIVO&base=${agosto.id}&comparada=${setembro.id}${recorte}`,
      );
      expect(candidata.numeros.alteracoes, `recorte "${recorte}"`).toBe(
        comparacao.resumo.variaveisAlteradas,
      );
    }
  }, 300_000);

  /** A recusa escrita do recorte — pergunta sem resposta, e não resposta zero. */
  it("recusa uma rubrica que o quadro não tem", async () => {
    const { setembro } = await parDaUnidadeMaior();
    const { status } = await get(
      `/qlp/candidatos?quadro=ADMINISTRATIVO&para=${setembro.id}&rubrica=inexistente`,
    );
    expect(status).toBe(404);
  }, 120_000);

  /** Ausência de cálculo é `null`, e `pendentes` conta exatamente essas. */
  it("ausência de cálculo é null, e nunca um zero inventado", async () => {
    const { setembro } = await parDaUnidadeMaior();
    const { body } = await get(
      `/qlp/candidatos?quadro=ADMINISTRATIVO&para=${setembro.id}`,
    );

    const semNumero = body.candidatos.filter((c: any) => c.numeros === null).length;
    expect(body.pendentes).toBe(semNumero);
  }, 120_000);
});
