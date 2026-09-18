import { describe, expect, it } from "vitest";
import {
  baldesDaApuracao,
  ultimaAlteracaoFinanceira,
  ultimoMovimento,
  type ApuracaoDoPar,
  type VarreduraDoCartao,
} from "../ultima-alteracao-financeira";
import { NATUREZA_SEM_MONTANTE, ehModuloFinanceiro } from "../natureza-do-modulo";
import type { ParDoCartao } from "../alteracoes-por-modulo";

/**
 * A REGRA DA ÚLTIMA ALTERAÇÃO.
 *
 * O que estes casos prendem é a promessa da tela: **cada cartão escolhe o par
 * dele**, e a escolha não inventa número nenhum. As quatro recusas que importam
 * — líquido zero não conta, não precificado não conta, lacuna não vira "sem
 * alteração", e periodicidade não se converte — estão cada uma num caso.
 */

const par = (base: string, comparada: string): ParDoCartao => ({
  baseId: `id:${base}`,
  comparadaId: `id:${comparada}`,
  baseRotulo: base,
  comparadaRotulo: comparada,
  baseData: base,
  comparadaData: comparada,
});

const apuracao = (over: Partial<ApuracaoDoPar> & { par: ParDoCartao }): ApuracaoDoPar => ({
  changeSetId: `cs:${over.par.comparadaData}`,
  porPeriodicidade: {},
  basePorPeriodicidade: {},
  movimento: {
    alteracoes: 0,
    entidades: 0,
    rotuloDaEntidade: "Veículos",
    unidade: null,
    notas: [],
  },
  ...over,
});

const varredura = (over: Partial<VarreduraDoCartao> = {}): VarreduraDoCartao => ({
  pares: 8,
  de: "2025-12-16",
  ate: "2026-08-01",
  lacunas: [],
  ...over,
});

describe("a escolha do par de um módulo financeiro", () => {
  it("para no primeiro par com dinheiro, do mais recente ao mais antigo", () => {
    const escolha = ultimaAlteracaoFinanceira(
      [
        apuracao({ par: par("2026-07-16", "2026-08-01") }),
        apuracao({
          par: par("2026-06-16", "2026-07-16"),
          porPeriodicidade: { ANUAL: -144874.5 },
          basePorPeriodicidade: { ANUAL: 591325 },
        }),
        apuracao({
          par: par("2025-12-16", "2026-01-16"),
          porPeriodicidade: { ANUAL: -590437.65 },
          basePorPeriodicidade: { ANUAL: 1000000 },
        }),
      ],
      varredura(),
    );

    expect(escolha.estado).toBe("COM_MOVIMENTO_FINANCEIRO");
    /* O de junho, e não o de dezembro: é a **última** alteração. */
    expect(escolha.escolhida?.par.comparadaData).toBe("2026-07-16");
  });

  it("não aceita líquido zero como alteração financeira", () => {
    /*
      Linhas mudaram e o balde fechou em zero — um aumento numa placa e uma
      queda igual noutra. O módulo não se moveu em dinheiro, e dizer que se moveu
      publicaria um cartão com impacto R$ 0,00 sob o rótulo "última alteração".
    */
    const escolha = ultimaAlteracaoFinanceira(
      [
        apuracao({
          par: par("2026-07-16", "2026-08-01"),
          porPeriodicidade: { MENSAL: 0 },
          basePorPeriodicidade: { MENSAL: 8000 },
          movimento: {
            alteracoes: 4,
            entidades: 2,
            rotuloDaEntidade: "Veículos",
            unidade: null,
            notas: [],
          },
        }),
        apuracao({
          par: par("2026-06-16", "2026-07-16"),
          porPeriodicidade: { MENSAL: 120.5 },
          basePorPeriodicidade: { MENSAL: 1000 },
        }),
      ],
      varredura(),
    );

    expect(escolha.escolhida?.par.comparadaData).toBe("2026-07-16");
  });

  it("não aceita o que o motor não precificou — balde vazio não é movimento", () => {
    /*
      `NOT_CALCULABLE` nunca chega aqui como número: as funções de impacto já o
      deixam de fora do balde, pelo mesmo portão `viraDinheiro`. O que chega é um
      `porPeriodicidade` vazio, com as linhas contadas no movimento.
    */
    const escolha = ultimaAlteracaoFinanceira(
      [
        apuracao({
          par: par("2026-07-16", "2026-08-01"),
          porPeriodicidade: {},
          movimento: {
            alteracoes: 62,
            entidades: 62,
            rotuloDaEntidade: "Veículos",
            unidade: null,
            notas: [{ quantidade: 62, frase: "em coluna de dinheiro sem preço apurado" }],
          },
        }),
      ],
      varredura({ pares: 1 }),
    );

    expect(escolha.estado).toBe("SEM_MOVIMENTO_FINANCEIRO");
    expect(escolha.escolhida).toBeNull();
  });

  it("sem nenhum par com dinheiro, diz quantos pares varreu e em que intervalo", () => {
    const escolha = ultimaAlteracaoFinanceira([], varredura({ pares: 8 }));
    expect(escolha.estado).toBe("SEM_MOVIMENTO_FINANCEIRO");
  });

  it("uma lacuna de cálculo tem precedência sobre 'sem alteração'", () => {
    /*
      A recusa central do item 6: um intervalo que não foi todo apurado não
      sustenta a afirmação "não houve alteração". A lacuna vira a resposta, com a
      ação de calcular ao lado.
    */
    const escolha = ultimaAlteracaoFinanceira(
      [apuracao({ par: par("2026-06-16", "2026-07-16") })],
      varredura({
        lacunas: [
          {
            baseId: "id:2026-07-16",
            comparadaId: "id:2026-08-01",
            baseData: "2026-07-16",
            comparadaData: "2026-08-01",
          },
        ],
      }),
    );

    expect(escolha.estado).toBe("LACUNA_DE_CALCULO");
  });
});

describe("os baldes de um par", () => {
  it("mantém periodicidades separadas e não converte nenhuma", () => {
    const baldes = baldesDaApuracao(
      apuracao({
        par: par("2026-07-16", "2026-08-01"),
        porPeriodicidade: { MENSAL: 18663.89, ANUAL: -144874.5 },
        basePorPeriodicidade: { MENSAL: 42756.51, ANUAL: 591325 },
      }),
    );

    expect(baldes.map((b) => b.periodicidade)).toEqual(["ANUAL", "MENSAL"]);
    /* Nenhum balde carrega o outro: dois números, e nunca um terceiro. */
    const mensal = baldes.find((b) => b.periodicidade === "MENSAL");
    expect(mensal).toEqual({
      periodicidade: "MENSAL",
      antes: 42756.51,
      depois: 61420.4,
      impacto: 18663.89,
      variacao: 18663.89 / 42756.51,
    });
  });

  it("antes + impacto é exatamente depois — a reconciliação do cartão", () => {
    for (const [antes, impacto] of [
      [42756.51, 18663.89],
      [591325, -144874.5],
      [7700.16, 1655.54],
      [0.01, -0.01],
    ]) {
      const [balde] = baldesDaApuracao(
        apuracao({
          par: par("a", "b"),
          porPeriodicidade: { MENSAL: impacto },
          basePorPeriodicidade: { MENSAL: antes },
        }),
      );
      expect(balde.depois).toBeCloseTo(balde.antes + balde.impacto, 2);
    }
  });

  it("sem base anterior, a variação é nula — nunca infinita", () => {
    const [balde] = baldesDaApuracao(
      apuracao({
        par: par("a", "b"),
        porPeriodicidade: { MENSAL: 3200 },
        basePorPeriodicidade: { MENSAL: 0 },
      }),
    );

    expect(balde.variacao).toBeNull();
    expect(Number.isFinite(balde.antes)).toBe(true);
  });

  it("um balde que fechou em zero não vira linha do cartão", () => {
    const baldes = baldesDaApuracao(
      apuracao({
        par: par("a", "b"),
        porPeriodicidade: { MENSAL: 0, ANUAL: -100 },
        basePorPeriodicidade: { MENSAL: 5000, ANUAL: 400 },
      }),
    );
    expect(baldes.map((b) => b.periodicidade)).toEqual(["ANUAL"]);
  });
});

describe("os módulos sem montante apurável", () => {
  it("procura movimento, e não dinheiro", () => {
    const escolhida = ultimoMovimento([
      apuracao({ par: par("2026-07-16", "2026-08-01") }),
      apuracao({
        par: par("2026-06-16", "2026-07-16"),
        movimento: {
          alteracoes: 670,
          entidades: 133,
          rotuloDaEntidade: "Veículos",
          unidade: "R$/km",
          notas: [],
        },
      }),
    ]);

    expect(escolhida?.par.comparadaData).toBe("2026-07-16");
    expect(escolhida?.movimento.unidade).toBe("R$/km");
  });

  it("a lista de exceções é o que define um módulo como financeiro", () => {
    expect(ehModuloFinanceiro("FINAME")).toBe(true);
    expect(ehModuloFinanceiro("IPVA")).toBe(true);
    expect(ehModuloFinanceiro("ALUGUEL")).toBe(true);
    expect(ehModuloFinanceiro("MANUTENCAO")).toBe(false);
    expect(ehModuloFinanceiro("AQUISICAO")).toBe(false);
    expect(ehModuloFinanceiro("TMA")).toBe(false);
  });

  it("cada módulo sem montante diz por quê, e em que grandeza mede", () => {
    for (const [modulo, natureza] of Object.entries(NATUREZA_SEM_MONTANTE)) {
      expect(natureza.motivo.length, modulo).toBeGreaterThan(40);
      expect(natureza.unidade.length, modulo).toBeGreaterThan(0);
      /* A frase explica a decisão; ela não pode soar como falta de dado. */
      expect(natureza.motivo, modulo).not.toMatch(/sem alteração/i);
    }
  });
});
