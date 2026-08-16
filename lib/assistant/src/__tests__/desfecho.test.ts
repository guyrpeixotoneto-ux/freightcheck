/**
 * A bateria por desfecho, contra o banco real.
 *
 * **Ela roda nos dois caminhos, e é isso que a torna critério.** Com a flag
 * desligada mede o planejador; com `ASSISTENTE_AGENTE=1` e chave, mede o
 * agente. As asserções são as mesmas nos dois casos — não há uma linha aqui que
 * saiba qual caminho está rodando —, e é por isso que a comparação entre as
 * duas rodadas responde "o agente pode virar padrão?" sem ninguém reler
 * noventa respostas.
 *
 * **O sinal invertido dos defeitos conhecidos.** Cinco dos nove casos reprovam
 * hoje, e a suíte exige que reprovem. Não é complacência: é o inventário do que
 * a migração deve consertar, com prova de que ainda não consertou. Quando um
 * deles passar, este arquivo fica vermelho pedindo que a linha
 * `defeitoConhecido` seja apagada — que é a única forma de um inventário assim
 * não virar um arquivo de desculpas antigas.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { responder, type Resposta } from "../resposta";
import { CASOS_DE_DESFECHO, conferirDesfecho, itensEnumerados } from "../aceitacao/desfecho";

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

comBanco("bateria por desfecho", () => {
  const respostas = new Map<string, Resposta>();

  beforeAll(async () => {
    const db: Database = createDb(url!).db;
    /*
      Em sequência, e não em paralelo. As asserções entre casos comparam textos,
      e duas perguntas que corram ao mesmo tempo sobre o mesmo pool disputam
      conexão — o que muda latência e não muda resposta, mas torna a rodada
      menos comparável com a seguinte, que é o único uso deste arquivo.
    */
    for (const caso of CASOS_DE_DESFECHO) {
      respostas.set(caso.id, await responder(db, caso.pergunta, { diagnostico: true }));
    }
  }, 180_000);

  for (const caso of CASOS_DE_DESFECHO) {
    const rotulo = caso.espera.defeitoConhecido
      ? `${caso.id} — DEFEITO CONHECIDO: ${caso.esperado}`
      : `${caso.id} — ${caso.esperado}`;

    it(rotulo, () => {
      const resposta = respostas.get(caso.id)!;
      const falhas = conferirDesfecho(resposta, caso.espera, respostas);
      const resumo = falhas.map((f) => `${f.regra}: ${f.detalhe}`).join(" | ");

      if (caso.espera.defeitoConhecido) {
        /*
          O caso tem de falhar, e tem de falhar **por alguma das razões que a
          espera descreve**. Um defeito conhecido que passasse a reprovar por
          outro motivo — a resposta virou erro, o banco esvaziou — seria lido
          como "continua igual", e não está.
        */
        expect(
          falhas.length,
          `"${caso.id}" passou. Se o defeito foi corrigido, apague a linha ` +
            `\`defeitoConhecido\` do caso em aceitacao/desfecho.ts. Motivo registrado: ` +
            caso.espera.defeitoConhecido,
        ).toBeGreaterThan(0);
        return;
      }

      expect(falhas.length, resumo).toBe(0);
    });
  }

  it("nenhum caso inventa número — a trava vale em todos, sempre", () => {
    for (const [id, r] of respostas) {
      expect(r.tecnico.numerosRecusados, `${id} citou número sem lastro`).toEqual([]);
    }
  });

  /*
    ---- a medida que resume a rodada ---------------------------------------

    Um número só, e é ele que se compara entre a rodada do planejador e a do
    agente: de quantas perguntas distintas saíram respostas distintas. Ele não
    diz que as respostas estão boas; diz que elas deixaram de ser a mesma.
  */
  it("registra quantas respostas distintas as nove perguntas produziram", () => {
    const textos = new Set([...respostas.values()].map((r) => r.texto.trim()));
    const capacidades = new Set(
      [...respostas.values()].map((r) => r.tecnico.ferramentas.slice().sort().join(",")),
    );

    console.log(
      `\n  desfecho · ${textos.size}/${respostas.size} respostas distintas · ` +
        `${capacidades.size}/${respostas.size} trajetórias distintas`,
    );

    // A régua de hoje. Quando o agente virar padrão, os dois números têm de
    // subir — e este piso é o que impede uma regressão silenciosa no caminho.
    expect(textos.size).toBeGreaterThanOrEqual(4);
  });
});

describe("itensEnumerados", () => {
  it("conta lista com traço, com número e linha de tabela", () => {
    expect(itensEnumerados("- um\n- dois")).toBe(2);
    expect(itensEnumerados("1. um\n2) dois")).toBe(2);
    expect(itensEnumerados("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(2);
  });

  it("não conta prosa nem separador de tabela", () => {
    expect(itensEnumerados("Mudaram 267 coisas em agosto.")).toBe(0);
    expect(itensEnumerados("| --- | --- |")).toBe(0);
  });
});
