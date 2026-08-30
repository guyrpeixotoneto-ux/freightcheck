import { describe, expect, it } from "vitest";
import { EQUIPAMENTOS_DO_AMBIENTE, nomeDaAbaPorTipo } from "@/lib/frota";
import { ehTipoDaLinhaDoTempo } from "@workspace/comparison/tipos";

/**
 * A aba de tipo das duas telas que a têm — Linha do Tempo e Painel de
 * Justificativas —, e o que ela pode prometer.
 *
 * O defeito que isto trava é o de sempre nas telas de frota, e é o pior tipo de
 * defeito de rótulo: **uma aba que promete uma fila que a operação não tem**.
 * A empurrada roda com cavalo, carreta e trecho; o Rota e o AS, com caminhão e
 * carroceria; o Apoio, só com empilhadeira. Uma aba escrita à mão como "Cavalo,
 * Carreta e Trecho" ficaria certa na empurrada e mentiria nas outras três — e
 * mentiria em silêncio, porque a tela abriria normalmente, vazia.
 *
 * Por isso o nome sai de `EQUIPAMENTOS_DO_AMBIENTE`, a mesma lista que o menu e
 * as telas 360° leem. Estes casos são o que impede alguém de voltar a escrevê-lo
 * à mão sem que nada acuse.
 */
describe("o nome da aba sai do ambiente aberto", () => {
  it("na empurrada, é exatamente Cavalo, Carreta e Trecho", () => {
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE.auditoria)).toBe(
      "Cavalo, Carreta e Trecho",
    );
  });

  it("no Rota e no AS, é Caminhão e Carroceria — e não os três da empurrada", () => {
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE["auditoria-rota"])).toBe(
      "Caminhão e Carroceria",
    );
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE["auditoria-as"])).toBe(
      "Caminhão e Carroceria",
    );
  });

  it("no Apoio, um tipo só — sem o 'e' pendurado no fim", () => {
    expect(nomeDaAbaPorTipo(EQUIPAMENTOS_DO_AMBIENTE["auditoria-apoio"])).toBe(
      "Empilhadeira",
    );
  });

  it("nenhum ambiente fica sem nome de aba", () => {
    for (const equipamentos of Object.values(EQUIPAMENTOS_DO_AMBIENTE)) {
      expect(nomeDaAbaPorTipo(equipamentos).length).toBeGreaterThan(0);
    }
    // Lista vazia não acontece hoje, e mesmo assim não pode virar aba sem nome.
    expect(nomeDaAbaPorTipo([])).toBe("Por tipo");
  });
});

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
