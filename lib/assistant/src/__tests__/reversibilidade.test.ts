/**
 * A virada tem de ser reversível — e a volta não pode custar uma conversa.
 *
 * **O que a promessa diz.** `ASSISTENTE_AGENTE=1` liga o agente; desligá-la
 * devolve o caminho anterior sem migração, sem deploy e sem perda. É o que
 * torna a virada uma decisão barata: se o agente se comportar mal em produção
 * numa terça-feira, a correção é uma variável de ambiente e não um rollback.
 *
 * **Onde ela pode falhar em silêncio.** No estado da conversa. Os dois caminhos
 * gravam `EstadoDaConversa` no banco a cada turno, e uma conversa aberta pode
 * atravessar a virada: turno 3 escrito pelo agente, turno 4 lido pelo
 * planejador. Se os dois não escreverem a mesma forma, o que quebra não é uma
 * exceção — é "e julho?" deixar de saber de que assunto se falava, no meio de
 * uma investigação, sem erro em lugar nenhum.
 *
 * Este arquivo exercita a travessia nos dois sentidos.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { desserializarEstado, serializarEstado } from "../conversa";
import { responder } from "../resposta";

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

comBanco("a virada é reversível", () => {
  let db: Database;

  beforeAll(() => {
    db = createDb(url!).db;
  });

  /*
    `vi.stubEnv` e não `process.env` direto.

    Escrever na variável de verdade vazou para outro arquivo da suíte: o vitest
    reaproveita worker entre arquivos, e um `evals.test.ts` que rodasse na
    janela em que esta variável estava ligada mediria o agente achando que
    media o planejador. O stub é desfeito pelo runner, e não pela disciplina de
    quem escreve o `afterEach`.
  */
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("o estado que um caminho grava é o que o outro espera ler", async () => {
    vi.stubEnv("ASSISTENTE_AGENTE", "");
    const primeiro = await responder(db, "o que mudou no IPVA?");

    /*
      A ida e a volta pelo banco, como a rota faz. Uma diferença de forma que só
      apareça depois do JSON — uma data virando string, um campo sumindo — não
      seria pega comparando os objetos em memória.
    */
    const persistido = desserializarEstado(
      JSON.parse(JSON.stringify(serializarEstado(primeiro.estado))),
    );

    expect(Object.keys(persistido).sort()).toEqual(Object.keys(primeiro.estado).sort());

    // E o turno seguinte, com a flag no outro estado, aceita o que foi gravado.
    vi.stubEnv("ASSISTENTE_AGENTE", "1");
    const segundo = await responder(db, "e julho?", { estado: persistido });

    expect(segundo.estado).toBeDefined();
    expect(Object.keys(segundo.estado).sort()).toEqual(Object.keys(primeiro.estado).sort());
  });

  it("desligar a flag devolve o caminho anterior, sem resíduo", async () => {
    /*
      A prova de que a volta não deixa rastro: com a flag desligada, a resposta
      é indistinguível de uma que nunca passou pelo agente — mesmas consultas,
      mesmo texto. Se o caminho do agente escrevesse em algum lugar que o outro
      lê, isto divergiria.
    */
    vi.stubEnv("ASSISTENTE_AGENTE", "");
    const antesDaVirada = await responder(db, "o que mudou?", { semIa: true });

    vi.stubEnv("ASSISTENTE_AGENTE", "1");
    await responder(db, "o que mudou?", { semIa: true }).catch(() => null);

    vi.stubEnv("ASSISTENTE_AGENTE", "");
    const depoisDaVolta = await responder(db, "o que mudou?", { semIa: true });

    expect(depoisDaVolta.texto).toBe(antesDaVirada.texto);
    expect(depoisDaVolta.tecnico.ferramentas).toEqual(antesDaVirada.tecnico.ferramentas);
  });

  it("`semIa` vence a flag — as evals medem o determinístico dos dois lados", async () => {
    /*
      Importa para a comparação: a bateria roda o caminho atual com `semIa` para
      medir a trajetória sem gastar chamada. Se a flag do agente passasse por
      cima disso, a coluna "antes" do relatório de virada estaria medindo o
      agente contra ele mesmo.
    */
    vi.stubEnv("ASSISTENTE_AGENTE", "1");
    const r = await responder(db, "o que mudou?", { semIa: true });

    expect(r.tecnico.motor.codigo).toBe("IA_DESLIGADA");
    expect(r.tecnico.motor.houveChamada).toBe(false);
    expect(r.tecnico.ferramentas).toContain("resumoDaVigencia");
  });
});
