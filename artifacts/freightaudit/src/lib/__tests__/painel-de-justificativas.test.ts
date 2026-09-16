import { describe, expect, it } from "vitest";

import {
  enderecoDasLinhas,
  iniciaisDoResponsavel,
  modulosDoPainel,
  rubricasDoPainel,
  pendenciasPorTipo,
  responsaveisDoPainel,
  resumoDoPainel,
  tiposDoPainel,
  vigenciasDoPainel,
  direcaoDaLinha,
  type AutorDeJustificativas,
  type CoberturaDeJustificativas,
  type CoberturaDeRubrica,
  type LinhaDoPainel,
} from "../painel-de-justificativas";
import { EQUIPAMENTOS_DO_AMBIENTE } from "../frota";
import type { ChaveDeModulo } from "@workspace/comparison/modulos-de-justificativa";

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

describe("tiposDoPainel", () => {
  /*
    O painel não cobra trecho — a razão está em
    `@workspace/comparison/painel-de-justificativas-escopo`. O que se prende
    aqui é que a lista sai da do ambiente, e não de uma segunda lista escrita à
    mão: no dia em que a empurrada ganhar um quarto ativo, ele aparece sozinho.
  */
  it("oferece os ativos da operação, menos o que o painel não cobra", () => {
    expect(tiposDoPainel("auditoria")).toEqual(["CAVALO", "CARRETA"]);
  });

  it("não mexe nas operações que não têm trecho", () => {
    expect(tiposDoPainel("auditoria-rota")).toEqual(
      EQUIPAMENTOS_DO_AMBIENTE["auditoria-rota"],
    );
    expect(tiposDoPainel("auditoria-apoio")).toEqual(["EMPILHADEIRA"]);
  });
});

describe("pendenciasPorTipo", () => {
  it("põe os tipos da operação mesmo zerados, e os extras depois", () => {
    const barras = pendenciasPorTipo(
      [...ACERVO, linha("v2", "DOLLY", 2, 0)],
      null,
      tiposDoPainel("auditoria"),
    );

    expect(barras.map((b) => b.tipo)).toEqual(["CAVALO", "CARRETA", "DOLLY"]);
    expect(barras.find((b) => b.tipo === "CARRETA")!.pendentes).toBe(0);
    expect(barras.find((b) => b.tipo === "CAVALO")!.pendentes).toBe(10);
  });

  /*
    A barra é clicável e leva à aba (ou ao filtro) do tipo. O trecho não tem
    nem uma nem outro neste painel, então ele não vira barra — nem pedido entre
    os fixos, nem vindo do dado, que é o que aconteceria com uma resposta
    guardada de antes desta regra.
  */
  it("não dá barra ao tipo que o painel não cobra", () => {
    const barras = pendenciasPorTipo(ACERVO, null, EQUIPAMENTOS_DO_AMBIENTE.auditoria);

    expect(barras.map((b) => b.tipo)).toEqual(["CAVALO", "CARRETA"]);
  });

  it("recorta por vigência quando uma está escolhida", () => {
    const barras = pendenciasPorTipo(ACERVO, "v2", tiposDoPainel("auditoria"));

    expect(barras.find((b) => b.tipo === "CAVALO")!.pendentes).toBe(4);
    expect(barras.find((b) => b.tipo === "CARRETA")!.pendentes).toBe(0);
  });

  /* Sem tipo declarado não há barra a que pertencer — inventar uma prometeria
     uma fila que a tela de justificar não sabe abrir. */
  it("deixa de fora a alteração sem tipo", () => {
    const barras = pendenciasPorTipo(
      [linha("v1", null, 7, 0)],
      null,
      tiposDoPainel("auditoria"),
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

/**
 * A leitura por módulo — a que o Monitor passou a dar depois que justificar
 * virou trabalho de cada módulo.
 *
 * O que se prende aqui é a régua que faz a tela poder ser conferida com ela
 * mesma: a soma dos módulos é a soma dos cartões, a rubrica volta inteira da
 * chave que o servidor mandou, e a ordem é a da pendência — porque a tabela
 * existe para dizer por onde começar.
 */
function rubrica(
  changeSetId: string,
  entityType: string | null,
  modulo: ChaveDeModulo,
  chave: string,
  alteracoes: number,
  justificadas: number,
  ultimaEm: string | null = null,
  ultimoAutor: string | null = null,
): CoberturaDeRubrica {
  return {
    changeSetId,
    entityType,
    modulo,
    rubrica: chave,
    alteracoes,
    justificadas,
    ultimaEm,
    ultimoAutor,
  };
}

const POR_RUBRICA: CoberturaDeRubrica[] = [
  rubrica("v1", "CAVALO", "CUSTO_FIXO", "finame", 10, 4, "2026-07-01T10:00:00.000Z", "ana@x.com"),
  rubrica("v1", "CARRETA", "CUSTO_FIXO", "finame", 6, 6, "2026-08-02T10:00:00.000Z", "joao@x.com"),
  rubrica("v2", "CAVALO", "CUSTO_VARIAVEL", "manutencao", 4, 0),
  rubrica("v2", "CAVALO", "SEM_CLASSE", "parametro:FROTA|Frota emprestada", 8, 1),
];

describe("modulosDoPainel", () => {
  it("soma por módulo, e a soma é a mesma do cartão do total", () => {
    const modulos = modulosDoPainel(POR_RUBRICA, null, null);
    expect(modulos.map((m) => [m.modulo, m.alteracoes, m.justificadas])).toEqual([
      ["CUSTO_FIXO", 16, 10],
      ["CUSTO_VARIAVEL", 4, 0],
      ["SEM_CLASSE", 8, 1],
    ]);
    expect(modulos.reduce((s, m) => s + m.alteracoes, 0)).toBe(28);
  });

  it("não devolve módulo sem alteração no recorte", () => {
    /* O QLP na aba do Cavalo não tem o que dizer — e uma barra zerada ali seria
       uma afirmação sobre um trabalho que não existe neste recorte. */
    const modulos = modulosDoPainel(POR_RUBRICA, "v2", null);
    expect(modulos.map((m) => m.modulo)).toEqual(["CUSTO_VARIAVEL", "SEM_CLASSE"]);
  });

  it("conta a mesma rubrica em duas vigências como uma rubrica pendente", () => {
    /* O gestor abre uma tela, não duas. */
    const duasVigencias = [
      rubrica("v1", "CAVALO", "CUSTO_FIXO", "finame", 10, 4),
      rubrica("v2", "CAVALO", "CUSTO_FIXO", "finame", 10, 4),
    ];
    expect(modulosDoPainel(duasVigencias, null, null)[0].rubricasPendentes).toBe(1);
  });

  it("é nulo enquanto a cobertura não chegou — e não vazio", () => {
    expect(modulosDoPainel(null, null, null)).toEqual([]);
  });
});

describe("rubricasDoPainel", () => {
  it("ordena da mais pendente para a menos", () => {
    const linhas = rubricasDoPainel(POR_RUBRICA, null, null);
    expect(linhas.map((l) => [l.rotulo, l.pendentes])).toEqual([
      ["Frota emprestada", 7],
      /* 16 alterações e 10 justificadas, somando as duas vigências. */
      ["Finame", 6],
      ["Manutenção", 4],
    ]);
  });

  it("soma a mesma rubrica entre vigências e tipos numa linha só", () => {
    const [finame] = rubricasDoPainel(POR_RUBRICA, null, null).filter(
      (l) => l.rotulo === "Finame",
    );
    expect(finame.alteracoes).toBe(16);
    expect(finame.justificadas).toBe(10);
    /* A justificativa mais recente entre as duas, com o autor dela. */
    expect(finame.ultimoAutor).toBe("joao@x.com");
  });

  it("devolve a rota de quem tem tela, e nenhuma de quem não tem", () => {
    const linhas = rubricasDoPainel(POR_RUBRICA, null, null);
    expect(linhas.find((l) => l.rotulo === "Finame")?.rota).toBe("/custo-fixo-finame");
    expect(linhas.find((l) => l.rotulo === "Frota emprestada")?.rota).toBeNull();
  });

  it("escreve o nome da rubrica do QLP com o dicionário da casa", () => {
    const doQlp = rubricasDoPainel(
      [rubrica("v1", "QLP_OPERACIONAL", "QLP", "qlp:saude", 3, 0)],
      null,
      null,
    );
    expect(doQlp[0].rotulo).toBe("Plano de saúde");
    expect(doQlp[0].rota).toBe("/qlp/saude");
  });

  it("recorta por módulo sem mexer no resto", () => {
    const linhas = rubricasDoPainel(POR_RUBRICA, null, null, "CUSTO_FIXO");
    expect(linhas.map((l) => l.rotulo)).toEqual(["Finame"]);
  });

  it("recorta por tipo de ativo pela mesma régua das abas", () => {
    const linhas = rubricasDoPainel(POR_RUBRICA, null, "CARRETA");
    expect(linhas.map((l) => [l.rotulo, l.alteracoes])).toEqual([["Finame", 6]]);
  });
});
