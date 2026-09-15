import { describe, expect, it } from "vitest";
import {
  alteracoesPorVariavelDeKm,
  celulasDoCsvDeKm,
  CODIGOS_DA_TABELA_DE_KM,
  CODIGOS_DO_DETALHE_DE_KM,
  COMPONENTES_DE_CUSTO,
  COMPONENTES_DO_PRECO,
  COMPONENTES_QUE_CONFEREM,
  composicaoDoPrecoPorKm,
  conferenciaDoKm,
  conferenciaDoTrecho,
  distribuicaoPorEstadoDeKm,
  impactoDeKm,
  linhaDeKmDaAlteracao,
  linhaDeKmSemAlteracao,
  linhasDeKm,
  precoPorKmDoTrecho,
  precoPorKmPorVigencia,
  resumirKm,
  variavelDeKmDoCodigo,
  VARIAVEIS_DE_KM,
  type AlteracaoDoMotor,
  type ValorDeKm,
} from "../km-rodado";
import { vigenciasQueCobrem } from "../recorte-de-rubrica";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara nada — comparar é do `engine` —, então aqui não há
 * snapshot, banco nem fixture de export. O que se prende é a **tradução** e as
 * quatro decisões que o dicionário da tabela de frete obrigou a escrever
 * (`docs/ACHADO-KM-RODADO.md`):
 *
 * 1. R$/km e R$/viagem são o mesmo dinheiro em duas formas, e nunca somam;
 * 2. razão não é montante, e nesta rubrica nada é dinheiro do período;
 * 3. lucro variável é margem, não custo;
 * 4. o pedágio tem duas vias de cálculo e por isso não confere o km.
 *
 * E as duas contas que a tela existe para fazer: ida + volta tem de dar o km do
 * ciclo, e `R$/viagem ÷ R$/km` tem de dar esse mesmo km.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "trecho.frete_reais_km_diesel",
  entityLabel: "CAMACARIFEIRADESANTANA",
  entityType: "TRECHO",
  valueBefore: "1.8400",
  valueAfter: "1.9100",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "0.07",
  deltaPercent: "3.804348",
  comparability: "COMPARABLE",
  impactConfidence: "NOT_CALCULABLE",
  impactAmount: null,
  impactPeriodicity: null,
  ...over,
});

/**
 * Um trecho coerente: 206 km de ida, 206 de volta, 412 de ciclo, e cada
 * R$/viagem igual ao R$/km vezes 412.
 */
const trecho = (over: Partial<ValorDeKm> = {}): ValorDeKm => {
  const razoes: Record<string, number> = {
    diesel: 1.84,
    manutencao_cavalo: 0.42,
    manutencao_carreta: 0.18,
    pneu: 0.21,
    pedagio: 0.09,
    lavagem: 0.03,
    seguro: 0.06,
    salario_variavel: 0.12,
    lucro_variavel: 0.35,
  };
  const viagens: Record<string, number> = {};
  for (const [chave, valor] of Object.entries(razoes)) viagens[chave] = valor * 412;
  return {
    ponta: "BASE",
    entityLabel: "CAMACARIFEIRADESANTANA",
    origem: "CAMAÇARI",
    destino: "FEIRA DE SANTANA",
    kmCiclo: 412,
    kmIda: 206,
    kmVolta: 206,
    viagensPrevistas: 44,
    razoes,
    viagens,
    ...over,
  };
};

describe("o catálogo das variáveis", () => {
  it("é de trecho, e cada variável tem um código só", () => {
    for (const v of VARIAVEIS_DE_KM) expect(v.codigo.startsWith("trecho.")).toBe(true);
  });

  it("deixa as nove colunas de R$/viagem fora da tabela e dentro do detalhe", () => {
    for (const c of COMPONENTES_DO_PRECO) {
      expect(CODIGOS_DA_TABELA_DE_KM).not.toContain(c.codigoViagem);
      expect(CODIGOS_DO_DETALHE_DE_KM).toContain(c.codigoViagem);
      expect(CODIGOS_DA_TABELA_DE_KM).toContain(c.codigoRazao);
    }
  });

  it("carrega o motivo de o R$/viagem não somar, e não só a proibição", () => {
    const viagem = variavelDeKmDoCodigo("trecho.frete_reais_viagem_diesel")!;
    expect(viagem.foraDaSoma).toContain("duas vezes");
    expect(viagem.papel).toBe("POR_VIAGEM");
  });

  it("separa razão de distância e de volume — a distinção que decide o resto", () => {
    expect(variavelDeKmDoCodigo("trecho.frete_reais_km_diesel")!.papel).toBe("RAZAO");
    expect(variavelDeKmDoCodigo("trecho.km_rodado")!.papel).toBe("DISTANCIA");
    expect(variavelDeKmDoCodigo("trecho.previsao_viagens")!.papel).toBe("VOLUME");
  });

  it("trata o lucro variável como margem, e não como custo", () => {
    expect(COMPONENTES_DE_CUSTO.map((c) => c.chave)).not.toContain("lucro_variavel");
    expect(COMPONENTES_DE_CUSTO).toHaveLength(COMPONENTES_DO_PRECO.length - 1);
    expect(variavelDeKmDoCodigo("trecho.frete_reais_km_lucro_variavel")!.margem).toBe(true);
  });

  it("tira o pedágio da conferência, pelo motivo publicado", () => {
    expect(COMPONENTES_QUE_CONFEREM.map((c) => c.chave)).not.toContain("pedagio");
    const pedagio = COMPONENTES_DO_PRECO.find((c) => c.chave === "pedagio")!;
    expect(pedagio.foraDaConferencia).toContain("ANTT");
  });
});

describe("a linha da tabela", () => {
  it("descarta o que não é de km rodado", () => {
    expect(linhaDeKmDaAlteracao(alteracao({ attributeCode: "trecho.pedagio_cheio" }))).toBeNull();
  });

  it("guarda a entrada do trecho na tabela, que não cita atributo nenhum", () => {
    const linha = linhaDeKmDaAlteracao(
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
    )!;
    expect(linha.variavel).toBe("trecho");
    expect(linha.estado).toBe("NOVO_NA_VIGENCIA");
  });

  it("deixa o R$/viagem passar, marcado — esconder o aviso seria apagá-lo", () => {
    const linha = linhaDeKmDaAlteracao(
      alteracao({ attributeCode: "trecho.frete_reais_viagem_diesel" }),
    )!;
    expect(linha.papel).toBe("POR_VIAGEM");
    expect(linha.foraDaSoma).toBeTruthy();
  });

  it("não lê ausência como zero", () => {
    const linha = linhaDeKmDaAlteracao(
      alteracao({
        changeType: "ATTRIBUTE_ADDED",
        valueBefore: null,
        deltaAbsolute: null,
        deltaPercent: null,
        comparability: "INCONCLUSIVE",
      }),
    )!;
    expect(linha.estado).toBe("NOVO_NA_VIGENCIA");
    expect(linha.diferenca).toBeNull();
  });

  it("monta a linha igual do alternador, sem id e sem delta", () => {
    const linha = linhaDeKmSemAlteracao({
      entityLabel: "CAMACARIFEIRADESANTANA",
      entityType: "TRECHO",
      attributeCode: "trecho.km_rodado",
      valor: "412",
    })!;
    expect(linha.id).toBeNull();
    expect(linha.estado).toBe("SEM_ALTERACAO");
    expect(linha.medida).toBe("DISTANCIA");
  });
});

describe("o impacto", () => {
  it("não transforma razão em dinheiro — conta-as à parte", () => {
    const impacto = impactoDeKm(linhasDeKm([alteracao()]));
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.razoesAlteradas).toBe(1);
    expect(impacto.naoCalculavel).toBe(0);
  });

  it("não soma o R$/viagem, que é o mesmo dinheiro do R$/km", () => {
    const impacto = impactoDeKm(
      linhasDeKm([
        alteracao({
          attributeCode: "trecho.frete_reais_viagem_diesel",
          impactConfidence: "CALCULATED",
          impactAmount: "28.84",
          impactPeriodicity: "PONTUAL",
        }),
      ]),
    );
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.foraDaSoma).toBe(1);
  });

  it("conta a distância que se moveu sem chamá-la de dinheiro", () => {
    const impacto = impactoDeKm(
      linhasDeKm([
        alteracao({ attributeCode: "trecho.km_rodado", valueBefore: "412", valueAfter: "430" }),
      ]),
    );
    expect(impacto.distanciasAlteradas).toBe(1);
    expect(impacto.porPeriodicidade).toEqual({});
  });
});

describe("os indicadores", () => {
  const trechos = { comparados: 400, novos: 3, ausentes: 5 };

  it("conta como sem alteração o que nenhuma linha tocou", () => {
    const linhas = linhasDeKm([
      alteracao(),
      alteracao({
        entityLabel: "OUTRO",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
        inconclusiveReason: "Tipo mudou entre as vigências",
      }),
    ]);
    const resumo = resumirKm(linhas, trechos);
    expect(resumo.trechosComAlteracao).toBe(1);
    expect(resumo.trechosComConflito).toBe(1);
    expect(resumo.semAlteracao).toBe(398);
  });

  it("dá a um trecho uma fatia só, a mais grave", () => {
    const linhas = linhasDeKm([
      alteracao(),
      alteracao({
        attributeCode: "trecho.km_rodado",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
      }),
    ]);
    const fatias = distribuicaoPorEstadoDeKm(linhas, trechos);
    expect(fatias.reduce((acc, f) => acc + f.trechos, 0)).toBe(408);
    expect(fatias.find((f) => f.estado === "CONFLITO")!.trechos).toBe(1);
    expect(fatias.find((f) => f.estado === "ALTERADO")).toBeUndefined();
  });

  it("ordena as variáveis pela quantidade de alterações", () => {
    const barras = alteracoesPorVariavelDeKm(
      linhasDeKm([
        alteracao(),
        alteracao({ entityLabel: "OUTRO" }),
        alteracao({ attributeCode: "trecho.km_rodado" }),
      ]),
    );
    expect(barras[0]).toMatchObject({ variavel: "reais_km_diesel", alteracoes: 2 });
    expect(barras[1]).toMatchObject({ variavel: "km_ciclo", alteracoes: 1 });
  });
});

describe("o preço por quilômetro", () => {
  it("soma as nove parcelas, e separa a margem do custo", () => {
    const preco = precoPorKmDoTrecho(trecho());
    expect(preco.preco).toBeCloseTo(3.3, 6);
    expect(preco.custo).toBeCloseTo(2.95, 6);
    expect(preco.margem).toBeCloseTo(0.35, 6);
    expect(preco.parcelas).toBe(9);
    expect(preco.parcelasAusentes).toBe(0);
  });

  it("não lê parcela ausente como zero — conta-a como ausente", () => {
    const semLavagem = trecho();
    semLavagem.razoes.lavagem = null;
    const preco = precoPorKmDoTrecho(semLavagem);
    expect(preco.parcelas).toBe(8);
    expect(preco.parcelasAusentes).toBe(1);
    expect(preco.preco).toBeCloseTo(3.27, 6);
  });

  it("devolve nulo, e não zero, para o trecho sem nenhuma parcela", () => {
    const vazio = trecho({ razoes: {}, viagens: {} });
    expect(precoPorKmDoTrecho(vazio).preco).toBeNull();
  });

  it("agrega por ponta como média simples entre trechos", () => {
    const caro = trecho({ entityLabel: "CARO" });
    caro.razoes.diesel = 2.84;
    const [ponta] = precoPorKmPorVigencia([trecho(), caro]);
    expect(ponta.trechos).toBe(2);
    expect(ponta.media).toBeCloseTo(3.8, 4);
    expect(ponta.minimo).toBeCloseTo(3.3, 4);
    expect(ponta.maximo).toBeCloseTo(4.3, 4);
    expect(ponta.margemMedia).toBeCloseTo(0.35, 4);
  });

  it("compõe o preço parcela a parcela, dizendo quantos trechos sustentam cada uma", () => {
    const semLavagem = trecho({ entityLabel: "SEM_LAVAGEM" });
    semLavagem.razoes.lavagem = null;
    const fatias = composicaoDoPrecoPorKm([trecho(), semLavagem]);
    const diesel = fatias.find((f) => f.componente === "diesel")!;
    const lavagem = fatias.find((f) => f.componente === "lavagem")!;
    expect(diesel.trechos).toBe(2);
    expect(lavagem.trechos).toBe(1);
    expect(fatias.find((f) => f.componente === "lucro_variavel")!.margem).toBe(true);
  });
});

describe("a conferência do km", () => {
  it("fecha as duas contas num trecho coerente", () => {
    const c = conferenciaDoTrecho(trecho());
    expect(c.kmDasPontas).toBe(412);
    expect(c.diferencaDoCiclo).toBe(0);
    expect(c.kmImplicito).toBeCloseTo(412, 3);
    expect(c.componentesDivergentes).toBe(0);
    expect(c.veredito).toBe("CONFERE");
  });

  it("acusa o ciclo que não fecha, e decide antes do preço", () => {
    const c = conferenciaDoTrecho(trecho({ kmVolta: 260 }));
    expect(c.diferencaDoCiclo).toBe(54);
    expect(c.veredito).toBe("CICLO_NAO_FECHA");
  });

  it("perdoa o arredondamento das pontas, que é meio quilômetro", () => {
    expect(conferenciaDoTrecho(trecho({ kmVolta: 206.3 })).veredito).toBe("CONFERE");
  });

  it("acusa o preço montado sobre outra distância", () => {
    /* O preço todo montado sobre a ida, e não sobre o ciclo. */
    const sobreAIda = trecho();
    for (const chave of Object.keys(sobreAIda.viagens)) {
      sobreAIda.viagens[chave] = (sobreAIda.razoes[chave] as number) * 206;
    }
    const c = conferenciaDoTrecho(sobreAIda);
    expect(c.kmImplicito).toBeCloseTo(206, 3);
    expect(c.veredito).toBe("PRECO_USA_OUTRO_KM");
  });

  it("não deixa um componente sozinho decidir a distância do preço", () => {
    /*
      Sete componentes concordam em 412 e o oitavo foi montado sobre a projeção
      mensal. A mediana continua em 412 — e o divergente sai contado, que é onde
      ele informa.
    */
    const umDivergente = trecho();
    umDivergente.viagens.seguro = (umDivergente.razoes.seguro as number) * 9000;
    const c = conferenciaDoTrecho(umDivergente);
    expect(c.kmImplicito).toBeCloseTo(412, 3);
    expect(c.componentesDivergentes).toBe(1);
    expect(c.veredito).toBe("CONFERE");
  });

  it("ignora o pedágio, cuja segunda via de cálculo não é quilometragem", () => {
    const pedagioPorEixo = trecho();
    pedagioPorEixo.viagens.pedagio = 180;
    const c = conferenciaDoTrecho(pedagioPorEixo);
    expect(c.componentesConferidos).toBe(COMPONENTES_QUE_CONFEREM.length);
    expect(c.veredito).toBe("CONFERE");
  });

  it("não confere contra um componente que o trecho não cobra", () => {
    const semLavagem = trecho();
    semLavagem.razoes.lavagem = 0;
    semLavagem.viagens.lavagem = 0;
    const c = conferenciaDoTrecho(semLavagem);
    expect(c.componentesConferidos).toBe(COMPONENTES_QUE_CONFEREM.length - 1);
    expect(c.veredito).toBe("CONFERE");
  });

  it("recusa o veredito quando não há km declarado", () => {
    expect(conferenciaDoTrecho(trecho({ kmCiclo: null })).veredito).toBe("BASE_INSUFICIENTE");
    expect(conferenciaDoTrecho(trecho({ kmCiclo: 0 })).veredito).toBe("BASE_INSUFICIENTE");
  });

  it("agrega por ponta contando trechos, nunca num veredito único da vigência", () => {
    const [ponta] = conferenciaDoKm([
      trecho(),
      trecho({ entityLabel: "T2", kmVolta: 260 }),
      trecho({ entityLabel: "T3", kmCiclo: null }),
    ]);
    expect(ponta.trechos).toBe(3);
    expect(ponta.confere).toBe(1);
    expect(ponta.cicloNaoFecha).toBe(1);
    expect(ponta.baseInsuficiente).toBe(1);
    expect(ponta.maiorDiferencaDoCiclo).toBe(54);
  });
});

describe("o recorte das vigências que cobrem trecho", () => {
  const vigencia = (id: string, entityTypeSet: string) => ({
    id,
    effectiveDate: "2026-08-16",
    entityTypeSet,
    scopeHash: "abc",
  });

  it("aceita a cobertura combinada, e não só a exata", () => {
    const lista = [
      vigencia("a", "TRECHO"),
      vigencia("b", "CARRETA+CAVALO"),
      vigencia("c", "CAVALO+TRECHO"),
    ];
    expect(vigenciasQueCobrem(lista, "TRECHO").map((v) => v.id)).toEqual(["a", "c"]);
  });

  it("devolve lista vazia quando nenhuma vigência cobre o tipo", () => {
    expect(vigenciasQueCobrem([vigencia("b", "CARRETA+CAVALO")], "TRECHO")).toEqual([]);
  });
});

describe("o CSV", () => {
  it("diz a unidade de cada linha, para que a planilha não some razão com km", () => {
    const [razao] = linhasDeKm([alteracao()]);
    const [distancia] = linhasDeKm([alteracao({ attributeCode: "trecho.km_rodado" })]);
    expect(celulasDoCsvDeKm(razao)[2]).toBe("R$/km");
    expect(celulasDoCsvDeKm(distancia)[2]).toBe("km");
  });

  it("leva o aviso do que não soma para dentro do arquivo", () => {
    const [linha] = linhasDeKm([
      alteracao({ attributeCode: "trecho.frete_reais_viagem_diesel" }),
    ]);
    const celulas = celulasDoCsvDeKm(linha);
    expect(celulas).toHaveLength(10);
    expect(String(celulas[9])).toContain("duas vezes");
  });
});
