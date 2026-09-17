import { describe, expect, it } from "vitest";
import {
  avaliarCompra,
  confiabilidadeDe,
  politicaDe,
  POLITICA_PADRAO,
  valorEconomicoDaUnidade,
  type BaseRemunerada,
} from "../motor";

/**
 * O motor econômico, medido contra números escritos à mão.
 *
 * Este arquivo é a prova de que o preço-alvo **não** depende de modelo nenhum:
 * ele é uma função pura, e as mesmas entradas devolvem as mesmas saídas. Se um
 * dia alguém quiser trocar a conta, é aqui que a troca aparece — e não numa
 * resposta de chat que ninguém consegue reproduzir.
 *
 * O cenário do pneu percorre a tela inteira: uma frota que recebe R$ 917,00 por
 * mês por veículo em pneu, seis pneus por cavalo, dezoito meses de vida útil,
 * uma proposta de R$ 3.080 para oitenta unidades. É o exemplo que o produto
 * usa, e é o que garante que os números da documentação e os do código sejam os
 * mesmos.
 */

const PNEU: BaseRemunerada = {
  valor: 917,
  gaveta: "MENSAL",
  escopo: "média por veículo (64 de 64 na frota)",
  fonte: 'Coluna "valorPneu" do export',
  vigencia: "Setembro/2026",
  ressalva: null,
};

describe("valor econômico da unidade", () => {
  it("converte o mensal pela vida útil e pelas unidades por ativo", () => {
    const { valor } = valorEconomicoDaUnidade(PNEU, {
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    /* 917 × 18 ÷ 6 = 2.751 */
    expect(valor).toBeCloseTo(2751, 6);
  });

  it("divide o anual por doze antes de multiplicar pela vida útil", () => {
    const anual = { ...PNEU, valor: 917 * 12, gaveta: "ANUAL" as const };
    const { valor } = valorEconomicoDaUnidade(anual, {
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    expect(valor).toBeCloseTo(2751, 6);
  });

  it("não usa vida útil no valor de aquisição — ele já é do bem", () => {
    const aquisicao = { ...PNEU, valor: 12_000, gaveta: "AQUISICAO" as const };
    const { valor } = valorEconomicoDaUnidade(aquisicao, {
      vidaUtilMeses: null,
      unidadesPorAtivo: 4,
    });
    expect(valor).toBe(3000);
  });

  it("devolve o próprio valor quando a fonte já o entrega por unidade", () => {
    const uniforme: BaseRemunerada = {
      valor: 420,
      gaveta: null,
      porUnidade: true,
      escopo: "valor unitário declarado pela fonte",
      fonte: "Coluna de valor unitário do quadro administrativo",
      vigencia: "Setembro/2026",
      ressalva: null,
    };
    expect(
      valorEconomicoDaUnidade(uniforme, {
        vidaUtilMeses: null,
        unidadesPorAtivo: null,
      }),
    ).toEqual({ valor: 420, semAlvo: null });
  });

  it("recusa, com motivo, o mensal sem vida útil — não o multiplica por doze", () => {
    expect(
      valorEconomicoDaUnidade(PNEU, {
        vidaUtilMeses: null,
        unidadesPorAtivo: 6,
      }),
    ).toEqual({
      valor: null,
      semAlvo: "SEM_VIDA_UTIL",
    });
  });

  it("recusa, com motivo, a base sem remuneração e a sem periodicidade", () => {
    expect(
      valorEconomicoDaUnidade(
        { ...PNEU, valor: null },
        { vidaUtilMeses: 18, unidadesPorAtivo: 6 },
      ).semAlvo,
    ).toBe("SEM_REMUNERACAO");
    expect(
      valorEconomicoDaUnidade(
        { ...PNEU, gaveta: null },
        { vidaUtilMeses: 18, unidadesPorAtivo: 6 },
      ).semAlvo,
    ).toBe("SEM_GAVETA");
  });
});

describe("a avaliação de uma compra de pneu", () => {
  const avaliacao = avaliarCompra(
    "pneu",
    PNEU,
    {
      precoUnitario: 3080,
      quantidade: 80,
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
      fornecedor: "Borracharia São Paulo",
    },
    { margemAlvo: 0.12, margemMinima: 0.05 },
  );

  it("calcula alvo e teto a partir do valor econômico e da política", () => {
    expect(avaliacao.valorEconomicoUnitario).toBeCloseTo(2751, 6);
    /* 2.751 × 0,88 = 2.420,88 · 2.751 × 0,95 = 2.613,45 */
    expect(avaliacao.precoAlvo).toBeCloseTo(2420.88, 2);
    expect(avaliacao.precoTeto).toBeCloseTo(2613.45, 2);
  });

  it("mede a diferença contra os dois, e o impacto contra o teto", () => {
    expect(avaliacao.diferencaParaAlvo).toBeCloseTo(3080 - 2420.88, 2);
    expect(avaliacao.diferencaParaTeto).toBeCloseTo(3080 - 2613.45, 2);
    expect(avaliacao.impactoPelaQuantidade).toBeCloseTo(
      (3080 - 2613.45) * 80,
      2,
    );
  });

  it("dilui o impacto na vida útil, e o ano é doze meses dele", () => {
    const mensal = avaliacao.impactoPelaQuantidade! / 18;
    expect(avaliacao.impactoMensal).toBeCloseTo(mensal, 6);
    expect(avaliacao.impactoAnual).toBeCloseTo(mensal * 12, 6);
  });

  it("dá o veredito sobre a proposta", () => {
    expect(avaliacao.veredito).toBe("ACIMA_DO_TETO");
    expect(
      avaliarCompra("pneu", PNEU, {
        ...avaliacao.premissas,
        precoUnitario: 2400,
      }).veredito,
    ).toBe("NO_ALVO");
    expect(
      avaliarCompra("pneu", PNEU, {
        ...avaliacao.premissas,
        precoUnitario: 2500,
      }).veredito,
    ).toBe("ENTRE_ALVO_E_TETO");
  });

  it("registra margem por unidade, absoluta e percentual", () => {
    expect(avaliacao.margemAbsoluta).toBeCloseTo(2751 - 3080, 6);
    expect(avaliacao.margemPercentual).toBeCloseTo((2751 - 3080) / 2751, 6);
  });

  it("carrega a procedência de cada número, com confirmado separado de estimado", () => {
    const porChave = new Map(avaliacao.dados.map((d) => [d.chave, d]));
    expect(porChave.get("vidaUtilMeses")?.confirmado).toBe(true);
    expect(porChave.get("valorRemunerado")?.fonte).toContain("Setembro/2026");
    /* Histórico de compras não existe neste acervo — e a fonte diz isso. */
    expect(porChave.get("precoHistorico")?.confirmado).toBe(false);
  });
});

describe("o que falta é resposta, e não zero", () => {
  it("sem cotação não há veredito nem diferença", () => {
    const a = avaliarCompra("pneu", PNEU, {
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    expect(a.precoAlvo).not.toBeNull();
    expect(a.veredito).toBeNull();
    expect(a.diferencaParaTeto).toBeNull();
    expect(a.lacunas.join(" ")).toContain("Sem preço cotado");
  });

  it("sem quantidade não há impacto pela quantidade", () => {
    const a = avaliarCompra("pneu", PNEU, {
      precoUnitario: 3080,
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    expect(a.impactoPelaQuantidade).toBeNull();
    expect(a.impactoAnual).toBeNull();
  });

  it("sem remuneração apurada não há preço-alvo, e a lacuna diz por quê", () => {
    const a = avaliarCompra(
      "pneu",
      { ...PNEU, valor: null },
      { precoUnitario: 3080 },
    );
    expect(a.precoAlvo).toBeNull();
    expect(a.semAlvo).toBe("SEM_REMUNERACAO");
    expect(a.confiabilidade).toBe("BAIXA");
  });
});

describe("premissas do catálogo entram marcadas como estimativa", () => {
  it("usa o padrão do produto e derruba a confiabilidade", () => {
    const a = avaliarCompra("pneu", PNEU, {
      precoUnitario: 3080,
      quantidade: 80,
    });
    expect(a.premissas.vidaUtilMeses).toBe(18);
    expect(a.premissas.unidadesPorAtivo).toBe(6);
    expect(a.confiabilidade).toBe("BAIXA");
    const estimados = a.dados.filter((d) => !d.confirmado).map((d) => d.chave);
    expect(estimados).toContain("vidaUtilMeses");
    expect(estimados).toContain("unidadesPorAtivo");
  });

  it("confirmar as duas premissas leva a confiabilidade a alta", () => {
    const a = avaliarCompra("pneu", PNEU, {
      precoUnitario: 3080,
      quantidade: 80,
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    expect(a.confiabilidade).toBe("ALTA");
  });

  it("a ressalva do catálogo derruba um degrau sozinha", () => {
    const comRessalva = {
      ...PNEU,
      ressalva: "A fonte não preenche o valor de pneu.",
    };
    const a = avaliarCompra("pneu", comRessalva, {
      precoUnitario: 3080,
      vidaUtilMeses: 18,
      unidadesPorAtivo: 6,
    });
    expect(a.confiabilidade).toBe("MEDIA");
    expect(a.lacunas).toContain("A fonte não preenche o valor de pneu.");
  });

  it("sem preço-alvo a nota é sempre baixa — não há o que graduar", () => {
    expect(
      confiabilidadeDe(PNEU, {
        vidaConfirmada: true,
        unidadesConfirmadas: true,
        temAlvo: false,
      }),
    ).toBe("BAIXA");
  });
});

describe("a política é configuração, e ela se defende", () => {
  it("o padrão é o da instalação quando nada é pedido", () => {
    expect(politicaDe()).toEqual(POLITICA_PADRAO);
  });

  it("ignora fração fora de (0,1) — um teto negativo reprovaria toda compra", () => {
    expect(politicaDe({ margemAlvo: 1.2 }).margemAlvo).toBe(
      POLITICA_PADRAO.margemAlvo,
    );
    expect(politicaDe({ margemMinima: 0 }).margemMinima).toBe(
      POLITICA_PADRAO.margemMinima,
    );
  });

  it("endireita alvo e teto trocados, em vez de produzir alvo acima do teto", () => {
    const p = politicaDe({ margemAlvo: 0.05, margemMinima: 0.2 });
    expect(p.margemAlvo).toBe(0.2);
    expect(p.margemMinima).toBe(0.05);
    /* O que isto impede: a mesma compra aprovada e reprovada na mesma frase. */
    expect(p.margemAlvo).toBeGreaterThan(p.margemMinima);
  });
});
