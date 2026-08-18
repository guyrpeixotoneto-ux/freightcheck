import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { listContexts, type ContextInfo } from "@workspace/comparison";
import type { Database } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { escreverPlanilha, type PlanilhaSpec } from "@workspace/ingest/testing/planilha";
import { getVinculoDoCavalo } from "../ficha";
import { montarComposicao } from "../motor";

/**
 * O vínculo cavalo–carreta **contra o banco que a produção tem de verdade**.
 *
 * `composicao-real.test.ts` já prova que o vínculo resolve 62 de 62 no export
 * do cliente. O que ele não podia provar é o que este arquivo existe para
 * fechar: naquele banco toda vigência foi importada **uma vez só**, e há um
 * contexto só. A produção não é assim — reimportar uma vigência é a operação
 * normal de correção, e ela não apaga a revisão anterior: a antiga passa a
 * SUPERSEDED e os fatos dela **continuam no banco** (`0001_immutability_guards`,
 * `0010_import_deletion`). Do mesmo modo, a mesma data existe em mais de um
 * contexto assim que entram duas unidades ou dois canais.
 *
 * Nos dois casos a leitura do vínculo passava a enxergar mais de uma linha para
 * o mesmo cavalo, e o `(SELECT placa_carreta FROM vinculo)` — subconsulta usada
 * como valor — derrubava a consulta inteira com
 * `21000: more than one row returned by a subquery used as an expression`.
 * Na tela, a ficha do equipamento respondia 500 enquanto a lista da frota, que
 * não resolve vínculo nenhum, continuava abrindo normalmente.
 *
 * Por isso as duas montagens abaixo passam pelo pipeline de importação de
 * verdade, e não por `INSERT` à mão: o que está sob teste é o estado que o
 * produto produz sozinho depois da segunda importação.
 */

let ctx: TestDb;

/** Montagem 1: as duas revisões. `..._1_8_2026` é 01/08/2026. */
const AGOSTO = "2026-08-01";
/** Montagem 2: os três contextos. Data própria, para não colidir com a 1. */
const SETEMBRO = "2026-09-01";

const UNIDADE_A = "07.526.557/0015-05";
const UNIDADE_B = "07.526.557/0022-14";

/**
 * Uma planilha com o vínculo declarado — a coluna `Placa Carreta`, que é a
 * única coisa que estes testes precisam variar.
 */
function planilha(spec: {
  vigencia: string;
  unidadeCnpj?: string;
  cavalos: { placa: string; carreta: string }[];
  carretas: { placa: string; custoFixo: number }[];
}): PlanilhaSpec {
  return {
    vigencia: spec.vigencia,
    ...(spec.unidadeCnpj !== undefined ? { unidadeCnpj: spec.unidadeCnpj } : {}),
    abas: [
      {
        nome: "cavalos",
        colunas: ["Placa Carreta"],
        linhas: spec.cavalos.map((c) => ({
          placa: c.placa,
          valores: { "Placa Carreta": c.carreta },
        })),
      },
      {
        nome: "carretas",
        linhas: spec.carretas.map((c) => ({
          placa: c.placa,
          valores: { "Custo Fixo": c.custoFixo },
        })),
      },
    ],
  };
}

/** Do recebimento à promoção, como a rota de importação faz. */
async function importar(
  db: Database,
  spec: PlanilhaSpec,
  modo?: "FAIL" | "NEW_REVISION",
): Promise<void> {
  const recebido = await receiveFile(db, { filePath: escreverPlanilha(spec) });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  await promote(db, recebido.importRunId, {
    ...(modo !== undefined ? { onExistingSnapshot: modo } : {}),
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
}

function digitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

async function entityIdDaPlaca(db: Database, placa: string): Promise<string> {
  const { rows } = await db.execute<{ entity_id: string }>(sql`
    SELECT entity_id::text AS entity_id
      FROM entity_identifier
     WHERE identifier_type = 'PLACA' AND identifier_value = ${placa} AND is_current
  `);
  expect(rows, `identificador corrente de ${placa}`).toHaveLength(1);
  return rows[0].entity_id;
}

function contextoDe(contextos: ContextInfo[], canal: string, unidadeCnpj: string): ContextInfo {
  const achado = contextos.find(
    (c) =>
      c.channel === canal &&
      c.scopes.some((s) => s.scopeType === "UNIDADE" && digitos(s.code) === digitos(unidadeCnpj)),
  );
  expect(achado, `contexto ${canal} · ${unidadeCnpj}`).toBeDefined();
  return achado!;
}

/** O vínculo pelo mesmo caminho da rota: o contexto e a data são os da ficha. */
async function vinculoDaFicha(db: Database, entityId: string, contexto: ContextInfo, period: string) {
  const composicao = await montarComposicao(db, entityId, {
    period,
    context: { scopeHash: contexto.scopeHash, channel: contexto.channel },
  });
  expect(composicao, `a ficha de ${entityId} em ${period}`).not.toBeNull();
  expect(composicao!.effectiveDate).toBe(period);

  return getVinculoDoCavalo(db, entityId, {
    effectiveDate: composicao!.effectiveDate,
    context: { scopeHash: composicao!.scopeHash, channel: composicao!.channel },
  });
}

beforeAll(async () => {
  ctx = await createTestDatabase("composition_vinculo");

  /*
    Montagem 1 — duas revisões da mesma vigência, no mesmo contexto.

    A revisão 1 aponta o cavalo para CAR1A11; a revisão 2 corrige para CAR2B22.
    O custo fixo de CAR2B22 também muda entre as duas, e isso não é enfeite: o
    total do conjunto sai de uma segunda leitura, que tinha exatamente o mesmo
    defeito de filtro. Com 1500 na revisão morta e 2000 na viva, um número diz
    de qual revisão ele veio.
  */
  await importar(
    ctx.db,
    planilha({
      vigencia: "EMPURRADA_1_8_2026",
      cavalos: [{ placa: "CAV1A11", carreta: "CAR1A11" }],
      carretas: [
        { placa: "CAR1A11", custoFixo: 1000 },
        { placa: "CAR2B22", custoFixo: 1500 },
      ],
    }),
  );
  await importar(
    ctx.db,
    planilha({
      vigencia: "EMPURRADA_1_8_2026",
      cavalos: [{ placa: "CAV1A11", carreta: "CAR2B22" }],
      carretas: [
        { placa: "CAR1A11", custoFixo: 1000 },
        { placa: "CAR2B22", custoFixo: 2000 },
      ],
    }),
    "NEW_REVISION",
  );

  /*
    Montagem 2 — a mesma data em três contextos, e o mesmo cavalo nos três.

    CAV2B22 é o **mesmo equipamento** nos três arquivos: a placa é a identidade,
    e `entity_identifier_current_uq` garante que ela é de um só. Em cada contexto
    ele puxa uma carreta diferente, e é isso que torna o vazamento detectável —
    quem ignorasse o contexto veria três vínculos onde a tela pediu um.
  */
  await importar(
    ctx.db,
    planilha({
      vigencia: "EMPURRADA_1_9_2026",
      cavalos: [{ placa: "CAV2B22", carreta: "CAR6F66" }],
      carretas: [{ placa: "CAR6F66", custoFixo: 6000 }],
    }),
  );
  await importar(
    ctx.db,
    planilha({
      vigencia: "PUXADA_1_9_2026",
      cavalos: [{ placa: "CAV2B22", carreta: "CAR4D44" }],
      carretas: [{ placa: "CAR4D44", custoFixo: 4000 }],
    }),
  );
  await importar(
    ctx.db,
    planilha({
      vigencia: "EMPURRADA_1_9_2026",
      unidadeCnpj: UNIDADE_B,
      cavalos: [{ placa: "CAV2B22", carreta: "CAR5E55" }],
      carretas: [{ placa: "CAR5E55", custoFixo: 5000 }],
    }),
  );
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("duas revisões da mesma vigência", () => {
  it("a revisão anterior fica SUPERSEDED e os fatos dela continuam no banco", async () => {
    const { rows } = await ctx.db.execute<{
      status: string;
      revision: number;
      placas: string[];
    }>(sql`
      SELECT s.status::text AS status,
             s.revision,
             array_agg(f.value_text ORDER BY f.value_text) AS placas
        FROM snapshot s
        JOIN fact f      ON f.snapshot_id = s.id
        JOIN attribute a ON a.id = f.attribute_id
        JOIN entity_identifier ei
          ON ei.entity_id = f.entity_id AND ei.identifier_type = 'PLACA' AND ei.is_current
       WHERE a.code = 'cavalo.placa_carreta'
         AND ei.identifier_value = 'CAV1A11'
         AND s.effective_date = ${AGOSTO}::date
       GROUP BY 1, 2
       ORDER BY s.revision
    `);

    // É esta a armadilha: duas linhas para o mesmo cavalo, na mesma data.
    expect(rows).toEqual([
      { status: "SUPERSEDED", revision: 1, placas: ["CAR1A11"] },
      { status: "CLOSED", revision: 2, placas: ["CAR2B22"] },
    ]);
  });

  it("a ficha do cavalo abre, e o vínculo é o da revisão viva", async () => {
    const cavalo = await entityIdDaPlaca(ctx.db, "CAV1A11");
    const contexto = contextoDe(await listContexts(ctx.db), "EMPURRADA", UNIDADE_A);

    const vinculo = await vinculoDaFicha(ctx.db, cavalo, contexto, AGOSTO);

    expect(vinculo).not.toBeNull();
    expect(vinculo!.placaCarreta).toBe("CAR2B22");
    expect(vinculo!.carretaEntityId).toBe(await entityIdDaPlaca(ctx.db, "CAR2B22"));
    // 2000 é o da revisão viva; 1500 seria o da morta.
    expect(vinculo!.totalDoConjunto).toBe(2000);
    expect(vinculo!.ambiguidade).toBeNull();

    // E a carreta da revisão superada não é o vínculo de ninguém.
    expect(vinculo!.carretaEntityId).not.toBe(await entityIdDaPlaca(ctx.db, "CAR1A11"));
  });
});

describe("a mesma data em mais de um contexto", () => {
  it("cada contexto resolve a sua carreta, e nenhum enxerga a do vizinho", async () => {
    const cavalo = await entityIdDaPlaca(ctx.db, "CAV2B22");
    const contextos = await listContexts(ctx.db);

    const esperado = [
      { canal: "EMPURRADA", unidade: UNIDADE_A, carreta: "CAR6F66", total: 6000 },
      { canal: "PUXADA", unidade: UNIDADE_A, carreta: "CAR4D44", total: 4000 },
      { canal: "EMPURRADA", unidade: UNIDADE_B, carreta: "CAR5E55", total: 5000 },
    ];

    for (const caso of esperado) {
      const onde = `${caso.canal} · ${caso.unidade}`;
      const contexto = contextoDe(contextos, caso.canal, caso.unidade);
      const vinculo = await vinculoDaFicha(ctx.db, cavalo, contexto, SETEMBRO);

      expect(vinculo, onde).not.toBeNull();
      expect(vinculo!.placaCarreta, onde).toBe(caso.carreta);
      expect(vinculo!.carretaEntityId, onde).toBe(
        await entityIdDaPlaca(ctx.db, caso.carreta),
      );
      expect(vinculo!.totalDoConjunto, onde).toBe(caso.total);
      expect(vinculo!.ambiguidade, onde).toBeNull();
    }
  });
});

describe("a placa corrente é de um equipamento só", () => {
  /**
   * A CTE `carreta` procura a placa entre os identificadores **correntes**, e a
   * pergunta legítima é se ela pode devolver mais de uma carreta. Não pode, e
   * não é convenção nossa: `entity_identifier_current_uq` é um índice único
   * parcial sobre (`identifier_type`, `identifier_value`) `WHERE is_current`.
   *
   * É por isso que a leitura não escolhe uma carreta arbitrária quando aparece
   * mais de uma — ela devolve `ambiguidade` para o chamador registrar, porque
   * um banco nesse estado contradiz a própria invariante e quem opera precisa
   * saber. Este teste é o que mantém a afirmação verdadeira: no dia em que
   * alguém remover o índice, ele reprova aqui, e não em produção.
   */
  it("o banco recusa duas carretas correntes com a mesma placa", async () => {
    const carreta = await entityIdDaPlaca(ctx.db, "CAR1A11");
    const outra = await entityIdDaPlaca(ctx.db, "CAR2B22");
    expect(carreta).not.toBe(outra);

    const erro = await ctx.db
      .execute(
        sql`
          INSERT INTO entity_identifier
            (entity_id, identifier_type, identifier_value, effective_from, is_current)
          VALUES (${outra}::uuid, 'PLACA', 'CAR1A11', ${AGOSTO}::date, true)
        `,
      )
      .then(
        () => null,
        (e: unknown) => e as { cause?: { constraint?: string } },
      );

    expect(erro, "o índice deixou passar duas placas correntes iguais").not.toBeNull();
    expect(erro!.cause?.constraint).toBe("entity_identifier_current_uq");
  });
});
