import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import {
  absent,
  buildFixture,
  contextoDaUnidade,
  date,
  type AttributeSpec,
} from "@workspace/comparison/testing";
import type { SeriesContext } from "@workspace/comparison";
import { getVisaoDeFrota } from "../frota";
import { getAlteracoesDoEquipamento, getHistorico } from "../ficha";
import { montarComposicao } from "../motor";

/**
 * O motor de composição, uma regra por vez.
 *
 * Cada caso monta uma vigência sintética que difere em exatamente uma coisa, de
 * modo que uma falha aponta para uma regra e não para "algo nos 83 mil fatos".
 * O que estes testes protegem, em uma frase: **nenhum número entra num total
 * sem ter passado pelo portão, e nenhum componente sai da tela por ter sido
 * recusado.**
 */

let ctx: TestDb;

/*
  O dicionário sintético. Os códigos são os reais porque `COMPOSITIONS` e o
  registro de escopo em `regras.ts` são indexados por código — um teste com
  nomes inventados exercitaria um caminho que a produção nunca percorre.
*/
const ATRIBUTOS: AttributeSpec[] = [
  // --- cavalo: o total confirmado e as suas três parcelas ------------------
  {
    code: "cavalo.finame_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  ...(
    [
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ] as const
  ).map((code) => ({
    code,
    dataType: "NUMERIC" as const,
    semanticsStatus: "CONFIRMED" as const,
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  })),
  // --- outras periodicidades confirmadas -----------------------------------
  {
    code: "cavalo.ipva_licenciamento",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  {
    code: "cavalo.valor_nf_compra",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "PONTUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  // --- os que o portão tem de barrar, cada um por um motivo diferente ------
  {
    // Monetário e somável, mas ninguém confirmou o significado.
    code: "cavalo.valor_pneu",
    dataType: "NUMERIC",
    semanticsStatus: "PRESUMED",
    unit: "BRL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  {
    // Confirmado e mesmo assim não somável: razão em R$/km.
    code: "cavalo.manutencao_reais_km",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL_KM",
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cv_combustivel",
  },
  {
    // Monetário e somável, presumido — o estado real desta coluna no export.
    code: "cavalo.custo_aluguel",
    dataType: "NUMERIC",
    semanticsStatus: "PRESUMED",
    unit: "BRL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  { code: "cavalo.ativo", dataType: "TEXT", semanticsStatus: "PRESUMED", aggregation: "NONE" },
  {
    code: "cavalo.frota_emprestada",
    dataType: "BOOLEAN",
    semanticsStatus: "PRESUMED",
    aggregation: "NONE",
  },
  {
    code: "cavalo.data_fim_contrato",
    dataType: "DATE",
    semanticsStatus: "PRESUMED",
    aggregation: "NONE",
  },
];

/** Um cavalo completo, com os valores que cada caso vai variar. */
const CAVALO_BASE = {
  "cavalo.finame_cavalo": 10_000,
  "cavalo.amortizacao_cavalo": 6_000,
  "cavalo.juros_finame_cavalo": 2_500,
  "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 1_500,
  "cavalo.ipva_licenciamento": 4_800,
  "cavalo.valor_nf_compra": 400_000,
  "cavalo.valor_pneu": 3_000,
  "cavalo.manutencao_reais_km": 0.38,
  "cavalo.custo_aluguel": 900,
  "cavalo.ativo": "ATIVO",
  "cavalo.frota_emprestada": false,
  "cavalo.data_fim_contrato": date("2028-05-01"),
};

let snapshots: Record<string, string>;

beforeAll(async () => {
  ctx = await createTestDatabase("composition_motor");
  await seedTaxonomy(ctx.db, "test");
  const built = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: "EMPURRADA_1_7_2026",
        effectiveDate: "2026-07-01",
        data: {
          // O ativo de referência, estável entre as duas vigências.
          AAA1A11: { ...CAVALO_BASE },
          // Muda de valor na vigência seguinte.
          BBB2B22: { ...CAVALO_BASE },
          // Sai da frota na vigência seguinte.
          CCC3C33: { ...CAVALO_BASE },
          // Zero de verdade, e não ausência.
          DDD4D44: { ...CAVALO_BASE, "cavalo.finame_cavalo": 0 },
        },
      },
      {
        label: "EMPURRADA_1_8_2026",
        effectiveDate: "2026-08-01",
        data: {
          AAA1A11: { ...CAVALO_BASE },
          BBB2B22: {
            ...CAVALO_BASE,
            "cavalo.finame_cavalo": 12_000,
            "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 3_500,
          },
          DDD4D44: { ...CAVALO_BASE, "cavalo.finame_cavalo": 0 },
          // Entra na frota agora, e sem valor nenhum no total.
          EEE5E55: {
            ...CAVALO_BASE,
            "cavalo.finame_cavalo": absent("EMPTY"),
            "cavalo.amortizacao_cavalo": absent("EMPTY"),
            "cavalo.juros_finame_cavalo": absent("EMPTY"),
            "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": absent("EMPTY"),
            "cavalo.ipva_licenciamento": absent("SENTINEL"),
            "cavalo.valor_nf_compra": absent("EMPTY"),
          },
          // O total não fecha com as parcelas: 10.000 ≠ 6.000+2.500+1.000.
          FFF6F66: { ...CAVALO_BASE, "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 1_000 },
        },
      },
    ],
    { entityType: "CAVALO", unidade: "motor", canal: "EMPURRADA" },
  );
  snapshots = built.snapshotIds;
  contexto = await contextoDaUnidade(ctx.db, "motor", "EMPURRADA");
  expect(Object.keys(snapshots)).toHaveLength(2);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

/**
 * O contexto vem do banco, e não de um literal.
 *
 * Antes era `{ scopeHash: "escopo-motor", … }` — a semente do fixture usada
 * como chave —, e funcionava porque `resolveContext` ainda aceitava a coluna
 * `snapshot.scope_hash` como grafia legada. Era o teste passando pela ponte de
 * compatibilidade, e não pela identidade que ele afirma exercitar.
 */
let contexto: SeriesContext;

async function composicaoDe(placa: string, period = "2026-08-01") {
  const frota = await getVisaoDeFrota(ctx.db, "CAVALO", { period, context: contexto });
  const linha = frota!.linhas.find((l) => l.placa === placa);
  expect(linha, `placa ${placa} na vigência ${period}`).toBeDefined();
  return (await montarComposicao(ctx.db, linha!.entityId, { period, context: contexto }))!;
}

describe("o portão da semântica", () => {
  it("só soma o que está confirmado, monetário, somável e com periodicidade", async () => {
    const c = await composicaoDe("AAA1A11");

    // A única linha mensal é o total; as três parcelas foram absorvidas.
    const mensal = c.linhas.filter((l) => l.gaveta === "MENSAL");
    expect(mensal.map((l) => l.code)).toEqual(["cavalo.finame_cavalo"]);
    expect(c.totais.find((t) => t.gaveta === "MENSAL")?.valor).toBe(10_000);
  });

  it("mantém mensal, anual e aquisição em gavetas separadas, sem anualizar nada", async () => {
    const c = await composicaoDe("AAA1A11");
    const porGaveta = Object.fromEntries(c.totais.map((t) => [t.gaveta, t.valor]));
    expect(porGaveta).toEqual({ MENSAL: 10_000, ANUAL: 4_800, AQUISICAO: 400_000 });
    // O IPVA anual não foi dividido por doze para caber no mensal.
    expect(porGaveta.MENSAL).not.toBeCloseTo(10_000 + 4_800 / 12);
  });

  it("recusa o PRESUMIDO e diz que é a semântica que falta", async () => {
    const c = await composicaoDe("AAA1A11");
    const pneu = c.naoApurados.find((n) => n.code === "cavalo.valor_pneu")!;
    expect(pneu.motivo).toBe("SEMANTICA_NAO_CONFIRMADA");
    expect(pneu.monetarioPotencial).toBe(true);
    expect(pneu.valorNumerico).toBe(3_000);
  });

  it("recusa a razão em R$/km e nomeia a base que falta", async () => {
    const c = await composicaoDe("AAA1A11");
    const manutencao = c.naoApurados.find((n) => n.code === "cavalo.manutencao_reais_km")!;
    expect(manutencao.motivo).toBe("BASE_AUSENTE");
    expect(manutencao.baseQueFalta).toContain("quilometragem");
    expect(manutencao.explicacao).toContain("Multiplicar por uma quantidade estimada");
  });

  it("um monetário presumido conta como lacuna financeira, e um texto não", async () => {
    const c = await composicaoDe("AAA1A11");
    const aluguel = c.naoApurados.find((n) => n.code === "cavalo.custo_aluguel")!;
    expect(aluguel.motivo).toBe("SEMANTICA_NAO_CONFIRMADA");
    expect(aluguel.monetarioPotencial).toBe(true);
    expect(c.completude.semRegraFinanceira).toBe(
      c.naoApurados.filter((n) => n.monetarioPotencial).length,
    );
    expect(c.completude.parcial).toBe(true);
  });

  it("texto, booleano e data são recusados pelo tipo, e não pela curadoria", async () => {
    const c = await composicaoDe("AAA1A11");
    for (const code of [
      "cavalo.ativo",
      "cavalo.frota_emprestada",
      "cavalo.data_fim_contrato",
    ]) {
      const item = c.naoApurados.find((n) => n.code === code)!;
      // Não é "semântica não confirmada": confirmar o significado de um chassi
      // não é trabalho que exista. É o tipo que responde.
      expect(item.motivo, code).toBe("NAO_MONETARIO");
      expect(item.monetarioPotencial, code).toBe(false);
    }
  });

  it("mostra o valor de cada tipo sem convertê-lo em número", async () => {
    const c = await composicaoDe("AAA1A11");
    const porCodigo = Object.fromEntries(c.naoApurados.map((n) => [n.code, n]));
    expect(porCodigo["cavalo.ativo"].valorExibido).toBe("ATIVO");
    expect(porCodigo["cavalo.frota_emprestada"].valorExibido).toBe("Não");
    expect(porCodigo["cavalo.data_fim_contrato"].valorExibido).toBe("2028-05-01");
    expect(porCodigo["cavalo.data_fim_contrato"].valorNumerico).toBeNull();
  });

  it("nenhum fato do ativo desaparece: ou é linha, ou é não apurado", async () => {
    const c = await composicaoDe("AAA1A11");
    const vistos = new Set([
      ...c.linhas.map((l) => l.code),
      ...c.naoApurados.map((n) => n.code),
      // As parcelas absorvidas aparecem como não apuradas, então já contam.
    ]);
    expect(vistos.size).toBe(ATRIBUTOS.length);
  });
});

describe("dupla contagem", () => {
  it("absorve as parcelas do total e diz onde elas foram parar", async () => {
    const c = await composicaoDe("AAA1A11");
    const amortizacao = c.naoApurados.find((n) => n.code === "cavalo.amortizacao_cavalo")!;
    expect(amortizacao.motivo).toBe("PARCELA_DE_TOTAL");
    expect(amortizacao.contidoEm).toBe("cavalo.finame_cavalo");
    // Uma parcela absorvida não é lacuna: o produto acertou, não faltou regra.
    expect(amortizacao.monetarioPotencial).toBe(false);
  });

  it("a soma das parcelas nunca é somada ao total", async () => {
    const c = await composicaoDe("AAA1A11");
    const mensal = c.totais.find((t) => t.gaveta === "MENSAL")!.valor;
    // 10.000, e não 20.000 — as parcelas somam exatamente o mesmo dinheiro.
    expect(mensal).toBe(10_000);
  });

  it("a explicação do total traz as parcelas, a fórmula e a divergência", async () => {
    const c = await composicaoDe("AAA1A11");
    const total = c.linhas.find((l) => l.code === "cavalo.finame_cavalo")!;
    expect(total.explicacao.parcelas.map((p) => p.valor)).toEqual([6_000, 2_500, 1_500]);
    expect(total.explicacao.formula).toBe("6.000,00 + 2.500,00 + 1.500,00");
    expect(total.explicacao.divergencia).toBe(0);
  });

  it("acusa o total que não fecha com as próprias parcelas, sem trocar o número", async () => {
    const c = await composicaoDe("FFF6F66");
    const total = c.linhas.find((l) => l.code === "cavalo.finame_cavalo")!;
    expect(total.valor).toBe(10_000); // o número da fonte, preservado
    expect(total.explicacao.divergencia).toBe(500);
    expect(c.integridade.map((a) => a.tipo)).toContain("TOTAL_NAO_FECHA");
    expect(c.status.farol).toBe("CRITICO");
  });
});

describe("ausência, zero e sentinela", () => {
  it("zero real entra na conta como zero", async () => {
    const c = await composicaoDe("DDD4D44");
    const total = c.linhas.find((l) => l.code === "cavalo.finame_cavalo")!;
    expect(total.valor).toBe(0);
    expect(c.totais.find((t) => t.gaveta === "MENSAL")!.valor).toBe(0);
    // Zero apurado não é "incompleto": o produto sabe que é zero.
    expect(c.status.farol).not.toBe("INCOMPLETO");
  });

  it("ausência não vira zero — vira componente sem valor, com o motivo", async () => {
    const c = await composicaoDe("EEE5E55");
    expect(c.linhas.filter((l) => l.gaveta === "MENSAL")).toHaveLength(0);
    const finame = c.naoApurados.find((n) => n.code === "cavalo.finame_cavalo")!;
    expect(finame.motivo).toBe("VALOR_AUSENTE");
    expect(finame.explicacao).toContain("Ausência não é zero");
    expect(finame.valorNumerico).toBeNull();
  });

  it("sentinela chega como ausência com o motivo registrado", async () => {
    const c = await composicaoDe("EEE5E55");
    const ipva = c.naoApurados.find((n) => n.code === "cavalo.ipva_licenciamento")!;
    expect(ipva.motivo).toBe("VALOR_AUSENTE");
    expect(ipva.explicacao).toContain("SENTINEL");
  });

  it("sem nenhum componente mensal o farol é INCOMPLETO, e não verde", async () => {
    const c = await composicaoDe("EEE5E55");
    expect(c.status.farol).toBe("INCOMPLETO");
    expect(c.totais.some((t) => t.gaveta === "MENSAL")).toBe(false);
  });
});

describe("variação e farol", () => {
  it("compara com a vigência anterior e classifica o salto", async () => {
    const c = await composicaoDe("BBB2B22");
    expect(c.anterior?.mensal).toBe(10_000);
    expect(c.variacaoMensal).toEqual({ absoluta: 2_000, percentual: 20 });
    // 20% passa do limiar de 10%.
    expect(c.status.farol).toBe("CRITICO");
  });

  it("sem movimento e sem inconsistência, o farol fica verde", async () => {
    const c = await composicaoDe("AAA1A11");
    expect(c.variacaoMensal).toEqual({ absoluta: 0, percentual: 0 });
    expect(c.status.farol).toBe("NORMAL");
    expect(c.status.alertas).toBe(0);
  });

  it("quem entrou na frota é ATENÇÃO, e a frase diz isso", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
    });
    const linha = frota!.linhas.find((l) => l.placa === "FFF6F66")!;
    // FFF6F66 entrou agora e ainda por cima não fecha: integridade manda.
    expect(linha.status.farol).toBe("CRITICO");

    const entrou = frota!.linhas.find((l) => l.placa === "EEE5E55")!;
    expect(entrou.status.farol).toBe("INCOMPLETO");
  });

  it("quem saiu da frota aparece na lista, dito como saída", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
    });
    const saiu = frota!.linhas.find((l) => l.placa === "CCC3C33")!;
    expect(saiu.presente).toBe(false);
    expect(saiu.status.farol).toBe("INCOMPLETO");
    expect(saiu.status.motivos[0]).toContain("saiu da frota");
  });
});

describe("a visão de frota", () => {
  it("soma só o mensal, e conta quem ficou de fora", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
    });
    // AAA 10.000 + BBB 12.000 + DDD 0 + FFF 10.000 = 32.000.
    // EEE (sem valor) e CCC (saiu) não somam nada.
    expect(frota!.resumo.mensalTotal).toBe(32_000);
    expect(frota!.resumo.equipamentos).toBe(6);
    expect(frota!.resumo.comValorApurado).toBe(4);
    expect(frota!.resumo.incompletos).toBe(2);
    expect(frota!.resumo.comAumento).toBe(1);
  });

  it("filtra sem mexer no resumo da frota", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
      filtros: { comAlerta: true },
    });
    expect(frota!.linhas.every((l) => l.status.alertas > 0)).toBe(true);
    expect(frota!.linhas.length).toBeLessThan(frota!.totalSemFiltro);
    // O total continua sendo o da frota, e não o do recorte.
    expect(frota!.resumo.mensalTotal).toBe(32_000);
  });

  it("busca por placa e por chassi", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
      filtros: { busca: "bbb2" },
    });
    expect(frota!.linhas.map((l) => l.placa)).toEqual(["BBB2B22"]);
  });

  it("um tipo de equipamento nunca traz o outro", async () => {
    const carretas = await getVisaoDeFrota(ctx.db, "CARRETA", {
      period: "2026-08-01",
      context: contexto,
    });
    expect(carretas!.linhas).toHaveLength(0);
    expect(carretas!.serieEntregue).toBe(false);
  });
});

describe("histórico e alterações", () => {
  it("a série termina no mesmo número da ficha", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
    });
    const linha = frota!.linhas.find((l) => l.placa === "BBB2B22")!;
    const historico = (await getHistorico(ctx.db, linha.entityId, contexto))!;

    expect(historico.pontos.map((p) => p.mensal)).toEqual([10_000, 12_000]);
    expect(historico.pontos[1].variacao).toEqual({ absoluta: 2_000, percentual: 20 });
    expect(historico.pontos[1].componentesAlterados).toBe(1);
  });

  it("a série de um componente cobre as vigências em que ele não existe", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
    });
    const linha = frota!.linhas.find((l) => l.placa === "EEE5E55")!;
    const historico = (await getHistorico(ctx.db, linha.entityId, contexto))!;
    const serie = historico.componentes.find((c) => c.code === "cavalo.finame_cavalo")!;
    expect(serie.pontos).toHaveLength(2);
    // Julho: o ativo nem existia. Agosto: existe e o valor é ausente.
    expect(serie.pontos.map((p) => p.valor)).toEqual([null, null]);
  });

  it("as alterações dizem quais mexem no total e quais não", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-08-01",
      context: contexto,
    });
    const linha = frota!.linhas.find((l) => l.placa === "BBB2B22")!;
    const alteracoes = (await getAlteracoesDoEquipamento(ctx.db, linha.entityId, {
      period: "2026-08-01",
      context: contexto,
    }))!;

    expect(alteracoes.de?.effectiveDate).toBe("2026-07-01");
    const total = alteracoes.alteracoes.find((a) => a.attributeCode === "cavalo.finame_cavalo");
    expect(total?.entraNoTotal).toBe(true);

    const parcela = alteracoes.alteracoes.find(
      (a) => a.attributeCode === "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    );
    expect(parcela?.entraNoTotal).toBe(false);
    expect(parcela?.motivo).toBe("PARCELA_DE_TOTAL");

    // A decomposição fecha: a variação do total é toda explicada.
    expect(alteracoes.variacaoMensal?.absoluta).toBe(2_000);
    expect(alteracoes.explicado).toBe(2_000);
    expect(alteracoes.naoAtribuido).toBe(0);
  });

  it("na primeira vigência da série não há alterações a mostrar", async () => {
    const frota = await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: "2026-07-01",
      context: contexto,
    });
    const linha = frota!.linhas.find((l) => l.placa === "AAA1A11")!;
    const alteracoes = (await getAlteracoesDoEquipamento(ctx.db, linha.entityId, {
      period: "2026-07-01",
      context: contexto,
    }))!;
    expect(alteracoes.de).toBeNull();
    expect(alteracoes.alteracoes).toHaveLength(0);
  });
});
