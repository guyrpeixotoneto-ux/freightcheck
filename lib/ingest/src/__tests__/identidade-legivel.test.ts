import { describe, expect, it } from "vitest";
import {
  camposDoTexto,
  campoDaIdentidade,
  lerIdentidade,
  partesDaIdentidade,
} from "../identidade-legivel";

/*
  A chave real, do log de uma importação de verdade: a fonte escreve dois fatos
  na coluna "Cargo" do QLP Administrativo, e ainda repete o prefixo.
*/
const ADM = "07526557001505_CERV · Cargo: Conferente | Classificação: Classificação: CARREGAMENTO - ESTACIONÁRIA";

describe("camposDoTexto", () => {
  it("abre a célula que se rotula, e derruba o prefixo repetido", () => {
    expect(camposDoTexto("Cargo: Conferente | Classificação: Classificação: CARREGAMENTO")).toEqual([
      { rotulo: "Cargo", valor: "Conferente" },
      { rotulo: "Classificação", valor: "CARREGAMENTO" },
    ]);
  });

  it("a célula que não se rotula fica inteira — abrir seria inventar", () => {
    expect(camposDoTexto("ANALISTA ADM")).toEqual([]);
  });

  it("a parte sem rótulo entre rotuladas não some", () => {
    expect(camposDoTexto("Placa: QYW2D78 | reboque")).toEqual([
      { rotulo: "Placa", valor: "QYW2D78" },
      { rotulo: "", valor: "reboque" },
    ]);
  });
});

describe("partesDaIdentidade", () => {
  it("casa cada pedaço com a coluna que o emendou", () => {
    const partes = partesDaIdentidade("QLP_OPERACIONAL", "07526557001505 · Manobrista · NOTURNO");
    expect(partes.map((p) => p.coluna?.slug)).toEqual([
      "unidade_cnpj",
      "cargo_equipe_empurrada",
      "turno_empurrada",
    ]);
  });

  /*
    Rótulo trocado é pior do que rótulo ausente: uma chave com outro número de
    pedaços volta sem coluna nenhuma, e não deslocada em um.
  */
  it("não casa o que não bate em número", () => {
    const partes = partesDaIdentidade("QLP_OPERACIONAL", "07526557001505 · Manobrista");
    expect(partes.every((p) => p.coluna === null)).toBe(true);
  });
});

describe("lerIdentidade", () => {
  it("separa unidade, cargo e classificação do quadro administrativo", () => {
    const id = lerIdentidade(ADM, "QLP_ADMINISTRATIVO");
    expect(id.unidade).toBe("07526557001505_CERV");
    expect(id.principal).toBe("Conferente");
    expect(campoDaIdentidade(id, "Classificação")).toBe("CARREGAMENTO - ESTACIONÁRIA");
  });

  /* O turno é coluna de identidade no operacional, e nunca teve casa na tela. */
  it("o turno do operacional vira campo, e não rabo do cargo", () => {
    const id = lerIdentidade("07526557001505 · Manobrista · NOTURNO", "QLP_OPERACIONAL");
    expect(id.principal).toBe("Manobrista");
    expect(campoDaIdentidade(id, "Turno")).toBe("NOTURNO");
  });

  /*
    Sem o tipo não há nome de coluna para reconhecer, e o critério passa a ser a
    forma: dois ou mais campos rotulados são uma lista de campos; um só, ou um
    com parte solta, fica inteiro.
  */
  it("sem o tipo, a forma ainda diz o que é unidade e o que é campo", () => {
    const id = lerIdentidade(ADM);
    expect(id.unidade).toBe("07526557001505_CERV");
    expect(id.principal).toBe("Conferente");
    expect(campoDaIdentidade(id, "Classificação")).toBe("CARREGAMENTO - ESTACIONÁRIA");
  });

  it("sem o tipo, um campo só não é lista de campos — fica inteiro", () => {
    const id = lerIdentidade("07526557001505 · Cargo: Conferente");
    expect(id.principal).toBe("Cargo: Conferente");
  });

  it("dois-pontos no meio de um nome é pontuação, e não campo", () => {
    const id = lerIdentidade("07526557001505 · AUX: ADM", "QLP_ADMINISTRATIVO");
    expect(id.principal).toBe("AUX: ADM");
    expect(id.campos).toEqual([]);
  });

  it("uma placa sozinha continua sendo a placa, sem unidade inventada", () => {
    const id = lerIdentidade("QYW2D78", "CAVALO");
    expect(id).toEqual({ unidade: "", principal: "QYW2D78", campos: [] });
  });
});
