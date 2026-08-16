import { describe, expect, it } from "vitest";
import {
  emptyFilters,
  filtrosAtivos,
  materialidadeMinima,
  numeroDigitado,
  toQuery,
  type Filters,
} from "../change-table";

/**
 * O que o filtro da aba Planilha decide antes de perguntar ao servidor.
 *
 * O irmão deste arquivo é `ticket-filtros.test.ts`, e as duas telas partilham
 * as mesmas duas armadilhas: o número que alguém digita — que em português
 * leva vírgula, e que a rota descartava sem dizer nada — e a lista do que está
 * ligado, que é o que o painel fechado repete em palavras e o que o botão
 * Filtros conta no seu contador.
 *
 * O que **não** é igual é a régua da materialidade. Lá o corte é sobre a
 * variação do parâmetro, na unidade dele; aqui é sobre o impacto apurado, em
 * reais. Os rótulos das duas telas dizem coisas diferentes de propósito.
 */

const com = (patch: Partial<Filters>): Filters => ({
  ...emptyFilters,
  ...patch,
});

const parametros = (filters: Filters) => new URLSearchParams(toQuery(filters));

describe("numeroDigitado", () => {
  it("lê dinheiro escrito à brasileira", () => {
    expect(numeroDigitado("1.500,50")).toBe(1500.5);
    expect(numeroDigitado("0,25")).toBe(0.25);
  });

  it("lê o decimal à americana", () => {
    expect(numeroDigitado("1500.5")).toBe(1500.5);
  });

  it("ignora o cifrão e o espaço de quem digita devagar", () => {
    expect(numeroDigitado(" R$ 300 ")).toBe(300);
  });

  it("corta por tamanho, não por sinal", () => {
    expect(numeroDigitado("-300")).toBe(300);
  });

  it("devolve nulo quando não é número", () => {
    expect(numeroDigitado("")).toBeNull();
    expect(numeroDigitado("   ")).toBeNull();
    expect(numeroDigitado("mil")).toBeNull();
  });
});

describe("materialidadeMinima", () => {
  it("zero não é um corte", () => {
    expect(materialidadeMinima(com({ minAbsImpact: "0" }))).toBeNull();
  });

  it("texto que não é número também não é", () => {
    expect(materialidadeMinima(com({ minAbsImpact: "mil" }))).toBeNull();
  });

  it("um valor acima de zero é", () => {
    expect(materialidadeMinima(com({ minAbsImpact: "1.500,50" }))).toBe(1500.5);
  });
});

describe("toQuery", () => {
  it("manda a vírgula convertida, e não o texto cru", () => {
    // `Number("1.500,50")` é `NaN`, e a rota descarta `NaN` sem avisar: quem
    // digitava à brasileira via a lista inteira e nenhuma explicação.
    expect(
      parametros(com({ minAbsImpact: "1.500,50" })).get("minAbsImpact"),
    ).toBe("1500.5");
  });

  it("não manda o que não é número, nem o corte que não corta", () => {
    expect(parametros(com({ minAbsImpact: "mil" })).has("minAbsImpact")).toBe(
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
      com({ costClass: "FIXO", impactConfidence: "NOT_CALCULABLE" }),
    );
    expect(query.get("costClass")).toBe("FIXO");
    expect(query.get("impactConfidence")).toBe("NOT_CALCULABLE");
  });

  it("manda o equipamento como filtro de linha", () => {
    // `entityType` recorta as linhas do período lido; `entityTypeSet`, que é
    // outro parâmetro, trocaria a comparação inteira. Mandar um no lugar do
    // outro devolveria a vigência errada com aparência de filtro aplicado.
    const query = parametros(com({ entityType: "CAVALO" }));
    expect(query.get("entityType")).toBe("CAVALO");
    expect(query.has("entityTypeSet")).toBe(false);
  });

  it("sem filtro nenhum, nenhum recorte pega carona", () => {
    const janela = new Set(["limit", "offset"]);
    const chaves = [...parametros(emptyFilters).keys()].filter(
      (chave) => !janela.has(chave),
    );
    expect(chaves).toEqual([]);
  });
});

describe("filtrosAtivos", () => {
  const ids = (filters: Filters) => filtrosAtivos(filters).map((f) => f.id);

  it("nada ligado, nada a anunciar", () => {
    expect(filtrosAtivos(emptyFilters)).toEqual([]);
  });

  it("não conta como ligado o corte que não corta", () => {
    // O contador do botão Filtros sai daqui: prometer um recorte que a consulta
    // não faz é dizer que a lista está curta por uma razão que não existe.
    expect(ids(com({ minAbsImpact: "mil" }))).toEqual([]);
    expect(ids(com({ minAbsImpact: "0" }))).toEqual([]);
    expect(ids(com({ search: "   " }))).toEqual([]);
  });

  it("separa o que se lê na fileira do que fica atrás do botão", () => {
    const frente = filtrosAtivos(
      com({ costClass: "FIXO", impactConfidence: "CALCULATED", search: "abc" }),
    );
    expect(frente.every((f) => !f.avancado)).toBe(true);

    const atras = filtrosAtivos(
      com({
        changeType: "VALUE_CHANGED",
        semanticsStatus: "PRESUMED",
        comparability: "INCONCLUSIVE",
        minAbsImpact: "100",
        attributeCode: "FRETE_PESO",
      }),
    );
    expect(atras.every((f) => f.avancado)).toBe(true);
    expect(atras).toHaveLength(5);
  });

  it("o atributo se anuncia, mesmo vindo dos cartões", () => {
    // `attributeCode` é escolhido nos cartões de baixo e não tem chip nesta
    // barra — é o recorte com mais chance de ficar ligado sem ninguém notar.
    const [atributo] = filtrosAtivos(com({ attributeCode: "FRETE_PESO" }));
    expect(atributo.grupo).toBe("atributo");
    expect(atributo.avancado).toBe(true);
  });

  it("o equipamento se anuncia, mesmo tendo chegado por link", () => {
    // `entityType` não tem chip nenhum nesta tela: ele vem da Visão geral, num
    // endereço. Um recorte que ninguém ligou aqui é o que mais precisa estar
    // escrito aqui — com o × ao lado, ou a lista fica curta sem explicação.
    const [equipamento] = filtrosAtivos(com({ entityType: "CAVALO" }));
    expect(equipamento.grupo).toBe("equipamento");
    expect(equipamento.valor).toBe("cavalo");
    expect(equipamento.avancado).toBe(true);
    expect({ ...com({ entityType: "CAVALO" }), ...equipamento.patch }.entityType).toBe("");
  });

  it("cada um se desfaz sozinho, sem levar os outros", () => {
    const filtros = com({ changeType: "ENTITY_ADDED", semanticsStatus: "UNKNOWN" });
    const tipo = filtrosAtivos(filtros).find((f) => f.id === "changeType");
    const depois = { ...filtros, ...tipo?.patch };
    expect(depois.changeType).toBe("");
    expect(depois.semanticsStatus).toBe("UNKNOWN");
  });

  it("fala em português, e não em constante do banco", () => {
    const [classe] = filtrosAtivos(com({ costClass: "SEM_CLASSE" }));
    expect(classe.valor).toBe("sem classe");

    const [tipo] = filtrosAtivos(com({ changeType: "ATTRIBUTE_REMOVED" }));
    expect(tipo.valor).toBe("coluna removida");

    const [impacto] = filtrosAtivos(com({ impactConfidence: "NOT_CALCULABLE" }));
    expect(impacto.valor).toBe("sem impacto");

    // A materialidade se anuncia em reais, que é a régua desta tela.
    const [material] = filtrosAtivos(com({ minAbsImpact: "1500" }));
    expect(material.valor).toContain("1.500");
  });
});
