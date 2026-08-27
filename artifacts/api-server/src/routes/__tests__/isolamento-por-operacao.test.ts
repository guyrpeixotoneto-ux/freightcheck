import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { computeMissingChangeSets } from "@workspace/comparison";

/**
 * **A prova de que uma auditoria não enxerga o acervo da outra.**
 *
 * As quatro auditorias — Empurrada, Rota, AS e Apoio — são o mesmo produto
 * sobre acervos diferentes (`lib/ambiente.ts`, no cliente). O que as separa no
 * banco é `snapshot.canal`: a coluna que a `0015` derivou do rótulo da vigência
 * (`EMPURRADA_1_8_2026` → `EMPURRADA`), que é `NOT NULL`, não admite vazio e
 * compõe `canonical_snapshot_key`. Do lado da leitura, quem carrega esse recorte
 * é `?operacao=` — carimbado pelo cliente em toda chamada (`lib/api.ts`) e
 * honrado aqui.
 *
 * Este arquivo existe porque "a gente filtra" não é uma garantia: são mais de
 * cem rotas, e a que esquecesse o recorte mostraria os números da empurrada
 * dentro do ambiente de rota **sem erro nenhum na tela** — a forma mais cara de
 * uma regressão aparecer, porque o número parece certo.
 *
 * Por isso o banco daqui é **deliberadamente misturado**: a mesma unidade
 * (`scope_hash`), nas mesmas datas, entregando empurrada e rota, com valores
 * diferentes de propósito para que qualquer soma cruzada apareça como número —
 * e não como lista fora de ordem. Cada caso abaixo é uma tela da cadeia da
 * auditoria, pedida como o ambiente de Rota a pede.
 *
 * ---------------------------------------------------------------------------
 * O desenho do acervo misturado
 * ---------------------------------------------------------------------------
 *
 *   unidade única (mesmo scope_hash) — é o caso difícil, não o fácil:
 *   duas unidades separadas se distinguiriam pelo escopo mesmo sem operação.
 *
 *   EMPURRADA   jan: 1.000  →  fev: 1.200   (uma alteração, +200/mês)
 *   ROTA        jan: 5.000  →  fev: 4.000   (uma alteração, −1.000/mês)
 *
 * Os dois pares existem, foram comparados, e nenhum número de um pode aparecer
 * na leitura do outro.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

/** A unidade — uma só, para as duas operações. É o que torna o teste difícil. */
const UNIDADE = "scope-isolamento";

const CUSTO: AttributeSpec[] = [
  {
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const TRECHO: AttributeSpec[] = [
  {
    code: "trecho.valor_frete",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const JANEIRO = "2026-01-02";
const FEVEREIRO = "2026-02-02";
/** As duas datas do trecho — próprias, pela razão escrita na fixture dele. */
const MARCO = "2026-03-02";
const ABRIL = "2026-04-02";

/** As placas de cada operação — nenhuma se repete, para o ativo também provar. */
const PLACA_EMPURRADA = "EMP1A11";
const PLACA_ROTA = "ROT2B22";

interface Resposta {
  status: number;
  body: any;
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** O mesmo caminho, nas duas operações — o par que quase todo caso compara. */
async function nasDuas(caminho: string): Promise<{ rota: Resposta; empurrada: Resposta }> {
  const juntor = caminho.includes("?") ? "&" : "?";
  return {
    rota: await get(`${caminho}${juntor}operacao=ROTA`),
    empurrada: await get(`${caminho}${juntor}operacao=EMPURRADA`),
  };
}

/** O JSON inteiro como texto — para procurar por um rótulo que não pode estar lá. */
const texto = (corpo: unknown) => JSON.stringify(corpo);

let idsEmpurrada: Record<string, string> = {};
let idsRota: Record<string, string> = {};

beforeAll(async () => {
  ctx = await createTestDatabase("api_isolamento_operacao");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  await seedTaxonomy(ctx.db, "test");

  const empurrada = await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_1_2026",
        effectiveDate: JANEIRO,
        data: { [PLACA_EMPURRADA]: { "carreta.custo_fixo": 1000 } },
      },
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: FEVEREIRO,
        data: { [PLACA_EMPURRADA]: { "carreta.custo_fixo": 1200 } },
      },
    ],
    /*
      `canal` explícito e igual ao que o rótulo declara — como o banco de
      verdade faz (`freightcheck_canal_do_rotulo`). Sem isso a fixture teria uma
      coluna dizendo uma operação e um rótulo dizendo outra, e o teste estaria
      provando algo que a produção não faz.
    */
    { entityType: "CARRETA", scopeHash: UNIDADE, canal: "EMPURRADA" },
  );

  const rota = await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "ROTA_2_1_2026",
        effectiveDate: JANEIRO,
        data: { [PLACA_ROTA]: { "carreta.custo_fixo": 5000 } },
      },
      {
        label: "ROTA_2_2_2026",
        effectiveDate: FEVEREIRO,
        data: { [PLACA_ROTA]: { "carreta.custo_fixo": 4000 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE, canal: "ROTA" },
  );

  /*
    O trecho entra nas duas operações porque o Radar de Trechos é uma tela da
    cadeia — e porque ele é o caso em que a vigência tem outro `entity_type_set`
    e outra série: um recorte que funcionasse só para a carreta poderia falhar
    justamente aqui.
  */
  await buildFixture(
    ctx.db,
    TRECHO,
    [
      /*
        Datas próprias, e não as do equipamento: a identidade canônica de uma
        vigência é (sistema, família, canal, data, escopo), e o trecho aqui é
        escrito direto na camada canônica, sem passar pelo `promote` que funde
        componentes da mesma data. Reusar janeiro faria a fixture colidir com a
        vigência de carreta — o banco recusa, e com razão.
      */
      {
        label: "EMPURRADA_2_3_2026",
        effectiveDate: MARCO,
        data: { "SP-CAMACARI": { "trecho.valor_frete": 700 } },
      },
      {
        label: "EMPURRADA_2_4_2026",
        effectiveDate: ABRIL,
        data: { "SP-CAMACARI": { "trecho.valor_frete": 900 } },
      },
    ],
    { entityType: "TRECHO", scopeHash: UNIDADE, canal: "EMPURRADA" },
  );

  await buildFixture(
    ctx.db,
    TRECHO,
    [
      {
        label: "ROTA_2_3_2026",
        effectiveDate: MARCO,
        data: { "RJ-JAGUARIUNA": { "trecho.valor_frete": 300 } },
      },
      {
        label: "ROTA_2_4_2026",
        effectiveDate: ABRIL,
        data: { "RJ-JAGUARIUNA": { "trecho.valor_frete": 250 } },
      },
    ],
    { entityType: "TRECHO", scopeHash: UNIDADE, canal: "ROTA" },
  );

  idsEmpurrada = empurrada.snapshotIds;
  idsRota = rota.snapshotIds;

  await computeMissingChangeSets(ctx.db, "test");

  const { default: changesRouter } = await import("../changes");
  const { default: gerencialRouter } = await import("../gerencial");
  const { default: overviewRouter } = await import("../overview");
  const { default: impactoRouter } = await import("../impacto");
  const { default: frotaRouter } = await import("../frota");
  const { default: dreRouter } = await import("../dre");
  const { default: composicaoRouter } = await import("../composition");
  const { default: coverageRouter } = await import("../coverage");
  const { default: justificativasRouter } = await import("../justificativas");
  const { default: trechosRouter } = await import("../trechos");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(gerencialRouter);
  app.use(overviewRouter);
  app.use(changesRouter);
  app.use(impactoRouter);
  app.use(frotaRouter);
  app.use(dreRouter);
  app.use(composicaoRouter);
  app.use(coverageRouter);
  app.use(justificativasRouter);
  app.use(trechosRouter);
  app.use(erroEmJson);

  await new Promise<void>((resolve) => {
    servidor = app.listen(0, () => resolve());
  });
  const addr = servidor.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 300_000);

/*
  O encerramento segue o de `frota-360.test.ts`, e o motivo é o mesmo: com a
  suíte inteira rodando em paralelo, `DROP DATABASE` espera por conexões que o
  pool do processo ainda segura, e o hook estoura o teto padrão de 10s. Fechar
  as conexões abertas, derrubar o que sobrou e dropar com FORCE é o que torna o
  desligamento independente da carga da máquina.
*/
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

/*
  ---------------------------------------------------------------------------
  1. Vigências — a porta de tudo
  ---------------------------------------------------------------------------
*/
describe("as vigências", () => {
  it("lista, no seletor de contexto, só as unidades da operação aberta", async () => {
    const { rota, empurrada } = await nasDuas("/contexts");

    expect(rota.body.map((c: any) => c.channel)).toEqual(["ROTA"]);
    expect(empurrada.body.map((c: any) => c.channel)).toEqual(["EMPURRADA"]);
    /* A unidade é a mesma nas duas — é a operação que separa, não o escopo. */
    expect(rota.body[0].scopeHash).toBe(empurrada.body[0].scopeHash);
  });

  it("não devolve nenhuma vigência de empurrada na Visão Gerencial da rota", async () => {
    const { rota, empurrada } = await nasDuas("/gerencial/vigencias");

    expect(rota.body.map((v: any) => v.sourceLabel).sort()).toEqual([
      "ROTA_2_1_2026",
      "ROTA_2_2_2026",
    ]);
    expect(texto(rota.body)).not.toContain("EMPURRADA");
    expect(texto(empurrada.body)).not.toContain("ROTA_");
  });

  it("não oferece, em Comparar, uma vigência da outra operação", async () => {
    const { rota, empurrada } = await nasDuas("/snapshots");

    expect(rota.body.map((s: any) => s.sourceLabel).sort()).toEqual([
      "ROTA_2_1_2026",
      "ROTA_2_2_2026",
      "ROTA_2_3_2026",
      "ROTA_2_4_2026",
    ]);
    expect(texto(rota.body)).not.toContain("EMPURRADA");
    expect(texto(empurrada.body)).not.toContain("ROTA_");
  });
});

/*
  ---------------------------------------------------------------------------
  2. Alterações e comparações
  ---------------------------------------------------------------------------
*/
describe("as alterações", () => {
  it("conta, em /changes/latest, só a alteração da operação aberta", async () => {
    const { rota, empurrada } = await nasDuas("/changes/latest");

    expect(rota.status).toBe(200);
    expect(texto(rota.body)).not.toContain("EMPURRADA");
    expect(texto(empurrada.body)).not.toContain("ROTA_");

    /*
      O valor é a prova mais direta. A série mais recente de cada operação é a de
      trecho (abril): 300 → 250 na rota, 700 → 900 na empurrada. Um vazamento
      apareceria como o número do outro lado, e é isso que a segunda linha
      recusa.
    */
    /*
      O impacto é a prova mais direta, e ele é lido do campo — não procurado no
      texto da resposta. A série mais recente de cada operação é a de trecho
      (abril): 300 → 250 na rota, −R$ 50/mês; 700 → 900 na empurrada,
      +R$ 200/mês. Um vazamento apareceria como o número do outro lado.
    */
    expect(rota.body.set.snapshotBLabel).toBe("ROTA_2_4_2026");
    expect(rota.body.set.impacto.oficial).toEqual({ MENSAL: -50 });
    expect(empurrada.body.set.snapshotBLabel).toBe("EMPURRADA_2_4_2026");
    expect(empurrada.body.set.impacto.oficial).toEqual({ MENSAL: 200 });
  });

  it("lista, em /change-sets, só as comparações da operação aberta", async () => {
    const { rota, empurrada } = await nasDuas("/change-sets");

    /* Duas de cada lado: a de equipamento (fevereiro) e a de trecho (abril). */
    expect(rota.body.map((c: any) => c.snapshot_b_label).sort()).toEqual([
      "ROTA_2_2_2026",
      "ROTA_2_4_2026",
    ]);
    expect(empurrada.body.map((c: any) => c.snapshot_b_label).sort()).toEqual([
      "EMPURRADA_2_2_2026",
      "EMPURRADA_2_4_2026",
    ]);
  });

  it("recusa a comparação da outra operação, pedida pelo id", async () => {
    const comparacoes = await get("/change-sets?operacao=EMPURRADA");
    const daEmpurrada = comparacoes.body[0].id as string;

    const alheia = await get(`/change-sets/${daEmpurrada}/changes?operacao=ROTA`);
    expect(alheia.status).toBe(404);
    expect(alheia.body.error).toContain("EMPURRADA");

    /* E continua abrindo no ambiente a que ela pertence. */
    const propria = await get(`/change-sets/${daEmpurrada}/changes?operacao=EMPURRADA`);
    expect(propria.status).toBe(200);
  });

  it("recusa o par de vigências da outra operação", async () => {
    const a = idsEmpurrada["EMPURRADA_2_1_2026"];
    const b = idsEmpurrada["EMPURRADA_2_2_2026"];

    expect((await get(`/change-sets/pair/${a}/${b}?operacao=ROTA`)).status).toBe(404);
    expect((await get(`/change-sets/pair/${a}/${b}?operacao=EMPURRADA`)).status).toBe(200);
  });
});

/*
  ---------------------------------------------------------------------------
  3. Famílias, impacto e a home — as agregações que alimentam cards e gráficos
  ---------------------------------------------------------------------------
*/
describe("as agregações", () => {
  it("soma, nas famílias da vigência, só o impacto da operação aberta", async () => {
    const { rota, empurrada } = await nasDuas(`/changes/families?period=${FEVEREIRO}`);

    expect(rota.status).toBe(200);
    expect(texto(rota.body)).not.toContain("EMPURRADA");
    expect(texto(empurrada.body)).not.toContain("ROTA_");
  });

  it("soma, na Visão Geral por competência, só as unidades da operação aberta", async () => {
    const { rota } = await nasDuas(`/changes/families/overview?period=${FEVEREIRO}`);

    expect(rota.status).toBe(200);
    expect(texto(rota.body)).not.toContain("EMPURRADA");
  });

  it("não deixa o impacto de uma operação entrar na matriz de quinzenas da outra", async () => {
    const { rota, empurrada } = await nasDuas("/impacto/quinzenas");

    expect(rota.status).toBe(200);
    expect(texto(rota.body)).not.toContain("EMPURRADA");
    expect(texto(empurrada.body)).not.toContain("ROTA_");
  });

  it("responde, na home, com o retrato da operação aberta — e não com a soma das duas", async () => {
    const { rota, empurrada } = await nasDuas("/overview");
    const ambas = await get("/overview");

    /*
      Quatro vigências em cada operação — duas de equipamento e duas de trecho —
      e oito no acervo. O número do ambiente nunca é o do acervo, e a soma dos
      dois é que fecha com ele: é a forma mais direta de dizer que nada foi
      contado duas vezes nem escondido.
    */
    expect(Number(rota.body.totals.vigencias)).toBe(4);
    expect(Number(empurrada.body.totals.vigencias)).toBe(4);
    expect(Number(ambas.body.totals.vigencias)).toBe(8);

    /* Dois ativos em cada operação (uma placa e um trecho); quatro no acervo. */
    expect(Number(rota.body.totals.ativos)).toBe(2);
    expect(Number(empurrada.body.totals.ativos)).toBe(2);
    expect(Number(ambas.body.totals.ativos)).toBe(4);

    /* Duas comparações de cada lado — a de equipamento e a de trecho. */
    expect(Number(rota.body.totals.comparacoes)).toBe(2);
    expect(Number(ambas.body.totals.comparacoes)).toBe(4);

    /* E duas alterações de cada lado: a soma nunca aparece dentro de um ambiente. */
    expect(Number(rota.body.totals.alteracoes)).toBe(2);
    expect(Number(empurrada.body.totals.alteracoes)).toBe(2);
    expect(Number(ambas.body.totals.alteracoes)).toBe(4);
  });
});

/*
  ---------------------------------------------------------------------------
  4. Frota, DRE e cobertura — o ativo e o dinheiro dele
  ---------------------------------------------------------------------------
*/
describe("a frota e a DRE", () => {
  it("não mostra, na grade de ativos, uma placa da outra operação", async () => {
    const { rota, empurrada } = await nasDuas("/frota/ativos?entityType=CARRETA");

    expect(texto(rota.body)).toContain(PLACA_ROTA);
    expect(texto(rota.body)).not.toContain(PLACA_EMPURRADA);
    expect(texto(empurrada.body)).toContain(PLACA_EMPURRADA);
    expect(texto(empurrada.body)).not.toContain(PLACA_ROTA);
  });

  it("recusa a ficha do ativo que não aparece na operação aberta", async () => {
    /*
      O ativo é o único recurso que pode pertencer a duas operações — a mesma
      placa remunerada em dois contratos. Por isso a recusa é por pertinência, e
      não por posse: a placa da empurrada não aparece em nenhuma vigência de
      rota, então a ficha dela não abre lá.
    */
    const naEmpurrada = await get("/frota/ativos?entityType=CARRETA&operacao=EMPURRADA");
    const entityId = naEmpurrada.body.ativos[0].entityId as string;

    expect((await get(`/composition/equipment/${entityId}?operacao=ROTA`)).status).toBe(404);
    expect((await get(`/composition/equipment/${entityId}?operacao=EMPURRADA`)).status).toBe(200);
  });

  it("apura a DRE da frota só com o que é da operação aberta", async () => {
    const { rota, empurrada } = await nasDuas("/dre/fleet?escopo=CARRETA");

    expect(rota.status).toBe(200);
    expect(texto(rota.body)).not.toContain(PLACA_EMPURRADA);
    expect(texto(empurrada.body)).not.toContain(PLACA_ROTA);
  });

  it("mede a cobertura de dados só sobre as vigências da operação aberta", async () => {
    const { rota, empurrada } = await nasDuas("/coverage");

    expect(texto(rota.body)).not.toContain("EMPURRADA");
    expect(texto(empurrada.body)).not.toContain("ROTA_");
  });
});

describe("o Radar de Trechos", () => {
  it("responde sobre os trechos da operação aberta, e não sobre os da outra", async () => {
    const { rota, empurrada } = await nasDuas("/trechos/radar");

    expect(rota.status).toBe(200);
    expect(rota.body.sourceLabel).toBe("ROTA_2_4_2026");
    expect(texto(rota.body)).toContain("RJ-JAGUARIUNA");
    expect(texto(rota.body)).not.toContain("SP-CAMACARI");

    expect(empurrada.body.sourceLabel).toBe("EMPURRADA_2_4_2026");
    expect(texto(empurrada.body)).not.toContain("RJ-JAGUARIUNA");
  });
});

describe("as importações", () => {
  it("lista só as que produziram vigência da operação aberta", async () => {
    const { rota, empurrada } = await nasDuas("/imports");

    const rotulosDaRota = texto(rota.body);
    expect(rotulosDaRota).not.toContain("EMPURRADA");
    expect(texto(empurrada.body)).not.toContain("ROTA_");

    /* Cada operação teve duas importações — a de equipamento e a de trecho. */
    expect(rota.body).toHaveLength(2);
    expect(empurrada.body).toHaveLength(2);
  });
});

/*
  ---------------------------------------------------------------------------
  5. Justificativas — a única escrita da cadeia
  ---------------------------------------------------------------------------
*/
describe("as justificativas", () => {
  it("recusa ler e escrever na comparação de outra operação", async () => {
    const comparacoes = await get("/change-sets?operacao=EMPURRADA");
    const daEmpurrada = comparacoes.body[0].id as string;

    const leitura = await get(
      `/justificativas?changeSetId=${daEmpurrada}&operacao=ROTA`,
    );
    expect(leitura.status).toBe(404);

    const escrita = await fetch(`${base}/justificativas?operacao=ROTA`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeSetId: daEmpurrada, changeIds: [1], texto: "teste" }),
    });
    expect(escrita.status).toBe(404);
  });
});

/*
  ---------------------------------------------------------------------------
  6. Trocar de ambiente troca o dataset — sem quebrar endereço nem contexto
  ---------------------------------------------------------------------------
*/
describe("trocar de ambiente", () => {
  it("troca o dataset no mesmo endereço, mantendo o recorte de unidade", async () => {
    const contextos = await get("/contexts?operacao=ROTA");
    const scopeHash = contextos.body[0].scopeHash as string;

    /* O mesmo `scopeHash` — a mesma unidade — nas duas operações. */
    const naRota = await get(
      `/changes/consolidated?scopeHash=${scopeHash}&period=${FEVEREIRO}&operacao=ROTA`,
    );
    const naEmpurrada = await get(
      `/changes/consolidated?scopeHash=${scopeHash}&period=${FEVEREIRO}&operacao=EMPURRADA`,
    );

    expect(naRota.status).toBe(200);
    expect(naEmpurrada.status).toBe(200);
    expect(texto(naRota.body)).not.toContain("EMPURRADA");
    expect(texto(naEmpurrada.body)).not.toContain("ROTA_");
  });

  it("recusa o contexto de outra operação em vez de responder com o dela", async () => {
    /*
      O caso do link colado: um endereço da empurrada aberto dentro da rota. A
      recusa é o que separa "não existe aqui" de responder, calado, com o acervo
      errado — e ela é 404 com a lista do que existe nesta operação.
    */
    const semCanal = await get(
      `/changes/consolidated?scopeHash=${UNIDADE}&canal=EMPURRADA&period=${FEVEREIRO}&operacao=ROTA`,
    );
    expect(semCanal.status).toBe(404);
  });
});
