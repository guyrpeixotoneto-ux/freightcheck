import { describe, expect, it } from "vitest";
import { EQUIPAMENTOS_DO_AMBIENTE } from "@/lib/frota";
import { ehTipoDaLinhaDoTempo } from "@workspace/comparison/tipos";

/**
 * O encaixe entre as duas listas de tipo.
 *
 * A tela oferece os equipamentos do **ambiente aberto**
 * (`EQUIPAMENTOS_DO_AMBIENTE`); o servidor aceita os equipamentos que o produto
 * **importa** (`TIPOS_DA_LINHA_DO_TEMPO`, derivada de `TIPOS_DE_IMPORTACAO`).
 * As duas respondem perguntas diferentes e por isso continuam sendo duas — mas
 * uma precisa caber dentro da outra, e nada além deste caso garante isso.
 *
 * O defeito que ele impede é concreto e silencioso: um ativo novo declarado só
 * em `EQUIPAMENTOS_DO_AMBIENTE` viraria pastilha na Linha do Tempo e no Painel
 * de Justificativas, e o servidor o descartaria como endereço adulterado —
 * devolvendo a leitura **sem recorte** sob uma pastilha que diz um tipo só. Não
 * é tela vazia, que se percebe: é a frota inteira com o nome de uma parte dela.
 */
describe("o que a tela oferece cabe no que o servidor aceita", () => {
  it("todo equipamento de todo ambiente é um tipo válido do recorte", () => {
    for (const [ambiente, equipamentos] of Object.entries(EQUIPAMENTOS_DO_AMBIENTE)) {
      for (const equipamento of equipamentos) {
        expect(
          ehTipoDaLinhaDoTempo(equipamento),
          `${equipamento} está em ${ambiente} e o recorte não o aceita`,
        ).toBe(true);
      }
    }
  });

  it("o QLP não é equipamento de ambiente nenhum — ele tem vigência própria", () => {
    const todos = Object.values(EQUIPAMENTOS_DO_AMBIENTE).flat() as string[];
    expect(todos).not.toContain("QLP_ADMINISTRATIVO");
    expect(todos).not.toContain("QLP_OPERACIONAL");
    expect(ehTipoDaLinhaDoTempo("QLP_ADMINISTRATIVO")).toBe(false);
    expect(ehTipoDaLinhaDoTempo("CONJUNTO")).toBe(false);
  });
});
