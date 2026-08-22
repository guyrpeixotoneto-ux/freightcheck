/**
 * A investigação de oito turnos, como uma coisa só.
 *
 * **Por que esta sequência e não outra.** Ela é a que o produto tem de
 * aguentar: começa larga, estreita duas vezes por dimensões diferentes
 * (unidade, equipamento), pede o extremo, pede a causa, **duvida da resposta**,
 * pede a origem do número, e pede a página seguinte. Cada turno depende de
 * todos os anteriores, e cada um exercita uma memória diferente — recorte,
 * filtro, foco, rastro, paginação.
 *
 * **O que se afirma aqui é o dossiê, nunca a prosa.** Roda com `semIa`, que
 * isola a mecânica da conversa da qualidade da redação: o que se mede é qual
 * unidade, qual equipamento, qual item em foco, qual página, e o que a
 * meta-pergunta recuperou. A prosa depende do modelo e é medida noutro lugar.
 *
 * **O turno 6 é o que este ciclo existe para consertar.** "Tem certeza?" tinha
 * de deixar de receber o movimento da vigência e passar a abrir o que sustentou
 * a conclusão anterior. A asserção é dupla: a resposta fala da anterior, **e**
 * não é o resumo de sempre.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { responder } from "../resposta";
import { ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";
import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

rodar("o fio de oito turnos", () => {
  let db: Database;
  beforeAll(() => {
    ({ db } = createDb(URL_DO_BANCO!));
  });

  it("oito perguntas, uma investigação", async () => {
    let estado: EstadoDaConversa = ESTADO_VAZIO;
    const trilha: {
      pergunta: string;
      texto: string;
      intencao: string;
      foco: string | null;
      valorEmFoco: string | null;
      pagina: number | null;
      ferramentas: string[];
      encadeamentos: number;
    }[] = [];

    const perguntar = async (pergunta: string) => {
      const r = await responder(db, pergunta, { estado, semIa: true });
      estado = r.estado;
      trilha.push({
        pergunta,
        texto: r.texto,
        intencao: r.intencao,
        foco: estado.foco?.rotulo ?? null,
        valorEmFoco: estado.foco?.valor?.escrito ?? null,
        pagina: estado.pagina?.apartirDe ?? null,
        ferramentas: r.tecnico.ferramentas,
        encadeamentos: r.rastro.consultas.filter((c) => c.derivaDe !== null).length,
      });
      return r;
    };

    await perguntar("O que mudou em agosto?");
    await perguntar("Só nos cavalos.");
    await perguntar("Qual teve maior perda?");
    await perguntar("Por quê?");
    const causa = trilha[3]!;
    const duvida = await perguntar("Tem certeza?");
    await perguntar("De onde saiu esse número?");
    await perguntar("Me mostre os 5 seguintes.");

    // ---- o fio não se perde -------------------------------------------------
    expect(trilha[1]!.pergunta).toBe("Só nos cavalos.");
    expect(estado.equipamento, "o filtro de equipamento não atravessou o fio").toBe("CAVALO");

    // ---- a causa desce ------------------------------------------------------
    expect(
      causa.encadeamentos,
      "«Por quê?» não desceu: ela recebeu o mesmo agregado de sempre",
    ).toBeGreaterThanOrEqual(2);

    // ---- o foco é uma referência, não um texto ------------------------------
    expect(estado.foco, "a conversa não fixou item nenhum").toBeTruthy();
    expect(estado.foco!.grupo?.codigo, "o foco tem de carregar o código, não o rótulo").toMatch(/\w/);

    // ---- turno 6: a meta-pergunta ------------------------------------------
    /*
      As duas metades da correção. A primeira: a resposta fala da **resposta
      anterior**. A segunda, e a que o defeito exigia: ela **não** é o resumo da
      vigência que ela recebia antes.
    */
    expect(duvida.intencao).toBe("SUSTENTACAO");
    for (const secao of ["### Fatos", "### Cálculos", "### Interpretação", "### Limitações"]) {
      expect(duvida.texto, `a meta-resposta não separou ${secao}`).toContain(secao);
    }
    expect(
      duvida.texto,
      "a meta-pergunta voltou a receber o resumo da vigência",
    ).not.toBe(trilha[0]!.texto);
    expect(
      duvida.tecnico.ferramentas,
      "«tem certeza?» não pode ir consultar de novo — ela audita o que já foi consultado",
    ).toEqual([]);

    // ---- turno 7: a origem --------------------------------------------------
    expect(trilha[5]!.ferramentas.join(" ")).toContain("proveniencia");

    // ---- turno 8: a lista anda, no mesmo recorte ---------------------------
    expect(trilha[6]!.pagina).toBe(20);
    expect(estado.equipamento, "a página seguinte perdeu o filtro").toBe("CAVALO");
  }, 600_000);

  it("«tem certeza?» sem resposta anterior declara que não há o que conferir", async () => {
    const r = await responder(db, "Tem certeza?", { estado: ESTADO_VAZIO, semIa: true });
    expect(r.intencao).toBe("SUSTENTACAO");
    expect(r.texto).toContain("Não há uma resposta minha anterior");
  }, 120_000);

  it("CONTROLE NEGATIVO: dúvida com número rival vai consultar, não auditar", async () => {
    /*
      "Confirma que foi R$ 50 mil?" traz uma afirmação que não saiu de consulta
      nenhuma. Se ela virasse meta-pergunta, o número falso ficaria sem
      contestação — e a resposta seria uma auditoria da conclusão anterior, que
      não é o que se perguntou.
    */
    const r = await responder(db, "Confirma que o impacto de agosto foi de R$ 50 mil?", {
      estado: ESTADO_VAZIO,
      semIa: true,
    });
    expect(r.intencao).not.toBe("SUSTENTACAO");
    expect(r.tecnico.ferramentas.length, "não consultou nada para contestar o número").toBeGreaterThan(0);
  }, 120_000);
});
