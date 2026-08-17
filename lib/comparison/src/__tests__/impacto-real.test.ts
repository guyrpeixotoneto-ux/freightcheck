import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  getQuinzenaMatrix,
  listImpactParameters,
  type QuinzenaMatrix,
} from "../impacto";

/**
 * A matriz, desembrulhada — e o vazio nomeado quando não há matriz.
 *
 * `getQuinzenaMatrix` devolvia `QuinzenaMatrix | null`, e estes testes usavam
 * `!` para dizer "aqui tem". Desde o PR-18 ela devolve `ComVazio<...>`, com o
 * motivo do vazio nomeado. A ajuda mantém os testes legíveis e, quando o vazio
 * acontecer onde não devia, falha **dizendo qual dos quatro estados foi** — que
 * é justamente o que o `!` não dizia.
 */
async function aMatriz(
  ...args: Parameters<typeof getQuinzenaMatrix>
): Promise<QuinzenaMatrix> {
  const r = await getQuinzenaMatrix(...args);
  if (!r.ok) {
    throw new Error(`esperava matriz e veio ${r.vazio.estado}: ${r.vazio.frase}`);
  }
  return r.valor;
}

/**
 * A tabela do Impacto, sobre o export real.
 *
 * Os números abaixo não foram calculados por este código: saíram da tabela
 * dinâmica que o cliente monta no Excel sobre o mesmo arquivo — `Soma de
 * finameCavalo`, dobrada por data de entrada, com as vigências nas colunas. É o
 * contrato desta leitura: se ela parar de reproduzir a planilha que o cliente
 * confere, ela mudou de ideia sobre o que está mostrando.
 *
 * O que cada bloco protege é uma forma diferente de errar:
 *
 * 1. **Somar onde não há dado.** Ausência de ativo tem de continuar vazia, e
 *    nunca virar R$ 0,00 — as duas coisas se parecem na tela e significam o
 *    oposto uma da outra.
 * 2. **Ler entrega parcial como frota que sumiu.** Uma quinzena que não trouxe
 *    o equipamento é coluna não entregue, não frota vazia.
 * 3. **Atribuir a preço o que foi frota.** A variação ponta a ponta se
 *    decompõe em três parcelas que somam exatamente a ela.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("impacto_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/** As nove vigências do export, na ordem em que a planilha as põe em coluna. */
const COLUNAS = [
  "EMPURRADA_2_12_2025",
  "EMPURRADA_2_1_2026",
  "EMPURRADA_2_2_2026",
  "EMPURRADA_2_3_2026",
  "EMPURRADA_2_4_2026",
  "EMPURRADA_2_5_2026",
  "EMPURRADA_2_6_2026",
  "EMPURRADA_2_7_2026",
  "EMPURRADA_1_8_2026",
];

const linhaDe = (matriz: QuinzenaMatrix, placa: string) =>
  matriz.groups.flatMap((g) => g.rows).find((l) => l.plate === placa);

describe("o eixo das colunas", () => {
  it("é uma coluna por vigência, na ordem do calendário", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    expect(matriz.periods.map((p) => p.sourceLabel)).toEqual(COLUNAS);
    expect(matriz.periods.every((p) => p.delivered)).toBe(true);
  });

  it("abre no parâmetro que o cliente confere, e ele sustenta dinheiro", async () => {
    const cavalo = await aMatriz(ctx.db, { entityType: "CAVALO" });
    expect(cavalo.attribute.code).toBe("cavalo.finame_cavalo");
    expect(cavalo.attribute.somavel).toBe(true);
    expect(cavalo.attribute.periodicity).toBe("MENSAL");

    const carreta = await aMatriz(ctx.db, { entityType: "CARRETA" });
    expect(carreta.attribute.code).toBe("carreta.finame_implemento");
    expect(carreta.attribute.somavel).toBe(true);
  });

  it("oferece os dois equipamentos que o export entrega", async () => {
    const matriz = await aMatriz(ctx.db);
    expect(matriz.entityTypes).toEqual(["CARRETA", "CAVALO"]);
  });
});

describe("os números da tabela dinâmica", () => {
  it("reproduz a linha do QYQ6A80, célula a célula", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    const linha = linhaDe(matriz, "QYQ6A80")!;

    // 7.937,22 na primeira, três quinzenas zeradas, e 3.318,01 daí em diante.
    expect(linha.cells.map((c) => c.value)).toEqual([
      7937.22, 0, 0, 0, 3318.01, 3318.01, 3318.01, 3318.01, 3318.01,
    ]);
    expect(linha.total).toBe(24527.27);
    expect(linha.first).toBe(7937.22);
    expect(linha.last).toBe(3318.01);
    expect(linha.delta).toBe(-4619.21);
  });

  it("dobra as linhas pela data de entrada, com o total do grupo fechando", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    expect(matriz.groupedBy?.code).toBe("cavalo.data");

    const grupo = matriz.groups.find((g) => g.label === "01/01/21")!;
    expect(grupo.rows.map((l) => l.plate)).toEqual([
      "QYQ6A80",
      "QYQ6B30",
      "QYQ6C20",
      "QYQ6H14",
    ]);
    // 4 × 7.937,22 — o subtotal que a planilha mostra na primeira coluna.
    expect(grupo.totals[0]).toBe(31748.88);
  });

  /**
   * Os dois grupos que só a regra do segundo separa.
   *
   * `01/06/21` chega como `2021-05-31T23:59:59.999` e `18/11/20` como
   * `2020-11-18T23:59:59.000`. Truncar a hora jogaria o primeiro para 31/05;
   * arredondar para a meia-noite mais próxima jogaria o segundo para 19/11.
   * Só arredondar para o segundo põe os dois onde a planilha do cliente os põe.
   */
  it("põe cada ativo no dia em que o arquivo diz que ele entrou", async () => {
    const cavalo = await aMatriz(ctx.db, { entityType: "CAVALO" });
    expect(
      cavalo.groups.find((g) => g.label === "01/06/21")?.rows.map((l) => l.plate),
    ).toEqual(["QYW2D78", "QYW2F98"]);
    expect(cavalo.groups.some((g) => g.label === "31/05/21")).toBe(false);

    const carreta = await aMatriz(ctx.db, { entityType: "CARRETA" });
    expect(
      carreta.groups.find((g) => g.label === "18/11/20")?.rows.map((l) => l.plate),
    ).toEqual(["QYP0H21", "QYP1E41"]);
    expect(carreta.groups.some((g) => g.label === "19/11/20")).toBe(false);
  });

  it("faz o mesmo pela carreta, que tem parâmetro próprio", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CARRETA" });
    expect(matriz.groupedBy?.code).toBe("carreta.data");

    const linha = linhaDe(matriz, "QYO6D17")!;
    expect(linha.cells[0].value).toBe(3743.09);
    expect(linha.cells.slice(1).every((c) => c.value === 0)).toBe(true);
  });

  it("soma cada coluna a partir das linhas, e o total geral a partir das colunas", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    const linhas = matriz.groups.flatMap((g) => g.rows);

    matriz.periods.forEach((periodo, i) => {
      const soma = linhas
        .filter((l) => l.cells[i].state === "VALOR")
        .reduce((total, l) => total + (l.cells[i].value ?? 0), 0);
      expect(periodo.total).toBeCloseTo(soma, 2);
      expect(periodo.withValue).toBe(
        linhas.filter((l) => l.cells[i].state === "VALOR").length,
      );
    });

    const somaDasColunas = matriz.totals.reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(matriz.grandTotal).toBeCloseTo(somaDasColunas, 2);
  });
});

describe("ausência não é zero", () => {
  it("deixa vazia a célula do ativo que não está na vigência", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    const foraEmAlguma = matriz.groups
      .flatMap((g) => g.rows)
      .filter((l) => l.cells.some((c) => c.state === "FORA_DA_FROTA"));

    // O export real tem entrada e saída de frota no intervalo; se não tivesse,
    // este teste estaria medindo a si mesmo.
    expect(foraEmAlguma.length).toBeGreaterThan(0);
    for (const linha of foraEmAlguma) {
      for (const celula of linha.cells) {
        if (celula.state === "FORA_DA_FROTA") expect(celula.value).toBeNull();
      }
    }
  });

  it("separa quem saiu da frota de quem passou a custar zero", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    const linha = linhaDe(matriz, "QYQ6A80")!;

    // O QYQ6A80 zerou e voltou: é queda de preço, não saída de frota.
    expect(linha.cells[1].state).toBe("VALOR");
    expect(linha.cells[1].movimento).toBe("CAIU");
    expect(linha.cells[1].delta).toBe(-7937.22);
    expect(linha.cells[4].movimento).toBe("SUBIU");
    expect(linha.cells[4].delta).toBe(3318.01);
    expect(linha.cells.every((c) => c.state !== "FORA_DA_FROTA")).toBe(true);
  });

  it("não inventa movimento na primeira coluna", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    const primeira = matriz.groups.flatMap((g) => g.rows).map((l) => l.cells[0]);
    expect(primeira.every((c) => c.movimento === null && c.delta === null)).toBe(true);
  });
});

describe("a variação ponta a ponta", () => {
  it("se decompõe em preço, entrada e saída — e as três somam a diferença", async () => {
    for (const entityType of ["CAVALO", "CARRETA"]) {
      const matriz = await aMatriz(ctx.db, { entityType });
      const p = matriz.pontaAPonta!;

      expect(p.fromLabel).toBe("EMPURRADA_2_12_2025");
      expect(p.toLabel).toBe("EMPURRADA_1_8_2026");
      expect(p.delta).toBeCloseTo(p.totalTo - p.totalFrom, 2);
      expect(p.comparados.delta + p.entraram.amount - p.sairam.amount).toBeCloseTo(
        p.delta,
        2,
      );
    }
  });

  /**
   * O caso que `end-to-end.ts` documenta, reencontrado por outro caminho.
   *
   * Aquele módulo chega aos mesmos números somando movimentos apurados entre
   * vigências vizinhas; este chega lendo o valor de cada ativo em cada coluna e
   * subtraindo as pontas. São duas contas independentes sobre o mesmo arquivo, e
   * elas têm de concordar — inclusive sobre a parte que **não** é preço: os
   * R$ 32.675 que sobram são dois cavalos que entraram na frota com FINAME
   * junto, e não um aumento.
   */
  it("reencontra os números que a leitura ponta a ponta já documentava", async () => {
    const matriz = await aMatriz(ctx.db, { entityType: "CAVALO" });
    const p = matriz.pontaAPonta!;

    expect(p.totalFrom).toBe(887408.65);
    expect(p.totalTo).toBe(867860.23);
    expect(p.delta).toBe(-19548.42);
    expect(p.comparados.delta).toBe(-52223.9);
    expect(p.entraram).toEqual({ entities: 2, amount: 32675.48, foraDaFrota: 2 });
    expect(p.sairam.entities).toBe(0);
  });
});

describe("o seletor de parâmetros", () => {
  it("põe na frente os que sustentam dinheiro, sem esconder os demais", async () => {
    const parametros = await listImpactParameters(ctx.db, "CAVALO");
    const somaveis = parametros.filter((p) => p.somavel);

    expect(somaveis.length).toBeGreaterThan(0);
    expect(parametros.slice(0, somaveis.length).every((p) => p.somavel)).toBe(true);
    // Um parâmetro sem semântica confirmada continua escolhível — é a tela que
    // diz o que falta, não a consulta que o apaga.
    expect(parametros.length).toBeGreaterThan(somaveis.length);
  });

  it("aceita trocar o parâmetro sem trocar a forma da tabela", async () => {
    const matriz = await aMatriz(ctx.db, {
      entityType: "CAVALO",
      attributeCode: "cavalo.amortizacao_cavalo",
    });
    expect(matriz.attribute.code).toBe("cavalo.amortizacao_cavalo");
    expect(matriz.periods.map((p) => p.sourceLabel)).toEqual(COLUNAS);
    expect(matriz.groups.length).toBeGreaterThan(0);
  });
});
