import { describe, expect, it } from "vitest";
import { niveisDoFluxo, posicionarEtapas, temCiclo, PASSO_Y } from "../layout";
import type { Conexao, Etapa } from "../modelo";

/**
 * O desenho — e a prova de que ele não é uma lista vertical disfarçada.
 *
 * O layout é função pura justamente para caber aqui: as afirmações abaixo são
 * sobre a **forma** do fluxograma (a decisão abre dois ramos lado a lado, o
 * retrabalho não empurra ninguém para baixo, a etapa solta não some) e não
 * sobre pixel de tela.
 */

function etapa(id: string, ordem: number, posX = 0, posY = 0): Etapa {
  return {
    id,
    fluxoId: "f",
    nome: id,
    descricao: null,
    tipo: "PROCESSO",
    ordem,
    responsavel: null,
    area: null,
    objetivo: null,
    sistemaPrincipal: null,
    regras: null,
    informacoesConsultadas: null,
    observacoes: null,
    status: "ATIVO",
    posX,
    posY,
    chaveMonitoramento: null,
    itens: [],
    indicadores: [],
    acoes: [],
  };
}

function liga(de: string, para: string, tipo: Conexao["tipo"] = "SEQUENCIA"): Conexao {
  return {
    id: `${de}->${para}`,
    fluxoId: "f",
    origemEtapaId: de,
    destinoEtapaId: para,
    tipo,
    rotulo: null,
    ordem: 0,
  };
}

describe("os níveis do fluxo", () => {
  it("uma corrente vira uma coluna de níveis, um por etapa", () => {
    const etapas = [etapa("a", 0), etapa("b", 1), etapa("c", 2)];
    const conexoes = [liga("a", "b"), liga("b", "c")];
    expect(niveisDoFluxo(etapas, conexoes)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("uma decisão põe os dois ramos NO MESMO nível — é isso que faz ser fluxograma", () => {
    const etapas = [etapa("decide", 0), etapa("sim", 1), etapa("nao", 2)];
    const conexoes = [
      liga("decide", "sim", "DECISAO_SIM"),
      liga("decide", "nao", "DECISAO_NAO"),
    ];
    const niveis = niveisDoFluxo(etapas, conexoes);
    expect(niveis[0]).toEqual(["decide"]);
    expect(niveis[1]).toEqual(["sim", "nao"]);
  });

  it("o retrabalho não empurra a etapa de destino para um nível novo", () => {
    // validacao → decisao → correcao → validacao (a volta)
    const etapas = [etapa("validacao", 0), etapa("decisao", 1), etapa("correcao", 2)];
    const conexoes = [
      liga("validacao", "decisao"),
      liga("decisao", "correcao", "DECISAO_NAO"),
      liga("correcao", "validacao", "RETRABALHO"),
    ];
    const niveis = niveisDoFluxo(etapas, conexoes);
    expect(niveis).toEqual([["validacao"], ["decisao"], ["correcao"]]);
  });

  it("um fluxo que é só ciclo ainda assim é desenhado", () => {
    // Ninguém tem grau de entrada zero: sem o desempate por ordem, a busca não
    // começaria e todas as etapas ficariam empilhadas na origem.
    const etapas = [etapa("a", 0), etapa("b", 1)];
    const conexoes = [liga("a", "b"), liga("b", "a")];
    expect(niveisDoFluxo(etapas, conexoes)).toEqual([["a"], ["b"]]);
  });

  it("a etapa solta aparece, em nível próprio, em vez de sumir", () => {
    const etapas = [etapa("a", 0), etapa("b", 1), etapa("solta", 2)];
    const conexoes = [liga("a", "b")];
    const niveis = niveisDoFluxo(etapas, conexoes);
    expect(niveis.flat()).toContain("solta");
    expect(niveis.flat()).toHaveLength(3);
  });

  it("fluxo vazio não quebra", () => {
    expect(niveisDoFluxo([], [])).toEqual([]);
  });

  it("uma conexão que cita etapa inexistente é ignorada, não derruba o desenho", () => {
    const etapas = [etapa("a", 0)];
    expect(niveisDoFluxo(etapas, [liga("a", "fantasma")])).toEqual([["a"]]);
  });
});

describe("as posições", () => {
  it("cada nível desce uma faixa", () => {
    const etapas = [etapa("a", 0), etapa("b", 1)];
    const posicoes = posicionarEtapas(etapas, [liga("a", "b")]);
    expect(posicoes.find((p) => p.etapaId === "a")!.posY).toBe(0);
    expect(posicoes.find((p) => p.etapaId === "b")!.posY).toBe(PASSO_Y);
  });

  it("irmãos ficam simétricos em torno do eixo", () => {
    const etapas = [etapa("d", 0), etapa("sim", 1), etapa("nao", 2)];
    const posicoes = posicionarEtapas(etapas, [liga("d", "sim"), liga("d", "nao")]);
    const sim = posicoes.find((p) => p.etapaId === "sim")!;
    const nao = posicoes.find((p) => p.etapaId === "nao")!;
    expect(sim.posX).toBe(-nao.posX);
    expect(sim.posY).toBe(nao.posY);
  });

  it("não mexe em quem já foi arrastado", () => {
    const etapas = [etapa("a", 0, 500, 300), etapa("b", 1)];
    const posicoes = posicionarEtapas(etapas, [liga("a", "b")]);
    expect(posicoes.map((p) => p.etapaId)).toEqual(["b"]);
  });

  it("reorganiza tudo quando quem chama pede explicitamente", () => {
    const etapas = [etapa("a", 0, 500, 300), etapa("b", 1)];
    const posicoes = posicionarEtapas(etapas, [liga("a", "b")], { somenteSemPosicao: false });
    expect(posicoes.map((p) => p.etapaId).sort()).toEqual(["a", "b"]);
  });
});

describe("ciclo — permitido, e reportado", () => {
  it("uma corrente não tem ciclo", () => {
    const etapas = [etapa("a", 0), etapa("b", 1)];
    expect(temCiclo(etapas, [liga("a", "b")])).toBe(false);
  });

  it("a volta do retrabalho é um ciclo, e isso é informação, não erro", () => {
    const etapas = [etapa("v", 0), etapa("d", 1), etapa("c", 2)];
    const conexoes = [liga("v", "d"), liga("d", "c"), liga("c", "v", "RETRABALHO")];
    expect(temCiclo(etapas, conexoes)).toBe(true);
  });

  it("dois ramos que reencontram não são ciclo", () => {
    const etapas = [etapa("d", 0), etapa("x", 1), etapa("y", 2), etapa("fim", 3)];
    const conexoes = [liga("d", "x"), liga("d", "y"), liga("x", "fim"), liga("y", "fim")];
    expect(temCiclo(etapas, conexoes)).toBe(false);
  });
});
