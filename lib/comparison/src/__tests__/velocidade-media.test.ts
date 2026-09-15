import { describe, expect, it } from "vitest";
import {
  alteracoesPorVariavelDeVelocidade,
  celulasDoCsvDeVelocidade,
  CODIGOS_DA_TABELA_DE_VELOCIDADE,
  CODIGOS_DO_DETALHE_DE_VELOCIDADE,
  distribuicaoPorEstadoDeVelocidade,
  impactoDeVelocidade,
  leituraDoTrecho,
  linhaDeVelocidadeDaAlteracao,
  linhaDeVelocidadeSemAlteracao,
  linhasDeVelocidade,
  PARADAS_DO_CICLO,
  particaoDoCicloPorVigencia,
  resumirVelocidade,
  tempoPagoPorVigencia,
  variavelDeVelocidadeDoCodigo,
  velocidadePorVigencia,
  type AlteracaoDoMotor,
  type ValorDeVelocidade,
} from "../velocidade-media";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara nada — comparar é do `engine` —, então aqui não há
 * snapshot, banco nem fixture de export. O que se prende é a **tradução** e as
 * três decisões que o dicionário da tabela de frete obrigou a escrever
 * (`docs/ACHADO-VELOCIDADE-MEDIA.md`):
 *
 * 1. o ciclo se decompõe — e a decomposição é conferível contra a velocidade
 *    declarada;
 * 2. tempo pago e tempo praticado são duas medidas, e a diferença é o assunto;
 * 3. velocidade é razão: não soma, e a média entre trechos é dita como tal.
 *
 * Mais a regra que atravessa o produto inteiro e que aqui custa caro: **uma
 * parada ausente não vira zero**. Lida como zero, ela inflaria o tempo rodando e
 * produziria uma velocidade alta e falsa.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "trecho.velocidade_media_km_h",
  entityLabel: "CAMACARIFEIRADESANTANA",
  entityType: "TRECHO",
  valueBefore: "58",
  valueAfter: "62",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "4",
  deltaPercent: "6.896552",
  comparability: "COMPARABLE",
  impactConfidence: "NOT_CALCULABLE",
  impactAmount: null,
  impactPeriodicity: null,
  ...over,
});

/**
 * Um trecho coerente, com números que fecham: 412 km de ciclo a 58 km/h dão
 * 426,2 minutos de deslocamento; com 90 + 120 + 60 de paradas, o ciclo é 696,2.
 */
const RODANDO = (412 / 58) * 60;
const trecho = (over: Partial<ValorDeVelocidade> = {}): ValorDeVelocidade => ({
  ponta: "BASE",
  entityLabel: "CAMACARIFEIRADESANTANA",
  origem: "CAMAÇARI",
  destino: "FEIRA DE SANTANA",
  velocidade: 58,
  ciclo: RODANDO + 270,
  trajeto: RODANDO / 2,
  tmaOrigem: 90,
  tmaDestino: 120,
  refeicao: 60,
  kmCiclo: 412,
  kmIda: 206,
  cicloLucro: RODANDO + 270,
  tmaOrigemLucro: 90,
  tmaDestinoLucro: 120,
  ...over,
});

describe("o catálogo das variáveis", () => {
  it("é de trecho, e cada variável tem um código só", () => {
    for (const v of [...CODIGOS_DA_TABELA_DE_VELOCIDADE]) {
      expect(v.startsWith("trecho.")).toBe(true);
    }
  });

  it("guarda as três paradas que o ciclo contém, e só elas", () => {
    expect(PARADAS_DO_CICLO.map((p) => p.chave)).toEqual([
      "tma_origem",
      "tma_destino",
      "refeicao",
    ]);
  });

  it("deixa a versão lucro fora da tabela e dentro do detalhe", () => {
    for (const code of [
      "trecho.carga_horaria_por_trajeto_minuto_lucro",
      "trecho.tempo_interno_origem_lucro",
      "trecho.tempo_interno_destino_lucro",
    ]) {
      expect(CODIGOS_DA_TABELA_DE_VELOCIDADE).not.toContain(code);
      expect(CODIGOS_DO_DETALHE_DE_VELOCIDADE).toContain(code);
      expect(variavelDeVelocidadeDoCodigo(code)!.versaoLucro).toBe(true);
      expect(variavelDeVelocidadeDoCodigo(code)!.foraDaSoma).toBeTruthy();
    }
  });

  it("tira o ciclo de toda soma, porque ele já contém as parcelas", () => {
    const ciclo = variavelDeVelocidadeDoCodigo("trecho.carga_horaria_por_trajeto_minuto")!;
    expect(ciclo.papel).toBe("TEMPO_TOTAL");
    expect(ciclo.foraDaSoma).toContain("duas vezes");
  });

  it("separa tempo rodando de tempo parado no papel de cada coluna", () => {
    expect(variavelDeVelocidadeDoCodigo("trecho.tempo_interno_origem")!.papel).toBe(
      "TEMPO_PARADO",
    );
    expect(variavelDeVelocidadeDoCodigo("trecho.tempo_trajeto_fabrica_cd_minuto")!.papel).toBe(
      "TEMPO_RODANDO",
    );
    expect(variavelDeVelocidadeDoCodigo("trecho.velocidade_media_km_h")!.papel).toBe(
      "VELOCIDADE",
    );
  });
});

describe("a linha da tabela", () => {
  it("descarta o que não é de velocidade", () => {
    expect(
      linhaDeVelocidadeDaAlteracao(alteracao({ attributeCode: "trecho.pedagio_cheio" })),
    ).toBeNull();
  });

  it("guarda a entrada do trecho na tabela, que não cita atributo nenhum", () => {
    const linha = linhaDeVelocidadeDaAlteracao(
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
    )!;
    expect(linha.variavel).toBe("trecho");
    expect(linha.estado).toBe("NOVO_NA_VIGENCIA");
  });

  it("marca a linha da versão lucro como tal", () => {
    const linha = linhaDeVelocidadeDaAlteracao(
      alteracao({ attributeCode: "trecho.tempo_interno_origem_lucro" }),
    )!;
    expect(linha.versaoLucro).toBe(true);
    expect(linha.foraDaSoma).toBeTruthy();
  });

  it("não lê ausência como zero", () => {
    const linha = linhaDeVelocidadeDaAlteracao(
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
    const linha = linhaDeVelocidadeSemAlteracao({
      entityLabel: "T1",
      entityType: "TRECHO",
      attributeCode: "trecho.tempo_interno_origem",
      valor: "90",
    })!;
    expect(linha.id).toBeNull();
    expect(linha.estado).toBe("SEM_ALTERACAO");
    expect(linha.medida).toBe("MINUTOS");
  });
});

describe("o impacto", () => {
  it("não transforma minuto em dinheiro — conta as paradas à parte", () => {
    const impacto = impactoDeVelocidade(
      linhasDeVelocidade([
        alteracao({ attributeCode: "trecho.tempo_interno_destino", valueBefore: "120", valueAfter: "150" }),
      ]),
    );
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.paradasAlteradas).toBe(1);
    expect(impacto.naoCalculavel).toBe(0);
  });

  it("conta a velocidade que se moveu sem chamá-la de dinheiro", () => {
    const impacto = impactoDeVelocidade(linhasDeVelocidade([alteracao()]));
    expect(impacto.velocidadesAlteradas).toBe(1);
    expect(impacto.porPeriodicidade).toEqual({});
  });

  it("conta à parte o que mudou só do lado que remunera", () => {
    const impacto = impactoDeVelocidade(
      linhasDeVelocidade([
        alteracao({ attributeCode: "trecho.tempo_interno_origem_lucro" }),
        alteracao({ attributeCode: "trecho.carga_horaria_por_trajeto_minuto_lucro" }),
      ]),
    );
    expect(impacto.versaoLucroAlterada).toBe(2);
    expect(impacto.foraDaSoma).toBe(2);
    /* A versão lucro é tempo parado, mas não é tempo parado da operação. */
    expect(impacto.paradasAlteradas).toBe(0);
  });
});

describe("os indicadores", () => {
  const trechos = { comparados: 400, novos: 3, ausentes: 5 };

  it("conta como sem alteração o que nenhuma linha tocou", () => {
    const linhas = linhasDeVelocidade([
      alteracao(),
      alteracao({
        entityLabel: "OUTRO",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
        inconclusiveReason: "Tipo mudou entre as vigências",
      }),
    ]);
    const resumo = resumirVelocidade(linhas, trechos);
    expect(resumo.trechosComAlteracao).toBe(1);
    expect(resumo.trechosComConflito).toBe(1);
    expect(resumo.semAlteracao).toBe(398);
  });

  it("dá a um trecho uma fatia só, a mais grave", () => {
    const fatias = distribuicaoPorEstadoDeVelocidade(
      linhasDeVelocidade([
        alteracao(),
        alteracao({
          attributeCode: "trecho.tempo_interno_origem",
          comparability: "INCONCLUSIVE",
          nature: "TYPE_CHANGED",
        }),
      ]),
      trechos,
    );
    expect(fatias.reduce((acc, f) => acc + f.trechos, 0)).toBe(408);
    expect(fatias.find((f) => f.estado === "CONFLITO")!.trechos).toBe(1);
    expect(fatias.find((f) => f.estado === "ALTERADO")).toBeUndefined();
  });

  it("ordena as variáveis pela quantidade de alterações", () => {
    const barras = alteracoesPorVariavelDeVelocidade(
      linhasDeVelocidade([
        alteracao(),
        alteracao({ entityLabel: "OUTRO" }),
        alteracao({ attributeCode: "trecho.tempo_refeicao_minuto" }),
      ]),
    );
    expect(barras[0]).toMatchObject({ variavel: "velocidade", alteracoes: 2 });
    expect(barras[1]).toMatchObject({ variavel: "refeicao", alteracoes: 1 });
  });
});

describe("a leitura de um trecho", () => {
  it("abre o ciclo entre o que roda e o que espera", () => {
    const l = leituraDoTrecho(trecho());
    expect(l.parado).toBe(270);
    expect(l.rodando).toBeCloseTo(RODANDO, 3);
    expect(l.fracaoRodando).toBeCloseTo(RODANDO / (RODANDO + 270), 3);
  });

  it("mede a velocidade do tempo rodando, e ela é a declarada", () => {
    const l = leituraDoTrecho(trecho());
    expect(l.velocidadeMedida).toBeCloseTo(58, 3);
    expect(l.diferencaDeVelocidade).toBeCloseTo(0, 3);
    expect(l.veredito).toBe("CONFERE");
  });

  it("não lê parada ausente como zero — sem ela, não há tempo rodando", () => {
    /*
      Lida como zero, a refeição ausente daria 486 minutos rodando e uma
      velocidade de 50,9 km/h contra 58 declarados: uma divergência inventada
      pela conversão.
    */
    const l = leituraDoTrecho(trecho({ refeicao: null }));
    expect(l.parado).toBeNull();
    expect(l.rodando).toBeNull();
    expect(l.velocidadeMedida).toBeNull();
    expect(l.veredito).toBe("BASE_INSUFICIENTE");
  });

  it("acusa as paradas que não cabem no ciclo, e decide antes da velocidade", () => {
    const l = leituraDoTrecho(trecho({ ciclo: 200 }));
    expect(l.rodando).toBeLessThan(0);
    expect(l.veredito).toBe("CICLO_NAO_COMPORTA_PARADAS");
  });

  it("acusa a velocidade declarada que não é a do ciclo", () => {
    const l = leituraDoTrecho(trecho({ velocidade: 40 }));
    expect(l.velocidadeMedida).toBeCloseTo(58, 2);
    expect(l.diferencaDeVelocidade).toBeCloseTo(18, 1);
    expect(l.veredito).toBe("VELOCIDADE_DIVERGE");
  });

  it("perdoa o arredondamento dos minutos, que é de dois por cento", () => {
    expect(leituraDoTrecho(trecho({ velocidade: 58.5 })).veredito).toBe("CONFERE");
  });

  it("mede sobre qual distância o tempo de trajeto foi calculado", () => {
    expect(leituraDoTrecho(trecho()).baseDoTrajeto).toBe("IDA");
    expect(leituraDoTrecho(trecho({ trajeto: RODANDO })).baseDoTrajeto).toBe("CICLO");
    expect(leituraDoTrecho(trecho({ trajeto: 20 })).baseDoTrajeto).toBe("OUTRA");
    expect(leituraDoTrecho(trecho({ trajeto: null })).baseDoTrajeto).toBe("SEM_BASE");
  });

  it("mede a folga entre o tempo pago e o praticado, com sinal", () => {
    const l = leituraDoTrecho(
      trecho({ cicloLucro: RODANDO + 330, tmaOrigemLucro: 120, tmaDestinoLucro: 150 }),
    );
    expect(l.folgaDoCiclo).toBeCloseTo(60, 3);
    expect(l.folgaDosTmas).toBeCloseTo(60, 3);
  });

  it("recusa a folga quando só uma das versões veio", () => {
    const l = leituraDoTrecho(trecho({ cicloLucro: null, tmaOrigemLucro: null }));
    expect(l.folgaDoCiclo).toBeNull();
    expect(l.folgaDosTmas).toBeNull();
  });
});

describe("a partição do ciclo por vigência", () => {
  it("separa rodando de parado e abre o parado nas três causas", () => {
    const [ponta] = particaoDoCicloPorVigencia([trecho(), trecho({ entityLabel: "T2" })]);
    expect(ponta.trechos).toBe(2);
    expect(ponta.paradoMedio).toBe(270);
    expect(ponta.tmaOrigemMedio).toBe(90);
    expect(ponta.tmaDestinoMedio).toBe(120);
    expect(ponta.refeicaoMedia).toBe(60);
    expect(ponta.rodandoMedio).toBeCloseTo(RODANDO, 1);
  });

  it("deixa de fora o trecho cujo ciclo não comporta as paradas, e o conta", () => {
    const [ponta] = particaoDoCicloPorVigencia([
      trecho(),
      trecho({ entityLabel: "T2", ciclo: 100 }),
    ]);
    expect(ponta.trechos).toBe(1);
    expect(ponta.trechosSemDecomposicao).toBe(1);
  });
});

describe("a velocidade por vigência", () => {
  it("conta trechos por leitura, nunca num veredito único da vigência", () => {
    const [ponta] = velocidadePorVigencia([
      trecho(),
      trecho({ entityLabel: "T2", velocidade: 40 }),
      trecho({ entityLabel: "T3", ciclo: 100 }),
      trecho({ entityLabel: "T4", kmCiclo: null }),
    ]);
    expect(ponta.trechos).toBe(4);
    expect(ponta.confere).toBe(1);
    expect(ponta.divergem).toBe(1);
    expect(ponta.cicloNaoComportaParadas).toBe(1);
    expect(ponta.baseInsuficiente).toBe(1);
  });

  it("conta sobre qual distância cada trecho calcula o tempo de trajeto", () => {
    const [ponta] = velocidadePorVigencia([
      trecho(),
      trecho({ entityLabel: "T2", trajeto: RODANDO }),
    ]);
    expect(ponta.trajetoSobreIda).toBe(1);
    expect(ponta.trajetoSobreCiclo).toBe(1);
    expect(ponta.trajetoSobreOutra).toBe(0);
  });

  it("guarda a maior distância entre a medida e a declarada", () => {
    const [ponta] = velocidadePorVigencia([trecho(), trecho({ entityLabel: "T2", velocidade: 40 })]);
    expect(ponta.maiorDiferenca).toBeCloseTo(18, 1);
  });
});

describe("o tempo pago contra o praticado", () => {
  it("conta quem paga mais, quem paga menos e quem paga igual", () => {
    const [ponta] = tempoPagoPorVigencia([
      trecho(),
      trecho({ entityLabel: "T2", cicloLucro: RODANDO + 330 }),
      trecho({ entityLabel: "T3", cicloLucro: RODANDO + 210 }),
    ]);
    expect(ponta.trechos).toBe(3);
    expect(ponta.iguais).toBe(1);
    expect(ponta.pagaMais).toBe(1);
    expect(ponta.pagaMenos).toBe(1);
    expect(ponta.folgaMediaDoCiclo).toBeCloseTo(0, 3);
  });

  it("guarda a maior folga com o sinal dela, e não em módulo", () => {
    const [ponta] = tempoPagoPorVigencia([
      trecho({ cicloLucro: RODANDO + 210 }),
      trecho({ entityLabel: "T2", cicloLucro: RODANDO + 280 }),
    ]);
    expect(ponta.maiorFolga).toBeCloseTo(-60, 3);
  });

  it("ignora o trecho que não declarou a versão lucro", () => {
    const [ponta] = tempoPagoPorVigencia([
      trecho(),
      trecho({
        entityLabel: "T2",
        cicloLucro: null,
        tmaOrigemLucro: null,
        tmaDestinoLucro: null,
      }),
    ]);
    expect(ponta.trechos).toBe(1);
  });
});

describe("o CSV", () => {
  it("diz a unidade de cada linha, para que a planilha não some km/h com minutos", () => {
    const [velocidade] = linhasDeVelocidade([alteracao()]);
    const [tempo] = linhasDeVelocidade([
      alteracao({ attributeCode: "trecho.tempo_interno_origem" }),
    ]);
    expect(celulasDoCsvDeVelocidade(velocidade)[2]).toBe("km/h");
    expect(celulasDoCsvDeVelocidade(tempo)[2]).toBe("minutos");
  });

  it("separa no arquivo o tempo que remunera do tempo que a operação pratica", () => {
    const [operacao] = linhasDeVelocidade([
      alteracao({ attributeCode: "trecho.tempo_interno_origem" }),
    ]);
    const [remuneracao] = linhasDeVelocidade([
      alteracao({ attributeCode: "trecho.tempo_interno_origem_lucro" }),
    ]);
    expect(celulasDoCsvDeVelocidade(operacao)[3]).toBe("Operação");
    expect(celulasDoCsvDeVelocidade(remuneracao)[3]).toBe("Remuneração");
    expect(celulasDoCsvDeVelocidade(remuneracao)).toHaveLength(11);
  });
});
