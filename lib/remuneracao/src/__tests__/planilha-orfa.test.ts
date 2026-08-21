import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL, deleteImportRun } from "@workspace/ingest";
import { seedTaxonomy } from "@workspace/curation";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { scopeTable, snapshotScopeTable } from "@workspace/db/schema";
import { COLUNA } from "../colunas";
import {
  gravarPlanilhaDaUnidade,
  lerCadastroDaUnidade,
  lerSituacaoDasUnidades,
} from "../leitura";
import { registrarUnidade } from "../unidade";

/**
 * A PLANILHA QUE EXISTE NO BANCO TEM DE EXISTIR EM TELA.
 *
 * `unidade-na-lista.test.ts` prova a costura da unidade registrada com a lista.
 * Este arquivo prova a promessa que está um degrau abaixo dela, e que vale para
 * as três procedências: **nenhuma planilha gravada pode ficar sem linha**. É a
 * mesma frase que `gravarPlanilhaDaUnidade` já escrevia no cabeçalho — "para
 * que a planilha só possa ser preenchida onde ela vai ser lida" —, e que a
 * leitura descumpria em dois pontos.
 *
 * Os dois defeitos que ele prende são os dois lados do mesmo `continue`:
 *
 * **A unidade sai do acervo e a planilha vai junto.** A linha da lista de um
 * canal que só a planilha tem era pendurada num irmão importado; excluída a
 * importação da unidade, não havia irmão e a linha era descartada em silêncio.
 * As células continuavam no banco, com autor e data, sem lista, sem cadastro e
 * sem escrita — a próxima gravação no mesmo lugar era recusada por unidade
 * inexistente. Quem tinha preenchido a aba lia isso como "sumiu", que é
 * exatamente o que tinha acontecido.
 *
 * **A unidade registrada à mão não servia de irmã.** `irmaoDoEscopo` só via o
 * acervo, então salvar a planilha de um canal novo numa unidade que nunca
 * importou nada — o gesto que o painel de cadastro oferece, e que a escrita
 * aceita — gravava células num par que a leitura seguinte descartava.
 *
 * E, de brinde, a linha a mais que a ordem invertida produzia: a registrada
 * cujo escopo ganhou export em outro canal aparecia duas vezes, uma por
 * procedência, sem nada em tela dizendo que eram a mesma unidade.
 */

let ctx: TestDb;

/** A unidade que sai do acervo. Duas famílias: uma sai, a outra fica. */
const BELEM = "escopo-belem";
/** A que fica, para provar que o resto da lista não muda. */
const CAMACARI = "escopo-camacari";
/** A registrada à mão, que nunca teve arquivo nenhum. */
const REGISTRADA = "escopo-registrado";
/** A registrada à mão cujo escopo ganha export em outro canal. */
const REENCONTRADA = "escopo-reencontrado";

const VIGENCIA = "2026-08-01";

const ATIVO: AttributeSpec = {
  code: COLUNA.ativo.code,
  dataType: "TEXT",
  semanticsStatus: "CONFIRMED",
};

/** Uma vigência de equipamento com um cavalo dentro — o mínimo que faz unidade. */
function comUmCavalo(scopeHash: string, placa: string, canal: string, familia?: string) {
  return buildFixture(
    ctx.db,
    [ATIVO],
    [
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: VIGENCIA,
        data: { [placa]: { [COLUNA.ativo.code]: "ATIVO" } },
      },
    ],
    {
      scopeHash,
      canal,
      entityType: "CAVALO",
      ...(familia ? { datasetFamily: familia } : {}),
    },
  );
}

const UMA_LINHA = [{ chave: "aliquota_pis", valor: 1.65 }];

beforeAll(async () => {
  ctx = await createTestDatabase("remuneracao_planilha_orfa");
  await seedTaxonomy(ctx.db, "test");
}, 300_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
}, 60_000);

describe("a unidade que sai do acervo depois de a planilha ser digitada", () => {
  beforeAll(async () => {
    await comUmCavalo(CAMACARI, "AAA1A11", "camacari");
    await comUmCavalo(BELEM, "BBB2B22", "belem");

    /*
      A aba de ROTA existe antes de o export de ROTA chegar — é o caso que
      `canaisComPlanilha` existe para servir, e é onde o defeito morava.
    */
    await gravarPlanilhaDaUnidade(ctx.db, {
      scopeHash: BELEM,
      channel: "ROTA",
      period: VIGENCIA,
      celulas: UMA_LINHA,
      autor: { id: null, nome: "Guy" },
    });

    for (const { import_run_id } of (
      await ctx.db.execute<{ import_run_id: string }>(
        sql`SELECT DISTINCT import_run_id FROM snapshot WHERE scope_hash = ${BELEM}`,
      )
    ).rows) {
      await deleteImportRun(ctx.db, import_run_id, { deletedBy: "teste" });
    }
  }, 300_000);

  it("continua na lista, porque as células continuam no banco", async () => {
    const { rows } = await ctx.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM remuneracao_planilha WHERE scope_hash = ${BELEM}`,
    );
    // A premissa do teste: a exclusão da importação não toca a planilha. Se um
    // dia ela passar a apagá-la, o defeito muda de lugar e este teste tem de
    // falhar dizendo isso, e não passar por não haver mais o que procurar.
    expect(rows[0]!.total).toBeGreaterThan(0);

    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const nossa = cadastros.find((c) => c.scopeHash === BELEM);

    expect(nossa).toBeDefined();
    expect(nossa!.channel).toBe("ROTA");
    expect(nossa!.cadastro.informadas).toBe(1);
    expect(nossa!.planilhaOrfa).toBe(true);
    // Órfã não é o mesmo que cadastrada à mão, e as duas pedem consertos
    // diferentes — ver o cabeçalho de `planilhaOrfa`.
    expect(nossa!.registradaAMao).toBe(false);
  });

  it("responde pelas quinzenas em que alguém digitou, e por nenhuma outra", async () => {
    /*
      Não há acervo de onde herdar vigências nem registro que declare uma
      inicial: a única régua possível é a da própria planilha, e ela é também a
      certa — a linha responde pelo que existe dela.
    */
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const daUnidade = cadastros.filter((c) => c.scopeHash === BELEM);

    expect(daUnidade.map((c) => c.effectiveDate)).toEqual([VIGENCIA]);
  });

  it("abre pelo cadastro, que é o que torna os números recuperáveis", async () => {
    /*
      Aparecer na lista e não abrir seria meio conserto: quem vê a linha quer
      ler as trinta células de volta, e é por `lerCadastroDaUnidade` que elas
      voltam.
    */
    const cadastro = await lerCadastroDaUnidade(ctx.db, {
      scopeHash: BELEM,
      channel: "ROTA",
      period: VIGENCIA,
    });

    expect(cadastro).not.toBeNull();
    expect(cadastro!.material.linhasInformadas).toBe(1);
  });

  it("aceita a gravação seguinte, que antes era recusada por unidade inexistente", async () => {
    const gravada = await gravarPlanilhaDaUnidade(ctx.db, {
      scopeHash: BELEM,
      channel: "ROTA",
      period: VIGENCIA,
      celulas: [{ chave: "aliquota_cofins", valor: 7.6 }],
      autor: { id: null, nome: "Guy" },
    });

    expect(gravada).not.toBeNull();
    expect(gravada!.linhas.map((l) => l.chave)).toContain("aliquota_cofins");
  });

  it("não muda nada para quem tem acervo", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const outra = cadastros.filter((c) => c.scopeHash === CAMACARI);

    expect(outra).toHaveLength(1);
    expect(outra[0]!.planilhaOrfa).toBe(false);
  });
});

describe("o nome da unidade órfã, quando sobrou quem o diga", () => {
  /*
    O `scope_hash` é o mesmo em toda família e em toda revisão, e a linha de
    `scope` que a importação gravou não morre com a vigência de equipamento.
    Então a unidade que também mandou quadro de pessoal — ou que teve a vigência
    substituída por uma revisão — continua tendo nome depois de o acervo de
    equipamento perdê-la. Nada aqui reconstrói identidade: lê-se a linha que a
    importação escreveu, pelo mesmo hash.
  */
  const COM_NOME = "escopo-com-nome";

  beforeAll(async () => {
    const doQuadro = await comUmCavalo(
      COM_NOME,
      "CCC3C33",
      "quadro",
      DATASET_FAMILY_QUADRO_DE_PESSOAL,
    );
    await comUmCavalo(COM_NOME, "DDD4D44", "equipamento");

    const [escopo] = await ctx.db
      .insert(scopeTable)
      .values({ scopeType: "UNIDADE", code: "12345678000199", name: "CDD BELÉM" })
      .returning();
    await ctx.db.insert(snapshotScopeTable).values({
      snapshotId: Object.values(doQuadro.snapshotIds)[0]!,
      scopeId: escopo!.id,
    });

    await gravarPlanilhaDaUnidade(ctx.db, {
      scopeHash: COM_NOME,
      channel: "ROTA",
      period: VIGENCIA,
      celulas: UMA_LINHA,
      autor: { id: null, nome: "Guy" },
    });

    const { rows } = await ctx.db.execute<{ import_run_id: string }>(sql`
      SELECT DISTINCT import_run_id
        FROM snapshot
       WHERE scope_hash = ${COM_NOME}
         AND dataset_family <> ${DATASET_FAMILY_QUADRO_DE_PESSOAL}`);
    for (const { import_run_id } of rows) {
      await deleteImportRun(ctx.db, import_run_id, { deletedBy: "teste" });
    }
  }, 300_000);

  it("se chama pelo nome, e não pelo hash", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const nossa = cadastros.find((c) => c.scopeHash === COM_NOME);

    expect(nossa).toBeDefined();
    expect(nossa!.planilhaOrfa).toBe(true);
    expect(nossa!.label).toBe("CDD BELÉM · ROTA");
    expect(nossa!.unidade).toBe("CDD BELÉM");
  });
});

describe("a unidade registrada à mão e a planilha de um canal que ela não tinha", () => {
  beforeAll(async () => {
    await registrarUnidade(ctx.db, {
      scopeHash: REGISTRADA,
      scopeType: "UNIDADE",
      codigo: "",
      nome: "SIMÕES FILHO",
      canal: "ROTA",
      vigenciaInicial: VIGENCIA,
      autor: { id: null, nome: "Guy" },
    });

    await gravarPlanilhaDaUnidade(ctx.db, {
      scopeHash: REGISTRADA,
      channel: "EMPURRADA",
      period: VIGENCIA,
      celulas: UMA_LINHA,
      autor: { id: null, nome: "Guy" },
    });
  }, 300_000);

  it("aparece, em vez de a escrita ser aceita e a leitura descartá-la", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const nova = cadastros.find(
      (c) => c.scopeHash === REGISTRADA && c.channel === "EMPURRADA",
    );

    expect(nova).toBeDefined();
    expect(nova!.cadastro.informadas).toBe(1);
    /*
      O nome vem da unidade registrada, que é quem o declarou — e o canal do
      lado é o da planilha, como em qualquer canal novo.
    */
    expect(nova!.label).toBe("SIMÕES FILHO · EMPURRADA");
    /*
      Sem export no par: a marca é do par (escopo, canal), e esta unidade não
      tem arquivo nenhum em canal nenhum. Órfã ela não é — quem a declarou está
      na tabela de unidades.
    */
    expect(nova!.registradaAMao).toBe(true);
    expect(nova!.planilhaOrfa).toBe(false);
  });

  it("continua com a linha do canal que foi registrado", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const doRegistro = cadastros.filter(
      (c) => c.scopeHash === REGISTRADA && c.channel === "ROTA",
    );

    expect(doRegistro).toHaveLength(1);
    expect(doRegistro[0]!.effectiveDate).toBe(VIGENCIA);
  });
});

describe("a registrada à mão cujo escopo ganhou export em outro canal", () => {
  beforeAll(async () => {
    await registrarUnidade(ctx.db, {
      scopeHash: REENCONTRADA,
      scopeType: "UNIDADE",
      codigo: "98765432000155",
      nome: "FEIRA DE SANTANA",
      canal: "ROTA",
      vigenciaInicial: VIGENCIA,
      autor: { id: null, nome: "Guy" },
    });

    await gravarPlanilhaDaUnidade(ctx.db, {
      scopeHash: REENCONTRADA,
      channel: "ROTA",
      period: VIGENCIA,
      celulas: UMA_LINHA,
      autor: { id: null, nome: "Guy" },
    });

    /* O arquivo chega — no outro canal, que é o caso que produzia a duplicata. */
    await comUmCavalo(REENCONTRADA, "EEE5E55", "reencontrada");
  }, 300_000);

  it("tem uma linha por canal, e não duas do mesmo", async () => {
    /*
      Duas linhas de ROTA — uma pendurada no irmão importado, outra vinda do
      registro — seriam a mesma unidade duas vezes na tela, com planilhas
      diferentes e nada dizendo qual é qual. É o defeito que o módulo inteiro
      existe para não cometer, e ele vinha da ordem em que os dois laços rodavam.
    */
    const { cadastros } = await lerSituacaoDasUnidades(ctx.db);
    const daUnidade = cadastros.filter((c) => c.scopeHash === REENCONTRADA);
    const rota = daUnidade.filter((c) => c.channel === "ROTA");

    expect(rota).toHaveLength(1);
    expect(rota[0]!.cadastro.informadas).toBe(1);
    expect(daUnidade.filter((c) => c.channel === "EMPURRADA")).toHaveLength(1);
  });
});
