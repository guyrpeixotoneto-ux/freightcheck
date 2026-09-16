import { describe, expect, it } from "vitest";
import type { LinhaDoMonitorDeEquipe } from "@workspace/comparison/monitor-equipe";
import {
  FILTROS_VAZIOS,
  enderecoDaOrigem,
  enderecoDoMonitorDeEquipe,
  escreverFiltros,
  escreverModulo,
  lerFiltros,
  ordenar,
  paginar,
} from "../monitor-equipe";

/**
 * O que estes testes prendem.
 *
 * Este arquivo escreve endereços e ordena listas — e as duas coisas são as que
 * quebram em silêncio. Um endereço sem o par leva a pessoa à tela certa no par
 * errado, e ninguém percebe porque a tela abre; uma ordenação que trata ausência
 * como zero põe no topo justamente a linha que não foi medida.
 *
 * Quatro promessas:
 *
 * 1. **os dois pares viajam separados**, porque os dois quadros são duas séries;
 * 2. o inválido do endereço cai no padrão, nunca em tela vazia;
 * 3. o endereço da origem leva o par **daquele quadro**, e nunca os filtros do
 *    Monitor;
 * 4. linha sem diferença vai para o fim da ordem por diferença, e não para o
 *    começo como se fosse zero.
 */

const base: LinhaDoMonitorDeEquipe = {
  id: "OPERACIONAL:transporte:1",
  modulo: "transporte",
  quadro: "OPERACIONAL",
  changeId: 1,
  par: {
    quadro: "OPERACIONAL",
    baseId: "a1",
    comparadaId: "b2",
    baseRotulo: null,
    comparadaRotulo: null,
    baseData: null,
    comparadaData: null,
  },
  cargo: { chave: "07526557001505CARGOAJUDANTE", entityType: "QLP_OPERACIONAL" },
  variavel: {
    chave: "vale_transporte",
    rotulo: "Vale-transporte",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    attributeCode: "qlp_operacional.vale_transporte",
  },
  estado: "ALTERADO",
  valorAnterior: "120",
  valorAtual: "150",
  diferenca: 30,
  variacao: 25,
  situacao: { tipo: "SEM_VALORACAO", motivo: null },
  prioridade: { nivel: "MEDIO", score: 26, motivos: [] },
  origem: {
    modulo: "transporte",
    quadro: "OPERACIONAL",
    rota: "/qlp/transporte",
    changeSetId: "cs-1",
  },
};

const linha = (over: Partial<LinhaDoMonitorDeEquipe> = {}): LinhaDoMonitorDeEquipe => ({
  ...base,
  ...over,
});

describe("os filtros no endereço", () => {
  it("carrega um par por quadro, e eles não se misturam", () => {
    const query = escreverFiltros({
      ...FILTROS_VAZIOS,
      baseOperacional: "op1",
      comparadaOperacional: "op2",
      baseAdministrativo: "ad1",
      comparadaAdministrativo: "ad2",
    });
    const lido = lerFiltros(query);
    expect(lido.baseOperacional).toBe("op1");
    expect(lido.comparadaOperacional).toBe("op2");
    expect(lido.baseAdministrativo).toBe("ad1");
    expect(lido.comparadaAdministrativo).toBe("ad2");
  });

  it("descarta a situação e o quadro que não existem, em vez de esvaziar a tela", () => {
    const lido = lerFiltros("situacao=EFETIVO,TALVEZ&quadro=TERCEIRO");
    expect(lido.situacoes).toEqual(["EFETIVO"]);
    expect(lido.quadros).toEqual([]);
  });

  it("não escreve na URL o que é padrão", () => {
    expect(escreverFiltros(FILTROS_VAZIOS)).toBe("");
    expect(enderecoDoMonitorDeEquipe(FILTROS_VAZIOS)).toBe("/monitor-equipe");
  });

  it("a ida e a volta do endereço preservam o recorte", () => {
    const filtros = {
      ...FILTROS_VAZIOS,
      modulos: ["salario", "transporte"],
      situacoes: ["EFETIVO" as const],
      busca: " gerente ",
    };
    expect(lerFiltros(escreverFiltros(filtros)).modulos).toEqual(["salario", "transporte"]);
    expect(lerFiltros(escreverFiltros(filtros)).busca).toBe("gerente");
  });
});

describe("o endereço da origem", () => {
  const contexto = { scopeHash: "u1", canal: null };

  it("leva o par daquele quadro, e nunca os filtros do Monitor", () => {
    const endereco = enderecoDaOrigem(linha(), contexto);
    expect(endereco).toContain("/qlp/transporte?");
    expect(endereco).toContain("quadro=OPERACIONAL");
    expect(endereco).toContain("base=a1");
    expect(endereco).toContain("comparada=b2");
    expect(endereco).toContain("scopeHash=u1");
    expect(endereco).not.toContain("situacao=");
    expect(endereco).not.toContain("modulo=");
  });

  it("manda o eixo do cargo para a tela do quadro, na aba de comparação", () => {
    const endereco = enderecoDaOrigem(
      linha({ modulo: "cargo", quadro: "ADMINISTRATIVO" }),
      contexto,
    );
    expect(endereco).toContain("/qlp-administrativo?");
    expect(endereco).toContain("aba=comparacao");
  });
});

describe("os rótulos", () => {
  it("usa o dicionário da lateral, e não um segundo", () => {
    expect(escreverModulo("transporte")).toBe("Vale-transporte");
    expect(escreverModulo("saude")).toBe("Plano de saúde");
  });

  it("dá nome ao eixo do cargo, que não é rubrica", () => {
    expect(escreverModulo("cargo")).toBe("Entradas e saídas de cargo");
  });
});

describe("a ordenação", () => {
  it("ordena por diferença em módulo, e joga a ausência para o fim", () => {
    const linhas = [
      linha({ id: "1", diferenca: 3 }),
      linha({ id: "2", diferenca: -40 }),
      linha({ id: "3", diferenca: null }),
    ];
    const ordenadas = ordenar(linhas, { coluna: "diferenca", ascendente: false }, {});
    expect(ordenadas.map((l) => l.id)).toEqual(["2", "1", "3"]);
  });

  it("ordena o cargo pelo nome legível quando há um", () => {
    const rotulos = {
      c1: "CAMAÇARI · AJUDANTE",
      c2: "CAMAÇARI · MOTORISTA",
    };
    const linhas = [
      linha({ id: "1", cargo: { chave: "c2", entityType: "QLP_OPERACIONAL" } }),
      linha({ id: "2", cargo: { chave: "c1", entityType: "QLP_OPERACIONAL" } }),
    ];
    const ordenadas = ordenar(linhas, { coluna: "cargo", ascendente: true }, rotulos);
    expect(ordenadas.map((l) => l.id)).toEqual(["2", "1"]);
  });
});

describe("a paginação", () => {
  it("fatia a lista sem reordenar nada", () => {
    expect(paginar([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(paginar([1, 2, 3], 9, 2)).toEqual([]);
  });
});
