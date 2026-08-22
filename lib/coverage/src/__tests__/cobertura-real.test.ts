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
import { BaixaRecusada, registrarBaixa } from "../frota";
import { descobertas } from "../descoberta";
import { detalheDaCelula, detalheDaLacuna, historicoDoAtributo } from "../detalhe";
import { visaoDaCobertura } from "../matriz";
import { matrizDeAtributos } from "../atributos";
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

  /*
    Três linhas, e a terceira é a que este módulo passou a saber desenhar.

    O export real traz cavalo e carreta. O trecho está declarado no catálogo —
    110 atributos — e nunca chegou em arquivo nenhum. Enquanto a matriz era
    montada sobre `vigencia.equipamentos`, ele simplesmente não tinha linha, e
    um tipo sem linha não consegue estar ausente na tela: a cobertura fechava
    100% ignorando um terço do universo declarado.

    O teste guarda as duas metades disso ao mesmo tempo — que a linha existe, e
    que ela está `AUSENTE` em todas as vigências. Uma sem a outra seria pior do
    que nada: uma linha de trecho que aparecesse `COMPLETO` por não ter nada a
    comparar seria a mentira que a linha veio desfazer.
  */
  it("a matriz tem uma linha por equipamento declarado, inclusive o que nunca chegou", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    expect(visao.linhas.map((l) => l.entityType).sort()).toEqual([
      "CARRETA",
      "CAVALO",
      "TRECHO",
    ]);
    expect(new Set(visao.linhas.map((l) => l.datasetFamily))).toEqual(
      new Set(["REMUNERACAO_EQUIPAMENTO"]),
    );
    expect(visao.colunas).toHaveLength(9);
    expect(visao.incompleto).toEqual([]);

    const trecho = visao.linhas.find((l) => l.entityType === "TRECHO")!;
    const celulasDoTrecho = Object.values(trecho.celulas);
    expect(celulasDoTrecho).toHaveLength(visao.colunas.length);
    for (const celula of celulasDoTrecho) {
      expect(celula.estado).toBe("AUSENTE");
      expect(celula.conta.combinacoesEncontradas).toBe(0);
      expect(celula.conta.combinacoesEsperadas).toBeGreaterThan(0);
    }
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
      /*
        O **encontrado** é o que a vigência trouxe; o **esperado** já não é.

        Esta asserção comparava `entidadesEsperadas` com `entity_count`, e era
        a forma escrita do problema: o denominador saía do próprio arquivo, de
        modo que um cavalo que sumisse saía dos dois lados da fração e o
        percentual não se mexia. Agora o esperado é o roster — o que chegou mais
        o que faltou —, e a identidade que sobrevive é a do numerador.
      */
      expect(celula.conta.entidadesEncontradas).toBe(Number(rows[0]!.n));
      expect(celula.conta.entidadesEsperadas).toBe(
        celula.conta.entidadesEncontradas + celula.entidadesAusentes.length,
      );
    }

    /* As entidades mudam entre vigências — logo, não houve reaproveitamento. */
    const contagens = visao.colunas.map(
      (c) => cavalo.celulas[c.chave]!.conta.entidadesEncontradas,
    );
    expect(new Set(contagens).size).toBeGreaterThan(1);
  });

  /*
    A frota que encolheu no export real, e que a cobertura não via.

    Nove carretas e dois cavalos aparecem até a vigência de 02/04/2026 e não
    aparecem em nenhuma depois. Enquanto o denominador era o próprio arquivo,
    isso era literalmente invisível: os 11 sumiam do numerador e do denominador
    ao mesmo tempo, e a célula seguia no mesmo percentual.

    O teste fixa as duas metades do comportamento novo. Que a ausência é
    detectada — com placa, com a última vigência em que a entidade apareceu — e
    que ela **continua** contando nas vigências seguintes, porque ninguém
    declarou a baixa. A segunda é a que costuma ser confundida com bug: é o
    mecanismo, e o que o encerra é `registrarBaixa`, não o tempo.
  */
  it("acusa os equipamentos que sumiram do export e não voltaram", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const posteriores = visao.colunas.filter((c) => c.effectiveDate > "2026-04-02");
    expect(posteriores.length).toBeGreaterThan(0);

    for (const tipo of ["CAVALO", "CARRETA"] as const) {
      const linha = visao.linhas.find((l) => l.entityType === tipo)!;
      for (const coluna of posteriores) {
        const celula = linha.celulas[coluna.chave]!;
        expect(celula.entidadesAusentes.length).toBeGreaterThan(0);
        for (const ausente of celula.entidadesAusentes) {
          expect(ausente.rotulo).toBeTruthy();
          expect(ausente.ultimaVigencia < coluna.effectiveDate).toBe(true);
          expect(ausente.vigenciasComDado).toBeGreaterThan(0);
        }
      }
    }
  });


  /*
    A baixa curada é a única saída, e ela precisa de dono e de motivo.

    A ausência inferida não expira sozinha — de propósito. Se ela expirasse, um
    caminhão que sumiu por erro de exportação viraria silêncio no mês seguinte,
    que é exatamente o silêncio que este módulo veio desfazer. O que a encerra é
    alguém dizer "saiu da frota, e foi por isto", e o teste prova as duas
    metades: que a decisão apaga a lacuna daquela entidade, e que ela não apaga
    a das outras.
  */
  it("uma baixa registrada tira aquele equipamento da conta, e só aquele", async () => {
    const antes = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const ultima = antes.colunas[antes.colunas.length - 1]!;
    const linha = antes.linhas.find((l) => l.entityType === "CARRETA")!;
    const celula = linha.celulas[ultima.chave]!;
    const alvo = celula.entidadesAusentes[0]!;
    const quantasAntes = celula.entidadesAusentes.length;
    expect(quantasAntes).toBeGreaterThan(1);

    await expect(
      registrarBaixa(ctx.db, {
        datasetFamily: celula.datasetFamily,
        entityType: "CARRETA",
        entityId: alvo.entityId,
        status: "BAIXA",
        efetivoDe: "2026-05-01",
        motivo: "   ",
        ator: "teste",
      }),
    ).rejects.toBeInstanceOf(BaixaRecusada);

    await registrarBaixa(ctx.db, {
      datasetFamily: celula.datasetFamily,
      entityType: "CARRETA",
      entityId: alvo.entityId,
      status: "BAIXA",
      efetivoDe: "2026-05-01",
      motivo: "Implemento devolvido ao locador em 30/04; conferido no contrato.",
      ator: "teste",
    });

    const depois = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const celulaDepois = depois.linhas.find((l) => l.entityType === "CARRETA")!.celulas[
      ultima.chave
    ]!;
    expect(celulaDepois.entidadesAusentes.map((a) => a.entityId)).not.toContain(alvo.entityId);
    expect(celulaDepois.entidadesAusentes).toHaveLength(quantasAntes - 1);
    expect(celulaDepois.conta.entidadesEsperadas).toBe(celula.conta.entidadesEsperadas - 1);

    /* E o evento de curadoria ficou, que é o que torna a decisão auditável. */
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM curation_event
       WHERE target_kind = 'ENTITY_EXPECTATION' AND target_id = ${alvo.entityId}::uuid
    `);
    expect(Number(rows[0]!.n)).toBe(1);
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
    expect(daFamilia.linhas).toHaveLength(3);

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

/**
 * A linha da matriz aberta por dentro, sobre o dado real.
 *
 * O que estas provas guardam é a promessa que o degrau novo faz: **a soma das
 * linhas de atributo fecha com o número da célula que as abriu**. Se ela não
 * fechasse, a tela mostraria 88,1% na célula e uma tabela por dentro dela que
 * diz outra coisa — e quem lê não teria como saber qual das duas acreditar.
 */
describe("a matriz de atributos sobre o export real", () => {
  it("usa as mesmas colunas da matriz que a abriu", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const cavalo = visao.linhas.find((l) => l.entityType === "CAVALO")!;

    const aberta = await matrizDeAtributos(ctx.db, {
      datasetFamily: cavalo.datasetFamily,
      entityType: cavalo.entityType,
      scopeHash: cavalo.scopeHash,
      canal: cavalo.canal,
      vigencias: 9,
    });

    expect(aberta.colunas.map((c) => c.chave)).toEqual(visao.colunas.map((c) => c.chave));
    expect(aberta.conjunto.rotulo).toBe(cavalo.rotulo);
    expect(aberta.linhas.length).toBeGreaterThan(0);
  });

  /*
    A prova central deste degrau.

    A célula é a soma dos atributos esperados dela — é a definição que
    `medirCelula` usa. Depois de `medirAtributo` existir, as duas telas leem a
    mesma função, e este teste é o que impede alguém de reintroduzir uma segunda
    aritmética aqui sem que a suíte reprove.
  */
  it("a soma das linhas de atributo é exatamente a conta da célula", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });

    for (const linha of visao.linhas) {
      const aberta = await matrizDeAtributos(ctx.db, {
        datasetFamily: linha.datasetFamily,
        entityType: linha.entityType,
        scopeHash: linha.scopeHash,
        canal: linha.canal,
        vigencias: 9,
      });

      for (const [chave, celula] of Object.entries(linha.celulas)) {
        const doPeriodo = aberta.linhas
          .map((a) => a.celulas[chave])
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
          /* A célula só conta o que era esperado e não foi dispensado. */
          .filter((c) => c.esperado);

        expect(doPeriodo.reduce((s, c) => s + c.entidadesEsperadas, 0)).toBe(
          celula.conta.combinacoesEsperadas,
        );
        expect(doPeriodo.reduce((s, c) => s + c.entidadesPresentes, 0)).toBe(
          celula.conta.combinacoesEncontradas,
        );
        expect(doPeriodo.reduce((s, c) => s + c.naoAplicaveis, 0)).toBe(
          celula.conta.combinacoesNaoAplicaveis,
        );
        expect(doPeriodo).toHaveLength(celula.conta.atributosEsperados);
      }
    }
  });

  /*
    O conjunto declarado que nunca chegou é o caso que a matriz sozinha só sabe
    pintar de vermelho. Aberto, ele passa a dizer **quais** 110 colunas o
    catálogo cobra e que nenhum arquivo trouxe — que é a lista que alguém
    precisa levar para a origem.
  */
  it("o conjunto que nunca chegou lista os atributos que o catálogo cobra", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const trecho = visao.linhas.find((l) => l.entityType === "TRECHO")!;

    const aberta = await matrizDeAtributos(ctx.db, {
      datasetFamily: trecho.datasetFamily,
      entityType: trecho.entityType,
      scopeHash: trecho.scopeHash,
      canal: trecho.canal,
      vigencias: 9,
    });

    expect(aberta.linhas.length).toBeGreaterThan(0);
    expect(aberta.resumo.nuncaChegaram).toBe(aberta.linhas.length);
    for (const linha of aberta.linhas) {
      expect(linha.pior).toBe("AUSENTE");
      expect(linha.origem).not.toBeNull();
      expect(linha.declarado).toBe(true);
      expect(Object.values(linha.celulas).every((c) => c.estado === "AUSENTE")).toBe(true);
      /* A explicação viaja junto: uma lacuna sem motivo é um palpite. */
      expect(linha.motivo).toBeTruthy();
    }
  });

  it("o que chegou aparece ao lado do que falta, e não só o que falta", async () => {
    const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
    const carreta = visao.linhas.find((l) => l.entityType === "CARRETA")!;

    const aberta = await matrizDeAtributos(ctx.db, {
      datasetFamily: carreta.datasetFamily,
      entityType: carreta.entityType,
      scopeHash: carreta.scopeHash,
      canal: carreta.canal,
      vigencias: 9,
    });

    const comDado = aberta.linhas.filter((l) =>
      Object.values(l.celulas).some((c) => c.entidadesPresentes > 0),
    );
    expect(comDado.length).toBeGreaterThan(0);
    expect(aberta.resumo.atributos).toBe(aberta.linhas.length);
    expect(aberta.resumo.comFalta).toBeLessThanOrEqual(aberta.resumo.atributos);
    /* Toda linha é de um equipamento só — o recorte é (família · equipamento). */
    expect(new Set(aberta.linhas.map((l) => l.entityType))).toEqual(new Set(["CARRETA"]));
  });

  it("um escopo que não existe devolve tabela vazia, e não a de outro", async () => {
    const aberta = await matrizDeAtributos(ctx.db, {
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      entityType: "CAVALO",
      scopeHash: "escopo-que-nao-existe",
      canal: "EMPURRADA",
      vigencias: 9,
    });
    expect(aberta.linhas).toEqual([]);
    expect(aberta.resumo.atributos).toBe(0);
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
    expect(restaurada.linhas).toHaveLength(3);
    expect(restaurada.incompleto).toEqual([]);
  });
});
