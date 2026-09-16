import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entityTable } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type LinhaSpec } from "./planilha-sintetica";

/**
 * A aprovação fala com o banco por lote — e não por veículo.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo protege
 * ---------------------------------------------------------------------------
 * A promoção criava cada entidade nova com um `INSERT … RETURNING` próprio.
 * Numa base madura isso não aparece — as placas já existem, e a consulta em
 * lote que as resolve é uma só. Aparece exatamente onde dói: no primeiro
 * arquivo de uma frota, onde toda placa é nova. Medido com 51.600 linhas, eram
 * 51.600 idas ao banco em série dentro da transação, com a barra de progresso
 * parada o tempo inteiro, porque a promoção só a move quando grava fatos.
 *
 * Um teste de tempo seria frágil e mediria a máquina. O que se afirma aqui é a
 * **forma**: dobrar o número de veículos novos não pode dobrar o número de
 * statements. As idas que restam são as do lote — algumas dezenas, constantes
 * —, então a diferença entre os dois arquivos fica perto de zero, e voltar ao
 * padrão N+1 a levaria a seiscentas.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("promocao_em_lote");
}, 120_000);

afterAll(async () => {
  await ctx.drop();
});

/*
  Contar idas ao banco pede o driver, e o driver é pedido em runtime — pelo
  mesmo motivo do `perfil-de-importacao`: quem fala com o Postgres é
  `@workspace/db`, e este pacote só o conhece para instrumentar.
*/
const exigir = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg: any = exigir("pg");

let contando = false;
let idas = 0;
const queryOriginal = pg.Client.prototype.query;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
pg.Client.prototype.query = function (this: unknown, ...args: any[]) {
  if (contando) idas++;
  return queryOriginal.apply(this as never, args as never);
};

/** Placas distintas e válidas, sem depender de sorteio. */
function placa(i: number): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const l = (n: number) => letras[n % 26];
  return `${l(i)}${l(Math.floor(i / 26))}${l(Math.floor(i / 676))}${i % 10}${l(Math.floor(i / 7))}${String(i % 100).padStart(2, "0")}`;
}

/**
 * Importa um arquivo de `linhas` veículos **novos** e devolve quantas idas ao
 * banco a aprovação dele custou.
 *
 * `deslocamento` afasta as placas das do outro arquivo: duas frotas
 * disjuntas, para que a segunda importação crie tantas entidades quanto a
 * primeira em vez de reencontrá-las.
 */
async function idasDaPromocao(
  linhas: number,
  deslocamento: number,
  vigencia: string,
): Promise<number> {
  const spec: LinhaSpec[] = Array.from({ length: linhas }, (_, i) => ({
    placa: placa(i + deslocamento),
    valores: { "Custo Fixo": 1000 + i, "Custo Variavel": 2000 + i },
  }));
  const caminho = escreverPlanilha({
    vigencia,
    abas: [{ nome: "cavalos", linhas: spec }],
  });

  const recebido = await receiveFile(ctx.db, { filePath: caminho });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);

  idas = 0;
  contando = true;
  const resultado = await promote(ctx.db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
  contando = false;

  // A afirmação só vale se as entidades eram mesmo novas.
  expect(resultado.entitiesCreated).toBe(linhas);
  return idas;
}

describe("a aprovação fala com o banco por lote", () => {
  it("não gasta uma ida ao banco por veículo novo", async () => {
    const poucos = await idasDaPromocao(300, 0, "EMPURRADA_1_3_2032");
    const muitos = await idasDaPromocao(600, 5_000, "EMPURRADA_2_3_2032");

    /*
      Trezentos veículos a mais, e o custo em idas ao banco fica onde estava.
      A folga cobre o que de fato cresce com o volume — um statement em massa a
      mais aqui ou ali —, e continua uma ordem de grandeza abaixo dos 300 que o
      padrão N+1 somaria.
    */
    expect(muitos - poucos).toBeLessThan(30);
    // E o lote inteiro cabe em poucas dezenas de idas, não em centenas.
    expect(muitos).toBeLessThan(120);

    // Nenhuma entidade se perdeu no caminho do INSERT em massa: 900 veículos,
    // 900 linhas em `entity`, todas com id próprio.
    const entidades = await ctx.db
      .select({ id: entityTable.id })
      .from(entityTable);
    expect(entidades).toHaveLength(900);
    expect(new Set(entidades.map((e) => e.id)).size).toBe(900);
  }, 300_000);
});
