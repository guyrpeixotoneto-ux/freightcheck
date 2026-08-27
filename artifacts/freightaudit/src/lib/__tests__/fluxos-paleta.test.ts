import { describe, expect, it } from "vitest";
import {
  GRUPOS_DA_PALETA,
  MIME_DO_ELEMENTO,
  ajustarSolto,
  escreverArrasto,
  lerArrasto,
  montarPaleta,
  nomeSugerido,
  normalizarBusca,
  proximaPosicaoLivre,
  totalDaPaleta,
} from "@/lib/fluxos-paleta";
import type { Catalogo, Etapa, TipoDeEtapaNoCatalogo } from "@/lib/fluxos";

/**
 * A PALETA — as provas do que a janela mostra e do que ela cria.
 *
 * O que é testado aqui é o que quebraria em silêncio: um tipo servido pela API
 * que a janela deixasse de fora, uma busca que só achasse quem digita com
 * acento, e uma etapa nascendo em cima de outra.
 */

function tipo(
  valor: string,
  rotulo: string,
  descricao = "",
): TipoDeEtapaNoCatalogo {
  return {
    valor,
    rotulo,
    descricao,
    forma: "retangulo",
    classe: "",
    icone: "Square",
  };
}

const CATALOGO = {
  tiposDeEtapa: [
    tipo("INICIO", "Início", "Onde o processo começa."),
    tipo("PROCESSO", "Processo", "Uma atividade executada por alguém."),
    tipo("DECISAO", "Decisão", "Um ponto em que o caminho se divide."),
    tipo("VALIDACAO", "Validação", "Uma conferência que aprova ou devolve."),
    tipo("DOCUMENTO", "Documento", "A emissão de um documento."),
    tipo("SISTEMA", "Sistema", "Um passo dentro de um sistema."),
    tipo("PENDENCIA", "Pendência", "Uma espera fora do caminho feliz."),
    tipo("FIM", "Fim", "Onde o processo termina."),
  ],
} as Pick<Catalogo, "tiposDeEtapa">;

function etapa(id: string, nome: string, posX: number, posY: number): Etapa {
  return { id, nome, posX, posY } as Etapa;
}

describe("montarPaleta", () => {
  it("mostra todo tipo servido pelo catálogo, sem perder nenhum pelo caminho", () => {
    const grupos = montarPaleta(CATALOGO);
    const mostrados = grupos.flatMap((g) => g.itens.map((i) => i.valor)).sort();
    expect(mostrados).toEqual(CATALOGO.tiposDeEtapa.map((t) => t.valor).sort());
    expect(totalDaPaleta(grupos)).toBe(8);
  });

  it("põe num grupo de sobra o tipo novo que o servidor passar a servir", () => {
    const grupos = montarPaleta({
      tiposDeEtapa: [...CATALOGO.tiposDeEtapa, tipo("AUDITORIA", "Auditoria")],
    });
    const sobra = grupos.find((g) => g.valor === "outros");
    expect(sobra?.itens.map((i) => i.valor)).toEqual(["AUDITORIA"]);
  });

  it("acha o elemento sem acento e pela descrição, e some com o grupo vazio", () => {
    const semAcento = montarPaleta(CATALOGO, "decisao");
    expect(semAcento.flatMap((g) => g.itens.map((i) => i.valor))).toEqual([
      "DECISAO",
    ]);
    expect(semAcento).toHaveLength(1);

    const pelaDescricao = montarPaleta(CATALOGO, "aprova");
    expect(pelaDescricao.flatMap((g) => g.itens.map((i) => i.valor))).toEqual([
      "VALIDACAO",
    ]);
  });

  it("devolve nada quando a busca não encontra, sem inventar grupo", () => {
    expect(montarPaleta(CATALOGO, "xyz")).toEqual([]);
    expect(totalDaPaleta(montarPaleta(CATALOGO, "xyz"))).toBe(0);
  });

  it("aguenta o catálogo que ainda não chegou", () => {
    expect(montarPaleta(undefined)).toEqual([]);
  });

  it("mantém a ordem dos grupos declarada — começo, execução, controle", () => {
    expect(montarPaleta(CATALOGO).map((g) => g.valor)).toEqual(
      GRUPOS_DA_PALETA.map((g) => g.valor),
    );
  });
});

describe("normalizarBusca", () => {
  it("tira acento, caixa e sobra", () => {
    expect(normalizarBusca("  PendênciA ")).toBe("pendencia");
  });
});

describe("o arrasto", () => {
  it("leva o tipo no MIME próprio e ignora o que veio de fora", () => {
    const dados = new Map<string, string>();
    const transferencia = {
      setData: (t: string, v: string) => void dados.set(t, v),
      getData: (t: string) => dados.get(t) ?? "",
      effectAllowed: "none",
    } as unknown as DataTransfer;

    escreverArrasto(transferencia, "DECISAO");
    expect(dados.get(MIME_DO_ELEMENTO)).toBe("DECISAO");
    expect(lerArrasto(transferencia)).toBe("DECISAO");

    const alheio = { getData: () => "" } as unknown as DataTransfer;
    expect(lerArrasto(alheio)).toBeNull();
  });
});

describe("nomeSugerido", () => {
  it("usa o rótulo do tipo, e numera quando já existe", () => {
    const decisao = tipo("DECISAO", "Decisão");
    expect(nomeSugerido(decisao, [])).toBe("Decisão");
    expect(nomeSugerido(decisao, [etapa("a", "Decisão", 0, 0)])).toBe(
      "Decisão 2",
    );
    expect(
      nomeSugerido(decisao, [
        etapa("a", "Decisão", 0, 0),
        etapa("b", "Decisão 2", 0, 0),
      ]),
    ).toBe("Decisão 3");
  });
});

describe("proximaPosicaoLivre", () => {
  it("começa na origem quando o fluxo está vazio", () => {
    expect(proximaPosicaoLivre([])).toEqual({ posX: 0, posY: 0 });
  });

  it("nasce abaixo da etapa mais baixa, na coluna dela", () => {
    const etapas = [etapa("a", "A", 0, 0), etapa("b", "B", 260, 150)];
    expect(proximaPosicaoLivre(etapas)).toEqual({ posX: 260, posY: 300 });
  });

  it("não empilha: duas criações seguidas caem em alturas diferentes", () => {
    const etapas = [etapa("a", "A", 0, 0)];
    const primeira = proximaPosicaoLivre(etapas);
    const depois = [...etapas, etapa("b", "B", primeira.posX, primeira.posY)];
    expect(proximaPosicaoLivre(depois).posY).toBeGreaterThan(primeira.posY);
  });
});

describe("ajustarSolto", () => {
  it("centra o cartão no ponto solto, em vez de pendurá-lo pelo canto", () => {
    expect(ajustarSolto({ x: 400, y: 300 })).toEqual({ posX: 300, posY: 264 });
  });
});
