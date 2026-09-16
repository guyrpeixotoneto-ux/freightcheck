import { describe, expect, it } from "vitest";
import type { LinhaDoMonitorDeEquipe } from "@workspace/comparison";
import {
  modulosValidos,
  motivoDoQuadroAusente,
  parseFiltrosDeEquipe,
  passaNaBuscaDeEquipe,
  passaNaSituacaoDeEquipe,
  passaNoModulo,
} from "../monitor-equipe";

/**
 * Os filtros do Monitor Equipe, sem banco.
 *
 * O recorte é a parte da rota que decide o que entra na resposta, e aqui ele
 * decide **as contagens**: todo agregado desta tela sai das linhas que
 * sobraram. Um filtro errado não produz uma tabela errada — produz um cartão
 * errado, que é a forma de erro que ninguém confere.
 *
 * Três promessas da tela, e as três fáceis de quebrar sem perceber:
 *
 * - **os módulos válidos saem do catálogo**, e nunca de uma lista escrita na
 *   rota;
 * - **um valor inválido no endereço cai no padrão**, nunca em tela vazia;
 * - **a busca alcança o cargo pelo nome legível**, e não só pela chave
 *   normalizada que o motor grava.
 */

const base: LinhaDoMonitorDeEquipe = {
  id: "ADMINISTRATIVO:salario:1",
  modulo: "salario",
  quadro: "ADMINISTRATIVO",
  changeId: 1,
  par: {
    quadro: "ADMINISTRATIVO",
    baseId: "a1",
    comparadaId: "b2",
    baseRotulo: null,
    comparadaRotulo: null,
    baseData: null,
    comparadaData: null,
  },
  cargo: { chave: "07526557001505CARGOGERENTE", entityType: "QLP_ADMINISTRATIVO" },
  variavel: {
    chave: "despesa_ordenados",
    rotulo: "Despesa de ordenados",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    attributeCode: "qlp_administrativo.despesa_ordenados",
  },
  estado: "ALTERADO",
  valorAnterior: "4600",
  valorAtual: "5200",
  diferenca: 600,
  variacao: 13.04,
  situacao: { tipo: "SEM_VALORACAO", motivo: null },
  prioridade: { nivel: "MEDIO", score: 20, motivos: [] },
  origem: {
    modulo: "salario",
    quadro: "ADMINISTRATIVO",
    rota: "/qlp/salario",
    changeSetId: "cs-1",
  },
};

const linha = (over: Partial<LinhaDoMonitorDeEquipe> = {}): LinhaDoMonitorDeEquipe => ({
  ...base,
  ...over,
});

describe("o filtro de módulo", () => {
  it("recorta pela rubrica da linha", () => {
    expect(passaNoModulo(linha(), ["salario"])).toBe(true);
    expect(passaNoModulo(linha(), ["transporte"])).toBe(false);
  });

  it("sem módulo pedido, tudo passa — lista vazia é ausência de filtro", () => {
    expect(passaNoModulo(linha(), [])).toBe(true);
  });

  it("os módulos válidos são os do catálogo, mais o eixo do cargo", () => {
    const validos = modulosValidos();
    expect(validos).toContain("salario");
    expect(validos).toContain("cargo");
    expect(validos).not.toContain("cafe");
  });
});

describe("o filtro de situação", () => {
  it("recorta pela situação da linha", () => {
    expect(passaNaSituacaoDeEquipe(linha(), ["SEM_VALORACAO"])).toBe(true);
    expect(passaNaSituacaoDeEquipe(linha(), ["EFETIVO"])).toBe(false);
    expect(passaNaSituacaoDeEquipe(linha(), [])).toBe(true);
  });
});

describe("a busca", () => {
  const rotulos = { "07526557001505CARGOGERENTE": "CAMAÇARI · GERENTE DE OPERAÇÕES" };

  it("acha o cargo pelo nome legível, que é como quem lê o procura", () => {
    expect(passaNaBuscaDeEquipe(linha(), "gerente", rotulos)).toBe(true);
  });

  it("continua achando pela chave normalizada, para quem colou um link", () => {
    expect(passaNaBuscaDeEquipe(linha(), "CARGOGERENTE", {})).toBe(true);
  });

  it("acha pela variável e pelo código do atributo", () => {
    expect(passaNaBuscaDeEquipe(linha(), "ordenados", rotulos)).toBe(true);
    expect(passaNaBuscaDeEquipe(linha(), "qlp_administrativo", rotulos)).toBe(true);
  });

  it("não acha o que não está lá", () => {
    expect(passaNaBuscaDeEquipe(linha(), "carreta", rotulos)).toBe(false);
  });
});

describe("os filtros do endereço", () => {
  it("um módulo que não existe cai no padrão, e é dito por extenso", () => {
    const { filtros, ignorados } = parseFiltrosDeEquipe({ modulo: "cafe" });
    expect(filtros.modulos).toEqual([]);
    expect(ignorados).toEqual(['módulo "cafe"']);
  });

  it("um quadro que não existe cai nos dois quadros", () => {
    const { filtros, ignorados } = parseFiltrosDeEquipe({ quadro: "TERCEIRO" });
    expect(filtros.quadros).toEqual(["OPERACIONAL", "ADMINISTRATIVO"]);
    expect(ignorados).toEqual(['quadro "TERCEIRO"']);
  });

  it("uma situação que não existe é descartada, e as válidas ficam", () => {
    const { filtros, ignorados } = parseFiltrosDeEquipe({ situacao: "EFETIVO,TALVEZ" });
    expect(filtros.situacoes).toEqual(["EFETIVO"]);
    expect(ignorados).toEqual(['situação "TALVEZ"']);
  });

  it("aceita lista por vírgula e parâmetro repetido", () => {
    const { filtros } = parseFiltrosDeEquipe({ modulo: ["salario,encargos", "transporte"] });
    expect(filtros.modulos).toEqual(["salario", "encargos", "transporte"]);
  });
});

describe("o quadro que não entrou", () => {
  const vigencia = (over: Partial<{ id: string; scopeHash: string; entityTypeSet: string; effectiveDate: string }> = {}) => ({
    id: "v1",
    scopeHash: "u1",
    entityTypeSet: "QLP_OPERACIONAL",
    effectiveDate: "2026-08-01",
    ...over,
  });

  it("diz que nada foi importado, quando nada foi", () => {
    expect(motivoDoQuadroAusente("OPERACIONAL", [], false)).toMatch(/Nenhuma vigência/);
  });

  it("diz que só uma foi importada, quando comparar exigiria duas", () => {
    expect(motivoDoQuadroAusente("ADMINISTRATIVO", [vigencia()], false)).toMatch(
      /Só uma vigência/,
    );
  });

  it("não inventa motivo para o quadro que tem par e foi escolhido", () => {
    expect(motivoDoQuadroAusente("OPERACIONAL", [vigencia()], true)).toBeNull();
  });
});
