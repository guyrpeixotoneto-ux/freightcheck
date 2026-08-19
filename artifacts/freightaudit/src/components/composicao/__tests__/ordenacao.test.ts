import { describe, expect, it } from "vitest";
import {
  ordenarLinhas,
  proximaOrdem,
  type OrdemDaFrota,
} from "../ordenacao";
import type { LinhaDaFrota } from "../tipos";

/**
 * A ordem da tabela da frota.
 *
 * O que se prova aqui é sobretudo uma coisa: **ausência não é zero**. A tabela
 * já separa `R$ 0,00` de "aguardando curadoria" célula a célula, e a ordenação
 * é o lugar onde essa distinção some sem ninguém ver — basta o comparador
 * somar `null` como zero para o equipamento que ninguém conseguiu apurar
 * aparecer no fundo da lista como o mais barato da frota. Os testes de `mensal`
 * e de `variacao` cobram a ausência no fim **nos dois sentidos**, que é a única
 * posição que não afirma nada sobre o valor que ela não tem.
 */

function linha(parcial: Partial<LinhaDaFrota> & { placa: string }): LinhaDaFrota {
  return {
    entityId: `id-${parcial.placa}`,
    chassi: null,
    entityType: "CAVALO",
    rotuloDoTipo: "Cavalos",
    unidade: null,
    operacao: null,
    effectiveDate: "2026-08-02",
    periodLabel: "Agosto/2026",
    presente: true,
    mensal: null,
    componentes: 0,
    semRegraFinanceira: 0,
    semClassificacao: 0,
    variacao: null,
    status: { farol: "NORMAL", motivos: [], alertas: 0, naoApuradoPor: null },
    ...parcial,
  };
}

const placas = (linhas: LinhaDaFrota[]) => linhas.map((l) => l.placa);

describe("proximaOrdem", () => {
  it("estreia o dinheiro do maior para o menor, e inverte no segundo clique", () => {
    const primeiro = proximaOrdem(null, "mensal");
    expect(primeiro).toEqual({ chave: "mensal", sentido: "desc" });
    expect(proximaOrdem(primeiro, "mensal")).toEqual({ chave: "mensal", sentido: "asc" });
  });

  it("estreia o texto de A a Z", () => {
    expect(proximaOrdem(null, "equipamento")).toEqual({
      chave: "equipamento",
      sentido: "asc",
    });
    expect(proximaOrdem(null, "unidade")).toEqual({ chave: "unidade", sentido: "asc" });
  });

  it("o terceiro clique devolve a ordem da casa", () => {
    // Sem esta volta não há como desfazer uma ordenação a não ser recarregando
    // a tela — e a ordem por placa é a única em que o leitor reencontra um
    // equipamento onde ele já sabia que estava.
    const ciclo = ["mensal", "variacao", "alertas", "equipamento", "unidade"] as const;
    for (const chave of ciclo) {
      const um = proximaOrdem(null, chave);
      const dois = proximaOrdem(um, chave);
      expect(proximaOrdem(dois, chave)).toBeNull();
    }
  });

  it("trocar de coluna recomeça pelo sentido de estreia daquela coluna", () => {
    const emAlertas: OrdemDaFrota = { chave: "alertas", sentido: "asc" };
    expect(proximaOrdem(emAlertas, "equipamento")).toEqual({
      chave: "equipamento",
      sentido: "asc",
    });
  });
});

describe("ordenarLinhas", () => {
  const frota = [
    linha({ placa: "AAA1", mensal: 1000 }),
    linha({ placa: "BBB2", mensal: null }),
    linha({ placa: "CCC3", mensal: 0 }),
    linha({ placa: "DDD4", mensal: 5000 }),
  ];

  it("sem ordem pedida, devolve a lista como chegou", () => {
    expect(ordenarLinhas(frota, null)).toBe(frota);
  });

  it("não reordena a lista de entrada no lugar", () => {
    const original = [...frota];
    ordenarLinhas(frota, { chave: "mensal", sentido: "desc" });
    expect(frota).toEqual(original);
  });

  it("do maior para o menor, com a ausência no fim", () => {
    expect(placas(ordenarLinhas(frota, { chave: "mensal", sentido: "desc" }))).toEqual([
      "DDD4",
      "AAA1",
      "CCC3",
      "BBB2",
    ]);
  });

  it("do menor para o maior, com a ausência ainda no fim", () => {
    /*
      O ponto do arquivo. `R$ 0,00` é o menor valor da frota e abre a lista;
      "aguardando curadoria" não é menor que ele — é a falta de um valor, e
      fica onde não afirma nada.
    */
    expect(placas(ordenarLinhas(frota, { chave: "mensal", sentido: "asc" }))).toEqual([
      "CCC3",
      "AAA1",
      "DDD4",
      "BBB2",
    ]);
  });

  it("o empate sai na ordem em que chegou — a do servidor, por placa", () => {
    const empatados = [
      linha({ placa: "AAA1", mensal: 900 }),
      linha({ placa: "BBB2", mensal: 900 }),
      linha({ placa: "CCC3", mensal: 900 }),
    ];
    expect(placas(ordenarLinhas(empatados, { chave: "mensal", sentido: "desc" }))).toEqual([
      "AAA1",
      "BBB2",
      "CCC3",
    ]);
    expect(placas(ordenarLinhas(empatados, { chave: "mensal", sentido: "asc" }))).toEqual([
      "AAA1",
      "BBB2",
      "CCC3",
    ]);
  });

  it("a variação ordena pelo valor com sinal, e não pelo módulo", () => {
    /*
      Esta é uma tela de custo: mil reais a mais e mil reais a menos são
      notícias opostas, e a célula pinta uma de vermelho e a outra de verde.
      Ordenar pelo módulo encostaria as duas no topo da mesma lista.
    */
    const variadas = [
      linha({ placa: "AAA1", variacao: { absoluta: -1000, percentual: -0.2 } }),
      linha({ placa: "BBB2", variacao: null }),
      linha({ placa: "CCC3", variacao: { absoluta: 300, percentual: 0.05 } }),
      linha({ placa: "DDD4", variacao: { absoluta: 0, percentual: 0 } }),
    ];
    expect(placas(ordenarLinhas(variadas, { chave: "variacao", sentido: "desc" }))).toEqual([
      "CCC3",
      "DDD4",
      "AAA1",
      "BBB2",
    ]);
    expect(placas(ordenarLinhas(variadas, { chave: "variacao", sentido: "asc" }))).toEqual([
      "AAA1",
      "DDD4",
      "CCC3",
      "BBB2",
    ]);
  });

  it("os alertas descem do mais problemático para o mais quieto", () => {
    const comAlertas = [
      linha({
        placa: "AAA1",
        status: { farol: "NORMAL", motivos: [], alertas: 0, naoApuradoPor: null },
      }),
      linha({
        placa: "BBB2",
        status: { farol: "CRITICO", motivos: [], alertas: 3, naoApuradoPor: null },
      }),
      linha({
        placa: "CCC3",
        status: { farol: "ATENCAO", motivos: [], alertas: 1, naoApuradoPor: null },
      }),
    ];
    expect(placas(ordenarLinhas(comAlertas, { chave: "alertas", sentido: "desc" }))).toEqual([
      "BBB2",
      "CCC3",
      "AAA1",
    ]);
  });

  it("a placa lê número como número, e não como texto", () => {
    // A mesma régua do servidor. Como texto, "ABC10" viria antes de "ABC9".
    const numeradas = [
      linha({ placa: "ABC10" }),
      linha({ placa: "ABC9" }),
      linha({ placa: "ABC2" }),
    ];
    expect(placas(ordenarLinhas(numeradas, { chave: "equipamento", sentido: "asc" }))).toEqual([
      "ABC2",
      "ABC9",
      "ABC10",
    ]);
  });

  it("a unidade ordena pelo rótulo inteiro que a célula mostra", () => {
    const porUnidade = [
      linha({ placa: "AAA1", unidade: "Jaguariúna", operacao: "Distribuição" }),
      linha({ placa: "BBB2", unidade: null, operacao: null }),
      linha({ placa: "CCC3", unidade: "Jaguariúna", operacao: "Coleta" }),
      linha({ placa: "DDD4", unidade: null, operacao: "Transferência" }),
    ];
    // "Jaguariúna · Coleta" antes de "Jaguariúna · Distribuição": a segunda
    // metade do rótulo entra na conta. E a linha sem unidade nem operação vai
    // para o fim, como toda ausência.
    expect(placas(ordenarLinhas(porUnidade, { chave: "unidade", sentido: "asc" }))).toEqual([
      "CCC3",
      "AAA1",
      "DDD4",
      "BBB2",
    ]);
    expect(placas(ordenarLinhas(porUnidade, { chave: "unidade", sentido: "desc" }))).toEqual([
      "DDD4",
      "AAA1",
      "CCC3",
      "BBB2",
    ]);
  });
});
