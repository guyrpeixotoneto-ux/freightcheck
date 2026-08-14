import { describe, expect, it } from "vitest";
import { blocoQueOTermoNomeia } from "../ferramentas";

/**
 * O que estes testes protegem: **um** bloco por pergunta, e o mesmo para os dois
 * que perguntam.
 *
 * Quem lê a regra escrita e quem abre o arquivo anexado resolvem o mesmo bloco,
 * e essa concordância não pode depender de duas funções parecidas. Antes disto
 * ela dependia: a regra casava o título nos dois sentidos e o anexo exigia que
 * a chave do banco contivesse a frase inteira da pergunta. O efeito não era erro
 * em lugar nenhum — era a resposta anunciar que o bloco tem documento anexado, e
 * o documento não ir junto.
 */

const ENTRADAS = [
  { blockCategory: "Gente", blockTitle: "QLP ADM" },
  { blockCategory: "Gente", blockTitle: "DESCONTO QLP ADM" },
  { blockCategory: "Equipamentos", blockTitle: "PNEU" },
  { blockCategory: "Gente", blockTitle: "PLANO DE SAÚDE" },
];

describe("o bloco que o termo nomeia", () => {
  it("acha o bloco quando a pergunta traz mais que o título", () => {
    // A pergunta da tela: "QLP ADM como está de Camaçari?".
    expect(blocoQueOTermoNomeia(ENTRADAS, "qlp adm camacari")?.blockTitle).toBe("QLP ADM");
    expect(blocoQueOTermoNomeia(ENTRADAS, "pneu")?.blockTitle).toBe("PNEU");
  });

  it("acha o bloco quando o título traz mais que a pergunta", () => {
    expect(blocoQueOTermoNomeia(ENTRADAS, "saude")?.blockTitle).toBe("PLANO DE SAÚDE");
  });

  /*
    Dois blocos casam e o mais específico vence.

    Devolver "QLP ADM" a quem escreveu "desconto QLP ADM" responderia sobre o
    bloco vizinho — com o nome certo no título e a regra errada no corpo, que é
    a forma de errar mais difícil de perceber lendo.
  */
  it("prefere o título mais longo quando os dois casam", () => {
    expect(blocoQueOTermoNomeia(ENTRADAS, "desconto qlp adm")?.blockTitle).toBe(
      "DESCONTO QLP ADM",
    );
  });

  it("ignora acento e caixa, como o resto da busca", () => {
    expect(blocoQueOTermoNomeia(ENTRADAS, "Plano de Saúde")?.blockTitle).toBe("PLANO DE SAÚDE");
  });

  it("não inventa bloco quando a pergunta não nomeia nenhum", () => {
    expect(blocoQueOTermoNomeia(ENTRADAS, "indice de reajuste")).toBeNull();
    expect(blocoQueOTermoNomeia(ENTRADAS, "   ")).toBeNull();
    expect(blocoQueOTermoNomeia([], "pneu")).toBeNull();
  });
});
