import { describe, expect, it } from "vitest";

import { cnpjComMascara, lerCnpj, motivoDaRecusa } from "../unidade";

/**
 * O CNPJ como identidade — o que entra e o que é recusado.
 *
 * `trim()` não bastava, e é literalmente o que havia antes: `normalizarCodigo`,
 * em `@workspace/remuneracao`, apara o espaço e aceita o resto. Foi assim que
 * uma unidade acabou cadastrada com o código `CDD Belém` e o fechamento passou
 * a procurar por um nome.
 */
describe("lerCnpj", () => {
  /* CNPJs com verificadores corretos, um mascarado e um limpo. */
  const VALIDO = "11222333000181";
  const VALIDO_MASCARADO = "11.222.333/0001-81";

  it("aceita com máscara e guarda só dígitos", () => {
    expect(lerCnpj(VALIDO_MASCARADO).canonico).toBe(VALIDO);
  });

  it("aceita sem máscara e devolve o mesmo canônico", () => {
    expect(lerCnpj(VALIDO).canonico).toBe(VALIDO);
  });

  it("as duas grafias produzem a mesma identidade — é o ponto da normalização", () => {
    expect(lerCnpj(VALIDO_MASCARADO).canonico).toBe(lerCnpj(VALIDO).canonico);
  });

  it("aceita espaço em volta", () => {
    expect(lerCnpj(`  ${VALIDO_MASCARADO}  `).canonico).toBe(VALIDO);
  });

  it("recusa CPF no campo de CNPJ da unidade", () => {
    const lido = lerCnpj("529.982.247-25");
    expect(lido.canonico).toBeNull();
    expect(lido.recusa).toBe("E_CPF");
  });

  it("recusa dígito verificador errado", () => {
    const lido = lerCnpj("11222333000182");
    expect(lido.canonico).toBeNull();
    expect(lido.recusa).toBe("VERIFICADOR");
  });

  it("recusa catorze dígitos repetidos, que passam no módulo 11", () => {
    expect(lerCnpj("00000000000000").recusa).toBe("REPETIDO");
    expect(lerCnpj("11111111111111").recusa).toBe("REPETIDO");
  });

  it("recusa um nome — o defeito que originou este trabalho", () => {
    const lido = lerCnpj("CDD Belém");
    expect(lido.canonico).toBeNull();
    expect(lido.recusa).toBe("VAZIO");
  });

  it("recusa o código curto da Ambev", () => {
    expect(lerCnpj("443").recusa).toBe("TAMANHO");
    expect(lerCnpj("081-0443").recusa).toBe("TAMANHO");
  });

  it("recusa vazio", () => {
    expect(lerCnpj("").recusa).toBe("VAZIO");
    expect(lerCnpj("   ").recusa).toBe("VAZIO");
  });

  it("não reconstrói o zero à esquerda — cadastro é digitado, não lido de célula", () => {
    /*
      `normalizeDocumento`, do acervo, completa com zeros porque o Excel come o
      primeiro dígito de um número. Aqui completar seria inventar um documento
      que a pessoa não escreveu.
    */
    expect(lerCnpj("1222333000181").canonico).toBeNull();
    expect(lerCnpj("1222333000181").recusa).toBe("TAMANHO");
  });

  it("cada recusa tem um texto próprio — elas mandam fazer coisas diferentes", () => {
    const recusas = ["VAZIO", "E_CPF", "TAMANHO", "REPETIDO", "VERIFICADOR"] as const;
    const textos = recusas.map(motivoDaRecusa);
    expect(new Set(textos).size).toBe(recusas.length);
  });
});

describe("cnpjComMascara", () => {
  it("formata para exibir", () => {
    expect(cnpjComMascara("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("devolve como veio o que não é canônico, em vez de mascarar lixo", () => {
    expect(cnpjComMascara("443")).toBe("443");
  });
});
