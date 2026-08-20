import { describe, expect, it } from "vitest";

import { diagnosticarPagamento } from "../diagnostico-pagamento";
import { conferirDePara } from "../de-para";
import { lerPagamento } from "../leitores/pagamento";
import { fixturePagamento1aQuinzenaReal } from "./fixtures";

/**
 * O 03.08.20 real de uma 1ª quinzena, lido verba a verba.
 *
 * **A pergunta que este arquivo responde.** Uma competência mostrava o 03.08.20
 * na lista de relatórios, com nome e "14 linhas", e o painel da planilha dizia
 * que ele não tinha sido importado. Havia duas explicações possíveis — o arquivo
 * não tem verba, ou o leitor não a reconhece — e este teste elimina as duas: o
 * arquivo tem dez verbas, o leitor lê as dez, e os totais que ele fecha são os
 * que o próprio relatório imprime no rodapé de cada canal.
 *
 * Os valores abaixo são os do arquivo, transcritos à mão do papel. É o que faz
 * deste teste uma conferência e não um retrato: um leitor que passasse a somar
 * errado continuaria "passando" contra um `toMatchSnapshot`.
 */
describe("o 03.08.20 real da 1ª quinzena", () => {
  const lido = lerPagamento(fixturePagamento1aQuinzenaReal());

  it("declara o próprio período, a unidade e a transportadora", () => {
    expect(lido.periodo).toEqual({ inicio: "2026-07-01", fim: "2026-07-15" });
    expect(lido.unidade).toEqual({ codigo: "081-0443", nome: "CRBS SA - CDD Belem" });
    expect(lido.transportadora?.codigo).toBe("36");
  });

  it("traz dez verbas — seis na Rota e quatro no AS", () => {
    expect(lido.itens).toHaveLength(10);
    expect(lido.itens.filter((i) => i.canal === "ROTA").map((i) => i.verba.vbz)).toEqual([
      1, 2, 3, 4, 5, 7,
    ]);
    expect(lido.itens.filter((i) => i.canal === "AS").map((i) => i.verba.vbz)).toEqual([
      20, 23, 24, 26,
    ]);
    /* Todas no bloco de frete: a 1ª quinzena não tem `OUTROS CUSTOS`. */
    expect(new Set(lido.itens.map((i) => i.bloco))).toEqual(new Set(["FRETE"]));
  });

  it("lê as seis colunas de cada verba como o papel as imprime", () => {
    const frotaFixaAtiva = lido.itens.find((i) => i.canal === "ROTA" && i.verba.vbz === 1)!;
    expect(frotaFixaAtiva.nomeNoArquivo).toBe("Frota Fixa Ativa");
    expect(frotaFixaAtiva.semImposto).toBe(65911.23);
    expect(frotaFixaAtiva.nfIss).toBe(2454.68);
    expect(frotaFixaAtiva.ctrcIcms).toBe(87905.85);
    expect(frotaFixaAtiva.valorFaturado).toBe(90360.53);
    expect(frotaFixaAtiva.vlcNfIss).toBe(2227.62);
    expect(frotaFixaAtiva.vlcCtrcIcms).toBe(79774.57);
  });

  it("a linha de centro de custo não vira verba nem desconto", () => {
    /* `(71027001 BRALLLV234)` vem logo abaixo de cada verba. Ela não tem valor
       em reais, e é isso que a mantém fora das duas listas — nunca uma regra
       sobre parênteses, que o rótulo de desconto também usa. */
    expect(lido.itens).toHaveLength(10);
    expect(lido.descontos.map((d) => d.tipo).sort()).toEqual([
      "DEVOLUCAO",
      "DEVOLUCAO",
      "FRETE_MINIMO",
      "FRETE_MINIMO",
    ]);
  });

  it("soma o mesmo `Total Frete` que o relatório imprime, nos dois canais", () => {
    const somaCtrc = (canal: "ROTA" | "AS") =>
      Number(
        lido.itens
          .filter((i) => i.canal === canal)
          .reduce((t, i) => t + i.ctrcIcms, 0)
          .toFixed(2),
      );
    expect(somaCtrc("ROTA")).toBe(1056834.26);
    expect(somaCtrc("AS")).toBe(42587.82);
    /* E o `Total Remuneração` de cada canal, que o leitor lê à parte. */
    expect(lido.totais).toEqual([
      { canal: "ROTA", total: 1084580.45 },
      { canal: "AS", total: 42587.82 },
    ]);
  });

  it("`linhas_lidas` é 14 — dez verbas e quatro descontos", () => {
    /* É o número que a tela mostrava enquanto o painel dizia que o arquivo não
       tinha sido importado. Ele nunca foi o sintoma: era a soma certa. */
    expect(lido.itens.length + lido.descontos.length).toBe(14);
  });

  it("o diagnóstico do arquivo é o de um arquivo que lê normalmente", () => {
    const d = diagnosticarPagamento(fixturePagamento1aQuinzenaReal());
    expect(d.causa).toBe("LEU_NORMALMENTE");
    expect(d.lido.verbas).toBe(10);
    expect(d.suspeitas).toEqual([]);
  });

  it("o painel da planilha se monta com ele, e fecha no total do relatório", () => {
    const painel = conferirDePara(lido, { canal: "ROTA" });
    expect(painel.totalDoRelatorio).toBe(1084580.45);
  });
});
