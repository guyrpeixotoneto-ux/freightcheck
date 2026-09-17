import { describe, expect, it } from "vitest";
import type { LinhaDoMonitor, ResumoDoMonitor } from "@workspace/comparison/monitor-custo-fixo";
import {
  FILTROS_VAZIOS,
  baldesVisiveis,
  enderecoDaAuditoria,
  enderecoDoMonitor,
  escreverFiltros,
  escreverImpacto,
  lerFiltros,
  ordenar,
  paginar,
} from "../monitor-custo-fixo";

/**
 * O que estes testes prendem.
 *
 * A camada de leitura do Monitor não produz número nenhum, então o que se
 * prende aqui é o resto: que o endereço sobreviva à ida e à volta, que um
 * parâmetro inválido caia no padrão em vez de esvaziar a tela, que a
 * periodicidade nunca se solte do valor, e que a ordenação não finja comparar
 * grandezas diferentes.
 */

const PAR = {
  baseId: "a1",
  comparadaId: "b2",
  baseRotulo: "EMPURRADA_1_08_2026",
  comparadaRotulo: "EMPURRADA_2_08_2026",
  baseData: "2026-08-01",
  comparadaData: "2026-08-16",
};

function linha(over: Partial<LinhaDoMonitor> = {}): LinhaDoMonitor {
  return {
    id: "FINAME:1",
    modulo: "FINAME",
    changeId: 1,
    par: PAR,
    entidade: { tipo: "VEICULO", rotulo: "ABC1D23", entityType: "CAVALO", placa: "ABC1D23" },
    variavel: {
      chave: "parcela",
      rotulo: "Parcela FINAME",
      medida: "DINHEIRO",
      attributeCode: "cavalo.finame_cavalo",
    },
    estado: "ALTERADO",
    valorAnterior: "8450",
    valorAtual: "8760",
    variacao: 3.67,
    impacto: {
      situacao: "VALORADO",
      direcao: "GANHO",
      valor: 310,
      periodicidade: "MENSAL",
      motivo: null,
    },
    prioridade: { nivel: "MEDIO", score: 35, motivos: [] },
    origem: {
      modulo: "FINAME",
      rotulo: "FINAME",
      rota: "/custo-fixo-finame",
      changeSetId: "cs-1",
    },
    ...over,
  };
}

describe("o estado no endereço", () => {
  it("sobrevive à ida e à volta", () => {
    const filtros = {
      base: "a1",
      comparada: "b2",
      modulos: ["IPVA", "IMPOSTOS"] as const,
      equipamento: "CARRETA",
      situacoes: ["VALORADO"] as const,
      periodicidades: ["MENSAL"],
      busca: "ABC1D23",
    };
    expect(lerFiltros(escreverFiltros({ ...filtros, modulos: [...filtros.modulos], situacoes: [...filtros.situacoes] }))).toEqual({
      ...filtros,
      modulos: [...filtros.modulos],
      situacoes: [...filtros.situacoes],
    });
  });

  it("não escreve no endereço o que é padrão", () => {
    expect(escreverFiltros(FILTROS_VAZIOS)).toBe("");
    expect(enderecoDoMonitor(FILTROS_VAZIOS)).toBe("/monitor-custo-fixo");
  });

  it("cai no padrão quando o endereço traz valor inválido, e não em tela vazia", () => {
    const filtros = lerFiltros(
      "modulo=CAFE,IPVA&situacao=TALVEZ&equipamento=BICICLETA&base=a1",
    );
    // O que existe fica; o que não existe é descartado, não recorta.
    expect(filtros.modulos).toEqual(["IPVA"]);
    expect(filtros.situacoes).toEqual([]);
    expect(filtros.equipamento).toBeNull();
    expect(filtros.base).toBe("a1");
  });

  it("lê um endereço completamente vazio sem quebrar", () => {
    expect(lerFiltros("")).toEqual(FILTROS_VAZIOS);
  });
});

describe("o caminho até a auditoria de origem", () => {
  it("leva o par de vigências e o contexto que a tela de origem sabe honrar", () => {
    const destino = enderecoDaAuditoria(linha(), {
      scopeHash: "hash-camacari",
      canal: "AMBEV",
    });
    expect(destino).toContain("/custo-fixo-finame?");
    const q = new URLSearchParams(destino.split("?")[1]);
    expect(q.get("base")).toBe("a1");
    expect(q.get("comparada")).toBe("b2");
    expect(q.get("scopeHash")).toBe("hash-camacari");
    expect(q.get("canal")).toBe("AMBEV");
  });

  it("não leva os filtros do Monitor, que a auditoria não aplica", () => {
    const destino = enderecoDaAuditoria(linha(), { scopeHash: null, canal: null });
    const q = new URLSearchParams(destino.split("?")[1]);
    // Prometer um recorte que a tela de destino não honra é pior do que não
    // prometer nada — ver `lib/recorte.ts`.
    expect(q.get("situacao")).toBeNull();
    expect(q.get("periodicidade")).toBeNull();
    expect(q.get("modulo")).toBeNull();
  });

  it("aponta cada módulo para a auditoria dele", () => {
    const ipva = enderecoDaAuditoria(
      linha({ modulo: "IPVA", origem: { ...linha().origem, modulo: "IPVA" } }),
      { scopeHash: null, canal: null },
    );
    expect(ipva.startsWith("/custo-fixo-ipva?")).toBe(true);
  });
});

describe("a escrita dos números", () => {
  it("nunca solta o valor da periodicidade", () => {
    expect(escreverImpacto(310, "MENSAL")).toBe("R$ 310,00/mês");
    // O sinal é o menos tipográfico (U+2212) que `formatBrl` usa em todo o
    // produto, e não o hífen do teclado: escrever o hífen aqui deixaria este
    // teste passar sobre uma formatação que a tela não produz.
    expect(escreverImpacto(-6179.29, "ANUAL")).toBe("\u2212R$ 6.179,29/ano");
    expect(escreverImpacto(3000, "PONTUAL")).toBe("R$ 3.000,00 no evento");
  });

  it("escreve travessão, e nunca R$ 0,00, quando não há valor", () => {
    expect(escreverImpacto(null, null)).toBe("—");
    expect(escreverImpacto(null, "MENSAL")).toBe("—");
  });
});

describe("a ordenação da tabela", () => {
  const linhas = [
    linha({ id: "a", impacto: { ...linha().impacto, valor: 310 } }),
    linha({ id: "b", impacto: { ...linha().impacto, valor: -6179.29, direcao: "PERDA" } }),
    linha({
      id: "c",
      impacto: {
        situacao: "SEM_VALORACAO",
        direcao: null,
        valor: null,
        periodicidade: null,
          motivo: "Sem semântica confirmada.",
      },
    }),
  ];

  it("ordena impacto por valor absoluto — uma queda grande importa como uma alta grande", () => {
    const ordenadas = ordenar(linhas, { coluna: "impacto", ascendente: false });
    expect(ordenadas.map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("manda para o fim o que não tem valor, em vez de tratá-lo como zero", () => {
    const ordenadas = ordenar(linhas, { coluna: "impacto", ascendente: false });
    expect(ordenadas.at(-1)!.id).toBe("c");
  });

  it("é estável: mesma entrada, mesma ordem", () => {
    const uma = ordenar(linhas, { coluna: "prioridade", ascendente: false });
    const outra = ordenar(linhas, { coluna: "prioridade", ascendente: false });
    expect(uma.map((l) => l.id)).toEqual(outra.map((l) => l.id));
  });

  it("não altera a lista que recebeu", () => {
    const antes = linhas.map((l) => l.id);
    ordenar(linhas, { coluna: "identificacao", ascendente: true });
    expect(linhas.map((l) => l.id)).toEqual(antes);
  });
});

describe("a paginação", () => {
  it("fatia a lista sem perder nem repetir linha", () => {
    const itens = Array.from({ length: 7 }, (_, i) => i);
    expect(paginar(itens, 1, 3)).toEqual([0, 1, 2]);
    expect(paginar(itens, 3, 3)).toEqual([6]);
    expect(paginar(itens, 4, 3)).toEqual([]);
  });
});

describe("os blocos de periodicidade", () => {
  const resumo = (baldes: ResumoDoMonitor["baldes"]): ResumoDoMonitor => ({
    alteracoes: 0,
    porSituacao: { VALORADO: 0, SEM_VALORACAO: 0, NAO_MONETARIA: 0, FORA_DO_TOTAL: 0 },
    ganhos: 0,
    perdas: 0,
    entidadesAfetadas: 0,
    baldes,
    porModulo: [],
  });

  it("esconde o balde em que nada se moveu, sem esconder as alterações", () => {
    const vazio = { periodicidade: "ANUAL", liquido: 0, ganho: 0, perda: 0 };
    const cheio = { periodicidade: "MENSAL", liquido: 190, ganho: 310, perda: -120 };
    expect(baldesVisiveis(resumo([vazio, cheio])).map((b) => b.periodicidade)).toEqual([
      "MENSAL",
    ]);
  });

  /*
    Ganhou R$ 40 mil e perdeu R$ 40 mil: o líquido é zero e o balde **aparece**.
    Filtrar pelo líquido esconderia justamente o quadro que mais precisa ser
    lido — o recorte em que muito dinheiro se moveu nos dois sentidos.
  */
  it("mostra o balde cujo líquido é zero porque as duas metades se anularam", () => {
    const anulado = { periodicidade: "MENSAL", liquido: 0, ganho: 40_000, perda: -40_000 };
    expect(baldesVisiveis(resumo([anulado])).map((b) => b.periodicidade)).toEqual([
      "MENSAL",
    ]);
  });
});
