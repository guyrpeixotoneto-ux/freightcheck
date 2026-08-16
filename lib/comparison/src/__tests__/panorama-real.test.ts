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
import { getPanoramaDeAlteracoes, type ParametroAlterado } from "../panorama";

/**
 * O panorama, sobre o export real.
 *
 * Os números vieram da aritmética sobre os dois arquivos de `attached_assets`,
 * medida fora deste código antes de ser esperada aqui — contando transições de
 * valor entre vigências consecutivas, placa a placa. É o contrato desta
 * leitura: ela existe para responder *o que mudou* sem que ninguém precise
 * escolher um parâmetro primeiro, e cada bloco abaixo protege uma forma
 * diferente de errar essa resposta.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("panorama_real");
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

const de = (
  panorama: Awaited<ReturnType<typeof getPanoramaDeAlteracoes>>,
  code: string,
): ParametroAlterado | undefined =>
  panorama!.parametros.find((p) => p.code === code);

describe("o primeiro nível responde o que mudou", () => {
  it("lista muito mais do que o FINAME", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // Dezenove parâmetros do cavalo e dezesseis da carreta mudaram no export.
    // O número exato importa menos do que a ordem de grandeza: abrir num
    // parâmetro escondia dezenas de alterações reais.
    expect(panorama.parametros.length).toBeGreaterThan(25);
    expect(panorama.totais.alteracoes).toBeGreaterThan(2000);
  });

  it("atravessa os dois equipamentos numa lista só", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const tipos = new Set(panorama.parametros.map((p) => p.entityType));
    expect([...tipos].sort()).toEqual(["CARRETA", "CAVALO"]);
  });

  it("conta as transições de valor, e não as linhas do arquivo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // Medido no arquivo: finameCavalo muda 37 vezes, em 15 das 64 placas.
    const finame = de(panorama, "cavalo.finame_cavalo")!;
    expect(finame.changes).toBe(37);
    expect(finame.entities).toBe(15);
    expect(finame.entitiesNaSerie).toBe(64);

    // E o IPVA do cavalo muda 122 vezes, em 62 placas — muito mais do que o
    // parâmetro em que a aba abria.
    const ipva = de(panorama, "cavalo.ipva_licenciamento")!;
    expect(ipva.changes).toBe(122);
    expect(ipva.entities).toBe(62);
  });
});

describe("as duas contas nunca viram uma", () => {
  it("o ranking financeiro só admite quem passa na régua", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    for (const code of panorama.maiorImpacto) {
      const p = de(panorama, code)!;
      expect(p.impactoCalculavel).toBe(true);
      expect(p.semanticsStatus).toBe("CONFIRMED");
      expect(p.isMonetary).toBe(true);
      expect(p.aggregation).toBe("SUM");
    }
  });

  it("quem lidera em alterações não lidera em dinheiro", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // `manutencao_vida_meses` muda 494 vezes e não é dinheiro nenhum. Um
    // ranking só, ordenado por quantidade, o poria acima de tudo que custa.
    expect(panorama.maisAlterados[0]).not.toBe(panorama.maiorImpacto[0]);
    const lider = de(panorama, panorama.maisAlterados[0])!;
    expect(lider.impactoCalculavel).toBe(false);
  });

  it("o ranking financeiro está ordenado pela variação de preço, dentro de cada periodicidade", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    expect(panorama.impactoPorPeriodicidade.length).toBeGreaterThan(0);

    // Dentro do grupo, e não na lista achatada: entre periodicidades a ordem é
    // a da leitura — mensal antes de anual —, porque comparar R$/mês com
    // R$/ano exigiria uma conversão que aqui não se faz.
    for (const grupo of panorama.impactoPorPeriodicidade) {
      const precos = grupo.codes.map((c) =>
        Math.abs(de(panorama, c)!.variacao?.preco ?? 0),
      );
      expect([...precos].sort((a, b) => b - a)).toEqual(precos);
    }
  });

  it("preço mais frota reconstrói a variação total, sempre", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const comVariacao = panorama.parametros.filter((p) => p.variacao !== null);
    expect(comVariacao.length).toBeGreaterThan(0);

    for (const p of comVariacao) {
      const v = p.variacao!;
      expect(v.preco + v.frota).toBeCloseTo(v.total, 2);
    }
  });
});

describe("quem não passa na régua aparece mesmo assim", () => {
  it("o lucro variável entra na lista, com o motivo escrito", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const lucro = de(panorama, "cavalo.lucro_variavel_previsto_cavalo")!;

    expect(lucro.changes).toBe(107);
    expect(lucro.entities).toBe(34);
    expect(lucro.impactoCalculavel).toBe(false);
    expect(lucro.impactoMotivo).not.toBe("");
    expect(lucro.variacao).toBeNull();
    expect(panorama.semLeituraFinanceira).toContain(
      "cavalo.lucro_variavel_previsto_cavalo",
    );
  });

  it("todo parâmetro sem régua tem motivo, e nenhum com régua tem", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    for (const p of panorama.parametros) {
      expect(p.impactoMotivo === "").toBe(p.impactoCalculavel);
    }
  });
});

describe("o total manda e a parcela desce", () => {
  it("as parcelas de um total que mudou ficam fora dos dois rankings", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // As 27 transições de juros e as 10 de amortização já estão dentro das 37
    // do `finame_cavalo`: listá-las ao lado contaria o mesmo real de novo.
    for (const parcela of [
      "cavalo.juros_finame_cavalo",
      "cavalo.amortizacao_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ]) {
      expect(de(panorama, parcela)?.papel).toBe("PARCELA");
      expect(de(panorama, parcela)?.dentroDe).toBe("cavalo.finame_cavalo");
      expect(panorama.maiorImpacto).not.toContain(parcela);
      expect(panorama.maisAlterados).not.toContain(parcela);
    }

    // E o total continua lá, uma vez.
    expect(panorama.maiorImpacto).toContain("cavalo.finame_cavalo");
  });

  it("a parcela continua na lista, para o drill-down do total", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    expect(de(panorama, "cavalo.juros_finame_cavalo")).toBeDefined();

    const total = de(panorama, "cavalo.finame_cavalo")!;
    expect(total.papel).toBe("TOTAL");
    expect(total.parcelas).toEqual([
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ]);
  });

  it("tira dos rankings o que já contém o outro equipamento", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // `carreta.custo_fixo` são R$ 1,2 milhão que já incluem os R$ 867 mil de
    // `cavalo.finame_cavalo`. Somar as duas linhas contaria cada cavalo duas
    // vezes — que é exatamente o que o produto recusa do outro lado, em
    // `motor.ts`.
    for (const code of [
      "carreta.finame",
      "carreta.custo_fixo",
      "carreta.lucro_variavel_previsto",
    ]) {
      const p = de(panorama, code);
      expect(p?.papel).toBe("CONJUNTO");
      expect(p?.contem).toBeTruthy();
      expect(p?.evidencia).toBeTruthy();
      expect(panorama.maiorImpacto).not.toContain(code);
      expect(panorama.maisAlterados).not.toContain(code);
      expect(panorama.visaoDeConjunto).toContain(code);
    }
  });

  it("a parcela volta a ser raiz quando o total saiu por escopo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // `lucro_fixomodelo_novo_ciclo` é parcela de `custo_fixo`, que saiu por
    // conjunto. Se a saída do total a levasse junto, a carreta perderia uma
    // linha econômica que é só dela.
    expect(panorama.maisAlterados).toContain("carreta.lucro_fixomodelo_novo_ciclo");
    expect(panorama.maiorImpacto).toContain("carreta.lucro_fixomodelo_novo_ciclo");
  });

  it("a decomposição da carreta é a mesma que o motor de composição usa", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // Exaustiva e disjunta: `finame_implemento + lucro_fixomodelo_novo_ciclo`
    // é o par que `regras.test.ts` fixa do outro lado, e nenhum real do cavalo
    // entra nele.
    const daCarreta = panorama.maiorImpacto.filter(
      (c) => de(panorama, c)!.entityType === "CARRETA",
    );
    expect(daCarreta.sort()).toEqual([
      "carreta.finame_implemento",
      "carreta.lucro_fixomodelo_novo_ciclo",
    ]);
  });
});

describe("o ranking financeiro não mistura periodicidades", () => {
  it("separa MENSAL de ANUAL em listas próprias", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    const periodicidades = panorama.impactoPorPeriodicidade.map((g) => g.periodicity);
    expect(periodicidades).toContain("MENSAL");
    expect(periodicidades).toContain("ANUAL");
    // MENSAL primeiro: é a periodicidade do custo fixo, que é o que se confere.
    expect(periodicidades.indexOf("MENSAL")).toBeLessThan(
      periodicidades.indexOf("ANUAL"),
    );

    for (const grupo of panorama.impactoPorPeriodicidade) {
      for (const code of grupo.codes) {
        expect(de(panorama, code)!.periodicity).toBe(grupo.periodicity);
      }
    }
  });

  it("o IPVA anual não disputa lugar com o FINAME mensal", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // −R$ 731 mil/ano contra −R$ 52 mil/mês: numa lista só o IPVA lidera, e a
    // ordem inverte assim que alguém anualiza o outro. Converter para comparar
    // seria projeção linear, que só a Simulação admite — e sempre marcada.
    const mensal = panorama.impactoPorPeriodicidade.find(
      (g) => g.periodicity === "MENSAL",
    )!;
    const anual = panorama.impactoPorPeriodicidade.find(
      (g) => g.periodicity === "ANUAL",
    )!;
    expect(mensal.codes).toContain("cavalo.finame_cavalo");
    expect(anual.codes).toEqual(["cavalo.ipva_licenciamento"]);
    expect(mensal.codes).not.toContain("cavalo.ipva_licenciamento");
  });
});

describe("a reconciliação é medida agora, não citada", () => {
  it("mede o quanto cada identidade declarada fecha nestes dados", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // Medido no arquivo: 532 das 533 linhas com total não nulo fecham.
    const finame = de(panorama, "cavalo.finame_cavalo")!;
    expect(finame.reconciliacao).not.toBeNull();
    expect(finame.reconciliacao!.linhas).toBe(533);
    expect(finame.reconciliacao!.fecham).toBe(532);
    expect(finame.reconciliacao!.percentual).toBeCloseTo(99.8, 1);

    // E o custo fixo da carreta fecha em todas as 644 com total não nulo.
    const custoFixo = de(panorama, "carreta.custo_fixo")!;
    expect(custoFixo.reconciliacao!.linhas).toBe(644);
    expect(custoFixo.reconciliacao!.fecham).toBe(644);
  });

  it("quem não é total de nada não inventa reconciliação", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    expect(de(panorama, "cavalo.ipva_licenciamento")!.reconciliacao).toBeNull();
  });
});

describe("as pontas são por equipamento", () => {
  it("reproduz os totais da coluna nas duas pontas do cavalo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const finame = de(panorama, "cavalo.finame_cavalo")!;

    // Os mesmos números que a matriz mostra e que o cliente confere no Excel.
    expect(finame.from!.sourceLabel).toBe("EMPURRADA_2_12_2025");
    expect(finame.from!.total).toBeCloseTo(887408.65, 2);
    expect(finame.to!.sourceLabel).toBe("EMPURRADA_1_8_2026");
    expect(finame.to!.total).toBeCloseTo(867860.23, 2);
    expect(finame.variacao!.total).toBeCloseTo(-19548.42, 2);
  });
});
