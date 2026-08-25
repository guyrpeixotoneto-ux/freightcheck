import { describe, expect, it } from "vitest";
import {
  apenasCanalRota,
  consolidarDuplicatasExatas,
  verbasRepetidas,
  type VbzRepetida,
} from "../pagamento-por-canal";
import type { ItemDePagamento } from "@/lib/fechamento";

/**
 * O filtro que garante que a etapa 4 do Fechamento Rota só mostra Rota — e o
 * detector que aponta VBZ repetida sem nunca somar ou apagar nada sozinho.
 *
 * Os dois cobrem exatamente o que o pedido de quem opera exigiu: (1) provar
 * que o número do ROTA não é influenciado pelo AS, e (2) provar que uma VBZ
 * repetida no mesmo bloco é sempre sinalizada — idêntica ou divergente — e
 * nunca resolvida calada.
 */

function item(parcial: Partial<ItemDePagamento> & { linha: number }): ItemDePagamento {
  return {
    canal: "ROTA",
    bloco: "FRETE",
    verba: { vbz: 1, nome: "Frota Fixa Ativa" },
    nomeNoArquivo: "Frota Fixa Ativa",
    semImposto: 100,
    nfIss: 10,
    ctrcIcms: 90,
    valorFaturado: 100,
    vlcNfIss: 10,
    vlcCtrcIcms: 90,
    ...parcial,
  };
}

describe("apenasCanalRota", () => {
  it("mantém só as linhas do canal Rota, na mesma ordem", () => {
    const itens = [
      item({ linha: 1, canal: "ROTA", verba: { vbz: 1, nome: "Frota Fixa Ativa" } }),
      item({ linha: 2, canal: "AS", verba: { vbz: 20, nome: "Frota Fixa Ativa" } }),
      item({ linha: 3, canal: "ROTA", verba: { vbz: 2, nome: "Equipe Entrega Ativa" } }),
    ];

    expect(apenasCanalRota(itens)).toEqual([itens[0], itens[2]]);
  });

  it("descarta o AS inteiro sem tocar nos valores do ROTA que sobra", () => {
    const rota = item({ linha: 1, canal: "ROTA", valorFaturado: 155_160.87 });
    const as = item({ linha: 2, canal: "AS", valorFaturado: 999_999.99 });

    const resultado = apenasCanalRota([rota, as]);

    expect(resultado).toEqual([rota]);
    expect(resultado[0].valorFaturado).toBe(155_160.87);
  });

  it("funciona igual sobre os totais declarado/calculado por canal — a mesma função, os dois usos", () => {
    const totais = [
      { canal: "ROTA", declarado: 404_047.64, calculado: 808_095.28, diferenca: -404_047.64 },
      { canal: "AS", declarado: 15_968.32, calculado: 32_323.04, diferenca: -16_354.72 },
    ];

    expect(apenasCanalRota(totais)).toEqual([totais[0]]);
  });

  it("uma competência sem AS continua trazendo o ROTA normalmente", () => {
    const itens = [item({ linha: 1, canal: "ROTA" })];
    expect(apenasCanalRota(itens)).toEqual(itens);
  });

  it("uma competência só de AS devolve lista vazia — nunca inventa um ROTA que não veio", () => {
    const itens = [item({ linha: 1, canal: "AS", verba: { vbz: 20, nome: "Frota Fixa Ativa" } })];
    expect(apenasCanalRota(itens)).toEqual([]);
  });
});

describe("verbasRepetidas", () => {
  it("nenhuma VBZ repetida no bloco → lista vazia", () => {
    const itens = [
      item({ linha: 1, verba: { vbz: 1, nome: "Frota Fixa Ativa" } }),
      item({ linha: 2, verba: { vbz: 2, nome: "Equipe Entrega Ativa" } }),
    ];
    expect(verbasRepetidas(itens)).toEqual([]);
  });

  it("mesma VBZ, mesmo bloco, valores idênticos → classificada IDENTICA", () => {
    const itens = [
      item({ linha: 9, verba: { vbz: 1, nome: "Frota Fixa Ativa" }, valorFaturado: 17_039.35 }),
      item({ linha: 10, verba: { vbz: 1, nome: "Frota Fixa Ativa" }, valorFaturado: 17_039.35 }),
    ];

    const achadas = verbasRepetidas(itens);

    expect(achadas).toHaveLength(1);
    expect(achadas[0]).toEqual<VbzRepetida>({
      vbz: 1,
      nome: "Frota Fixa Ativa",
      bloco: "FRETE",
      classificacao: "IDENTICA",
      ocorrencias: [
        { linha: 9, valorFaturado: 17_039.35 },
        { linha: 10, valorFaturado: 17_039.35 },
      ],
    });
  });

  it("mesma VBZ, mesmo bloco, um valor diferente → classificada DIVERGENTE", () => {
    const itens = [
      item({ linha: 9, verba: { vbz: 1, nome: "Frota Fixa Ativa" }, valorFaturado: 17_039.35 }),
      /* Só o `ctrcIcms` muda — basta uma das seis colunas discordar. */
      item({
        linha: 10,
        verba: { vbz: 1, nome: "Frota Fixa Ativa" },
        valorFaturado: 17_039.35,
        ctrcIcms: 12_264.91,
      }),
    ];

    const achadas = verbasRepetidas(itens);

    expect(achadas).toHaveLength(1);
    expect(achadas[0].classificacao).toBe("DIVERGENTE");
    expect(achadas[0].ocorrencias.map((o) => o.linha)).toEqual([9, 10]);
  });

  it("mesma VBZ em blocos diferentes (Frete e Outros Custos) não é repetição — é o desenho do relatório", () => {
    const itens = [
      item({ linha: 5, bloco: "FRETE", verba: { vbz: 7, nome: "Freteiro" } }),
      item({ linha: 15, bloco: "OUTROS_CUSTOS", verba: { vbz: 7, nome: "Freteiro" } }),
    ];
    expect(verbasRepetidas(itens)).toEqual([]);
  });

  it("três ocorrências da mesma VBZ no mesmo bloco entram todas na lista de ocorrências", () => {
    const itens = [
      item({ linha: 1, verba: { vbz: 3, nome: "Despesa Administrativa" } }),
      item({ linha: 2, verba: { vbz: 3, nome: "Despesa Administrativa" } }),
      item({ linha: 3, verba: { vbz: 3, nome: "Despesa Administrativa" } }),
    ];

    const achadas = verbasRepetidas(itens);

    expect(achadas).toHaveLength(1);
    expect(achadas[0].ocorrencias).toHaveLength(3);
    expect(achadas[0].classificacao).toBe("IDENTICA");
  });

  it("não deduplica nem soma — a lista original permanece intacta para quem chama", () => {
    const itens = [
      item({ linha: 9, verba: { vbz: 1, nome: "Frota Fixa Ativa" } }),
      item({ linha: 10, verba: { vbz: 1, nome: "Frota Fixa Ativa" } }),
    ];
    const antes = [...itens];

    verbasRepetidas(itens);

    expect(itens).toEqual(antes);
    expect(itens).toHaveLength(2);
  });

  it("detecta repetição em ambos os canais quando o mesmo 03.08.20 traz ROTA e AS", () => {
    const itens = [
      item({ linha: 1, canal: "ROTA", verba: { vbz: 1, nome: "Frota Fixa Ativa" } }),
      item({ linha: 2, canal: "ROTA", verba: { vbz: 1, nome: "Frota Fixa Ativa" } }),
      item({
        linha: 20,
        canal: "AS",
        verba: { vbz: 20, nome: "Frota Fixa Ativa" },
        valorFaturado: 1,
      }),
      item({
        linha: 21,
        canal: "AS",
        verba: { vbz: 20, nome: "Frota Fixa Ativa" },
        valorFaturado: 2,
      }),
    ];

    /* A tela ROTA só passa `apenasCanalRota(itens)` para `verbasRepetidas` — aqui se prova que, feito isso, só a repetição do ROTA aparece. */
    const achadasNaTelaRota = verbasRepetidas(apenasCanalRota(itens));
    expect(achadasNaTelaRota).toHaveLength(1);
    expect(achadasNaTelaRota[0].vbz).toBe(1);

    /* E as duas existem quando não se filtra — a função em si não sabe de tela. */
    const achadasSemFiltro = verbasRepetidas(itens);
    expect(achadasSemFiltro.map((a) => a.vbz)).toEqual([1, 20]);
    expect(achadasSemFiltro.find((a) => a.vbz === 20)?.classificacao).toBe("DIVERGENTE");
  });
});

describe("consolidarDuplicatasExatas", () => {
  it("sem repetição nenhuma, devolve a lista intacta e nenhuma consolidação", () => {
    const itens = [
      item({ linha: 1, verba: { vbz: 1, nome: "Frota Fixa Ativa" } }),
      item({ linha: 2, verba: { vbz: 2, nome: "Equipe Entrega Ativa" } }),
    ];

    const resultado = consolidarDuplicatasExatas(itens);

    expect(resultado.itens).toEqual(itens);
    expect(resultado.consolidadas).toEqual([]);
  });

  it("duas linhas idênticas → sobra uma, a de menor linha física", () => {
    const linha9 = item({
      linha: 9,
      verba: { vbz: 1, nome: "Frota Fixa Ativa" },
      valorFaturado: 17_039.35,
    });
    const linha10 = item({
      linha: 10,
      verba: { vbz: 1, nome: "Frota Fixa Ativa" },
      valorFaturado: 17_039.35,
    });

    const resultado = consolidarDuplicatasExatas([linha9, linha10]);

    expect(resultado.itens).toEqual([linha9]);
    expect(resultado.consolidadas).toEqual([
      { vbz: 1, nome: "Frota Fixa Ativa", bloco: "FRETE", linhaMantida: 9, linhasRemovidas: [10] },
    ]);
  });

  it("mantém a linha física mais baixa mesmo quando o array chega fora de ordem", () => {
    const linha15 = item({ linha: 15, verba: { vbz: 3, nome: "Despesa Administrativa" } });
    const linha6 = item({ linha: 6, verba: { vbz: 3, nome: "Despesa Administrativa" } });

    /* Ordem proposital: a maior linha física chega primeiro no array. */
    const resultado = consolidarDuplicatasExatas([linha15, linha6]);

    expect(resultado.itens).toEqual([linha6]);
    expect(resultado.consolidadas[0]).toMatchObject({ linhaMantida: 6, linhasRemovidas: [15] });
  });

  it("três ocorrências idênticas → sobra uma, as outras duas ficam em linhasRemovidas", () => {
    const itens = [
      item({ linha: 1, verba: { vbz: 4, nome: "Frota Fixa Inativa" } }),
      item({ linha: 2, verba: { vbz: 4, nome: "Frota Fixa Inativa" } }),
      item({ linha: 3, verba: { vbz: 4, nome: "Frota Fixa Inativa" } }),
    ];

    const resultado = consolidarDuplicatasExatas(itens);

    expect(resultado.itens).toHaveLength(1);
    expect(resultado.itens[0].linha).toBe(1);
    expect(resultado.consolidadas[0].linhasRemovidas).toEqual([2, 3]);
  });

  it("valores divergentes não são consolidados — as duas linhas continuam", () => {
    const linha9 = item({
      linha: 9,
      verba: { vbz: 1, nome: "Frota Fixa Ativa" },
      valorFaturado: 17_039.35,
    });
    const linha10 = item({
      linha: 10,
      verba: { vbz: 1, nome: "Frota Fixa Ativa" },
      valorFaturado: 20_000.0,
    });

    const resultado = consolidarDuplicatasExatas([linha9, linha10]);

    expect(resultado.itens).toEqual([linha9, linha10]);
    expect(resultado.consolidadas).toEqual([]);
  });

  it("mesma VBZ em blocos diferentes não é consolidada — as duas pertencem a naturezas distintas", () => {
    const frete = item({ linha: 5, bloco: "FRETE", verba: { vbz: 7, nome: "Freteiro" } });
    const outros = item({
      linha: 15,
      bloco: "OUTROS_CUSTOS",
      verba: { vbz: 7, nome: "Freteiro" },
    });

    const resultado = consolidarDuplicatasExatas([frete, outros]);

    expect(resultado.itens).toEqual([frete, outros]);
    expect(resultado.consolidadas).toEqual([]);
  });

  it("um bloco com duplicata idêntica e outra VBZ divergente — só a idêntica é reduzida", () => {
    const itens = [
      item({ linha: 1, verba: { vbz: 1, nome: "Frota Fixa Ativa" }, valorFaturado: 100 }),
      item({ linha: 2, verba: { vbz: 1, nome: "Frota Fixa Ativa" }, valorFaturado: 100 }),
      item({ linha: 3, verba: { vbz: 2, nome: "Equipe Entrega Ativa" }, valorFaturado: 200 }),
      item({ linha: 4, verba: { vbz: 2, nome: "Equipe Entrega Ativa" }, valorFaturado: 999 }),
    ];

    const resultado = consolidarDuplicatasExatas(itens);

    expect(resultado.itens.map((i) => i.linha)).toEqual([1, 3, 4]);
    expect(resultado.consolidadas).toEqual([
      { vbz: 1, nome: "Frota Fixa Ativa", bloco: "FRETE", linhaMantida: 1, linhasRemovidas: [2] },
    ]);
  });

  it("o total do bloco, somado sobre o resultado consolidado, conta a verba uma vez só", () => {
    const itens = [
      item({ linha: 9, verba: { vbz: 1, nome: "Frota Fixa Ativa" }, valorFaturado: 17_039.35 }),
      item({ linha: 10, verba: { vbz: 1, nome: "Frota Fixa Ativa" }, valorFaturado: 17_039.35 }),
    ];

    const { itens: consolidados } = consolidarDuplicatasExatas(itens);
    const total = consolidados.reduce((soma, i) => soma + i.valorFaturado, 0);

    expect(total).toBe(17_039.35);
  });
});
