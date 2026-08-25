import { describe, expect, it } from "vitest";
import { classificarCategoriaDeFrotaPromax } from "../frota-promax-categorias";

/**
 * A CLASSIFICAÇÃO DE CATEGORIA DA FROTA PROMAX — a única regra usada tanto
 * pela comparação real (`frota-promax-comparacao.ts`) quanto pela leitura por
 * imagem (`grade-comparacao-frota.ts`, no frontend).
 */

describe("classificarCategoriaDeFrotaPromax", () => {
  it("PADRAO é frota fixa — confirmado pela print real (23 veículos, custo fixo R$ 494,22 batendo com Frota Ativa)", () => {
    expect(classificarCategoriaDeFrotaPromax("Padrão")).toBe("FROTA_FIXA");
    expect(classificarCategoriaDeFrotaPromax("PADRAO")).toBe("FROTA_FIXA");
    expect(classificarCategoriaDeFrotaPromax("padrão")).toBe("FROTA_FIXA");
  });

  it("FIXO é van — confirmado pela mesma print (3 veículos, custo de equipe R$ 4.734,11 batendo com Van Ativa), não frota fixa apesar do nome", () => {
    expect(classificarCategoriaDeFrotaPromax("Fixo")).toBe("VAN");
    expect(classificarCategoriaDeFrotaPromax("FIXO")).toBe("VAN");
  });

  it("os aliases já existentes continuam reconhecidos", () => {
    expect(classificarCategoriaDeFrotaPromax("FF")).toBe("FROTA_FIXA");
    expect(classificarCategoriaDeFrotaPromax("FIXA")).toBe("FROTA_FIXA");
    expect(classificarCategoriaDeFrotaPromax("FROTA FIXA")).toBe("FROTA_FIXA");
    expect(classificarCategoriaDeFrotaPromax("VAN")).toBe("VAN");
    expect(classificarCategoriaDeFrotaPromax("VANS")).toBe("VAN");
  });

  it("categoria desconhecida não recebe classificação — não inventa correspondência", () => {
    expect(classificarCategoriaDeFrotaPromax("MKT")).toBeNull();
    expect(classificarCategoriaDeFrotaPromax("Refrigeração")).toBeNull();
    expect(classificarCategoriaDeFrotaPromax("Especial")).toBeNull();
    expect(classificarCategoriaDeFrotaPromax("Recarga")).toBeNull();
    expect(classificarCategoriaDeFrotaPromax("Quitado")).toBeNull();
    expect(classificarCategoriaDeFrotaPromax("Finame")).toBeNull();
  });

  it("categoria ausente não recebe classificação", () => {
    expect(classificarCategoriaDeFrotaPromax(null)).toBeNull();
  });
});
