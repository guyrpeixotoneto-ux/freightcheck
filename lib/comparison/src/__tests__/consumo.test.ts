import { describe, expect, it } from "vitest";
import {
  celulasDoCsvDeConsumo,
  CODIGOS_DA_TABELA_DE_CONSUMO,
  CODIGOS_DO_DETALHE_DE_CONSUMO,
  COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO,
  conferenciaDoConsumo,
  conferenciaDoTrechoDeConsumo,
  impactoDeConsumo,
  linhaDeConsumoDaAlteracao,
  precoDoLitroDeReferencia,
  precoDoLitroDoTrecho,
  rendimentoPorVigencia,
  resumirConsumo,
  UNIDADE_NO_CSV_DE_CONSUMO,
  VARIAVEIS_DE_CONSUMO,
  type LinhaDeConsumo,
  type ValorDeConsumo,
} from "../consumo";

/**
 * A AUDITORIA DE CONSUMO.
 *
 * O que estes casos prendem é a leitura que só esta tela faz — **o preço do
 * litro embutido em cada trecho**, que não é coluna de lugar nenhum — e as duas
 * recusas que a cercam: rendimento não vira dinheiro sem o realizado, e as
 * colunas de combustível do cavalo são de outro grão.
 */

const linha = (over: Partial<LinhaDeConsumo> = {}): LinhaDeConsumo => ({
  id: 1,
  entityLabel: "CAMACARI-FEIRA",
  entityType: "TRECHO",
  variavel: "km_litro",
  rotuloDaVariavel: "Consumo do trecho",
  medida: "RENDIMENTO",
  papel: "RENDIMENTO",
  attributeCode: "trecho.diesel_consumo_km_l",
  base: "2.40",
  comparada: "2.30",
  diferenca: -0.1,
  variacao: -4.17,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: null,
  impactoPeriodicidade: null,
  impactoCalculado: false,
  foraDaSoma: null,
  ...over,
});

/** Um trecho coerente: 6 R$/l ÷ 2,5 km/l = 2,40 R$/km, e 960 ÷ 2,40 = 400 km. */
const valor = (over: Partial<ValorDeConsumo> = {}): ValorDeConsumo => ({
  ponta: "BASE",
  entityLabel: "CAMACARI-FEIRA",
  origem: "CAMACARI",
  destino: "FEIRA",
  kmLitro: 2.8,
  consumoAjustado: 2.5,
  dieselReaisKm: 2.4,
  freteReaisKmDiesel: 2.4,
  freteReaisViagemDiesel: 960,
  perdaKm: 2,
  perdaRegiao: 5,
  perdaDescartavel: 1,
  kmCiclo: 400,
  ...over,
});

describe("o catálogo — o consumo que precifica o frete é o do trecho", () => {
  it("todas as variáveis da tabela são do trecho", () => {
    expect(VARIAVEIS_DE_CONSUMO.every((v) => v.codigo.startsWith("trecho."))).toBe(true);
  });

  it("as seis colunas de combustível do cavalo ficam fora do recorte", () => {
    const daTela = new Set(CODIGOS_DO_DETALHE_DE_CONSUMO);
    for (const c of COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO) {
      expect(daTela.has(c.code)).toBe(false);
      expect(c.code.startsWith("cavalo.")).toBe(true);
    }
    expect(COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO).toHaveLength(6);
  });

  it("o R$/viagem só existe no detalhe", () => {
    expect(CODIGOS_DO_DETALHE_DE_CONSUMO).toContain("trecho.frete_reais_viagem_diesel");
    expect(CODIGOS_DA_TABELA_DE_CONSUMO).not.toContain("trecho.frete_reais_viagem_diesel");
  });
});

describe("a tradução do motor", () => {
  it("o que não é de consumo não vira linha", () => {
    expect(
      linhaDeConsumoDaAlteracao({
        changeType: "VALUE_CHANGED",
        attributeCode: "trecho.frete_reais_km_pneu",
        entityLabel: "CAMACARI-FEIRA",
        entityType: "TRECHO",
        valueBefore: "0.03",
        valueAfter: "0.04",
        deltaAbsolute: 0.01,
        deltaPercent: 33.3,
        comparability: "COMPARABLE",
      }),
    ).toBeNull();
  });

  it("o rendimento chega com papel próprio, e não como razão", () => {
    const l = linhaDeConsumoDaAlteracao({
      changeType: "VALUE_CHANGED",
      attributeCode: "trecho.diesel_consumo_km_l",
      entityLabel: "CAMACARI-FEIRA",
      entityType: "TRECHO",
      valueBefore: "2.8",
      valueAfter: "2.6",
      deltaAbsolute: -0.2,
      deltaPercent: -7.14,
      comparability: "COMPARABLE",
    });
    expect(l?.papel).toBe("RENDIMENTO");
    expect(l?.medida).toBe("RENDIMENTO");
  });
});

describe("o impacto — rendimento não vira dinheiro sem o realizado", () => {
  it("um km/l que caiu conta como rendimento, e não entra em soma de reais", () => {
    const i = impactoDeConsumo([linha()]);
    expect(i.rendimentosAlterados).toBe(1);
    expect(i.porPeriodicidade).toEqual({});
  });

  it("as perdas contam à parte das razões", () => {
    const i = impactoDeConsumo([
      linha({ variavel: "perda_regiao", papel: "PERDA", medida: "PERCENTUAL" }),
      linha({ variavel: "diesel_reais_km", papel: "RAZAO", medida: "REAIS_POR_KM" }),
    ]);
    expect(i.perdasAlteradas).toBe(1);
    expect(i.razoesAlteradas).toBe(1);
  });

  it("o R$/viagem sai pelo foraDaSoma", () => {
    const i = impactoDeConsumo([
      linha({
        variavel: "frete_reais_viagem_diesel",
        papel: "POR_VIAGEM",
        medida: "DINHEIRO",
        foraDaSoma: "É o R$/km multiplicado pelo km do ciclo.",
      }),
    ]);
    expect(i.foraDaSoma).toBe(1);
  });
});

describe("o resumo", () => {
  it("sem alteração é o que nenhuma linha tocou", () => {
    const r = resumirConsumo(
      [linha(), linha({ variavel: "perda_km", estado: "DADO_INCOMPLETO" })],
      { comparados: 5, novos: 0, ausentes: 0 },
    );
    expect(r.semAlteracao).toBe(4);
    expect(r.trechosComAlteracao).toBe(1);
    expect(r.trechosComDadoIncompleto).toBe(1);
  });
});

describe("o preço do litro — a leitura que só esta tela faz", () => {
  /* R$/km × km/l = R$/l. 2,40 × 2,5 = 6,00. */
  it("o produto das duas colunas devolve o preço do litro", () => {
    const p = precoDoLitroDoTrecho(valor());
    expect(p.precoDoLitro).toBeCloseTo(6, 4);
    expect(p.rendimentoUsado).toBe("AJUSTADO");
  });

  /*
    Sem o ajustado a conta cai no rendimento do trecho — e produz outro preço.
    Por isso a queda sai marcada: as duas contas na mesma série, sem distinção,
    fariam a dispersão do diesel parecer maior do que é.
  */
  it("sem o ajustado, a conta cai no rendimento do trecho e diz que caiu", () => {
    const p = precoDoLitroDoTrecho(valor({ consumoAjustado: null }));
    expect(p.precoDoLitro).toBeCloseTo(6.72, 4);
    expect(p.rendimentoUsado).toBe("DO_TRECHO");
  });

  it("sem R$/km ou sem rendimento não há preço do litro", () => {
    expect(precoDoLitroDoTrecho(valor({ dieselReaisKm: null })).precoDoLitro).toBeNull();
    expect(
      precoDoLitroDoTrecho(valor({ consumoAjustado: null, kmLitro: null })).precoDoLitro,
    ).toBeNull();
  });

  /*
    Mediana, e não média: com um punhado de trechos sobre outra premissa, a média
    sai no meio do caminho e passa a acusar como desviantes justamente os
    corretos.
  */
  it("a referência da vigência é a mediana, e não a média", () => {
    const referencia = precoDoLitroDeReferencia([
      valor(),
      valor({ entityLabel: "B" }),
      valor({ entityLabel: "C" }),
      valor({ entityLabel: "D", dieselReaisKm: 12 }),
    ]);
    expect(referencia).toBeCloseTo(6, 4);
  });

  /* Só os trechos com o ajustado entram na referência quando há algum: misturar
     as duas contas moveria a referência conforme a completude do export. */
  it("a referência prefere os trechos com rendimento ajustado", () => {
    const referencia = precoDoLitroDeReferencia([
      valor(),
      valor({ entityLabel: "B", consumoAjustado: null }),
      valor({ entityLabel: "C", consumoAjustado: null }),
    ]);
    expect(referencia).toBeCloseTo(6, 4);
  });
});

describe("a conferência — três contas, e a ordem que as torna verdadeiras", () => {
  it("tudo coerente: confere", () => {
    const c = conferenciaDoTrechoDeConsumo(valor(), 6);
    expect(c.veredito).toBe("CONFERE");
    expect(c.kmImplicito).toBe(400);
    expect(c.diferencaDoLitro).toBeCloseTo(0, 4);
  });

  /* O dinheiro que o trecho cobra decide antes da premissa de diesel por trás. */
  it("o preço que não é o custo apurado decide primeiro", () => {
    const c = conferenciaDoTrechoDeConsumo(
      valor({ freteReaisKmDiesel: 2.6, freteReaisViagemDiesel: 1040 }),
      6,
    );
    expect(c.veredito).toBe("FRETE_DIVERGE_DO_CUSTO");
    expect(c.diferencaDoPreco).toBeCloseTo(0.2, 6);
  });

  it("um diesel de outro preço aparece pelo produto das duas colunas", () => {
    const c = conferenciaDoTrechoDeConsumo(
      valor({ dieselReaisKm: 2.8, freteReaisKmDiesel: 2.8, freteReaisViagemDiesel: 1120 }),
      6,
    );
    expect(c.precoDoLitro).toBeCloseTo(7, 4);
    expect(c.veredito).toBe("PRECO_DO_LITRO_DESTOA");
  });

  it("dois por cento de folga absorvem o arredondamento", () => {
    const c = conferenciaDoTrechoDeConsumo(valor(), 6.05);
    expect(c.veredito).toBe("CONFERE");
  });

  it("um R$/viagem montado sobre outra distância acusa o km", () => {
    const c = conferenciaDoTrechoDeConsumo(valor({ freteReaisViagemDiesel: 1920 }), 6);
    expect(c.veredito).toBe("PRECO_USA_OUTRO_KM");
    expect(c.kmImplicito).toBe(800);
  });

  it("sem preço do litro não há o que conferir", () => {
    const c = conferenciaDoTrechoDeConsumo(
      valor({ dieselReaisKm: null, freteReaisKmDiesel: null }),
      6,
    );
    expect(c.veredito).toBe("BASE_INSUFICIENTE");
  });

  it("a régua da vigência calcula a própria referência e conta cada veredito", () => {
    const [base] = conferenciaDoConsumo([
      valor(),
      valor({ entityLabel: "B" }),
      valor({ entityLabel: "C" }),
      valor({
        entityLabel: "D",
        dieselReaisKm: 2.8,
        freteReaisKmDiesel: 2.8,
        freteReaisViagemDiesel: 1120,
      }),
    ]);
    expect(base.precoDoLitroDeReferencia).toBeCloseTo(6, 4);
    expect(base.confere).toBe(3);
    expect(base.litroDestoa).toBe(1);
    expect(base.precoDoLitroMaximo).toBeCloseTo(7, 4);
    expect(base.semRendimentoAjustado).toBe(0);
  });
});

describe("o rendimento por vigência — a perda sai medida, não somada", () => {
  /*
    O trecho declara três perdas e não declara em que ordem elas entram: somá-las
    dá um número diferente de multiplicá-las, e nenhum dos dois é o que o modelo
    fez. A distância entre o rendimento do trecho e o ajustado é o efeito que de
    fato ficou.
  */
  it("a perda é a distância entre os dois rendimentos, e não a soma das três colunas", () => {
    const [base] = rendimentoPorVigencia([valor()]);
    expect(base.kmLitroMedio).toBeCloseTo(2.8, 2);
    expect(base.ajustadoMedio).toBeCloseTo(2.5, 2);
    // 1 − 2,5/2,8 = 10,71 pontos — e não os 8 pontos que as três colunas somariam.
    expect(base.perdaMedidaEmPontos).toBeCloseTo(10.71, 1);
  });

  it("um trecho sem ajustado não entra na perda medida", () => {
    const [base] = rendimentoPorVigencia([
      valor(),
      valor({ entityLabel: "B", consumoAjustado: null }),
    ]);
    expect(base.trechos).toBe(2);
    expect(base.perdaMedidaEmPontos).toBeCloseTo(10.71, 1);
  });
});

describe("o CSV — a unidade escrita separa o que sobe do que desce", () => {
  it("rendimento e razão têm unidades diferentes", () => {
    expect(UNIDADE_NO_CSV_DE_CONSUMO.RENDIMENTO).toBe("km/l");
    expect(UNIDADE_NO_CSV_DE_CONSUMO.RAZAO).toBe("R$/km");
  });

  it("a justificativa é a última célula, e vem de fora da linha", () => {
    expect(celulasDoCsvDeConsumo(linha(), "Revisão trimestral").at(-1)).toBe(
      "Revisão trimestral",
    );
    expect(celulasDoCsvDeConsumo(linha()).at(-1)).toBeNull();
  });
});
