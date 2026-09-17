import { describe, expect, it } from "vitest";

import {
  competenciaDe,
  competenciasDasDatas,
  consolidarCompetencia,
  ehCompetencia,
  rotuloDaCompetencia,
  type ParcelaNaVigencia,
  type RemuneradoDaCompetencia,
} from "../competencia-de-finame";
import { confrontar, type LinhaDoConfronto } from "../confronto-de-finame";
import {
  fonteDoParametro,
  parametroDaFonte,
  validarFonte,
  GRANULARIDADE_DA_FONTE,
  SEMANTICA_DA_FONTE,
  TITULOS_DO_REAL,
  TITULOS_DO_REMUNERADO,
} from "../fonte-de-finame";
import {
  normalizarSinal,
  SEM_FONTE_DO_REALIZADO,
  type ValorRealizado,
} from "../realizado-de-finame";

/**
 * O CONFRONTO, SEM BANCO — as regras que o dinheiro obedece.
 *
 * Cada bloco aqui corresponde a uma afirmação que a tela faz e que, se falsa,
 * produz um número plausível e errado. São as regras que erram calado: somar
 * duas quinzenas, transformar ausência em zero, dividir por zero, conciliar
 * placas que não são o mesmo ativo.
 */

const parcela = (
  effectiveDate: string,
  entityLabel: string,
  valor: number | null,
  entityType = "CAVALO",
): ParcelaNaVigencia => ({ effectiveDate, entityLabel, entityType, valor });

const real = (
  entityLabel: string,
  valor: number | null,
  entityType = "CAVALO",
  competencia = "2026-09",
): ValorRealizado => ({
  competencia,
  entityLabel,
  entityType,
  valor,
  bruto: valor,
});

const consolidar = (
  parcelas: ParcelaNaVigencia[],
  vigenciasDoMes: string[],
  competencia = "2026-09",
) => consolidarCompetencia({ competencia, vigenciasDoMes, parcelas });

const linhaDe = (c: { linhas: LinhaDoConfronto[] }, placa: string) =>
  c.linhas.find((l) => l.entityLabel === placa)!;

// ---------------------------------------------------------------------------
// O vocabulário da fonte
// ---------------------------------------------------------------------------

describe("a fonte analisada", () => {
  it("um link sem o parâmetro abre em Remunerado", () => {
    expect(fonteDoParametro(null)).toBe("REMUNERADO");
    expect(fonteDoParametro(undefined)).toBe("REMUNERADO");
    expect(fonteDoParametro("")).toBe("REMUNERADO");
  });

  it("um valor adulterado cai no padrão em vez de quebrar a tela", () => {
    expect(fonteDoParametro("realizado")).toBe("REMUNERADO");
    expect(fonteDoParametro("../etc/passwd")).toBe("REMUNERADO");
  });

  it("vai e volta do endereço sem perder a fonte", () => {
    for (const fonte of ["REMUNERADO", "REAL"] as const) {
      expect(fonteDoParametro(parametroDaFonte(fonte))).toBe(fonte);
    }
  });

  /*
    O servidor é estrito onde o cliente é indulgente. Um pedido com fonte que
    este produto não conhece é recusado, e não atendido com a outra fonte.
  */
  it("o servidor recusa a fonte que não reconhece, em vez de escolher uma", () => {
    expect(validarFonte("real")).toBe("REAL");
    expect(validarFonte("remunerado")).toBe("REMUNERADO");
    expect(validarFonte(undefined)).toBe("REMUNERADO");
    expect(validarFonte("REAL")).toBeNull();
    expect(validarFonte("realizado")).toBeNull();
    expect(validarFonte(42)).toBeNull();
  });

  it("Real compara remunerado contra realizado, e nunca duas vigências", () => {
    expect(SEMANTICA_DA_FONTE.REAL.comparacao).toBe("REMUNERADO_CONTRA_REALIZADO");
    expect(SEMANTICA_DA_FONTE.REMUNERADO.comparacao).toBe("ENTRE_VIGENCIAS");
  });

  it("o Inverter só existe onde a direção é escolha de quem lê", () => {
    expect(SEMANTICA_DA_FONTE.REMUNERADO.permiteInverter).toBe(true);
    expect(SEMANTICA_DA_FONTE.REAL.permiteInverter).toBe(false);
  });

  it("o eixo do tempo do Real é a competência mensal — nunca a quinzena", () => {
    expect(GRANULARIDADE_DA_FONTE.REAL).toBe("COMPETENCIA");
    expect(GRANULARIDADE_DA_FONTE.REMUNERADO).toBe("VIGENCIA");
  });

  it("os textos mudam com a fonte, e nenhum fala de vigência no Real", () => {
    expect(SEMANTICA_DA_FONTE.REMUNERADO.selo).toBe("Comparação entre vigências");
    expect(SEMANTICA_DA_FONTE.REAL.selo).toBe("Remunerado × Realizado");
    expect(SEMANTICA_DA_FONTE.REAL.linhaDeContexto).toContain("efetivamente realizado");
    expect(SEMANTICA_DA_FONTE.REAL.periodo).toBe("competência");

    const textosDoReal = [
      SEMANTICA_DA_FONTE.REAL.selo,
      SEMANTICA_DA_FONTE.REAL.periodo,
      SEMANTICA_DA_FONTE.REAL.periodos,
      ...Object.values(TITULOS_DO_REAL),
    ].join(" ");
    expect(textosDoReal).not.toMatch(/vigênci/i);
    expect(textosDoReal).not.toMatch(/quinzena/i);
  });

  /*
    Os cartões do Real não são os do Remunerado renomeados: "Sem alteração",
    "Novos na vigência" e "Ausentes na comparada" não têm sentido onde não há
    duas vigências entre as quais algo pudesse mudar.
  */
  it("os cartões do Real não reaproveitam os estados de mudança", () => {
    const doReal = Object.values(TITULOS_DO_REAL) as string[];
    for (const proibido of [
      TITULOS_DO_REMUNERADO.semAlteracao,
      TITULOS_DO_REMUNERADO.novos,
      TITULOS_DO_REMUNERADO.ausentes,
    ]) {
      expect(doReal).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------
// A competência
// ---------------------------------------------------------------------------

describe("a competência mensal", () => {
  it("sai da data da vigência, e recusa o que não é data", () => {
    expect(competenciaDe("2026-09-16")).toBe("2026-09");
    expect(competenciaDe("2026-09")).toBeNull();
    expect(competenciaDe("")).toBeNull();
    expect(competenciaDe(null)).toBeNull();
  });

  it("se escreve como quem fala dela", () => {
    expect(rotuloDaCompetencia("2026-09")).toBe("setembro/2026");
    expect(rotuloDaCompetencia("2026-08")).toBe("agosto/2026");
  });

  it("não inventa mês", () => {
    expect(ehCompetencia("2026-13")).toBe(false);
    expect(ehCompetencia("2026-00")).toBe(false);
    expect(ehCompetencia("2026-09")).toBe(true);
  });

  it("agrupa as duas quinzenas do mês numa competência só", () => {
    expect(competenciasDasDatas(["2026-09-01", "2026-09-16", "2026-08-16"])).toEqual([
      "2026-08",
      "2026-09",
    ]);
  });
});

// ---------------------------------------------------------------------------
// A consolidação mensal — a regra que impede a dupla contagem
// ---------------------------------------------------------------------------

describe("o remunerado mensal consolidado", () => {
  /**
   * A regra central. A parcela FINAME é MENSAL (ver
   * `docs/AUDITORIA-PERIODICIDADE.md`): as duas quinzenas de setembro declaram
   * **a mesma** parcela mensal, não duas metades dela. Somá-las contaria o
   * dinheiro duas vezes e faria todo veículo aparecer com déficit de 100%.
   */
  it("NÃO soma as duas quinzenas do mês — o valor mensal é a parcela vigente", () => {
    const consolidado = consolidar(
      [parcela("2026-09-01", "QYW3J49", 4395.36), parcela("2026-09-16", "QYW3J49", 4395.36)],
      ["2026-09-01", "2026-09-16"],
    );

    expect(consolidado).toHaveLength(1);
    expect(consolidado[0].valor).toBe(4395.36);
    expect(consolidado[0].valor).not.toBe(8790.72);
    expect(consolidado[0].situacao).toBe("CONSOLIDADO");
    expect(consolidado[0].vigencias).toEqual(["2026-09-01", "2026-09-16"]);
  });

  it("o mês de uma entrega só consolida com ela", () => {
    const consolidado = consolidar([parcela("2026-09-16", "QYW3J49", 4395.36)], ["2026-09-16"]);
    expect(consolidado[0].situacao).toBe("CONSOLIDADO");
    expect(consolidado[0].valor).toBe(4395.36);
  });

  /*
    Quando as quinzenas discordam, o financiamento mudou no meio do mês. Não há
    um número que represente o mês — e escolher um caladamente (a última, a
    maior, a média) é precisão inventada.
  */
  it("quinzenas que discordam não viram um valor: viram divergência, com os dois números", () => {
    const consolidado = consolidar(
      [parcela("2026-09-01", "QYW3J49", 4395.36), parcela("2026-09-16", "QYW3J49", 4500.0)],
      ["2026-09-01", "2026-09-16"],
    );

    expect(consolidado[0].situacao).toBe("DIVERGENCIA_INTRAMENSAL");
    expect(consolidado[0].valor).toBeNull();
    expect(consolidado[0].valoresDivergentes).toEqual([4395.36, 4500.0]);
  });

  it("informado numa quinzena e ausente na outra é divergência, não continuidade", () => {
    const consolidado = consolidar(
      [parcela("2026-09-01", "QYW3J49", 4395.36), parcela("2026-09-16", "QYW3J49", null)],
      ["2026-09-01", "2026-09-16"],
    );
    expect(consolidado[0].situacao).toBe("DIVERGENCIA_INTRAMENSAL");
    expect(consolidado[0].valor).toBeNull();
  });

  it("a placa que só está em metade do mês não tem mês inteiro para comparar", () => {
    const consolidado = consolidar(
      [parcela("2026-09-16", "NOVA0A1", 3000)],
      ["2026-09-01", "2026-09-16"],
    );
    expect(consolidado[0].situacao).toBe("COBERTURA_PARCIAL");
    expect(consolidado[0].valor).toBeNull();
  });

  it("parcela não informada em nenhuma vigência é ausência, e não zero", () => {
    const consolidado = consolidar(
      [parcela("2026-09-01", "QYW3J49", null), parcela("2026-09-16", "QYW3J49", null)],
      ["2026-09-01", "2026-09-16"],
    );
    expect(consolidado[0].situacao).toBe("SEM_VALOR");
    expect(consolidado[0].valor).toBeNull();
    expect(consolidado[0].valor).not.toBe(0);
  });

  it("zero declarado nas duas quinzenas é um zero de verdade, e consolida", () => {
    const consolidado = consolidar(
      [parcela("2026-09-01", "ALUG0A1", 0, "CARRETA"), parcela("2026-09-16", "ALUG0A1", 0, "CARRETA")],
      ["2026-09-01", "2026-09-16"],
    );
    expect(consolidado[0].situacao).toBe("CONSOLIDADO");
    expect(consolidado[0].valor).toBe(0);
  });

  it("o mês só recebe as vigências dele — agosto não entra em setembro", () => {
    const consolidado = consolidar(
      [parcela("2026-08-16", "QYW3J49", 9999), parcela("2026-09-16", "QYW3J49", 4395.36)],
      ["2026-09-16"],
    );
    expect(consolidado).toHaveLength(1);
    expect(consolidado[0].valor).toBe(4395.36);
  });

  it("cavalo e carreta com a mesma placa são dois ativos, e consolidam separados", () => {
    const consolidado = consolidar(
      [parcela("2026-09-16", "AAA0A11", 100, "CAVALO"), parcela("2026-09-16", "AAA0A11", 200, "CARRETA")],
      ["2026-09-16"],
    );
    expect(consolidado).toHaveLength(2);
    expect(consolidado.map((c) => c.valor).sort()).toEqual([100, 200]);
  });
});

// ---------------------------------------------------------------------------
// O confronto
// ---------------------------------------------------------------------------

describe("o confronto remunerado × realizado", () => {
  const remunerado = (placa: string, valor: number | null, entityType = "CAVALO") =>
    consolidar([parcela("2026-09-16", placa, valor, entityType)], ["2026-09-16"]);

  it("a fórmula é remunerado − realizado", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("QYW3J49", 5000),
      realizado: [real("QYW3J49", 4200)],
    });
    const linha = linhaDe(c, "QYW3J49");
    expect(linha.diferenca).toBe(800);
    expect(linha.resultado).toBe("SOBRA");
  });

  it("remunerado abaixo do custo é déficit", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("QYW3J49", 4000),
      realizado: [real("QYW3J49", 4200)],
    });
    expect(linhaDe(c, "QYW3J49").diferenca).toBe(-200);
    expect(linhaDe(c, "QYW3J49").resultado).toBe("DEFICIT");
  });

  it("os dois lados iguais é equilíbrio, não sobra de um centavo de ruído", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("QYW3J49", 4200),
      realizado: [real("QYW3J49", 4200.001)],
    });
    expect(linhaDe(c, "QYW3J49").resultado).toBe("EQUILIBRIO");
  });

  it("a variação tem por base o realizado, e não existe sobre base zero", () => {
    const comBase = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("QYW3J49", 5000),
      realizado: [real("QYW3J49", 4000)],
    });
    expect(linhaDe(comBase, "QYW3J49").variacao).toBeCloseTo(0.25, 10);

    const semBase = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("QUITADO1", 5000),
      realizado: [real("QUITADO1", 0)],
    });
    const linha = linhaDe(semBase, "QUITADO1");
    expect(linha.variacao).toBeNull();
    expect(Number.isFinite(linha.variacao as number)).toBe(false);
    /* O zero do realizado é real: a diferença existe, só o percentual não. */
    expect(linha.diferenca).toBe(5000);
    expect(linha.resultado).toBe("SOBRA");
  });

  it("ausência de um lado não vira R$ 0,00", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("SOREMUN", 5000),
      realizado: [],
    });
    const linha = linhaDe(c, "SOREMUN");
    expect(linha.cobertura).toBe("SEM_REALIZADO");
    expect(linha.realizado).toBeNull();
    expect(linha.realizado).not.toBe(0);
    expect(linha.diferenca).toBeNull();
    expect(linha.resultado).toBe("NAO_CALCULAVEL");
  });

  it("o que só o realizado tem aparece, em vez de sumir", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: [],
      realizado: [real("SOREAL1", 3000)],
    });
    const linha = linhaDe(c, "SOREAL1");
    expect(linha.cobertura).toBe("SEM_REMUNERADO");
    expect(linha.remunerado).toBeNull();
    expect(linha.resultado).toBe("NAO_CALCULAVEL");
  });

  it("placa não conciliada não entra no resultado líquido", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: [...remunerado("CONCIL1", 5000), ...remunerado("SOREMUN", 9999)],
      realizado: [real("CONCIL1", 4000), real("SOREAL1", 7777)],
    });

    expect(c.resumo.veiculosConciliados).toBe(1);
    expect(c.resumo.totalRemunerado).toBe(5000);
    expect(c.resumo.totalRealizado).toBe(4000);
    expect(c.resumo.saldoDosConciliados).toBe(1000);
    /* Nem 9999 nem 7777 entraram em total nenhum — e os dois estão ditos. */
    expect(c.resumo.foraDoConfronto.remuneradoSemRealizado).toBe(9999);
    expect(c.resumo.foraDoConfronto.realizadoSemRemunerado).toBe(7777);
    expect(c.resumo.foraDoConfronto.veiculos).toBe(2);
  });

  it("o líquido fecha com a soma das diferenças dos conciliados", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: [
        ...remunerado("AAA0A11", 5000),
        ...remunerado("BBB0B22", 3000),
        ...remunerado("CCC0C33", 1000),
      ],
      realizado: [real("AAA0A11", 4200), real("BBB0B22", 3300), real("CCC0C33", 1000)],
    });

    const somaDasDiferencas = c.linhas
      .filter((l) => l.cobertura === "COMPLETA")
      .reduce((a, l) => a + (l.diferenca ?? 0), 0);

    expect(Number(somaDasDiferencas.toFixed(2))).toBe(c.resumo.saldoDosConciliados);
    expect(c.resumo.saldoDosConciliados).toBe(500);
    expect(c.resumo.veiculosComSobra).toBe(1);
    expect(c.resumo.veiculosComDeficit).toBe(1);
    expect(c.resumo.veiculosEmEquilibrio).toBe(1);
  });

  it("a cobertura é dita em números — o '98 de 104' da tela", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: [...remunerado("AAA0A11", 5000), ...remunerado("BBB0B22", 3000)],
      realizado: [real("AAA0A11", 4200), real("CCC0C33", 900)],
    });
    expect(c.resumo.cobertura).toEqual({
      total: 3,
      conciliados: 1,
      semRealizado: 1,
      semRemunerado: 1,
      naoConciliados: 0,
      /* O denominador do "X de Y" são os **remunerados** — dois aqui —, e não as
         três linhas da tabela: a terceira só existe no razão. */
      fracaoDosRemunerados: 0.5,
    });
    expect(c.resumo.veiculosRemunerados).toBe(2);
  });

  /*
    Tipos diferentes não se confrontam — "cavalo + carreta remunerados contra
    apenas o cavalo realizado" é exatamente o que isto impede.
  */
  it("a mesma placa em tipos de ativo diferentes não concilia", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("AAA0A11", 5000, "CAVALO"),
      realizado: [real("AAA0A11", 4000, "CARRETA")],
    });
    /* Duas identidades de ativo, duas linhas — e nenhuma delas conciliada. O
       cavalo remunerado diz *por que* não achou par; a carreta realizada fica
       sem remunerado, que é o que ela de fato é. */
    const cavalo = c.linhas.find((l) => l.entityType === "CAVALO")!;
    const carreta = c.linhas.find((l) => l.entityType === "CARRETA")!;

    expect(cavalo.cobertura).toBe("NAO_CONCILIADO");
    expect(cavalo.diferenca).toBeNull();
    expect(cavalo.motivo).toContain("Tipos de ativo diferentes");
    expect(carreta.cobertura).toBe("SEM_REMUNERADO");

    expect(c.resumo.saldoDosConciliados).toBe(0);
    expect(c.resumo.veiculosConciliados).toBe(0);
  });

  it("duplicata no realizado não é somada — é dita", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("DUPL0A1", 5000),
      realizado: [real("DUPL0A1", 2000), real("DUPL0A1", 2000)],
    });
    const linha = linhaDe(c, "DUPL0A1");
    expect(linha.cobertura).toBe("NAO_CONCILIADO");
    expect(linha.realizado).not.toBe(4000);
    expect(linha.motivo).toContain("mais de um lançamento");
    expect(c.resumo.totalRealizado).toBe(0);
  });

  it("o remunerado que a consolidação recusou não vira lado de comparação", () => {
    const divergente: RemuneradoDaCompetencia[] = consolidar(
      [parcela("2026-09-01", "DIVERG1", 4000), parcela("2026-09-16", "DIVERG1", 4500)],
      ["2026-09-01", "2026-09-16"],
    );
    const c = confrontar({
      competencia: "2026-09",
      remunerado: divergente,
      realizado: [real("DIVERG1", 4200)],
    });
    const linha = linhaDe(c, "DIVERG1");
    expect(linha.cobertura).toBe("NAO_CONCILIADO");
    expect(linha.diferenca).toBeNull();
    expect(linha.situacaoDoRemunerado).toBe("DIVERGENCIA_INTRAMENSAL");
    expect(c.resumo.saldoDosConciliados).toBe(0);
  });

  it("um mês realizado não é confrontado com o realizado de outro mês", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("AAA0A11", 5000),
      realizado: [real("AAA0A11", 4000, "CAVALO", "2026-08")],
    });
    expect(linhaDe(c, "AAA0A11").cobertura).toBe("SEM_REALIZADO");
    expect(c.resumo.totalRealizado).toBe(0);
  });

  it("não há contaminação: o confronto nunca compara realizado com realizado", () => {
    const c = confrontar({
      competencia: "2026-09",
      remunerado: remunerado("AAA0A11", 5000),
      realizado: [real("AAA0A11", 4000)],
    });
    const linha = linhaDe(c, "AAA0A11");
    /* Um lado veio do consolidado remunerado, o outro da fonte realizada, e a
       diferença é entre os dois — nunca entre dois valores da mesma natureza. */
    expect(linha.remunerado).toBe(5000);
    expect(linha.realizado).toBe(4000);
    expect(linha.diferenca).toBe(linha.remunerado! - linha.realizado!);
  });
});

// ---------------------------------------------------------------------------
// O sinal contábil e a porta do realizado
// ---------------------------------------------------------------------------

describe("o sinal do realizado", () => {
  it("a convenção é declarada, e custo negativo vira custo positivo para leitura", () => {
    expect(normalizarSinal(-4200, "CUSTO_NEGATIVO")).toBe(4200);
    expect(normalizarSinal(-4200, "CUSTO_POSITIVO")).toBe(-4200);
    expect(normalizarSinal(4200, "CUSTO_POSITIVO")).toBe(4200);
  });

  /*
    Troca de sinal, e não módulo: sob convenção contábil, um valor positivo na
    origem é estorno — dinheiro que voltou —, e tem de chegar como custo
    negativo. `Math.abs` o transformaria em custo.
  */
  it("o estorno sobrevive à normalização", () => {
    expect(normalizarSinal(500, "CUSTO_NEGATIVO")).toBe(-500);
  });

  it("ausência atravessa a normalização como ausência", () => {
    expect(normalizarSinal(null, "CUSTO_NEGATIVO")).toBeNull();
    expect(normalizarSinal(Number.NaN, "CUSTO_POSITIVO")).toBeNull();
  });

  it("sem fonte conectada, a resposta é indisponibilidade — nunca lista vazia", async () => {
    const escopo = { scopeHash: null, entityTypes: ["CAVALO", "CARRETA"] };
    const competencias = await SEM_FONTE_DO_REALIZADO.competenciasDisponiveis(escopo);
    const valores = await SEM_FONTE_DO_REALIZADO.valoresDaCompetencia(escopo, "2026-09");

    expect(competencias).toHaveProperty("indisponivel");
    expect(valores).toHaveProperty("indisponivel");
    expect("competencias" in competencias).toBe(false);
    if ("indisponivel" in competencias) {
      expect(competencias.indisponivel.motivo).toBe("SEM_FONTE");
      expect(competencias.indisponivel.oQueFalta).toContain("trecho");
    }
  });
});
