import { describe, expect, it } from "vitest";
import {
  rotuloDoTipo,
  TIPO_NAO_INFORMADO,
  TIPOS_DE_OPERACAO,
  TIPOS_PARA_LER,
} from "../fechamento";

/**
 * Abrir e consultar pedem listas diferentes de Tipo — e a diferença é o defeito
 * que este arquivo prende.
 *
 * Quem **abre** não pode escolher `NAO_INFORMADO`: seria dizer "não sei" num
 * campo que a operação decidiu que é obrigatório, e o servidor o recusa na
 * porta (`normalizarTipoDeOperacao`, em `@workspace/fechamento`). Quem
 * **consulta** precisa alcançá-lo: todo fechamento aberto antes da `0046`
 * carrega esse carimbo, porque o backfill não adivinhou de qual operação cada
 * um era. Um seletor de leitura com a lista de abertura deixa o acervo inteiro
 * sem endereço — a unidade certa, a transportadora certa, o mês certo, e mesmo
 * assim nada na tela.
 */

describe("as duas listas de Tipo", () => {
  it("abrir oferece só os tipos que alguém pode declarar", () => {
    expect(TIPOS_DE_OPERACAO.map((t) => t.valor)).toEqual(["EMPURRADA", "ROTA"]);
  });

  it("abrir nunca oferece o carimbo do backfill", () => {
    expect(TIPOS_DE_OPERACAO.some((t) => t.valor === TIPO_NAO_INFORMADO)).toBe(false);
  });

  it("consultar alcança tudo que o banco pode ter, o carimbo inclusive", () => {
    expect(TIPOS_PARA_LER.map((t) => t.valor)).toEqual([
      "EMPURRADA",
      "ROTA",
      TIPO_NAO_INFORMADO,
    ]);
  });

  it("ler é um superconjunto de abrir: nenhum tipo que se abre fica sem consulta", () => {
    for (const t of TIPOS_DE_OPERACAO) {
      expect(TIPOS_PARA_LER.some((l) => l.valor === t.valor)).toBe(true);
    }
  });
});

describe("rotuloDoTipo", () => {
  it("escreve o carimbo por extenso, e não como se fosse uma operação", () => {
    expect(rotuloDoTipo(TIPO_NAO_INFORMADO)).toBe("tipo não informado");
  });

  it("escreve os dois tipos reais como a tela os mostra", () => {
    expect(rotuloDoTipo("EMPURRADA")).toBe("Empurrada");
    expect(rotuloDoTipo("ROTA")).toBe("Rota");
  });

  it("devolve o valor cru para um tipo que ainda não tem rótulo, sem inventar um", () => {
    expect(rotuloDoTipo("TRANSFERENCIA")).toBe("TRANSFERENCIA");
  });
});
