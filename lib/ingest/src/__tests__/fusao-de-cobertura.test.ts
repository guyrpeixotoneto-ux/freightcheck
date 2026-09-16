import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { datasetFamilyFor } from "../canonical-identity";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";

/**
 * QUANDO DOIS ARQUIVOS VIRAM UMA VIGÊNCIA SÓ — o que é contrato e o que é
 * defeito.
 *
 * ---------------------------------------------------------------------------
 * O relato
 * ---------------------------------------------------------------------------
 * Em 15/09/2026, na Auditoria de Km Rodado: o seletor oferecia `agosto/2026` e
 * `setembro/2026`, as duas cobrindo trecho, e clicar em qualquer uma não
 * selecionava nada. A metade de tela do defeito está corrigida
 * (`parReconciliado`, em `@workspace/comparison/recorte-de-rubrica`). A outra
 * metade é este arquivo: **por que as duas vigências chegaram com coberturas
 * diferentes**, uma `TRECHO` e outra `CAVALO+TRECHO`, a ponto de o motor
 * recusar o par que a lista oferecia.
 *
 * ---------------------------------------------------------------------------
 * A identidade, e por que ela decide isto
 * ---------------------------------------------------------------------------
 * Uma vigência é identificada por (sistema, **família**, canal, data, escopo) —
 * `canonicalSnapshotKey`. A família sai de `FAMILY_BY_ENTITY_TYPE`, e o padrão
 * dela é deliberadamente inclusivo: um tipo não mapeado entra na família de
 * remuneração de equipamento, para que um equipamento novo seja **componente**
 * da vigência que já existe em vez de abrir uma segunda identidade ativa para a
 * mesma data.
 *
 * Esse padrão é certo para um DOLLY e é o defeito para o TRECHO. A tabela de
 * frete não é um equipamento a mais na mesma vigência: é outro documento, de
 * outro grão, que só por acaso partilha unidade, canal e data com o export de
 * equipamento. Partilhando a identidade, o segundo arquivo a chegar não abre
 * vigência — entra como **revisão** do primeiro e herda os fatos dele, e a
 * cobertura gravada passa a ser a união dos dois.
 *
 * ---------------------------------------------------------------------------
 * O que cada metade deste arquivo guarda
 * ---------------------------------------------------------------------------
 * As duas metades exercitam **a mesma máquina** e querem coisas opostas dela, e
 * é por isso que moram juntas: quem for corrigir a segunda precisa ver, no
 * mesmo arquivo, o que a primeira não deixa quebrar.
 *
 * 1. **A herança que é o contrato.** Cavalo e carreta são componentes da mesma
 *    vigência de propósito: a Ambev entrega os dois em arquivos separados, e uma
 *    correção só de cavalos não pode apagar as carretas. Isto tem de continuar
 *    valendo depois de qualquer correção do item 2.
 *
 * 2. **A fusão que não devia acontecer.** O trecho entrando como revisão do
 *    equipamento. Estas asserções descrevem o comportamento de hoje, e são o
 *    **registro de um defeito, não o contrato** — ver a nota em cada uma sobre
 *    o que elas passam a afirmar no dia em que TRECHO ganhar família própria.
 *
 * Nada aqui corrige coisa alguma. É a reprodução que sustenta a decisão.
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

/** A vigência ativa de um rótulo, com o que decide a identidade dela. */
async function vigenciaAtiva(label: string) {
  const { rows } = await ctx.db.execute<{
    entity_type_set: string;
    dataset_family: string;
    canonical_snapshot_key: string;
    revision: number;
  }>(sql`
    SELECT entity_type_set, dataset_family, canonical_snapshot_key, revision
      FROM snapshot
     WHERE source_label = ${label}
       AND status <> 'SUPERSEDED'
  `);
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Quantos fatos de cada tipo a vigência ativa tem, e quais foram herdados. */
async function fatosPorTipo(label: string) {
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
describe("a família de dataset de cada tipo", () => {
  /* O contrato: os dois equipamentos são componentes da mesma vigência. */
  it("põe CAVALO e CARRETA na mesma família", () => {
    expect(datasetFamilyFor("TRECHO")).toBeTruthy();
    expect(datasetFamilyFor("CAVALO")).toBe(datasetFamilyFor("CARRETA"));
  });

  /*
    O defeito, dito na forma mais curta que existe.

    `FAMILY_BY_ENTITY_TYPE` não tem entrada para TRECHO, e o padrão inclusivo o
    manda para a família do equipamento. É daqui que sai tudo o que o `describe`
    lá embaixo mede.

    QUANDO TRECHO GANHAR FAMÍLIA PRÓPRIA esta asserção vira `not.toBe`, e é ela
    que deve ser invertida primeiro — as outras são consequência.
  */
  it("hoje põe TRECHO na MESMA família do equipamento — é o defeito", () => {
    expect(datasetFamilyFor("TRECHO")).toBe(datasetFamilyFor("CAVALO"));
  });

  /* O QLP mostra como é quando o tipo tem família própria: identidade separada. */
  it("mantém o quadro de pessoal fora da família do equipamento", () => {
    expect(datasetFamilyFor("QLP_OPERACIONAL")).not.toBe(datasetFamilyFor("CAVALO"));
    expect(datasetFamilyFor("QLP_ADMINISTRATIVO")).toBe(
      datasetFamilyFor("QLP_OPERACIONAL"),
    );
  });
});

/**
 * A herança entre componentes — o que **tem** de continuar funcionando.
 *
 * Cavalo e carreta chegam em arquivos separados e descrevem a mesma vigência.
 * O segundo entra como revisão do primeiro e carrega os fatos dele adiante;
 * sem isso, importar a carreta apagaria os cavalos. Qualquer correção da fusão
 * do trecho passa por aqui sem mexer nesta metade.
 */
describe("a herança entre cavalo e carreta", () => {
  const VIGENCIA = "EMPURRADA_1_7_2026";

  it("faz do segundo arquivo uma revisão que herda o primeiro", async () => {
    const primeiro = await importar(
      planilhaDeEquipamento(VIGENCIA, "cavalos", COLUNAS_DE_CAVALO, ["ABC1D23", "XYZ9K88"]),
      "CAVALO",
    );
    expect(primeiro).toEqual([{ label: VIGENCIA, revision: 1 }]);
    expect((await vigenciaAtiva(VIGENCIA)).entity_type_set).toBe("CAVALO");

    const segundo = await importar(
      planilhaDeEquipamento(VIGENCIA, "carretas", COLUNAS_DE_CARRETA, ["QWE4R56"]),
      "CARRETA",
    );
    expect(segundo).toEqual([{ label: VIGENCIA, revision: 2 }]);

    const ativa = await vigenciaAtiva(VIGENCIA);
    expect(ativa.entity_type_set).toBe("CARRETA+CAVALO");

    /*
      O cavalo veio herdado e a carreta veio do arquivo. É esta linha que prova
      que a revisão não apagou o componente que ela não tocou.
    */
    const fatos = await fatosPorTipo(VIGENCIA);
    const cavalo = fatos.find((f) => f.tipo === "CAVALO");
    const carreta = fatos.find((f) => f.tipo === "CARRETA");
    expect(cavalo?.herdados).toBeGreaterThan(0);
    expect(cavalo?.doArquivo).toBe(0);
    expect(carreta?.doArquivo).toBeGreaterThan(0);
    expect(carreta?.herdados).toBe(0);
  }, 300_000);
});

/**
 * A fusão do trecho com o equipamento — o defeito, reproduzido.
 *
 * **Estas asserções não são o contrato.** Elas descrevem o que o pipeline faz
 * hoje, para que a decisão de corrigir seja tomada sobre um fato medido e para
 * que a correção tenha onde se apoiar. Cada uma diz o que passa a afirmar
 * quando TRECHO ganhar família própria.
 */
describe("a tabela de frete e o export de equipamento na mesma data", () => {
  const VIGENCIA = "EMPURRADA_1_9_2026";

  it("hoje faz do trecho uma revisão do equipamento, e não outra vigência", async () => {
    await importar(
      planilhaDeEquipamento(VIGENCIA, "cavalos", COLUNAS_DE_CAVALO, ["DEF2G34", "HIJ5K67"]),
      "CAVALO",
    );
    const soCavalo = await vigenciaAtiva(VIGENCIA);
    expect(soCavalo.entity_type_set).toBe("CAVALO");

    const trecho = await importar(
      planilhaDeTrecho(VIGENCIA, ["CAMACARI-SALVADOR", "CAMACARI-FEIRA"]),
      "TRECHO",
    );

    /*
      QUANDO TRECHO GANHAR FAMÍLIA PRÓPRIA: a importação do trecho passa a
      gravar `revision: 1` de uma vigência **nova**, e não a revisão 2 desta.
    */
    expect(trecho).toEqual([{ label: VIGENCIA, revision: 2 }]);

    const fundida = await vigenciaAtiva(VIGENCIA);

    /*
      A causa, agora medida no banco: a mesma chave canônica para os dois
      arquivos. Com família própria, as duas chaves passam a ser diferentes — e
      `vigenciaAtiva` passa a encontrar DUAS vigências ativas para este rótulo,
      de modo que este teste inteiro é reescrito, não remendado.
    */
    expect(fundida.canonical_snapshot_key).toBe(soCavalo.canonical_snapshot_key);
    expect(fundida.dataset_family).toBe(soCavalo.dataset_family);

    /*
      E o efeito que a tela sentiu: a cobertura virou a união. É este valor que
      o seletor de Km Rodado compara com o de outro mês, e é a diferença entre
      `CAVALO+TRECHO` aqui e `TRECHO` lá que faz `engine.ts` recusar o par
      ("Coberturas diferentes") e `parDePartida` não achar par nenhum.
    */
    expect(fundida.entity_type_set).toBe("CAVALO+TRECHO");

    /*
      A fusão pega no ato: os fatos de cavalo estão nesta vigência de trecho, e
      estão como herdados. Não é um rótulo errado numa vigência certa — os dois
      documentos estão dentro do mesmo snapshot.
    */
    const fatos = await fatosPorTipo(VIGENCIA);
    expect(fatos.map((f) => f.tipo)).toEqual(["CAVALO", "TRECHO"]);
    expect(fatos.find((f) => f.tipo === "CAVALO")?.herdados).toBeGreaterThan(0);
    expect(fatos.find((f) => f.tipo === "TRECHO")?.doArquivo).toBeGreaterThan(0);
  }, 300_000);

  /*
    O que torna a fusão difícil de perceber: ela é silenciosa.

    `promote` roda no modo padrão FAIL, que existe para "recusar quando a chave
    de negócio já existe". A recusa VIGENCIA_ATIVA_EXISTENTE só dispara quando
    os tipos que entram se **sobrepõem** aos que já estão vivos, e TRECHO não se
    sobrepõe a CAVALO — então nada é recusado e nada é perguntado. O teste
    acima, que não passa `onExistingSnapshot`, é a prova: ele promoveu.
  */
  it("registra a fusão em snapshot_merge, que é onde ela ficou dita", async () => {
    const { rows } = await ctx.db.execute<{ motivo: string }>(sql`
      SELECT m.motivo
        FROM snapshot_merge m
        JOIN snapshot s ON s.id = m.snapshot_id
       WHERE s.source_label = ${VIGENCIA}
         AND s.status <> 'SUPERSEDED'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].motivo).toContain("o arquivo trouxe TRECHO");
    expect(rows[0].motivo).toMatch(/fatos dos componentes não tocados foram herdados/);
  }, 120_000);
});
