import { describe, expect, it } from "vitest";
import {
  agruparPorVeiculoDeAquisicao,
  conferenciaDaEntrada,
  impactoDeAquisicao,
  linhasDeAquisicao,
  resumirCoerenciaDoCadastro,
  totaisDeAquisicaoPorVigencia,
  VARIAVEIS_DE_AQUISICAO,
  VARIAVEIS_DE_DETALHE_DE_AQUISICAO,
  variavelDeAquisicaoDoCodigo,
  type ValorDeAquisicao,
} from "../aquisicao";
import type { AlteracaoDoMotor } from "../recorte-de-rubrica";

/**
 * A AUDITORIA DE AQUISIÇÃO, sem banco e sem tela.
 *
 * O que estes testes prendem são as quatro decisões que o acervo obrigou
 * (`docs/ACHADO-AQUISICAO.md`) e que uma refatoração desatenta desfaria sem
 * fazer nada parecer quebrado:
 *
 * 1. a nota **nunca** entra num total — a base de compra não tem módulo dono;
 * 2. o ano e o mês são a data escrita de novo, e ficam fora de toda soma;
 * 3. o zero do percentual de entrada não conta como "um segundo percentual";
 * 4. a coerência do cadastro lê a data em UTC, ou o fuso de quem abre a tela
 *    inventa divergência.
 */

function alteracao(parcial: Partial<AlteracaoDoMotor>): AlteracaoDoMotor {
  return {
    id: 1,
    changeType: "VALUE_CHANGED",
    attributeCode: "cavalo.valor_nf_compra",
    entityLabel: "ABC1D23",
    entityType: "CAVALO",
    valueBefore: "600000",
    valueAfter: "700000",
    deltaAbsolute: 100000,
    deltaPercent: 16.67,
    comparability: "COMPARABLE",
    impactConfidence: "CALCULATED",
    impactAmount: 100000,
    impactPeriodicity: "PONTUAL",
    ...parcial,
  };
}

function valor(parcial: Partial<ValorDeAquisicao>): ValorDeAquisicao {
  return {
    ponta: "BASE",
    entityType: "CAVALO",
    entityLabel: "ABC1D23",
    valorNf: 665929.99,
    percentualEntrada: 20,
    dataDeEntrada: "2021-01-01T12:00:00Z",
    ano: 2021,
    mesDeEntrada: 1,
    ...parcial,
  };
}

describe("o catálogo", () => {
  it("mantém o valor de nota fora da soma, com a razão escrita", () => {
    const nota = VARIAVEIS_DE_AQUISICAO.find((v) => v.chave === "valor_nf");
    expect(nota?.foraDaSoma).toBeTruthy();
    expect(nota?.papel).toBe("MONTANTE");
  });

  it("marca o ano e o mês como derivados da data, e fora da soma", () => {
    for (const chave of ["ano", "mes_de_entrada"]) {
      const v = VARIAVEIS_DE_DETALHE_DE_AQUISICAO.find((x) => x.chave === chave);
      expect(v?.derivadaDe).toBe("data_de_entrada");
      expect(v?.foraDaSoma).toBeTruthy();
    }
  });

  it("acha a variável de um código, e devolve nada para o que não é da rubrica", () => {
    expect(variavelDeAquisicaoDoCodigo("carreta.valor_nf_compra")?.chave).toBe("valor_nf");
    expect(variavelDeAquisicaoDoCodigo("cavalo.ipva_licenciamento")).toBeUndefined();
  });
});

describe("as linhas", () => {
  it("traduz a alteração da nota e descarta o que não é da rubrica", () => {
    const linhas = linhasDeAquisicao([
      alteracao({}),
      alteracao({ id: 2, attributeCode: "cavalo.ipva_licenciamento" }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      variavel: "valor_nf",
      papel: "MONTANTE",
      diferenca: 100000,
      estado: "ALTERADO",
    });
    expect(linhas[0].foraDaSoma).toBeTruthy();
  });

  it("deixa passar a entrada e a saída de ativo, que não citam atributo", () => {
    const linhas = linhasDeAquisicao([
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].variavel).toBe("veiculo");
    expect(linhas[0].estado).toBe("NOVO_NA_VIGENCIA");
  });
});

describe("o impacto", () => {
  it("não soma a nota, por mais precificada que ela venha", () => {
    /*
      A alteração chega com `impactAmount` e `impactPeriodicity` — o motor a
      precificou. Somá-la aqui faria o produto publicar, como custo do período,
      o preço que o ativo teve uma vez. Ver `posse-da-soma-do-custo-fixo`.
    */
    const impacto = impactoDeAquisicao(linhasDeAquisicao([alteracao({})]));
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.notasAlteradas).toBe(1);
    expect(impacto.foraDaSoma).toBe(1);
  });

  it("conta o valor negativo sem escondê-lo", () => {
    const impacto = impactoDeAquisicao(
      linhasDeAquisicao([alteracao({ valueAfter: "-1000", deltaAbsolute: -601000 })]),
    );
    expect(impacto.valoresNegativos).toBe(1);
  });

  it("não conta como nota alterada o que não mudou", () => {
    const impacto = impactoDeAquisicao(
      linhasDeAquisicao([
        alteracao({ changeType: "ENTITY_ADDED", attributeCode: null, id: 3 }),
      ]),
    );
    expect(impacto.notasAlteradas).toBe(0);
  });
});

describe("a conferência da entrada", () => {
  it("chama de constante do modelo o percentual único", () => {
    const [c] = conferenciaDaEntrada([
      valor({}),
      valor({ entityLabel: "ABC1D24" }),
      valor({ entityLabel: "ABC1D25" }),
    ]);
    expect(c.veredito).toBe("CONSTANTE_DO_MODELO");
    expect(c.percentuais).toEqual([20]);
    expect(c.predominante).toBe(20);
  });

  it("não deixa o zero da frota alugada virar um segundo percentual", () => {
    /*
      Uma carreta do acervo declara 0% e nota zerada: ela não foi comprada. Se o
      zero contasse como percentual distinto, o acervo inteiro viraria
      "negociado ativo a ativo" por causa dela.
    */
    const [c] = conferenciaDaEntrada([
      valor({}),
      valor({ entityLabel: "ABC1D24", percentualEntrada: 0, valorNf: 0 }),
    ]);
    expect(c.veredito).toBe("CONSTANTE_DO_MODELO");
    expect(c.zerados).toBe(1);
  });

  it("chama de negociado ativo a ativo quando há mais de um percentual", () => {
    const [c] = conferenciaDaEntrada([
      valor({}),
      valor({ entityLabel: "ABC1D24", percentualEntrada: 30 }),
    ]);
    expect(c.veredito).toBe("POR_ATIVO");
    expect(c.percentuais).toEqual([30, 20]);
  });

  it("chama de ausente quando só há zeros", () => {
    const [c] = conferenciaDaEntrada([valor({ percentualEntrada: 0 })]);
    expect(c.veredito).toBe("AUSENTE");
  });

  it("separa as pontas e os tipos", () => {
    const conferencias = conferenciaDaEntrada([
      valor({}),
      valor({ ponta: "COMPARADA" }),
      valor({ entityType: "CARRETA" }),
    ]);
    expect(conferencias).toHaveLength(3);
  });
});

describe("a coerência do cadastro", () => {
  it("fecha quando o ano e o mês são os da data", () => {
    const r = resumirCoerenciaDoCadastro([valor({})]);
    expect(r.divergencias).toEqual([]);
    expect(r.coerentes).toBe(1);
  });

  it("acusa o ano que não acompanha a data", () => {
    const r = resumirCoerenciaDoCadastro([valor({ ano: 2020 })]);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0]).toMatchObject({
      divergencia: "ANO",
      anoDaData: 2021,
      anoDeclarado: 2020,
    });
  });

  it("acusa os dois quando os dois divergem", () => {
    const r = resumirCoerenciaDoCadastro([valor({ ano: 2020, mesDeEntrada: 7 })]);
    expect(r.divergencias[0].divergencia).toBe("ANO_E_MES");
  });

  it("lê a data em UTC, e não no fuso de quem roda o teste", () => {
    /*
      `2021-01-01T00:00:00Z` no Brasil é 31/12/2020. Lido no fuso local, o ano
      declarado (2021) viraria divergência — uma inventada pelo relógio de quem
      abriu a tela.
    */
    const r = resumirCoerenciaDoCadastro([
      valor({ dataDeEntrada: "2021-01-01T00:00:00Z", ano: 2021, mesDeEntrada: 1 }),
    ]);
    expect(r.divergencias).toEqual([]);
  });

  it("deixa fora da conferência a data que não se lê, e diz quantas foram", () => {
    const r = resumirCoerenciaDoCadastro([
      valor({ dataDeEntrada: "não é data" }),
      valor({ dataDeEntrada: null }),
      valor({}),
    ]);
    expect(r.semDataLegivel).toBe(2);
    expect(r.conferidos).toBe(1);
    expect(r.divergencias).toEqual([]);
  });
});

describe("o total de nota", () => {
  it("soma por ponta e por tipo, contando os zerados à parte", () => {
    const totais = totaisDeAquisicaoPorVigencia([
      valor({ valorNf: 100 }),
      valor({ entityLabel: "ABC1D24", valorNf: 0 }),
      valor({ ponta: "COMPARADA", valorNf: 300 }),
    ]);
    const base = totais.find((t) => t.ponta === "BASE");
    expect(base).toMatchObject({ total: 100, ativos: 2, zerados: 1 });
    expect(totais.find((t) => t.ponta === "COMPARADA")?.total).toBe(300);
  });

  it("não conta a nota ausente como zero", () => {
    const totais = totaisDeAquisicaoPorVigencia([valor({ valorNf: null })]);
    expect(totais).toEqual([]);
  });
});

describe("o agrupamento por placa", () => {
  it("junta as linhas da mesma placa e não conta a entrada de frota como alteração", () => {
    const veiculos = agruparPorVeiculoDeAquisicao(
      linhasDeAquisicao([
        alteracao({}),
        alteracao({ id: 2, changeType: "ENTITY_ADDED", attributeCode: null }),
      ]),
    );
    expect(veiculos).toHaveLength(1);
    expect(veiculos[0].alteracoes).toBe(1);
  });
});
