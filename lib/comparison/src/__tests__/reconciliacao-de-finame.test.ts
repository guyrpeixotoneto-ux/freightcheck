import { describe, expect, it } from "vitest";
import { linhasDeFiname, type AlteracaoDoMotor, type ValorDaPonta } from "../finame";
import { reconciliarFiname, type ChaveDoDegrau } from "../reconciliacao-de-finame";

/**
 * O que estes testes prendem.
 *
 * Um só: **a escada fecha**. Saldo da base, mais os movimentos, é o saldo da
 * comparada — e o degrau do cartão é o mesmo número que o cartão publica.
 *
 * Os casos foram escolhidos pelo que quebraria a promessa sem ninguém ver: a
 * quitação em que parte da parcela vira rubrica de outro módulo (o acervo de
 * hoje), a placa em que amortização e juros se compensam e a parcela não se
 * move (que o acervo não tem e nada impedia de chegar), e a composição que não
 * fecha. Nos três a soma dos degraus tem de continuar dando o saldo final, e
 * nenhum real pode ficar fora de uma linha com nome.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "cavalo.finame_cavalo",
  entityLabel: "ABC1D23",
  entityType: "CAVALO",
  valueBefore: "10000",
  valueAfter: "9000",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "-1000",
  deltaPercent: "-10",
  comparability: "COMPARABLE",
  impactAmount: "-1000",
  impactConfidence: "CALCULATED",
  impactPeriodicity: "MENSAL",
  ...over,
});

const valor = (
  ponta: "BASE" | "COMPARADA",
  entityId: string,
  valorNumerico: number | null,
  entityType = "CAVALO",
): ValorDaPonta => ({
  ponta,
  entityType,
  entityId,
  entityLabel: entityId,
  attributeCode: entityType === "CAVALO" ? "cavalo.finame_cavalo" : "carreta.finame_implemento",
  valor: valorNumerico,
});

const degrau = (r: ReturnType<typeof reconciliarFiname>, chave: ChaveDoDegrau, balde = "MENSAL") =>
  r.periodicidades.find((p) => p.periodicidade === balde)!.degraus.find((d) => d.chave === chave)!;

/** A conta que a tela promete: nível de cima + movimentos = nível de baixo. */
function escadaFecha(r: ReturnType<typeof reconciliarFiname>, balde = "MENSAL"): number {
  const p = r.periodicidades.find((x) => x.periodicidade === balde)!;
  const movimentos = p.degraus
    .filter((d) => d.tipo === "MOVIMENTO" && d.chave !== "ENTRADAS" && d.chave !== "SAIDAS")
    .reduce((s, d) => s + d.valor, 0);
  const frota = p.degraus
    .filter((d) => d.chave === "ENTRADAS" || d.chave === "SAIDAS")
    .reduce((s, d) => s + d.valor, 0);
  const base = p.degraus.find((d) => d.chave === "SALDO_BASE")!.valor;
  const comparada = p.degraus.find((d) => d.chave === "SALDO_COMPARADA")!.valor;
  return Number((base + movimentos + frota - comparada).toFixed(2));
}

describe("a escada de uma comparação comum", () => {
  const linhas = linhasDeFiname([
    alteracao({ entityLabel: "AAA1A11", valueBefore: "3318.01", valueAfter: "4096.31", deltaAbsolute: "778.3", impactAmount: "778.3" }),
  ]);
  const valores = [
    valor("BASE", "AAA1A11", 3318.01),
    valor("COMPARADA", "AAA1A11", 4096.31),
    valor("BASE", "BBB2B22", 5000),
    valor("COMPARADA", "BBB2B22", 5000),
  ];

  it("fecha do saldo da base ao da comparada", () => {
    expect(escadaFecha(reconciliarFiname(linhas, valores))).toBe(0);
  });

  it("publica no degrau do cartão o mesmo número do cartão", () => {
    const r = reconciliarFiname(linhas, valores);
    expect(degrau(r, "ALTERADO_COMPARADOS").valor).toBe(778.3);
    expect(degrau(r, "SALDO_BASE").valor).toBe(8318.01);
    expect(degrau(r, "SALDO_COMPARADA").valor).toBe(9096.31);
    expect(r.periodicidades[0].fecha).toBe(true);
  });

  it("abre cada degrau até a placa e as duas vigências", () => {
    const d = degrau(reconciliarFiname(linhas, valores), "ALTERADO_COMPARADOS");
    expect(d.itens).toEqual([
      expect.objectContaining({
        placa: "AAA1A11",
        entityType: "CAVALO",
        variavel: "parcela",
        base: 3318.01,
        comparada: 4096.31,
        valor: 778.3,
      }),
    ]);
  });
});

describe("a quitação — a parcela que vira rubrica de outro módulo", () => {
  /* O caso da QYP3G72 no acervo: amortização e juros zeram, a parcela cai
     menos do que eles, e a diferença aparece como lucro fixo. */
  const linhas = linhasDeFiname([
    alteracao({ attributeCode: "cavalo.amortizacao_cavalo", valueBefore: "7700.16", valueAfter: "0", deltaAbsolute: "-7700.16", impactAmount: "-7700.16" }),
    alteracao({ attributeCode: "cavalo.juros_finame_cavalo", valueBefore: "2147.19", valueAfter: "0", deltaAbsolute: "-2147.19", impactAmount: "-2147.19" }),
    alteracao({ attributeCode: "cavalo.finame_cavalo", valueBefore: "9847.35", valueAfter: "4677.85", deltaAbsolute: "-5169.5", impactAmount: "-5169.5" }),
    alteracao({ attributeCode: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo", valueBefore: "0", valueAfter: "4677.85", deltaAbsolute: "4677.85", impactAmount: "4677.85" }),
  ]);
  const valores = [valor("BASE", "ABC1D23", 9847.35), valor("COMPARADA", "ABC1D23", 4677.85)];

  it("põe o que saiu do módulo numa linha com nome, e fecha", () => {
    const r = reconciliarFiname(linhas, valores);
    expect(degrau(r, "ALTERADO_COMPARADOS").valor).toBe(-9847.35);
    expect(degrau(r, "RECLASSIFICADO").valor).toBe(4677.85);
    expect(degrau(r, "FROTA_EXISTENTE").valor).toBe(-5169.5);
    expect(degrau(r, "NAO_EXPLICADO").valor).toBe(0);
    expect(escadaFecha(r)).toBe(0);
  });

  it("nomeia, na abertura, para qual módulo o dinheiro foi", () => {
    const d = degrau(reconciliarFiname(linhas, valores), "RECLASSIFICADO");
    expect(d.itens).toHaveLength(1);
    expect(d.itens[0].rubrica).toBe("Lucro fixo do cavalo");
    expect(d.itens[0].valor).toBe(4677.85);
    expect(d.itens[0].nota).toContain("Lucro Fixo");
  });
});

describe("as partes que se compensam — o caso que o acervo ainda não tem", () => {
  /* Amortização sobe, juros descem no mesmo valor: o cartão soma zero líquido
     nas duas linhas, a parcela não se move, e sem um degrau próprio esse
     dinheiro entraria no cartão e sumiria da escada. */
  const linhas = linhasDeFiname([
    alteracao({ attributeCode: "cavalo.amortizacao_cavalo", valueBefore: "5000", valueAfter: "5600", deltaAbsolute: "600", impactAmount: "600" }),
    alteracao({ attributeCode: "cavalo.juros_finame_cavalo", valueBefore: "2000", valueAfter: "1400", deltaAbsolute: "-600", impactAmount: "-600" }),
  ]);
  const valores = [valor("BASE", "ABC1D23", 7000), valor("COMPARADA", "ABC1D23", 7000)];

  it("mantém a escada fechada com o movimento fora do saldo nomeado", () => {
    const r = reconciliarFiname(linhas, valores);
    expect(degrau(r, "ALTERADO_COMPARADOS").valor).toBe(0);
    expect(degrau(r, "FORA_DA_PARCELA").itens).toHaveLength(2);
    expect(degrau(r, "FROTA_EXISTENTE").valor).toBe(0);
    expect(escadaFecha(r)).toBe(0);
  });

  it("não deixa o movimento invisível quando ele não se compensa", () => {
    const soUmaParte = linhasDeFiname([
      alteracao({ attributeCode: "cavalo.amortizacao_cavalo", valueBefore: "5000", valueAfter: "5600", deltaAbsolute: "600", impactAmount: "600" }),
    ]);
    const r = reconciliarFiname(soUmaParte, valores);
    /* O cartão soma +600 e o saldo não se move: sem a linha, 600 reais
       ficariam sem destino entre os dois blocos. */
    expect(degrau(r, "ALTERADO_COMPARADOS").valor).toBe(600);
    expect(degrau(r, "FORA_DA_PARCELA").valor).toBe(-600);
    expect(degrau(r, "NAO_EXPLICADO").valor).toBe(0);
    expect(escadaFecha(r)).toBe(0);
  });
});

describe("entradas e saídas de frota", () => {
  const valores = [
    valor("BASE", "SAI1S11", 4000),
    valor("COMPARADA", "ENT1E11", 6000),
    valor("BASE", "FIC1F11", 1000),
    valor("COMPARADA", "FIC1F11", 1000),
  ];

  it("escreve a saída negativa — um sinal só nos dois blocos", () => {
    const r = reconciliarFiname([], valores);
    expect(degrau(r, "ENTRADAS").valor).toBe(6000);
    expect(degrau(r, "SAIDAS").valor).toBe(-4000);
    expect(degrau(r, "SALDO_BASE").valor).toBe(5000);
    expect(degrau(r, "SALDO_COMPARADA").valor).toBe(7000);
    expect(escadaFecha(r)).toBe(0);
  });

  it("abre entrada e saída até a placa", () => {
    const r = reconciliarFiname([], valores);
    expect(degrau(r, "ENTRADAS").itens[0]).toMatchObject({ placa: "ENT1E11", base: null, comparada: 6000 });
    expect(degrau(r, "SAIDAS").itens[0]).toMatchObject({ placa: "SAI1S11", comparada: null, valor: -4000 });
  });
});

describe("as periodicidades não se somam", () => {
  const linhas = linhasDeFiname([
    alteracao({ attributeCode: "cavalo.finame_cavalo", valueBefore: "1000", valueAfter: "1200", deltaAbsolute: "200", impactAmount: "200" }),
    alteracao({
      attributeCode: "cavalo.valor_pis_cofins",
      valueBefore: "500",
      valueAfter: "800",
      deltaAbsolute: "300",
      impactAmount: "300",
      impactPeriodicity: "PONTUAL",
    }),
  ]);
  const valores = [valor("BASE", "ABC1D23", 1000), valor("COMPARADA", "ABC1D23", 1200)];

  it("dá uma escada a cada balde, e saldo só ao da parcela", () => {
    const r = reconciliarFiname(linhas, valores);
    expect(r.periodicidades.map((p) => p.periodicidade)).toEqual(["MENSAL", "PONTUAL"]);
    expect(r.periodicidades[0].temSaldo).toBe(true);
    expect(r.periodicidades[1].temSaldo).toBe(false);
    expect(degrau(r, "ALTERADO_COMPARADOS", "MENSAL").valor).toBe(200);
    /* PIS/COFINS da compra é do módulo Impostos: não entra no cartão, e a
       escada da aquisição diz para onde ele foi em vez de o engolir. */
    expect(degrau(r, "ALTERADO_COMPARADOS", "PONTUAL").valor).toBe(0);
    expect(degrau(r, "RECLASSIFICADO", "PONTUAL").valor).toBe(300);
    expect(escadaFecha(r, "MENSAL")).toBe(0);
  });
});

describe("o que não é dinheiro", () => {
  it("conta a alteração sem efeito financeiro, nunca a soma", () => {
    const linhas = linhasDeFiname([
      alteracao({
        attributeCode: "cavalo.data_fim_contrato",
        nature: "DATE",
        valueBefore: "2028-07-01",
        valueAfter: "2026-02-01",
        deltaAbsolute: null,
        deltaPercent: null,
        impactAmount: null,
        impactConfidence: "NOT_APPLICABLE",
        impactPeriodicity: null,
      }),
    ]);
    const r = reconciliarFiname(linhas, [valor("BASE", "ABC1D23", 100), valor("COMPARADA", "ABC1D23", 100)]);
    expect(r.periodicidades[0].semEfeitoFinanceiro).toBe(1);
    expect(degrau(r, "ALTERADO_COMPARADOS").valor).toBe(0);
    expect(escadaFecha(r)).toBe(0);
  });
});
