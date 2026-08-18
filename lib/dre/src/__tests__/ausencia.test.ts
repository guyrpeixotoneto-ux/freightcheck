import { describe, expect, it } from "vitest";
import { montarDRE, linha, subtotal } from "../motor";
import { consolidar } from "../consolidado";
import { componentesDoEscopo } from "../plano";
import { conjuntoDeReferencia, lado } from "./fixtures";

/**
 * Dados ausentes (§4, §22, §23, §31).
 *
 * O princípio inteiro do módulo cabe numa asserção: **`null` nunca vira `0`.**
 * Um custo ausente que virasse zero produziria um resultado maior do que o real
 * e uma frota que parece lucrativa — o erro mais fácil de cometer e o mais caro
 * de descobrir.
 */

const VIGENCIA = { effectiveDate: "2026-08-01", periodLabel: "Agosto/2026" };

function dreDoConjunto() {
  const { cavalo, carreta } = conjuntoDeReferencia();
  return montarDRE({ escopo: "CONJUNTO", ...VIGENCIA, lados: [cavalo, carreta] });
}

describe("ausência não é zero", () => {
  it("deixa a linha nula e não a soma", () => {
    const dre = dreDoConjunto();
    const diesel = linha(dre, "variavel.diesel")!;

    expect(diesel.valor).toBeNull();
    expect(diesel.contribuicao).toBeNull();
    expect(diesel.natureza).toBe("NAO_DISPONIVEL");
    expect(diesel.percentualDaReceita).toBeNull();
  });

  it("nomeia o motivo e o que destravaria, em toda linha ausente", () => {
    const dre = dreDoConjunto();
    const ausentes = dre.secoes.flatMap((s) => s.linhas).filter((l) => l.valor === null);

    expect(ausentes.length).toBeGreaterThan(0);
    for (const l of ausentes) {
      expect(l.ausencia, `${l.code} sem motivo`).not.toBeNull();
      expect(l.ausencia!.rotulo.length, `${l.code} sem rótulo`).toBeGreaterThan(0);
      expect(l.ausencia!.oQueFalta.length, `${l.code} sem instrução`).toBeGreaterThan(20);
    }
  });

  it("distingue coluna que não existe de coluna que existe e não tem dado", () => {
    const dre = dreDoConjunto();
    expect(linha(dre, "variavel.arla")!.ausencia!.motivo).toBe("SEM_COLUNA_NA_FONTE");
    expect(linha(dre, "variavel.pneus")!.ausencia!.motivo).toBe("COLUNA_SEM_DADO");
    expect(linha(dre, "variavel.manutencao")!.ausencia!.motivo).toBe("BASE_OPERACIONAL_AUSENTE");
    expect(linha(dre, "fixo.seguro")!.ausencia!.motivo).toBe("SEMANTICA_NAO_CONFIRMADA");
    expect(linha(dre, "deducoes.pis_cofins")!.ausencia!.motivo).toBe("GRANDEZA_DE_AQUISICAO");
  });

  it("prefere o motivo declarado no plano ao genérico do motor", () => {
    /*
      O aluguel de implemento tem fonte declarada, e um implemento financiado
      simplesmente não tem aluguel no mês. O motor genérico diria "nenhum dos
      atributos declarados tem valor apurável" — verdadeiro e mudo. O plano
      declara a frase que explica, e é ela que a linha usa.

      Até 18/08/2026 este era o caso do portão da semântica: a coluna existia,
      tinha valor, e ninguém tinha confirmado a periodicidade. A confirmação
      chegou e a frase mudou junto — o que o teste guarda é a precedência, que
      não mudou.
    */
    const semAluguel = montarDRE({
      escopo: "CARRETA",
      ...VIGENCIA,
      lados: [lado("CARRETA", "XYZ9W87", { "carreta.finame_implemento": 2500 })],
    });
    const aluguel = linha(semAluguel, "fixo.aluguel_implemento")!;
    expect(aluguel.valor).toBeNull();
    expect(aluguel.ausencia!.motivo).toBe("COLUNA_SEM_DADO");
    // A frase do plano, e não a do motor: esta é a que diz por que falta.
    expect(aluguel.ausencia!.oQueFalta).toContain("não tem aluguel nesta vigência");
    expect(aluguel.ausencia!.oQueFalta).not.toContain("Nenhum dos atributos declarados");
  });

  it("cai no motivo genérico quando o plano não declarou nenhum", () => {
    /* A amortização tem fonte e nenhuma `ausencia` declarada: um ativo sem ela
       é um ativo sem ela, e a frase nomeia os atributos que faltaram. */
    const semAmortizacao = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [lado("CAVALO", "SEM0A00", { "cavalo.finame_cavalo": 14000 })],
    });
    const amortizacao = linha(semAmortizacao, "financeiro.amortizacao")!;
    expect(amortizacao.valor).toBeNull();
    expect(amortizacao.ausencia!.motivo).toBe("COLUNA_SEM_DADO");
    expect(amortizacao.ausencia!.oQueFalta).toContain("cavalo.amortizacao_cavalo");
  });
});

describe("cobertura", () => {
  it("é uma razão medida, e nunca uma constante", () => {
    const dre = dreDoConjunto();
    const { cobertura } = dre;

    expect(cobertura.aplicaveis).toBe(componentesDoEscopo("CONJUNTO").length);
    expect(cobertura.apurados).toBeGreaterThan(0);
    expect(cobertura.apurados).toBeLessThan(cobertura.aplicaveis);
    expect(cobertura.percentual).toBeCloseTo((cobertura.apurados / cobertura.aplicaveis) * 100, 1);
  });

  it("lista um item por componente, com o motivo quando falta", () => {
    const { cobertura } = dreDoConjunto();
    expect(cobertura.itens).toHaveLength(cobertura.aplicaveis);
    for (const item of cobertura.itens) {
      if (item.apurado) expect(item.motivo).toBeNull();
      else expect(item.motivo).not.toBeNull();
    }
  });

  it("mede a cobertura dos essenciais separadamente", () => {
    const { cobertura } = dreDoConjunto();
    expect(cobertura.essenciaisAplicaveis).toBeGreaterThan(0);
    /* Diesel, arla, pneus, manutenção e motorista são essenciais e faltam
       todos: nenhum caminho leva a 100% com o export de hoje. */
    expect(cobertura.percentualEssencial).toBeLessThan(100);
  });

  it("explica por que não é ponderada por valor", () => {
    expect(dreDoConjunto().cobertura.metodo).toMatch(/ponderar por valor/i);
  });
});

describe("estado da apuração", () => {
  it("é INCONCLUSIVA sem receita", () => {
    const dre = montarDRE({ escopo: "CAVALO", ...VIGENCIA, lados: [lado("CAVALO", "S0S0S00", {})] });
    expect(dre.estado).toBe("INCONCLUSIVA");
    expect(subtotal(dre, "RECEITA_BRUTA").valor).toBeNull();
  });

  it("é PARCIALMENTE_APURADA com receita e lacunas", () => {
    expect(dreDoConjunto().estado).toBe("PARCIALMENTE_APURADA");
  });
});

describe("aguardando curadoria", () => {
  it("separa o que existe e falta confirmar do que não existe", () => {
    const dre = dreDoConjunto();
    const codigos = dre.aguardandoCuradoria.map((a) => a.code);
    expect(codigos).toContain("fixo.seguro");
    expect(codigos).toContain("receita.remuneracao_variavel");
    expect(codigos).not.toContain("variavel.arla");
  });

  it("o aluguel saiu da fila da curadoria quando a periodicidade foi confirmada", () => {
    /*
      Este teste afirmava o contrário, e estava certo enquanto
      `carreta.custo_aluguel` não tinha semântica confirmada: era a única linha
      desta DRE que uma confirmação de curadoria destravava sozinha.

      Em 18/08/2026 a confirmação veio — por base aritmética, não por leitura de
      nome: finameImplemento = amortização + juros + aluguel em 369 de 369
      linhas não nulas, e finameImplemento é MENSAL. A linha saiu da fila, e é
      isso que este teste passa a guardar: uma pendência resolvida tem de sumir
      da lista de pendências, senão a fila nunca encolhe.
    */
    const semAluguel = montarDRE({
      escopo: "CARRETA",
      ...VIGENCIA,
      lados: [lado("CARRETA", "XYZ9W87", { "carreta.finame_implemento": 2500 })],
    });
    expect(semAluguel.aguardandoCuradoria.map((a) => a.code)).not.toContain(
      "fixo.aluguel_implemento",
    );

    // E com valor, ela apura — o que a fila esperava que acontecesse.
    const comAluguel = montarDRE({
      escopo: "CARRETA",
      ...VIGENCIA,
      lados: [lado("CARRETA", "XYZ9W87", { "carreta.custo_aluguel": 6414.37 })],
    });
    expect(linha(comAluguel, "fixo.aluguel_implemento")!.valor).toBeCloseTo(6414.37, 2);
  });
});

describe("na consolidação", () => {
  it("uma linha ausente em todos continua ausente na frota", () => {
    const { cavalo, carreta } = conjuntoDeReferencia();
    const um = montarDRE({ escopo: "CONJUNTO", ...VIGENCIA, lados: [cavalo, carreta] });
    const frota = consolidar([um, um], "CONJUNTO", VIGENCIA);

    const diesel = frota.secoes.flatMap((s) => s.linhas).find((l) => l.code === "variavel.diesel")!;
    expect(diesel.valor).toBeNull();
    expect(diesel.ausencia).not.toBeNull();
  });

  it("uma linha presente em um só ativo soma só o que existe", () => {
    const comIpva = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [
        lado(
          "CAVALO",
          "COM0I00",
          { "cavalo.finame_cavalo": 1000, "cavalo.ipva_licenciamento": 12000 },
          { "cavalo.ipva_licenciamento": { periodicity: "ANUAL" } },
        ),
      ],
    });
    const semIpva = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [lado("CAVALO", "SEM0I00", { "cavalo.finame_cavalo": 1000 })],
    });

    const frota = consolidar([comIpva, semIpva], "CAVALO", VIGENCIA);
    const ipva = frota.secoes.flatMap((s) => s.linhas).find((l) => l.code === "fixo.ipva_licenciamento")!;

    /* 1.000, e não 2.000: o segundo cavalo não tem IPVA, e não tem IPVA zero. */
    expect(ipva.valor).toBe(1000);
  });
});
