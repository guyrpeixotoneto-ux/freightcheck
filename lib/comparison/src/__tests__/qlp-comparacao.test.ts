import { describe, expect, it } from "vitest";
import {
  alteracoesPorVariavelDeQlp,
  cargosComparados,
  celulasDoCsvDeQlpComparado,
  codigosDaRubrica,
  distribuicaoPorEstadoDeQlp,
  estadoDoCargo,
  linhaDeQlpDaAlteracao,
  linhaDeQlpSemAlteracao,
  linhasDeQlpComparado,
  moduloDoQlp,
  modulosDoQlp,
  movimentoDoEfetivo,
  resumirComparacaoDeQlp,
  somarEfetivo,
  rubricasDoQuadro,
  type AlteracaoDoMotor,
} from "../qlp-comparacao";

/**
 * O que estes testes prendem.
 *
 * A comparação do QLP é o sétimo recorte do mesmo motor, e o que ele tem de
 * próprio é o que se protege aqui:
 *
 * 1. o grão é o **cargo**, e um cargo aparece numa fatia só — a mais grave;
 * 2. a única soma é a do **efetivo**, e ela conta entrada e saída de cargo;
 * 3. **não há soma de dinheiro**, e a frase que diz por quê viaja no resumo;
 * 4. a rubrica recorta por assunto, e o quadro que não a tem devolve lista
 *    vazia — que é o que a rota traduz em recusa escrita.
 */

const ADM = (slug: string) => `qlp_administrativo.${slug}`;
const OPER = (slug: string) => `qlp_operacional.${slug}`;
const CARGO = "07526557001505CARGOANALISTA";
const OUTRO = "07526557001505CARGOGERENTE";

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  id: 1,
  changeType: "VALUE_CHANGED",
  attributeCode: ADM("despesa_ordenados"),
  entityLabel: CARGO,
  entityType: "QLP_ADMINISTRATIVO",
  valueBefore: "4600",
  valueAfter: "5200",
  deltaAbsolute: 600,
  deltaPercent: 13.04,
  comparability: "COMPARABLE",
  ...over,
});

describe("a tradução de uma alteração", () => {
  it("traz o papel e a rubrica da variável, que é o que separa quantidade de dinheiro", () => {
    const linha = linhaDeQlpDaAlteracao(alteracao(), "ADMINISTRATIVO")!;
    expect(linha.variavel).toBe("despesa_ordenados");
    expect(linha.papel).toBe("MONTANTE");
    expect(linha.rubrica).toBe("salario");
    expect(linha.medida).toBe("DINHEIRO");
    expect(linha.estado).toBe("ALTERADO");
    expect(linha.diferenca).toBe(600);
  });

  it("recusa a alteração de outro quadro — o operacional não entra na leitura do administrativo", () => {
    const doOperacional = alteracao({
      entityType: "QLP_OPERACIONAL",
      attributeCode: OPER("piso_salarial"),
    });
    expect(linhaDeQlpDaAlteracao(doOperacional, "ADMINISTRATIVO")).toBeNull();
    expect(linhaDeQlpDaAlteracao(doOperacional, "OPERACIONAL")).not.toBeNull();
  });

  it("recusa a coluna que o catálogo do quadro não conhece", () => {
    expect(
      linhaDeQlpDaAlteracao(alteracao({ attributeCode: ADM("id") }), "ADMINISTRATIVO"),
    ).toBeNull();
  });

  /*
    Entrada e saída de cargo não citam atributo: o motor as grava uma vez por
    entidade. Sumir com elas esconderia a metade mais visível do que muda num
    quadro de pessoal — quem entrou e quem saiu.
  */
  it("guarda a entrada e a saída de cargo como a linha do cargo inteiro", () => {
    const entrou = linhaDeQlpDaAlteracao(
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null }),
      "ADMINISTRATIVO",
    )!;
    expect(entrou.variavel).toBe("cargo");
    expect(entrou.estado).toBe("NOVO_NA_VIGENCIA");
    expect(entrou.papel).toBe("CONTEXTO");
  });

  it("marca o subtotal como fora da soma, com o aviso do dicionário junto", () => {
    const subtotal = linhaDeQlpDaAlteracao(
      alteracao({
        entityType: "QLP_OPERACIONAL",
        attributeCode: OPER("total_beneficio_fixo"),
      }),
      "OPERACIONAL",
    )!;
    expect(subtotal.papel).toBe("SUBTOTAL");
    expect(subtotal.foraDaSoma).toContain("Subtotal");
  });

  it("monta a linha sem alteração com os dois lados iguais e sem id do motor", () => {
    const igual = linhaDeQlpSemAlteracao({
      entityLabel: CARGO,
      quadro: "ADMINISTRATIVO",
      attributeCode: ADM("salario_ordenados"),
      valor: "4600",
    })!;
    expect(igual.id).toBeNull();
    expect(igual.base).toBe("4600");
    expect(igual.comparada).toBe("4600");
    expect(igual.estado).toBe("SEM_ALTERACAO");
  });
});

describe("o cargo, e não a linha", () => {
  it("dá ao cargo o estado mais grave entre os das variáveis dele", () => {
    const linhas = linhasDeQlpComparado(
      [
        alteracao(),
        alteracao({ id: 2, comparability: "INCONCLUSIVE", nature: "TYPE_CHANGED" }),
      ],
      "ADMINISTRATIVO",
    );
    expect(estadoDoCargo(linhas)).toBe("CONFLITO");
  });

  it("agrupa as variáveis por cargo e conta as alteradas de cada um", () => {
    const linhas = linhasDeQlpComparado(
      [
        alteracao(),
        alteracao({ id: 2, attributeCode: ADM("salario_ordenados") }),
        alteracao({ id: 3, entityLabel: OUTRO }),
      ],
      "ADMINISTRATIVO",
    );
    const cargos = cargosComparados(linhas);
    expect(cargos).toHaveLength(2);
    expect(cargos[0].variaveisAlteradas).toBe(2);
    expect(cargos[1].variaveisAlteradas).toBe(1);
  });

  /*
    A soma das fatias não pode passar do total de cargos, e os "sem alteração"
    não saem da lista: o `change_set` não guarda o que não mudou.
  */
  it("põe cada cargo numa fatia só, e tira os sem alteração da contagem do acervo", () => {
    const linhas = linhasDeQlpComparado(
      [alteracao(), alteracao({ id: 2, entityLabel: OUTRO })],
      "ADMINISTRATIVO",
    );
    const fatias = distribuicaoPorEstadoDeQlp(linhas, {
      comparados: 41,
      novos: 0,
      ausentes: 0,
    });
    const soma = fatias.reduce((total, f) => total + f.cargos, 0);
    expect(soma).toBe(41);
    expect(fatias.find((f) => f.estado === "ALTERADO")!.cargos).toBe(2);
    expect(fatias.find((f) => f.estado === "SEM_ALTERACAO")!.cargos).toBe(39);
  });
});

describe("o efetivo — a única soma desta tela", () => {
  const efetivo = (over: Partial<AlteracaoDoMotor>) =>
    alteracao({ attributeCode: ADM("quantidade_ordenados"), ...over });

  it("tira a diferença dos totais das duas pontas, e conta os cargos pela lista", () => {
    const linhas = linhasDeQlpComparado(
      [
        efetivo({ valueBefore: "3", valueAfter: "5" }),
        efetivo({ id: 2, entityLabel: OUTRO, valueBefore: "4", valueAfter: "3" }),
      ],
      "ADMINISTRATIVO",
    );
    const movimento = movimentoDoEfetivo(linhas, "ADMINISTRATIVO", {
      base: 44,
      comparada: 45,
    });
    expect(movimento.diferenca).toBe(1);
    expect(movimento.cargosQueSubiram).toBe(1);
    expect(movimento.cargosQueDesceram).toBe(1);
  });

  /*
    O cargo que sai do quadro é **uma linha só** no motor — a entidade removida,
    sem atributo —, então o efetivo dele não aparece em alteração nenhuma.
    Derivada da lista, a diferença seria −1 num quadro que perdeu cinco
    posições. É por isso que ela vem dos totais.
  */
  it("enxerga a saída de um cargo inteiro, que não produz linha de quantidade", () => {
    const linhas = linhasDeQlpComparado(
      [efetivo({ valueBefore: "3", valueAfter: "2" })],
      "ADMINISTRATIVO",
    );
    const movimento = movimentoDoEfetivo(linhas, "ADMINISTRATIVO", {
      base: 8,
      comparada: 3,
    });
    expect(movimento.diferenca).toBe(-5);
    expect(movimento.cargosQueDesceram).toBe(1);
  });

  it("não lê o conflito como zero — ele é contado à parte", () => {
    const linhas = linhasDeQlpComparado(
      [
        efetivo({
          comparability: "INCONCLUSIVE",
          nature: "TYPE_CHANGED",
          valueBefore: "3",
          valueAfter: "5",
        }),
      ],
      "ADMINISTRATIVO",
    );
    const movimento = movimentoDoEfetivo(linhas, "ADMINISTRATIVO", {
      base: 44,
      comparada: 44,
    });
    expect(movimento.diferenca).toBe(0);
    expect(movimento.semLeitura).toBe(1);
    expect(movimento.cargosQueSubiram).toBe(0);
  });

  /* Ponta não lida é nula, e nulo não é zero: um quadro sem a coluna do
     efetivo não é um quadro sem gente. */
  it("devolve nulo quando uma das pontas não trouxe o efetivo", () => {
    expect(
      movimentoDoEfetivo([], "ADMINISTRATIVO", { base: 44, comparada: null }).diferenca,
    ).toBeNull();
  });

  it("soma o efetivo de uma vigência ignorando a célula vazia", () => {
    expect(somarEfetivo(["3", null, "1", ""])).toBe(4);
    expect(somarEfetivo([null, ""])).toBeNull();
  });
});

describe("os agregados da tela", () => {
  const linhas = linhasDeQlpComparado(
    [
      alteracao(),
      alteracao({ id: 2, attributeCode: ADM("quantidade_ordenados"), valueBefore: "3", valueAfter: "4" }),
      alteracao({ id: 3, entityLabel: OUTRO, attributeCode: ADM("vale_transporte") }),
    ],
    "ADMINISTRATIVO",
  );
  const resumo = resumirComparacaoDeQlp(
    linhas,
    "ADMINISTRATIVO",
    { comparados: 41, novos: 2, ausentes: 1 },
    { base: 44, comparada: 45 },
  );

  it("conta cargos e variáveis sem nunca somar dinheiro", () => {
    expect(resumo.cargosComparados).toBe(41);
    expect(resumo.cargosComAlteracao).toBe(2);
    expect(resumo.variaveisAlteradas).toBe(3);
    expect(resumo.novosNaVigencia).toBe(2);
    expect(resumo.ausentesNaComparada).toBe(1);
    expect(resumo.efetivo.diferenca).toBe(1);
    expect(resumo).not.toHaveProperty("impacto");
  });

  /*
    A frase do travamento viaja com o resumo, e não é escrita na tela: ela é a
    resposta ao cartão que as outras seis auditorias mostram em reais, e duas
    versões dela divergiriam no dia em que a curadoria confirmasse a primeira
    coluna.
  */
  it("carrega por escrito o motivo de não haver impacto em reais", () => {
    expect(resumo.semImpactoFinanceiro).toContain("curadoria");
    expect(resumo.semImpactoFinanceiro).toContain("efetivo");
  });

  it("separa quantas alterações são de coluna que não entra em soma", () => {
    expect(resumo.alteracoesForaDaSoma).toBe(1);
  });

  it("lista todas as variáveis do quadro, inclusive as que não mudaram", () => {
    const porVariavel = alteracoesPorVariavelDeQlp(linhas, "ADMINISTRATIVO");
    expect(porVariavel.length).toBeGreaterThanOrEqual(21);
    expect(porVariavel[0].alteracoes).toBe(1);
    expect(porVariavel.some((v) => v.alteracoes === 0)).toBe(true);
  });
});

describe("a rubrica — o recorte por assunto", () => {
  it("lista as rubricas de cada quadro, na ordem do catálogo", () => {
    expect(rubricasDoQuadro("ADMINISTRATIVO")).toContain("transporte");
    expect(rubricasDoQuadro("OPERACIONAL")).toContain("refeicao");
  });

  /*
    O vale-transporte se chama igual nos dois quadros de propósito: é a mesma
    pergunta, e um recorte por assunto que mudasse de nome conforme o quadro
    obrigaria quem lê a traduzir entre os dois.
  */
  it("dá o mesmo nome à mesma pergunta nos dois quadros", () => {
    expect(codigosDaRubrica("ADMINISTRATIVO", "transporte")).toEqual([
      ADM("vale_transporte"),
    ]);
    expect(codigosDaRubrica("OPERACIONAL", "transporte")).toEqual([
      OPER("vale_transporte_liquido"),
    ]);
  });

  /*
    E separa o que o operacional decompõe: saúde, refeição e transporte são três
    perguntas, e as nove parcelas numa rubrica só faziam quem procura o
    vale-transporte passar pelas outras oito.
  */
  it("separa as parcelas de benefício por assunto, sem mexer na conta que as soma", () => {
    expect(codigosDaRubrica("OPERACIONAL", "saude")).toEqual([
      OPER("assistencia_medica"),
      OPER("pcmso_por_mes"),
    ]);
    expect(codigosDaRubrica("OPERACIONAL", "refeicao")).toHaveLength(3);
    expect(codigosDaRubrica("OPERACIONAL", "outros_beneficios")).toEqual([
      OPER("diaria"),
      OPER("plr"),
    ]);
  });

  /*
    O administrativo traz benefício numa coluna só; o operacional decompõe em
    nove. Pedir "benefícios" no administrativo é uma pergunta sem resposta, e a
    lista vazia é o que deixa a rota recusá-la por escrito em vez de devolver
    uma tela vazia que parece "nada mudou".
  */
  it("devolve vazio para a rubrica que o quadro não tem", () => {
    expect(codigosDaRubrica("OPERACIONAL", "saude").length).toBeGreaterThan(0);
    expect(codigosDaRubrica("ADMINISTRATIVO", "saude")).toEqual([]);
  });

  /*
    O salário é o mesmo módulo nos dois quadros, com colunas diferentes: o trio
    de ordenados no administrativo, o piso e os adicionais no operacional. A
    **conta** administrativa continua se chamando "Ordenados", que é como o
    dicionário a declara — o que se unificou foi a rubrica, que é o eixo da
    leitura por assunto.
  */
  it("recorta o salário pelas colunas de cada quadro, sob o mesmo nome", () => {
    expect(codigosDaRubrica("ADMINISTRATIVO", "salario")).toEqual([
      ADM("quantidade_ordenados"),
      ADM("salario_ordenados"),
      ADM("despesa_ordenados"),
    ]);
    expect(codigosDaRubrica("OPERACIONAL", "salario")).toContain(OPER("piso_salarial"));
  });

  /*
    Os módulos saem do catálogo, e é isso que os mantém verdadeiros.

    Uma lista escrita à mão concordaria com o catálogo no dia em que fosse
    escrita. Derivada, a seção acende a aba sozinha no dia em que a coluna
    entrar — e, hoje, diz a verdade sobre o que falta: o administrativo traz
    benefício numa coluna só e o operacional o decompõe em nove.
  */
  it("deriva os módulos do catálogo, com os quadros em que cada um existe", () => {
    const porChave = new Map(modulosDoQlp().map((m) => [m.chave, m.quadros]));

    expect(porChave.get("salario")).toEqual(["ADMINISTRATIVO", "OPERACIONAL"]);
    expect(porChave.get("transporte")).toEqual(["ADMINISTRATIVO", "OPERACIONAL"]);
    expect(porChave.get("saude")).toEqual(["OPERACIONAL"]);
    expect(porChave.get("refeicao")).toEqual(["OPERACIONAL"]);
    expect(porChave.get("beneficio")).toEqual(["ADMINISTRATIVO"]);

    /* Subtotal e benchmark não são assunto: são eixo de leitura. */
    expect(porChave.has("subtotais")).toBe(false);
    expect(porChave.has("benchmark")).toBe(false);

    expect(moduloDoQlp("saude")!.quadros).toEqual(["OPERACIONAL"]);
    expect(moduloDoQlp("nao_existe")).toBeUndefined();
  });

  /*
    O vale-transporte do administrativo está **fora de toda soma** enquanto a
    Ambev não disser se ele já está dentro da despesa de benefício — e isso é
    uma regra sobre somar, não sobre comparar. Gatilhar o módulo em `foraDaSoma`
    apagaria do menu justamente a coluna sobre a qual há pergunta aberta.
  */
  it("mantém como módulo a coluna que não soma, porque comparar não é somar", () => {
    const vt = codigosDaRubrica("ADMINISTRATIVO", "transporte");
    expect(vt).toEqual([ADM("vale_transporte")]);
    expect(modulosDoQlp().some((m) => m.chave === "transporte")).toBe(true);
  });
});

describe("a exportação", () => {
  it("escreve o cargo legível e o estado por extenso, com os números crus", () => {
    const linha = linhaDeQlpDaAlteracao(alteracao(), "ADMINISTRATIVO")!;
    const celulas = celulasDoCsvDeQlpComparado(
      linha,
      { unidade: "07.526.557/0015-05", cargo: "ANALISTA", classificacao: null },
      "Alterado",
    );
    expect(celulas[0]).toBe("07.526.557/0015-05");
    expect(celulas[1]).toBe("ANALISTA");
    expect(celulas[2]).toBeNull();
    expect(celulas[4]).toBe("Despesa de ordenados");
    expect(celulas[9]).toBe(600);
    expect(celulas[11]).toBe("Alterado");
  });

  /*
    O aviso da coluna que não soma e a justificativa saem no arquivo pelo mesmo
    motivo: o CSV vira soma na planilha de outra pessoa, e um subtotal exportado
    sem dizer que embute as parcelas é um convite a dobrar a folha fora daqui.
  */
  it("leva o aviso de fora da soma e a justificativa junto", () => {
    const subtotal = linhaDeQlpDaAlteracao(
      alteracao({
        entityType: "QLP_OPERACIONAL",
        attributeCode: OPER("total_beneficio_fixo"),
      }),
      "OPERACIONAL",
    )!;
    const celulas = celulasDoCsvDeQlpComparado(
      subtotal,
      { unidade: "CAMAÇARI", cargo: "MOTORISTA 28", classificacao: "CARREGAMENTO" },
      "Alterado",
      "Reajuste da convenção coletiva.",
    );
    /* A classificação tem coluna própria: é por ela que a planilha filtra. */
    expect(celulas[2]).toBe("CARREGAMENTO");
    expect(String(celulas[13])).toContain("Subtotal");
    expect(celulas[14]).toBe("Reajuste da convenção coletiva.");
  });
});
