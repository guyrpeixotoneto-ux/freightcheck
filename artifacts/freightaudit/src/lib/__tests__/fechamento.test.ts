import { describe, expect, it } from "vitest";
import { fontesDaCompetencia, type Fonte, type TipoDeFonte } from "@/lib/fechamento";

/**
 * O recorte por quinzena — o que a tela pede a cada competência.
 *
 * A regra é do processo: a 1ª quinzena tem quatro relatórios e a 2ª tem os
 * seis, porque as requisições (03.08.12.09) e a conciliação (03.02.59.02)
 * chegam com o fechamento do mês. A função aparece em três telas — a
 * competência aberta, a linha de Importações e a de Apurações —, e é ela que
 * decide tanto as linhas que se mostram quanto o denominador de "3 de 4
 * relatórios". Um recorte diferente em cada tela faria a mesma quinzena parecer
 * completa numa e incompleta na outra.
 */

const fonte = (tipo: TipoDeFonte, rotina: string, quinzenas: (1 | 2)[]): Fonte => ({
  tipo,
  rotina,
  nome: rotina,
  papel: "",
  extensoes: [".xlsx"],
  quinzenas,
});

const CATALOGO: Fonte[] = [
  fonte("OPERACAO", "2Art", [1, 2]),
  fonte("CTE", "03.08.15", [1, 2]),
  fonte("PAGAMENTO", "03.08.20", [1, 2]),
  fonte("DISPONIBILIDADE", "03.08.18", [1, 2]),
  fonte("REQUISICOES", "03.08.12.09", [2]),
  fonte("CONCILIACAO", "03.02.59.02", [2]),
];

describe("fontesDaCompetencia", () => {
  it("pede quatro relatórios na 1ª quinzena e seis na 2ª", () => {
    expect(fontesDaCompetencia(CATALOGO, 1).map((f) => f.rotina)).toEqual([
      "2Art",
      "03.08.15",
      "03.08.20",
      "03.08.18",
    ]);
    expect(fontesDaCompetencia(CATALOGO, 2)).toHaveLength(6);
  });

  it("mantém na lista o relatório enviado fora da quinzena dele", () => {
    /* Arquivo importado nunca some da tela por causa do recorte: sumindo, ele
       seria importado de novo — e o denominador diria "de 4" com cinco
       enviados. */
    const lista = fontesDaCompetencia(CATALOGO, 1, ["CONCILIACAO"]);
    expect(lista.map((f) => f.rotina)).toEqual([
      "2Art",
      "03.08.15",
      "03.08.20",
      "03.08.18",
      "03.02.59.02",
    ]);
  });

  it("não repete o que já estava na quinzena", () => {
    expect(fontesDaCompetencia(CATALOGO, 2, ["CTE", "CONCILIACAO"])).toHaveLength(6);
  });

  it("devolve vazio enquanto o catálogo não chegou — vazio é 'ainda não sei'", () => {
    expect(fontesDaCompetencia([], 1, ["CTE"])).toEqual([]);
  });

  it("preserva a ordem do catálogo, que é a das casinhas da lista", () => {
    const embaralhado = [CATALOGO[3], CATALOGO[0], CATALOGO[1]];
    expect(fontesDaCompetencia(embaralhado, 1).map((f) => f.tipo)).toEqual([
      "DISPONIBILIDADE",
      "OPERACAO",
      "CTE",
    ]);
  });
});
