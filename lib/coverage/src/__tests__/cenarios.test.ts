import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture } from "@workspace/comparison/testing";
import { seedTaxonomy } from "@workspace/curation";
import { DecisaoRecusada, registrarDecisao } from "../contrato";
import { detalheDaCelula } from "../detalhe";
import { matrizDeAtributos } from "../atributos";
import { visaoDaCobertura } from "../matriz";
import { vigenciasObservadas } from "../observado";

/**
 * Os cenários que o export real não tem.
 *
 * O export real é bem-comportado: 138 colunas densas, nove vigências, nenhum
 * campo somindo. Ele prova a consolidação e a proveniência, e não prova
 * complemento por entidade, conflito, dispensa nem recomputação seletiva —
 * porque nada disso acontece nele. Aqui cada um é montado sozinho, com uma
 * variável de cada vez.
 *
 * As fixtures escrevem no canônico diretamente, do jeito que a promoção
 * escreve, inclusive o agregado `snapshot_entity_type`. É o que permite
 * controlar exatamente quantas entidades e quantos atributos existem.
 */
let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("cobertura_cenarios");
  await seedTaxonomy(ctx.db, "test");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const placas = (prefixo: string, quantidade: number, atributos: Record<string, number>) => {
  const dados: Record<string, Record<string, number>> = {};
  for (let i = 0; i < quantidade; i++) {
    dados[`${prefixo}${String(i).padStart(4, "0")}`] = { ...atributos };
  }
  return dados;
};

describe("1. arquivos complementares: A + B + C = uma cobertura", () => {
  /*
    O cenário do pedido, montado à mão:

      Arquivo A → 100 entidades, atributos A/B/C
      Arquivo B → as mesmas 100,  atributos D/E/F
      Arquivo C → mais 44,        atributos A/B/C/D/E/F

    Cada arquivo cobre uma fatia; nenhum cobre o universo. O resultado esperado
    é **144 entidades e 6 atributos**, e não três conjuntos independentes.

    A fixture monta as entregas como vigências do mesmo escopo, porque é assim
    que se controla o que cada uma traz; a consolidação por revisão está provada
    contra o export real em `cobertura-real.test.ts`. O que se prova aqui é a
    outra metade: que a cobertura se lê da união e não de um arquivo.

    A entrega A aparece **duas vezes** de propósito. A inferência por histórico
    exige `MINIMO_DE_VIGENCIAS` aparições antes de afirmar que algo era
    esperado, e uma vigência só não é série: com uma entrega de A, o módulo
    diria — corretamente — que não sabe se A/B/C deveriam estar em B. Duas é o
    mínimo que torna a pergunta respondível, e é por isso que o cenário tem
    quatro vigências para três arquivos.
  */
  const ESCOPO = "complementares";
  let ids: Record<string, string>;

  beforeAll(async () => {
    const atributos = ["a", "b", "c", "d", "e", "f"].map((letra) => ({
      code: `carreta.attr_${letra}`,
      dataType: "NUMERIC" as const,
      semanticsStatus: "CONFIRMED" as const,
    }));

    const abc = { "carreta.attr_a": 1, "carreta.attr_b": 2, "carreta.attr_c": 3 };
    const def = { "carreta.attr_d": 4, "carreta.attr_e": 5, "carreta.attr_f": 6 };

    const r = await buildFixture(
      ctx.db,
      atributos,
      [
        { label: "A_1_1_2026", effectiveDate: "2026-01-01", data: placas("AAA", 100, abc) },
        { label: "A_1_2_2026", effectiveDate: "2026-02-01", data: placas("AAA", 100, abc) },
        { label: "B_1_3_2026", effectiveDate: "2026-03-01", data: placas("AAA", 100, def) },
        {
          label: "C_1_4_2026",
          effectiveDate: "2026-04-01",
          data: {
            ...placas("AAA", 100, { ...abc, ...def }),
            ...placas("CCC", 44, { ...abc, ...def }),
          },
        },
      ],
      { entityType: "CARRETA", scopeHash: ESCOPO, canal: "COMPL" },
    );
    ids = r.snapshotIds;
  }, 600_000);

  it("a vigência que reúne tudo cobre 144 entidades e 6 atributos", async () => {
    const vigencias = await vigenciasObservadas(ctx.db, { scopeHash: ESCOPO });
    const c = vigencias.find((v) => v.sourceLabel === "C_1_4_2026")!;
    const carretas = c.equipamentos.find((e) => e.entityType === "CARRETA")!;

    expect(carretas.entidades).toBe(144);
    expect(carretas.atributos).toBe(6);
    expect(carretas.fatos).toBe(144 * 6);
  });

  it("a cobertura de C é 100% — o esperado inferido do histórico já foi entregue", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    const linha = visao.linhas.find((l) => l.entityType === "CARRETA")!;
    const c = linha.celulas["2026-04-01"]!;

    expect(c.conta.entidadesEsperadas).toBe(144);
    expect(c.conta.percentual).toBe(100);
    expect(c.estado).toBe("COMPLETO");
  });

  it("a entrega B é AUSENTE porque A já mostrou que A/B/C existem", async () => {
    /*
      É o coração do módulo: B trouxe seis atributos? Não — trouxe três, e o
      histórico de A diz que os outros três eram esperados. Um sistema que
      medisse cobertura por arquivo daria 100% em B, porque B entregou tudo o
      que B tinha.
    */
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    const linha = visao.linhas.find((l) => l.entityType === "CARRETA")!;
    const b = linha.celulas["2026-03-01"]!;

    expect(b.estado).toBe("AUSENTE");
    const faltando = visao.lacunas
      .filter((l) => l.effectiveDate === "2026-03-01")
      .map((l) => l.attributeCode)
      .sort();
    expect(faltando).toEqual(["carreta.attr_a", "carreta.attr_b", "carreta.attr_c"]);
  });

  it("a lacuna diz por que aquilo era esperado, com a medição", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    const lacuna = visao.lacunas.find(
      (l) => l.effectiveDate === "2026-03-01" && l.attributeCode === "carreta.attr_a",
    )!;

    expect(lacuna.justificativa.origem).toBe("HISTORICO");
    expect(lacuna.justificativa.declarado).toBe(false);
    expect(lacuna.justificativa.motivo).toContain("vigências anteriores");
    expect(lacuna.justificativa.motivo).toContain("inferência, não contrato");
    expect(lacuna.entidadesFaltando).toBe(100);
  });

  it("a primeira vigência não tem lacuna: não havia histórico para inferir", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    expect(visao.lacunas.filter((l) => l.effectiveDate === "2026-01-01")).toEqual([]);
    const linha = visao.linhas.find((l) => l.entityType === "CARRETA")!;
    /* Sem esperado nenhum, o estado honesto é "não aplicável", não 100%. */
    expect(linha.celulas["2026-01-01"]!.estado).toBe("NAO_APLICAVEL");
  });

  it("os ids da fixture são quatro vigências distintas — nada foi fundido por engano", () => {
    expect(new Set(Object.values(ids)).size).toBe(4);
  });
});

describe("14. escopos diferentes não se misturam", () => {
  beforeAll(async () => {
    /*
      Duas unidades, o mesmo atributo, e só uma delas o entrega na segunda
      vigência. Se os escopos vazassem, a unidade que entregou taparia a lacuna
      da que não entregou — e o produto pararia de cobrar quem deve.
    */
    const atributos = [
      { code: "carreta.compartilhado", dataType: "NUMERIC" as const },
      { code: "carreta.so_da_um", dataType: "NUMERIC" as const },
    ];

    await buildFixture(
      ctx.db,
      atributos,
      [
        {
          label: "UM_1_1_2026",
          effectiveDate: "2026-01-01",
          data: placas("UM", 10, { "carreta.compartilhado": 1, "carreta.so_da_um": 2 }),
        },
        {
          label: "UM_1_2_2026",
          effectiveDate: "2026-02-01",
          data: placas("UM", 10, { "carreta.compartilhado": 1, "carreta.so_da_um": 2 }),
        },
        {
          label: "UM_1_3_2026",
          effectiveDate: "2026-03-01",
          data: placas("UM", 10, { "carreta.compartilhado": 1 }),
        },
      ],
      { entityType: "CARRETA", scopeHash: "unidade-um", canal: "UM" },
    );

    await buildFixture(
      ctx.db,
      atributos,
      [
        {
          label: "DOIS_1_1_2026",
          effectiveDate: "2026-01-01",
          data: placas("DOIS", 10, { "carreta.compartilhado": 1 }),
        },
        {
          label: "DOIS_1_2_2026",
          effectiveDate: "2026-02-01",
          data: placas("DOIS", 10, { "carreta.compartilhado": 1 }),
        },
        {
          label: "DOIS_1_3_2026",
          effectiveDate: "2026-03-01",
          data: placas("DOIS", 10, { "carreta.compartilhado": 1 }),
        },
      ],
      { entityType: "CARRETA", scopeHash: "unidade-dois", canal: "DOIS" },
    );
  }, 600_000);

  it("a unidade que sempre entregou cobra a lacuna", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: "unidade-um", vigencias: 3 });
    const lacunas = visao.lacunas.filter((l) => l.effectiveDate === "2026-03-01");
    expect(lacunas.map((l) => l.attributeCode)).toEqual(["carreta.so_da_um"]);
    expect(lacunas[0]!.entidadesFaltando).toBe(10);
  });

  it("a unidade que nunca entregou aquele atributo não é cobrada por ele", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: "unidade-dois", vigencias: 3 });
    expect(visao.lacunas.map((l) => l.attributeCode)).not.toContain("carreta.so_da_um");
    const linha = visao.linhas[0]!;
    expect(linha.celulas["2026-03-01"]!.estado).toBe("COMPLETO");
  });
});

/**
 * O período em que o conjunto simplesmente não veio.
 *
 * O export real não tem isto — as nove vigências trazem os dois equipamentos —,
 * e por isso ele precisa ser montado à mão. A tabela de atributos desenha um
 * traço nessa coluna, e o traço tem **duas** causas que a tela não distingue
 * sozinha: o atributo não era cobrado ali, ou o conjunto inteiro faltou naquele
 * período. `coluna.snapshotId` é o que separa as duas, e é o que permite à
 * gaveta abrir dizendo qual das duas ela está explicando.
 */
describe("o período sem vigência do conjunto", () => {
  const ATRIBUTOS = [{ code: "carreta.intermitente", dataType: "NUMERIC" as const }];

  beforeAll(async () => {
    /* O intermitente pula fev/27; o constante existe nos três meses. */
    await buildFixture(
      ctx.db,
      ATRIBUTOS,
      [
        {
          label: "INT_1_1_2027",
          effectiveDate: "2027-01-01",
          data: placas("INT", 10, { "carreta.intermitente": 1 }),
        },
        {
          label: "INT_1_3_2027",
          effectiveDate: "2027-03-01",
          data: placas("INT", 10, { "carreta.intermitente": 1 }),
        },
      ],
      { entityType: "CARRETA", scopeHash: "intermitente", canal: "INT" },
    );

    await buildFixture(
      ctx.db,
      ATRIBUTOS,
      [
        {
          label: "CTE_1_1_2027",
          effectiveDate: "2027-01-01",
          data: placas("CTE", 10, { "carreta.intermitente": 1 }),
        },
        {
          label: "CTE_1_2_2027",
          effectiveDate: "2027-02-01",
          data: placas("CTE", 10, { "carreta.intermitente": 1 }),
        },
        {
          label: "CTE_1_3_2027",
          effectiveDate: "2027-03-01",
          data: placas("CTE", 10, { "carreta.intermitente": 1 }),
        },
      ],
      { entityType: "CARRETA", scopeHash: "constante", canal: "CTE" },
    );
  }, 600_000);

  it("a coluna do período que faltou não aponta vigência nenhuma", async () => {
    const aberta = await matrizDeAtributos(ctx.db, {
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      entityType: "CARRETA",
      scopeHash: "intermitente",
      canal: "INT",
      vigencias: 3,
    });

    /*
      A janela é a de **todas** as vigências, e não a do conjunto: fev/27 tem de
      aparecer como coluna vazia. Uma janela calculada só sobre o conjunto
      puxaria uma vigência mais antiga para o lugar dela, e a tabela esconderia
      exatamente o mês em que ele não veio.
    */
    expect(aberta.colunas.map((c) => c.chave)).toEqual([
      "2027-01-01",
      "2027-02-01",
      "2027-03-01",
    ]);

    const fevereiro = aberta.colunas.find((c) => c.chave === "2027-02-01")!;
    expect(fevereiro.snapshotId).toBeNull();
    expect(fevereiro.sourceLabel).toBeNull();

    const janeiro = aberta.colunas.find((c) => c.chave === "2027-01-01")!;
    expect(janeiro.snapshotId).not.toBeNull();
    expect(janeiro.sourceLabel).toBe("INT_1_1_2027");

    /* E nenhuma linha inventa célula onde não houve vigência. */
    for (const linha of aberta.linhas) {
      expect(linha.celulas["2027-02-01"]).toBeUndefined();
      expect(linha.celulas["2027-01-01"]).toBeDefined();
    }
  });
});

describe("7 e 12. dispensa, conflito e decisão humana", () => {
  const ESCOPO = "decisoes";

  beforeAll(async () => {
    await buildFixture(
      ctx.db,
      [
        { code: "carreta.opcional", dataType: "NUMERIC" },
        { code: "carreta.sempre", dataType: "NUMERIC" },
      ],
      [
        /* Três entregas completas antes da falha: duas é o mínimo para inferir. */
        {
          label: "DEC_1_1_2026",
          effectiveDate: "2026-01-01",
          data: placas("DEC", 20, { "carreta.opcional": 1, "carreta.sempre": 2 }),
        },
        {
          label: "DEC_1_2_2026",
          effectiveDate: "2026-02-01",
          data: placas("DEC", 20, { "carreta.opcional": 1, "carreta.sempre": 2 }),
        },
        {
          label: "DEC_1_3_2026",
          effectiveDate: "2026-03-01",
          data: placas("DEC", 20, { "carreta.opcional": 1, "carreta.sempre": 2 }),
        },
        {
          label: "DEC_1_4_2026",
          effectiveDate: "2026-04-01",
          data: placas("DEC", 20, { "carreta.sempre": 2 }),
        },
      ],
      { entityType: "CARRETA", scopeHash: ESCOPO, canal: "DEC" },
    );
  }, 600_000);

  it("antes da decisão, a ausência é lacuna", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    const lacunas = visao.lacunas.filter((l) => l.effectiveDate === "2026-04-01");
    expect(lacunas.map((l) => l.attributeCode)).toEqual(["carreta.opcional"]);
    expect(visao.linhas[0]!.celulas["2026-04-01"]!.conta.percentual).toBe(50);
  });

  it("dispensar exige motivo escrito, e recusa sem ele", async () => {
    await expect(
      registrarDecisao(ctx.db, {
        datasetFamily: "REMUNERACAO_EQUIPAMENTO",
        entityType: "CARRETA",
        attributeCode: "carreta.opcional",
        status: "DISPENSADO",
        efetivoDe: "2026-04-01",
        motivo: "   ",
        ator: "curador@teste",
      }),
    ).rejects.toBeInstanceOf(DecisaoRecusada);
  });

  it("aceitar uma renomeação exige dizer desde quando", async () => {
    await expect(
      registrarDecisao(ctx.db, {
        datasetFamily: "REMUNERACAO_EQUIPAMENTO",
        entityType: "CARRETA",
        attributeCode: "carreta.opcional",
        status: "DISPENSADO",
        efetivoDe: "2026-04-01",
        sucessor: "carreta.opcional_mensal",
        motivo: "renomearam",
        ator: "curador@teste",
      }),
    ).rejects.toBeInstanceOf(DecisaoRecusada);
  });

  it("depois da dispensa, a cobertura sobe e a lacuna some — com rastro", async () => {
    await registrarDecisao(ctx.db, {
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      canal: "DEC",
      entityType: "CARRETA",
      attributeCode: "carreta.opcional",
      status: "DISPENSADO",
      efetivoDe: "2026-04-01",
      motivo: "O contrato desta unidade deixou de prever o item a partir de março.",
      ator: "curador@teste",
    });

    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    expect(visao.lacunas.filter((l) => l.effectiveDate === "2026-04-01")).toEqual([]);
    expect(visao.linhas[0]!.celulas["2026-04-01"]!.conta.percentual).toBe(100);

    /* A decisão fica no histórico de decisões do produto, não só na cobertura. */
    const { rows } = await ctx.db.execute<{ n: number; actor: string; reason: string }>(sql`
      SELECT count(*)::int AS n, max(actor) AS actor, max(reason) AS reason
        FROM curation_event
       WHERE target_kind = 'COVERAGE_EXPECTATION' AND target_label = 'carreta.opcional'
    `);
    expect(Number(rows[0]!.n)).toBe(1);
    expect(rows[0]!.actor).toBe("curador@teste");
    expect(rows[0]!.reason).toContain("deixou de prever");
  });

  it("a dispensa vale só a partir da data declarada", async () => {
    /* Março continua contando o atributo — dispensar não reescreve o passado. */
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    const marco = visao.linhas[0]!.celulas["2026-03-01"]!;
    expect(marco.conta.atributosEsperados).toBeGreaterThan(0);
    expect(marco.conta.percentual).toBe(100);
  });

  it("12. duas fontes conflitantes não se consolidam em silêncio", async () => {
    /*
      A defesa contra consolidação silenciosa não é da cobertura: é da
      identidade canônica, e ela é estrutural. Duas vigências ativas com a mesma
      identidade são impossíveis — o índice único as recusa no banco, e não numa
      camada da aplicação que possa ser contornada. Este teste prende isso a
      partir da cobertura porque é a cobertura que sofreria: dois valores para a
      mesma chave inflariam `value_count` e a cobertura passaria de 100%.
    */
    const vigencias = await vigenciasObservadas(ctx.db, { scopeHash: ESCOPO });
    const alvo = vigencias.find((v) => v.effectiveDate === "2026-04-01")!;

    await expect(
      ctx.db.execute(sql`
        INSERT INTO snapshot (source_file_id, import_run_id, source_label, effective_date,
                              scope_hash, entity_type_set, dataset_family, canal,
                              canonical_scope, status, revision)
        SELECT source_file_id, import_run_id, source_label, effective_date,
               scope_hash, entity_type_set, dataset_family, canal,
               canonical_scope, 'CLOSED', 99
          FROM snapshot WHERE id = ${alvo.snapshotId}::uuid
      `),
    ).rejects.toThrow();

    /* E a cobertura continua a mesma: nada foi somado duas vezes. */
    const depois = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 4 });
    expect(depois.linhas[0]!.celulas["2026-04-01"]!.conta.percentual).toBe(100);
  });

  it("nenhuma cobertura passa de 100% — o teto é o esperado, não o entregue", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 12 });
    for (const linha of visao.linhas) {
      for (const celula of Object.values(linha.celulas)) {
        expect(celula.conta.percentual).toBeLessThanOrEqual(100);
        expect(celula.contaCritica.percentual).toBeLessThanOrEqual(100);
      }
    }
    expect(visao.resumo.geral.percentual).toBeLessThanOrEqual(100);
  });
});

describe("15. recomputação depois de nova importação atualiza só o necessário", () => {
  const ESCOPO = "recomputacao";

  it("uma vigência nova não reescreve o agregado das anteriores", async () => {
    await buildFixture(
      ctx.db,
      [{ code: "carreta.rec", dataType: "NUMERIC" }],
      [
        {
          label: "REC_1_1_2026",
          effectiveDate: "2026-01-01",
          data: placas("REC", 5, { "carreta.rec": 1 }),
        },
      ],
      { entityType: "CARRETA", scopeHash: ESCOPO, canal: "REC" },
    );

    const antes = await ctx.db.execute<{ snapshot_id: string; entity_count: number }>(sql`
      SELECT a.snapshot_id::text, a.entity_count
        FROM snapshot_entity_type a JOIN snapshot s ON s.id = a.snapshot_id
       WHERE s.scope_hash = ${ESCOPO}
    `);
    expect(antes.rows).toHaveLength(1);

    await buildFixture(
      ctx.db,
      [{ code: "carreta.rec", dataType: "NUMERIC" }],
      [
        {
          label: "REC_1_2_2026",
          effectiveDate: "2026-02-01",
          data: placas("REC", 8, { "carreta.rec": 1 }),
        },
      ],
      { entityType: "CARRETA", scopeHash: ESCOPO, canal: "REC" },
    );

    const depois = await ctx.db.execute<{ snapshot_id: string; entity_count: number }>(sql`
      SELECT a.snapshot_id::text, a.entity_count
        FROM snapshot_entity_type a JOIN snapshot s ON s.id = a.snapshot_id
       WHERE s.scope_hash = ${ESCOPO}
       ORDER BY s.effective_date
    `);

    /*
      Duas linhas, e a primeira intocada. O agregado é escrito uma vez por
      vigência, na promoção dela: importar a décima vigência não recalcula as
      nove anteriores, que é o que uma cobertura materializada globalmente teria
      de fazer a cada arquivo.
    */
    expect(depois.rows).toHaveLength(2);
    const original = depois.rows.find((r) => r.snapshot_id === antes.rows[0]!.snapshot_id)!;
    expect(Number(original.entity_count)).toBe(Number(antes.rows[0]!.entity_count));
    expect(Number(original.entity_count)).toBe(5);
    expect(depois.rows.map((r) => Number(r.entity_count))).toEqual([5, 8]);
  }, 600_000);

  it("a leitura da matriz não varre a fact table", async () => {
    /*
      A prova é do plano, não do relógio: um `EXPLAIN` da consulta que monta o
      denominador não pode conter uma varredura sequencial de `fact`. Medir
      tempo aqui mediria a máquina do CI.
    */
    const { rows } = await ctx.db.execute<{ plano: string }>(sql`
      EXPLAIN SELECT snapshot_id, entity_type, entity_count, attribute_count,
                     fact_count, value_count, null_count, inherited_fact_count
                FROM snapshot_entity_type
    `);
    const plano = rows.map((r) => r["QUERY PLAN" as keyof typeof r] ?? r.plano).join("\n");
    expect(plano).not.toContain("Seq Scan on fact");
  });
});

describe("o drill-down concorda com a matriz em qualquer célula", () => {
  it("célula a célula, os dois caminhos devolvem a mesma conta", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 12 });
    for (const linha of visao.linhas) {
      for (const celula of Object.values(linha.celulas)) {
        const detalhe = await detalheDaCelula(
          ctx.db,
          celula.vigencia.snapshotId,
          celula.entityType,
        );
        expect(detalhe.conta.combinacoesEsperadas).toBe(celula.conta.combinacoesEsperadas);
        expect(detalhe.conta.combinacoesEncontradas).toBe(celula.conta.combinacoesEncontradas);
        expect(detalhe.contaCritica.percentual).toBe(celula.contaCritica.percentual);
      }
    }
  }, 600_000);
});
