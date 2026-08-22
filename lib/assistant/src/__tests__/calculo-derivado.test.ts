/**
 * O cálculo derivado no fio da conversa — e a recusa que o torna seguro.
 *
 * **As três coisas que não podiam acontecer, e que aconteciam.** "Quanto isso
 * dá por ano?" recebia o agregado da vigência (uma resposta a outra pergunta);
 * ou seria respondida por uma conta do modelo (um número sem onde ser
 * conferido); ou seria simplesmente bloqueada (uma pergunta legítima de
 * analista tratada como fora de escopo). Este arquivo prova a quarta saída: a
 * conta feita em código, sobre um valor que **já tinha lastro**, com a
 * expressão por extenso ao lado.
 *
 * **A metade que importa mais é a recusa.** Uma capacidade de calcular é
 * exatamente por onde um número inventado entraria com aparência de resultado.
 * Os casos de recusa aqui não são cortesia: são o que garante que o operando
 * veio de consulta.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { responder } from "../resposta";
import { ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";
import { detectar } from "../plano";
import { operacaoDaFrase } from "../calculo";
import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

describe("a pergunta de composição é reconhecida como tal", () => {
  it("as cinco formas que o diagnóstico listou viram CALCULO", () => {
    for (const p of [
      "Quanto isso dá por ano?",
      "Qual percentual isso representa?",
      "Qual a diferença percentual?",
      "Se continuar assim por 12 meses?",
      "Qual a média?",
    ]) {
      expect(detectar(p), p).toContain("CALCULO");
    }
  });

  it("a operação sai do vocabulário da própria frase", () => {
    expect(operacaoDaFrase("quanto isso da por ano?")).toEqual({ operacao: "PROJECAO", fator: 12 });
    expect(operacaoDaFrase("se continuar assim por 6 meses?")).toEqual({
      operacao: "PROJECAO",
      fator: 6,
    });
    expect(operacaoDaFrase("qual percentual isso representa?")?.operacao).toBe("PROPORCAO");
    expect(operacaoDaFrase("qual a media?")?.operacao).toBe("MEDIA");
  });

  it("consultar uma média cadastrada não é compor uma média", () => {
    /*
      A vizinhança que o alargamento cria: "qual a média de consumo negociado?"
      pede um parâmetro que existe no cadastro, não uma conta sobre o que já foi
      apurado. Trocar um erro por outro não é corrigir.
    */
    expect(detectar("Qual a média de consumo negociado?")).not.toContain("CALCULO");
  });
});

rodar("a composição contra o banco real", () => {
  let db: Database;
  beforeAll(() => {
    ({ db } = createDb(URL_DO_BANCO!));
  });

  it("projeta um valor mensal apurado, e diz que é projeção", async () => {
    let estado: EstadoDaConversa = ESTADO_VAZIO;
    const primeiro = await responder(db, "Qual foi o impacto de agosto?", { estado, semIa: true });
    estado = primeiro.estado;
    expect(estado.foco?.valor, "sem valor em foco não há o que projetar").toBeTruthy();

    const r = await responder(db, "Quanto isso dá por ano?", { estado, semIa: true });
    expect(r.intencao).toBe("CALCULO");

    const conta = r.fontes.find((f) => f.titulo.includes("Projeção"));
    expect(conta, `sem evidência de cálculo: ${r.fontes.map((f) => f.titulo).join(" | ")}`).toBeTruthy();
    expect(conta!.titulo, "uma projeção que não se declara vira um apurado anual").toContain(
      "condicional",
    );
    expect(conta!.titulo).toMatch(/× 12 =/);
  }, 240_000);

  it("sem nada apurado antes, declara o que falta em vez de inventar a base", async () => {
    /*
      A pergunta é a mesma; o que muda é não haver conversa. A resposta certa
      não é um número nem um bloqueio: é dizer que não há o que compor e o que
      consultar primeiro.
    */
    const r = await responder(db, "Quanto isso dá por ano?", { estado: ESTADO_VAZIO, semIa: true });
    expect(r.intencao).toBe("CALCULO");
    expect(r.lacunas.length, "uma composição impossível tem de se declarar").toBeGreaterThan(0);
    expect(r.lacunas.map((l) => l.explicacao).join(" ")).toContain("Não dá para fazer essa conta");
  }, 120_000);

  it("CONTROLE NEGATIVO: nenhuma consulta de dado roda para compor", async () => {
    /*
      A composição opera sobre o que **já** foi apurado. Se ela disparasse
      consultas novas, o número composto poderia sair de uma vigência diferente
      da que estava em discussão — e a conta seria aritmeticamente perfeita
      sobre duas coisas que não se comparam.
    */
    let estado: EstadoDaConversa = ESTADO_VAZIO;
    estado = (await responder(db, "Qual foi o impacto de agosto?", { estado, semIa: true })).estado;
    const r = await responder(db, "Quanto isso dá por ano?", { estado, semIa: true });

    const consultasDeDado = r.tecnico.ferramentas.filter((f) => !f.startsWith("calculo:"));
    expect(consultasDeDado, "a composição foi buscar dado novo").toEqual([]);
  }, 240_000);
});
