import { describe, expect, it } from "vitest";

import {
  janelaDeVigencias,
  lerJanela,
  montarGradeDaPlaca,
  pendentesDaVigencia,
  resumoDaPlaca,
  VIGENCIAS_PADRAO,
  type AlteracaoDaPlaca,
  type VigenciaDaGrade,
} from "../historico-da-placa";
import type { Comparacao } from "../justificativas";

/**
 * A grade atributo × vigência da tela de detalhe de uma placa.
 *
 * O que se guarda aqui é o que a grade promete a quem justifica: a janela
 * termina na vigência que o gestor escolheu (e não sempre na mais recente), a
 * coluna que ainda não respondeu não se disfarça de "nada mudou", a célula
 * meio explicada não se disfarça de resolvida, e o botão de justificar em lote
 * só manda o que de fato está pendente.
 */

const comparacao = (id: string, data: string): Comparacao => ({
  id,
  snapshotBLabel: id,
  snapshotBDate: data,
});

/** As comparações como `/change-sets` as devolve: da mais recente para a mais antiga. */
const COMPARACOES = [
  comparacao("set-ago", "2026-08-01"),
  comparacao("set-jul", "2026-07-01"),
  comparacao("set-jun", "2026-06-01"),
  comparacao("set-mai", "2026-05-01"),
];

const alteracao = (id: number, code: string, antes: string, depois: string): AlteracaoDaPlaca => ({
  id,
  attributeCode: code,
  attributeName: code,
  valueBefore: antes,
  valueAfter: depois,
});

function vigencia(
  changeSetId: string,
  alteracoes: AlteracaoDaPlaca[],
  justificadas: number[] = [],
  carregando = false,
): VigenciaDaGrade {
  return {
    changeSetId,
    rotulo: changeSetId,
    alteracoes,
    justificadas: new Set(justificadas),
    carregando,
  };
}

describe("janelaDeVigencias", () => {
  it("desenha da mais antiga para a mais recente — a grade se lê como linha do tempo", () => {
    const janela = janelaDeVigencias(COMPARACOES, 3);
    expect(janela.map((c) => c.id)).toEqual(["set-jun", "set-jul", "set-ago"]);
  });

  it("termina na vigência escolhida, e não na mais recente do banco", () => {
    const janela = janelaDeVigencias(COMPARACOES, 2, "set-jul");
    expect(janela.map((c) => c.id)).toEqual(["set-jun", "set-jul"]);
  });

  it("com histórico menor que a janela, mostra o que existe — sem coluna inventada", () => {
    const janela = janelaDeVigencias(COMPARACOES, 12);
    expect(janela).toHaveLength(4);
  });

  it("vigência escolhida que não existe mais volta para as mais recentes", () => {
    const janela = janelaDeVigencias(COMPARACOES, 2, "set-apagada");
    expect(janela.map((c) => c.id)).toEqual(["set-jul", "set-ago"]);
  });
});

describe("lerJanela", () => {
  it("aceita as opções do seletor", () => {
    expect(lerJanela("3")).toBe(3);
    expect(lerJanela("12")).toBe(12);
  });

  it("cai no padrão para qualquer coisa fora da lista", () => {
    expect(lerJanela(null)).toBe(VIGENCIAS_PADRAO);
    expect(lerJanela("999")).toBe(VIGENCIAS_PADRAO);
    expect(lerJanela("banana")).toBe(VIGENCIAS_PADRAO);
  });
});

describe("montarGradeDaPlaca", () => {
  const JUNHO = vigencia("set-jun", [alteracao(1, "manutencaoReaisKm", "0.20", "0.22")], [1]);
  const JULHO = vigencia("set-jul", [alteracao(2, "manutencaoReaisKm", "0.22", "0.24")]);
  const AGOSTO = vigencia("set-ago", [
    alteracao(3, "manutencaoReaisKm", "0.24", "0.26"),
    alteracao(4, "ativo", "PARADO", "ATIVO"),
  ]);

  it("uma linha por atributo, uma célula por vigência da janela", () => {
    const linhas = montarGradeDaPlaca([JUNHO, JULHO, AGOSTO]);
    expect(linhas.map((l) => l.attributeCode).sort()).toEqual(["ativo", "manutencaoReaisKm"]);
    for (const linha of linhas) expect(linha.celulas).toHaveLength(3);
  });

  it("distingue justificada, pendente e sem alteração — a cor da célula é a régua", () => {
    const [linha] = montarGradeDaPlaca([JUNHO, JULHO, AGOSTO]).filter(
      (l) => l.attributeCode === "manutencaoReaisKm",
    );
    expect(linha.celulas.map((c) => c.estado)).toEqual(["justificada", "pendente", "pendente"]);

    const [ativo] = montarGradeDaPlaca([JUNHO, JULHO, AGOSTO]).filter(
      (l) => l.attributeCode === "ativo",
    );
    expect(ativo.celulas.map((c) => c.estado)).toEqual([
      "sem-alteracao",
      "sem-alteracao",
      "pendente",
    ]);
  });

  it("coluna ainda carregando não afirma que nada mudou nela", () => {
    const carregando = vigencia("set-jul", [], [], true);
    const linhas = montarGradeDaPlaca([JUNHO, carregando, AGOSTO]);
    const [linha] = linhas.filter((l) => l.attributeCode === "ativo");
    expect(linha.celulas[1].estado).toBe("sem-leitura");
    expect(linha.celulas[0].estado).toBe("sem-alteracao");
  });

  it("célula com duas alterações e uma explicada fica parcial, nunca resolvida", () => {
    const mista = vigencia(
      "set-ago",
      [alteracao(5, "pneus", "a", "b"), alteracao(6, "pneus", "b", "c")],
      [5],
    );
    const [linha] = montarGradeDaPlaca([mista]);
    expect(linha.celulas[0].estado).toBe("parcial");
    expect(linha.celulas[0].alteracoes).toHaveLength(2);
    expect(linha.celulas[0].pendentes.map((a) => a.id)).toEqual([6]);
  });

  it("põe no topo o atributo que mexeu por último, e as pendências desempatam", () => {
    const jun = vigencia("set-jun", [alteracao(10, "antigo", "a", "b")]);
    const ago = vigencia("set-ago", [alteracao(11, "recente", "a", "b")]);
    const linhas = montarGradeDaPlaca([jun, ago]);
    expect(linhas.map((l) => l.attributeCode)).toEqual(["recente", "antigo"]);
  });

  it("atributo que só mudou fora da janela não vira linha vazia", () => {
    const linhas = montarGradeDaPlaca([JULHO, AGOSTO]);
    expect(linhas.some((l) => l.celulas.every((c) => c.alteracoes.length === 0))).toBe(false);
  });
});

describe("resumoDaPlaca", () => {
  it("conta alterações, pendentes, atributos e vigências que de fato mexeram", () => {
    const linhas = montarGradeDaPlaca([
      vigencia("set-jun", [alteracao(1, "a", "0", "1")], [1]),
      vigencia("set-jul", []),
      vigencia("set-ago", [alteracao(2, "a", "1", "2"), alteracao(3, "b", "x", "y")]),
    ]);
    expect(resumoDaPlaca(linhas)).toEqual({
      alteracoes: 3,
      pendentes: 2,
      justificadas: 1,
      atributos: 2,
      vigenciasComAlteracao: 2,
    });
  });

  it("sem linha nenhuma, tudo é zero — e não `NaN`", () => {
    expect(resumoDaPlaca([])).toEqual({
      alteracoes: 0,
      pendentes: 0,
      justificadas: 0,
      atributos: 0,
      vigenciasComAlteracao: 0,
    });
  });
});

describe("pendentesDaVigencia", () => {
  it("manda só o que está pendente naquela coluna — nunca regrava o que já foi explicado", () => {
    const linhas = montarGradeDaPlaca([
      vigencia("set-jul", [alteracao(1, "a", "0", "1")], [1]),
      vigencia("set-ago", [alteracao(2, "a", "1", "2"), alteracao(3, "b", "x", "y")], [3]),
    ]);
    expect(pendentesDaVigencia(linhas, "set-ago").map((a) => a.id)).toEqual([2]);
    expect(pendentesDaVigencia(linhas, "set-jul")).toEqual([]);
  });
});
