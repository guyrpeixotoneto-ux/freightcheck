/**
 * A métrica que decide se este ciclo entregou investigação ou eloquência.
 *
 * **O defeito que ela corrige, dito uma vez.** A medida anterior
 * (`encadeamentoDe`, em `resposta.ts`) perguntava só "algum argumento desta
 * consulta aparece no resultado de alguma anterior?". Três coisas passavam por
 * ali e não deveriam:
 *
 * - um leque de consultas pedidas **na mesma rodada**, todas decididas antes de
 *   qualquer resultado existir — largura relatada como profundidade;
 * - um valor que **quem perguntou escreveu** ("e nos cavalos?") e que por
 *   coincidência aparece no resultado anterior — obediência relatada como
 *   descoberta;
 * - um valor que a própria investigação **já usava** antes da consulta de
 *   origem voltar — repetição relatada como reação.
 *
 * Os três inflam exatamente o número que este ciclo existe para subir, e os
 * três inflam mais quanto mais rica a investigação. Uma métrica que erra para
 * cima na direção da própria meta não é métrica: é a resposta escrita antes da
 * medição.
 *
 * Cada caso abaixo mede a versão nova **e** demonstra o que a antiga diria — a
 * régua velha está reescrita em `comoEra`, e é ela que dá o controle negativo
 * sem precisar de `git stash`.
 */

import { describe, expect, it } from "vitest";
import {
  derivacaoPorConsulta,
  encadeamentosDe,
  explicarEncadeamento,
  preplanejadas,
  quantosEncadeamentos,
  type ConsultaMedivel,
} from "../encadeamento";

/** A régua anterior, copiada de `resposta.ts` — o "antes" desta correção. */
function comoEra(chamadas: readonly ConsultaMedivel[]): (number | null)[] {
  const textos = chamadas.map((c) => JSON.stringify(c.conteudo ?? null));
  return chamadas.map((c, i) => {
    const valores = Object.values((c.argumentos ?? {}) as Record<string, unknown>)
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .map(String)
      .filter((v) => v.length >= 4);
    for (let j = i - 1; j >= 0; j--) {
      if (valores.some((v) => textos[j]!.includes(v))) return j;
    }
    return null;
  });
}

const contadas = (d: (number | null)[]) => d.filter((x) => x !== null).length;

describe("encadeamento verdadeiro", () => {
  it("a cadeia real é contada: o argumento não existia antes da consulta anterior", () => {
    const consultas: ConsultaMedivel[] = [
      {
        nome: "alteracoes",
        argumentos: { nivel: "grupos" },
        conteudo: { grupos: [{ atributo: "cavalo.finame", impacto: -52500 }] },
        rodada: 1,
      },
      {
        nome: "alteracoes",
        argumentos: { nivel: "linhas", atributo: "cavalo.finame" },
        conteudo: { linhas: [{ placa: "QYP3G72" }] },
        rodada: 2,
      },
      {
        nome: "proveniencia",
        argumentos: { alvo: "valor", placa: "QYP3G72", atributo: "cavalo.finame" },
        conteudo: { arquivo: { nome: "export.xlsx" } },
        rodada: 3,
      },
    ];

    const e = encadeamentosDe(consultas, "Por que a remuneração caiu em agosto?");
    expect(quantosEncadeamentos(e)).toBe(2);
    expect(derivacaoPorConsulta(3, e)).toEqual([null, 0, 1]);
    expect(preplanejadas(consultas, e)).toBe(1);
  });

  it("duas consultas da mesma rodada não encadeiam — elas partiram juntas", () => {
    /*
      O caso mais comum de inflação. O modelo pede `alteracoes(grupos)` e
      `resultado` no mesmo `tool_use`; o resultado do primeiro por acaso contém
      o texto que é argumento do segundo. Nada aqui reagiu a nada: as duas
      foram decididas antes de qualquer resultado existir.
    */
    const consultas: ConsultaMedivel[] = [
      {
        nome: "alteracoes",
        argumentos: { nivel: "grupos" },
        conteudo: { grupos: [{ equipamento: "CARRETA" }] },
        rodada: 1,
      },
      {
        nome: "resultado",
        argumentos: { escopo: "CARRETA" },
        conteudo: { receita: 1 },
        rodada: 1,
      },
    ];

    expect(contadas(comoEra(consultas)), "a régua anterior via uma cadeia aqui").toBe(1);
    expect(quantosEncadeamentos(encadeamentosDe(consultas, "Como está a frota?"))).toBe(0);
  });

  it("um valor que quem perguntou escreveu não é descoberta", () => {
    const consultas: ConsultaMedivel[] = [
      {
        nome: "alteracoes",
        argumentos: { nivel: "grupos" },
        conteudo: { grupos: [{ equipamento: "CARRETA", impacto: -1 }] },
        rodada: 1,
      },
      {
        nome: "alteracoes",
        argumentos: { nivel: "linhas", equipamento: "CARRETA" },
        conteudo: { linhas: [] },
        rodada: 2,
      },
    ];

    expect(contadas(comoEra(consultas)), "a régua anterior contava obediência").toBe(1);
    expect(
      quantosEncadeamentos(encadeamentosDe(consultas, "O que mudou nas CARRETA?")),
      "a pessoa nomeou o filtro; abrir o que ela pediu não é reagir a um achado",
    ).toBe(0);
  });

  it("um valor já usado antes não foi aprendido na consulta de origem", () => {
    const consultas: ConsultaMedivel[] = [
      {
        nome: "serie",
        argumentos: { atributo: "cavalo.finame" },
        conteudo: { pontos: [1, 2] },
        rodada: 1,
      },
      {
        nome: "alteracoes",
        argumentos: { nivel: "grupos" },
        conteudo: { grupos: [{ atributo: "cavalo.finame" }] },
        rodada: 2,
      },
      {
        nome: "alteracoes",
        argumentos: { nivel: "linhas", atributo: "cavalo.finame" },
        conteudo: { linhas: [] },
        rodada: 3,
      },
    ];

    expect(contadas(comoEra(consultas)), "a régua anterior via cadeia na repetição").toBe(1);
    expect(
      quantosEncadeamentos(encadeamentosDe(consultas, "O que houve?")),
      "o código do parâmetro já era argumento da rodada 1 — a rodada 2 não o ensinou",
    ).toBe(0);
  });

  it("inteiro não é descoberta: paginação e limite não viram investigação", () => {
    const consultas: ConsultaMedivel[] = [
      { nome: "alteracoes", argumentos: { nivel: "grupos", limite: 100 }, conteudo: { total: 100, restantes: 20 }, rodada: 1 },
      { nome: "alteracoes", argumentos: { nivel: "grupos", apartirDe: 20, limite: 100 }, conteudo: {}, rodada: 2 },
    ];
    expect(quantosEncadeamentos(encadeamentosDe(consultas, "e os seguintes?"))).toBe(0);
  });

  it("uma consulta com duas descobertas conta como um encadeamento, e explica os dois", () => {
    const consultas: ConsultaMedivel[] = [
      {
        nome: "alteracoes",
        argumentos: { nivel: "grupos" },
        conteudo: { grupos: [{ atributo: "cavalo.finame" }], vigencia: "2026-08-01" },
        rodada: 1,
      },
      {
        nome: "proveniencia",
        argumentos: { alvo: "valor", atributo: "cavalo.finame", vigencia: "2026-08-01", placa: "QYP3G72" },
        conteudo: {},
        rodada: 2,
      },
    ];
    const e = encadeamentosDe(consultas, "de onde saiu isso?");
    expect(e).toHaveLength(2);
    expect(quantosEncadeamentos(e), "a consulta é uma só").toBe(1);
    expect(explicarEncadeamento(e[0]!, consultas)).toContain("saiu do resultado de #1");
  });

  it("sem rodada declarada — o caminho determinístico — a ordem da lista decide", () => {
    const consultas: ConsultaMedivel[] = [
      { nome: "resumoDaVigencia", argumentos: {}, conteudo: { destaque: "cavalo.finame" } },
      { nome: "veiculosDoGrupo", argumentos: { atributo: "cavalo.finame" }, conteudo: {} },
    ];
    expect(quantosEncadeamentos(encadeamentosDe(consultas, "por quê?"))).toBe(1);
  });

  it("nada encadeia numa investigação de uma consulta só", () => {
    const uma: ConsultaMedivel[] = [{ nome: "alteracoes", argumentos: { nivel: "total" }, conteudo: {}, rodada: 1 }];
    expect(quantosEncadeamentos(encadeamentosDe(uma, "o que mudou?"))).toBe(0);
    expect(preplanejadas(uma, [])).toBe(1);
  });
});
