import { describe, expect, it } from "vitest";
import {
  celulasDoCsvDeQlp,
  codigosDoQuadro,
  conferirAbono,
  conferirBenchmark,
  conferirConta,
  conferirLinha,
  CONTAS_ADMINISTRATIVO,
  CONTAS_OPERACIONAL,
  resumirQuadro,
  resumoDasContas,
  TIPO_DO_QUADRO,
  VARIAVEIS_ADMINISTRATIVO,
  VARIAVEIS_OPERACIONAL,
  variavelDoQuadroDoCodigo,
  type LinhaDoQuadro,
} from "../qlp";

/**
 * O que estes testes prendem.
 *
 * O módulo não compara vigências — isso é do motor, e o QLP Administrativo já
 * tem a aba que o usa. O que ele faz é conferir **as contas que o próprio quadro
 * declara**, dentro de uma vigência, e é isso que se prende aqui:
 *
 * 1. quantidade × valor = despesa, seis vezes, no administrativo;
 * 2. a cadeia dos subtotais, três degraus, no operacional;
 * 3. o benchmark como régua, e nunca como custo;
 * 4. o abono acordado contra o aplicado — a queda que ninguém negociou.
 *
 * Mais a regra que atravessa o produto: **ausência não vira zero**. Uma despesa
 * conferida contra uma quantidade que não veio acusaria de divergência uma linha
 * que só está incompleta.
 */

const ADM = (slug: string) => `qlp_administrativo.${slug}`;
const OPER = (slug: string) => `qlp_operacional.${slug}`;

/** Um cargo administrativo coerente: os seis trios fecham. */
const cargoAdm = (over: Record<string, number | null> = {}): LinhaDoQuadro => ({
  chave: "20618821000799AUXILIARADM",
  nome: "20.618.821/0007-99 · AUXILIAR ADM",
  valores: {
    [ADM("quantidade_ordenados")]: 3,
    [ADM("salario_ordenados")]: 2_400,
    [ADM("despesa_ordenados")]: 7_200,
    [ADM("quantidade_encargos")]: 3,
    [ADM("salario_encargos")]: 3_600,
    [ADM("despesa_encargos")]: 10_800,
    [ADM("quantidade_beneficio")]: 3,
    [ADM("valor_beneficio")]: 480,
    [ADM("despesa_beneficio")]: 1_440,
    [ADM("quantidade_frota_leve")]: 1,
    [ADM("valor_frota_leve")]: 2_100,
    [ADM("despesa_frota_leve")]: 2_100,
    [ADM("quantidade_telefonia")]: 3,
    [ADM("valor_telefonia")]: 60,
    [ADM("despesa_telefonia")]: 180,
    [ADM("quantidade_uniformes")]: 3,
    [ADM("valor_uniformes")]: 45,
    [ADM("despesa_uniformes")]: 135,
    [ADM("qlp_benchmark_quantidade")]: 3,
    [ADM("qlp_benchmark_salario")]: 2_400,
    [ADM("vale_transporte")]: 390,
    ...over,
  },
});

/** Um cargo operacional coerente: a cadeia dos subtotais fecha. */
const cargoOper = (over: Record<string, number | null> = {}): LinhaDoQuadro => ({
  chave: "20618821000799MOTORISTANOTURNO",
  nome: "20.618.821/0007-99 · MOTORISTA · NOTURNO",
  valores: {
    [OPER("piso_salarial")]: 2_800,
    [OPER("adicional_noturno")]: 560,
    [OPER("dsr_adicional_noturno")]: 93.33,
    [OPER("valor_abono")]: 200,
    [OPER("valor_abono_aplicado")]: 200,
    [OPER("salario_fixo")]: 3_653.33,
    [OPER("remuneracao_contra_cheque")]: 3_653.33,
    [OPER("total_encargo_provisao")]: 1_500,
    [OPER("remuneracao_fixa")]: 5_153.33,
    [OPER("total_beneficio_fixo")]: 900,
    [OPER("total_uniforme_epi")]: 80,
    [OPER("total")]: 6_133.33,
    [OPER("quantidade_por_caminhao")]: 1.4,
    [OPER("quantidade_totalx_caminhao_ativo")]: 42,
    ...over,
  },
});

describe("os dois quadros", () => {
  it("dá a cada quadro o tipo de entidade que a importação grava", () => {
    expect(TIPO_DO_QUADRO.ADMINISTRATIVO).toBe("QLP_ADMINISTRATIVO");
    expect(TIPO_DO_QUADRO.OPERACIONAL).toBe("QLP_OPERACIONAL");
  });

  it("pede só os códigos do próprio quadro, sem repetição", () => {
    const adm = codigosDoQuadro("ADMINISTRATIVO");
    const oper = codigosDoQuadro("OPERACIONAL");
    expect(adm.every((c) => c.startsWith("qlp_administrativo."))).toBe(true);
    expect(oper.every((c) => c.startsWith("qlp_operacional."))).toBe(true);
    expect(new Set(adm).size).toBe(adm.length);
  });

  it("separa quantidade, parâmetro unitário e montante — a distinção que decide tudo", () => {
    expect(variavelDoQuadroDoCodigo("ADMINISTRATIVO", ADM("quantidade_ordenados"))!.papel).toBe(
      "QUANTIDADE",
    );
    expect(variavelDoQuadroDoCodigo("ADMINISTRATIVO", ADM("salario_ordenados"))!.papel).toBe(
      "PARAMETRO",
    );
    expect(variavelDoQuadroDoCodigo("ADMINISTRATIVO", ADM("despesa_ordenados"))!.papel).toBe(
      "MONTANTE",
    );
  });

  it("trata o benchmark como régua, e não como custo", () => {
    for (const codigo of [ADM("qlp_benchmark_quantidade"), ADM("qlp_benchmark_salario")]) {
      expect(variavelDoQuadroDoCodigo("ADMINISTRATIVO", codigo)!.papel).toBe("BENCHMARK");
    }
  });

  it("tira o vale-transporte de toda soma, com a dúvida escrita", () => {
    const vt = variavelDoQuadroDoCodigo("ADMINISTRATIVO", ADM("vale_transporte"))!;
    expect(vt.foraDaSoma).toContain("despesa de benefício");
  });

  it("marca todos os subtotais do operacional como fora de soma", () => {
    const subtotais = VARIAVEIS_OPERACIONAL.filter((v) => v.papel === "SUBTOTAL");
    expect(subtotais.length).toBeGreaterThanOrEqual(6);
    for (const s of subtotais) expect(s.foraDaSoma).toBeTruthy();
  });

  it("recusa somar a coluna sem nome", () => {
    const outro = variavelDoQuadroDoCodigo("OPERACIONAL", OPER("outro"))!;
    expect(outro.foraDaSoma).toContain("sem rótulo");
  });

  it("cobre as seis rubricas do administrativo com um trio cada", () => {
    expect(CONTAS_ADMINISTRATIVO).toHaveLength(6);
    for (const c of CONTAS_ADMINISTRATIVO) {
      expect(c.forma).toBe("PRODUTO");
      expect(c.parcelas).toHaveLength(2);
      expect(VARIAVEIS_ADMINISTRATIVO.some((v) => v.codigo === c.resultado)).toBe(true);
    }
  });

  it("confere três degraus da cadeia, e não quatro", () => {
    /*
      O quarto degrau é `salarioFixo + parcelas de folha → remuneracaoContraCheque`,
      e "parcelas de folha" não nomeia colunas. Inventar quais são para fazer a
      conta fechar seria o oposto do que este produto faz.
    */
    expect(CONTAS_OPERACIONAL).toHaveLength(3);
    expect(CONTAS_OPERACIONAL.map((c) => c.chave)).toEqual([
      "salario_fixo",
      "remuneracao_fixa",
      "total",
    ]);
  });

  it("carrega a fonte de cada conta, e não só a conta", () => {
    for (const c of [...CONTAS_ADMINISTRATIVO, ...CONTAS_OPERACIONAL]) {
      expect(c.fonte.length).toBeGreaterThan(40);
    }
  });
});

describe("a conferência de uma conta", () => {
  const ordenados = CONTAS_ADMINISTRATIVO.find((c) => c.chave === "ordenados")!;

  it("multiplica quantidade por valor e compara com a despesa declarada", () => {
    const r = conferirConta(cargoAdm(), ordenados);
    expect(r.esperado).toBe(7_200);
    expect(r.declarado).toBe(7_200);
    expect(r.confere).toBe(true);
  });

  it("acusa a despesa montada sobre outra quantidade", () => {
    const r = conferirConta(cargoAdm({ [ADM("despesa_ordenados")]: 9_600 }), ordenados);
    expect(r.diferenca).toBe(2_400);
    expect(r.confere).toBe(false);
  });

  it("perdoa o arredondamento de centavos, que é meio por cento", () => {
    const r = conferirConta(cargoAdm({ [ADM("despesa_ordenados")]: 7_200.02 }), ordenados);
    expect(r.confere).toBe(true);
  });

  it("não lê parcela ausente como zero — falta base é outra resposta", () => {
    const r = conferirConta(cargoAdm({ [ADM("quantidade_ordenados")]: null }), ordenados);
    expect(r.esperado).toBeNull();
    expect(r.confere).toBeNull();
    expect(r.diferenca).toBeNull();
  });

  it("soma as parcelas da cadeia do operacional", () => {
    const salarioFixo = CONTAS_OPERACIONAL.find((c) => c.chave === "salario_fixo")!;
    const r = conferirConta(cargoOper(), salarioFixo);
    expect(r.esperado).toBe(3_653.33);
    expect(r.confere).toBe(true);
  });

  it("acusa o subtotal que esqueceu uma parcela", () => {
    const total = CONTAS_OPERACIONAL.find((c) => c.chave === "total")!;
    const r = conferirConta(cargoOper({ [OPER("total")]: 6_053.33 }), total);
    expect(r.diferenca).toBe(-80);
    expect(r.confere).toBe(false);
  });
});

describe("a conferência de uma linha", () => {
  it("diz que fecha quando todas as contas fecham", () => {
    const c = conferirLinha(cargoAdm(), "ADMINISTRATIVO");
    expect(c.conferem).toBe(6);
    expect(c.divergem).toBe(0);
    expect(c.veredito).toBe("CONFERE");
  });

  it("diverge quando uma só conta não fecha, e não vira incompleta", () => {
    const c = conferirLinha(
      cargoAdm({ [ADM("despesa_telefonia")]: 240, [ADM("quantidade_uniformes")]: null }),
      "ADMINISTRATIVO",
    );
    expect(c.divergem).toBe(1);
    expect(c.semBase).toBe(1);
    expect(c.veredito).toBe("DIVERGE");
  });

  it("chama de base insuficiente a linha em que nada pôde ser conferido", () => {
    const vazio: LinhaDoQuadro = { chave: "X", nome: null, valores: {} };
    expect(conferirLinha(vazio, "ADMINISTRATIVO").veredito).toBe("BASE_INSUFICIENTE");
  });

  it("guarda o nome legível ao lado da chave normalizada", () => {
    const c = conferirLinha(cargoAdm(), "ADMINISTRATIVO");
    expect(c.chave).toBe("20618821000799AUXILIARADM");
    expect(c.nome).toContain("AUXILIAR ADM");
  });
});

describe("o resumo das contas do quadro", () => {
  it("conta linhas por leitura, nunca num veredito único do quadro", () => {
    const resumo = resumoDasContas(
      [
        cargoAdm(),
        cargoAdm({ [ADM("despesa_ordenados")]: 9_600 }),
        cargoAdm({ [ADM("salario_ordenados")]: null }),
      ],
      "ADMINISTRATIVO",
    );
    const ordenados = resumo.find((r) => r.conta === "ordenados")!;
    expect(ordenados.linhas).toBe(3);
    expect(ordenados.conferem).toBe(1);
    expect(ordenados.divergem).toBe(1);
    expect(ordenados.semBase).toBe(1);
    expect(ordenados.maiorDiferenca).toBe(2_400);
  });

  it("soma as diferenças com sinal, e não em módulo", () => {
    const resumo = resumoDasContas(
      [
        cargoAdm({ [ADM("despesa_ordenados")]: 9_600 }),
        cargoAdm({ [ADM("despesa_ordenados")]: 4_800 }),
      ],
      "ADMINISTRATIVO",
    );
    expect(resumo.find((r) => r.conta === "ordenados")!.somaDasDiferencas).toBe(0);
  });
});

describe("o benchmark", () => {
  it("conta quem está acima, abaixo e igual à referência", () => {
    const b = conferirBenchmark([
      cargoAdm(),
      cargoAdm({ [ADM("quantidade_ordenados")]: 5 }),
      cargoAdm({ [ADM("quantidade_ordenados")]: 1 }),
    ]);
    expect(b.linhas).toBe(3);
    expect(b.iguais).toBe(1);
    expect(b.acimaDaReferencia).toBe(1);
    expect(b.abaixoDaReferencia).toBe(1);
    expect(b.posicoesDeDiferenca).toBe(0);
  });

  it("mede a distância do salário para o de referência, com sinal", () => {
    const b = conferirBenchmark([cargoAdm({ [ADM("salario_ordenados")]: 2_900 })]);
    expect(b.salarioAcima).toBe(1);
    expect(b.maiorDistanciaDeSalario).toBe(500);
  });

  it("ignora a linha sem referência declarada, em vez de contá-la como igual", () => {
    const b = conferirBenchmark([cargoAdm({ [ADM("qlp_benchmark_quantidade")]: null })]);
    expect(b.linhas).toBe(0);
  });
});

describe("o abono", () => {
  it("conta o que foi acordado e não aplicado", () => {
    const a = conferirAbono([
      cargoOper(),
      cargoOper({ [OPER("valor_abono_aplicado")]: 120 }),
      cargoOper({ [OPER("valor_abono_aplicado")]: 0 }),
    ]);
    expect(a.comAbono).toBe(3);
    expect(a.aplicadoMenor).toBe(2);
    expect(a.janelaEncerrada).toBe(1);
    expect(a.naoAplicado).toBe(280);
  });

  it("não conta o cargo que não tem abono acordado", () => {
    const a = conferirAbono([cargoOper({ [OPER("valor_abono")]: 0 })]);
    expect(a.comAbono).toBe(0);
  });
});

describe("os indicadores do topo", () => {
  it("separa cargos de efetivo — linhas não são pessoas", () => {
    const resumo = resumirQuadro([cargoAdm(), cargoAdm({ [ADM("quantidade_ordenados")]: 5 })], "ADMINISTRATIVO");
    expect(resumo.cargos).toBe(2);
    expect(resumo.efetivo).toBe(8);
  });

  it("devolve efetivo nulo, e não zero, quando o quadro não o traz", () => {
    const resumo = resumirQuadro(
      [cargoAdm({ [ADM("quantidade_ordenados")]: null })],
      "ADMINISTRATIVO",
    );
    expect(resumo.efetivo).toBeNull();
  });

  it("conta quantas colunas do catálogo ficam fora de toda soma", () => {
    expect(resumirQuadro([], "ADMINISTRATIVO").foraDaSoma).toBe(1);
    expect(resumirQuadro([], "OPERACIONAL").foraDaSoma).toBeGreaterThan(5);
  });
});

describe("o CSV", () => {
  it("escreve uma linha por conta, e não uma por cargo", () => {
    const linhas = celulasDoCsvDeQlp(conferirLinha(cargoAdm(), "ADMINISTRATIVO"));
    expect(linhas).toHaveLength(6);
    expect(linhas[0][0]).toContain("AUXILIAR ADM");
    expect(linhas[0][7]).toBe("Fecha");
  });

  it("diz a forma da conta por extenso", () => {
    const adm = celulasDoCsvDeQlp(conferirLinha(cargoAdm(), "ADMINISTRATIVO"));
    const oper = celulasDoCsvDeQlp(conferirLinha(cargoOper(), "OPERACIONAL"));
    expect(adm[0][3]).toBe("quantidade × valor");
    expect(oper[0][3]).toBe("soma das parcelas");
  });

  it("marca a conta sem base, em vez de escrever zero", () => {
    const linhas = celulasDoCsvDeQlp(
      conferirLinha(cargoAdm({ [ADM("quantidade_ordenados")]: null }), "ADMINISTRATIVO"),
    );
    expect(linhas[0][7]).toBe("Base insuficiente");
    expect(linhas[0][4]).toBeNull();
  });
});
