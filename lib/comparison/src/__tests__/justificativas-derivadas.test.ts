import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { changeTable, justificativaTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { eq } from "drizzle-orm";

import { computeChangeSet } from "../engine";
import { gravarJustificativasDerivadas } from "../justificativas-derivadas";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * A justificativa do total, deduzida das parcelas.
 *
 * O que estes testes prendem é o limite da dedução — porque uma dedução larga
 * demais marca como explicada uma alteração que ninguém explicou, que é o
 * oposto do que Chamados existe para fazer. As quatro guardas: total sem
 * parcela que se mova (a inconsistência aritmética, que é para uma pessoa
 * olhar), parcela ainda sem justificativa, justificativa antiga sem
 * conformidade, e total que alguém já justificou à mão.
 */
let ctx: TestDb;

const PARCELA = "cavalo.finame_cavalo";
const JUROS = "cavalo.juros_finame_cavalo";
const AMORTIZACAO = "cavalo.amortizacao_cavalo";

const ATRIBUTOS: AttributeSpec[] = [
  { code: PARCELA, dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: JUROS, dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: AMORTIZACAO, dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

let changeSetId: string;
let idDe: Map<string, number>;
let entidadeDe: Map<string, string>;

beforeAll(async () => {
  ctx = await createTestDatabase("justificativas_derivadas");

  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: "A",
        effectiveDate: "2026-07-01",
        data: {
          /* A placa do caso normal: a parcela e as duas parcelas dela se movem. */
          AAA1A11: { [PARCELA]: 1000, [JUROS]: 400, [AMORTIZACAO]: 600 },
          /* A parcela se moveu sozinha — nenhuma parcela dela mudou. */
          BBB2B22: { [PARCELA]: 500, [JUROS]: 200, [AMORTIZACAO]: 300 },
        },
      },
      {
        label: "B",
        effectiveDate: "2026-08-01",
        data: {
          AAA1A11: { [PARCELA]: 1100, [JUROS]: 450, [AMORTIZACAO]: 650 },
          BBB2B22: { [PARCELA]: 550, [JUROS]: 200, [AMORTIZACAO]: 300 },
        },
      },
    ],
    { entityType: "CAVALO" },
  );
  const [a, b] = Object.values(snapshotIds);
  changeSetId = (await computeChangeSet(ctx.db, a, b, { force: true })).id;

  const linhas = await ctx.db
    .select({
      id: changeTable.id,
      entityId: changeTable.entityId,
      entityLabel: changeTable.entityLabel,
      attributeCode: changeTable.attributeCode,
    })
    .from(changeTable)
    .where(eq(changeTable.changeSetId, changeSetId));
  idDe = new Map(linhas.map((l) => [`${l.entityLabel}|${l.attributeCode}`, l.id]));
  entidadeDe = new Map(linhas.map((l) => [String(l.entityLabel), String(l.entityId)]));
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

beforeEach(async () => {
  await ctx.db.delete(justificativaTable).where(eq(justificativaTable.changeSetId, changeSetId));
});

async function justificar(
  chave: string,
  campos: {
    conforme: boolean | null;
    naoConformidade?: string | null;
    responsavelAprovacao?: string | null;
    motivoExcecao?: string | null;
  },
) {
  await ctx.db.insert(justificativaTable).values({
    changeSetId,
    changeId: idDe.get(chave)!,
    entityLabel: chave.split("|")[0],
    entityType: "CAVALO",
    texto: "escrita à mão",
    formula: "f",
    regra: "r",
    conforme: campos.conforme,
    naoConformidade: campos.naoConformidade ?? null,
    motivoExcecao: campos.motivoExcecao ?? null,
    responsavelAprovacao: campos.responsavelAprovacao ?? null,
    criadoPor: "gestor@x.com",
  });
}

const deduzir = (placa = "AAA1A11") =>
  gravarJustificativasDerivadas(ctx.db, {
    changeSetId,
    entityIds: [entidadeDe.get(placa)!],
    criadoPor: "gestor@x.com",
  });

it("com as duas parcelas conformes, a parcela fecha sozinha", async () => {
  await justificar(`AAA1A11|${JUROS}`, { conforme: true });
  await justificar(`AAA1A11|${AMORTIZACAO}`, { conforme: true });

  const [derivada] = await deduzir();

  expect(derivada.changeId).toBe(idDe.get(`AAA1A11|${PARCELA}`));
  /* Com o rótulo do catálogo, e não com o nome cru da coluna importada. */
  expect(derivada.formula).toBe("Parcela FINAME = Juros FINAME + Amortização");
  expect(derivada.regra).toContain("total calculado");
  expect(derivada.conforme).toBe(true);
  expect(derivada.motivoExcecao).toBeNull();
  expect(derivada.texto).toContain("Conforme a regra");
});

/* Um total que se moveu por causa de uma exceção não é um total conforme. */
it("exceção numa parcela faz do total uma exceção, com o responsável de lá", async () => {
  await justificar(`AAA1A11|${JUROS}`, {
    conforme: false,
    naoConformidade: "EXCECAO",
    motivoExcecao: "Taxa renegociada.",
    responsavelAprovacao: "Ana Souza",
  });
  await justificar(`AAA1A11|${AMORTIZACAO}`, { conforme: true });

  const [derivada] = await deduzir();

  expect(derivada.conforme).toBe(false);
  expect(derivada.naoConformidade).toBe("EXCECAO");
  expect(derivada.motivoExcecao).toContain("Juros FINAME");
  expect(derivada.responsavelAprovacao).toBe("Ana Souza");
});

/*
  Descumprimento predomina sobre exceção: um total que se moveu por causa de uma
  regra descumprida não vira exceção por haver uma parcela aprovada ao lado —
  chamá-lo de exceção afirmaria um aval que ninguém deu.
*/
it("descumprimento numa parcela predomina, e não herda aprovador", async () => {
  await justificar(`AAA1A11|${JUROS}`, {
    conforme: false,
    naoConformidade: "EXCECAO",
    motivoExcecao: "Taxa renegociada.",
    responsavelAprovacao: "Ana Souza",
  });
  await justificar(`AAA1A11|${AMORTIZACAO}`, {
    conforme: false,
    naoConformidade: "DESCUMPRIMENTO",
    motivoExcecao: "Pagou acima da tabela do acordo.",
  });

  const [derivada] = await deduzir();

  expect(derivada.conforme).toBe(false);
  expect(derivada.naoConformidade).toBe("DESCUMPRIMENTO");
  expect(derivada.motivoExcecao).toContain("Amortização");
  expect(derivada.responsavelAprovacao).toBeNull();
  expect(derivada.texto).toContain("Regra de remuneração descumprida");
});

it("faltando a justificativa de uma parcela, não deduz nada", async () => {
  await justificar(`AAA1A11|${JUROS}`, { conforme: true });
  expect(await deduzir()).toEqual([]);
});

/* Justificativa anterior a `0098` tem texto e não tem conformidade: dela não se
   deduz conformidade nenhuma. */
it("parcela com justificativa antiga, sem conformidade, não deduz", async () => {
  await justificar(`AAA1A11|${JUROS}`, { conforme: null });
  await justificar(`AAA1A11|${AMORTIZACAO}`, { conforme: true });
  expect(await deduzir()).toEqual([]);
});

it("o total que alguém justificou à mão não é sobrescrito", async () => {
  await justificar(`AAA1A11|${JUROS}`, { conforme: true });
  await justificar(`AAA1A11|${AMORTIZACAO}`, { conforme: true });
  await justificar(`AAA1A11|${PARCELA}`, {
    conforme: false,
    naoConformidade: "EXCECAO",
    responsavelAprovacao: "Ana",
  });
  expect(await deduzir()).toEqual([]);
});

/*
  A parcela que se moveu sem nenhuma das suas parcelas se mover não é derivada
  de nada: é inconsistência aritmética, e quem tem de olhar para ela é uma
  pessoa.
*/
it("total que se moveu sozinho continua pendente", async () => {
  expect(await deduzir("BBB2B22")).toEqual([]);
});

it("rodar de novo não duplica a derivada", async () => {
  await justificar(`AAA1A11|${JUROS}`, { conforme: true });
  await justificar(`AAA1A11|${AMORTIZACAO}`, { conforme: true });
  expect(await deduzir()).toHaveLength(1);
  expect(await deduzir()).toEqual([]);
});
