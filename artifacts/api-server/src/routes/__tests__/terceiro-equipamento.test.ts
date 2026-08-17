import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { equipamentosElegiveis, equipamentosDisponiveis } from "@workspace/availability";
import { TIPOS_COM_REGRA } from "@workspace/composition";
import { ESCOPOS_APURAVEIS } from "@workspace/dre";
import { encerrarPoolDoProcesso, type Database } from "@workspace/db";

/**
 * O terceiro equipamento — a forma mais silenciosa do defeito desta auditoria.
 *
 * Composição e DRE sabem apurar cavalo e carreta, e dizem isso em duas listas
 * declaradas. As listas estão certas: a regra de remuneração de um equipamento
 * é conhecimento de negócio, não algo que se descubra numa consulta.
 *
 * O que não existia era alguém **cruzá-las com o canônico**. As telas tinham as
 * abas escritas à mão, `/composition/equipment-types` devolvia a lista
 * declarada e não era chamado por tela nenhuma, e `/dre/plano` também não. Um
 * terceiro equipamento importado ficava invisível nos dois módulos: sem aba,
 * sem aviso, sem erro.
 *
 * É pior do que a frase errada do PR-18. Ali havia uma tela vazia para alguém
 * estranhar; aqui há silêncio, e silêncio ninguém estranha. É a Parte F.4 do
 * baseline: *"a tela simplesmente não o mostra"*.
 */

const COLUNAS_FIXAS = [
  "Vigencia",
  "Unidade - CNPJ",
  "Unidade - Nome",
  "Unidade - Regional",
  "Operador - CNPJ",
  "Operador - Nome",
  "Placa",
  "chassi",
];

/** Vinte colunas próprias por aba: menos que isso e a identidade é decidida errado. */
const colunasDe = (prefixo: string) =>
  Array.from({ length: 20 }, (_, i) => `${prefixo} ${i}`);

function planilha(abas: { nome: string; prefixo: string; placa: string }[]): string {
  const wb = XLSX.utils.book_new();
  for (const aba of abas) {
    const colunas = colunasDe(aba.prefixo);
    const linhas: (string | number)[][] = [[...COLUNAS_FIXAS, ...colunas]];
    linhas.push([
      "EMPURRADA_1_1_2026",
      "07.526.557/0015-05",
      "CAMACARI",
      "GEO NE",
      "20.618.821/0007-99",
      "OPERADOR TESTE",
      aba.placa,
      `CHASSI${aba.placa}`,
      ...colunas.map((_, i) => 1000 + i),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba.nome);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "terceiro-equip-"));
  const arquivo = path.join(dir, "EMPURRADA_1_1_2026.xlsx");
  XLSX.writeFile(wb, arquivo);
  return arquivo;
}

async function importar(db: Database, filePath: string): Promise<void> {
  const recebido = await receiveFile(db, { filePath });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  await promote(db, recebido.importRunId, {
    onExistingSnapshot: "NEW_REVISION",
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
}

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("terceiro_equipamento");
  await importar(
    ctx.db,
    planilha([
      { nome: "carretas", prefixo: "Custo Carreta", placa: "AAA1A11" },
      { nome: "cavalos", prefixo: "Custo Cavalo", placa: "BBB1B11" },
      { nome: "reboques", prefixo: "Custo Reboque", placa: "RRR1R11" },
    ]),
  );

  /*
    O terceiro equipamento chega pelo caminho de verdade: uma aba nova.

    A primeira versão deste fixture enxertava a entidade com `INSERT`, e o banco
    recusou duas vezes — `attribute_confirmed_requires_actor` (confirmar exige
    quem confirmou) e `fact_is_immutable` (fato de vigência fechada não se
    escreve). As duas invariantes estão certas, e a recusa mostrou que o enxerto
    era artificial: nenhuma entrega real produz aquele estado.

    O caminho real é este — uma aba com colunas de um equipamento que o
    dicionário não conhece, promovida com a identidade nova confirmada, que é
    exatamente o que acontece no dia em que a Ambev manda um reboque.
  */
}, 900_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});
}, 60_000);

describe("o terceiro equipamento existe no canônico", () => {
  it("a autoridade o vê, com vigência e entidade", async () => {
    // A montagem, medida antes de qualquer asserção sobre os módulos.
    const equipamentos = await equipamentosDisponiveis(ctx.db);
    const reboque = equipamentos.find((e) => e.entityType === "REBOQUE");

    expect(reboque, "o cenário precisa de um terceiro equipamento").toBeDefined();
    expect(reboque!.vigencias).toBe(1);
    expect(reboque!.entidades).toBe(1);
  }, 300_000);

  it("e nenhum dos dois módulos tem regra para ele — é a premissa do cenário", () => {
    expect(TIPOS_COM_REGRA).not.toContain("REBOQUE");
    expect(ESCOPOS_APURAVEIS).not.toContain("REBOQUE");
  });
});

describe("Composição diz que não sabe compô-lo, em vez de omiti-lo", () => {
  it("o cruzamento lista os três, e nomeia o que não apura", async () => {
    const lista = await equipamentosElegiveis(ctx.db, {
      apuraveis: TIPOS_COM_REGRA,
      comoOModuloChama: (t) => `sem regra de composição para ${t}`,
    });

    // Os três que existem — e não os dois que o módulo declara.
    expect(lista.map((e) => e.entityType).sort()).toEqual(["CARRETA", "CAVALO", "REBOQUE"]);

    const reboque = lista.find((e) => e.entityType === "REBOQUE")!;
    expect(reboque.apuravel).toBe(false);
    expect(reboque.vazio?.estado).toBe("NAO_SE_APLICA");
    expect(reboque.vazio?.frase).toContain("REBOQUE");

    // E os dois de sempre continuam apuráveis, sem vazio.
    for (const tipo of ["CARRETA", "CAVALO"]) {
      const e = lista.find((x) => x.entityType === tipo)!;
      expect(e.apuravel, tipo).toBe(true);
      expect(e.vazio, tipo).toBeNull();
    }
  }, 300_000);

  it("o veredito nunca é NAO_EXISTE — o dado está lá", async () => {
    /*
      A regra de ouro do PR-18, aplicada a este caso. `equipamentosElegiveis`
      só lista o que o canônico tem, então `NAO_EXISTE` seria uma contradição
      com a própria fonte da lista.
    */
    const lista = await equipamentosElegiveis(ctx.db, {
      apuraveis: TIPOS_COM_REGRA,
      comoOModuloChama: () => "sem regra",
    });
    for (const e of lista) {
      expect(e.vazio?.estado ?? "NAO_SE_APLICA").not.toBe("NAO_EXISTE");
    }
  }, 300_000);
});

describe("a DRE diz o mesmo, e CONJUNTO não entra no cruzamento", () => {
  it("CONJUNTO fica de fora — não é equipamento, é o par apurado junto", async () => {
    /*
      Cruzar `CONJUNTO` com `snapshot_entity_type` não acharia nada, e a linha
      diria "não se aplica" sobre o escopo que a DRE mais usa. O filtro é
      deliberado, e este teste é o que impede alguém de "corrigi-lo" depois.
    */
    const lista = await equipamentosElegiveis(ctx.db, {
      apuraveis: ESCOPOS_APURAVEIS.filter((e) => e !== "CONJUNTO"),
      comoOModuloChama: (t) => `sem plano de apuração para ${t}`,
    });
    expect(lista.map((e) => e.entityType)).not.toContain("CONJUNTO");

    const reboque = lista.find((e) => e.entityType === "REBOQUE")!;
    expect(reboque.apuravel).toBe(false);
    expect(reboque.vazio?.frase).toContain("plano");
  }, 300_000);
});

describe("as duas telas param de ter a lista escrita à mão", () => {
  it("nenhuma delas monta abas a partir de uma constante local", async () => {
    /*
      A varredura que impede a volta. As abas de Composição vinham de um
      `const TIPOS` com dois itens, e as da DRE dos escopos declarados. A
      primeira passou a vir do servidor; a segunda continua sendo escopo — e
      por isso ganhou o aviso, que é o que este teste confere que existe.
    */
    const { readFileSync } = await import("node:fs");
    const raiz = path.resolve(import.meta.dirname, "../../../../..");
    const ler = (rel: string) =>
      readFileSync(path.join(raiz, "artifacts/freightaudit/src", rel), "utf8");

    const composicao = ler("pages/composicao.tsx");
    expect(composicao).toContain("/composition/equipment-types");
    expect(composicao).toContain("equipamentos.map");
    // A constante de duas abas não pode voltar.
    expect(composicao).not.toMatch(/const TIPOS = \[[\s\S]{0,200}CARRETA/);

    const dre = ler("pages/dre.tsx");
    expect(dre).toContain("/dre/plano");
    expect(dre).toContain("semPlano");
  });
});
