import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture } from "@workspace/comparison/testing";
import { seedTaxonomy } from "@workspace/curation";
import {
  declaracaoEmVigor,
  registrarBaixa,
  rosterDaVigencia,
  type DeclaracaoDeFrota,
} from "../frota";
import { vigenciasObservadas, type VigenciaObservada } from "../observado";

/**
 * A frota declarada — o que `entity_expectation` manda, e onde ela manda.
 *
 * Este arquivo existe porque a tabela era escrita e não era lida. `BAIXA` era
 * lida sem recorte e sem janela — `WHERE status = 'BAIXA'`, e nada mais —, de
 * modo que uma baixa dada numa unidade calava a mesma placa em todas as outras
 * e uma baixa com `effective_until` fechado calava para sempre. `ESPERADA` não
 * era lida de jeito nenhum: a rota aceitava, validava, gravava e emitia evento
 * de curadoria, e nenhum número do produto mudava.
 *
 * As duas metades são provadas aqui separadamente: a regra de casamento como
 * função pura, caso a caso, e o efeito dela no roster, contra banco.
 */

let ctx: TestDb;

/*
  Duas unidades no mesmo canal e na mesma família — o cenário que o vazamento
  precisava para existir. As placas são as mesmas nas duas de propósito: uma
  placa identifica **um** ativo em todo o banco (ver `buildFixture`), então
  `PPP1A11` na unidade A e na unidade B são a mesma entidade, e uma baixa que
  ignore o recorte necessariamente atinge as duas.
*/
const UNIDADE_A = "unidade-a";
const UNIDADE_B = "unidade-b";
const V1 = "2026-01-01";
const V2 = "2026-02-01";
const V3 = "2026-03-01";

const ATRIBUTOS = [
  { code: "carreta.attr_a", dataType: "NUMERIC" as const, semanticsStatus: "CONFIRMED" as const },
];
const VALOR = { "carreta.attr_a": 1 };

/** A placa que sumiu depois de V1 — a que exercita a continuidade. */
const SUMIU = "PPP1A11";
/** A placa estável, que está nas três vigências das duas unidades. */
const FICOU = "PPP2B22";
/** A placa que nunca chegou a lugar nenhum — só existe por declaração. */
const NUNCA_VEIO = "PPP3C33";

let vigenciasA: VigenciaObservada[];
let vigenciasB: VigenciaObservada[];

beforeAll(async () => {
  ctx = await createTestDatabase("cobertura_frota_declarada");
  await seedTaxonomy(ctx.db, "test");

  for (const [unidade, canal] of [
    [UNIDADE_A, "EMPURRADA_A"],
    [UNIDADE_B, "EMPURRADA_B"],
  ] as const) {
    await buildFixture(
      ctx.db,
      ATRIBUTOS,
      [
        {
          label: `${canal}_1_1_2026`,
          effectiveDate: V1,
          data: { [SUMIU]: { ...VALOR }, [FICOU]: { ...VALOR } },
        },
        { label: `${canal}_1_2_2026`, effectiveDate: V2, data: { [FICOU]: { ...VALOR } } },
        { label: `${canal}_1_3_2026`, effectiveDate: V3, data: { [FICOU]: { ...VALOR } } },
      ],
      { entityType: "CARRETA", scopeHash: unidade, canal },
    );
  }

  /*
    NUNCA_VEIO precisa existir como entidade sem existir em vigência nenhuma —
    é o caso que só `ESPERADA` alcança. Uma vigência de outra unidade a cria
    sem contaminar A nem B.
  */
  await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [{ label: "OUTRA_1_1_2026", effectiveDate: V1, data: { [NUNCA_VEIO]: { ...VALOR } } }],
    { entityType: "CARRETA", scopeHash: "unidade-terceira", canal: "OUTRO" },
  );

  const todas = await vigenciasObservadas(ctx.db);
  vigenciasA = todas.filter((v) => v.scopeHash === UNIDADE_A);
  vigenciasB = todas.filter((v) => v.scopeHash === UNIDADE_B);
  expect(vigenciasA).toHaveLength(3);
  expect(vigenciasB).toHaveLength(3);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

const vigenciaA = (data: string) => vigenciasA.find((v) => v.effectiveDate === data)!;
const vigenciaB = (data: string) => vigenciasB.find((v) => v.effectiveDate === data)!;

/** O roster de uma vigência, com o observado que a própria vigência declara. */
async function roster(vigencia: VigenciaObservada) {
  return rosterDaVigencia(
    ctx.db,
    vigencia,
    new Map(vigencia.equipamentos.map((e) => [e.entityType, e.entidades] as const)),
  );
}

const placasAusentes = async (vigencia: VigenciaObservada) =>
  (await roster(vigencia)).ausentes.map((a) => a.rotulo).sort();

async function idDaPlaca(placa: string): Promise<string> {
  const { rows } = await ctx.db.execute<{ entity_id: string }>(sql`
    SELECT entity_id::text AS entity_id
      FROM entity_identifier
     WHERE identifier_type = 'PLACA' AND identifier_value = ${placa} AND is_current
  `);
  return rows[0]!.entity_id;
}

// ---------------------------------------------------------------------------
// A regra de casamento, sem banco
// ---------------------------------------------------------------------------

describe("declaracaoEmVigor — onde uma declaração vale", () => {
  const base: DeclaracaoDeFrota = {
    entityId: "e1",
    entityType: "CARRETA",
    datasetFamily: "REMUNERACAO_EQUIPAMENTO",
    canal: null,
    scopeKey: null,
    status: "BAIXA",
    efetivoDe: "2026-02-01",
    efetivoAte: null,
    motivo: "vendida",
    criadaEm: "2026-02-01T00:00:00Z",
  };
  const recorte = {
    datasetFamily: "REMUNERACAO_EQUIPAMENTO",
    canal: "EMPURRADA_A",
    scopeKey: '[{"scopeType": "UNIDADE", "code": "111"}]',
  };

  it("nulo é curinga: a declaração de família inteira vale em qualquer recorte", () => {
    expect(declaracaoEmVigor([base], recorte, "2026-02-01")?.status).toBe("BAIXA");
  });

  it("um escopo declarado não alcança outro escopo", () => {
    const deOutraUnidade = { ...base, scopeKey: '[{"scopeType": "UNIDADE", "code": "999"}]' };
    expect(declaracaoEmVigor([deOutraUnidade], recorte, "2026-02-01")).toBeNull();
  });

  it("um canal declarado não alcança outro canal", () => {
    expect(declaracaoEmVigor([{ ...base, canal: "ROTA" }], recorte, "2026-02-01")).toBeNull();
  });

  it("outra família nunca alcança, nem com canal e escopo nulos", () => {
    expect(
      declaracaoEmVigor([{ ...base, datasetFamily: "QUADRO_DE_PESSOAL" }], recorte, "2026-02-01"),
    ).toBeNull();
  });

  it("antes de efetivoDe não vale; a partir dele, vale", () => {
    expect(declaracaoEmVigor([base], recorte, "2026-01-31")).toBeNull();
    expect(declaracaoEmVigor([base], recorte, "2026-02-01")).not.toBeNull();
  });

  it("efetivoAte é exclusivo: no dia dele a declaração já não vale", () => {
    const comJanela = { ...base, efetivoAte: "2026-03-01" };
    expect(declaracaoEmVigor([comJanela], recorte, "2026-02-28")?.status).toBe("BAIXA");
    expect(declaracaoEmVigor([comJanela], recorte, "2026-03-01")).toBeNull();
    expect(declaracaoEmVigor([comJanela], recorte, "2026-04-01")).toBeNull();
  });

  it("a mais específica ganha da mais larga, mesmo sendo mais antiga", () => {
    const familiaInteira = { ...base, status: "BAIXA" as const, efetivoDe: "2026-02-01" };
    const soDestaUnidade = {
      ...base,
      status: "ESPERADA" as const,
      scopeKey: recorte.scopeKey,
      efetivoDe: "2026-01-01",
    };
    const vencedora = declaracaoEmVigor([familiaInteira, soDestaUnidade], recorte, "2026-02-01");
    expect(vencedora?.status).toBe("ESPERADA");
  });

  it("entre duas igualmente específicas, ganha a de efetivoDe mais recente", () => {
    const antiga = { ...base, status: "BAIXA" as const, efetivoDe: "2026-01-01" };
    const nova = { ...base, status: "ESPERADA" as const, efetivoDe: "2026-02-01" };
    expect(declaracaoEmVigor([antiga, nova], recorte, "2026-02-01")?.status).toBe("ESPERADA");
    /* E antes da nova, quem governa ainda é a antiga. */
    expect(declaracaoEmVigor([antiga, nova], recorte, "2026-01-15")?.status).toBe("BAIXA");
  });

  it("a ordem da lista não decide nada", () => {
    const antiga = { ...base, status: "BAIXA" as const, efetivoDe: "2026-01-01" };
    const nova = { ...base, status: "ESPERADA" as const, efetivoDe: "2026-02-01" };
    expect(declaracaoEmVigor([antiga, nova], recorte, "2026-02-01")?.status).toBe(
      declaracaoEmVigor([nova, antiga], recorte, "2026-02-01")?.status,
    );
  });
});

// ---------------------------------------------------------------------------
// O efeito no roster, contra banco
// ---------------------------------------------------------------------------

describe("a continuidade, antes de qualquer declaração", () => {
  it("uma placa de V1 ausente em V2 e V3 é cobrada nas duas", async () => {
    expect(await placasAusentes(vigenciaA(V1))).toEqual([]);
    expect(await placasAusentes(vigenciaA(V2))).toEqual([SUMIU]);
    expect(await placasAusentes(vigenciaA(V3))).toEqual([SUMIU]);
  });

  it("a cobrança não expira com o tempo — V3 continua cobrando o que sumiu em V2", async () => {
    const r = await roster(vigenciaA(V3));
    const ausente = r.ausentes.find((a) => a.rotulo === SUMIU)!;
    expect(ausente.ultimaVigencia).toBe(V1);
    expect(ausente.vigenciasComDado).toBe(1);
    expect(ausente.origem).toBe("CONTINUIDADE");
    expect(ausente.motivo).toBeNull();
  });

  it("quem está na vigência não é cobrado", async () => {
    const r = await roster(vigenciaA(V3));
    expect(r.ausentes.map((a) => a.rotulo)).not.toContain(FICOU);
    /* E o esperado é o observado mais quem falta: 1 presente + 1 ausente. */
    expect(r.esperadasPorTipo.get("CARRETA")).toBe(2);
  });
});

describe("BAIXA", () => {
  it("registrada no recorte certo, encerra a cobrança dali em diante", async () => {
    const vigencia = vigenciaA(V3);
    await registrarBaixa(ctx.db, {
      datasetFamily: vigencia.datasetFamily,
      canal: vigencia.canal,
      scopeKey: vigencia.scopeKey,
      entityType: "CARRETA",
      entityId: await idDaPlaca(SUMIU),
      status: "BAIXA",
      efetivoDe: V3,
      motivo: "Vendida em março; nota fiscal 4471 anexada.",
      ator: "teste@freightcheck",
    });

    expect(await placasAusentes(vigenciaA(V3))).toEqual([]);
  });

  /**
   * O vazamento que este trabalho veio fechar.
   *
   * A baixa acima foi registrada com o `scopeKey` da unidade A. A unidade B tem
   * a **mesma entidade** ausente pela mesma razão, e continua cobrando — porque
   * ninguém decidiu nada sobre ela lá. Com a leitura antiga (`WHERE status =
   * 'BAIXA'`, sem recorte), esta asserção falharia: a lista de B viria vazia.
   */
  it("não vaza para outra unidade", async () => {
    expect(await placasAusentes(vigenciaB(V3))).toEqual([SUMIU]);
  });

  it("não retroage: a vigência anterior à baixa continua cobrando", async () => {
    expect(await placasAusentes(vigenciaA(V2))).toEqual([SUMIU]);
  });

  /**
   * A baixa não ressuscita a placa em lugar nenhum.
   *
   * Uma entidade baixada continua existindo nas vigências históricas — os fatos
   * de V1 não somem. O que a baixa encerra é a **cobrança** a partir da data
   * dela, e a prova de que a continuidade não a reintroduz é V3 continuar vazia
   * depois de o roster ter varrido V1 inteira.
   */
  it("uma entidade baixada não reaparece por existir numa vigência histórica", async () => {
    const r = await roster(vigenciaA(V3));
    expect(r.ausentes).toHaveLength(0);
    /* E o denominador acompanha: só o que veio. */
    expect(r.esperadasPorTipo.get("CARRETA")).toBe(1);
  });

  it("com janela fechada, deixa de valer e a cobrança volta", async () => {
    const vigencia = vigenciaB(V2);
    await registrarBaixa(ctx.db, {
      datasetFamily: vigencia.datasetFamily,
      canal: vigencia.canal,
      scopeKey: vigencia.scopeKey,
      entityType: "CARRETA",
      entityId: await idDaPlaca(SUMIU),
      status: "BAIXA",
      efetivoDe: V2,
      /* Exclusivo: vale em V2 e já não vale em V3. */
      efetivoAte: V3,
      motivo: "Baixa temporária enquanto a transferência não é confirmada.",
      ator: "teste@freightcheck",
    });

    expect(await placasAusentes(vigenciaB(V2))).toEqual([]);
    expect(await placasAusentes(vigenciaB(V3))).toEqual([SUMIU]);
  });
});

describe("ESPERADA", () => {
  /**
   * A metade que era escrita e nunca lida.
   *
   * `NUNCA_VEIO` não está em nenhuma vigência da unidade A — a continuidade não
   * tem como alcançá-la, porque continuidade só sabe de quem já veio. Declarar
   * que ela deveria estar aqui é a única forma de cobrá-la, e antes desta
   * mudança a declaração não produzia efeito nenhum.
   */
  it("põe no roster quem nunca apareceu, e sobe o denominador", async () => {
    const vigencia = vigenciaA(V3);
    const antes = await roster(vigencia);
    expect(antes.ausentes.map((a) => a.rotulo)).not.toContain(NUNCA_VEIO);
    const esperadasAntes = antes.esperadasPorTipo.get("CARRETA") ?? 0;

    await registrarBaixa(ctx.db, {
      datasetFamily: vigencia.datasetFamily,
      canal: vigencia.canal,
      scopeKey: vigencia.scopeKey,
      entityType: "CARRETA",
      entityId: await idDaPlaca(NUNCA_VEIO),
      status: "ESPERADA",
      efetivoDe: V3,
      motivo: "Transferida da unidade terceira em março; deve vir no arquivo.",
      ator: "teste@freightcheck",
    });

    const depois = await roster(vigencia);
    const nova = depois.ausentes.find((a) => a.rotulo === NUNCA_VEIO);
    expect(nova, "a entidade declarada ESPERADA entra no roster").toBeDefined();
    expect(nova!.origem).toBe("DECLARACAO");
    expect(nova!.ultimaVigencia).toBeNull();
    expect(nova!.vigenciasComDado).toBe(0);
    expect(nova!.motivo).toContain("Transferida da unidade terceira");
    expect(depois.esperadasPorTipo.get("CARRETA")).toBe(esperadasAntes + 1);
  });

  it("não alcança a unidade em que ninguém a declarou", async () => {
    expect(await placasAusentes(vigenciaB(V3))).not.toContain(NUNCA_VEIO);
  });

  it("não vale antes da data em que passou a valer", async () => {
    expect(await placasAusentes(vigenciaA(V2))).not.toContain(NUNCA_VEIO);
  });
});
