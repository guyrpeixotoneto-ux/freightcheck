import { describe, expect, it } from "vitest";

import { lerOperacao } from "../leitores/operacao";
import { somarIndisponibilidade } from "../mapa-rota";
import { fixtureOperacao } from "./fixtures";

/**
 * A MARCA DE INDISPONIBILIDADE — o zero que o 2Art escreve para dizer "não há".
 *
 * O bloco da indisponibilidade tem quatro colunas no 2Art. Duas são texto
 * (`PlacaIndisp`, `FrotaIndisp`) e chegam em branco quando não há
 * indisponibilidade; duas são numéricas (`VeiculoIndisp`, `TipoIndisp`) e
 * chegam com **zero**.
 *
 * O leitor transformava esse zero em `"0"` — uma string não vazia —, e
 * `somarIndisponibilidade` conta como marcada toda viagem cujo tipo não é
 * vazio. Consequência: **todas** as viagens entravam na linha
 * `INDISPONIBILIDADE`. Nos arquivos reais de julho/2026 a linha somava
 * R$ 308.411,01 na 1ª quinzena e R$ 328.169,46 na 2ª — o faturado inteiro da
 * Rota — onde o `RESUMO GERAL` imprime `R$ -` nas duas.
 *
 * **Por que o defeito sobreviveu a 360 testes.** Ele só existe entre o arquivo
 * e o motor: a reconciliação roda sobre as abas diárias da `.xlsb`, que não têm
 * estas colunas, e os testes de unidade do motor montavam a viagem com `""`
 * direto. Nenhum dos dois lados o via. Este arquivo fecha o vão, e por isso
 * parte do **arquivo**, não de uma viagem montada à mão.
 */

describe("o zero numérico não é marca de indisponibilidade", () => {
  it("uma viagem sem indisponibilidade chega ao motor com a marca vazia", () => {
    const { linhas } = lerOperacao(fixtureOperacao());
    for (const v of linhas) {
      expect(
        v.detalhe?.tipoDeIndisponibilidade,
        `viagem do mapa ${v.mapa} veio com marca "${v.detalhe?.tipoDeIndisponibilidade}"`,
      ).toBe("");
      expect(v.detalhe?.veiculoIndisponivel).toBe("");
    }
  });

  /*
    A afirmação que fecha o vão entre o arquivo e o motor: lido do 2Art e somado
    pelo motor, o resultado é zero **medido** — sobre um denominador que o torna
    conferível.
  */
  it("lido do arquivo e somado pelo motor, o total é zero medido", () => {
    const { linhas } = lerOperacao(fixtureOperacao());
    const diario = [
      {
        viagens: linhas.map((v) => ({
          frota: String(v.frota ?? ""),
          cargaAtual: v.detalhe?.cargaAtual ?? "",
          tipoDeImposto: v.detalhe?.tipoDeImposto ?? "",
          valorFaturado: Number(v.valorFaturado ?? 0),
          caixasDeRota: v.detalhe?.caixasDeRota ?? null,
          caixasDeAs: v.detalhe?.caixasDeAs ?? null,
          tipoDeIndisponibilidade: v.detalhe?.tipoDeIndisponibilidade ?? "",
        })),
      },
    ];

    const somado = somarIndisponibilidade(diario);
    expect(somado.valor).toBe(0);
    expect(somado.comMarca).toBe(0);
    /* O denominador: sem ele, um zero medido e um zero por engano são iguais. */
    expect(somado.viagens).toBeGreaterThan(0);
    expect(somado.tipos).toEqual([]);
  });
});

describe("uma marca de verdade continua atravessando", () => {
  /*
    O corte é só do zero. Um texto — que é como as duas colunas de texto do
    bloco escrevem o motivo — continua sendo marca, e um código numérico
    diferente de zero também.
  */
  it("um motivo em texto é marca", () => {
    const somado = somarIndisponibilidade([
      {
        viagens: [
          viagemDe("Manutenção", 400),
          viagemDe("", 900),
          viagemDe("Sinistro", 250),
        ],
      },
    ]);
    expect(somado.valor).toBe(650);
    expect(somado.comMarca).toBe(2);
    expect(somado.tipos).toEqual(["Manutenção", "Sinistro"]);
  });

  it('a string "0" é ausência, e não um motivo chamado zero', () => {
    const somado = somarIndisponibilidade([
      { viagens: [viagemDe("0", 400), viagemDe("2", 250)] },
    ]);
    /*
      Só a segunda soma. `"0"` é o que o leitor já converte em vazio; se algum
      caminho o deixar passar, o motor não o trata como motivo.
    */
    expect(somado.comMarca).toBe(1);
    expect(somado.valor).toBe(250);
  });
});

function viagemDe(tipoDeIndisponibilidade: string, valorFaturado: number) {
  return {
    frota: "Padrao",
    cargaAtual: "Roteriz",
    tipoDeImposto: "CTRC-ICMS",
    valorFaturado,
    caixasDeRota: 100,
    caixasDeAs: 0,
    tipoDeIndisponibilidade,
  };
}
