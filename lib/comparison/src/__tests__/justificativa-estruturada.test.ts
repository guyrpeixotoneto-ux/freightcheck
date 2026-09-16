import { describe, expect, it } from "vitest";
import {
  faltamNaJustificativa,
  lerJustificativaEstruturada,
  resumoDaJustificativa,
} from "../justificativa-estruturada";

/**
 * A regra do que é uma justificativa completa — provada aqui porque ela é
 * afirmada em dois lugares ao mesmo tempo: o botão do diálogo e a recusa da
 * rota. Um botão que se acende diante de um POST que recusa faz o gestor
 * perder o texto que acabou de escrever.
 */
describe("o que falta numa justificativa", () => {
  const completa = {
    formula: "Amortização mensal = valor amortizável ÷ prazo",
    regra: "Só muda com novo prazo ou novo valor amortizável aprovado.",
  };

  it("cobra fórmula, regra e a resposta sobre a conformidade", () => {
    expect(faltamNaJustificativa({})).toEqual(["formula", "regra", "conforme"]);
  });

  it("não cobra motivo nem responsável de quem seguiu a regra", () => {
    expect(faltamNaJustificativa({ ...completa, conformidade: "CONFORME" })).toEqual([]);
  });

  it("cobra motivo e responsável da exceção — exceção sem dono não é exceção", () => {
    expect(faltamNaJustificativa({ ...completa, conformidade: "EXCECAO" })).toEqual([
      "motivoExcecao",
      "responsavelAprovacao",
    ]);
    expect(
      faltamNaJustificativa({
        ...completa,
        conformidade: "EXCECAO",
        motivoExcecao: "Troca de eixo aprovada pela manutenção.",
      }),
    ).toEqual(["responsavelAprovacao"]);
  });

  /*
    O descumprimento não tem aprovador: exigir um obrigaria quem registra que a
    regra foi descumprida a escrever um nome no campo "Responsável pela
    aprovação" — e o registro afirmaria um aval que não existiu.
  */
  it("do descumprimento cobra só o motivo, porque ninguém aprovou", () => {
    expect(faltamNaJustificativa({ ...completa, conformidade: "DESCUMPRIMENTO" })).toEqual([
      "motivoExcecao",
    ]);
    expect(
      faltamNaJustificativa({
        ...completa,
        conformidade: "DESCUMPRIMENTO",
        motivoExcecao: "Pagou acima da tabela do acordo.",
      }),
    ).toEqual([]);
  });

  it("espaço em branco não preenche campo", () => {
    expect(
      faltamNaJustificativa({ formula: "   ", regra: "  ", conformidade: "CONFORME" }),
    ).toEqual(["formula", "regra"]);
  });

  /*
    Sem resposta sobre a conformidade não se sabe se o motivo é exigível: a
    lista para em `conforme` em vez de cobrar campos que talvez não existam.
  */
  it("não cobra os campos da exceção enquanto a conformidade não foi respondida", () => {
    expect(faltamNaJustificativa(completa)).toEqual(["conforme"]);
  });
});

describe("o corpo do POST virando justificativa", () => {
  const corpo = {
    changeSetId: "cs1",
    changeIds: [1, 2],
    formula: "  Amortização mensal = valor ÷ prazo  ",
    regra: "  Só muda com novo prazo.  ",
    conforme: false,
    motivoExcecao: "  Contrato renegociado.  ",
    responsavelAprovacao: "  Ana Souza  ",
  };

  it("apara os campos e ignora o resto do corpo", () => {
    const lida = lerJustificativaEstruturada(corpo);
    expect(lida).toEqual({
      ok: true,
      valor: {
        formula: "Amortização mensal = valor ÷ prazo",
        regra: "Só muda com novo prazo.",
        conforme: false,
        /* Corpo sem tipo é o que as versões anteriores da tela mandavam, e
           continua valendo como exceção — era o único "não" que havia. */
        naoConformidade: "EXCECAO",
        motivoExcecao: "Contrato renegociado.",
        responsavelAprovacao: "Ana Souza",
      },
    });
  });

  it("descarta motivo e responsável quando a alteração é conforme", () => {
    const lida = lerJustificativaEstruturada({ ...corpo, conforme: true });
    expect(lida.ok && lida.valor.naoConformidade).toBeNull();
    expect(lida.ok && lida.valor.motivoExcecao).toBeNull();
    expect(lida.ok && lida.valor.responsavelAprovacao).toBeNull();
  });

  /* O aprovador escrito antes de trocar para descumprimento não sobrevive: a
     linha gravada afirmaria um aval que a própria resposta nega. */
  it("no descumprimento, guarda o motivo e descarta o responsável", () => {
    const lida = lerJustificativaEstruturada({
      ...corpo,
      conforme: false,
      naoConformidade: "DESCUMPRIMENTO",
    });
    expect(lida.ok && lida.valor.naoConformidade).toBe("DESCUMPRIMENTO");
    expect(lida.ok && lida.valor.motivoExcecao).toBe("Contrato renegociado.");
    expect(lida.ok && lida.valor.responsavelAprovacao).toBeNull();
  });

  it("descumprimento sem motivo é recusado, e não cobra aprovador", () => {
    expect(
      lerJustificativaEstruturada({
        formula: "f",
        regra: "r",
        conforme: false,
        naoConformidade: "DESCUMPRIMENTO",
      }),
    ).toEqual({ ok: false, faltam: ["motivoExcecao"] });
  });

  it("nomeia o que falta em vez de gravar pela metade", () => {
    expect(lerJustificativaEstruturada({ formula: "f", regra: "r" })).toEqual({
      ok: false,
      faltam: ["conforme"],
    });
  });

  it("recusa corpo que não é objeto", () => {
    expect(lerJustificativaEstruturada(null).ok).toBe(false);
    expect(lerJustificativaEstruturada("texto solto").ok).toBe(false);
  });
});

describe("o resumo que fica em `texto`", () => {
  it("da conforme, cita a regra que foi seguida", () => {
    expect(
      resumoDaJustificativa({
        formula: "f",
        regra: "Só muda com novo prazo.",
        conforme: true,
        naoConformidade: null,
        motivoExcecao: null,
        responsavelAprovacao: null,
      }),
    ).toBe("Conforme a regra: Só muda com novo prazo.");
  });

  it("da exceção, cita o motivo e quem aprovou", () => {
    expect(
      resumoDaJustificativa({
        formula: "f",
        regra: "r",
        conforme: false,
        naoConformidade: "EXCECAO",
        motivoExcecao: "Contrato renegociado",
        responsavelAprovacao: "Ana Souza",
      }),
    ).toBe("Exceção à regra: Contrato renegociado — aprovada por Ana Souza.");
  });

  it("do descumprimento, cita o que houve — e não diz que alguém aprovou", () => {
    expect(
      resumoDaJustificativa({
        formula: "f",
        regra: "r",
        conforme: false,
        naoConformidade: "DESCUMPRIMENTO",
        motivoExcecao: "Pagou acima da tabela do acordo",
        responsavelAprovacao: null,
      }),
    ).toBe("Regra de remuneração descumprida: Pagou acima da tabela do acordo");
  });
});
