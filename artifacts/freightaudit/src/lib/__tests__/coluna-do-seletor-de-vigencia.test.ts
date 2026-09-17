import { describe, expect, it } from "vitest";
import { motivoSemNumeros, resumirIntervalo } from "@/hooks/use-resumo-por-vigencia";

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
    expect(resumirIntervalo([])).toEqual({
      periodicidade: null,
      porVigencia: new Map(),
      semComparacao: new Set(),
      primeira: null,
    });
  });

  it("a escolha é estável no empate — a mesma lista não muda de coluna entre renderizações", () => {
    const linhas = [linha("2026-07-01", 10, { ANUAL: -1_000, MENSAL: 1_000 })];
    expect(resumirIntervalo(linhas).periodicidade).toBe("ANUAL");
    expect(resumirIntervalo([...linhas].reverse()).periodicidade).toBe("ANUAL");
  });
});

/**
 * A linha em branco do menu — e por que ela não podia continuar em branco.
 *
 * Uma vigência sem números tinha três causas possíveis e uma aparência só. A
 * leitura que sobrava para quem abre o menu era a única impossível: "esse mês
 * não teve importação". Vigência não importada não entra na lista — a lista é
 * feita das vigências importadas do contexto.
 */
describe("motivoSemNumeros", () => {
  const resumo = resumirIntervalo(
    [linha("2026-07-01", 400, { MENSAL: -12_000 }), linha("2026-08-01", 6, { MENSAL: -40 })],
    { gaps: [{ period: "2026-06-01" }], inicio: "2026-05-01" },
  );

  it("cala na vigência que tem números — a nota é só para a linha vazia", () => {
    expect(motivoSemNumeros("2026-07-01", resumo)).toBeNull();
  });

  it("diz 'sem comparação' na vigência importada que ninguém comparou", () => {
    expect(motivoSemNumeros("2026-06-01", resumo)?.curto).toBe("sem comparação");
  });

  it("diz 'primeira do histórico' na ponta de partida da leitura", () => {
    expect(motivoSemNumeros("2026-05-01", resumo)?.curto).toBe("primeira do histórico");
  });

  it("cala enquanto a leitura não chegou — 'não sei ainda' não vira 'sem comparação'", () => {
    /*
      É o estado da tela recém-aberta, e também o da Visão Geral servida por
      uma resposta antiga de cache, sem `gaps`. Escrever a nota aqui trocaria
      uma ausência ambígua por uma afirmação falsa que some um segundo depois.
    */
    const semLeitura = resumirIntervalo([]);
    expect(motivoSemNumeros("2026-06-01", semLeitura)).toBeNull();
  });

  it("cala na vigência fora do intervalo lido — ela não é lacuna nem ponta", () => {
    expect(motivoSemNumeros("2026-09-01", resumo)).toBeNull();
  });
});
