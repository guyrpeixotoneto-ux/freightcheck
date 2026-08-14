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
import { computeMissingChangeSets } from "../consolidated";
import { getGroupedView } from "../grouped";
import { getFamiliesView } from "../families-view";
import { FAMILIES, FREIGHTECH_SEM_DADO, placementOf } from "../families";

/**
 * A camada de famílias, sobre o export real.
 *
 * É projeção: os mesmos grupos da visão agrupada, arrumados nas gavetas que o
 * usuário do Freightech já conhece. Este arquivo existe para provar as três
 * coisas que um agrupamento pode quebrar sem fazer barulho:
 *
 * 1. **Que a soma das partes fecha com o todo**, dentro de cada periodicidade.
 * 2. **Que a dupla contagem pai/parcela continua retirada** mesmo quando o
 *    titular e a parcela caem em famílias diferentes — que é exatamente o caso
 *    de `carreta.custo_fixo` (Aquisição) e `lucro_fixomodelo_novo_ciclo`
 *    (Modelos de remuneração).
 * 3. **Que nenhum atributo desapareceu** no caminho.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("families_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
  await computeMissingChangeSets(ctx.db, "test:families");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("cobertura do mapa", () => {
  it("classifica os 138 atributos do export, sem sobra", async () => {
    const { rows } = await ctx.db.execute<{ code: string }>(
      sql`SELECT code FROM attribute ORDER BY code`,
    );
    expect(rows).toHaveLength(138);

    const semFamilia = rows
      .map((r) => r.code)
      .filter((code) => placementOf(code).family === "SEM_FAMILIA");
    expect(semFamilia).toEqual([]);
  });

  it("uma coluna que a Ambev invente cai em Sem família, e não some", () => {
    const placement = placementOf("cavalo.coluna_que_nao_existe_ainda");
    expect(placement.family).toBe("SEM_FAMILIA");
    expect(placement.parameter).toBe("cavalo.coluna_que_nao_existe_ainda");
    expect(FAMILIES.SEM_FAMILIA.name).toBe("Sem família");
  });

  it("não inventa família para o que o Freightech tem e este export não traz", () => {
    const nomes = FREIGHTECH_SEM_DADO.map((f) => f.family);
    expect(nomes).toContain("Equipe");
    expect(nomes).toContain("Uniformes e EPIs");
    // E nenhuma delas é uma família da tela.
    const daTela = Object.values(FAMILIES).map((f) => f.name);
    for (const nome of ["Equipe", "Uniformes e EPIs", "Despesas"]) {
      expect(daTela).not.toContain(nome);
    }
  });
});

describe("a soma das famílias fecha com a vigência", () => {
  it("em cada periodicidade, e sem contar o mesmo dinheiro duas vezes", async () => {
    const view = (await getFamiliesView(ctx.db))!;

    const somaDasFamilias: Record<string, number> = {};
    for (const family of view.families) {
      for (const [periodicity, amount] of Object.entries(family.impact.byPeriodicity)) {
        somaDasFamilias[periodicity] = (somaDasFamilias[periodicity] ?? 0) + amount;
      }
    }

    for (const [periodicity, total] of Object.entries(view.impact.byPeriodicity)) {
      expect(somaDasFamilias[periodicity] ?? 0, `periodicidade ${periodicity}`).toBeCloseTo(
        total,
        2,
      );
    }
    // E nenhuma periodicidade aparece só de um lado.
    expect(Object.keys(somaDasFamilias).sort()).toEqual(
      Object.keys(view.impact.byPeriodicity).sort(),
    );
  });

  it("a soma dos parâmetros fecha com a família", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    for (const family of view.families) {
      const soma: Record<string, number> = {};
      for (const parameter of family.parameters) {
        for (const [p, amount] of Object.entries(parameter.impact.byPeriodicity)) {
          soma[p] = (soma[p] ?? 0) + amount;
        }
      }
      for (const [p, total] of Object.entries(family.impact.byPeriodicity)) {
        expect(soma[p] ?? 0, `${family.name} / ${p}`).toBeCloseTo(total, 2);
      }
    }
  });

  it("mantém o titular fora da soma quando a parcela mudou noutra família", async () => {
    // custoFixo (Aquisição e financiamento) = finame (mesma família) +
    // lucroFixomodeloNovoCiclo (Modelos de remuneração). Se a fatia por família
    // montasse o próprio índice de composição, a parcela de fora ficaria
    // invisível e o titular voltaria para a soma.
    expect(placementOf("carreta.custo_fixo").family).toBe("AQUISICAO_FINANCIAMENTO");
    expect(placementOf("carreta.lucro_fixomodelo_novo_ciclo").family).toBe(
      "MODELOS_REMUNERACAO",
    );

    const periodos = (await getGroupedView(ctx.db))!.periods.map((p) => p.date);
    let viuExclusao = false;
    for (const period of periodos) {
      const view = (await getFamiliesView(ctx.db, period))!;
      const excluidos = view.families.reduce(
        (sum, f) => sum + f.impact.excludedChanges,
        0,
      );
      if (excluidos > 0) {
        viuExclusao = true;
        // O que a família excluiu é o mesmo que a vigência excluiu.
        expect(excluidos).toBe(view.impact.excludedChanges);
      }
    }
    // A base real tem pelo menos uma vigência com composição em jogo; se não
    // tivesse, este teste não estaria provando nada e é melhor saber disso.
    expect(viuExclusao).toBe(true);
  });
});

describe("nada some no caminho", () => {
  it("toda alteração da vigência está dentro de alguma família", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    const somaChanges = view.families.reduce((sum, f) => sum + f.changes, 0);
    expect(somaChanges).toBe(view.totals.changes);
  });

  it("todo grupo da vigência está dentro de algum parâmetro", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    const grupos = view.families.flatMap((f) => f.parameters.flatMap((p) => p.groups));
    expect(grupos).toHaveLength(view.groups.length);
    expect(new Set(grupos.map((g) => g.key)).size).toBe(view.groups.length);
  });
});

describe("o resumo executivo", () => {
  it("separa perda de ganho dentro de cada periodicidade, e as duas fecham no líquido", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    const { lossesByPeriodicity, gainsByPeriodicity } = view.summary;

    for (const [periodicity, liquido] of Object.entries(view.impact.byPeriodicity)) {
      const perda = lossesByPeriodicity[periodicity] ?? 0;
      const ganho = gainsByPeriodicity[periodicity] ?? 0;
      expect(perda + ganho, `líquido de ${periodicity}`).toBeCloseTo(liquido, 2);
      // Perda é sempre negativa e ganho sempre positivo — nunca o contrário.
      expect(perda).toBeLessThanOrEqual(0);
      expect(ganho).toBeGreaterThanOrEqual(0);
    }
  });

  it("não produz um número único somando periodicidades", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    for (const vehicle of view.summary.topVehicles) {
      // O ranking guarda o valor por periodicidade, nunca um escalar.
      expect(typeof vehicle.byPeriodicity).toBe("object");
    }
    for (const parameter of view.summary.topParameters) {
      expect(typeof parameter.byPeriodicity).toBe("object");
    }
  });

  it("conta travadas e sem preço em vez de escondê-las", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    expect(view.summary.notCalculable).toBe(view.impact.notCalculable);
    expect(view.summary.locked).toBe(
      view.families.reduce((sum, f) => sum + f.locked, 0),
    );
    // A base real tem semântica pendente de sobra; se isso zerar um dia, é
    // porque a curadoria acabou — e aí este teste deve ser revisto, não removido.
    expect(view.summary.notCalculable).toBeGreaterThan(0);
  });
});

describe("as famílias que o dado sustenta", () => {
  it("Frota, Aquisição e Tributos existem e têm parâmetros com dado", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    const byCode = new Map(view.families.map((f) => [f.code, f]));

    for (const code of ["FROTA", "AQUISICAO_FINANCIAMENTO", "TRIBUTOS_SEGUROS"] as const) {
      const family = byCode.get(code);
      expect(family, code).toBeDefined();
      expect(family!.parametersWithData).toBeGreaterThan(0);
      expect(family!.parametersChanged).toBeLessThanOrEqual(family!.parametersWithData);
    }
  });

  it("diz quando a gaveta ainda depende de resposta do cliente", async () => {
    const view = (await getFamiliesView(ctx.db))!;
    const parametros = view.families.flatMap((f) => f.parameters);
    const pendentes = parametros.filter((p) => p.pending !== null);
    // O IPVA é o caso: no Freightech ele pode estar sob Manutenção Cavalo, e a
    // tela precisa dizer por que aqui ele está em Tributos.
    const ipva = parametros.find((p) => p.key === "TRIBUTOS_SEGUROS|IPVA e licenciamento");
    if (ipva) {
      expect(ipva.pending).toMatch(/Manutenção Cavalo/);
      expect(pendentes.length).toBeGreaterThan(0);
    }
  });
});
