import { describe, expect, it } from "vitest";
import {
  criarDeduplicador,
  ehLinhaEconomica,
  explicarRastro,
  indexarVinculos,
  resumirImpacto,
  SEM_VINCULOS,
  type LinhaDeMudanca,
} from "../deduplicacao";

/**
 * A autoridade única, sem banco.
 *
 * Os casos aqui são os quatro que o produto errou de verdade, reduzidos ao
 * mínimo: cobertura integral, cobertura parcial, escopo de conjunto com
 * vínculo, e escopo de conjunto **sem** vínculo — que é o caso em que a regra
 * não pode disparar, e a carreta sem cavalo é 64 das 622 linhas do export real.
 */

const linha = (
  attributeCode: string,
  entityId: string,
  amount: number | null,
  periodicity = "MENSAL",
): LinhaDeMudanca => ({
  attributeCode,
  entityId,
  impactConfidence: amount === null ? "NOT_CALCULABLE" : "CALCULATED",
  impactAmount: amount,
  impactPeriodicity: periodicity,
});

describe("cobertura integral — o total sai, as parcelas ficam", () => {
  const linhas = [
    linha("carreta.custo_fixo", "carreta-1", 1000),
    linha("carreta.finame", "carreta-1", 600),
    linha("carreta.lucro_fixomodelo_novo_ciclo", "carreta-1", 400),
  ];

  it("tira o total e mantém as duas parcelas", () => {
    const dedup = criarDeduplicador(linhas, SEM_VINCULOS);
    const r = resumirImpacto(linhas, dedup);
    expect(r.brutoByPeriodicity.MENSAL).toBe(2000);
    expect(r.byPeriodicity.MENSAL).toBe(1000);
    expect(r.excludedChanges).toBe(1);
  });

  it("diz qual parcela o cobre, e não só que ele saiu", () => {
    const dedup = criarDeduplicador(linhas, SEM_VINCULOS);
    const fora = dedup.foraDoTotal(linhas[0])!;
    expect(fora.motivo).toBe("COBERTO_POR_PARCELAS");
    expect(fora.representadoPor).toContain("carreta.finame");
    expect(fora.explicacao).toContain("continua na lista");
  });
});

describe("cobertura parcial — a decisão é por ativo", () => {
  /*
    O caso QYP3G72, reduzido: o mesmo atributo muda em dois cavalos, e só num
    deles uma parcela muda junto. Excluir o código inteiro apagaria a variação
    do segundo; não excluir nada contaria a do primeiro duas vezes.
  */
  const linhas = [
    linha("cavalo.finame_cavalo", "cavalo-1", -5169.5),
    linha("cavalo.amortizacao_cavalo", "cavalo-1", -7700.16),
    linha("cavalo.finame_cavalo", "cavalo-2", 4395.36),
  ];

  it("sai num ativo e permanece no outro", () => {
    const dedup = criarDeduplicador(linhas, SEM_VINCULOS);
    expect(dedup.foraDoTotal(linhas[0])).not.toBeNull();
    expect(dedup.foraDoTotal(linhas[2])).toBeNull();
    const r = resumirImpacto(linhas, dedup);
    expect(r.byPeriodicity.MENSAL).toBeCloseTo(-7700.16 + 4395.36, 2);
  });
});

describe("escopo de conjunto — e o limite dele", () => {
  const daCarretaComCavalo = [
    linha("carreta.finame", "carreta-1", 4395.36),
    linha("cavalo.finame_cavalo", "cavalo-1", 4395.36),
  ];
  const vinculos = indexarVinculos([
    { entityId: "carreta-1", embuteEntityId: "cavalo-1" },
  ]);

  it("tira a coluna da carreta quando o cavalo vinculado mudou", () => {
    const dedup = criarDeduplicador(daCarretaComCavalo, vinculos);
    const fora = dedup.foraDoTotal(daCarretaComCavalo[0])!;
    expect(fora.motivo).toBe("ESCOPO_DE_CONJUNTO");
    expect(fora.representadoPor).toBe("cavalo.finame_cavalo");
    expect(resumirImpacto(daCarretaComCavalo, dedup).byPeriodicity.MENSAL).toBe(4395.36);
  });

  it("**não** tira quando a carreta não tem cavalo vinculado", () => {
    // 64 carretas do export real estão neste caso, e nelas o finame é do
    // implemento: tirá-lo apagaria variação que nenhuma outra linha explica.
    const dedup = criarDeduplicador(daCarretaComCavalo, SEM_VINCULOS);
    expect(dedup.foraDoTotal(daCarretaComCavalo[0])).toBeNull();
    expect(resumirImpacto(daCarretaComCavalo, dedup).byPeriodicity.MENSAL).toBe(8790.72);
  });

  it("**não** tira quando o cavalo vinculado não mudou nesta comparação", () => {
    const so = [linha("carreta.finame", "carreta-1", 4395.36)];
    const dedup = criarDeduplicador(so, vinculos);
    expect(dedup.foraDoTotal(so[0])).toBeNull();
  });
});

describe("a escada", () => {
  const linhas = [
    linha("carreta.custo_fixo", "carreta-1", 1000),
    linha("carreta.finame", "carreta-1", 600),
    linha("carreta.lucro_fixomodelo_novo_ciclo", "carreta-1", 400),
    linha("cavalo.finame_cavalo", "cavalo-1", 600),
  ];
  const vinculos = indexarVinculos([
    { entityId: "carreta-1", embuteEntityId: "cavalo-1" },
  ]);

  it("bruto − cada degrau = oficial, e a soma fecha", () => {
    const r = resumirImpacto(linhas, criarDeduplicador(linhas, vinculos));
    expect(r.brutoByPeriodicity.MENSAL).toBe(2600);
    const [composicao, escopo] = r.rastro.degraus;
    expect(composicao.removidoByPeriodicity.MENSAL).toBe(1000);
    expect(composicao.subtotalByPeriodicity.MENSAL).toBe(1600);
    expect(escopo.removidoByPeriodicity.MENSAL).toBe(600);
    expect(escopo.subtotalByPeriodicity.MENSAL).toBe(1000);
    expect(r.byPeriodicity.MENSAL).toBe(1000);
  });

  it("se escreve em texto, na ordem em que a auditoria a lê", () => {
    const r = resumirImpacto(linhas, criarDeduplicador(linhas, vinculos));
    expect(explicarRastro(r.rastro, "MENSAL")).toEqual([
      "2.600,00 bruto",
      "− 1.000,00 duplicidades por composição",
      "= 1.600,00 subtotal técnico",
      "− 600,00 duplicidades entre escopos cavalo↔carreta",
      "= 1.000,00 impacto oficial",
    ]);
  });
});

describe("mensal e anual nunca se somam", () => {
  it("cada periodicidade tem o seu balde, e o rastro também", () => {
    const linhas = [
      linha("carreta.custo_fixo", "carreta-1", 1000, "MENSAL"),
      linha("carreta.finame", "carreta-1", 1000, "MENSAL"),
      linha("cavalo.ipva_licenciamento", "cavalo-1", -5000, "ANUAL"),
    ];
    const r = resumirImpacto(linhas, criarDeduplicador(linhas, SEM_VINCULOS));
    expect(r.byPeriodicity).toEqual({ MENSAL: 1000, ANUAL: -5000 });
    expect(r.rastro.degraus[0].removidoByPeriodicity).toEqual({ MENSAL: 1000 });
  });
});

describe("sem preço não é zero", () => {
  it("linha sem impacto apurado conta como notCalculable e não entra em balde", () => {
    const linhas = [linha("carreta.seguro", "carreta-1", null)];
    const r = resumirImpacto(linhas, criarDeduplicador(linhas, SEM_VINCULOS));
    expect(r.notCalculable).toBe(1);
    expect(r.calculatedChanges).toBe(0);
    expect(r.byPeriodicity).toEqual({});
  });
});

describe("a versão por código tem a mesma direção da versão por ativo", () => {
  it("o total desce e a parcela fica — nunca o contrário", () => {
    const alterados = new Set([
      "carreta.custo_fixo",
      "carreta.finame",
      "carreta.lucro_fixomodelo_novo_ciclo",
    ]);
    expect(ehLinhaEconomica("carreta.custo_fixo", alterados)).toBe(false);
    expect(ehLinhaEconomica("carreta.lucro_fixomodelo_novo_ciclo", alterados)).toBe(true);
  });

  it("a coluna de conjunto desce quando a embutida também mudou", () => {
    expect(
      ehLinhaEconomica("carreta.finame", new Set(["carreta.finame", "cavalo.finame_cavalo"])),
    ).toBe(false);
    expect(ehLinhaEconomica("carreta.finame", new Set(["carreta.finame"]))).toBe(true);
  });
});
