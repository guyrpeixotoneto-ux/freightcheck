import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { abrirDisponibilidade } from "../disponibilidade-da-competencia";
import type { DiaDeDisponibilidade } from "../leitores/disponibilidade";

/**
 * A ABERTURA DA DISPONIBILIDADE — o que a tela lê, e o que ela nunca inventa.
 *
 * O módulo é puro e não decide dinheiro: quem transforma disponibilidade em
 * desconto é `descontoDeDisponibilidadeDoMes`, pela regra do mês. O que este
 * arquivo prende são as três promessas da leitura:
 *
 * 1. as duas casinhas do 03.08.18 saem separadas e na ordem do relatório;
 * 2. o que soma, soma — e o que não soma (percentual) não aparece somado;
 * 3. uma frota sem linha não vira um bloco de zeros.
 *
 * E prende a fronteira, no espírito de `frota-promax-contaminacao.ts`: a
 * abertura é para leitura, e o motor financeiro não a enxerga. Quem soma
 * disponibilidade para virar desconto continua sendo
 * `descontoDeDisponibilidadeDoMes`, pela regra do mês — se um módulo
 * financeiro passar a importar esta abertura, existirão duas somas do mesmo
 * dinheiro, e o teste cai.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const fonte = (arquivo: string) => readFileSync(path.join(AQUI, "..", arquivo), "utf8");

const MODULOS_FINANCEIROS = [
  "mapa-rota.ts",
  "resumo.ts",
  "apuracao.ts",
  "de-para.ts",
  "reconciliacao.ts",
  "painel-referencia.ts",
  "afericao.ts",
  "matriz.ts",
  "faturado.ts",
];

function importaDe(codigo: string, modulo: string): boolean {
  const semComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return new RegExp(`from\\s+["'][^"']*${modulo}["']`).test(semComentarios);
}

function dia(parcial: Partial<DiaDeDisponibilidade> = {}): DiaDeDisponibilidade {
  return {
    linha: 1,
    aba: "FF",
    tipoDeFrota: "FF",
    dia: "2026-07-01",
    canal: "ROTA",
    frotaTotal: 10,
    contratada: 8,
    realPrimeiraViagem: 6,
    realSegundaViagem: 1,
    gapTotal: 1,
    gapDaCia: 0.25,
    gapDaTransportadora: {
      frotaCancelada: 0.25,
      outrosCancelados: 0.25,
      frotaNaoCancelada: 0.25,
      outrosNaoCancelados: 0,
    },
    descontos: { custoFixo: 100, equipe: 20, indiretos: 5, fatorAjudante: 1, total: 126 },
    percentualDeUtilizacao: 87.5,
    percentualDeDisponibilidade: 90,
    ...parcial,
  };
}

describe("abrirDisponibilidade", () => {
  it("separa as duas casinhas do relatório, na ordem em que ele as abre", () => {
    const frotas = abrirDisponibilidade([
      dia({ aba: "Van", tipoDeFrota: "VAN" }),
      dia(),
    ]);

    expect(frotas.map((f) => f.tipoDeFrota)).toEqual(["FF", "VAN"]);
  });

  it("não devolve bloco para a frota que não tem linha nenhuma", () => {
    const frotas = abrirDisponibilidade([dia()]);

    /* Van sem linha é relatório que não chegou — e zero seria uma afirmação. */
    expect(frotas).toHaveLength(1);
    expect(frotas[0].tipoDeFrota).toBe("FF");
  });

  it("ordena as linhas por dia e, dentro do dia, por canal", () => {
    const frotas = abrirDisponibilidade([
      dia({ dia: "2026-07-02", canal: "AS" }),
      dia({ dia: "2026-07-01", canal: "AS" }),
      dia({ dia: "2026-07-01", canal: "ROTA" }),
    ]);

    expect(frotas[0].linhas.map((l) => `${l.dia} ${l.canal}`)).toEqual([
      "2026-07-01 ROTA",
      "2026-07-01 AS",
      "2026-07-02 AS",
    ]);
  });

  it("soma o gap da transportadora pelas quatro parcelas que o relatório abre", () => {
    const [ff] = abrirDisponibilidade([dia()]);

    expect(ff.linhas[0].gapDaTransportadora.total).toBe(0.75);
    expect(ff.totais.gapDaTransportadora).toBe(0.75);
  });

  it("soma contratada, realizada e os quatro descontos do período", () => {
    const [ff] = abrirDisponibilidade([
      dia({ dia: "2026-07-01" }),
      dia({ dia: "2026-07-02" }),
    ]);

    expect(ff.totais.contratada).toBe(16);
    /* Realizada é 1ª + 2ª viagem — as duas colunas somadas, nunca uma delas. */
    expect(ff.totais.realizada).toBe(14);
    expect(ff.totais.descontos).toEqual({
      custoFixo: 200,
      equipe: 40,
      indiretos: 10,
      fatorAjudante: 2,
      total: 252,
    });
  });

  it("conta dias distintos, e não linhas", () => {
    const [ff] = abrirDisponibilidade([
      dia({ dia: "2026-07-01", canal: "ROTA" }),
      dia({ dia: "2026-07-01", canal: "AS" }),
      dia({ dia: "2026-07-02", canal: "ROTA" }),
    ]);

    expect(ff.totais.dias).toBe(2);
    expect(ff.totais.linhas).toBe(3);
  });

  /*
    Média de razão não é a razão da soma: um percentual "do período" obrigaria a
    escolher um denominador que o relatório não escolheu. Os percentuais ficam
    na linha do dia, onde ele os declarou — e o `null` de uma coluna ausente
    chega à tela como `null`, nunca como zero.
  */
  it("não soma percentual, e preserva o que o relatório declarou em cada linha", () => {
    const [ff] = abrirDisponibilidade([
      dia({ percentualDeDisponibilidade: null, percentualDeUtilizacao: 80 }),
    ]);

    expect(ff.linhas[0].percentualDeDisponibilidade).toBeNull();
    expect(ff.linhas[0].percentualDeUtilizacao).toBe(80);
    expect(ff.totais).not.toHaveProperty("percentualDeDisponibilidade");
  });
});

describe("a abertura da disponibilidade fica fora do motor financeiro", () => {
  for (const modulo of MODULOS_FINANCEIROS) {
    it(`${modulo} não importa a abertura da disponibilidade`, () => {
      expect(
        importaDe(fonte(modulo), "disponibilidade-da-competencia"),
        `${modulo} passou a importar a abertura da disponibilidade`,
      ).toBe(false);
    });
  }

  it("a abertura não importa nenhum módulo financeiro — a seta não existe nos dois sentidos", () => {
    const abertura = fonte("disponibilidade-da-competencia.ts");
    for (const modulo of ["apuracao", "reconciliacao", "painel-referencia", "mapa-rota", "resumo"]) {
      expect(
        importaDe(abertura, modulo),
        `disponibilidade-da-competencia.ts importa ${modulo}`,
      ).toBe(false);
    }
  });
});
