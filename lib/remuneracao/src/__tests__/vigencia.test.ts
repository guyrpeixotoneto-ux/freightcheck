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
 * **Não pode inventar.** A quinzena não é inferida: ela sai do **dia** em que a
 * vigência passou a valer, pela régua do Fechamento (até o 15 é a primeira, do
 * 16 é a segunda). Onde as entregas do mês não se separam em primeira e
 * segunda, o dia entra junto com a ordinal — nunca no lugar dela, e nunca uma
 * ordinal que sirva a duas linhas ao mesmo tempo.
 *
 * A régua de quando escrever a marca mudou em 16/09/2026, e mudou lá em
 * `@workspace/comparison/labels`, para o produto inteiro: a quinzena passou a
 * ser parte do nome de toda vigência. Aqui ela sempre foi o grão natural da
 * planilha, e o que este arquivo guarda continua sendo o mesmo: dois rótulos
 * nunca iguais.
 */
describe("o rótulo da vigência", () => {
  const AGOSTO_PARTIDO = ["2026-08-01", "2026-08-16"];

  it("separa as duas quinzenas do mês partido", () => {
    expect(rotuloDaVigencia("2026-08-01", AGOSTO_PARTIDO)).toBe("agosto/2026 · 1ª quinzena");
    expect(rotuloDaVigencia("2026-08-16", AGOSTO_PARTIDO)).toBe("agosto/2026 · 2ª quinzena");
  });

  it("a quinzena sai do dia, e não da companhia que a vigência tem na lista", () => {
    expect(rotuloDaVigencia("2026-08-01", ["2026-07-01", "2026-08-01"])).toBe(
      "agosto/2026 · 1ª quinzena",
    );
    expect(rotuloDaVigencia("2026-08-01", [])).toBe("agosto/2026 · 1ª quinzena");
    expect(rotuloDaVigencia("2026-08-16", [])).toBe("agosto/2026 · 2ª quinzena");
  });

  /*
    O desempate pelo dia é do mês, e não do contexto inteiro: a mesma unidade
    pode ter entregue julho de uma vez e agosto em duas, e julho não ganha o dia
    por causa do que agosto fez.
  */
  it("decide mês a mês dentro da mesma unidade", () => {
    const misto = ["2026-07-01", "2026-08-01", "2026-08-16"];
    expect(rotuloDaVigencia("2026-07-01", misto)).toBe("julho/2026 · 1ª quinzena");
    expect(rotuloDaVigencia("2026-08-16", misto)).toBe("agosto/2026 · 2ª quinzena");
  });

  /** A régua é a do Fechamento: até o dia 15 é a primeira, do 16 é a segunda. */
  it("usa a virada do dia 15 para o 16", () => {
    const par = ["2026-08-15", "2026-08-16"];
    expect(rotuloDaVigencia("2026-08-15", par)).toBe("agosto/2026 · 1ª quinzena");
    expect(rotuloDaVigencia("2026-08-16", par)).toBe("agosto/2026 · 2ª quinzena");
  });

  /*
    Quando a quinzena não separa, o dia separa — **junto** com ela. Chamar duas
    entregas de "2ª quinzena" seria repetir; trocar a ordinal pelo dia seria
    apagar a metade em que a vigência caiu, que continua verdadeira.
  */
  it("acrescenta o dia quando as entregas do mês não se separam por quinzena", () => {
    const mesmaMetade = ["2026-08-01", "2026-08-05"];
    expect(rotuloDaVigencia("2026-08-01", mesmaMetade)).toBe(
      "agosto/2026 · 1ª quinzena · dia 01",
    );
    expect(rotuloDaVigencia("2026-08-05", mesmaMetade)).toBe(
      "agosto/2026 · 1ª quinzena · dia 05",
    );

    const tres = ["2026-08-01", "2026-08-16", "2026-08-20"];
    expect(tres.map((d) => rotuloDaVigencia(d, tres))).toEqual([
      "agosto/2026 · 1ª quinzena · dia 01",
      "agosto/2026 · 2ª quinzena · dia 16",
      "agosto/2026 · 2ª quinzena · dia 20",
    ]);
  });

  /*
    A data que não está na lista entra na conta assim mesmo. Sem isso, pedir o
    rótulo do dia 20 contra a lista `[01, 16]` devolveria "2ª quinzena" — o
    mesmo texto que o dia 16 já tem, que é exatamente a repetição que este
    arquivo existe para impedir.
  */
  it("conta a própria data mesmo quando ela não está na lista", () => {
    expect(rotuloDaVigencia("2026-08-20", AGOSTO_PARTIDO)).toBe(
      "agosto/2026 · 2ª quinzena · dia 20",
    );
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
