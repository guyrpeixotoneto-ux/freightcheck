import { describe, expect, it } from "vitest";
import {
  nomeDaColunaPelaCategoria,
  normalizarCategoria,
  resolverValorDoContrato,
  type ValorDoContratoParaComparar,
} from "../grade-comparacao-frota";

/**
 * A COMPARAÇÃO DA GRADE DA FROTA — cobre o pedido de reaproveitar
 * `classificarCategoriaDeFrotaPromax` (de `@workspace/fechamento`) na tela de
 * leitura por imagem, em vez de inventar um de-para paralelo.
 */

function mapaDoContrato(
  entradas: [linha: string, coluna: string, valor: ValorDoContratoParaComparar][],
): Map<string, ValorDoContratoParaComparar> {
  const mapa = new Map<string, ValorDoContratoParaComparar>();
  for (const [linha, coluna, valor] of entradas) {
    mapa.set(`${normalizarCategoria(linha)}|${normalizarCategoria(coluna)}`, valor);
  }
  return mapa;
}

describe("resolverValorDoContrato", () => {
  it("nome idêntico continua comparando — ex.: Noturna bate com Noturna", () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Noturna", { valor: 1, dinheiro: false }],
    ]);
    const resultado = resolverValorDoContrato(mapa, "Total Veículos", "Noturna", "ATIVA");
    expect(resultado).toEqual({ valor: 1, dinheiro: false, porCategoria: false });
  });

  it('"Padrão" encontra a categoria equivalente do contrato — Frota Ativa', () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Frota Ativa", { valor: 23, dinheiro: false }],
    ]);
    const resultado = resolverValorDoContrato(mapa, "Total Veículos", "Padrão", "ATIVA");
    expect(resultado).toEqual({ valor: 23, dinheiro: false, porCategoria: true });
  });

  it('"Fixo" encontra a categoria equivalente do contrato — Van Ativa, não Frota Ativa', () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Frota Ativa", { valor: 23, dinheiro: false }],
      ["Total Veículos", "Van Ativa", { valor: 3, dinheiro: false }],
    ]);
    const resultado = resolverValorDoContrato(mapa, "Total Veículos", "Fixo", "ATIVA");
    expect(resultado).toEqual({ valor: 3, dinheiro: false, porCategoria: true });
  });

  it("a mesma categoria aponta para a coluna inativa quando a situação é inativa", () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Frota Inativa", { valor: 2, dinheiro: false }],
    ]);
    const resultado = resolverValorDoContrato(mapa, "Total Veículos", "Padrão", "INATIVA");
    expect(resultado).toEqual({ valor: 2, dinheiro: false, porCategoria: true });
  });

  it("categoria desconhecida não compara automaticamente", () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Frota Ativa", { valor: 23, dinheiro: false }],
    ]);
    expect(resolverValorDoContrato(mapa, "Total Veículos", "MKT", "ATIVA")).toBeUndefined();
    expect(
      resolverValorDoContrato(mapa, "Total Veículos", "Refrigeração", "ATIVA"),
    ).toBeUndefined();
  });

  it("sem situação conhecida, a via por categoria não se aplica — só o nome literal", () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Frota Ativa", { valor: 23, dinheiro: false }],
    ]);
    expect(resolverValorDoContrato(mapa, "Total Veículos", "Padrão", null)).toBeUndefined();
  });

  it("valores diferentes em categorias equivalentes aparecem como divergência, não como correspondência: o resolvedor devolve o valor do contrato, e é quem chama que compara e decide bater/não bater", () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Frota Ativa", { valor: 23, dinheiro: false }],
    ]);
    const doContrato = resolverValorDoContrato(mapa, "Total Veículos", "Padrão", "ATIVA");
    expect(doContrato?.valor).toBe(23);
    const valorLidoNaImagem = 20;
    const bate = Math.abs(valorLidoNaImagem - (doContrato?.valor ?? NaN)) < 0.01;
    expect(bate).toBe(false);
  });

  it("categoria reconhecida sem a coluna equivalente no contrato não compara — não inventa um número", () => {
    const mapa = mapaDoContrato([
      ["Total Veículos", "Noturna", { valor: 1, dinheiro: false }],
    ]);
    expect(resolverValorDoContrato(mapa, "Total Veículos", "Padrão", "ATIVA")).toBeUndefined();
  });
});

describe("nomeDaColunaPelaCategoria", () => {
  it("frota fixa mapeia para Frota Ativa/Inativa conforme a situação", () => {
    expect(nomeDaColunaPelaCategoria("FROTA_FIXA", "ATIVA")).toBe("Frota Ativa");
    expect(nomeDaColunaPelaCategoria("FROTA_FIXA", "INATIVA")).toBe("Frota Inativa");
  });

  it("van mapeia para Van Ativa/Inativa conforme a situação", () => {
    expect(nomeDaColunaPelaCategoria("VAN", "ATIVA")).toBe("Van Ativa");
    expect(nomeDaColunaPelaCategoria("VAN", "INATIVA")).toBe("Van Inativa");
  });
});
