import { describe, expect, it } from "vitest";

import { achadoDaLinha } from "../resumo-geral";
import type { ConjuntoComparado, LinhaComparada, TresColunas } from "@/lib/fechamento";

/**
 * A COLUNA `AUDITAR` — a que deve viver vazia.
 *
 * O servidor decide **o que** auditar; esta tela decide **como isso se lê numa
 * tabela de vinte linhas**. É a segunda decisão que este arquivo prende, e ela
 * tem três partes:
 *
 * 1. A linha que se sustenta não ganha marca nenhuma. Uma coluna que marca tudo
 *    não diz nada.
 * 2. Uma divergência e um documento que falta ganham marcas **diferentes**, e
 *    ganham porque pedem trabalhos diferentes: uma é conta a refazer, a outra é
 *    arquivo a procurar.
 * 3. A divergência de um conjunto aparece em **todas** as linhas dele. O
 *    relatório não parte o número; marcar uma só seria escolher uma culpada por
 *    sorteio.
 */

const TRES = (v: number | null): TresColunas => ({ primeira: v, segunda: v, total: v });

const linha = (parcial: Partial<LinhaComparada>): LinhaComparada =>
  ({
    chave: "x",
    rotulo: "X",
    nome: "X",
    papel: "PARCELA",
    devido: TRES(100),
    demonstrado: TRES(100),
    diferenca: TRES(0),
    conjunto: null,
    memoria: { primeira: null, segunda: null },
    falta: null,
    planilha: null,
    diferencaDaPlanilha: null,
    celulaDaPlanilha: null,
    causaConhecida: null,
    auditar: null,
    ...parcial,
  }) as LinhaComparada;

const conjunto = (auditar: string | null): ConjuntoComparado => ({
  chave: "fixo_bruto",
  nome: "Custo fixo bruto",
  linhas: ["a", "b"],
  devido: TRES(100),
  demonstrado: TRES(90),
  diferenca: TRES(10),
  porque: "o relatório não parte",
  auditar,
});

describe("a marca de auditoria", () => {
  it("não existe na linha que se sustenta", () => {
    expect(achadoDaLinha(linha({}), null)).toBeNull();
  });

  it("a linha em conjunto que fecha também não ganha marca", () => {
    /* Sem demonstrado próprio e sem achado no conjunto: nada a auditar. */
    expect(achadoDaLinha(linha({ demonstrado: TRES(null) }), conjunto(null))).toBeNull();
  });

  it("os dois lados existem e discordam: `Não bate`", () => {
    const achado = achadoDaLinha(
      linha({ demonstrado: TRES(90), diferenca: TRES(10), auditar: "discordam em R$ 10,00" }),
      null,
    );
    expect(achado).toEqual({ onde: "LINHA", marca: "Não bate", texto: "discordam em R$ 10,00" });
  });

  it("devido em dinheiro e nenhum demonstrado: `Sem lastro`", () => {
    /*
      Marca diferente de propósito. Quem varre a coluna procurando conta errada
      não deve parar aqui, e quem varre procurando arquivo faltando deve.
    */
    const achado = achadoDaLinha(
      linha({
        demonstrado: TRES(null),
        diferenca: TRES(null),
        auditar: "o 03.08.20 não traz linha que corresponda",
      }),
      null,
    );
    expect(achado?.marca).toBe("Sem lastro");
    expect(achado?.onde).toBe("LINHA");
  });

  it("a divergência do conjunto marca a linha, e diz que é do conjunto", () => {
    const achado = achadoDaLinha(
      linha({ demonstrado: TRES(null), diferenca: TRES(null) }),
      conjunto("a soma das 5 e o número do relatório discordam"),
    );
    expect(achado).toEqual({
      onde: "CONJUNTO",
      marca: "Conjunto não bate",
      texto: "a soma das 5 e o número do relatório discordam",
    });
  });

  it("o achado da própria linha ganha do achado do conjunto", () => {
    /*
      Uma linha que discorda por conta própria tem o que dizer de si mesma; a
      frase do conjunto ficaria por cima de um número que é dela.
    */
    const achado = achadoDaLinha(
      linha({ demonstrado: TRES(90), diferenca: TRES(10), auditar: "desta linha" }),
      conjunto("do conjunto"),
    );
    expect(achado?.texto).toBe("desta linha");
  });
});
