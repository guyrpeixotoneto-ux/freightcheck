import { describe, expect, it } from "vitest";

import {
  ALTURA_DA_FASE,
  COLUNAS_POR_LINHA,
  PASSO_X,
  PASSO_Y,
  desviosDoFluxo,
  posicoesDoFluxo,
  projetarFases,
  projetarFluxoHorizontal,
} from "@/lib/fluxos-visoes";
import type { Conexao, Etapa, FluxoCompleto } from "@/lib/fluxos";

/**
 * O FLUXO DEITADO — trilho, faixa de desvio, quebra de linha e fases.
 *
 * O que este arquivo prova não é aparência, é leitura: que o tratamento de
 * exceção sai do caminho feliz em vez de ser enfileirado nele, que o desenho
 * quebra em linhas em vez de crescer para sempre, e que a faixa de fases é
 * derivada do mesmo campo que as Raias agrupam — nunca de um cadastro novo.
 *
 * E a promessa que nada disso pode quebrar: o horizontal é calculado, não
 * gravado. Nenhum caso abaixo toca em `pos_x`/`pos_y`.
 */

let sequencia = 0;

function etapa(parcial: Partial<Etapa> & { id: string; nome: string }): Etapa {
  sequencia += 1;
  return {
    fluxoId: "f1",
    descricao: null,
    tipo: "PROCESSO",
    ordem: sequencia,
    responsavel: null,
    area: null,
    departamentoId: null,
    cargoId: null,
    pessoaId: null,
    objetivo: null,
    sistemaPrincipal: null,
    regras: null,
    informacoesConsultadas: null,
    falhas: null,
    gargalos: null,
    informacoes: null,
    observacoes: null,
    status: "ATIVO",
    posX: 0,
    posY: 0,
    chaveMonitoramento: null,
    subfluxoId: null,
    itens: [],
    indicadores: [],
    acoes: [],
    ...parcial,
  } as Etapa;
}

function conexao(origem: string, destino: string, tipo = "SEQUENCIA"): Conexao {
  return {
    id: `${origem}->${destino}`,
    fluxoId: "f1",
    origemEtapaId: origem,
    destinoEtapaId: destino,
    tipo,
    rotulo: null,
    ordem: 0,
  };
}

function fluxo(etapas: Etapa[], conexoes: Conexao[]): FluxoCompleto {
  return {
    fluxo: {
      id: "f1",
      empresaId: null,
      nome: "Faturamento",
      slug: "faturamento",
      descricao: null,
      objetivo: null,
      categoria: "Faturamento",
      status: "ATIVO",
      versao: 1,
      dono: null,
      criadoEm: "2026-01-01T00:00:00Z",
      atualizadoEm: "2026-01-01T00:00:00Z",
      criadoPor: null,
      atualizadoPor: null,
    },
    etapas,
    conexoes,
  } as unknown as FluxoCompleto;
}

/**
 * O processo da referência, reduzido ao que importa aqui: um trilho com uma
 * decisão no meio, e uma pendência pendurada no "não" que volta para a etapa
 * anterior.
 */
function fluxoComDesvio(): FluxoCompleto {
  sequencia = 0;
  return fluxo(
    [
      etapa({ id: "a", nome: "Origem da tarifa", tipo: "INICIO", area: "Preparação" }),
      etapa({ id: "b", nome: "Validação no SAP", tipo: "VALIDACAO", area: "Preparação" }),
      etapa({ id: "c", nome: "Dados válidos?", tipo: "DECISAO", area: "Preparação" }),
      etapa({ id: "x", nome: "Corrigir cadastro", tipo: "PENDENCIA", area: "Preparação" }),
      etapa({ id: "d", nome: "Emissão do CT-e", tipo: "DOCUMENTO", area: "Emissão" }),
      etapa({ id: "e", nome: "Auditoria fiscal", tipo: "PROCESSO", area: "Fiscal" }),
      etapa({ id: "f", nome: "Fechamento", tipo: "FIM", area: "Fiscal" }),
    ],
    [
      conexao("a", "b"),
      conexao("b", "c"),
      conexao("c", "d", "DECISAO_SIM"),
      conexao("c", "x", "DECISAO_NAO"),
      conexao("x", "b", "RETRABALHO"),
      conexao("d", "e"),
      conexao("e", "f"),
    ],
  );
}

describe("o desvio sai do caminho feliz", () => {
  it("a pendência é desvio, e o trilho continua sendo o resto", () => {
    const completo = fluxoComDesvio();
    const desvios = desviosDoFluxo(completo.etapas, completo.conexoes);
    expect([...desvios]).toEqual(["x"]);
  });

  it("o que só se alcança por exceção também é desvio, em cadeia", () => {
    sequencia = 0;
    const completo = fluxo(
      [
        etapa({ id: "a", nome: "Emite" }),
        etapa({ id: "b", nome: "Confere" }),
        etapa({ id: "p", nome: "Trata a falha" }),
        etapa({ id: "q", nome: "Reprocessa" }),
      ],
      [
        conexao("a", "b"),
        conexao("b", "p", "EXCECAO"),
        conexao("p", "q"),
        conexao("q", "b", "RETRABALHO"),
      ],
    );
    const desvios = desviosDoFluxo(completo.etapas, completo.conexoes);
    /* `p` chega só por exceção; `q` só por `p` — e `b` continua no trilho. */
    expect([...desvios].sort()).toEqual(["p", "q"]);
  });

  it("um fluxo só de pendências não fica sem caminho principal", () => {
    sequencia = 0;
    const completo = fluxo(
      [
        etapa({ id: "a", nome: "Pendência 1", tipo: "PENDENCIA" }),
        etapa({ id: "b", nome: "Pendência 2", tipo: "PENDENCIA" }),
      ],
      [conexao("a", "b")],
    );
    expect(desviosDoFluxo(completo.etapas, completo.conexoes).size).toBe(0);
  });
});

describe("o desenho deitado", () => {
  it("põe o desvio embaixo, na coluna de quem o originou", () => {
    const completo = fluxoComDesvio();
    const { posicoes, colunas } = projetarFluxoHorizontal(completo);

    /* Mesma coluna da decisão que leva a ele… */
    expect(colunas.get("x")).toBe(colunas.get("c"));
    expect(posicoes.get("x")!.x).toBe(posicoes.get("c")!.x);
    /* …e abaixo do trilho inteiro. */
    const fundoDoTrilho = Math.max(
      ...["a", "b", "c", "d", "e", "f"].map((id) => posicoes.get(id)!.y),
    );
    expect(posicoes.get("x")!.y).toBeGreaterThan(fundoDoTrilho);
  });

  it("não gasta coluna com o desvio: o trilho anda um passo por etapa", () => {
    const completo = fluxoComDesvio();
    const { posicoes } = projetarFluxoHorizontal(completo);
    expect(["a", "b", "c", "d", "e", "f"].map((id) => posicoes.get(id)!.x)).toEqual([
      0,
      PASSO_X,
      2 * PASSO_X,
      3 * PASSO_X,
      4 * PASSO_X,
      5 * PASSO_X,
    ]);
  });

  it("quebra em linhas em vez de crescer para sempre", () => {
    sequencia = 0;
    const total = COLUNAS_POR_LINHA + 3;
    const etapas = Array.from({ length: total }, (_, i) =>
      etapa({ id: `e${i}`, nome: `Etapa ${i}` }),
    );
    const conexoes = etapas.slice(1).map((e, i) => conexao(etapas[i].id, e.id));
    const completo = fluxo(etapas, conexoes);

    const { posicoes, linhas } = projetarFluxoHorizontal(completo);
    expect(linhas).toHaveLength(2);

    const ultimaDaPrimeira = posicoes.get(`e${COLUNAS_POR_LINHA - 1}`)!;
    const primeiraDaSegunda = posicoes.get(`e${COLUNAS_POR_LINHA}`)!;
    /* Volta para a esquerda e desce — é a quebra que mantém o cartão legível. */
    expect(primeiraDaSegunda.x).toBe(0);
    expect(primeiraDaSegunda.y).toBeGreaterThan(ultimaDaPrimeira.y);
    /* E nenhuma etapa fica de fora do desenho. */
    expect(posicoes.size).toBe(total);
  });

  it("continua sem gravar: o arranjo vertical é o que está no banco", () => {
    const completo = fluxoComDesvio();
    projetarFluxoHorizontal(completo);
    expect(completo.etapas.every((e) => e.posX === 0 && e.posY === 0)).toBe(true);
    expect(posicoesDoFluxo(completo, "vertical").get("d")).toEqual({ x: 0, y: 0 });
  });

  it("aguenta um fluxo vazio", () => {
    const vazio = fluxo([], []);
    const projecao = projetarFluxoHorizontal(vazio);
    expect(projecao.posicoes.size).toBe(0);
    expect(projecao.linhas).toEqual([]);
    expect(projetarFases(vazio, projecao)).toEqual([]);
  });
});

describe("as fases", () => {
  it("juntam colunas vizinhas com a mesma área, na ordem do processo", () => {
    const completo = fluxoComDesvio();
    const horizontal = projetarFluxoHorizontal(completo);
    const fases = projetarFases(completo, horizontal, "area");

    expect(fases.map((f) => f.rotulo)).toEqual(["Preparação", "Emissão", "Fiscal"]);
    /* A primeira cobre três colunas — as três etapas de Preparação. */
    expect(fases[0].largura).toBe(3 * PASSO_X);
    expect(fases[0].x).toBe(0);
    expect(fases[1].x).toBe(3 * PASSO_X);
    /* A cor é a da ordem de aparição, e a faixa sobe até o cabeçalho. */
    expect(fases.map((f) => f.cor)).toEqual([0, 1, 2]);
    expect(fases[0].topo).toBe(horizontal.linhas[0].topo - ALTURA_DA_FASE);
    /* O desvio conta na fase da coluna dele, e não some da contagem. */
    expect(fases[0].etapas).toContain("x");
  });

  it("sem o campo preenchido, não desenha faixa nenhuma", () => {
    sequencia = 0;
    const completo = fluxo(
      [etapa({ id: "a", nome: "A" }), etapa({ id: "b", nome: "B" })],
      [conexao("a", "b")],
    );
    const horizontal = projetarFluxoHorizontal(completo);
    expect(projetarFases(completo, horizontal, "area")).toEqual([]);
  });

  it("não atravessa a quebra: vira dois trechos com o mesmo nome", () => {
    sequencia = 0;
    const total = COLUNAS_POR_LINHA + 2;
    const etapas = Array.from({ length: total }, (_, i) =>
      etapa({ id: `e${i}`, nome: `Etapa ${i}`, area: "Financeiro" }),
    );
    const conexoes = etapas.slice(1).map((e, i) => conexao(etapas[i].id, e.id));
    const completo = fluxo(etapas, conexoes);

    const horizontal = projetarFluxoHorizontal(completo);
    const fases = projetarFases(completo, horizontal, "area");
    expect(fases).toHaveLength(2);
    expect(fases.map((f) => f.rotulo)).toEqual(["Financeiro", "Financeiro"]);
    expect(fases[1].x).toBe(0);
    expect(fases[1].topo).toBeGreaterThan(fases[0].topo);
    /* A altura de cada trecho é a da sua linha, mais o cabeçalho. */
    expect(fases[0].altura).toBe(horizontal.linhas[0].altura + ALTURA_DA_FASE);
  });

  it("agrupa pelo campo escolhido — o mesmo das Raias", () => {
    sequencia = 0;
    const completo = fluxo(
      [
        etapa({ id: "a", nome: "A", area: "Preparação", responsavel: "Operação" }),
        etapa({ id: "b", nome: "B", area: "Emissão", responsavel: "Operação" }),
      ],
      [conexao("a", "b")],
    );
    const horizontal = projetarFluxoHorizontal(completo);
    expect(projetarFases(completo, horizontal, "area").map((f) => f.rotulo)).toEqual([
      "Preparação",
      "Emissão",
    ]);
    /* Por responsável, as duas colunas são o mesmo capítulo — uma faixa só. */
    const porResponsavel = projetarFases(completo, horizontal, "responsavel");
    expect(porResponsavel).toHaveLength(1);
    expect(porResponsavel[0].largura).toBe(2 * PASSO_X);
  });
});

describe("o passo do desenho", () => {
  it("a altura da faixa cabe o losango da decisão", () => {
    /* O cartão de decisão mede 150; um passo menor faria dois se tocarem. */
    expect(PASSO_Y).toBeGreaterThan(150);
  });
});
