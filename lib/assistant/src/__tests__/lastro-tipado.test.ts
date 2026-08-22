/**
 * A régua por tipo — e a prova de que ela não descarta resposta correta.
 *
 * **O risco P1, dito uma vez.** A conferência por token pergunta "este número
 * existe no dossiê?". Um dossiê que apurou `62 veículos` respondia *sim* para a
 * frase `62%`, e um que apurou `R$ 52.500` respondia *sim* para `52.500
 * veículos`. Nos dois casos a trava aprova uma afirmação que ninguém apurou —
 * e aprova com a mesma confiança com que aprova as verdadeiras, que é o que
 * torna o defeito caro.
 *
 * **A metade que costuma faltar num aperto de trava.** Apertar é fácil; apertar
 * sem passar a podar texto bom é o trabalho. Por isso este arquivo tem duas
 * partes. A primeira mede as recusas novas — cada uma com o defeito reproduzido
 * antes. A segunda roda contra o **banco real**: percorre o dossiê de todas as
 * perguntas do diagnóstico e exige que nenhuma afirmação que as próprias
 * evidências escrevem seja recusada pela régua nova. Uma trava que recusa o que
 * o produto imprime é uma trava que descarta resposta certa, e isso reprova
 * aqui em vez de aparecer como "o assistente ficou mais calado".
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import {
  afirmacoesDoTexto,
  afirmacoesSemLastro,
  autorizacoesDoTexto,
  comoGrandeza,
  type Autorizacoes,
} from "../lastro";
import { autorizacoesTipadas, numerosSemLastro, sanear, orquestrar, type Dossie } from "../orquestrador";
import type { Evidencia } from "../ferramentas";
import { CASOS_DO_DIAGNOSTICO } from "./perguntas-de-investigacao";
import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

function dossieCom(evidencia: Partial<Evidencia>): Dossie {
  const e: Evidencia = {
    ferramenta: "teste",
    titulo: "Teste",
    fatos: [],
    numeros: [],
    origem: "teste",
    ...evidencia,
  } as Evidencia;
  return {
    evidencias: [e],
    trechos: [],
    documentos: [],
    anexos: [],
    lacunas: [],
  } as unknown as Dossie;
}

const de = (d: Dossie): Autorizacoes => autorizacoesTipadas(d);

describe("classificação da afirmação pelo que o texto declara", () => {
  it("R$ antes é dinheiro; % depois é percentual; o nome do que se conta é contagem", () => {
    const t = afirmacoesDoTexto("Caiu R$ 52.500,00, ou seja 12,3% do total, em 62 veículos.");
    expect(t.map((a) => a.tipo)).toEqual(["MOEDA", "PERCENTUAL", "CONTAGEM"]);
    expect(t.map((a) => a.valor)).toEqual([52500, 12.3, 62]);
  });

  it("número sem tipo declarado não é classificado — ele segue pela régua antiga", () => {
    expect(afirmacoesDoTexto("O impacto foi de 28.511,24 no período.")).toHaveLength(0);
  });

  it("placa, data e marcador de fonte não são afirmações numéricas", () => {
    expect(afirmacoesDoTexto("O QYP3G72 mudou em 01/08/2026 [3].")).toHaveLength(0);
  });

  it("a grandeza é lida em pt-BR, e o sinal é direção e não outra quantidade", () => {
    expect(comoGrandeza("28.511,24")).toBe(28511.24);
    expect(comoGrandeza("1.234")).toBe(1234);
    expect(afirmacoesDoTexto("Queda de −3,4%")[0]!.valor).toBe(3.4);
  });
});

describe("as duas recusas novas — cada uma com o defeito reproduzido", () => {
  it("uma contagem de 62 não autoriza a frase «62%»", () => {
    const d = dossieCom({
      fatos: [{ rotulo: "Veículos afetados", valor: "62 veículos" }],
      numeros: [62],
    });

    // O defeito: a régua por token aprova, porque o dígito existe.
    expect(numerosSemLastro("A queda foi de 62%.", d), "a régua antiga aprovava").toEqual([]);
    // A correção: a régua por tipo recusa, e diz por quê.
    const recusa = afirmacoesSemLastro("A queda foi de 62%.", de(d));
    expect(recusa).toHaveLength(1);
    expect(recusa[0]).toContain("contagem, não como percentual");
  });

  it("R$ 52.500 não autoriza a frase «52.500 veículos»", () => {
    const d = dossieCom({
      fatos: [{ rotulo: "Impacto", valor: "−R$ 52.500,00/mês" }],
      numeros: [-52500],
    });

    expect(numerosSemLastro("São 52.500 veículos afetados.", d), "a régua antiga aprovava").toEqual([]);
    const recusa = afirmacoesSemLastro("São 52.500 veículos afetados.", de(d));
    expect(recusa).toHaveLength(1);
    expect(recusa[0]).toContain("em dinheiro");
  });

  it("R$ 770.000 não autoriza um percentual só porque os dígitos existem", () => {
    const d = dossieCom({ fatos: [{ rotulo: "Total", valor: "R$ 770.000,00/mês" }], numeros: [770000] });
    expect(afirmacoesSemLastro("Isso representa 770.000% da base.", de(d))).toHaveLength(1);
  });

  it("a frase inteira sai do texto, e o resto da resposta fica de pé", () => {
    const d = dossieCom({
      fatos: [{ rotulo: "Veículos afetados", valor: "62 veículos" }],
      numeros: [62],
    });
    const s = sanear("Foram 62 veículos. A queda foi de 62%. O movimento seguiu.", d);
    expect(s.texto).toContain("Foram 62 veículos.");
    expect(s.texto).toContain("O movimento seguiu.");
    expect(s.texto).not.toContain("62%");
    expect(s.removidas).toBe(1);
  });
});

describe("o que a régua nova deliberadamente continua aceitando", () => {
  it("o percentual que a consulta calculou e escreveu passa", () => {
    const d = dossieCom({
      fatos: [{ rotulo: "Resultado apurado", valor: "R$ 9.100,00/mês", detalhe: "9,1% da receita" }],
      numeros: [9100, 9.1],
    });
    expect(afirmacoesSemLastro("A margem ficou em 9,1% da receita.", de(d))).toEqual([]);
  });

  it("dinheiro arredondado e escrito por extenso continua passando", () => {
    const d = dossieCom({ fatos: [{ rotulo: "Impacto", valor: "−R$ 28.511,24/mês" }], numeros: [-28511.24] });
    expect(afirmacoesSemLastro("Caiu R$ 28,5 mil no mês.", de(d))).toEqual([]);
    expect(afirmacoesSemLastro("Caiu R$ 28.511,24 no mês.", de(d))).toEqual([]);
  });

  it("uma contagem que o dossiê declarou como contagem passa", () => {
    const d = dossieCom({
      fatos: [{ rotulo: "Alterações", valor: "267" }, { rotulo: "Impacto", valor: "R$ 267,00/mês" }],
      numeros: [267],
    });
    expect(
      afirmacoesSemLastro("Houve 267 alterações.", de(d)),
      "a mesma grandeza pode ser as duas coisas; basta o dossiê ter dito as duas",
    ).toEqual([]);
  });

  it("número sem tipo declarado nunca é tocado por esta régua", () => {
    const d = dossieCom({ fatos: [{ rotulo: "Impacto", valor: "R$ 52.500,00/mês" }], numeros: [52500] });
    expect(afirmacoesSemLastro("O impacto foi de 52.500 no mês.", de(d))).toEqual([]);
  });
});

/**
 * A prova que importa: contra o banco real, a régua nova não recusa nada que o
 * próprio produto escreve.
 */
rodar("a régua nova contra o que o produto de fato imprime", () => {
  let db: Database;
  beforeAll(() => {
    ({ db } = createDb(URL_DO_BANCO!));
  });

  it("nenhuma afirmação escrita pelas evidências é recusada pela régua por tipo", async () => {
    const recusadas: string[] = [];
    let evidencias = 0;

    for (const pergunta of CASOS_DO_DIAGNOSTICO) {
      const d = await orquestrar(db, pergunta);
      if (d.evidencias.length === 0) continue;
      const aut = autorizacoesTipadas(d);
      evidencias += d.evidencias.length;

      for (const e of d.evidencias) {
        for (const f of e.fatos) {
          for (const alvo of [f.valor, f.detalhe].filter((x): x is string => Boolean(x))) {
            for (const r of afirmacoesSemLastro(alvo, aut)) {
              recusadas.push(`${e.ferramenta} · ${f.rotulo} · "${alvo}" → ${r}`);
            }
          }
        }
      }
    }

    expect(evidencias, "a medição precisa de evidência real para valer").toBeGreaterThan(50);
    expect(
      recusadas,
      "a régua recusaria texto que as próprias consultas escrevem — isso é podar resposta certa",
    ).toEqual([]);
  }, 600_000);
});
