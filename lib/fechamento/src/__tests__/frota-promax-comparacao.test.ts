import { describe, expect, it } from "vitest";
import {
  agruparFrotaPromax,
  compararFrotaPromax,
  compararFrotaPromaxContraContrato,
  type ContratoParaComparacaoDeFrota,
} from "../frota-promax-comparacao";
import type { VeiculoDaFrotaPromax } from "../leitores/frota-promax";

/**
 * A COMPARAÇÃO PROMAX × CONTRATO — pura, e sem escolher vencedor em conflito.
 *
 * Cobre os requisitos 5, 6 e 7 do pedido: comparação contra referências
 * nomeadas (não hardcoded a uma fonte fixa), agrupamento por unidade + modelo/
 * categoria + situação com quantidade/diferença/movimento, e conflito que
 * devolve `total: null` com evidência em vez de escolher um valor.
 */

let seq = 0;
function veiculo(v: Partial<VeiculoDaFrotaPromax> & { placa: string }): VeiculoDaFrotaPromax {
  seq += 1;
  return {
    linha: seq,
    situacao: "ATIVA",
    unidade: "443",
    modelo: "TRUCK VW 24.280",
    categoria: "FF",
    ...v,
  };
}

describe("agruparFrotaPromax — a contagem por (unidade, modelo, situação)", () => {
  it("conta placas distintas, não linhas — duas remessas da mesma placa contam uma vez", () => {
    const veiculos = [
      veiculo({ placa: "ABC1D23" }),
      veiculo({ placa: "ABC1D23" }), // a mesma placa, repetida (duas remessas do mesmo relatório)
      veiculo({ placa: "XYZ9W88" }),
    ];
    const { contagens, conflitos } = agruparFrotaPromax(veiculos);
    expect(conflitos).toEqual([]);
    const grupo = [...contagens.values()][0]!;
    expect(grupo.placas.size).toBe(2);
  });

  it("unidades e modelos diferentes formam grupos diferentes", () => {
    const veiculos = [
      veiculo({ placa: "ABC1D23", unidade: "443" }),
      veiculo({ placa: "DEF2E34", unidade: "081" }),
      veiculo({ placa: "GHI3F45", modelo: "VAN FIORINO", categoria: "VAN" }),
    ];
    const { contagens } = agruparFrotaPromax(veiculos);
    expect(contagens.size).toBe(3);
  });

  it("ativa e inativa da mesma unidade/modelo são grupos diferentes", () => {
    const veiculos = [
      veiculo({ placa: "ABC1D23", situacao: "ATIVA" }),
      veiculo({ placa: "DEF2E34", situacao: "INATIVA" }),
    ];
    const { contagens } = agruparFrotaPromax(veiculos);
    expect(contagens.size).toBe(2);
  });
});

describe("conflito — a mesma placa como ativa e inativa não escolhe um total", () => {
  it("devolve quantidadePromax: null e a evidência das duas linhas em disputa", () => {
    const veiculos = [
      veiculo({ placa: "ABC1D23", situacao: "ATIVA", linha: 5 }),
      veiculo({ placa: "ABC1D23", situacao: "INATIVA", linha: 9 }),
    ];
    const resultado = compararFrotaPromax(veiculos, () => []);
    expect(resultado.conflitos).toHaveLength(1);
    expect(resultado.conflitos[0]!.evidencia.map((e) => e.linha).sort()).toEqual([5, 9]);
    expect(resultado.conflitos[0]!.evidencia.every((e) => e.placa === "ABC1D23")).toBe(true);

    const grupoEmConflito = resultado.grupos.find((g) => g.quantidadePromax === null);
    expect(grupoEmConflito).toBeDefined();
    expect(grupoEmConflito!.quantidadePromax).toBeNull();
  });

  it("um conflito não impede o resto da comparação de fechar normalmente", () => {
    const veiculos = [
      veiculo({ placa: "ABC1D23", situacao: "ATIVA" }),
      veiculo({ placa: "ABC1D23", situacao: "INATIVA" }),
      veiculo({ placa: "SEM9C0N", unidade: "081", situacao: "ATIVA" }),
    ];
    const resultado = compararFrotaPromax(veiculos, () => []);
    const semConflito = resultado.grupos.find((g) => g.unidade === "081");
    expect(semConflito?.quantidadePromax).toBe(1);
  });

  it("a mesma placa repetida na mesma situação não é conflito", () => {
    const veiculos = [
      veiculo({ placa: "ABC1D23", situacao: "ATIVA" }),
      veiculo({ placa: "ABC1D23", situacao: "ATIVA" }),
    ];
    const resultado = compararFrotaPromax(veiculos, () => []);
    expect(resultado.conflitos).toEqual([]);
  });
});

describe("compararFrotaPromax — o movimento contra uma referência nomeada", () => {
  it("IGUAL quando Promax e referência batem", () => {
    const veiculos = [veiculo({ placa: "A1" }), veiculo({ placa: "A2" })];
    const r = compararFrotaPromax(veiculos, () => [{ nome: "Contrato", quantidade: 2 }]);
    expect(r.grupos[0]!.referencias[0]!.movimento).toBe("IGUAL");
    expect(r.grupos[0]!.referencias[0]!.diferenca).toBe(0);
  });

  it("SUBIU quando o Promax tem mais que a referência", () => {
    const veiculos = [veiculo({ placa: "A1" }), veiculo({ placa: "A2" }), veiculo({ placa: "A3" })];
    const r = compararFrotaPromax(veiculos, () => [{ nome: "Contrato", quantidade: 2 }]);
    expect(r.grupos[0]!.referencias[0]!.movimento).toBe("SUBIU");
    expect(r.grupos[0]!.referencias[0]!.diferenca).toBe(1);
  });

  it("DESCEU quando o Promax tem menos que a referência", () => {
    const veiculos = [veiculo({ placa: "A1" })];
    const r = compararFrotaPromax(veiculos, () => [{ nome: "Contrato", quantidade: 3 }]);
    expect(r.grupos[0]!.referencias[0]!.movimento).toBe("DESCEU");
    expect(r.grupos[0]!.referencias[0]!.diferenca).toBe(-2);
  });

  it("SEM_COMPARACAO quando não há referência para o grupo", () => {
    const veiculos = [veiculo({ placa: "A1" })];
    const r = compararFrotaPromax(veiculos, () => []);
    expect(r.grupos[0]!.referencias).toEqual([]);
  });

  it("o sistema nunca escolhe qual número está certo — os dois números e a diferença vêm sempre juntos", () => {
    const veiculos = [veiculo({ placa: "A1" }), veiculo({ placa: "A2" })];
    const r = compararFrotaPromax(veiculos, () => [{ nome: "Contrato", quantidade: 5 }]);
    const ref = r.grupos[0]!.referencias[0]!;
    expect(r.grupos[0]!.quantidadePromax).toBe(2);
    expect(ref.quantidade).toBe(5);
    expect(ref.diferenca).toBe(2 - 5);
  });

  it("mais de uma referência nomeada pode se aplicar ao mesmo grupo — a lista não é fixa numa fonte só", () => {
    const veiculos = [veiculo({ placa: "A1" })];
    const r = compararFrotaPromax(veiculos, () => [
      { nome: "Cadastro do contrato", quantidade: 1 },
      { nome: "Resumo SR Trans do FT", quantidade: 2 },
    ]);
    expect(r.grupos[0]!.referencias.map((x) => x.nome)).toEqual([
      "Cadastro do contrato",
      "Resumo SR Trans do FT",
    ]);
    expect(r.grupos[0]!.referencias[0]!.movimento).toBe("IGUAL");
    expect(r.grupos[0]!.referencias[1]!.movimento).toBe("DESCEU");
  });
});

describe("compararFrotaPromaxContraContrato — a v1 ligada ao cadastro", () => {
  const contrato: ContratoParaComparacaoDeFrota = {
    frotaFixaAtiva: 2,
    frotaFixaInativa: 1,
    vansAtivas: 1,
    vansInativas: 0,
  };

  it("categoria FF compara contra frotaFixaAtiva/Inativa", () => {
    const veiculos = [
      veiculo({ placa: "A1", categoria: "FF", situacao: "ATIVA" }),
      veiculo({ placa: "A2", categoria: "FF", situacao: "ATIVA" }),
    ];
    const r = compararFrotaPromaxContraContrato(veiculos, contrato);
    const grupo = r.grupos.find((g) => g.situacao === "ATIVA")!;
    expect(grupo.referencias[0]!.nome).toMatch(/frota fixa/i);
    expect(grupo.referencias[0]!.quantidade).toBe(2);
    expect(grupo.referencias[0]!.movimento).toBe("IGUAL");
  });

  it("categoria VAN compara contra vansAtivas/Inativas", () => {
    const veiculos = [veiculo({ placa: "V1", categoria: "VAN", modelo: "FIORINO", situacao: "ATIVA" })];
    const r = compararFrotaPromaxContraContrato(veiculos, contrato);
    expect(r.grupos[0]!.referencias[0]!.nome).toMatch(/van/i);
    expect(r.grupos[0]!.referencias[0]!.quantidade).toBe(1);
  });

  it("categoria ausente ou não reconhecida não recebe referência — não arrisca somar do lado errado", () => {
    const veiculos = [veiculo({ placa: "A1", categoria: null })];
    const r = compararFrotaPromaxContraContrato(veiculos, contrato);
    expect(r.grupos[0]!.referencias).toEqual([]);
  });

  it("sem contrato (null), nenhum grupo recebe referência", () => {
    const veiculos = [veiculo({ placa: "A1", categoria: "FF" })];
    const r = compararFrotaPromaxContraContrato(veiculos, null);
    expect(r.grupos[0]!.referencias).toEqual([]);
  });

  it("Resumo SR Trans do FT (item 5) não é assumido — a v1 só compara contra o contrato", () => {
    /* Este teste é a documentação executável da decisão: não existe hoje um
       segundo item na lista de referências que a v1 monta, porque a natureza
       do "Resumo SR Trans" não foi confirmada. Quando ela for, este teste é o
       primeiro a mudar. */
    const veiculos = [veiculo({ placa: "A1", categoria: "FF" })];
    const r = compararFrotaPromaxContraContrato(veiculos, contrato);
    expect(r.grupos[0]!.referencias).toHaveLength(1);
  });
});
