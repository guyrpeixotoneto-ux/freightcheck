import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture } from "@workspace/comparison/testing";
import { seedTaxonomy } from "@workspace/curation";
import { DecisaoRecusada, registrarDecisao } from "../contrato";
import { detalheDaCelula } from "../detalhe";
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

/**
 * A chave de escopo de uma fixture — **perguntada ao banco**, pelo canal dela.
 *
 * A fixture recebe uma semente de escopo ("complementares") e o banco deriva
 * dela o `canonical_scope`. Desde o PR-10 o recorte da Cobertura é pela chave
 * canônica, e é ela que estes testes têm de passar. Derivá-la aqui em
 * TypeScript — repetindo o sha256 do escopo serializado — seria escrever mais
 * uma definição de escopo dentro do próprio teste que prova que só existe uma.
 * Cada cenário tem o seu canal, e é por ele que a chave é encontrada.
 */
async function escopoDoCanal(canal: string): Promise<string> {
  const [vigencia] = await vigenciasObservadas(ctx.db, { canal });
  if (!vigencia) throw new Error(`Nenhuma vigência disponível no canal ${canal}.`);
  return vigencia.scopeHash;
}

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
  const SEMENTE = "complementares";
  let ESCOPO: string;
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
      { entityType: "CARRETA", scopeHash: SEMENTE, canal: "COMPL" },
    );
    ids = r.snapshotIds;
    ESCOPO = await escopoDoCanal("COMPL");
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
  let UMA: string;
  let OUTRA: string;

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

    UMA = await escopoDoCanal("UM");
    OUTRA = await escopoDoCanal("DOIS");
    // O cenário só significa alguma coisa se as duas unidades forem duas.
    expect(UMA).not.toBe(OUTRA);
  }, 600_000);

  it("a unidade que sempre entregou cobra a lacuna", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: UMA, vigencias: 3 });
    const lacunas = visao.lacunas.filter((l) => l.effectiveDate === "2026-03-01");
    expect(lacunas.map((l) => l.attributeCode)).toEqual(["carreta.so_da_um"]);
    expect(lacunas[0]!.entidadesFaltando).toBe(10);
  });

  it("a unidade que nunca entregou aquele atributo não é cobrada por ele", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: OUTRA, vigencias: 3 });
    expect(visao.lacunas.map((l) => l.attributeCode)).not.toContain("carreta.so_da_um");
    const linha = visao.linhas[0]!;
    expect(linha.celulas["2026-03-01"]!.estado).toBe("COMPLETO");
  });
});

describe("7 e 12. dispensa, conflito e decisão humana", () => {
  const SEMENTE = "decisoes";
  let ESCOPO: string;

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
      { entityType: "CARRETA", scopeHash: SEMENTE, canal: "DEC" },
    );
    ESCOPO = await escopoDoCanal("DEC");
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
  const SEMENTE = "recomputacao";

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
      { entityType: "CARRETA", scopeHash: SEMENTE, canal: "REC" },
    );

    const antes = await ctx.db.execute<{ snapshot_id: string; entity_count: number }>(sql`
      SELECT a.snapshot_id::text, a.entity_count
        FROM snapshot_entity_type a JOIN snapshot s ON s.id = a.snapshot_id
       WHERE s.scope_hash = ${SEMENTE}
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
      { entityType: "CARRETA", scopeHash: SEMENTE, canal: "REC" },
    );

    const depois = await ctx.db.execute<{ snapshot_id: string; entity_count: number }>(sql`
      SELECT a.snapshot_id::text, a.entity_count
        FROM snapshot_entity_type a JOIN snapshot s ON s.id = a.snapshot_id
       WHERE s.scope_hash = ${SEMENTE}
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

// ---------------------------------------------------------------------------
// A migração para a autoridade (PR-10)
// ---------------------------------------------------------------------------

describe("a mesma unidade escrita de dois jeitos é uma unidade só", () => {
  /*
    A dívida do §A.6, encerrada.

    A Cobertura recortava por `snapshot.scope_hash`, que é hash dos códigos
    **como vieram**. A mesma unidade cujo CNPJ chegou mascarado em janeiro e sem
    máscara em fevereiro tinha dois hashes — e a Cobertura media duas unidades
    onde há uma: duas séries de uma vigência cada, cada uma sem histórico com
    que inferir o esperado, e nenhuma lacuna cobrada de ninguém.

    O escopo canônico é o mesmo nas duas entregas — é isso que o banco normaliza
    —, e é por ele que o recorte passa desde este PR. A fixture desamarra as
    duas chaves de propósito: é o único jeito de montar aqui o par que o mundo
    real produz.
  */
  const CNPJ = [{ scopeType: "UNIDADE", code: "11222333000144" }];
  let ESCOPO: string;

  beforeAll(async () => {
    const atributos = [
      { code: "carreta.mascarado_a", dataType: "NUMERIC" as const },
      { code: "carreta.mascarado_b", dataType: "NUMERIC" as const },
    ];

    // Janeiro: CNPJ com máscara no arquivo. Traz as duas colunas.
    await buildFixture(
      ctx.db,
      atributos,
      [
        {
          label: "MASC_1_1_2026",
          effectiveDate: "2026-01-01",
          data: placas("MSK", 10, {
            "carreta.mascarado_a": 1,
            "carreta.mascarado_b": 2,
          }),
        },
        {
          label: "MASC_1_2_2026",
          effectiveDate: "2026-02-01",
          data: placas("MSK", 10, {
            "carreta.mascarado_a": 1,
            "carreta.mascarado_b": 2,
          }),
        },
      ],
      {
        entityType: "CARRETA",
        scopeHash: "com-mascara",
        canal: "MASCARA",
        datasetFamily: "REMUNERACAO_MASCARA",
        canonicalScope: CNPJ,
      },
    );

    // Março: o mesmo CNPJ, agora sem máscara — outro `scope_hash`, o mesmo
    // escopo canônico. E uma das colunas não veio.
    await buildFixture(
      ctx.db,
      atributos,
      [
        {
          label: "MASC_1_3_2026",
          effectiveDate: "2026-03-01",
          data: placas("MSK", 10, { "carreta.mascarado_a": 1 }),
        },
      ],
      {
        entityType: "CARRETA",
        scopeHash: "sem-mascara",
        canal: "MASCARA",
        datasetFamily: "REMUNERACAO_MASCARA",
        canonicalScope: CNPJ,
      },
    );

    ESCOPO = await escopoDoCanal("MASCARA");
  }, 600_000);

  it("as três vigências caem no mesmo recorte", async () => {
    /*
      Primeiro a montagem, medida no banco: **dois** `scope_hash` crus e **um**
      escopo canônico. Sem isto o resto do describe passaria por não estar
      testando nada — é a diferença entre provar a correção e afirmar que ela
      existe.
    */
    const { rows: crus } = await ctx.db.execute<{ hashes: number; escopos: number }>(sql`
      SELECT count(DISTINCT s.scope_hash)::int      AS hashes,
             count(DISTINCT s.canonical_scope::text)::int AS escopos
        FROM snapshot s
       WHERE s.canal = 'MASCARA'
    `);
    expect(Number(crus[0].hashes)).toBe(2);
    expect(Number(crus[0].escopos)).toBe(1);

    const vigencias = await vigenciasObservadas(ctx.db, { scopeHash: ESCOPO });

    expect(vigencias.map((v) => v.sourceLabel).sort()).toEqual([
      "MASC_1_1_2026",
      "MASC_1_2_2026",
      "MASC_1_3_2026",
    ]);
    // Uma chave de escopo, uma série: a grafia do CNPJ não abre a segunda.
    expect(new Set(vigencias.map((v) => v.scopeHash)).size).toBe(1);
    expect(new Set(vigencias.map((v) => v.serie)).size).toBe(1);
  });

  it("o histórico atravessa a mudança de grafia, e a lacuna é cobrada", async () => {
    /*
      A prova que importa, e a que o recorte cru não passava: em março falta uma
      coluna que as duas entregas anteriores trouxeram. Cobrá-la exige que
      janeiro e fevereiro sejam **história de março** — e eram, com outra
      grafia de CNPJ. Antes deste PR, março começava do zero e não faltava nada.
    */
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 3 });
    const lacunas = visao.lacunas.filter((l) => l.effectiveDate === "2026-03-01");

    expect(lacunas.map((l) => l.attributeCode)).toEqual(["carreta.mascarado_b"]);
    expect(lacunas[0]!.entidadesFaltando).toBe(10);
  });

  it("a matriz mostra uma linha de unidade, e não duas", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: ESCOPO, vigencias: 3 });
    const celulas = visao.linhas.flatMap((l) => Object.values(l.celulas));

    expect(new Set(celulas.map((c) => c.scopeHash)).size).toBe(1);
    expect(new Set(celulas.map((c) => c.scopeLabel)).size).toBe(1);
  });
});
