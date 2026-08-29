import { describe, expect, it } from "vitest";

import {
  enderecoDasLinhas,
  iniciaisDoResponsavel,
  pendenciasPorTipo,
  responsaveisDoPainel,
  resumoDoPainel,
  vigenciasDoPainel,
  direcaoDaLinha,
  type AutorDeJustificativas,
  type CoberturaDeJustificativas,
  type LinhaDoPainel,
} from "../painel-de-justificativas";
import { EQUIPAMENTOS_DO_AMBIENTE } from "../frota";

/**
 * O Painel de Justificativas afirma três números na cara do gestor — quanto
 * mudou, quanto está explicado e quanto falta — e o terceiro é a diferença dos
 * dois primeiros. O que se guarda aqui é que essa conta não se deixa mentir
 * pelos dois recortes que a tela oferece (vigência e tipo de ativo), e que os
 * casos em que ela não tem resposta — cobertura ainda não carregada, recorte
 * sem alteração nenhuma — saem como o que são, e não como zero.
 */

function linha(
  changeSetId: string,
  entityType: string | null,
  alteracoes: number,
  justificadas: number,
  placas = 1,
  placasPendentes = 0,
): CoberturaDeJustificativas {
  return { changeSetId, entityType, alteracoes, justificadas, placas, placasPendentes };
}

const ACERVO: CoberturaDeJustificativas[] = [
  linha("v1", "CAVALO", 10, 4, 5, 3),
  linha("v1", "CARRETA", 6, 6, 4, 0),
  linha("v2", "CAVALO", 4, 0, 2, 2),
  linha("v2", "TRECHO", 5, 1, 3, 2),
];

describe("resumoDoPainel", () => {
  it("soma o acervo inteiro quando nenhum recorte foi escolhido", () => {
    const resumo = resumoDoPainel(ACERVO, null, null)!;

    expect(resumo.alteracoes).toBe(25);
    expect(resumo.justificadas).toBe(11);
    expect(resumo.pendentes).toBe(14);
    expect(resumo.cobertura).toBeCloseTo(44);
  });

  it("recorta por vigência e por tipo, e cruza os dois", () => {
    expect(resumoDoPainel(ACERVO, "v1", null)!.alteracoes).toBe(16);
    expect(resumoDoPainel(ACERVO, null, "CAVALO")!.alteracoes).toBe(14);
    expect(resumoDoPainel(ACERVO, "v2", "TRECHO")!.justificadas).toBe(1);
  });

  /*
    A escolha viaja pelo endereço e pelas barras, e um `cavalo` minúsculo tem de
    abrir o mesmo recorte que o clique abre — a mesma normalização das abas da
    fila.
  */
  it("acha o tipo pela mesma normalização das abas", () => {
    expect(resumoDoPainel(ACERVO, null, "cavalo")!.alteracoes).toBe(14);
  });

  /*
    A mesma placa que mudou em duas vigências é uma placa. Somar as linhas a
    contaria duas vezes, e o cartão prometeria uma frota maior do que a que
    existe — por isso, atravessando vigências, a contagem é a da vigência que
    mais tem.
  */
  it("não soma placas entre vigências", () => {
    const resumo = resumoDoPainel(ACERVO, null, null)!;

    expect(resumo.placas).toBe(9); // v1: 5 + 4 — e não 14
    expect(resumo.placasPendentes).toBe(4); // v2: 2 + 2
  });

  /*
    Zero por cento é uma afirmação; "ainda não sei" é outra. Enquanto a
    cobertura não chegou, a tela não pode escrever nenhuma das duas — ver o
    cabeçalho do arquivo.
  */
  it("devolve nulo enquanto a cobertura não chegou", () => {
    expect(resumoDoPainel(null, null, null)).toBeNull();
  });

  it("não divide por zero num recorte sem alteração nenhuma", () => {
    const resumo = resumoDoPainel(ACERVO, "v1", "TRECHO")!;

    expect(resumo.alteracoes).toBe(0);
    expect(resumo.cobertura).toBe(0);
  });
});

describe("pendenciasPorTipo", () => {
  it("põe os tipos da operação mesmo zerados, e os extras depois", () => {
    const barras = pendenciasPorTipo(
      [...ACERVO, linha("v2", "DOLLY", 2, 0)],
      null,
      EQUIPAMENTOS_DO_AMBIENTE.auditoria,
    );

    expect(barras.map((b) => b.tipo)).toEqual([
      ...EQUIPAMENTOS_DO_AMBIENTE.auditoria,
      "DOLLY",
    ]);
    expect(barras.find((b) => b.tipo === "CARRETA")!.pendentes).toBe(0);
    expect(barras.find((b) => b.tipo === "CAVALO")!.pendentes).toBe(10);
  });

  it("recorta por vigência quando uma está escolhida", () => {
    const barras = pendenciasPorTipo(ACERVO, "v2", EQUIPAMENTOS_DO_AMBIENTE.auditoria);

    expect(barras.find((b) => b.tipo === "CAVALO")!.pendentes).toBe(4);
    expect(barras.find((b) => b.tipo === "CARRETA")!.pendentes).toBe(0);
  });

  /* Sem tipo declarado não há barra a que pertencer — inventar uma prometeria
     uma fila que a tela de justificar não sabe abrir. */
  it("deixa de fora a alteração sem tipo", () => {
    const barras = pendenciasPorTipo(
      [linha("v1", null, 7, 0)],
      null,
      EQUIPAMENTOS_DO_AMBIENTE.auditoria,
    );

    expect(barras.every((b) => b.pendentes === 0)).toBe(true);
  });
});

describe("vigenciasDoPainel", () => {
  it("desce da vigência mais pendente para a menos", () => {
    /* v2 tem oito pendências (4 de cavalo + 4 de trecho) contra as seis de v1. */
    expect(vigenciasDoPainel(ACERVO, null).map((v) => v.changeSetId)).toEqual(["v2", "v1"]);
  });

  it("recorta por tipo, e some a vigência que não tem nenhum", () => {
    const trecho = vigenciasDoPainel(ACERVO, "TRECHO");

    expect(trecho).toHaveLength(1);
    expect(trecho[0]).toMatchObject({ changeSetId: "v2", pendentes: 4 });
  });
});

describe("responsaveisDoPainel", () => {
  const autores: AutorDeJustificativas[] = [
    { changeSetId: "v1", criadoPor: "ana@x.com", justificadas: 4, ultimaEm: "2026-08-10T10:00:00Z" },
    { changeSetId: "v2", criadoPor: "ana@x.com", justificadas: 1, ultimaEm: "2026-08-20T10:00:00Z" },
    { changeSetId: "v1", criadoPor: "bruno@x.com", justificadas: 6, ultimaEm: "2026-08-01T10:00:00Z" },
  ];

  it("junta o mesmo autor de várias vigências, e mantém a data mais recente", () => {
    const lista = responsaveisDoPainel(autores, null);

    expect(lista.map((r) => r.criadoPor)).toEqual(["bruno@x.com", "ana@x.com"]);
    expect(lista[1]).toMatchObject({ justificadas: 5, ultimaEm: "2026-08-20T10:00:00Z" });
  });

  it("recorta pela vigência aberta", () => {
    expect(responsaveisDoPainel(autores, "v2")).toEqual([
      { criadoPor: "ana@x.com", justificadas: 1, ultimaEm: "2026-08-20T10:00:00Z" },
    ]);
  });
});

describe("iniciaisDoResponsavel", () => {
  it("abrevia o endereço em duas letras", () => {
    expect(iniciaisDoResponsavel("joao.silva@ambev.com.br")).toBe("JS");
    expect(iniciaisDoResponsavel("ana_maria_souza@x.com")).toBe("AM");
    expect(iniciaisDoResponsavel("sistema")).toBe("S");
  });
});

describe("direcaoDaLinha", () => {
  const base: LinhaDoPainel = {
    changeId: 1,
    changeSetId: "v1",
    entityLabel: "ABC1D23",
    entityType: "CAVALO",
    attributeCode: "aluguel",
    attributeName: "Aluguel",
    valueBefore: "1000",
    valueAfter: "1200",
    deltaAbsolute: 200,
    impactAmount: 200,
    impactPeriodicity: "MONTHLY",
    texto: null,
    criadoPor: null,
    criadoEm: null,
  };

  it("lê o sentido pelo sinal do delta apurado", () => {
    expect(direcaoDaLinha(base)).toBe("AUMENTO");
    expect(direcaoDaLinha({ ...base, deltaAbsolute: -50 })).toBe("REDUCAO");
  });

  /* Texto, data, entrou/saiu: não é aumento nem redução, e cair no maior dos
     dois recortes seria contar uma alteração que não mexeu em número nenhum. */
  it("não classifica a alteração sem delta", () => {
    expect(direcaoDaLinha({ ...base, deltaAbsolute: null })).toBeNull();
    expect(direcaoDaLinha({ ...base, deltaAbsolute: 0 })).toBeNull();
  });
});

describe("enderecoDasLinhas", () => {
  it("traduz o recorte da tela em página do servidor", () => {
    const endereco = enderecoDasLinhas({
      escopo: null,
      changeSetId: "v1",
      tipo: "CAVALO",
      situacao: "PENDENTE",
      direcao: "AUMENTO",
      autor: null,
      pagina: 3,
      porPagina: 25,
    });

    const q = new URLSearchParams(endereco.split("?")[1]);
    expect(q.get("changeSetId")).toBe("v1");
    expect(q.get("entityType")).toBe("CAVALO");
    expect(q.get("situacao")).toBe("PENDENTE");
    expect(q.get("direcao")).toBe("AUMENTO");
    expect(q.get("limit")).toBe("25");
    expect(q.get("offset")).toBe("50");
  });

  /*
    Uma pendência não tem quem a tenha escrito. O filtro de responsável aplicado
    sobre elas devolveria lista vazia sempre — que se leria como "não há
    pendência", que é o oposto da verdade.
  */
  it("não manda o responsável na aba das pendentes", () => {
    const pendentes = enderecoDasLinhas({
      escopo: null,
      changeSetId: null,
      tipo: null,
      situacao: "PENDENTE",
      direcao: "TODAS",
      autor: "ana@x.com",
      pagina: 1,
      porPagina: 10,
    });
    const justificadas = enderecoDasLinhas({
      escopo: null,
      changeSetId: null,
      tipo: null,
      situacao: "JUSTIFICADA",
      direcao: "TODAS",
      autor: "ana@x.com",
      pagina: 1,
      porPagina: 10,
    });

    expect(new URLSearchParams(pendentes.split("?")[1]).get("autor")).toBeNull();
    expect(new URLSearchParams(justificadas.split("?")[1]).get("autor")).toBe("ana@x.com");
  });

  /*
    A lista é a da unidade que a lateral nomeia. Sem o `scopeHash` na consulta,
    o servidor devolve as pendências de todas as unidades da operação — placas
    de CDD CEBRASA sob a lateral escrita PERNAMBUCO, que é o desencontro que o
    recorte existe para acabar. `escopo` nulo é a Visão Geral, e aí a ausência
    do parâmetro é a escolha.
  */
  it("leva a unidade aberta, e só ela omite o recorte na Visão Geral", () => {
    const daUnidade = enderecoDasLinhas({
      escopo: "sh-pernambuco",
      changeSetId: null,
      tipo: null,
      situacao: "PENDENTE",
      direcao: "TODAS",
      autor: null,
      pagina: 1,
      porPagina: 10,
    });
    const visaoGeral = enderecoDasLinhas({
      escopo: null,
      changeSetId: null,
      tipo: null,
      situacao: "PENDENTE",
      direcao: "TODAS",
      autor: null,
      pagina: 1,
      porPagina: 10,
    });

    expect(new URLSearchParams(daUnidade.split("?")[1]).get("scopeHash")).toBe(
      "sh-pernambuco",
    );
    expect(new URLSearchParams(visaoGeral.split("?")[1]).get("scopeHash")).toBeNull();
  });
});
