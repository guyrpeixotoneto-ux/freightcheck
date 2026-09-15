import { describe, expect, it } from "vitest";
import {
  CODIGOS_DA_TABELA_DE_LUCRO_FIXO,
  CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  alteracoesPorVariavelDeLucroFixo,
  celulasDoCsvDeLucroFixo,
  codigoDaVariavelDeLucroFixo,
  coexistencias,
  distribuicaoPorEstadoDeLucroFixo,
  DIRECAO_ECONOMICA,
  impactoDeLucroFixo,
  linhaDeLucroFixoDaAlteracao,
  linhaDeLucroFixoSemAlteracao,
  linhasDeLucroFixo,
  resumirLucroFixo,
  totaisDeLucroFixoPorVigencia,
  variavelDeLucroFixoDoCodigo,
  viradasDeCiclo,
  VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO,
  VARIAVEIS_DE_LUCRO_FIXO,
  type AlteracaoDoMotor,
  type ValorDeLucroFixo,
} from "../lucro-fixo";
import { escopoDeConjunto } from "../composition";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara nada — comparar é do `engine` —, então aqui não há
 * snapshot, banco nem fixture de export. O que se prende é a tradução e as três
 * coisas que só esta rubrica tem:
 *
 * 1. **é receita**, e o sinal do impacto significa o contrário do de FINAME;
 * 2. **o ciclo manda**: lucro fixo e amortização nunca coexistem, e quem vira o
 *    ciclo é a pergunta da tela;
 * 3. **a coluna do conjunto não soma**, e a frase que diz isso é lida de
 *    `ESCOPOS_DE_CONJUNTO` em vez de redigitada.
 *
 * Os números saem do acervo: `lucroFixomodeloNovoCiclo = ...Carreta +
 * ...Cavalo` em 284 de 284 pares; ciclo 1 ⟺ amortização > 0 e lucro fixo = 0
 * (503) e ciclo 2 ⟺ amortização = 0 (55), em 554 de 558.
 */

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  changeType: "VALUE_CHANGED",
  nature: "NUMERIC",
  attributeCode: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
  entityLabel: "RZM0B31",
  entityType: "CAVALO",
  valueBefore: "0",
  valueAfter: "3318.01",
  isNullBefore: false,
  isNullAfter: false,
  deltaAbsolute: "3318.01",
  deltaPercent: null,
  comparability: "COMPARABLE",
  impactConfidence: "CALCULATED",
  impactAmount: "3318.01",
  impactPeriodicity: "MENSAL",
  ...over,
});

const doCiclo = (de: string, para: string, over: Partial<AlteracaoDoMotor> = {}) =>
  alteracao({
    attributeCode: "cavalo.ciclo",
    valueBefore: de,
    valueAfter: para,
    deltaAbsolute: String(Number(para) - Number(de)),
    impactConfidence: "NOT_CALCULABLE",
    impactAmount: null,
    impactPeriodicity: null,
    ...over,
  });

describe("o catálogo das variáveis", () => {
  it("dá a cada tipo a parcela própria dele, nunca a do conjunto", () => {
    const lucro = VARIAVEIS_DE_LUCRO_FIXO.find((v) => v.chave === "lucro_fixo")!;
    expect(codigoDaVariavelDeLucroFixo(lucro, "CAVALO")).toBe(
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    );
    expect(codigoDaVariavelDeLucroFixo(lucro, "CARRETA")).toBe(
      "carreta.lucro_fixomodelo_novo_ciclo_carreta",
    );
    expect(codigoDaVariavelDeLucroFixo(lucro, "TRECHO")).toBeUndefined();
  });

  it("deixa a coluna do conjunto fora da tabela e dentro do detalhe", () => {
    expect(CODIGOS_DA_TABELA_DE_LUCRO_FIXO).not.toContain(
      "carreta.lucro_fixomodelo_novo_ciclo",
    );
    expect(CODIGOS_DO_DETALHE_DE_LUCRO_FIXO).toContain(
      "carreta.lucro_fixomodelo_novo_ciclo",
    );
  });

  /*
    Este é o teste que impede a frase de envelhecer sozinha. A evidência da
    coluna de conjunto já mora em `ESCOPOS_DE_CONJUNTO`, e este recorte a lê de
    lá: se alguém refizer a medição e reescrever aquela frase, esta tela passa a
    dizer a frase nova sem que ninguém precise lembrar dela. Uma cópia aqui
    continuaria repetindo a medição antiga — que é exatamente o que já aconteceu
    uma vez com este achado.
  */
  it("lê a evidência do conjunto de onde ela mora, em vez de redigitá-la", () => {
    const conjunto = variavelDeLucroFixoDoCodigo("carreta.lucro_fixomodelo_novo_ciclo")!;
    const declarada = escopoDeConjunto("carreta.lucro_fixomodelo_novo_ciclo")!;
    expect(conjunto.foraDaSoma).toBe(declarada.evidence);
    expect(conjunto.foraDaSoma).toContain("284 de 284");
  });

  it("traz o ciclo e a amortização, que são o que explica um lucro fixo zerado", () => {
    const chaves = VARIAVEIS_DE_LUCRO_FIXO.map((v) => v.chave);
    expect(chaves).toContain("ciclo");
    expect(chaves).toContain("amortizacao");
  });

  it("declara-se receita, e não custo", () => {
    expect(DIRECAO_ECONOMICA).toBe("RECEITA");
  });
});

describe("a linha da tabela", () => {
  it("descarta o que não é de lucro fixo", () => {
    expect(
      linhaDeLucroFixoDaAlteracao(alteracao({ attributeCode: "cavalo.ipva_licenciamento" })),
    ).toBeNull();
  });

  it("guarda a entrada de frota, que não cita atributo nenhum", () => {
    const linha = linhaDeLucroFixoDaAlteracao(
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
    )!;
    expect(linha.variavel).toBe("veiculo");
    expect(linha.estado).toBe("NOVO_NA_VIGENCIA");
  });

  it("deixa a coluna do conjunto passar, marcada", () => {
    const linha = linhaDeLucroFixoDaAlteracao(
      alteracao({
        attributeCode: "carreta.lucro_fixomodelo_novo_ciclo",
        entityType: "CARRETA",
      }),
    )!;
    expect(linha.variavel).toBe("lucro_fixo_conjunto");
    expect(linha.foraDaSoma).toBeTruthy();
  });

  it("não lê ausência como zero", () => {
    const linha = linhaDeLucroFixoDaAlteracao(
      alteracao({
        changeType: "ATTRIBUTE_ADDED",
        valueBefore: null,
        deltaAbsolute: null,
        deltaPercent: null,
        comparability: "INCONCLUSIVE",
      }),
    )!;
    expect(linha.base).toBeNull();
    expect(linha.diferenca).toBeNull();
  });

  it("monta a linha igual sem inventar um id de alteração", () => {
    const linha = linhaDeLucroFixoSemAlteracao({
      entityLabel: "RZM0B31",
      entityType: "CAVALO",
      attributeCode: "cavalo.ciclo",
      valor: "2",
    })!;
    expect(linha.id).toBeNull();
    expect(linha.estado).toBe("SEM_ALTERACAO");
    expect(linha.medida).toBe("CICLO");
  });
});

describe("o impacto", () => {
  it("nunca soma a coluna do conjunto junto com a parcela", () => {
    const linhas = linhasDeLucroFixo([
      alteracao(),
      alteracao({
        attributeCode: "carreta.lucro_fixomodelo_novo_ciclo",
        entityType: "CARRETA",
        entityLabel: "RTA9E11",
        impactAmount: "7463.52",
      }),
    ]);
    const impacto = impactoDeLucroFixo(linhas);
    expect(impacto.porPeriodicidade).toEqual({ MENSAL: 3318.01 });
    expect(impacto.foraDaSoma).toBe(1);
  });

  /*
    A recusa mais própria desta tela. Amortização é custo e lucro fixo é
    receita; num total só, o número não é de lado nenhum da DRE. E o caso é
    concreto, não hipotético: quando um ativo vira o ciclo, as duas linhas se
    movem no mesmo veículo e na mesma comparação.
  */
  it("não soma a amortização, que é custo, com o lucro fixo, que é receita", () => {
    const linhas = linhasDeLucroFixo([
      alteracao(),
      alteracao({
        attributeCode: "cavalo.amortizacao_cavalo",
        valueBefore: "3100",
        valueAfter: "0",
        deltaAbsolute: "-3100",
        impactAmount: "-3100",
      }),
    ]);
    expect(impactoDeLucroFixo(linhas).porPeriodicidade).toEqual({ MENSAL: 3318.01 });
  });

  it("não chama de 'não precificado' o ciclo, que nunca foi dinheiro", () => {
    expect(impactoDeLucroFixo(linhasDeLucroFixo([doCiclo("1", "2")])).naoCalculavel).toBe(0);
  });

  it("mantém cada periodicidade no balde dela", () => {
    const linhas = linhasDeLucroFixo([
      alteracao(),
      alteracao({
        entityLabel: "RTA9E11",
        entityType: "CARRETA",
        attributeCode: "carreta.lucro_fixomodelo_novo_ciclo_carreta",
        impactAmount: "3068.16",
        impactPeriodicity: "ANUAL",
      }),
    ]);
    expect(impactoDeLucroFixo(linhas).porPeriodicidade).toEqual({
      MENSAL: 3318.01,
      ANUAL: 3068.16,
    });
  });
});

describe("a virada de ciclo", () => {
  it("casa a virada com o dinheiro que entrou e o que saiu", () => {
    const linhas = linhasDeLucroFixo([
      doCiclo("1", "2"),
      alteracao(),
      alteracao({
        attributeCode: "cavalo.amortizacao_cavalo",
        valueBefore: "3100",
        valueAfter: "0",
        deltaAbsolute: "-3100",
        impactAmount: "-3100",
      }),
    ]);
    const [virada] = viradasDeCiclo(linhas);
    expect(virada.sentido).toBe("ENTROU_NO_SEGUNDO");
    expect(virada.de).toBe(1);
    expect(virada.para).toBe(2);
    expect(virada.lucroFixoDiferenca).toBe(3318.01);
    expect(virada.amortizacaoDiferenca).toBe(-3100);
  });

  it("marca o sentido que o modelo não prevê — um ativo não desamortiza", () => {
    const [virada] = viradasDeCiclo(linhasDeLucroFixo([doCiclo("2", "1")]));
    expect(virada.sentido).toBe("VOLTOU_AO_PRIMEIRO");
  });

  it("não inventa virada onde o ciclo não se moveu", () => {
    expect(viradasDeCiclo(linhasDeLucroFixo([alteracao()]))).toEqual([]);
    expect(viradasDeCiclo(linhasDeLucroFixo([doCiclo("2", "2")]))).toEqual([]);
  });

  it("ignora um ciclo que a fonte não entregou legível, em vez de chutar", () => {
    expect(viradasDeCiclo(linhasDeLucroFixo([doCiclo("1", "")]))).toEqual([]);
  });

  it("ordena pelo dinheiro que entrou, do maior para o menor", () => {
    const linhas = linhasDeLucroFixo([
      doCiclo("1", "2", { entityLabel: "A" }),
      alteracao({ entityLabel: "A", impactAmount: "500", deltaAbsolute: "500" }),
      doCiclo("1", "2", { entityLabel: "B" }),
      alteracao({ entityLabel: "B", impactAmount: "9000", deltaAbsolute: "9000" }),
    ]);
    expect(viradasDeCiclo(linhas).map((v) => v.entityLabel)).toEqual(["B", "A"]);
  });
});

describe("a coexistência, que o acervo diz não existir", () => {
  const valor = (over: Partial<ValorDeLucroFixo> = {}): ValorDeLucroFixo => ({
    ponta: "COMPARADA",
    entityType: "CAVALO",
    entityLabel: "RZM0B31",
    lucroFixo: 3318.01,
    amortizacao: 0,
    ciclo: 2,
    ...over,
  });

  it("não acha nada no acervo que se comporta como o medido", () => {
    expect(coexistencias([valor(), valor({ lucroFixo: 0, amortizacao: 3100, ciclo: 1 })])).toEqual(
      [],
    );
  });

  it("acha o ativo que declara os dois ao mesmo tempo", () => {
    const [achado] = coexistencias([valor({ amortizacao: 3100 })]);
    expect(achado.entityLabel).toBe("RZM0B31");
    expect(achado.lucroFixo).toBe(3318.01);
    expect(achado.amortizacao).toBe(3100);
  });

  it("olha a vigência que se está auditando, não a que já foi", () => {
    expect(coexistencias([valor({ ponta: "BASE", amortizacao: 3100 })])).toEqual([]);
  });

  it("ausência não é coexistência", () => {
    expect(coexistencias([valor({ amortizacao: null })])).toEqual([]);
    expect(coexistencias([valor({ lucroFixo: null, amortizacao: 3100 })])).toEqual([]);
  });
});

describe("os indicadores", () => {
  const frota = { comparados: 62, novos: 0, ausentes: 0 };

  it("conta as viradas dos dois sentidos, separadas", () => {
    const linhas = linhasDeLucroFixo([
      doCiclo("1", "2", { entityLabel: "A" }),
      doCiclo("1", "2", { entityLabel: "B" }),
      doCiclo("2", "1", { entityLabel: "C" }),
    ]);
    const resumo = resumirLucroFixo(linhas, frota);
    expect(resumo.entraramNoSegundoCiclo).toBe(2);
    expect(resumo.voltaramAoPrimeiroCiclo).toBe(1);
  });

  it("conta como 'sem alteração' só o que nenhuma linha tocou", () => {
    const linhas = linhasDeLucroFixo([
      alteracao({ entityLabel: "A" }),
      alteracao({ entityLabel: "B", comparability: "INCONCLUSIVE", nature: "TYPE_CHANGED" }),
    ]);
    const resumo = resumirLucroFixo(linhas, frota);
    expect(resumo.veiculosComAlteracao).toBe(1);
    expect(resumo.veiculosComConflito).toBe(1);
    expect(resumo.semAlteracao).toBe(60);
  });

  it("não deriva a frota do tamanho da lista", () => {
    const resumo = resumirLucroFixo([], { comparados: 62, novos: 2, ausentes: 1 });
    expect(resumo.semAlteracao).toBe(62);
    expect(resumo.novosNaVigencia).toBe(2);
  });

  it("dá a cada veículo uma fatia só, pela gravidade", () => {
    const linhas = linhasDeLucroFixo([
      alteracao({ entityLabel: "A" }),
      doCiclo("1", "2", {
        entityLabel: "A",
        comparability: "INCONCLUSIVE",
        nature: "TYPE_CHANGED",
      }),
    ]);
    const fatias = distribuicaoPorEstadoDeLucroFixo(linhas, {
      comparados: 10,
      novos: 0,
      ausentes: 0,
    });
    expect(fatias.reduce((acc, f) => acc + f.veiculos, 0)).toBe(10);
    expect(fatias.find((f) => f.estado === "ALTERADO")).toBeUndefined();
  });

  it("ordena as variáveis pela quantidade de alterações", () => {
    const linhas = linhasDeLucroFixo([
      alteracao({ entityLabel: "A" }),
      alteracao({ entityLabel: "B" }),
      doCiclo("1", "2", { entityLabel: "C" }),
    ]);
    expect(alteracoesPorVariavelDeLucroFixo(linhas).map((b) => b.variavel)).toEqual([
      "lucro_fixo",
      "ciclo",
    ]);
  });
});

describe("os totais por vigência", () => {
  const valor = (over: Partial<ValorDeLucroFixo> = {}): ValorDeLucroFixo => ({
    ponta: "BASE",
    entityType: "CAVALO",
    entityLabel: "A",
    lucroFixo: 3318.01,
    amortizacao: 0,
    ciclo: 2,
    ...over,
  });

  it("soma quem não mudou, e diz quantos estão de fato no segundo ciclo", () => {
    const [total] = totaisDeLucroFixoPorVigencia([
      valor({ entityLabel: "A" }),
      valor({ entityLabel: "B", lucroFixo: 0, amortizacao: 3100, ciclo: 1 }),
    ]);
    expect(total.veiculos).toBe(2);
    expect(total.total).toBe(3318.01);
    expect(total.noSegundoCiclo).toBe(1);
  });

  it("não conta como ativo quem não trouxe a rubrica", () => {
    const [total] = totaisDeLucroFixoPorVigencia([valor(), valor({ lucroFixo: null })]);
    expect(total.veiculos).toBe(1);
  });
});

describe("o CSV", () => {
  it("leva o aviso do conjunto para dentro do arquivo", () => {
    const linha = linhaDeLucroFixoDaAlteracao(
      alteracao({
        attributeCode: "carreta.lucro_fixomodelo_novo_ciclo",
        entityType: "CARRETA",
      }),
    )!;
    const celulas = celulasDoCsvDeLucroFixo(linha);
    expect(celulas).toHaveLength(10);
    expect(String(celulas[9])).toContain("284 de 284");
  });

  it("não escreve R$ nem decide o separador — isso é do escritor do arquivo", () => {
    const celulas = celulasDoCsvDeLucroFixo(linhaDeLucroFixoDaAlteracao(alteracao())!);
    expect(celulas[5]).toBe(3318.01);
    expect(celulas[7]).toBe("Alterado");
  });
});

describe("o detalhe do catálogo", () => {
  it("não empresta ao cavalo a coluna que só a carreta declara", () => {
    const conjunto = VARIAVEIS_DE_DETALHE_DE_LUCRO_FIXO.find(
      (v) => v.chave === "lucro_fixo_conjunto",
    )!;
    expect(codigoDaVariavelDeLucroFixo(conjunto, "CAVALO")).toBeUndefined();
    expect(codigoDaVariavelDeLucroFixo(conjunto, "CARRETA")).toBe(
      "carreta.lucro_fixomodelo_novo_ciclo",
    );
  });
});
