import { describe, expect, it } from "vitest";
import {
  contributionAcrossSemantics,
  contributionOverHorizon,
  monthsInHorizon,
  splitHorizonBySemantics,
  type Contribution,
  type SemanticsWindow,
} from "../horizon";

const ANO_2026 = { from: "2026-01-01", until: "2027-01-01" };
const SEMESTRE = { from: "2026-01-01", until: "2026-07-01" };
const UM_MES = { from: "2026-01-01", until: "2026-02-01" };

function permitida(r: unknown): Contribution {
  if (typeof r === "object" && r !== null && "allowed" in r) {
    throw new Error(`esperava contribuição, veio recusa: ${JSON.stringify(r)}`);
  }
  return r as Contribution;
}

describe("o tamanho do horizonte", () => {
  it("conta meses inteiros", () => {
    expect(monthsInHorizon(ANO_2026)).toBe(12);
    expect(monthsInHorizon(SEMESTRE)).toBe(6);
    expect(monthsInHorizon(UM_MES)).toBe(1);
  });

  it("recusa horizonte que não fecha em meses, em vez de ratear por dia", () => {
    const r = monthsInHorizon({ from: "2026-01-01", until: "2026-03-15" });
    expect(r).toMatchObject({ allowed: false, code: "HORIZONTE_NAO_FECHA_EM_MESES" });
  });

  it("recusa horizonte que não avança no tempo", () => {
    const r = monthsInHorizon({ from: "2026-05-01", until: "2026-05-01" });
    expect(r).toMatchObject({ allowed: false });
  });
});

describe("quais conversões o horizonte permite, e com qual fator", () => {
  it("mensal por doze meses multiplica por doze e se declara projeção", () => {
    const c = permitida(
      contributionOverHorizon(
        { value: 1000, periodicity: "MENSAL", isMonetary: true },
        ANO_2026,
      ),
    );
    expect(c.factor).toBe(12);
    expect(c.amount).toBe(12000);
    expect(c.nature).toBe("PROJECAO_LINEAR");
  });

  it("anual por doze meses é exata: nada foi projetado", () => {
    const c = permitida(
      contributionOverHorizon(
        { value: 12000, periodicity: "ANUAL", isMonetary: true },
        ANO_2026,
      ),
    );
    expect(c.factor).toBe(1);
    expect(c.amount).toBe(12000);
    expect(c.nature).toBe("EXATA");
  });

  it("mensal por um mês é exata", () => {
    const c = permitida(
      contributionOverHorizon(
        { value: 1000, periodicity: "MENSAL", isMonetary: true },
        UM_MES,
      ),
    );
    expect(c.factor).toBe(1);
    expect(c.nature).toBe("EXATA");
  });

  it("anual por meio ano vira metade, e é projeção", () => {
    const c = permitida(
      contributionOverHorizon(
        { value: 12000, periodicity: "ANUAL", isMonetary: true },
        SEMESTRE,
      ),
    );
    expect(c.factor).toBe(0.5);
    expect(c.amount).toBe(6000);
    expect(c.nature).toBe("PROJECAO_LINEAR");
    expect(c.explanation).toMatch(/premissa/i);
  });
});

describe("o que fica fora do total, e por quê", () => {
  it("alíquota é recusada: percentual não se acumula no tempo", () => {
    const r = contributionOverHorizon(
      { value: 0.0925, periodicity: null, isMonetary: false },
      ANO_2026,
    );
    expect(r).toMatchObject({ allowed: false, code: "TAXA_NAO_TEM_PERIODICIDADE" });
  });

  it("monetário sem periodicidade confirmada fica fora, nomeado", () => {
    const r = contributionOverHorizon(
      { value: 900, periodicity: null, isMonetary: true },
      ANO_2026,
    );
    expect(r).toMatchObject({
      allowed: false,
      code: "PERIODICIDADE_NAO_CONFIRMADA",
    });
  });

  it("os dois casos não compartilham código, porque não são o mesmo problema", () => {
    const taxa = contributionOverHorizon(
      { value: 1, periodicity: null, isMonetary: false },
      ANO_2026,
    );
    const naoConfirmado = contributionOverHorizon(
      { value: 1, periodicity: null, isMonetary: true },
      ANO_2026,
    );
    expect((taxa as { code: string }).code).not.toBe(
      (naoConfirmado as { code: string }).code,
    );
  });
});

describe("pontual nunca é artificialmente mensalizado ou anualizado", () => {
  const AQUISICAO = {
    value: 480000,
    periodicity: "PONTUAL" as const,
    isMonetary: true,
    eventDate: "2026-03-10",
  };

  it("entra pelo valor cheio quando o evento cai no horizonte", () => {
    const c = permitida(contributionOverHorizon(AQUISICAO, ANO_2026));
    expect(c.included).toBe(true);
    expect(c.amount).toBe(480000);
    expect(c.factor).toBe(1);
    expect(c.nature).toBe("PONTUAL_INTEGRAL");
  });

  it("o valor não muda com o tamanho do horizonte — não há rateio", () => {
    const emUmAno = permitida(contributionOverHorizon(AQUISICAO, ANO_2026));
    const emSeisMeses = permitida(
      contributionOverHorizon(AQUISICAO, {
        from: "2026-01-01",
        until: "2026-07-01",
      }),
    );
    expect(emSeisMeses.amount).toBe(emUmAno.amount);
    expect(emSeisMeses.factor).toBe(1);
  });

  it("nunca sai como projeção linear, em horizonte nenhum", () => {
    for (const horizonte of [UM_MES, SEMESTRE, ANO_2026]) {
      const c = permitida(contributionOverHorizon(AQUISICAO, horizonte));
      expect(c.nature).not.toBe("PROJECAO_LINEAR");
    }
  });

  it("não contribui quando o evento cai fora, e não é trazido para dentro", () => {
    const c = permitida(
      contributionOverHorizon(AQUISICAO, {
        from: "2027-01-01",
        until: "2028-01-01",
      }),
    );
    expect(c.included).toBe(false);
    expect(c.amount).toBe(0);
  });

  it("pontual sem data é recusado: não há como situá-lo no horizonte", () => {
    const r = contributionOverHorizon(
      { value: 480000, periodicity: "PONTUAL", isMonetary: true },
      ANO_2026,
    );
    expect(r).toMatchObject({ allowed: false, code: "PONTUAL_SEM_DATA" });
  });
});

/**
 * O caso que motivou `attribute_semantics`: `ipvaLicenciamento` mudou de regra
 * dentro do intervalo que alguém quer simular.
 */
describe("mudança de semântica dentro do horizonte obriga cálculo por vigência", () => {
  const MUDOU_EM_JULHO: SemanticsWindow[] = [
    {
      version: 1,
      from: "2025-12-01",
      until: "2026-07-01",
      periodicity: "MENSAL",
      isMonetary: true,
    },
    {
      version: 2,
      from: "2026-07-01",
      until: null,
      periodicity: "ANUAL",
      isMonetary: true,
    },
  ];

  it("recorta o horizonte na data da mudança", () => {
    const segments = splitHorizonBySemantics(ANO_2026, MUDOU_EM_JULHO);
    expect(Array.isArray(segments)).toBe(true);
    if (!Array.isArray(segments)) return;

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      horizon: { from: "2026-01-01", until: "2026-07-01" },
      months: 6,
    });
    expect(segments[0]!.semantics.version).toBe(1);
    expect(segments[1]).toMatchObject({
      horizon: { from: "2026-07-01", until: "2027-01-01" },
      months: 6,
    });
    expect(segments[1]!.semantics.version).toBe(2);
  });

  it("cada trecho usa o fator da sua própria vigência", () => {
    const r = contributionAcrossSemantics(1200, ANO_2026, MUDOU_EM_JULHO);
    expect(r).not.toMatchObject({ allowed: false });
    if ("allowed" in r) return;

    // Seis meses como mensal: 1200 × 6 = 7.200.
    // Seis meses como anual:  1200 × 0,5 = 600.
    expect(r.segments[0]!.contribution.factor).toBe(6);
    expect(r.segments[1]!.contribution.factor).toBe(0.5);
    expect(r.total).toBe(7800);
  });

  it("o total por vigência difere do que uma regra única produziria", () => {
    const porVigencia = contributionAcrossSemantics(1200, ANO_2026, MUDOU_EM_JULHO);
    const regraUnica = permitida(
      contributionOverHorizon(
        { value: 1200, periodicity: "MENSAL", isMonetary: true },
        ANO_2026,
      ),
    );
    if ("allowed" in porVigencia) throw new Error("deveria calcular");

    expect(regraUnica.amount).toBe(14400);
    expect(porVigencia.total).not.toBe(regraUnica.amount);
  });

  it("o resultado diz em quantos trechos foi calculado, e por quais versões", () => {
    const r = contributionAcrossSemantics(1200, ANO_2026, MUDOU_EM_JULHO);
    if ("allowed" in r) throw new Error("deveria calcular");
    expect(r.explanation).toMatch(/2 trechos/);
    expect(r.explanation).toMatch(/versão 1/);
    expect(r.explanation).toMatch(/versão 2/);
    expect(r.nature).toBe("PROJECAO_LINEAR");
  });

  it("sem mudança no intervalo, é um trecho só", () => {
    const r = contributionAcrossSemantics(1200, SEMESTRE, MUDOU_EM_JULHO);
    if ("allowed" in r) throw new Error("deveria calcular");
    expect(r.segments).toHaveLength(1);
    expect(r.total).toBe(7200);
  });

  it("trecho sem semântica registrada é recusa, não silêncio", () => {
    const soDepoisDeJulho: SemanticsWindow[] = [MUDOU_EM_JULHO[1]!];
    const r = contributionAcrossSemantics(1200, ANO_2026, soDepoisDeJulho);
    expect(r).toMatchObject({
      allowed: false,
      code: "SEMANTICA_AUSENTE_NO_TRECHO",
    });
  });

  it("um trecho recusado tira o atributo inteiro do total, dizendo qual trecho", () => {
    const viraNaoConfirmado: SemanticsWindow[] = [
      MUDOU_EM_JULHO[0]!,
      { ...MUDOU_EM_JULHO[1]!, periodicity: null },
    ];
    const r = contributionAcrossSemantics(1200, ANO_2026, viraNaoConfirmado);
    expect(r).toMatchObject({
      allowed: false,
      code: "PERIODICIDADE_NAO_CONFIRMADA",
    });
    if (!("allowed" in r)) return;
    expect(r.explanation).toMatch(/2026-07-01/);
    expect(r.explanation).toMatch(/versão 2/);
  });
});
