import { describe, expect, it } from "vitest";
import {
  classificarTrecho,
  LIMIAR_COBERTURA,
  PISO_MATERIALIDADE,
  type AlteracaoDoTrecho,
} from "../radar-trechos";

/**
 * A árvore de decisão do Radar de Trechos, testada pura — sem banco.
 *
 * Cada `describe` cobre um dos 20 casos exigidos na investigação: direção ×
 * sinal, consolidação por status, cobertura, causa principal e os limites da
 * regra (o que ela recusa a inventar). Isolamento multi-tenant, fatos
 * ocultos, filtros, ordenação e paginação — que dependem do banco — vivem nos
 * testes de integração da rota, não aqui.
 */

function linha(over: Partial<AlteracaoDoTrecho> & { attributeCode: string }): AlteracaoDoTrecho {
  return {
    attributeName: over.attributeCode,
    economicDirection: null,
    impactConfidence: "NOT_CALCULABLE",
    impactAmount: null,
    ...over,
  };
}

const MAIOR_MELHOR = "HIGHER_IS_BETTER" as const;
const MAIOR_PIOR = "HIGHER_IS_WORSE" as const;

describe("direção × sinal — os quatro casos que fundamentam a regra", () => {
  it("1. aumento em atributo maior-é-melhor é melhora", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 500 }),
    ]);
    expect(r.veredito).toBe("MELHOROU");
    expect(r.impactoLiquido).toBe(500);
  });

  it("2. redução em atributo maior-é-melhor é piora", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: -500 }),
    ]);
    expect(r.veredito).toBe("PIOROU");
    expect(r.impactoLiquido).toBe(-500);
  });

  it("3. aumento em atributo maior-é-pior é piora", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "pedagio", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: 300 }),
    ]);
    expect(r.veredito).toBe("PIOROU");
    expect(r.impactoLiquido).toBe(-300);
  });

  it("4. redução em atributo maior-é-pior é melhora", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "pedagio", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: -300 }),
    ]);
    expect(r.veredito).toBe("MELHOROU");
    expect(r.impactoLiquido).toBe(300);
  });
});

describe("atributos neutros e não classificados", () => {
  it("5. atributo neutro não altera o status, mesmo com valor grande", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "unidade_nome", economicDirection: "NEUTRAL", impactConfidence: "NOT_CALCULABLE" }),
    ]);
    expect(r.veredito).toBe("IGUAL");
    expect(r.alteracoesMateriais).toBe(0);
  });

  it("6. atributo não classificado (direção nula) não é interpretado — não vira Q nem D", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 1000 }),
      linha({ attributeCode: "algo_desconhecido", economicDirection: null, impactConfidence: "CALCULATED", impactAmount: 5000 }),
    ]);
    // O não-classificado tem impacto maior, mas não participa da soma nem da causa.
    expect(r.impactoLiquido).toBe(1000);
    expect(r.principalCausa?.attributeCode).toBe("frete_liquido");
    expect(r.alteracoesClassificadas).toBe(1);
  });

  it("6b. DEPENDS_ON_FORMULA também não é interpretado", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 1000 }),
      linha({ attributeCode: "km_rodado", economicDirection: "DEPENDS_ON_FORMULA", impactConfidence: "CALCULATED", impactAmount: -50 }),
    ]);
    expect(r.impactoLiquido).toBe(1000);
    expect(r.veredito).toBe("MELHOROU");
  });
});

describe("consolidação por status", () => {
  it("7. todos os movimentos favoráveis → MELHOROU", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 300 }),
      linha({ attributeCode: "pedagio", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: -50 }),
    ]);
    expect(r.veredito).toBe("MELHOROU");
    expect(r.impactoLiquido).toBe(350);
  });

  it("8. todos desfavoráveis → PIOROU", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: -100 }),
      linha({ attributeCode: "pedagio", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: 80 }),
    ]);
    expect(r.veredito).toBe("PIOROU");
    expect(r.impactoLiquido).toBe(-180);
  });

  it("9. nenhum movimento material → IGUAL", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "unidade_nome", economicDirection: "NEUTRAL" }),
      linha({ attributeCode: "observacao", economicDirection: "NEUTRAL" }),
    ]);
    expect(r.veredito).toBe("IGUAL");
  });

  it("9b. IGUAL também quando o efeito líquido apurado é efetivamente zero (dentro do piso)", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 0.4 }),
      linha({ attributeCode: "pedagio", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: 0.3 }),
    ]);
    expect(Math.abs(r.impactoLiquido!)).toBeLessThanOrEqual(PISO_MATERIALIDADE);
    expect(r.veredito).toBe("IGUAL");
  });

  it("10. positivos e negativos sem forma segura de consolidar → MISTO", () => {
    // Q aponta melhora, mas D (sem valor apurado) aponta piora — não dá para
    // descartar que D, se tivesse magnitude, dominaria.
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 200 }),
      linha({ attributeCode: "seguro", economicDirection: MAIOR_PIOR, impactConfidence: "NOT_CALCULABLE", impactAmount: null }),
    ]);
    expect(r.veredito).toBe("MISTO");
  });

  it("10b. MISTO também quando D sozinho já tem sinais opostos entre si", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 1000 }),
      linha({ attributeCode: "a", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
      linha({ attributeCode: "b", economicDirection: MAIOR_PIOR, impactConfidence: "NOT_CALCULABLE" }),
    ]);
    expect(r.veredito).toBe("MISTO");
  });

  it("11. dados insuficientes (cobertura abaixo do limiar) → INCONCLUSIVO", () => {
    // O único atributo classificado é pequeno; os não-classificados carregam
    // valor monetário real (impactAmount presente, direção desconhecida) —
    // tanto por quantidade quanto por materialidade a cobertura fica baixa.
    const linhas = [
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 100 }),
      linha({ attributeCode: "a", economicDirection: null, impactConfidence: "CALCULATED", impactAmount: 400 }),
      linha({ attributeCode: "b", economicDirection: null, impactConfidence: "CALCULATED", impactAmount: 300 }),
      linha({ attributeCode: "c", economicDirection: null, impactConfidence: "CALCULATED", impactAmount: 200 }),
      linha({ attributeCode: "d", economicDirection: "DEPENDS_ON_FORMULA", impactConfidence: "CALCULATED", impactAmount: 100 }),
    ];
    const r = classificarTrecho(linhas);
    expect(r.confiabilidade!).toBeLessThan(LIMIAR_COBERTURA);
    expect(r.veredito).toBe("INCONCLUSIVO");
  });

  it("11b. D unânime sem nenhum Q não fabrica Melhorou/Piorou — mesmo com cobertura suficiente", () => {
    // Cinco alterações, quatro com direção favorável conhecida mas sem valor
    // monetário apurado (D) — cobertura por quantidade alta, mas nenhum
    // número em reais existe para consolidar. A regra não inventa um sinal.
    const r = classificarTrecho([
      linha({ attributeCode: "a", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
      linha({ attributeCode: "b", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
      linha({ attributeCode: "c", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
      linha({ attributeCode: "d", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
      linha({ attributeCode: "e", economicDirection: "NEUTRAL" }),
    ]);
    expect(r.impactoLiquido).toBeNull();
    expect(r.veredito).not.toBe("MELHOROU");
    expect(r.veredito).not.toBe("PIOROU");
  });
});

describe("impacto monetário", () => {
  it("12a. impacto líquido positivo", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 710 }),
    ]);
    expect(r.impactoLiquido).toBe(710);
  });

  it("12b. impacto líquido negativo", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: -1842 }),
    ]);
    expect(r.impactoLiquido).toBe(-1842);
  });

  it("nunca transforma variação sem impacto apurado em reais — impactoLiquido fica null quando Q está vazio", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
    ]);
    expect(r.impactoLiquido).toBeNull();
  });
});

describe("13. cobertura", () => {
  it("por quantidade: 5 de 7 alterações classificadas", () => {
    const linhas = [
      linha({ attributeCode: "1", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 10 }),
      linha({ attributeCode: "2", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: 10 }),
      linha({ attributeCode: "3", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
      linha({ attributeCode: "4", economicDirection: MAIOR_PIOR, impactConfidence: "NOT_CALCULABLE" }),
      linha({ attributeCode: "5", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 5 }),
      linha({ attributeCode: "6", economicDirection: null }),
      linha({ attributeCode: "7", economicDirection: "DEPENDS_ON_FORMULA" }),
    ];
    const r = classificarTrecho(linhas);
    expect(r.alteracoesMateriais).toBe(7);
    expect(r.alteracoesClassificadas).toBe(5);
    expect(r.coberturaPorQuantidade).toBeCloseTo(5 / 7, 6);
  });

  it("por impacto: pesa mais o que tem materialidade, não só a contagem", () => {
    // 1 de 2 alterações classificada, mas ela concentra quase todo o valor —
    // cobertura por impacto deve ser bem maior que por quantidade (1/2).
    const r = classificarTrecho([
      linha({ attributeCode: "grande", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 9900 }),
      linha({ attributeCode: "pequena_sem_direcao", economicDirection: null, impactConfidence: "CALCULATED", impactAmount: 100 }),
    ]);
    expect(r.coberturaPorQuantidade).toBeCloseTo(0.5, 6);
    expect(r.coberturaPorImpacto!).toBeCloseTo(9900 / 10000, 6);
    expect(r.coberturaPorImpacto!).toBeGreaterThan(r.coberturaPorQuantidade!);
  });

  it("cobertura por impacto expõe o risco inverso: poucas linhas não classificadas, mas concentram o valor", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "pequena", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 100 }),
      linha({ attributeCode: "grande_sem_direcao", economicDirection: null, impactConfidence: "CALCULATED", impactAmount: 9900 }),
    ]);
    expect(r.coberturaPorQuantidade).toBeCloseTo(0.5, 6);
    expect(r.coberturaPorImpacto!).toBeCloseTo(100 / 10000, 6);
    // A confiabilidade usada pra decisão é a de impacto (mais rigorosa aqui), não a de quantidade.
    expect(r.confiabilidade).toBe(r.coberturaPorImpacto);
    expect(r.veredito).toBe("INCONCLUSIVO");
  });

  it("cobertura por impacto é null (não aplicável) quando nada tem valor apurado", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "a", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
    ]);
    expect(r.coberturaPorImpacto).toBeNull();
    expect(r.confiabilidade).toBe(r.coberturaPorQuantidade);
  });
});

describe("14. principal causa", () => {
  it("é a linha de maior impacto absoluto assinado, não a de maior delta bruto", () => {
    const r = classificarTrecho([
      // delta bruto maior, mas é custo subindo → impacto assinado desfavorável de -50
      linha({ attributeCode: "pedagio", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: 50 }),
      // delta bruto menor, mas é receita caindo → impacto assinado de -120, maior em módulo
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: -120 }),
    ]);
    expect(r.principalCausa?.attributeCode).toBe("frete_liquido");
    expect(r.principalCausa?.impactoAssinado).toBe(-120);
  });

  it("é null quando não há nenhuma linha quantificada — nunca inventa causa", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "a", economicDirection: MAIOR_MELHOR, impactConfidence: "NOT_CALCULABLE" }),
    ]);
    expect(r.principalCausa).toBeNull();
  });

  it("contribuicoes traz o que fez piorar e o que compensou, ordenado por magnitude", () => {
    const r = classificarTrecho([
      linha({ attributeCode: "pedagio", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: 620 }),
      linha({ attributeCode: "manutencao", economicDirection: MAIOR_PIOR, impactConfidence: "CALCULATED", impactAmount: 1430 }),
      linha({ attributeCode: "frete_liquido", economicDirection: MAIOR_MELHOR, impactConfidence: "CALCULATED", impactAmount: 300 }),
    ]);
    expect(r.contribuicoes.map((c) => c.attributeCode)).toEqual(["manutencao", "pedagio", "frete_liquido"]);
    const pioraram = r.contribuicoes.filter((c) => c.impactoAssinado < 0);
    const compensaram = r.contribuicoes.filter((c) => c.impactoAssinado > 0);
    expect(pioraram.map((c) => c.attributeCode)).toEqual(["manutencao", "pedagio"]);
    expect(compensaram.map((c) => c.attributeCode)).toEqual(["frete_liquido"]);
  });
});

describe("limites explícitos da regra", () => {
  it("os limiares são constantes nomeadas, não números soltos escondidos na árvore", () => {
    expect(LIMIAR_COBERTURA).toBe(0.6);
    expect(PISO_MATERIALIDADE).toBe(1);
  });

  it("IGUAL num trecho sem nenhuma alteração ainda relata cobertura, não confunde com falta de dado", () => {
    const r = classificarTrecho([]);
    expect(r.veredito).toBe("IGUAL");
    expect(r.coberturaPorQuantidade).toBeNull();
    expect(r.totalAlteracoes).toBe(0);
  });
});
