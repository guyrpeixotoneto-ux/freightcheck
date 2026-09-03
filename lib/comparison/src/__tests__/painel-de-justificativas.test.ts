import { afterAll, beforeAll, expect, it } from "vitest";
import { changeTable, justificativaTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { eq } from "drizzle-orm";
import { computeChangeSet } from "../engine";
import {
  autoresDeJustificativas,
  coberturaDeJustificativas,
  linhasDoPainel,
} from "../painel-de-justificativas";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * O Painel de Justificativas — quanto do que mudou já está explicado.
 *
 * A fila responde por uma comparação de cada vez; o painel afirma três números
 * na cara do gestor — quanto mudou, quanto está explicado, quanto falta — e o
 * que este teste prende é que essa conta não se deixa mentir pelas duas coisas
 * que a fariam mentir: **justificar de novo** (que grava linha nova, porque é
 * histórico, e não pode virar uma segunda alteração justificada) e a **placa
 * com várias alterações** (que só sai da lista de pendentes quando a última
 * delas for explicada).
 */

let ctx: TestDb;

const ATRIBUTOS: AttributeSpec[] = [
  { code: "cavalo.valor_a", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: "cavalo.valor_b", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

/** O trecho tem quilometragem, e é por ela que passa o lado variável. */
const ATRIBUTOS_DO_TRECHO: AttributeSpec[] = [
  { code: "trecho.km_ida", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

let changeSetId: string;
/** Uma comparação de trecho, para provar que ela não entra neste painel. */
let changeSetDoTrecho: string;
/** As alterações da comparação, por `placa|coluna` — para justificar uma escolhida. */
let idDe: Map<string, number>;

beforeAll(async () => {
  ctx = await createTestDatabase("painel_de_justificativas");

  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: "A",
        effectiveDate: "2026-07-01",
        data: {
          AAA1A11: { "cavalo.valor_a": 100, "cavalo.valor_b": 10 },
          BBB2B22: { "cavalo.valor_a": 200 },
        },
      },
      {
        label: "B",
        effectiveDate: "2026-08-01",
        data: {
          /* Duas colunas na mesma placa: é ela que só sai da fila quando as
             duas estiverem explicadas. */
          AAA1A11: { "cavalo.valor_a": 111, "cavalo.valor_b": 11 },
          /* Desceu — o outro lado do recorte por impacto. */
          BBB2B22: { "cavalo.valor_a": 150 },
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
      entityLabel: changeTable.entityLabel,
      attributeCode: changeTable.attributeCode,
    })
    .from(changeTable)
    .where(eq(changeTable.changeSetId, changeSetId));
  idDe = new Map(linhas.map((l) => [`${l.entityLabel}|${l.attributeCode}`, l.id]));

  /*
    E uma comparação de trecho ao lado, com uma justificativa escrita — é ela
    que o painel tem de não ver, nem na cobertura, nem na lista, nem no filtro
    de responsável.
  */
  const trecho = await buildFixture(
    ctx.db,
    ATRIBUTOS_DO_TRECHO,
    [
      {
        label: "A",
        effectiveDate: "2026-07-01",
        data: { "SAO PAULO > SANTOS": { "trecho.km_ida": 80 } },
      },
      {
        label: "B",
        effectiveDate: "2026-08-01",
        data: { "SAO PAULO > SANTOS": { "trecho.km_ida": 90 } },
      },
    ],
    { entityType: "TRECHO" },
  );
  const [ta, tb] = Object.values(trecho.snapshotIds);
  changeSetDoTrecho = (await computeChangeSet(ctx.db, ta, tb, { force: true })).id;

  const [alteracaoDoTrecho] = await ctx.db
    .select({ id: changeTable.id })
    .from(changeTable)
    .where(eq(changeTable.changeSetId, changeSetDoTrecho));

  await ctx.db.insert(justificativaTable).values({
    changeSetId: changeSetDoTrecho,
    changeId: alteracaoDoTrecho.id,
    entityLabel: "SAO PAULO > SANTOS",
    entityType: "TRECHO",
    texto: "rota refeita",
    criadoPor: "carla@x.com",
  });
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

async function justificar(chave: string, texto: string, criadoPor: string) {
  await ctx.db.insert(justificativaTable).values({
    changeSetId,
    changeId: idDe.get(chave)!,
    entityLabel: chave.split("|")[0],
    entityType: "CAVALO",
    texto,
    criadoPor,
  });
}

it("conta o que falta justificar, e a placa que ainda tem pendência", async () => {
  const antes = await coberturaDeJustificativas(ctx.db, [changeSetId]);

  expect(antes).toEqual([
    {
      changeSetId,
      entityType: "CAVALO",
      alteracoes: 3,
      justificadas: 0,
      placas: 2,
      placasPendentes: 2,
    },
  ]);

  await justificar("AAA1A11|cavalo.valor_a", "reajuste aprovado", "ana@x.com");

  const depois = await coberturaDeJustificativas(ctx.db, [changeSetId]);

  /* A placa continua pendente: a outra coluna dela não foi explicada. É a
     diferença entre "justifiquei uma alteração" e "acabei com esta placa". */
  expect(depois[0]).toMatchObject({
    alteracoes: 3,
    justificadas: 1,
    placas: 2,
    placasPendentes: 2,
  });

  await justificar("AAA1A11|cavalo.valor_b", "mesmo reajuste", "ana@x.com");

  expect((await coberturaDeJustificativas(ctx.db, [changeSetId]))[0]).toMatchObject({
    justificadas: 2,
    placasPendentes: 1,
  });
});

/*
  Reescrever grava linha nova — é histórico, não edição (ver
  `schema/justificativa.ts`). Contar linhas de justificativa como "justificadas"
  contaria a alteração reescrita duas vezes, e o painel passaria dos 100%.
*/
it("não conta duas vezes a alteração justificada de novo", async () => {
  await justificar("AAA1A11|cavalo.valor_a", "corrigindo o texto anterior", "ana@x.com");

  expect((await coberturaDeJustificativas(ctx.db, [changeSetId]))[0]).toMatchObject({
    alteracoes: 3,
    justificadas: 2,
  });

  const autores = await autoresDeJustificativas(ctx.db, [changeSetId]);
  expect(autores).toHaveLength(1);
  expect(autores[0]).toMatchObject({ criadoPor: "ana@x.com", justificadas: 2 });
});

it("lista a pendência que sobrou, e a justificativa que vale hoje", async () => {
  const pendentes = await linhasDoPainel(ctx.db, {
    changeSetIds: [changeSetId],
    situacao: "PENDENTE",
  });

  expect(pendentes.total).toBe(1);
  expect(pendentes.linhas[0]).toMatchObject({
    entityLabel: "BBB2B22",
    attributeCode: "cavalo.valor_a",
    texto: null,
    criadoPor: null,
  });

  const justificadas = await linhasDoPainel(ctx.db, {
    changeSetIds: [changeSetId],
    situacao: "JUSTIFICADA",
  });

  expect(justificadas.total).toBe(2);
  /* A mais recente, e uma linha só por alteração — mesmo com duas gravadas. */
  const valorA = justificadas.linhas.find(
    (l) => l.entityLabel === "AAA1A11" && l.attributeCode === "cavalo.valor_a",
  );
  expect(valorA?.texto).toBe("corrigindo o texto anterior");
});

it("recorta por aumento e por redução, que é por que se justifica", async () => {
  const aumento = await linhasDoPainel(ctx.db, {
    changeSetIds: [changeSetId],
    situacao: "TODAS",
    direcao: "AUMENTO",
  });
  const reducao = await linhasDoPainel(ctx.db, {
    changeSetIds: [changeSetId],
    situacao: "TODAS",
    direcao: "REDUCAO",
  });

  expect(aumento.linhas.map((l) => l.entityLabel).sort()).toEqual(["AAA1A11", "AAA1A11"]);
  expect(reducao.total).toBe(1);
  expect(reducao.linhas[0].entityLabel).toBe("BBB2B22");
});

/* O total é o da lista inteira, e não o da página: é ele que diz quantas
   páginas existem — ver `components/ui/paginacao.tsx`. */
it("pagina no banco, com o total ao lado", async () => {
  const primeira = await linhasDoPainel(ctx.db, {
    changeSetIds: [changeSetId],
    situacao: "TODAS",
    limit: 2,
    offset: 0,
  });
  const segunda = await linhasDoPainel(ctx.db, {
    changeSetIds: [changeSetId],
    situacao: "TODAS",
    limit: 2,
    offset: 2,
  });

  expect(primeira.total).toBe(3);
  expect(primeira.linhas).toHaveLength(2);
  expect(segunda.linhas).toHaveLength(1);
  expect(
    new Set([...primeira.linhas, ...segunda.linhas].map((l) => l.changeId)).size,
  ).toBe(3);
});

/*
  O trecho não é deste painel — a razão está em
  `painel-de-justificativas-escopo.ts`. O que se prende aqui é que ele sai da
  **conta**, e não só da fileira de abas: um painel que escondesse a aba e
  continuasse somando o trecho nos cartões afirmaria um total que a própria
  tela não sabe abrir.

  E sai das três leituras, e não de uma: a cobertura (que é o cartão e a
  rosca), a lista (que é a fila) e os autores (que é o filtro "Responsável",
  cuja contagem tem de bater com a lista que ele abre).
*/
it("não cobra o trecho — nem na cobertura, nem na lista, nem nos autores", async () => {
  expect(await coberturaDeJustificativas(ctx.db, [changeSetDoTrecho])).toEqual([]);
  expect(await autoresDeJustificativas(ctx.db, [changeSetDoTrecho])).toEqual([]);
  expect(
    await linhasDoPainel(ctx.db, {
      changeSetIds: [changeSetDoTrecho],
      situacao: "TODAS",
    }),
  ).toEqual({ total: 0, linhas: [] });
});

/* Somadas as duas comparações, o painel devolve só a que ele cobra — é este o
   caso da tela, que soma o acervo inteiro da unidade aberta. */
it("some com o trecho também quando o painel soma o acervo inteiro", async () => {
  const ambas = [changeSetId, changeSetDoTrecho];

  const cobertura = await coberturaDeJustificativas(ctx.db, ambas);
  expect(cobertura.map((l) => l.entityType)).toEqual(["CAVALO"]);

  const autores = await autoresDeJustificativas(ctx.db, ambas);
  expect(autores.map((a) => a.criadoPor)).toEqual(["ana@x.com"]);

  const lista = await linhasDoPainel(ctx.db, { changeSetIds: ambas, situacao: "TODAS" });
  expect(lista.total).toBe(3);
  expect(lista.linhas.every((l) => l.entityType === "CAVALO")).toBe(true);
});

it("não vai ao banco quando não há comparação nenhuma para somar", async () => {
  expect(await coberturaDeJustificativas(ctx.db, [])).toEqual([]);
  expect(await autoresDeJustificativas(ctx.db, [])).toEqual([]);
  expect(await linhasDoPainel(ctx.db, { changeSetIds: [] })).toEqual({
    total: 0,
    linhas: [],
  });
});
