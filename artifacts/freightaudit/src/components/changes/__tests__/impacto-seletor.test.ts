import { describe, expect, it } from "vitest";
import { gruposDoSeletor } from "../impacto-quinzenas";

/**
 * O seletor de parâmetro da aba Impacto, nos seus dois níveis.
 *
 * O que este arquivo protege é a diferença entre **ordenar** e **filtrar**. O
 * seletor sempre listou todos os parâmetros numéricos do equipamento, e a razão
 * está em `listImpactParameters`: esconder os demais responderia "esse parâmetro
 * não existe" a quem procura por um que existe e ainda não foi confirmado.
 *
 * O que faltava era por onde começar quando a tela é de um ativo só. Dentro de
 * `Cavalo 360° · QYP3G72` a lista tem dezenas de colunas e o cavalo mexeu em
 * três; achar as três custava abrir uma a uma. Os blocos passam a responder isso
 * — e a lista continua inteira, que é a asserção mais importante daqui.
 */

const p = (
  code: string,
  somavel: boolean,
  alterado: boolean | null = null,
) => ({ code, title: code, somavel, alterado });

describe("gruposDoSeletor", () => {
  it("na leitura de frota, divide por quem sustenta dinheiro", () => {
    const grupos = gruposDoSeletor(
      [p("cavalo.ipva", true), p("cavalo.finame", false)],
      "CAVALO",
    );

    expect(grupos.map((g) => g.rotulo)).toEqual([
      "sustentam soma de dinheiro",
      "ainda sem semântica confirmada",
    ]);
  });

  it("com um ativo aberto, divide por quem mexeu nele — e conta", () => {
    const grupos = gruposDoSeletor(
      [
        p("cavalo.ipva", true, true),
        p("cavalo.finame", false, true),
        p("cavalo.pneus", true, false),
      ],
      "CAVALO",
    );

    expect(grupos[0].rotulo).toBe("mudaram neste cavalo (2)");
    expect(grupos[0].itens.map((i) => i.code)).toEqual([
      "cavalo.ipva",
      "cavalo.finame",
    ]);
    expect(grupos[1].rotulo).toBe("sem alteração no recorte");
    expect(grupos[1].itens.map((i) => i.code)).toEqual(["cavalo.pneus"]);
  });

  it("ordena, e não filtra: a lista inteira sobrevive aos dois modos", () => {
    const todos = [
      p("cavalo.ipva", true, false),
      p("cavalo.finame", false, true),
      p("cavalo.pneus", true, false),
    ];

    const codigos = gruposDoSeletor(todos, "CAVALO")
      .flatMap((g) => g.itens.map((i) => i.code))
      .sort();

    expect(codigos).toEqual(["cavalo.finame", "cavalo.ipva", "cavalo.pneus"]);
  });

  it("bloco vazio não é escrito", () => {
    /*
      Um cavalo que não mexeu em nada tem o primeiro bloco vazio, e um
      `optgroup` sem opção é um rótulo prometendo o que não está ali. O segundo
      continua, com a lista inteira debaixo dele.
    */
    const grupos = gruposDoSeletor(
      [p("cavalo.ipva", true, false), p("cavalo.pneus", true, false)],
      "CAVALO",
    );

    expect(grupos.map((g) => g.rotulo)).toEqual(["sem alteração no recorte"]);
    expect(grupos[0].itens).toHaveLength(2);
  });

  it("o rótulo segue o equipamento da tela", () => {
    const grupos = gruposDoSeletor([p("carreta.ipva", true, true)], "CARRETA");
    expect(grupos[0].rotulo).toBe("mudaram nesta carreta (1)");
  });
});
