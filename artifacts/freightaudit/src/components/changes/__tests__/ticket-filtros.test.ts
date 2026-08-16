import { describe, expect, it } from "vitest";
import {
  emptyTicketFilters,
  filtrosAtivos,
  numeroDigitado,
  toTicketQuery,
  variacaoMinima,
  type TicketFilters,
} from "../ticket-table";

/**
 * O que o filtro da aba Chamados decide antes de perguntar ao servidor.
 *
 * Duas coisas, e as duas já falharam em silêncio: o número que alguém digita —
 * que em português leva vírgula, e que a rota descartava sem dizer nada — e a
 * lista do que está ligado, que é o que o painel fechado repete em palavras e o
 * que o botão Filtros conta no seu contador. Um filtro que se anuncia ativo sem
 * estar cortando nada é pior do que um filtro que não existe.
 */

const com = (patch: Partial<TicketFilters>): TicketFilters => ({
  ...emptyTicketFilters,
  ...patch,
});

const parametros = (filters: TicketFilters) =>
  new URLSearchParams(toTicketQuery(filters));

describe("numeroDigitado", () => {
  it("lê o decimal à brasileira", () => {
    expect(numeroDigitado("1,5")).toBe(1.5);
    expect(numeroDigitado("0,25")).toBe(0.25);
  });

  it("lê o decimal à americana", () => {
    expect(numeroDigitado("1.5")).toBe(1.5);
  });

  it("descarta o separador de milhar quando há vírgula decidindo", () => {
    expect(numeroDigitado("1.234,56")).toBe(1234.56);
  });

  it("ignora o espaço de quem digita devagar", () => {
    expect(numeroDigitado(" 12 ")).toBe(12);
  });

  it("corta por tamanho, não por sinal", () => {
    expect(numeroDigitado("-300")).toBe(300);
  });

  it("devolve nulo quando não é número", () => {
    expect(numeroDigitado("")).toBeNull();
    expect(numeroDigitado("   ")).toBeNull();
    expect(numeroDigitado("abc")).toBeNull();
    expect(numeroDigitado("1,2,3")).toBeNull();
  });
});

describe("variacaoMinima", () => {
  it("zero não é um corte", () => {
    expect(variacaoMinima(com({ minAbsImpact: "0" }))).toBeNull();
    expect(variacaoMinima(com({ minAbsImpact: "0,00" }))).toBeNull();
  });

  it("texto que não é número também não é", () => {
    expect(variacaoMinima(com({ minAbsImpact: "abc" }))).toBeNull();
  });

  it("um número acima de zero é", () => {
    expect(variacaoMinima(com({ minAbsImpact: "1,5" }))).toBe(1.5);
  });
});

describe("toTicketQuery", () => {
  it("manda a vírgula convertida, e não o texto cru", () => {
    // `Number("1,5")` é `NaN`, e a rota descarta `NaN` sem avisar: quem digitava
    // à brasileira via a lista inteira e nenhuma explicação.
    expect(parametros(com({ minAbsImpact: "1,5" })).get("minAbsImpact")).toBe(
      "1.5",
    );
  });

  it("não manda o que não é número", () => {
    expect(parametros(com({ minAbsImpact: "abc" })).has("minAbsImpact")).toBe(
      false,
    );
    expect(parametros(com({ minAbsImpact: "0" })).has("minAbsImpact")).toBe(
      false,
    );
  });

  it("apara a busca, e não procura por espaço", () => {
    expect(parametros(com({ search: "  bomba " })).get("search")).toBe("bomba");
    expect(parametros(com({ search: "   " })).has("search")).toBe(false);
  });

  it("os dois cortes da fileira da frente convivem", () => {
    const query = parametros(
      com({ changeKind: "FORM_THIS", impactConfidence: "CALCULATED" }),
    );
    expect(query.get("changeKind")).toBe("FORM_THIS");
    expect(query.get("impactConfidence")).toBe("CALCULATED");
  });

  it("sem filtro nenhum, nenhum recorte pega carona", () => {
    // `limit`/`offset` são a janela de paginação, e o tamanho dela é assunto de
    // `lib/paginacao` — amarrá-lo aqui faria este teste reprovar quando alguém
    // mudasse a página padrão, que não é o que ele existe para vigiar.
    const janela = new Set(["limit", "offset"]);
    const chaves = [...parametros(emptyTicketFilters).keys()].filter(
      (chave) => !janela.has(chave),
    );
    expect(chaves).toEqual([]);
  });

  it("o assunto da visão por tipos chega inteiro", () => {
    expect(parametros(com({ subject: "Reajuste 2026" })).get("subject")).toBe(
      "Reajuste 2026",
    );
    // "sem assunto" é uma folha de verdade da árvore, e não a ausência de corte.
    const semAssunto = parametros(com({ subjectMissing: true }));
    expect(semAssunto.get("subjectMissing")).toBe("true");
    expect(semAssunto.has("subject")).toBe(false);
  });
});

describe("filtrosAtivos", () => {
  const ids = (filters: TicketFilters) =>
    filtrosAtivos(filters).map((f) => f.id);

  it("nada ligado, nada a anunciar", () => {
    expect(filtrosAtivos(emptyTicketFilters)).toEqual([]);
  });

  it("não conta como ligado o corte que não corta", () => {
    // O contador do botão Filtros sai daqui: prometer um recorte que a consulta
    // não faz é dizer que a lista está curta por uma razão que não existe.
    expect(ids(com({ minAbsImpact: "abc" }))).toEqual([]);
    expect(ids(com({ minAbsImpact: "0" }))).toEqual([]);
    expect(ids(com({ search: "   " }))).toEqual([]);
  });

  it("separa o que se lê na fileira do que fica atrás do botão", () => {
    const frente = filtrosAtivos(
      com({ changeKind: "SET", impactConfidence: "CALCULATED", search: "abc" }),
    );
    expect(frente.every((f) => !f.avancado)).toBe(true);

    const atras = filtrosAtivos(
      com({
        statusBucket: "ATENDIDO",
        beforeSource: "ARQUIVO",
        onlyDivergent: true,
        minAbsImpact: "10",
        parameterLabel: "Frete peso",
        subject: "Reajuste 2026",
      }),
    );
    expect(atras.every((f) => f.avancado)).toBe(true);
    expect(atras).toHaveLength(6);
  });

  it("o assunto se anuncia, venha ele de qual folha vier", () => {
    // Nem `subject` nem `subjectMissing` têm chip nesta barra — são escolhidos
    // na visão por tipos. É por isso que precisam aparecer no resumo: são os
    // recortes com mais chance de ficarem ligados sem ninguém perceber.
    const [porAssunto] = filtrosAtivos(com({ subject: "Reajuste 2026" }));
    expect(porAssunto.valor).toBe("Reajuste 2026");

    const [semAssunto] = filtrosAtivos(com({ subjectMissing: true }));
    expect(semAssunto.valor).toBe("chamados sem assunto");
    expect({ ...emptyTicketFilters, ...semAssunto.patch }.subjectMissing).toBe(
      false,
    );
  });

  it("cada um se desfaz sozinho, sem levar os outros", () => {
    const filtros = com({ statusBucket: "ATENDIDO", beforeSource: "ARQUIVO" });
    const situacao = filtrosAtivos(filtros).find(
      (f) => f.id === "statusBucket",
    );
    const depois = { ...filtros, ...situacao?.patch };
    expect(depois.statusBucket).toBe("");
    expect(depois.beforeSource).toBe("ARQUIVO");
  });

  it("fala em português, e não em constante do banco", () => {
    const [situacao] = filtrosAtivos(com({ statusBucket: "EM_ANDAMENTO" }));
    expect(situacao.valor).toBe("em andamento");

    const [procedencia] = filtrosAtivos(com({ beforeSource: "VIGENCIA" }));
    expect(procedencia.valor).toBe("lido da vigência em vigor");

    const [tipo] = filtrosAtivos(com({ changeKind: "FORM_THIS" }));
    expect(tipo.valor).toBe("fórmula");
  });
});
