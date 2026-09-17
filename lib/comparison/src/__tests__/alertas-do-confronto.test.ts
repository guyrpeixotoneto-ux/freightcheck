/**
 * OS DOIS ALERTAS — e, sobretudo, quando eles ficam calados.
 *
 * Os dois nasceram de duas placas reais de setembro/2026, e nenhuma das duas
 * está escrita no código. O que estes testes prendem é a **regra**: que ela
 * dispara no padrão que as duas placas têm e que ela **não** dispara nos vizinhos
 * que se parecem com elas. A segunda metade é a que decide se alguém vai
 * continuar lendo os alertas daqui a três meses — um painel que acusa coerência
 * deixa de ser lido.
 *
 * Ver `docs/DEFINICOES-DO-CONFRONTO-DE-FINAME.md`.
 */

import { describe, expect, it } from "vitest";
import { alertasDoConfronto, type DuplicataRetida } from "../alertas-do-confronto";
import type { RemuneradoDaCompetencia } from "../competencia-de-finame";
import type { ValorRealizado } from "../realizado-de-finame";
import {
  confrontar,
  situacaoDoFinanciamentoDe,
  type EvidenciaDoRemunerado,
} from "../confronto-de-finame";

const COMPETENCIA = "2026-09";

const rem = (entityLabel: string, valor: number): RemuneradoDaCompetencia => ({
  competencia: COMPETENCIA,
  entityLabel,
  entityType: "CAVALO",
  valor,
  situacao: "CONSOLIDADO",
  vigencias: ["2026-09-01"],
  valoresDivergentes: [],
});

const real = (entityLabel: string, valor: number): ValorRealizado => ({
  competencia: COMPETENCIA,
  entityLabel,
  entityType: "CAVALO",
  valor,
  bruto: -valor,
});

const ev = (
  entityLabel: string,
  statusDeclarado: string | null,
  partes: { amortizacao?: number; juros?: number; terceiraParcela?: number } = {},
): EvidenciaDoRemunerado => ({
  entityLabel,
  entityType: "CAVALO",
  situacaoDoFinanciamento: situacaoDoFinanciamentoDe(statusDeclarado),
  statusDeclarado,
  amortizacao: partes.amortizacao ?? null,
  juros: partes.juros ?? null,
  terceiraParcela: partes.terceiraParcela ?? null,
});

function alertar(entrada: {
  remunerado: RemuneradoDaCompetencia[];
  realizado: ValorRealizado[];
  evidenciaDoRemunerado?: EvidenciaDoRemunerado[];
  duplicatasRetidas?: DuplicataRetida[];
}) {
  const confronto = confrontar({
    competencia: COMPETENCIA,
    remunerado: entrada.remunerado,
    realizado: entrada.realizado,
    evidenciaDoRemunerado: entrada.evidenciaDoRemunerado,
  });
  return alertasDoConfronto({
    confronto,
    evidenciaDoRemunerado: entrada.evidenciaDoRemunerado,
    duplicatasRetidas: entrada.duplicatasRetidas,
  });
}

describe("QUITADO_COM_REALIZADO_RECORRENTE", () => {
  /*
    O caso real: QYP0I48 em setembro/2026. Quitada em 01/02/2026, amortização e
    juros zerados, remunerado R$ 4.103,53 — dos quais R$ 3.323,86 de lucro fixo,
    que não fecha a identidade por R$ 779,67 — e o razão lançando R$ 9.958,86
    todo mês desde janeiro.
  */
  const quitadaComRazaoAtivo = {
    remunerado: [rem("QYP0I48", 4103.53)],
    realizado: [real("QYP0I48", 9958.86)],
    evidenciaDoRemunerado: [
      ev("QYP0I48", "Descrição: QUITADO", {
        amortizacao: 0,
        juros: 0,
        terceiraParcela: 3323.86,
      }),
    ],
  };

  it("dispara quando a base diz quitado e o razão continua lançando", () => {
    const alertas = alertar(quitadaComRazaoAtivo);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].tipo).toBe("QUITADO_COM_REALIZADO_RECORRENTE");
    expect(alertas[0].entityLabel).toBe("QYP0I48");
  });

  it("diz que a diferença desta linha não é déficit de remuneração", () => {
    const [alerta] = alertar(quitadaComRazaoAtivo);
    expect(alerta.porque).toContain("não é déficit de remuneração");
    /* A linha continua classificada DEFICIT — o alerta não reescreve o
       resultado, ele explica por que aquele resultado não responde à pergunta. */
    const confronto = confrontar({
      competencia: COMPETENCIA,
      remunerado: quitadaComRazaoAtivo.remunerado,
      realizado: quitadaComRazaoAtivo.realizado,
      evidenciaDoRemunerado: quitadaComRazaoAtivo.evidenciaDoRemunerado,
    });
    expect(confronto.linhas[0].resultado).toBe("DEFICIT");
  });

  it("acusa a composição inconsistente com os dois números, quando ela não fecha", () => {
    const [alerta] = alertar(quitadaComRazaoAtivo);
    expect(alerta.titulo).toContain("composição remunerada inconsistente");
    const rotulos = alerta.evidencia.map((e) => e.rotulo);
    expect(rotulos).toContain("Soma das parcelas remuneradas");
    expect(rotulos).toContain("Diferença não explicada");
    const diferenca = alerta.evidencia.find((e) => e.rotulo === "Diferença não explicada");
    /* 4.103,53 − (0 + 0 + 3.323,86) = 779,67 — o buraco medido na planilha real. */
    expect(diferenca?.valor).toContain("779,67");
  });

  it("não acusa composição quando a identidade fecha — o alerta fica só no razão", () => {
    const [alerta] = alertar({
      remunerado: [rem("QUIT0001", 3323.86)],
      realizado: [real("QUIT0001", 9958.86)],
      evidenciaDoRemunerado: [
        ev("QUIT0001", "Descrição: QUITADO", {
          amortizacao: 0,
          juros: 0,
          terceiraParcela: 3323.86,
        }),
      ],
    });
    expect(alerta.tipo).toBe("QUITADO_COM_REALIZADO_RECORRENTE");
    expect(alerta.titulo).not.toContain("composição");
    expect(alerta.evidencia.map((e) => e.rotulo)).not.toContain("Diferença não explicada");
  });

  it("fica calado no quitado **sem** lançamento no razão — que é o caso coerente", () => {
    const alertas = alertar({
      remunerado: [rem("QYP3G72", 4677.85)],
      realizado: [],
      evidenciaDoRemunerado: [
        ev("QYP3G72", "Descrição: QUITADO", { amortizacao: 0, juros: 0, terceiraParcela: 4677.85 }),
      ],
    });
    expect(alertas).toHaveLength(0);
  });

  it("fica calado no financiado com lançamento — o déficit dele é déficit de verdade", () => {
    const alertas = alertar({
      remunerado: [rem("RPG0C44", 16769.83)],
      realizado: [real("RPG0C44", 25085.47)],
      evidenciaDoRemunerado: [
        ev("RPG0C44", "Descrição: FINANCIADO", { amortizacao: 10000, juros: 6769.83 }),
      ],
    });
    expect(alertas).toHaveLength(0);
  });

  it("fica calado quando o status diz quitado e a parcela ainda é financiamento", () => {
    /* Aqui o problema é o status, não o confronto — e acusar a linha mandaria
       procurar no lugar errado. */
    const alertas = alertar({
      remunerado: [rem("STATUS01", 16769.83)],
      realizado: [real("STATUS01", 25085.47)],
      evidenciaDoRemunerado: [
        ev("STATUS01", "Descrição: QUITADO", { amortizacao: 10000, juros: 6769.83 }),
      ],
    });
    expect(alertas).toHaveLength(0);
  });
});

describe("SOBRA_COM_DUPLICATA_RETIDA", () => {
  /*
    O caso real: RZG5A37 em setembro/2026. Remunerado R$ 13.873,44 contra um
    realizado de R$ 4.147,88 que é **uma** das duas cópias idênticas retidas —
    sobra de R$ 9.725,56 (+234,5%). Somando a cópia, o realizado vai a
    R$ 8.295,76 e a sobra cai para R$ 5.577,68 (+67,2%).
  */
  const sobraComCopiaRetida = {
    remunerado: [rem("RZG5A37", 13873.44)],
    realizado: [real("RZG5A37", 4147.88)],
    duplicatasRetidas: [{ competencia: COMPETENCIA, placa: "RZG5A37", valor: 4147.875 }],
  };

  it("dispara na sobra que tem cópia retida na mesma competência", () => {
    const alertas = alertar(sobraComCopiaRetida);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].tipo).toBe("SOBRA_COM_DUPLICATA_RETIDA");
  });

  it("mostra os dois cenários lado a lado, com os números da planilha real", () => {
    const [alerta] = alertar(sobraComCopiaRetida);
    const porRotulo = new Map(alerta.evidencia.map((e) => [e.rotulo, e.valor]));

    expect(porRotulo.get("Realizado usado (uma cópia)")).toContain("4.147,88");
    expect(porRotulo.get("Realizado se forem dois pagamentos")).toContain("8.295,76");
    expect(porRotulo.get("Sobra como está")).toContain("9.725,56");
    expect(porRotulo.get("Sobra como está")).toContain("+234,5%");
    expect(porRotulo.get("Sobra se forem dois pagamentos")).toContain("5.577,68");
    expect(porRotulo.get("Sobra se forem dois pagamentos")).toContain("+67,2%");
  });

  it("afirma que o sinal sobrevive à dúvida quando ele sobrevive", () => {
    const [alerta] = alertar(sobraComCopiaRetida);
    expect(alerta.titulo).toContain("percentual influenciado");
    expect(alerta.porque).toContain("o sinal se mantém nos dois cenários");
  });

  it("muda o texto quando a decisão **apaga** a sobra", () => {
    const [alerta] = alertar({
      remunerado: [rem("VIRAZERO", 5000)],
      realizado: [real("VIRAZERO", 4000)],
      duplicatasRetidas: [{ competencia: COMPETENCIA, placa: "VIRAZERO", valor: 4000 }],
    });
    /* 5.000 − 8.000 = −3.000: somando a cópia, a sobra vira déficit. Dizer "o
       sinal se mantém" aqui seria falso, e é a diferença entre um alerta e um
       texto decorativo. */
    expect(alerta.titulo).toContain("depende da decisão");
    expect(alerta.porque).toContain("deixa de ser sobra");
  });

  it("fica calado no déficit com duplicata — somar a cópia só o aprofunda", () => {
    const alertas = alertar({
      remunerado: [rem("DEFDUP01", 4000)],
      realizado: [real("DEFDUP01", 5000)],
      duplicatasRetidas: [{ competencia: COMPETENCIA, placa: "DEFDUP01", valor: 5000 }],
    });
    expect(alertas).toHaveLength(0);
  });

  it("fica calado na sobra sem duplicata nenhuma", () => {
    const alertas = alertar({
      remunerado: [rem("SOBRA001", 13873.44)],
      realizado: [real("SOBRA001", 4147.88)],
    });
    expect(alertas).toHaveLength(0);
  });

  it("ignora duplicata de outra competência — a retenção é do mês, não da placa", () => {
    const alertas = alertar({
      remunerado: [rem("RZG5A37", 13873.44)],
      realizado: [real("RZG5A37", 4147.88)],
      duplicatasRetidas: [{ competencia: "2026-08", placa: "RZG5A37", valor: 4194.615 }],
    });
    expect(alertas).toHaveLength(0);
  });

  it("soma as cópias quando a placa tem mais de uma retida no mesmo mês", () => {
    const [alerta] = alertar({
      remunerado: [rem("TRESCOPI", 30000)],
      realizado: [real("TRESCOPI", 5000)],
      duplicatasRetidas: [
        { competencia: COMPETENCIA, placa: "TRESCOPI", valor: 5000 },
        { competencia: COMPETENCIA, placa: "TRESCOPI", valor: 5000 },
      ],
    });
    const porRotulo = new Map(alerta.evidencia.map((e) => [e.rotulo, e.valor]));
    expect(porRotulo.get("Retido como duplicata")).toContain("10.000,00");
    expect(porRotulo.get("Realizado se forem dois pagamentos")).toContain("15.000,00");
  });
});

describe("o conjunto", () => {
  it("é função pura das entradas — sem evidência e sem fila, não há alerta", () => {
    const alertas = alertar({
      remunerado: [rem("QYP0I48", 4103.53), rem("RZG5A37", 13873.44)],
      realizado: [real("QYP0I48", 9958.86), real("RZG5A37", 4147.88)],
    });
    expect(alertas).toEqual([]);
  });

  it("acusa as duas placas quando as duas evidências chegam, e só elas", () => {
    const alertas = alertar({
      remunerado: [
        rem("QYP0I48", 4103.53),
        rem("RZG5A37", 13873.44),
        rem("RPG0C44", 16769.83),
        rem("RPH1H43", 15905.65),
      ],
      realizado: [
        real("QYP0I48", 9958.86),
        real("RZG5A37", 4147.88),
        real("RPG0C44", 25085.47),
        real("RPH1H43", 21803.02),
      ],
      evidenciaDoRemunerado: [
        ev("QYP0I48", "Descrição: QUITADO", { amortizacao: 0, juros: 0, terceiraParcela: 3323.86 }),
        ev("RZG5A37", "Descrição: FINANCIADO", { amortizacao: 7515.85, juros: 6357.59 }),
        ev("RPG0C44", "Descrição: FINANCIADO", { amortizacao: 10000, juros: 6769.83 }),
        ev("RPH1H43", "Descrição: FINANCIADO", { amortizacao: 9000, juros: 6905.65 }),
      ],
      duplicatasRetidas: [{ competencia: COMPETENCIA, placa: "RZG5A37", valor: 4147.875 }],
    });

    expect(alertas.map((a) => a.entityLabel).sort()).toEqual(["QYP0I48", "RZG5A37"]);
    expect(alertas.map((a) => a.tipo).sort()).toEqual([
      "QUITADO_COM_REALIZADO_RECORRENTE",
      "SOBRA_COM_DUPLICATA_RETIDA",
    ]);
  });
});

describe("situacaoDoFinanciamentoDe", () => {
  it("lê os três textos da base, com prefixo, acento e caixa variando", () => {
    expect(situacaoDoFinanciamentoDe("Descrição: QUITADO")).toBe("QUITADO");
    expect(situacaoDoFinanciamentoDe("descricao: financiado")).toBe("FINANCIADO");
    expect(situacaoDoFinanciamentoDe("Descrição: FINAME")).toBe("FINANCIADO");
  });

  it("não chuta: o que não reconhece vira INDEFINIDO, e nunca FINANCIADO", () => {
    expect(situacaoDoFinanciamentoDe(null)).toBe("INDEFINIDO");
    expect(situacaoDoFinanciamentoDe("")).toBe("INDEFINIDO");
    expect(situacaoDoFinanciamentoDe("Descrição: EM ANÁLISE")).toBe("INDEFINIDO");
  });
});
