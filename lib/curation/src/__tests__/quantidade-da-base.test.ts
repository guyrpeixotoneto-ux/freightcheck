import { describe, expect, it } from "vitest";
import {
  baseDaTaxa,
  comoSeLeABase,
  derivarMontante,
  fonteAplicavel,
  podeSerQuantidadeDaBase,
  type FonteDaQuantidade,
} from "../quantidade-da-base";

/**
 * A conta que transforma taxa em montante, sem banco.
 *
 * O que estes testes prendem não é a aritmética — é o que ela **assume**: que a
 * base da taxa e a base declarada são a mesma, que uma previsão sai marcada
 * como previsão, e que a recusa diz o que falta em vez de devolver zero.
 */

const viagensPrevistas: FonteDaQuantidade = {
  entityType: "TRECHO",
  base: "VIAGEM",
  competencia: "MENSAL",
  attributeCode: "trecho.previsao_viagens",
  natureza: "PREVISTA",
};

const kmMedido: FonteDaQuantidade = {
  entityType: "*",
  base: "KM",
  competencia: "MENSAL",
  attributeCode: "cavalo.km_rodado_mes",
  natureza: "MEDIDA",
};

const quantidade = (valores: Record<string, number | null>) => (code: string) => ({
  valor: valores[code] ?? null,
});

describe("a base de uma taxa", () => {
  it("sai do denominador confirmado, que é o campo que alguém assinou", () => {
    expect(baseDaTaxa({ unit: "BRL_KM", denominator: "VIAGEM" })).toBe("VIAGEM");
  });

  it("cai para o nome da unidade quando o denominador não foi gravado", () => {
    expect(baseDaTaxa({ unit: "BRL_VIAGEM", denominator: null })).toBe("VIAGEM");
    expect(baseDaTaxa({ unit: "BRL_PALLET" })).toBe("PALLET");
  });

  it("é nula quando a unidade não é preço por unidade de nada", () => {
    expect(baseDaTaxa({ unit: "BRL" })).toBeNull();
    expect(baseDaTaxa({ unit: "PERCENT" })).toBeNull();
    expect(baseDaTaxa({ unit: null })).toBeNull();
  });
});

describe("qual declaração vale", () => {
  const fontes = [kmMedido, { ...kmMedido, entityType: "TRECHO", attributeCode: "trecho.km_rodado" }];

  it("a específica ganha da geral", () => {
    const escolhida = fonteAplicavel(fontes, {
      entityType: "TRECHO",
      base: "KM",
      competencia: "MENSAL",
    });
    expect(escolhida?.attributeCode).toBe("trecho.km_rodado");
  });

  it("a geral serve quem não tem específica", () => {
    const escolhida = fonteAplicavel(fontes, {
      entityType: "CAVALO",
      base: "KM",
      competencia: "MENSAL",
    });
    expect(escolhida?.attributeCode).toBe("cavalo.km_rodado_mes");
  });

  it("base sem declaração nenhuma devolve nulo, e não a primeira da lista", () => {
    expect(
      fonteAplicavel(fontes, { entityType: "TRECHO", base: "PALLET", competencia: "MENSAL" }),
    ).toBeNull();
  });
});

describe("R$/viagem × viagens e R$/km × km são a mesma conta", () => {
  it("multiplica a taxa pela quantidade declarada", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "trecho.frete_reais_viagem_diesel", valor: 12.4, unit: "BRL_VIAGEM" },
      entityType: "TRECHO",
      competencia: "MENSAL",
      fontes: [viagensPrevistas],
      quantidadeDe: quantidade({ "trecho.previsao_viagens": 128 }),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toBe(1587.2);
    expect(r.periodicity).toBe("MENSAL");
    expect(r.aggregation).toBe("SUM");
    expect(r.derivacao.formula).toBe("12,40 × 128");
  });

  it("o mesmo mecanismo serve o R$/km do cavalo, que já é lacuna hoje", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "cavalo.manutencao_reais_km", valor: 0.38, unit: "BRL_KM" },
      entityType: "CAVALO",
      competencia: "MENSAL",
      fontes: [kmMedido],
      quantidadeDe: quantidade({ "cavalo.km_rodado_mes": 4200 }),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toBe(1596);
    expect(r.derivacao.base).toBe("KM");
  });

  it("nada no módulo conhece as bases: uma base cadastrada depois funciona igual", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "trecho.taxa_por_entrega", valor: 3.5, unit: "BRL_ENTREGA" },
      entityType: "TRECHO",
      competencia: "MENSAL",
      fontes: [
        {
          entityType: "TRECHO",
          base: "ENTREGA",
          competencia: "MENSAL",
          attributeCode: "trecho.entregas_mes",
          natureza: "MEDIDA",
        },
      ],
      quantidadeDe: quantidade({ "trecho.entregas_mes": 10 }),
    });
    expect(r.ok && r.valor).toBe(35);
  });
});

describe("previsão não vira apuração", () => {
  it("o resultado carrega a natureza da fonte, e a frase diz que é projeção", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "trecho.frete_reais_viagem_pedagio", valor: 10, unit: "BRL_VIAGEM" },
      entityType: "TRECHO",
      competencia: "MENSAL",
      fontes: [viagensPrevistas],
      quantidadeDe: quantidade({ "trecho.previsao_viagens": 100 }),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.derivacao.natureza).toBe("PREVISTA");
    expect(r.derivacao.explicacao).toMatch(/previsão/i);
    expect(r.derivacao.explicacao).toMatch(/projetado, e não apurado/i);
  });

  it("trocar a fonte por uma medida muda a etiqueta sem mudar o cálculo", () => {
    const comum = {
      taxa: { attributeCode: "trecho.x", valor: 10, unit: "BRL_VIAGEM" },
      entityType: "TRECHO",
      competencia: "MENSAL" as const,
      quantidadeDe: quantidade({ "trecho.previsao_viagens": 100, "trecho.viagens_realizadas": 100 }),
    };
    const previsto = derivarMontante({ ...comum, fontes: [viagensPrevistas] });
    const medido = derivarMontante({
      ...comum,
      fontes: [
        { ...viagensPrevistas, attributeCode: "trecho.viagens_realizadas", natureza: "MEDIDA" },
      ],
    });

    expect(previsto.ok && previsto.valor).toBe(medido.ok && medido.valor);
    expect(previsto.ok && previsto.derivacao.natureza).toBe("PREVISTA");
    expect(medido.ok && medido.derivacao.natureza).toBe("MEDIDA");
    expect(medido.ok && medido.derivacao.explicacao).not.toMatch(/previsão/i);
  });
});

describe("as recusas dizem o que falta", () => {
  it("sem declaração, nomeia a base e o que precisa ser declarado", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "cavalo.manutencao_reais_km", valor: 0.38, unit: "BRL_KM" },
      entityType: "CAVALO",
      competencia: "MENSAL",
      fontes: [],
      quantidadeDe: quantidade({}),
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("BASE_NAO_DECLARADA");
    expect(r.explicacao).toMatch(/quantidade de km do mês/i);
    // Não devolve zero: um zero entraria num total como se fosse um valor.
    expect(r).not.toHaveProperty("valor");
  });

  it("o ativo sem valor para a coluna declarada é recusa, não zero", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "trecho.x", valor: 12.4, unit: "BRL_VIAGEM" },
      entityType: "TRECHO",
      competencia: "MENSAL",
      fontes: [viagensPrevistas],
      quantidadeDe: quantidade({}),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("QUANTIDADE_AUSENTE");
    expect(r.explicacao).toContain("trecho.previsao_viagens");
  });

  it("quantidade negativa é recusada em vez de virar montante negativo", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "trecho.x", valor: 12.4, unit: "BRL_VIAGEM" },
      entityType: "TRECHO",
      competencia: "MENSAL",
      fontes: [viagensPrevistas],
      quantidadeDe: quantidade({ "trecho.previsao_viagens": -3 }),
    });
    expect(r.ok && "sem recusa").toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("QUANTIDADE_NEGATIVA");
  });

  it("um montante não é taxa e não passa por aqui", () => {
    const r = derivarMontante({
      taxa: { attributeCode: "cavalo.custo_fixo", valor: 8000, unit: "BRL" },
      entityType: "CAVALO",
      competencia: "MENSAL",
      fontes: [kmMedido],
      quantidadeDe: quantidade({ "cavalo.km_rodado_mes": 4200 }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("NAO_E_TAXA");
  });
});

describe("o que pode ser declarado como quantidade", () => {
  it("recusa coluna monetária — daria reais ao quadrado", () => {
    const v = podeSerQuantidadeDaBase({ unit: "BRL", isMonetary: true, valueKind: "AMOUNT" });
    expect(v.ok).toBe(false);
    expect(v.motivo).toMatch(/reais ao quadrado/i);
  });

  it("recusa razão e percentual — base é contagem, não proporção", () => {
    expect(podeSerQuantidadeDaBase({ unit: "PERCENT", isMonetary: false, valueKind: "RATIO" }).ok).toBe(false);
    expect(podeSerQuantidadeDaBase({ unit: "BRL_KM", isMonetary: false, valueKind: "RATE" }).ok).toBe(false);
  });

  it("recusa coluna não numérica", () => {
    const v = podeSerQuantidadeDaBase({
      unit: null,
      isMonetary: false,
      valueKind: "DESCRIPTOR",
      dataType: "TEXT",
    });
    expect(v.ok).toBe(false);
  });

  it("aceita a grandeza — que é o que previsaoViagens e a quilometragem são", () => {
    expect(
      podeSerQuantidadeDaBase({
        unit: "QTD",
        isMonetary: false,
        valueKind: "QUANTITY",
        dataType: "NUMERIC",
      }).ok,
    ).toBe(true);
  });

  it("não exige semântica confirmada: a declaração antecede a confirmação", () => {
    expect(podeSerQuantidadeDaBase({ unit: null, isMonetary: null }).ok).toBe(true);
  });
});

describe("a base dita em português", () => {
  it("concorda com o número", () => {
    expect(comoSeLeABase("VIAGEM", 1)).toBe("viagem");
    expect(comoSeLeABase("VIAGEM", 128)).toBe("viagens");
  });

  it("uma base desconhecida sai como veio, e não vira erro", () => {
    expect(comoSeLeABase("CAIXA_TERMICA")).toBe("caixa termica");
  });
});
