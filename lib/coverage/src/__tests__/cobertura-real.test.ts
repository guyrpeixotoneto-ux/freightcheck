import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
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
import { refazerAgregado } from "../agregado";
import { semearContrato } from "../contrato";
import { descobertas } from "../descoberta";
import { detalheDaCelula, detalheDaLacuna, historicoDoAtributo } from "../detalhe";
import { visaoDaCobertura } from "../matriz";
import { entidadesDoAtributo, vigenciasObservadas } from "../observado";
import { contribuintesDaVigencia, provenienciaDoFato } from "../proveniencia";

/**
 * A cobertura sobre o export real, com os dois arquivos complementares.
 *
 * Este arquivo prova o que só dado de verdade prova: que a consolidação de
 * arquivos que se completam produz **uma** cobertura e não três, que reimportar
 * não infla nada, que a proveniência sobrevive à consolidação, e que vigências
 * e escopos não contaminam uns aos outros.
 *
 * A montagem é a real: `Modelo_Carreta.xlsx` primeiro, `Modelo_Cavalo.xlsx`
 * depois. O segundo não abre vigências novas — ele revisa as nove que o
 * primeiro abriu, e é essa revisão que junta os dois equipamentos sob a mesma
 * identidade canônica.
 */
let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("cobertura_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
  await semearContrato(ctx.db);
}, 900_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("1. dois arquivos complementares formam uma cobertura consolidada", () => {
  it("as nove vigências cobrem os dois equipamentos, não uma família por arquivo", async () => {
    const vigencias = await vigenciasObservadas(ctx.db);
    expect(vigencias).toHaveLength(9);

    for (const v of vigencias) {
      const tipos = v.equipamentos.map((e) => e.entityType).sort();
      expect(tipos).toEqual(["CARRETA", "CAVALO"]);
      /*
        A revisão 2 é a marca da consolidação: o arquivo de cavalos não abriu
        uma segunda vigência ativa, ele revisou a que o de carretas criou.
      */
      expect(v.revision).toBe(2);
      expect(v.datasetFamily).toBe("REMUNERACAO_EQUIPAMENTO");
    }
  });

  it("a matriz tem uma linha por equipamento, e as duas na mesma família", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    expect(visao.linhas).toHaveLength(2);
    expect(visao.linhas.map((l) => l.entityType).sort()).toEqual(["CARRETA", "CAVALO"]);
    expect(new Set(visao.linhas.map((l) => l.datasetFamily))).toEqual(
      new Set(["REMUNERACAO_EQUIPAMENTO"]),
    );
    expect(visao.colunas).toHaveLength(9);
    expect(visao.incompleto).toEqual([]);
  });

  it("as entidades das duas séries somam o universo, sem dupla contagem", async () => {
    const vigencias = await vigenciasObservadas(ctx.db);
    const ultima = vigencias[vigencias.length - 1]!;
    const total = ultima.equipamentos.reduce((s, e) => s + e.entidades, 0);

    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT entity_id)::int AS n FROM fact WHERE snapshot_id = ${ultima.snapshotId}::uuid
    `);
    expect(total).toBe(Number(rows[0]!.n));
  });

  it("o agregado bate exatamente com a contagem sobre os fatos", async () => {
    /*
      A tabela `snapshot_entity_type` é o denominador de toda a matriz. Se ela
      divergir dos fatos, todo percentual do módulo está errado — e o erro seria
      invisível, porque a tela nunca conta fatos. Esta é a prova de que o
      agregado escrito na promoção é o mesmo número que a fact table daria.
    */
    const { rows } = await ctx.db.execute<{ divergentes: number }>(sql`
      WITH direto AS (
        SELECT f.snapshot_id, e.entity_type,
               count(DISTINCT f.entity_id)::int AS entidades,
               count(*)::int                    AS fatos,
               count(*) FILTER (WHERE NOT f.is_null)::int AS com_valor
          FROM fact f JOIN entity e ON e.id = f.entity_id
         GROUP BY 1, 2
      )
      SELECT count(*)::int AS divergentes
        FROM direto d
        JOIN snapshot_entity_type a
          ON a.snapshot_id = d.snapshot_id AND a.entity_type = d.entity_type
       WHERE a.entity_count <> d.entidades
          OR a.fact_count   <> d.fatos
          OR a.value_count  <> d.com_valor
    `);
    expect(Number(rows[0]!.divergentes)).toBe(0);
  });
});

describe("2. reimportar o mesmo dado não aumenta a cobertura", () => {
  it("o mesmo arquivo é recusado e o número não se move", async () => {
    const antes = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const { cavalo } = modelExportPaths();

    /* O SHA-256 barra o arquivo antes mesmo de ele ser lido. */
    const { receiveFile } = await import("@workspace/ingest");
    const recebido = await receiveFile(ctx.db, { filePath: cavalo });
    expect(recebido.isDuplicate).toBe(true);

    const depois = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    expect(depois.resumo.geral.combinacoesEncontradas).toBe(
      antes.resumo.geral.combinacoesEncontradas,
    );
    expect(depois.resumo.geral.percentual).toBe(antes.resumo.geral.percentual);
    expect(depois.linhas).toHaveLength(antes.linhas.length);
  });

  it("nenhuma vigência SUPERSEDED entra na conta", async () => {
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM snapshot WHERE status = 'SUPERSEDED'
    `);
    /* A montagem produziu nove revisões substituídas — todas fora da matriz. */
    expect(Number(rows[0]!.n)).toBe(9);

    const vigencias = await vigenciasObservadas(ctx.db);
    expect(vigencias.every((v) => v.revision === 2)).toBe(true);
  });
});

describe("10. o drill-down chega às entidades certas", () => {
  it("a célula abre com a mesma conta que a matriz mostrou", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const linha = visao.linhas.find((l) => l.entityType === "CAVALO")!;
    const ultima = visao.colunas[visao.colunas.length - 1]!;
    const celula = linha.celulas[ultima.chave]!;

    const detalhe = await detalheDaCelula(ctx.db, celula.vigencia.snapshotId, "CAVALO");
    expect(detalhe.conta.percentual).toBe(celula.conta.percentual);
    expect(detalhe.conta.combinacoesEsperadas).toBe(celula.conta.combinacoesEsperadas);
    expect(detalhe.contaCritica.percentual).toBe(celula.contaCritica.percentual);
    expect(detalhe.equipamentoLabel).toBe("Cavalo");
  });

  it("desce até a placa, e a placa é uma das entidades daquela vigência", async () => {
    const vigencias = await vigenciasObservadas(ctx.db);
    const ultima = vigencias[vigencias.length - 1]!;

    const entidades = await entidadesDoAtributo(
      ctx.db,
      ultima.snapshotId,
      "cavalo.ipva_licenciamento",
      { limite: 500 },
    );
    const cavalos = ultima.equipamentos.find((e) => e.entityType === "CAVALO")!;
    expect(entidades).toHaveLength(cavalos.entidades);
    expect(entidades.every((e) => e.entityType === "CAVALO")).toBe(true);
    /* Placa de verdade, não um uuid abreviado. */
    expect(entidades.some((e) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(e.identificador))).toBe(
      true,
    );
    expect(entidades.filter((e) => e.estado === "PRESENTE").length).toBeGreaterThan(0);
  });

  it("a lista de uma lacuna diz quantas ficaram de fora, em vez de truncar calada", async () => {
    const vigencias = await vigenciasObservadas(ctx.db);
    const ultima = vigencias[vigencias.length - 1]!;
    const detalhe = await detalheDaLacuna(
      ctx.db,
      ultima.snapshotId,
      "cavalo.ipva_licenciamento",
      5,
    );
    expect(detalhe).not.toBeNull();
    expect(detalhe!.entidades.length).toBeLessThanOrEqual(5);
    expect(detalhe!.naoListadas).toBeGreaterThanOrEqual(0);
    expect(detalhe!.attributeLabel).toBeTruthy();
  });
});

describe("11. a proveniência aponta para a importação e o arquivo certos", () => {
  it("um valor chega até a célula da planilha e ao SHA-256 do arquivo", async () => {
    const vigencias = await vigenciasObservadas(ctx.db);
    const ultima = vigencias[vigencias.length - 1]!;
    const entidades = await entidadesDoAtributo(
      ctx.db,
      ultima.snapshotId,
      "cavalo.ipva_licenciamento",
      { limite: 5 },
    );
    const comValor = entidades.find((e) => e.estado === "PRESENTE")!;
    expect(comValor.factId).not.toBeNull();

    const p = await provenienciaDoFato(ctx.db, comValor.factId!);
    expect(p).not.toBeNull();
    expect(p!.atributo.code).toBe("cavalo.ipva_licenciamento");
    expect(p!.entidade.identificador).toBe(comValor.identificador);
    expect(p!.vigencia.snapshotId).toBe(ultima.snapshotId);
    expect(p!.importacao.arquivo).toMatch(/Modelo_Cavalo/);
    expect(p!.importacao.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p!.celula.aba).toBeTruthy();
    expect(p!.celula.linha).toBeGreaterThan(0);
    expect(p!.celula.coluna).toMatch(/^[A-Z]+$/);
  });

  it("um fato herdado aponta para o arquivo que o trouxe, não para o que o carregou", async () => {
    /*
      As carretas da revisão 2 vieram herdadas: o arquivo daquela revisão é o de
      cavalos. Se a herança tivesse reescrito `raw_cell_id`, a proveniência da
      carreta apontaria para o arquivo errado — e a cadeia inteira do produto
      deixaria de valer sem que nada quebrasse.
    */
    const vigencias = await vigenciasObservadas(ctx.db);
    const ultima = vigencias[vigencias.length - 1]!;
    const { rows } = await ctx.db.execute<{ id: string }>(sql`
      SELECT f.id::text AS id FROM fact f
       WHERE f.snapshot_id = ${ultima.snapshotId}::uuid
         AND f.inherited_from_snapshot_id IS NOT NULL
       LIMIT 1
    `);
    expect(rows).toHaveLength(1);

    const p = await provenienciaDoFato(ctx.db, Number(rows[0]!.id));
    expect(p!.herdadoDe).not.toBeNull();
    expect(p!.importacao.arquivo).toMatch(/Modelo_Carreta/);
    expect(p!.entidade.entityType).toBe("CARRETA");
  });

  it("a vigência diz quais arquivos a formaram, e com quantos fatos cada um", async () => {
    const vigencias = await vigenciasObservadas(ctx.db);
    const ultima = vigencias[vigencias.length - 1]!;
    const contribuintes = await contribuintesDaVigencia(ctx.db, ultima.snapshotId);

    expect(contribuintes).toHaveLength(2);
    expect(contribuintes.map((c) => c.arquivo).sort()).toEqual([
      expect.stringMatching(/Modelo_Carreta/),
      expect.stringMatching(/Modelo_Cavalo/),
    ]);
    /* Um deles contribuiu só por herança; o outro, com o que acabou de chegar. */
    expect(contribuintes.some((c) => c.herdados > 0)).toBe(true);
    expect(contribuintes.some((c) => c.herdados === 0)).toBe(true);
  });
});

describe("13 e 14. vigências e escopos não contaminam uns aos outros", () => {
  it("cada célula conta só a sua vigência", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const cavalo = visao.linhas.find((l) => l.entityType === "CAVALO")!;

    for (const coluna of visao.colunas) {
      const celula = cavalo.celulas[coluna.chave]!;
      expect(celula.vigencia.effectiveDate).toBe(coluna.effectiveDate);

      const { rows } = await ctx.db.execute<{ n: number }>(sql`
        SELECT entity_count AS n FROM snapshot_entity_type
         WHERE snapshot_id = ${celula.vigencia.snapshotId}::uuid AND entity_type = 'CAVALO'
      `);
      expect(celula.conta.entidadesEsperadas).toBe(Number(rows[0]!.n));
    }

    /* As entidades mudam entre vigências — logo, não houve reaproveitamento. */
    const contagens = visao.colunas.map(
      (c) => cavalo.celulas[c.chave]!.conta.entidadesEsperadas,
    );
    expect(new Set(contagens).size).toBeGreaterThan(1);
  });

  it("o histórico de um atributo é por vigência, e a série tem os nove pontos", async () => {
    const serie = await historicoDoAtributo(ctx.db, "cavalo.ipva_licenciamento");
    expect(serie).toHaveLength(9);
    expect(serie.map((p) => p.effectiveDate)).toEqual(
      [...serie.map((p) => p.effectiveDate)].sort(),
    );
    expect(serie.every((p) => p.noLayout)).toBe(true);
    expect(serie.every((p) => p.percentual === 100)).toBe(true);
  });

  it("um escopo pedido que não existe devolve nada em vez de devolver o de outro", async () => {
    const visao = await visaoDaCobertura(ctx.db, { scopeHash: "escopo-que-nao-existe" });
    expect(visao.linhas).toEqual([]);
    expect(visao.colunas).toEqual([]);
    expect(visao.resumo.veredito.estado).toBe("SEM_DADO");
  });

  it("a consulta por família filtra, e por outra família não devolve nada", async () => {
    const daFamilia = await visaoDaCobertura(ctx.db, {
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      vigencias: 9,
    });
    expect(daFamilia.linhas).toHaveLength(2);

    const inexistente = await visaoDaCobertura(ctx.db, { datasetFamily: "CUSTOS_OPERACAO" });
    expect(inexistente.linhas).toEqual([]);
  });
});

describe("o contrato e a cobertura crítica sobre o dado real", () => {
  it("o contrato foi semeado e é o que define a criticidade", async () => {
    const { rows } = await ctx.db.execute<{ n: number; criticos: number }>(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE criticality = 'CRITICO')::int AS criticos
        FROM coverage_expectation WHERE origin = 'CONTRATO'
    `);
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    expect(Number(rows[0]!.criticos)).toBeGreaterThan(0);
  });

  it("semear duas vezes não duplica nada", async () => {
    const antes = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM coverage_expectation`,
    );
    const r = await semearContrato(ctx.db);
    const depois = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM coverage_expectation`,
    );
    expect(r.inseridos).toBe(0);
    expect(Number(depois.rows[0]!.n)).toBe(Number(antes.rows[0]!.n));
  });

  it("o resumo responde a pergunta do módulo com uma frase, não só um número", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    expect(visao.resumo.veredito.frase).toBeTruthy();
    expect(["CONFIAVEL", "COMPROMETIDA", "SEM_DADO"]).toContain(
      visao.resumo.veredito.estado,
    );
    expect(visao.resumo.geral.percentual).toBeGreaterThan(0);
    expect(visao.resumo.geral.percentual).toBeLessThanOrEqual(100);
    /* Toda lacuna devolvida carrega o porquê. */
    for (const lacuna of visao.lacunas) {
      expect(lacuna.justificativa.motivo.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("descoberta sobre o export real", () => {
  it("não inventa campo novo quando nada mudou de nome na última vigência", async () => {
    const achados = await descobertas(ctx.db);
    /*
      O export real entrega as mesmas 138 colunas nas nove vigências. Um módulo
      que anunciasse novidades aqui estaria produzindo ruído — e ruído neste
      lugar treina o usuário a ignorar a seção justamente quando ela importar.
    */
    expect(achados).toEqual([]);
  });

  it("todo atributo do dicionário existe desde a primeira vigência", async () => {
    const achados = await descobertas(ctx.db, { desdeVigencia: "1900-01-01", limite: 500 });
    expect(achados.length).toBe(138);
    expect(achados.every((a) => a.arquivo !== null)).toBe(true);
    expect(achados.every((a) => a.entidadesAfetadas > 0)).toBe(true);
  });
});

/*
  Fica por último de propósito: é o único bloco deste arquivo que apaga uma
  tabela, e vindo depois de tudo ele não pode alterar o que os anteriores
  mediram. O que ele prova sobre dado real, e a fixture de `agregado.test.ts`
  não alcança, é que a reconstrução reproduz o agregado que a **promoção**
  escreveu — a de verdade, sobre 124 mil fatos, com herança entre revisões.
*/
describe("o agregado perdido, refeito sobre o dado real", () => {
  it("refazer devolve exatamente o que `promote` tinha gravado", async () => {
    const chave = (r: Record<string, unknown>) => `${r.snapshot_id}|${r.entity_type}`;
    const ler = async () => {
      const { rows } = await ctx.db.execute<Record<string, unknown>>(sql`
        SELECT snapshot_id::text, entity_type, entity_count, attribute_count,
               fact_count, value_count, null_count, inherited_fact_count
          FROM snapshot_entity_type
         ORDER BY snapshot_id, entity_type
      `);
      return new Map(rows.map((r) => [chave(r), JSON.stringify(r)]));
    };

    const daPromocao = await ler();
    expect(daPromocao.size).toBeGreaterThan(0);
    /*
      A herança é o que torna esta comparação interessante: a revisão 2 traz
      fatos herdados da 1, e `inherited_fact_count` só está certo se a
      reconstrução contar `inherited_from_snapshot_id` como a promoção conta.
    */
    const comHeranca = [...daPromocao.values()].filter(
      (v) => (JSON.parse(v) as { inherited_fact_count: number }).inherited_fact_count > 0,
    );
    expect(comHeranca.length).toBeGreaterThan(0);

    await ctx.db.execute(sql`DELETE FROM snapshot_entity_type`);

    const cega = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    expect(cega.linhas).toEqual([]);
    expect(cega.incompleto.length).toBeGreaterThan(0);
    expect(cega.resumo.veredito.frase).not.toMatch(/[Nn]enhuma vigência importada/);

    const reparo = await refazerAgregado(ctx.db);
    expect(reparo.vigencias).toBeGreaterThan(0);
    expect(await ler()).toEqual(daPromocao);

    const restaurada = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    expect(restaurada.linhas).toHaveLength(2);
    expect(restaurada.incompleto).toEqual([]);
  });
});
