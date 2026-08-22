import { describe, expect, it } from "vitest";

import {
  fatorDeImposto,
  linhasDeDesconto,
  linhasDoCustoFixo,
  montarMapaDaQuinzena,
  somarVariavel,
  type BasesDaQuinzena,
  type ParametrosDoCadastro,
  type ViagemDoMapa,
} from "../mapa-rota";

/**
 * O fechamento real de julho/2026 — CDD Belém · Horizonte.
 *
 * Os parâmetros são os da aba `Cadastro` da `.xlsb` que a transportadora usa
 * hoje (coluna C para a 1ª quinzena, F para a 2ª), e os números esperados são
 * os que o `RESUMO GERAL` dela imprime. Não é um exemplo montado: é o mês que
 * está em discussão, e é por isso que ele vale como prova — se a conta deste
 * módulo divergir da planilha, o teste diz em que linha e em quanto.
 */
const JULHO_2026: Record<1 | 2, ParametrosDoCadastro> = {
  1: {
    aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
    parcelaDentroDoMunicipio: 0.0316,
    frotaFixaAtiva: 56,
    frotaFixaInativa: 8,
    remuneracaoFixaDaFrotaAtiva: 1424.91,
    remuneracaoDaEquipeDeEntrega: 8919.38,
    remuneracaoDoQlpAdministrativo: 4427.53,
    remuneracaoDeOutrasDespesas: 4361.07,
    remuneracaoDaFrotaInativa: 1650.97,
    vansAtivas: 7,
    custoFixoDaVan: 4693.85,
    custoDaEquipeDeEntregaDaVan: 4250.45,
    vansInativas: 6,
    remuneracaoDasVansInativas: 3195.18,
    rotasNoturnas: 1,
    custoDaNoturnaSemImposto: 8697.88,
    custoDeMarketingSemImposto: 0,
  },
  2: {
    aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
    parcelaDentroDoMunicipio: 0.0238,
    frotaFixaAtiva: 56,
    frotaFixaInativa: 8,
    remuneracaoFixaDaFrotaAtiva: 1038.03,
    remuneracaoDaEquipeDeEntrega: 8919.38,
    remuneracaoDoQlpAdministrativo: 4425.56,
    remuneracaoDeOutrasDespesas: 4935.23,
    remuneracaoDaFrotaInativa: 4359.09,
    vansAtivas: 7,
    custoFixoDaVan: 4693.85,
    custoDaEquipeDeEntregaDaVan: 4250.45,
    vansInativas: 6,
    remuneracaoDasVansInativas: 3195.18,
    rotasNoturnas: 1,
    custoDaNoturnaSemImposto: 8697.88,
    custoDeMarketingSemImposto: 0,
  },
};

/** As bases sem imposto que a planilha acumula no último dia de cada quinzena. */
const BASES: Record<1 | 2, BasesDaQuinzena> = {
  1: {
    devolucao: 13328.3,
    disponibilidade: { fonte: "PLANILHA", valor: 11649.87 },
    complementarNegativo: 0,
    /* Da planilha, e não do 03.08.12.09 / 2Art: aqui a prova é contra a `.xlsb`. */
    outrosCustos: { fonte: "PLANILHA", valor: 0 },
    indisponibilidade: { fonte: "PLANILHA", valor: 0 },
  },
  2: {
    devolucao: 15763.61,
    disponibilidade: { fonte: "PLANILHA", valor: 91642.5 },
    complementarNegativo: 14050.54,
    outrosCustos: { fonte: "PLANILHA", valor: 358530.22 },
    indisponibilidade: { fonte: "PLANILHA", valor: 0 },
  },
};

const valorDe = (linhas: { chave: string; valor: number | null }[], chave: string) =>
  linhas.find((l) => l.chave === chave)?.valor ?? null;

describe("o fator de imposto", () => {
  /**
   * O produto registrava 1,366960 como "um fator de conversão digitado que não
   * sai de arquivo nenhum". Sai: é a média dos dois grossups pesada pela fatia
   * de emissão, e é reprodutível das quatro alíquotas do cadastro.
   */
  it("é o 1,366960 que a planilha aplicava sem dizer de onde vinha", () => {
    const p = JULHO_2026[2];
    expect(fatorDeImposto(p.aliquotas, p.parcelaDentroDoMunicipio)).toBeCloseTo(1.36696, 6);
  });

  it("muda com a fatia de emissão, e por isso difere entre as quinzenas", () => {
    const p = JULHO_2026[1];
    expect(fatorDeImposto(p.aliquotas, p.parcelaDentroDoMunicipio)).toBeCloseTo(1.365455, 6);
  });
});

describe("o custo fixo de julho/2026, contra o RESUMO GERAL", () => {
  const esperado: Record<1 | 2, Record<string, number>> = {
    1: {
      custo_fixo_padronizado: 731502.84,
      custo_fixo_inativos: 9017.3,
      custo_vans_inativas: 13088.62,
      custo_fixo_especiais: 5938.28,
      custo_fixo_vans: 42745.64,
    },
    2: {
      /*
        A planilha imprime 739.274,00 aqui, e a diferença de R$ 128,05 é dela:
        a fórmula da 2ª quinzena lê a fatia de fora do município de `Mapa
        Rota!AJ119` — o split calculado do diário — enquanto a da 1ª lê
        `Cadastro!C50`, o digitado. Este módulo usa o cadastro nas duas, que é a
        única das duas leituras que o contrato sustenta.
      */
      custo_fixo_padronizado: 739402.05,
      custo_fixo_inativos: 23834.82,
      custo_vans_inativas: 13103.05,
      custo_fixo_especiais: 5944.83,
      custo_fixo_vans: 42792.77,
    },
  };

  for (const q of [1, 2] as const) {
    describe(`${q}ª quinzena`, () => {
      const linhas = linhasDoCustoFixo(JULHO_2026[q]);
      for (const [chave, valor] of Object.entries(esperado[q])) {
        it(`${chave} fecha em ${valor.toFixed(2)}`, () => {
          expect(valorDe(linhas, chave)).toBe(valor);
        });
      }
    });
  }

  it("mostra a conta de cada linha, e não só o resultado", () => {
    const padronizado = linhasDoCustoFixo(JULHO_2026[1]).find(
      (l) => l.chave === "custo_fixo_padronizado",
    );
    expect(padronizado?.memoria).toContain("56 veículos ativos");
    expect(padronizado?.memoria).toContain("1.365455");
  });
});

describe("os descontos", () => {
  for (const q of [1, 2] as const) {
    it(`${q}ª quinzena: devolução e disponibilidade sobem ao bruto, o complementar não`, () => {
      const linhas = linhasDeDesconto(JULHO_2026[q], BASES[q]);
      const esperado =
        q === 1
          ? { devolucao: -18199.19, disponibilidade: -15907.37, complementar: 0 }
          : { devolucao: -21548.23, disponibilidade: -125271.68, complementar: -14050.54 };
      expect(valorDe(linhas, "desconto_devolucao_percentual")).toBe(esperado.devolucao);
      expect(valorDe(linhas, "desconto_disponibilidade")).toBe(esperado.disponibilidade);
      expect(valorDe(linhas, "desconto_complementar_negativo")).toBe(esperado.complementar);
    });
  }

  /*
    A falta nomeia o **mês**, e não a quinzena: o desconto de disponibilidade é
    acumulado no mês inteiro. Por duas versões esta mensagem apontou o 03.08.18
    enquanto o valor vinha do 03.08.20 — mandava importar um arquivo que não
    resolveria a linha.
  */
  it("uma base ausente deixa a linha vazia e nomeia o arquivo do mês", () => {
    const linhas = linhasDeDesconto(JULHO_2026[1], { ...BASES[1], disponibilidade: null });
    const linha = linhas.find((l) => l.chave === "desconto_disponibilidade");
    expect(linha?.valor).toBeNull();
    expect(linha?.falta).toBe("o 03.08.18 do mês");
  });
});

describe("o lado variável, somado do diário", () => {
  const viagem = (p: Partial<ViagemDoMapa>): ViagemDoMapa => ({
    frota: "Padrao",
    cargaAtual: "Roteriz",
    tipoDeImposto: "CTRC-ICMS",
    valorFaturado: 0,
    /* Carregou caixa de Rota — o padrão, porque a viagem de AS é a exceção. */
    caixasDeRota: 100,
    /* Nenhuma caixa de AS: o corte do canal só exclui quando esta é > 0. */
    caixasDeAs: 0,
    /* Sem marca de indisponibilidade — o padrão, porque ela é a exceção. */
    tipoDeIndisponibilidade: "",
    ...p,
  });

  it("a viagem que rodou AS não entra em nenhuma das quatro parcelas", () => {
    /*
      O 2Art traz Rota e AS numa lista só, e a de AS vem com `CxRota = 0` **e
      `CxAS > 0`**. Em julho/2026 são dezoito viagens no mês — todas as
      dezesseis de frota padrão com essa marca —, e sem este corte o agregado da
      1ª quinzena saía R$ 38.473,58 acima do que a planilha fecha.

      Os dois termos entram aqui de propósito: com `caixasDeRota: 0` sozinho
      este teste passava mesmo com o corte largo, que era o defeito. Ver
      `corte-do-canal.test.ts` para o terceiro caso, que é o que ele custava.
    */
    const comAs = somarVariavel(
      [
        {
          viagens: [
            viagem({ valorFaturado: 283.04 }),
            viagem({ caixasDeRota: 0, caixasDeAs: 500, valorFaturado: 283.04 }),
            viagem({ frota: "Spot", valorFaturado: 848.36 }),
            viagem({ frota: "Spot", caixasDeRota: 0, caixasDeAs: 500, valorFaturado: 848.36 }),
            viagem({ frota: "Fixo", valorFaturado: 123.71 }),
            viagem({ frota: "Fixo", caixasDeRota: 0, caixasDeAs: 500, valorFaturado: 123.71 }),
            viagem({ cargaAtual: "Recarga", valorFaturado: 163.95 }),
            viagem({ cargaAtual: "Recarga", caixasDeRota: 0, caixasDeAs: 500, valorFaturado: 163.95 }),
          ],
        },
      ],
      JULHO_2026[1],
      5176.53,
    );

    expect(comAs.agregado).toBe(848.36);
    expect(comAs.vans).toBe(123.71);
    expect(comAs.recargaENoturna).toBe(163.95);
    /*
      Um mapa contado, não dois: a viagem de AS não fecha mapa da Rota. O valor
      é o do veículo pelo lado do ICMS — `(5.176,53 ÷ 25) ÷ 0,7291` —, porque
      todas as viagens deste dia saíram como CT-e; a média de R$ 283,04 da
      planilha é a mistura com os 3,16 % de NF-ISS da quinzena.
    */
    expect(comAs.frotaFixa).toBe(284);
  });

  it("diário sem as colunas CxRota/CxAS não perde viagem nenhuma", () => {
    /*
      `null` não é zero. Um diário antigo, sem a coluna, deve continuar somando
      tudo — perder todas as viagens de uma vez trocaria um erro de mais por um
      erro de tudo. O que a coluna ausente custa é a separação, e ela aparece
      como divergência contra o demonstrativo.
    */
    const semColuna = somarVariavel(
      [{ viagens: [viagem({ frota: "Spot", caixasDeRota: null, caixasDeAs: null, valorFaturado: 848.36 })] }],
      JULHO_2026[1],
      5176.53,
    );
    expect(semColuna.agregado).toBe(848.36);
  });

  it("separa frota fixa, agregado, recarga/noturna e vans pelos rótulos do 2Art", () => {
    const resultado = somarVariavel(
      [
        {
          viagens: [
            viagem({ valorFaturado: 285.16 }),
            viagem({ frota: "Spot", valorFaturado: 848.36 }),
            viagem({ cargaAtual: "Recarga", valorFaturado: 163.95 }),
            viagem({ frota: "Fixo", valorFaturado: 123.71 }),
          ],
        },
      ],
      JULHO_2026[1],
      5176.53,
    );
    expect(resultado.agregado).toBe(848.36);
    expect(resultado.recargaENoturna).toBe(163.95);
    expect(resultado.vans).toBe(123.71);
    /* Um mapa fechado, todo fora do município: 5176,53 ÷ 25 ÷ 0,7291. */
    expect(resultado.frotaFixa).toBe(284.0);
  });

  it("não conta recarga nem noturna como mapa de frota fixa", () => {
    const so = somarVariavel(
      [{ viagens: [viagem({ cargaAtual: "Noturna", valorFaturado: 291.84 })] }],
      JULHO_2026[1],
      5176.53,
    );
    expect(so.frotaFixa).toBe(0);
    expect(so.recargaENoturna).toBe(291.84);
  });

  /**
   * A planilha calcula esta linha dia a dia, com o split de emissão de cada
   * dia. Vale registrar que, **enquanto toda viagem de frota fixa tiver tipo de
   * imposto**, a conta é linear e o agrupamento por dia não muda o resultado:
   * o que pesa é quantos documentos saíram de cada lado na quinzena inteira.
   * O dia só passa a importar quando um mapa fecha sem tipo de imposto — aí
   * ele conta como mapa e não conta no split, e a diferença aparece.
   */
  it("com todo mapa tipado, o dia não muda a conta — é a quinzena que pesa", () => {
    const dia = (iss: number, icms: number) => ({
      viagens: [
        ...Array.from({ length: iss }, () => viagem({ tipoDeImposto: "NF-ISS" })),
        ...Array.from({ length: icms }, () => viagem({ tipoDeImposto: "CTRC-ICMS" })),
      ],
    });
    const separados = somarVariavel([dia(10, 0), dia(0, 10)], JULHO_2026[1], 5176.53);
    const juntos = somarVariavel([dia(10, 10)], JULHO_2026[1], 5176.53);
    expect(separados.frotaFixa).toBe(juntos.frotaFixa);
  });

  it("um mapa sem tipo de imposto conta como mapa e não entra no split", () => {
    const comTipo = somarVariavel(
      [{ viagens: [viagem({ tipoDeImposto: "CTRC-ICMS" })] }],
      JULHO_2026[1],
      5176.53,
    );
    const maisUmSemTipo = somarVariavel(
      [{ viagens: [viagem({ tipoDeImposto: "CTRC-ICMS" }), viagem({ tipoDeImposto: "" })] }],
      JULHO_2026[1],
      5176.53,
    );
    /* Dois mapas, um só documento: o valor dobra sobre o split do que existe.
       567,99 e não 568,00 porque o dobro é tirado antes do arredondamento. */
    expect(comTipo.frotaFixa).toBe(284.0);
    expect(maisUmSemTipo.frotaFixa).toBe(567.99);
  });

  /**
   * O corte entre diário ausente e diário sem movimento, nas duas direções.
   *
   * Este par é a origem do `null` que `montarMapaDaQuinzena` já sabia tratar e
   * que, até esta guarda, ninguém produzia: em produção `somarVariavel` recebia
   * a lista vazia de uma competência sem 2Art, somava sobre ela e devolvia
   * quatro zeros. A tela então escrevia `R$ 0,00` no `TOTAL REMUNERAÇÃO ROTA
   * DVS` — afirmando que a frota não rodou nada — onde a verdade era que o
   * arquivo não tinha chegado.
   *
   * O corte é `porDia.length`, o mesmo de `basesDaQuinzena`: sem dia nenhum não
   * há diário; com um dia e nenhuma viagem de Rota há diário, e o zero é medido.
   */
  it("sem diário, as quatro parcelas são ausência e não zero", () => {
    const semDiario = somarVariavel([], JULHO_2026[1], 5176.53);
    expect(semDiario).toEqual({
      frotaFixa: null,
      agregado: null,
      recargaENoturna: null,
      vans: null,
    });
  });

  it("com diário e um dia sem viagem de Rota, as quatro são zero medido", () => {
    const semMovimento = somarVariavel([{ viagens: [] }], JULHO_2026[1], 5176.53);
    expect(semMovimento).toEqual({
      frotaFixa: 0,
      agregado: 0,
      recargaENoturna: 0,
      vans: 0,
    });
  });

  /**
   * A guarda não pode custar nada onde o diário existe: a reconciliação contra
   * a `.xlsb` de julho/2026 depende de `somarVariavel` produzir os mesmos
   * centavos de sempre, e `reconciliacao.test.ts` prende isso linha a linha.
   * Aqui basta a fronteira: um único dia com uma única viagem continua somando.
   */
  it("com uma viagem só, a guarda não intercepta", () => {
    const uma = somarVariavel(
      [{ viagens: [viagem({ tipoDeImposto: "CTRC-ICMS" })] }],
      JULHO_2026[1],
      5176.53,
    );
    expect(uma.frotaFixa).toBe(284.0);
  });
});

describe("o mapa da quinzena inteiro", () => {
  const mapa = (q: 1 | 2, bases = BASES[q]) =>
    montarMapaDaQuinzena({
      quinzena: q,
      parametros: JULHO_2026[q],
      variavel: {
        frotaFixa: q === 1 ? 167734.27 : 187808.5,
        agregado: q === 1 ? 126092.33 : 126288.09,
        recargaENoturna: q === 1 ? 11574.83 : 3957.82,
        vans: q === 1 ? 7917.44 : 9449.19,
      },
      bases,
    });

  it("abre o quadro com o custo variável inteiro, que é o que DVS traz", () => {
    const dvs = mapa(1).quadros[0]!.linhas.find((l) => l.chave === "rota_dvs");
    expect(dvs?.valor).toBe(313318.87);
  });

  /**
   * O DVS com o diário vazio — a diferença entre zero e ausência, na linha que
   * abre o quadro.
   *
   * Um mês sem 2Art importado tem as quatro parcelas variáveis em `null`, e a
   * soma delas **não** é zero: `somaDoVariavel` apaga o total quando qualquer
   * parcela falta. Zero ali diria "a frota não rodou nada nesta quinzena", que
   * é uma afirmação sobre a operação; `null` diz o que é verdade — falta o
   * arquivo — e a linha nomeia qual.
   */
  it("sem diário, o DVS fica vazio e nomeia o arquivo que falta", () => {
    const semDiario = montarMapaDaQuinzena({
      quinzena: 1,
      parametros: JULHO_2026[1],
      variavel: { frotaFixa: null, agregado: null, recargaENoturna: null, vans: null },
      bases: BASES[1],
    });
    const dvs = semDiario.quadros[0]!.linhas.find((l) => l.chave === "rota_dvs");

    expect(dvs?.valor).toBeNull();
    expect(dvs?.falta).toBe("o diário operacional da quinzena");
    /* E o quadro inteiro cai junto: um total sem uma parcela não é o total. */
    expect(semDiario.quadros[0]!.total).toBeNull();
  });

  it("com diário e sem movimento, o DVS é zero medido — e o quadro fecha", () => {
    const semMovimento = montarMapaDaQuinzena({
      quinzena: 1,
      parametros: JULHO_2026[1],
      variavel: { frotaFixa: 0, agregado: 0, recargaENoturna: 0, vans: 0 },
      bases: BASES[1],
    });
    const dvs = semMovimento.quadros[0]!.linhas.find((l) => l.chave === "rota_dvs");

    expect(dvs?.valor).toBe(0);
    expect(dvs?.falta).toBeNull();
    expect(semMovimento.quadros[0]!.total).not.toBeNull();
  });

  /**
   * A `INDISPONIBILIDADE` do quadro fixo, agora com fonte.
   *
   * Ver `somarIndisponibilidade` e `docs/MAPA-ROTA.md`: `Mapa Rota!132` soma a
   * coluna `BP` das abas diárias, que é o faturado das viagens com tipo de
   * indisponibilidade. Aqui se prova que o motor consome essa medida e escreve
   * a procedência dela na memória de cálculo.
   */
  it("a indisponibilidade do diário entra como parcela, com a memória da origem", () => {
    const comMarca = montarMapaDaQuinzena({
      quinzena: 1,
      parametros: JULHO_2026[1],
      variavel: { frotaFixa: 0, agregado: 0, recargaENoturna: 0, vans: 0 },
      bases: {
        ...BASES[1],
        indisponibilidade: {
          fonte: "DIARIO",
          medida: { valor: 4200, viagens: 140, comMarca: 5, tipos: ["Manutenção"] },
        },
      },
    });
    const linha = comMarca.quadros[0]!.linhas.find((l) => l.chave === "indisponibilidade_fixo");

    /* Parcela positiva — é frete que a transportadora recebe, não abatimento. */
    expect(linha?.papel).toBe("PARCELA");
    expect(linha?.valor).toBe(4200);
    expect(linha?.memoria).toContain("5 de 140 viagens");
    expect(linha?.memoria).toContain("Manutenção");
  });

  it("sem diário, a indisponibilidade fica vazia e pede o diário — não o 03.08.20", () => {
    const semDiario = montarMapaDaQuinzena({
      quinzena: 1,
      parametros: JULHO_2026[1],
      variavel: { frotaFixa: 0, agregado: 0, recargaENoturna: 0, vans: 0 },
      bases: { ...BASES[1], indisponibilidade: null },
    });
    const linha = semDiario.quadros[0]!.linhas.find((l) => l.chave === "indisponibilidade_fixo");

    expect(linha?.valor).toBeNull();
    expect(linha?.falta).toBe("o diário operacional da quinzena");
  });

  /**
   * O outro lado da confusão: o desconto continua saindo do 03.08.20.
   *
   * `INDISPONIBILIDADE` (parcela, do 2Art) e `DESCONTO DE DISPONIBILIDADE`
   * (desconto, do 03.08.20) são dinheiro em direções opostas. Este teste prende
   * as duas propriedades que os separam no motor: o sinal e a base.
   */
  it("a parcela do diário e o desconto do demonstrativo não se misturam", () => {
    const os_dois = montarMapaDaQuinzena({
      quinzena: 1,
      parametros: JULHO_2026[1],
      variavel: { frotaFixa: 0, agregado: 0, recargaENoturna: 0, vans: 0 },
      bases: {
        ...BASES[1],
        disponibilidade: { fonte: "PLANILHA", valor: 11649.87 },
        indisponibilidade: {
          fonte: "DIARIO",
          medida: { valor: 4200, viagens: 140, comMarca: 5, tipos: ["Manutenção"] },
        },
      },
    });
    const linhas = os_dois.quadros[0]!.linhas;
    const parcela = linhas.find((l) => l.chave === "indisponibilidade_fixo")!;
    const desconto = linhas.find((l) => l.chave === "desconto_disponibilidade")!;

    expect(parcela.valor).toBe(4200);
    expect(parcela.papel).toBe("PARCELA");
    /* O desconto é negativo e brutado — outro número, outra origem. */
    expect(desconto.papel).toBe("DESCONTO");
    expect(desconto.valor).toBeLessThan(0);
    expect(Math.abs(desconto.valor!)).not.toBe(parcela.valor);
  });

  /**
   * O centavo de diferença é de arredondamento, e é do teste, não do módulo:
   * as parcelas variáveis entram aqui já arredondadas (é o que a planilha
   * **imprime**), enquanto ela soma internamente em ponto flutuante e só
   * arredonda no fim. O módulo arredonda cada linha a centavo — que é o certo
   * para dinheiro que alguém vai pagar — e por isso fecha um centavo acima.
   */
  it("fecha a 1ª quinzena no total da planilha, a menos do centavo de arredondamento", () => {
    expect(mapa(1).quadros[0]!.total).toBe(1081504.99);
    expect(mapa(1).quadros[0]!.total! - 1081504.98).toBeCloseTo(0.01, 2);
  });

  it("fecha o quadro variável nos dois recortes", () => {
    expect(mapa(1).quadros[1]!.total).toBe(259720.04);
    expect(mapa(2).quadros[1]!.total).toBe(167276.68);
  });

  /**
   * A planilha imprime 1.350.112,83. A diferença é exatamente o desvio do
   * `AJ133` documentado acima: ela calcula o custo fixo padronizado da 2ª
   * quinzena com a fatia de emissão do diário, e não com a do cadastro.
   */
  it("soma outros custos ao total geral da unidade", () => {
    expect(mapa(2).totalGeral).toBe(1350240.89);
    expect(mapa(2).totalGeral! - 1350112.83).toBeCloseTo(128.06, 2);
  });

  it("um documento que falta apaga o total em vez de somar zero", () => {
    const semDisponibilidade = mapa(2, { ...BASES[2], disponibilidade: null });
    expect(semDisponibilidade.quadros[0]!.total).toBeNull();
    expect(semDisponibilidade.pendencias).toContain("o 03.08.18 do mês");
  });
});
