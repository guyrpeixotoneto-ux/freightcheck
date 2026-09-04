import { describe, expect, it } from "vitest";
import { resumirIntervalo } from "@/hooks/use-resumo-por-vigencia";

/**
 * A coluna de números do seletor "Trocar vigência".
 *
 * O menu listava data e contagem, e a contagem sozinha não separa a vigência
 * que mudou o contrato da que mexeu em muita linha barata: 402 alterações em
 * abril e 400 em março são o mesmo número até que o dinheiro apareça ao lado.
 *
 * Duas recusas atravessam o arquivo, e são as mesmas do resto do produto:
 * periodicidades não somam, e zero não é ausência.
 */

const linha = (period: string, changes: number, byPeriodicity: Record<string, number>) => ({
  period,
  changes,
  impact: { byPeriodicity },
});

describe("resumirIntervalo", () => {
  it("escreve a coluna na periodicidade que mais moveu no intervalo", () => {
    const resumo = resumirIntervalo([
      linha("2026-07-01", 400, { MENSAL: -12_000, ANUAL: -900 }),
      linha("2026-08-01", 402, { MENSAL: 3_000, ANUAL: -400 }),
    ]);

    expect(resumo.periodicidade).toBe("MENSAL");
    expect(resumo.porVigencia.get("2026-07-01")).toEqual({ alteracoes: 400, impacto: -12_000 });
    expect(resumo.porVigencia.get("2026-08-01")).toEqual({ alteracoes: 402, impacto: 3_000 });
  });

  it("a dominante é a que mais moveu, e não a de maior saldo", () => {
    /*
      MENSAL move R$ 100.000 e termina em zero; ANUAL move R$ 900 e termina em
      R$ 900. Escolher pelo líquido faria a coluna falar da periodicidade que
      quase não se mexeu e calar a que virou o mês do avesso.
    */
    const resumo = resumirIntervalo([
      linha("2026-07-01", 10, { MENSAL: 50_000, ANUAL: 900 }),
      linha("2026-08-01", 10, { MENSAL: -50_000 }),
    ]);

    expect(resumo.periodicidade).toBe("MENSAL");
    expect(resumo.porVigencia.get("2026-07-01")?.impacto).toBe(50_000);
  });

  it("vigência sem valor apurado na periodicidade da coluna fica sem número, e não com zero", () => {
    const resumo = resumirIntervalo([
      linha("2026-07-01", 400, { MENSAL: -12_000 }),
      // Alterações houve; preço nenhum saiu delas.
      linha("2026-08-01", 6, {}),
      // E aqui saiu, e deu exatamente zero: ganhos e perdas se anularam.
      linha("2026-09-01", 40, { MENSAL: 0 }),
    ]);

    expect(resumo.porVigencia.get("2026-08-01")).toEqual({ alteracoes: 6, impacto: null });
    expect(resumo.porVigencia.get("2026-09-01")).toEqual({ alteracoes: 40, impacto: 0 });
  });

  it("sem impacto apurado em lugar nenhum, a coluna não existe — mas a contagem continua", () => {
    const resumo = resumirIntervalo([linha("2026-07-01", 400, {}), linha("2026-08-01", 6, {})]);

    expect(resumo.periodicidade).toBeNull();
    expect(resumo.porVigencia.get("2026-07-01")).toEqual({ alteracoes: 400, impacto: null });
  });

  it("um intervalo vazio não inventa periodicidade", () => {
    expect(resumirIntervalo([])).toEqual({ periodicidade: null, porVigencia: new Map() });
  });

  it("a escolha é estável no empate — a mesma lista não muda de coluna entre renderizações", () => {
    const linhas = [linha("2026-07-01", 10, { ANUAL: -1_000, MENSAL: 1_000 })];
    expect(resumirIntervalo(linhas).periodicidade).toBe("ANUAL");
    expect(resumirIntervalo([...linhas].reverse()).periodicidade).toBe("ANUAL");
  });
});
