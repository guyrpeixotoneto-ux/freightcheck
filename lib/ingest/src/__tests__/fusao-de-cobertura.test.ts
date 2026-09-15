import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import {
  DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
  DATASET_FAMILY_TABELA_DE_FRETE,
  datasetFamilyFor,
} from "../canonical-identity";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";

/**
 * QUANDO DOIS ARQUIVOS VIRAM UMA VIGÊNCIA SÓ — o que é contrato e o que era
 * defeito.
 *
 * ---------------------------------------------------------------------------
 * O relato, e o que ele custou
 * ---------------------------------------------------------------------------
 * Em 15/09/2026, na Auditoria de Km Rodado: o seletor oferecia `agosto/2026` e
 * `setembro/2026`, as duas cobrindo trecho, e clicar em qualquer uma não
 * selecionava nada. Eram dois defeitos empilhados. O de tela — o efeito que
 * desfazia a escolha de quem escolheu — está em `parReconciliado`. O de
 * acervo é este arquivo: **por que as duas vigências chegaram com coberturas
 * diferentes**, uma `TRECHO` e outra `CAVALO+TRECHO`, a ponto de o motor
 * recusar o par que a lista oferecia.
 *
 * ---------------------------------------------------------------------------
 * A identidade, e por que ela decide isto
 * ---------------------------------------------------------------------------
 * Uma vigência é identificada por (sistema, **família**, canal, data, escopo) —
 * `canonicalSnapshotKey`. `TRECHO` não tinha entrada em `FAMILY_BY_ENTITY_TYPE`
 * e caía no padrão inclusivo, que é a família do equipamento. Esse padrão é
 * certo para um DOLLY — um equipamento novo tem de ser **componente** da
 * vigência que já existe — e era o defeito para a tabela de frete, que não é um
 * equipamento a mais: é outro documento, de outro grão, que só por acaso
 * partilha unidade, canal e data com o export de equipamento.
 *
 * Partilhando a identidade, o segundo arquivo a chegar entrava como **revisão**
 * do primeiro e herdava os fatos dele, e a cobertura gravada virava a união.
 *
 * A `0099` deu família própria ao trecho (`TABELA_DE_FRETE`) e reparou o que já
 * tinha entrado fundido.
 *
 * ---------------------------------------------------------------------------
 * O que cada parte deste arquivo guarda
 * ---------------------------------------------------------------------------
 * As três partes exercitam **a mesma máquina** e querem coisas diferentes dela,
 * e é por isso que moram juntas: quem mexer numa precisa ver as outras.
 *
 * 1. **A herança que é o contrato.** Cavalo e carreta são componentes da mesma
 *    vigência de propósito: a Ambev entrega os dois em arquivos separados, e uma
 *    correção só de cavalos não pode apagar as carretas. A família própria do
 *    trecho não podia custar isto, e não custou — estes testes passavam antes da
 *    `0099` e passam depois, sem uma linha alterada.
 *
 * 2. **A separação que a `0099` garante.** O trecho abrindo vigência própria em
 *    vez de virar revisão do equipamento. Eram as asserções que registravam o
 *    defeito; hoje afirmam o comportamento correto.
 *
 * 3. **O reparo do que já entrou fundido.** Corrigir a regra não reescreve o
 *    que entrou com ela. A parte 3 monta o estado legado à mão — porque o
 *    pipeline corrigido não o produz mais — e prova que a função de reparo o
 *    desfaz, sem perder fato nenhum e sem mexer no equipamento.
 */

let ctx: TestDb;

const UNIDADE = "07.526.557/0015-05";

beforeAll(async () => {
  ctx = await createTestDatabase("fusao_de_cobertura");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Importa uma planilha do começo ao fim, como a tela faz. */
async function importar(
  caminho: string,
  declaredType: string,
): Promise<{ label: string; revision: number }[]> {
  const recebido = await receiveFile(ctx.db, { filePath: caminho, declaredType });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  // Um erro impeditivo aqui não é o assunto do teste: seria a planilha
  // sintética estar errada, e o silêncio faria o teste medir outra coisa.
  expect(relatorio.blockingErrors).toBe(0);
  const { snapshots } = await promote(ctx.db, recebido.importRunId, {
    confirmNewEntityTypes: [declaredType],
  });
  return snapshots.map((s) => ({ label: s.label, revision: s.revision }));
}

/**
 * Um export de equipamento, com colunas que **distinguem** um tipo do outro.
 *
 * As colunas próprias não são enfeite. O dicionário decide o tipo de uma aba
 * pela sobreposição de colunas (`classifyEntityType`), e uma aba cujas colunas
 * são todas de outro tipo pontua 100% para ele: duas abas sintéticas com as
 * mesmas duas colunas padrão fazem a carreta ser lida como cavalo, e a
 * declaração diverge do conteúdo — erro impeditivo antes de o teste chegar ao
 * assunto. Cada tipo levando o que só ele tem é o que reproduz, no sintético, a
 * folga que o export real tem de sobra (63 colunas de carreta contra 75 de
 * cavalo, 38 em comum).
 */
const COLUNAS_DE_CAVALO = ["Pneus Cavalo", "Manutencao Cavalo", "Combustivel"];
const COLUNAS_DE_CARRETA = ["Pneus Carreta", "Manutencao Carreta", "Eixos"];

const planilhaDeEquipamento = (
  vigencia: string,
  aba: string,
  colunas: string[],
  placas: string[],
) =>
  escreverPlanilha({
    vigencia,
    unidadeCnpj: UNIDADE,
    abas: [{ nome: aba, colunas, linhas: placas.map((placa) => ({ placa })) }],
  });

const planilhaDeTrecho = (vigencia: string, trechos: string[]) =>
  escreverPlanilha({
    vigencia,
    unidadeCnpj: UNIDADE,
    abas: [
      {
        nome: "Planilha1",
        identificador: "chaveTrecho",
        linhas: trechos.map((placa) => ({ placa })),
      },
    ],
  });

/**
 * A vigência ativa de um rótulo **numa família**.
 *
 * A família entrou no argumento com a `0099`: desde ela, o mesmo rótulo pode
 * ter duas vigências vivas — a do equipamento e a da tabela de frete —, e é
 * exatamente isso que estes testes querem poder afirmar. Sem o recorte, a
 * consulta que antes achava uma acharia duas e o teste morreria no `toHaveLength`
 * dizendo "duas vigências" onde o assunto é qual delas tem o quê.
 */
async function vigenciaAtiva(label: string, datasetFamily: string) {
  const { rows } = await ctx.db.execute<{
    entity_type_set: string;
    dataset_family: string;
    canonical_snapshot_key: string;
    revision: number;
    fact_count: number;
  }>(sql`
    SELECT entity_type_set, dataset_family, canonical_snapshot_key, revision, fact_count
      FROM snapshot
     WHERE source_label = ${label}
       AND dataset_family = ${datasetFamily}
       AND status <> 'SUPERSEDED'
  `);
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Quantos fatos de cada tipo a vigência tem, e quais foram herdados. */
async function fatosPorTipo(label: string, datasetFamily: string) {
  const { rows } = await ctx.db.execute<{
    entity_type: string;
    herdados: string;
    do_arquivo: string;
  }>(sql`
    SELECT e.entity_type,
           count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NOT NULL) AS herdados,
           count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NULL)     AS do_arquivo
      FROM snapshot s
      JOIN fact f   ON f.snapshot_id = s.id
      JOIN entity e ON e.id = f.entity_id
     WHERE s.source_label = ${label}
       AND s.dataset_family = ${datasetFamily}
       AND s.status <> 'SUPERSEDED'
     GROUP BY 1
     ORDER BY 1
  `);
  return rows.map((r) => ({
    tipo: r.entity_type,
    herdados: Number(r.herdados),
    doArquivo: Number(r.do_arquivo),
  }));
}

/**
 * A causa, em uma linha e sem banco nenhum.
 *
 * Esta é a asserção que diz **por quê**, e a única deste arquivo que roda em
 * milissegundos. As outras provam o efeito; esta nomeia a origem.
 */
/**
 * A causa, em uma linha e sem banco nenhum.
 *
 * Esta é a asserção que diz **por quê**, e a única deste arquivo que roda em
 * milissegundos. As outras provam o efeito; esta nomeia a origem.
 */
describe("a família de dataset de cada tipo", () => {
  /* O contrato: os dois equipamentos são componentes da mesma vigência. */
  it("põe CAVALO e CARRETA na mesma família", () => {
    expect(datasetFamilyFor("CAVALO")).toBe(DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO);
    expect(datasetFamilyFor("CAVALO")).toBe(datasetFamilyFor("CARRETA"));
  });

  /*
    A correção, dita na forma mais curta que existe.

    Era daqui que saía tudo o que os `describe` abaixo medem: sem entrada no
    mapa, TRECHO caía no padrão inclusivo e dividia identidade com o
    equipamento. Com família própria, a tabela de frete é entrega própria.
  */
  it("dá ao TRECHO família própria, fora da do equipamento", () => {
    expect(datasetFamilyFor("TRECHO")).toBe(DATASET_FAMILY_TABELA_DE_FRETE);
    expect(datasetFamilyFor("TRECHO")).not.toBe(datasetFamilyFor("CAVALO"));
  });

  /* O quadro de pessoal seguiu o mesmo caminho antes, e pela mesma razão. */
  it("mantém o quadro de pessoal fora das outras duas", () => {
    expect(datasetFamilyFor("QLP_OPERACIONAL")).not.toBe(datasetFamilyFor("CAVALO"));
    expect(datasetFamilyFor("QLP_OPERACIONAL")).not.toBe(datasetFamilyFor("TRECHO"));
    expect(datasetFamilyFor("QLP_ADMINISTRATIVO")).toBe(
      datasetFamilyFor("QLP_OPERACIONAL"),
    );
  });

  /*
    O padrão continua inclusivo para quem não está no mapa — é ele que faz um
    equipamento novo entrar como componente em vez de abrir identidade paralela,
    e dar família ao trecho não podia custar isso.
  */
  it("manda para a família do equipamento o tipo que o mapa não conhece", () => {
    expect(datasetFamilyFor("DOLLY")).toBe(DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO);
  });
});

describe("a herança entre cavalo e carreta", () => {
  const VIGENCIA = "EMPURRADA_1_7_2026";

  it("faz do segundo arquivo uma revisão que herda o primeiro", async () => {
    const primeiro = await importar(
      planilhaDeEquipamento(VIGENCIA, "cavalos", COLUNAS_DE_CAVALO, ["ABC1D23", "XYZ9K88"]),
      "CAVALO",
    );
    expect(primeiro).toEqual([{ label: VIGENCIA, revision: 1 }]);
    expect((await vigenciaAtiva(VIGENCIA, DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO)).entity_type_set).toBe("CAVALO");

    const segundo = await importar(
      planilhaDeEquipamento(VIGENCIA, "carretas", COLUNAS_DE_CARRETA, ["QWE4R56"]),
      "CARRETA",
    );
    expect(segundo).toEqual([{ label: VIGENCIA, revision: 2 }]);

    const ativa = await vigenciaAtiva(VIGENCIA, DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO);
    expect(ativa.entity_type_set).toBe("CARRETA+CAVALO");

    /*
      O cavalo veio herdado e a carreta veio do arquivo. É esta linha que prova
      que a revisão não apagou o componente que ela não tocou.
    */
    const fatos = await fatosPorTipo(VIGENCIA, DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO);
    const cavalo = fatos.find((f) => f.tipo === "CAVALO");
    const carreta = fatos.find((f) => f.tipo === "CARRETA");
    expect(cavalo?.herdados).toBeGreaterThan(0);
    expect(cavalo?.doArquivo).toBe(0);
    expect(carreta?.doArquivo).toBeGreaterThan(0);
    expect(carreta?.herdados).toBe(0);
  }, 300_000);
});

/**
 * A separação que a família própria garante.
 *
 * Eram as asserções que registravam o defeito. Hoje afirmam o contrário: o
 * mesmo par de arquivos, no mesmo dia e na mesma unidade, produz **duas
 * vigências** em vez de uma fundida.
 */
describe("a tabela de frete e o export de equipamento na mesma data", () => {
  const VIGENCIA = "EMPURRADA_1_9_2026";

  it("abre vigência própria para o trecho, e não uma revisão do equipamento", async () => {
    await importar(
      planilhaDeEquipamento(VIGENCIA, "cavalos", COLUNAS_DE_CAVALO, [
        "DEF2G34",
        "HIJ5K67",
      ]),
      "CAVALO",
    );
    const equipamento = await vigenciaAtiva(VIGENCIA, DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO);
    expect(equipamento.entity_type_set).toBe("CAVALO");

    const trecho = await importar(
      planilhaDeTrecho(VIGENCIA, ["CAMACARI-SALVADOR", "CAMACARI-FEIRA"]),
      "TRECHO",
    );

    /* Revisão 1 de uma vigência nova — e não a revisão 2 da do equipamento. */
    expect(trecho).toEqual([{ label: VIGENCIA, revision: 1 }]);

    const daTabelaDeFrete = await vigenciaAtiva(VIGENCIA, DATASET_FAMILY_TABELA_DE_FRETE);
    expect(daTabelaDeFrete.entity_type_set).toBe("TRECHO");

    /*
      A causa e o efeito, medidos no banco: identidades canônicas diferentes, e
      por isso duas vigências vivas para o mesmo rótulo. É a diferença entre
      esta linha e a anterior à `0099` que a Auditoria de Km Rodado sentiu.
    */
    expect(daTabelaDeFrete.canonical_snapshot_key).not.toBe(
      equipamento.canonical_snapshot_key,
    );

    /* E o equipamento fica exatamente como estava: nada foi herdado por ele. */
    const aindaEquipamento = await vigenciaAtiva(
      VIGENCIA,
      DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    );
    expect(aindaEquipamento.entity_type_set).toBe("CAVALO");
    expect(aindaEquipamento.revision).toBe(1);

    /* Cada documento com os seus fatos, e nenhum fato herdado em lugar nenhum. */
    expect(await fatosPorTipo(VIGENCIA, DATASET_FAMILY_TABELA_DE_FRETE)).toEqual([
      { tipo: "TRECHO", herdados: 0, doArquivo: expect.any(Number) },
    ]);
    expect(await fatosPorTipo(VIGENCIA, DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO)).toEqual([
      { tipo: "CAVALO", herdados: 0, doArquivo: expect.any(Number) },
    ]);
  }, 300_000);

  /*
    Nada foi fundido, então não há fusão a registrar.

    `snapshot_merge` é escrito quando uma revisão herda componentes que o
    arquivo não trouxe. A ausência da linha é a prova de que o trecho não passou
    por ali — antes da `0099` ela existia, dizendo "o arquivo trouxe TRECHO e 16
    fatos dos componentes não tocados foram herdados da revisão 1".
  */
  it("não registra fusão nenhuma em snapshot_merge", async () => {
    const { rows } = await ctx.db.execute<{ motivo: string }>(sql`
      SELECT m.motivo
        FROM snapshot_merge m
        JOIN snapshot s ON s.id = m.snapshot_id
       WHERE s.source_label = ${VIGENCIA}
    `);

    expect(rows).toEqual([]);
  }, 120_000);
});

/**
 * O REPARO DO QUE JÁ ENTROU FUNDIDO — `freightcheck_separar_familia_do_trecho`.
 *
 * Corrigir a regra não reescreve o que entrou com ela: uma base anterior à
 * `0099` tem vigências `CAVALO+TRECHO` gravadas, e é delas que a Auditoria de Km
 * Rodado reclamou. A função de reparo desfaz a fusão.
 *
 * **O estado legado é montado à mão, e não pelo pipeline.** Com
 * `datasetFamilyFor` corrigida, o pipeline não funde mais — então não há como
 * produzir o insumo importando. O que estas funções fazem é reconstruir
 * exatamente a forma que a `0099` encontra em produção: os fatos de trecho
 * dentro da vigência de equipamento, a cobertura unida, e a família do
 * equipamento nas duas.
 */
describe("o reparo da fusão que já está gravada", () => {
  const FUNDIDA = "EMPURRADA_2_9_2026";
  const SO_TRECHO = "EMPURRADA_1_10_2026";

  /** Devolve a vigência de trecho para dentro da de equipamento. */
  async function fundirComoAntesDa0099(label: string) {
    await ctx.db.execute(sql`ALTER TABLE snapshot DISABLE TRIGGER snapshot_immutable`);
    await ctx.db.execute(sql`ALTER TABLE fact DISABLE TRIGGER fact_immutable`);
    const { rows } = await ctx.db.execute<{ equip: string; trecho: string }>(sql`
      SELECT (SELECT id FROM snapshot WHERE source_label = ${label}
               AND dataset_family = ${DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO}) AS equip,
             (SELECT id FROM snapshot WHERE source_label = ${label}
               AND dataset_family = ${DATASET_FAMILY_TABELA_DE_FRETE}) AS trecho
    `);
    const { equip, trecho } = rows[0];
    expect(equip).toBeTruthy();
    expect(trecho).toBeTruthy();
    for (const tabela of ["fact", "snapshot_attribute", "snapshot_entity_type", "snapshot_presenca"]) {
      await ctx.db.execute(sql`
        UPDATE ${sql.raw(tabela)} SET snapshot_id = ${equip}::uuid
         WHERE snapshot_id = ${trecho}::uuid`);
    }
    await ctx.db.execute(sql`DELETE FROM snapshot_scope WHERE snapshot_id = ${trecho}::uuid`);
    await ctx.db.execute(sql`DELETE FROM snapshot_merge WHERE snapshot_id = ${trecho}::uuid`);
    await ctx.db.execute(sql`DELETE FROM snapshot WHERE id = ${trecho}::uuid`);
    await ctx.db.execute(sql`
      UPDATE snapshot SET entity_type_set = 'CAVALO+TRECHO',
             fact_count = (SELECT count(*) FROM fact WHERE snapshot_id = ${equip}::uuid)
       WHERE id = ${equip}::uuid`);
    await ctx.db.execute(sql`ALTER TABLE fact ENABLE TRIGGER fact_immutable`);
    await ctx.db.execute(sql`ALTER TABLE snapshot ENABLE TRIGGER snapshot_immutable`);
  }

  /** Devolve uma vigência só de trecho para a família errada. */
  async function familiaLegada(label: string) {
    await ctx.db.execute(sql`ALTER TABLE snapshot DISABLE TRIGGER snapshot_immutable`);
    await ctx.db.execute(sql`
      UPDATE snapshot SET dataset_family = ${DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO}
       WHERE source_label = ${label}
         AND dataset_family = ${DATASET_FAMILY_TABELA_DE_FRETE}`);
    await ctx.db.execute(sql`ALTER TABLE snapshot ENABLE TRIGGER snapshot_immutable`);
  }

  async function reparar() {
    /*
      Duas instruções, e não uma com CTE: a linha que a função grava não é
      visível para o SELECT da **mesma** instrução — o instantâneo dele é
      anterior ao INSERT que a função faz. A primeira versão disto lia zero
      linhas e o teste morria dizendo que `vigencias_separadas` era undefined.
    */
    const aplicado = await ctx.db.execute<{ id: string }>(
      sql`SELECT freightcheck_separar_familia_do_trecho() AS id`,
    );
    const { rows } = await ctx.db.execute<{
      vigencias_movidas: number;
      vigencias_separadas: number;
      vigencias_criadas: number;
      fatos_movidos: number;
      ignoradas: unknown[];
    }>(sql`
      SELECT vigencias_movidas, vigencias_separadas, vigencias_criadas,
             fatos_movidos, ignoradas
        FROM reparo_familia_do_trecho WHERE id = ${aplicado.rows[0].id}::uuid
    `);
    return rows[0];
  }

  beforeAll(async () => {
    await importar(
      planilhaDeEquipamento(FUNDIDA, "cavalos", COLUNAS_DE_CAVALO, ["LMN1P22", "QRS3T44"]),
      "CAVALO",
    );
    await importar(planilhaDeTrecho(FUNDIDA, ["FEIRA-ITABUNA", "FEIRA-VITORIA"]), "TRECHO");
    await importar(planilhaDeTrecho(SO_TRECHO, ["ILHEUS-PORTO", "ILHEUS-SUL"]), "TRECHO");
    await fundirComoAntesDa0099(FUNDIDA);
    await familiaLegada(SO_TRECHO);
  }, 600_000);

  it("separa a vigência fundida em duas, sem perder fato nenhum", async () => {
    const fundida = await vigenciaAtiva(FUNDIDA, DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO);
    expect(fundida.entity_type_set).toBe("CAVALO+TRECHO");
    const antes = fundida.fact_count;

    const registro = await reparar();

    expect(registro.vigencias_separadas).toBe(1);
    expect(registro.vigencias_criadas).toBe(1);
    expect(registro.fatos_movidos).toBeGreaterThan(0);
    expect(registro.ignoradas).toEqual([]);

    const equipamento = await vigenciaAtiva(FUNDIDA, DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO);
    const trecho = await vigenciaAtiva(FUNDIDA, DATASET_FAMILY_TABELA_DE_FRETE);

    expect(equipamento.entity_type_set).toBe("CAVALO");
    expect(trecho.entity_type_set).toBe("TRECHO");
    /* O que entrou fundido sai somando o mesmo: nenhum fato se perdeu no meio. */
    expect(equipamento.fact_count + trecho.fact_count).toBe(antes);
    /* E as duas passam a ter identidade própria, que é o ponto de tudo. */
    expect(trecho.canonical_snapshot_key).not.toBe(equipamento.canonical_snapshot_key);
  }, 300_000);

  it("leva o layout declarado junto com o documento a que ele pertence", async () => {
    const { rows } = await ctx.db.execute<{ dataset_family: string; tipos: string }>(sql`
      SELECT s.dataset_family, string_agg(DISTINCT a.entity_type, ',' ORDER BY a.entity_type) AS tipos
        FROM snapshot s
        JOIN snapshot_attribute sa ON sa.snapshot_id = s.id
        JOIN attribute a ON a.id = sa.attribute_id
       WHERE s.source_label = ${FUNDIDA}
       GROUP BY s.dataset_family
       ORDER BY s.dataset_family
    `);

    expect(rows).toEqual([
      { dataset_family: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO, tipos: "CAVALO" },
      { dataset_family: DATASET_FAMILY_TABELA_DE_FRETE, tipos: "TRECHO" },
    ]);
  }, 120_000);

  it("move de família a vigência que já era só de trecho", async () => {
    const trecho = await vigenciaAtiva(SO_TRECHO, DATASET_FAMILY_TABELA_DE_FRETE);

    expect(trecho.entity_type_set).toBe("TRECHO");
    expect(trecho.fact_count).toBeGreaterThan(0);
  }, 120_000);

  /*
    Rodar de novo não encontra nada — é o que permite a migration ser aplicada
    a uma base já reparada sem estragá-la, e é o que a torna segura de repetir
    num rollback-forward.
  */
  it("é idempotente", async () => {
    const segunda = await reparar();

    expect(segunda.vigencias_movidas).toBe(0);
    expect(segunda.vigencias_separadas).toBe(0);
    expect(segunda.fatos_movidos).toBe(0);
  }, 120_000);
});
