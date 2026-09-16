import { describe, expect, it } from "vitest";
import {
  celulasDoCsvDePneu,
  codigosDePneu,
  CODIGOS_DA_TABELA_DE_PNEU,
  CODIGOS_DO_DETALHE_DE_PNEU,
  COLUNAS_DE_EQUIPAMENTO_DE_PNEU,
  conferenciaDoPneu,
  conferenciaDoTrechoDePneu,
  custoDoPneuPorVigencia,
  impactoDePneu,
  linhaDePneuDaAlteracao,
  reconstituicaoDoPneu,
  reconstituicaoPorVigencia,
  resumirPneu,
  UNIDADE_NO_CSV_DE_PNEU,
  VARIAVEIS_DE_PNEU,
  type LinhaDePneu,
  type ValorDePneu,
} from "../pneu";

/**
 * A AUDITORIA DE PNEU.
 *
 * O que estes casos prendem é o que a separação da Manutenção afirmou: o pneu
 * deste acervo é **do trecho**, o R$/km do preço tem de ser o custo apurado, e a
 * reconstituição a partir dos componentes informa sem nunca virar veredito.
 */

const linha = (over: Partial<LinhaDePneu> = {}): LinhaDePneu => ({
  id: 1,
  entityLabel: "CAMACARI-FEIRA",
  entityType: "TRECHO",
  variavel: "custo_reais_km",
  rotuloDaVariavel: "Custo de pneus e câmaras R$/km",
  medida: "REAIS_POR_KM",
  papel: "RAZAO",
  attributeCode: "trecho.pneu_custo_pneus_camaras_reais_km",
  base: "0.0312",
  comparada: "0.0348",
  diferenca: 0.0036,
  variacao: 11.54,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: null,
  impactoPeriodicidade: null,
  impactoCalculado: false,
  foraDaSoma: null,
  ...over,
});

const valor = (over: Partial<ValorDePneu> = {}): ValorDePneu => ({
  ponta: "BASE",
  entityLabel: "CAMACARI-FEIRA",
  origem: "CAMACARI",
  destino: "FEIRA",
  custoReaisKm: 0.03,
  freteReaisKm: 0.03,
  freteReaisViagem: 12,
  quantidade: 6,
  valorMedioPneus: 2000,
  valorMedioRecapagem: 600,
  valorVendaCarcaca: 200,
  vidaUtil: 500000,
  vidaUtilAjustada: 480000,
  kmCiclo: 400,
  ...over,
});

describe("o catálogo — o pneu é do trecho, e o do equipamento fica no aviso", () => {
  it("todas as variáveis da tabela são do trecho", () => {
    expect(VARIAVEIS_DE_PNEU.every((v) => v.codigo.startsWith("trecho."))).toBe(true);
  });

  /*
    As três colunas de equipamento são o que a Manutenção tinha, e são o motivo
    de o pneu nunca ter dado tela lá. Elas continuam declaradas — o achado é que
    existem —, e continuam fora do recorte que vai ao motor.
  */
  it("as colunas de equipamento não entram em recorte nenhum", () => {
    const daTela = new Set(CODIGOS_DO_DETALHE_DE_PNEU);
    for (const c of COLUNAS_DE_EQUIPAMENTO_DE_PNEU) {
      expect(daTela.has(c.code)).toBe(false);
    }
    expect(COLUNAS_DE_EQUIPAMENTO_DE_PNEU.map((c) => c.code)).toContain("cavalo.valor_pneu");
    expect(COLUNAS_DE_EQUIPAMENTO_DE_PNEU.map((c) => c.code)).toContain("carreta.valor_pneus");
  });

  it("o detalhe é a tabela mais o que não soma", () => {
    expect(CODIGOS_DO_DETALHE_DE_PNEU.length).toBeGreaterThan(
      CODIGOS_DA_TABELA_DE_PNEU.length,
    );
    expect(CODIGOS_DO_DETALHE_DE_PNEU).toContain("trecho.frete_reais_viagem_pneus");
    expect(CODIGOS_DA_TABELA_DE_PNEU).not.toContain("trecho.frete_reais_viagem_pneus");
  });

  it("os códigos saem sem repetição e ordenados", () => {
    const codigos = codigosDePneu([...VARIAVEIS_DE_PNEU, ...VARIAVEIS_DE_PNEU]);
    expect(codigos).toEqual([...new Set(codigos)].sort());
  });
});

describe("a tradução do motor", () => {
  it("o que não é de pneu não vira linha", () => {
    expect(
      linhaDePneuDaAlteracao({
        changeType: "VALUE_CHANGED",
        attributeCode: "cavalo.manutencao_reais_km",
        entityLabel: "RPG0C44",
        entityType: "CAVALO",
        valueBefore: "0.34",
        valueAfter: "0.36",
        deltaAbsolute: 0.02,
        deltaPercent: 5.88,
        comparability: "COMPARABLE",
      }),
    ).toBeNull();
  });

  /* Entrada e saída não citam atributo — e são a metade mais visível do que
     muda numa malha entre duas vigências. */
  it("um trecho que entra vira linha mesmo sem atributo", () => {
    const l = linhaDePneuDaAlteracao({
      changeType: "ENTITY_ADDED",
      attributeCode: null,
      entityLabel: "NOVO-TRECHO",
      entityType: "TRECHO",
      valueBefore: null,
      valueAfter: null,
      deltaAbsolute: null,
      deltaPercent: null,
      comparability: "COMPARABLE",
    });
    expect(l?.variavel).toBe("trecho");
    expect(l?.estado).toBe("NOVO_NA_VIGENCIA");
  });

  it("o R$/viagem chega com o aviso de fora da soma", () => {
    const l = linhaDePneuDaAlteracao({
      changeType: "VALUE_CHANGED",
      attributeCode: "trecho.frete_reais_viagem_pneus",
      entityLabel: "CAMACARI-FEIRA",
      entityType: "TRECHO",
      valueBefore: "12",
      valueAfter: "13",
      deltaAbsolute: 1,
      deltaPercent: 8.33,
      comparability: "COMPARABLE",
    });
    expect(l?.papel).toBe("POR_VIAGEM");
    expect(l?.foraDaSoma).toMatch(/duas vezes/);
  });
});

describe("o impacto — razão não vira reais, e unitário não soma com razão", () => {
  it("R$/km alterado conta como razão, e não como dinheiro", () => {
    const i = impactoDePneu([linha()]);
    expect(i.razoesAlteradas).toBe(1);
    expect(i.porPeriodicidade).toEqual({});
    expect(i.naoCalculavel).toBe(0);
  });

  it("o valor do pneu novo conta como unitário, fora de toda soma de reais", () => {
    const i = impactoDePneu([
      linha({
        variavel: "valor_medio_pneus",
        papel: "UNITARIO",
        medida: "DINHEIRO",
        attributeCode: "trecho.pneu_valor_medio_pneus",
        impactoAmount: 120,
        impactoCalculado: true,
        impactoPeriodicidade: "MENSAL",
      }),
    ]);
    expect(i.unitariosAlterados).toBe(1);
    expect(i.porPeriodicidade).toEqual({});
  });

  it("a vida útil conta à parte — é o denominador, não dinheiro", () => {
    const i = impactoDePneu([
      linha({ variavel: "vida_util_ajustada", papel: "VIDA", medida: "DISTANCIA" }),
    ]);
    expect(i.vidasAlteradas).toBe(1);
  });

  it("o R$/viagem sai pelo foraDaSoma", () => {
    const i = impactoDePneu([
      linha({
        variavel: "frete_reais_viagem",
        papel: "POR_VIAGEM",
        medida: "DINHEIRO",
        foraDaSoma: "É o R$/km multiplicado pelo km do ciclo.",
      }),
    ]);
    expect(i.foraDaSoma).toBe(1);
    expect(i.porPeriodicidade).toEqual({});
  });
});

describe("o resumo — sem alteração é o que nenhuma linha tocou", () => {
  it("um trecho com conflito e alteração não conta duas vezes como tocado", () => {
    const r = resumirPneu(
      [
        linha({ estado: "ALTERADO" }),
        linha({ variavel: "vida_util", estado: "CONFLITO" }),
        linha({ entityLabel: "OUTRO", estado: "ALTERADO" }),
      ],
      { comparados: 10, novos: 1, ausentes: 2 },
    );
    expect(r.semAlteracao).toBe(8);
    expect(r.trechosComAlteracao).toBe(2);
    expect(r.trechosComConflito).toBe(1);
    expect(r.variaveisAlteradas).toBe(2);
  });
});

describe("a conferência — o preço tem de ser o custo apurado", () => {
  it("preço igual ao custo e km que fecha: confere", () => {
    const c = conferenciaDoTrechoDePneu(valor());
    expect(c.veredito).toBe("CONFERE");
    expect(c.kmImplicito).toBe(400);
    expect(c.abaixoDoCusto).toBe(false);
  });

  /*
    Meio centavo por quilômetro é a folga do arredondamento. Um centavo inteiro
    de diferença numa parcela da ordem de três centavos é um terço da rubrica, e
    é exatamente o que a tela precisa acusar.
  */
  it("preço abaixo do custo apurado é divergência, e a direção sai marcada", () => {
    const c = conferenciaDoTrechoDePneu(valor({ freteReaisKm: 0.02, freteReaisViagem: 8 }));
    expect(c.veredito).toBe("PRECO_DIVERGE_DO_CUSTO");
    expect(c.abaixoDoCusto).toBe(true);
    expect(c.diferencaDoPreco).toBeCloseTo(-0.01, 6);
  });

  it("uma diferença dentro da folga não vira divergência", () => {
    const c = conferenciaDoTrechoDePneu(
      valor({ freteReaisKm: 0.0302, freteReaisViagem: 12.08 }),
    );
    expect(c.veredito).toBe("CONFERE");
  });

  /* A identidade do dicionário: R$/viagem ÷ R$/km tem de devolver o km do ciclo. */
  it("um R$/viagem montado sobre outra distância acusa o km", () => {
    const c = conferenciaDoTrechoDePneu(valor({ freteReaisViagem: 24 }));
    expect(c.veredito).toBe("PRECO_USA_OUTRO_KM");
    expect(c.kmImplicito).toBe(800);
  });

  it("sem uma das duas colunas de R$/km não há o que conferir", () => {
    expect(conferenciaDoTrechoDePneu(valor({ custoReaisKm: null })).veredito).toBe(
      "BASE_INSUFICIENTE",
    );
  });

  /* Zero dos dois lados é coerente com qualquer distância: dividir zero por zero
     não produz quilometragem, e entrar na conta seria uma concordância falsa. */
  it("um trecho que não cobra pneu não produz km implícito", () => {
    const c = conferenciaDoTrechoDePneu(
      valor({ custoReaisKm: 0, freteReaisKm: 0, freteReaisViagem: 0 }),
    );
    expect(c.kmImplicito).toBeNull();
    expect(c.veredito).toBe("CONFERE");
  });

  it("a régua da vigência conta cada veredito, e os abaixo do custo à parte", () => {
    const [base] = conferenciaDoPneu([
      valor(),
      valor({ entityLabel: "B", freteReaisKm: 0.02, freteReaisViagem: 8 }),
      valor({ entityLabel: "C", freteReaisViagem: 24 }),
      valor({ entityLabel: "D", custoReaisKm: null }),
    ]);
    expect(base.trechos).toBe(4);
    expect(base.confere).toBe(1);
    expect(base.divergeDoCusto).toBe(1);
    expect(base.abaixoDoCusto).toBe(1);
    expect(base.precoUsaOutroKm).toBe(1);
    expect(base.baseInsuficiente).toBe(1);
  });
});

describe("a reconstituição — informa, e nunca julga", () => {
  /*
    6 pneus × (2000 + 600 − 200) ÷ 480.000 = 0,03 R$/km. A conta bate com o
    apurado neste trecho de propósito: o que o caso prende é que a fórmula é essa,
    e que ela declara a suposição de uma recapagem.
  */
  it("os cinco componentes montam o R$/km, supondo uma recapagem", () => {
    const r = reconstituicaoDoPneu(valor());
    expect(r.reconstituido).toBeCloseTo(0.03, 6);
    expect(r.recapagensSupostas).toBe(1);
    expect(r.componentesAusentes).toEqual([]);
    expect(r.diferenca).toBeCloseTo(0, 6);
  });

  it("a carcaça abate o custo em vez de somar a ele", () => {
    const semCarcaca = reconstituicaoDoPneu(valor({ valorVendaCarcaca: 0 }));
    expect(semCarcaca.reconstituido!).toBeGreaterThan(reconstituicaoDoPneu(valor()).reconstituido!);
  });

  it("faltando um componente, a conta não sai — e diz qual faltou", () => {
    const r = reconstituicaoDoPneu(valor({ vidaUtilAjustada: null }));
    expect(r.reconstituido).toBeNull();
    expect(r.componentesAusentes).toContain("Vida útil ajustada");
  });

  /* A reconstituição não entra em veredito nenhum: um trecho cuja reconstituição
     está longe do apurado continua conferindo, porque a suposição é nossa. */
  it("uma reconstituição distante não muda o veredito da conferência", () => {
    const v = valor({ valorMedioRecapagem: 3000 });
    expect(reconstituicaoDoPneu(v).diferenca!).toBeGreaterThan(0.01);
    expect(conferenciaDoTrechoDePneu(v).veredito).toBe("CONFERE");
  });

  /* As duas médias saem da mesma população: comparar a média de 2 trechos com a
     de 3 produziria uma distância que é da amostra, e não da conta. */
  it("as duas médias por vigência saem dos mesmos trechos", () => {
    const [base] = reconstituicaoPorVigencia([
      valor(),
      valor({ entityLabel: "B" }),
      valor({ entityLabel: "C", vidaUtilAjustada: null }),
    ]);
    expect(base.trechosReconstituidos).toBe(2);
    expect(base.trechosIncompletos).toBe(1);
    expect(base.mediaReconstituida).toBeCloseTo(base.mediaApurada!, 4);
  });
});

describe("os agregados por vigência", () => {
  it("o custo médio é média simples entre trechos", () => {
    const [base] = custoDoPneuPorVigencia([
      valor({ custoReaisKm: 0.02 }),
      valor({ entityLabel: "B", custoReaisKm: 0.04 }),
    ]);
    expect(base.custoMedio).toBeCloseTo(0.03, 4);
    expect(base.custoMinimo).toBeCloseTo(0.02, 4);
    expect(base.custoMaximo).toBeCloseTo(0.04, 4);
    expect(base.trechos).toBe(2);
  });

  it("as duas pontas saem separadas e ordenadas", () => {
    const series = custoDoPneuPorVigencia([valor(), valor({ ponta: "COMPARADA" })]);
    expect(series.map((s) => s.ponta)).toEqual(["BASE", "COMPARADA"]);
  });
});

describe("o CSV — a unidade escrita é o que impede a soma que não é de nada", () => {
  it("cada papel tem a unidade dele por extenso", () => {
    expect(UNIDADE_NO_CSV_DE_PNEU.RAZAO).toBe("R$/km");
    expect(UNIDADE_NO_CSV_DE_PNEU.UNITARIO).toBe("R$/pneu");
    expect(UNIDADE_NO_CSV_DE_PNEU.VIDA).toBe("km de vida");
  });

  it("a justificativa é a última célula, e vem de fora da linha", () => {
    const celulas = celulasDoCsvDePneu(linha(), "Renegociação de contrato");
    expect(celulas.at(-1)).toBe("Renegociação de contrato");
    expect(celulas[2]).toBe("R$/km");
  });

  it("sem justificativa a célula fica nula, e o resto do arquivo continua", () => {
    expect(celulasDoCsvDePneu(linha()).at(-1)).toBeNull();
  });
});
