/**
 * O cálculo derivado — e a prova de que ele não é uma porta dos fundos.
 *
 * **A pergunta que este arquivo responde.** Uma capacidade de calcular é
 * exatamente o lugar por onde um número inventado entraria com aparência de
 * resultado: basta o operando não ter vindo de consulta nenhuma para a conta
 * ser aritmeticamente perfeita e factualmente falsa. Por isso metade dos casos
 * aqui não mede a conta — mede a **recusa**.
 *
 * **E a outra metade fecha o par com a régua por tipo.** Um percentual
 * calculado tem de sair formatado com `%`, porque é isso que autoriza a frase
 * correspondente em `sanear`. Um cálculo que devolvesse só o número cru
 * produziria a pior combinação possível: a conta certa, feita no lugar certo,
 * e a frase podada.
 */

import { describe, expect, it } from "vitest";
import { calcular, evidenciaDoCalculo, grandezasApuradas, temLastro } from "../calculo";
import { executar, registroPadrao } from "../ferramentas/registro";
import { afirmacoesSemLastro, autorizacoesDoTexto, type Autorizacoes } from "../lastro";
import type { Evidencia } from "../ferramentas";
import type { Database } from "@workspace/db";

const APURADO: Evidencia[] = [
  {
    ferramenta: "alteracoes:total",
    titulo: "Movimento de agosto",
    fatos: [
      { rotulo: "Impacto", valor: "−R$ 52.500,00/mês" },
      { rotulo: "Base do período", valor: "R$ 84.300,00/mês" },
    ],
    numeros: [-52500, 84300],
    origem: "teste",
  },
];

const apurados = grandezasApuradas(APURADO);

describe("a conta, quando os dois lados têm lastro", () => {
  it("proporção sai em percentual, com a conta por extenso", () => {
    const r = calcular(
      {
        operacao: "PROPORCAO",
        operandos: [
          { rotulo: "impacto", valor: 52500 },
          { rotulo: "base", valor: 84300 },
        ],
        grandeza: "MOEDA",
      },
      apurados,
    );
    expect(r.apurado).toBe(true);
    if (!r.apurado) return;
    expect(r.escrito).toBe("62,28%");
    expect(r.grandeza).toBe("PERCENTUAL");
    expect(r.expressao).toContain("÷");
    expect(r.expressao).toContain("62,28%");
    expect(r.de).toEqual(["impacto", "base"]);
  });

  it("variação usa o primeiro como depois e o segundo como antes", () => {
    const r = calcular(
      {
        operacao: "VARIACAO",
        operandos: [
          { rotulo: "agosto", valor: 84300 },
          { rotulo: "julho", valor: 52500 },
        ],
        grandeza: "MOEDA",
      },
      apurados,
    );
    expect(r.apurado && r.valor).toBeCloseTo(60.571, 2);
  });

  it("a projeção sai marcada como condicional — ela não é apuração", () => {
    const r = calcular(
      { operacao: "PROJECAO", operandos: [{ rotulo: "mensal", valor: 52500 }], fator: 12, grandeza: "MOEDA" },
      apurados,
    );
    expect(r.apurado).toBe(true);
    if (!r.apurado) return;
    expect(r.hipotetico, "sem isto, um número condicional circula como apurado").toBe(true);
    expect(r.valor).toBe(630000);
    const e = evidenciaDoCalculo(r);
    expect(e.titulo).toContain("condicional");
    expect(e.fatos[0]!.rotulo).toContain("não apurado");
  });

  it("o resultado percentual autoriza a frase percentual — o par com a régua por tipo", () => {
    const r = calcular(
      {
        operacao: "PROPORCAO",
        operandos: [
          { rotulo: "impacto", valor: 52500 },
          { rotulo: "base", valor: 84300 },
        ],
        grandeza: "MOEDA",
      },
      apurados,
    );
    if (!r.apurado) throw new Error("o cálculo devia ter sido apurado");

    const aut: Autorizacoes = { percentual: [], moeda: [], contagem: [] };
    for (const f of evidenciaDoCalculo(r).fatos) autorizacoesDoTexto(`${f.valor} ${f.rotulo}`, aut);

    expect(afirmacoesSemLastro("Isso é 62,28% da base.", aut)).toEqual([]);
    expect(
      afirmacoesSemLastro("Isso é 99,99% da base.", aut),
      "um percentual que ninguém calculou continua sem lastro",
    ).toHaveLength(1);
  });
});

describe("a recusa — que é o que impede a conta de virar porta dos fundos", () => {
  it("um operando que não saiu de consulta nenhuma não é calculado", () => {
    const r = calcular(
      {
        operacao: "PROPORCAO",
        operandos: [
          { rotulo: "ouvi falar", valor: 250000 },
          { rotulo: "base", valor: 84300 },
        ],
      },
      apurados,
    );
    expect(r.apurado).toBe(false);
    if (r.apurado) return;
    expect(r.motivo).toBe("CALCULO_NAO_APURADO");
    expect(r.explicacao).toContain("ouvi falar");
  });

  it("divisão por zero é declarada, não arredondada", () => {
    const r = calcular(
      {
        operacao: "PROPORCAO",
        operandos: [
          { rotulo: "a", valor: 52500 },
          { rotulo: "b", valor: 0 },
        ],
      },
      [...apurados, 0],
    );
    expect(r.apurado).toBe(false);
  });

  it("a projeção sem número de períodos não inventa doze", () => {
    const r = calcular({ operacao: "PROJECAO", operandos: [{ rotulo: "mensal", valor: 52500 }] }, apurados);
    expect(r.apurado).toBe(false);
  });

  it("o lastro tolera arredondamento e escala, e só isso", () => {
    expect(temLastro(52500, apurados)).toBe(true);
    expect(temLastro(52.5, apurados), "«R$ 52,5 mil» é o mesmo valor escrito de outro jeito").toBe(true);
    expect(temLastro(52501, apurados), "um real a mais é outro número").toBe(false);
  });
});

describe("a ferramenta, como o agente a chama", () => {
  const ctx = { db: null as unknown as Database, recorte: {}, apurados: () => APURADO };

  it("está no catálogo — sem isso nada disto é alcançável", () => {
    expect(registroPadrao().lista().map((f) => f.nome)).toContain("calculo");
  });

  it("compõe dois valores apurados e devolve evidência citável", async () => {
    const c = await executar(registroPadrao(), "calculo", {
      operacao: "proporcao",
      valores: ["52500", "84300"],
      rotulos: ["impacto de agosto", "base do período"],
      grandeza: "dinheiro",
    }, ctx);

    expect(c.ok).toBe(true);
    expect((c.conteudo as { resultado: string }).resultado).toBe("62,28%");
    expect(c.evidencias).toHaveLength(1);
    expect(c.evidencias[0]!.numeros).toContain(62.28);
  });

  it("recusa o número que a pessoa sugeriu na pergunta", async () => {
    const c = await executar(registroPadrao(), "calculo", {
      operacao: "proporcao",
      valores: ["250000", "84300"],
      rotulos: ["o que ouvi falar", "base"],
      grandeza: "dinheiro",
    }, ctx);

    expect(c.ok, "a ferramenta não lança — a recusa é a resposta").toBe(true);
    expect((c.conteudo as { motivo: string }).motivo).toBe("CALCULO_NAO_APURADO");
    expect(c.evidencias, "nada aqui autoriza afirmação nenhuma").toHaveLength(0);
  });

  it("sem nada apurado na conversa, não há o que compor", async () => {
    const c = await executar(registroPadrao(), "calculo", {
      operacao: "soma",
      valores: ["1000", "2000"],
      rotulos: ["a", "b"],
    }, { db: null as unknown as Database, recorte: {}, apurados: () => [] });

    expect((c.conteudo as { motivo: string }).motivo).toBe("CALCULO_NAO_APURADO");
  });

  it("o recorte não pode entrar por argumento — a regra do registro vale aqui também", () => {
    const nomes = Object.keys(registroPadrao().obter("calculo")!.argumentos);
    expect(nomes).not.toContain("unidade");
    expect(nomes).not.toContain("scopeHash");
  });
});
