import { describe, expect, it } from "vitest";
import { ehInicioDeQuinzena, rotuloDaVigencia } from "../vigencia";

/**
 * O rótulo da vigência, e as duas coisas que ele não pode fazer.
 *
 * **Não pode repetir.** É o defeito que trouxe este arquivo: a unidade entrega
 * `2026-08-01` e `2026-08-16`, e as duas apareciam como "agosto/2026" — no
 * seletor do formulário, na comparação e na coluna da lista. Escolher a
 * quinzena certa virava sorte, e errar sobrescrevia a outra.
 *
 * **Não pode inventar.** Quinzena é uma afirmação sobre o grão da entrega, e o
 * módulo inteiro se recusa a inferir. Onde o mês tem uma entrega só, ou onde as
 * entregas não se separam em primeira e segunda, o rótulo diz menos e continua
 * verdadeiro.
 */
describe("o rótulo da vigência", () => {
  const AGOSTO_PARTIDO = ["2026-08-01", "2026-08-16"];

  it("separa as duas quinzenas do mês partido", () => {
    expect(rotuloDaVigencia("2026-08-01", AGOSTO_PARTIDO)).toBe("1ª quinzena de agosto/2026");
    expect(rotuloDaVigencia("2026-08-16", AGOSTO_PARTIDO)).toBe("2ª quinzena de agosto/2026");
  });

  it("não inventa quinzena onde o mês tem uma entrega só", () => {
    expect(rotuloDaVigencia("2026-08-01", ["2026-07-01", "2026-08-01"])).toBe("agosto/2026");
    expect(rotuloDaVigencia("2026-08-01", [])).toBe("agosto/2026");
  });

  /*
    O rótulo é do mês, e não do contexto inteiro: a mesma unidade pode ter
    entregue julho de uma vez e agosto em duas, e julho não vira "1ª quinzena"
    por causa do que agosto fez.
  */
  it("decide mês a mês dentro da mesma unidade", () => {
    const misto = ["2026-07-01", "2026-08-01", "2026-08-16"];
    expect(rotuloDaVigencia("2026-07-01", misto)).toBe("julho/2026");
    expect(rotuloDaVigencia("2026-08-16", misto)).toBe("2ª quinzena de agosto/2026");
  });

  /** A régua é a do Fechamento: até o dia 15 é a primeira, do 16 é a segunda. */
  it("usa a virada do dia 15 para o 16", () => {
    const par = ["2026-08-15", "2026-08-16"];
    expect(rotuloDaVigencia("2026-08-15", par)).toBe("1ª quinzena de agosto/2026");
    expect(rotuloDaVigencia("2026-08-16", par)).toBe("2ª quinzena de agosto/2026");
  });

  /*
    Quando a quinzena não separa, o dia separa. São os casos em que chamar duas
    entregas de "2ª quinzena" seria repetir e afirmar ao mesmo tempo.
  */
  it("cai no dia quando as entregas do mês não se separam por quinzena", () => {
    const mesmaMetade = ["2026-08-01", "2026-08-05"];
    expect(rotuloDaVigencia("2026-08-01", mesmaMetade)).toBe("01/08/2026");
    expect(rotuloDaVigencia("2026-08-05", mesmaMetade)).toBe("05/08/2026");

    const tres = ["2026-08-01", "2026-08-16", "2026-08-20"];
    expect(tres.map((d) => rotuloDaVigencia(d, tres))).toEqual([
      "01/08/2026",
      "16/08/2026",
      "20/08/2026",
    ]);
  });

  /*
    A data que não está na lista entra na conta assim mesmo. Sem isso, pedir o
    rótulo do dia 20 contra a lista `[01, 16]` devolveria "2ª quinzena" — o
    mesmo texto que o dia 16 já tem, que é exatamente a repetição que este
    arquivo existe para impedir.
  */
  it("conta a própria data mesmo quando ela não está na lista", () => {
    expect(rotuloDaVigencia("2026-08-20", AGOSTO_PARTIDO)).toBe("20/08/2026");
  });

  it("devolve o texto cru quando não é data — como o rótulo genérico faz", () => {
    expect(rotuloDaVigencia("sem data", AGOSTO_PARTIDO)).toBe("sem data");
  });
});

/**
 * A régua que separa a vigência que veio de arquivo da que alguém cria.
 *
 * A primeira é o que o arquivo trouxer — e o rótulo acima sabe escrever um dia
 * qualquer quando é o caso. A segunda vale porque é uma quinzena do calendário
 * do cliente, e é só sobre ela que esta função responde.
 */
describe("o começo de quinzena", () => {
  it("aceita os dois dias em que uma quinzena começa", () => {
    expect(ehInicioDeQuinzena("2026-08-01")).toBe(true);
    expect(ehInicioDeQuinzena("2026-08-16")).toBe(true);
  });

  it("recusa o dia no meio do mês — seria uma quinzena que só ela conheceria", () => {
    expect(ehInicioDeQuinzena("2026-08-07")).toBe(false);
    expect(ehInicioDeQuinzena("2026-08-15")).toBe(false);
    expect(ehInicioDeQuinzena("2026-08-31")).toBe(false);
  });

  it("recusa o que não é data, e o mês que não existe", () => {
    expect(ehInicioDeQuinzena("agosto")).toBe(false);
    expect(ehInicioDeQuinzena("2026-13-01")).toBe(false);
    expect(ehInicioDeQuinzena("2026-00-16")).toBe(false);
    expect(ehInicioDeQuinzena("2026-08-1")).toBe(false);
  });

  it("recusa o ano de um dedo a mais, na mesma faixa que a tela aplica", () => {
    expect(ehInicioDeQuinzena("20226-08-01")).toBe(false);
    expect(ehInicioDeQuinzena("1999-08-01")).toBe(false);
    expect(ehInicioDeQuinzena("2101-08-01")).toBe(false);
    expect(ehInicioDeQuinzena("2100-12-16")).toBe(true);
  });
});
