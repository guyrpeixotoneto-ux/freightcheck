import { describe, expect, it } from "vitest";

import {
  diferencaDoTotalGeral,
  montarFaturado,
  ONDE_INFORMAR_AS_NOTAS,
} from "../faturado";
import {
  quadroDaEquipeDeEntrega,
  QUADROS_DO_TOTAL_GERAL,
  type ParametrosDoCadastro,
} from "../mapa-rota";

/** Os parâmetros reais da 2ª quinzena de julho/2026 — só o fator importa aqui. */
const PARAMETROS: ParametrosDoCadastro = {
  aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
  parcelaDentroDoMunicipio: 0.0238,
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
};

/**
 * O LADO DA TRANSPORTADORA, preso pelos números do fechamento real.
 *
 * Os valores daqui saíram da `Fechamento_Remuneracao.xlsb` de julho/2026 — CDD
 * Belém · Horizonte, lidos célula a célula da aba `Abertura` e somados do
 * 03.08.15 colado na própria pasta. Não são fixtures inventadas: são o gabarito.
 * Se a decomposição que `faturado.ts` propõe estiver errada, é aqui que ela cai.
 */

/* Da aba `Abertura` e da soma do 03.08.15, quinzena a quinzena. */
const JULHO_2026 = {
  primeira: {
    cte: 1_070_302.35,
    notasFiscais: 27_746.19,
    /* F32 (NF-e sem CT-e) = 0,00 e F41 (saldo complementar) = −13.460,02 */
    ajustes: -13_460.02,
    /* Abertura!F45 */
    publicado: 1_084_580.45,
    /* Resumo Geral!AI36 */
    totalGeralUnidade: 1_081_504.98,
    /* Resumo Geral!AI40 */
    diferencaPublicada: 3_075.47,
    /* `Total Remuneração` da Rota no 03.08.20 real da 1ª quinzena. */
    demonstrativo: 1_084_580.45,
  },
  segunda: {
    cte: 1_346_131.65,
    notasFiscais: 26_839.98,
    /* N32 (NF-e sem CT-e) = 109,52 e N41 (saldo complementar) = −17.398,54 */
    ajustes: -17_398.54 + 109.52,
    /* Abertura!N45 */
    publicado: 1_355_682.61,
    /* Resumo Geral!AJ36 */
    totalGeralUnidade: 1_350_112.83,
    /* Resumo Geral!AJ40 */
    diferencaPublicada: 5_569.78,
  },
} as const;

describe("montarFaturado", () => {
  it("o total canônico é o do 03.08.20, e ele bate com Abertura!F45 ao centavo", () => {
    /*
      A afirmação central do módulo, e a que derruba a leitura antiga de que o
      número "só existe na planilha". `Total Remuneração` do 03.08.20 da Rota na
      1ª quinzena e `Abertura!F45` são o mesmo número.
    */
    const f = montarFaturado({
      canal: "ROTA",
      quinzena: 1,
      totalDoDemonstrativo: JULHO_2026.primeira.demonstrativo,
      cte: null,
      notasFiscais: null,
      ajustesDaConciliacao: null,
    });

    expect(f.total).toBeCloseTo(JULHO_2026.primeira.publicado, 2);
  });

  it("o total existe mesmo sem a conferência — a série 748 não o bloqueia", () => {
    const f = montarFaturado({
      canal: "ROTA",
      quinzena: 1,
      totalDoDemonstrativo: JULHO_2026.primeira.demonstrativo,
      cte: JULHO_2026.primeira.cte,
      notasFiscais: null,
      ajustesDaConciliacao: JULHO_2026.primeira.ajustes,
    });

    expect(f.total).toBeCloseTo(JULHO_2026.primeira.publicado, 2);
    /* A decomposição é que fica em aberto, e ela diz o que falta. */
    expect(f.somaDasPartes).toBeNull();
    expect(f.residuo).toBeNull();
    expect(f.faltamNaConferencia).toEqual(["Notas fiscais de serviço (série 748)"]);
  });

  it("a conferência da 2ª quinzena fecha ao centavo contra Abertura!N45", () => {
    const f = montarFaturado({
      canal: "ROTA",
      quinzena: 2,
      /* Sem 03.08.20 da 2ª quinzena no repositório — ver o gate ponta a ponta. */
      totalDoDemonstrativo: JULHO_2026.segunda.publicado,
      cte: JULHO_2026.segunda.cte,
      notasFiscais: JULHO_2026.segunda.notasFiscais,
      ajustesDaConciliacao: JULHO_2026.segunda.ajustes,
    });

    expect(f.somaDasPartes).toBeCloseTo(JULHO_2026.segunda.publicado, 2);
    expect(f.residuo).toBeCloseTo(0, 2);
    expect(f.faltamNaConferencia).toEqual([]);
  });

  it("na 1ª quinzena a conferência sobra R$ 8,07, e a sobra não é absorvida", () => {
    const f = montarFaturado({
      canal: "ROTA",
      quinzena: 1,
      totalDoDemonstrativo: JULHO_2026.primeira.demonstrativo,
      cte: JULHO_2026.primeira.cte,
      notasFiscais: JULHO_2026.primeira.notasFiscais,
      ajustesDaConciliacao: JULHO_2026.primeira.ajustes,
    });

    /*
      A sobra é um CT-e de VBZ 05 emitido no dia 1º que a `Abertura` não conta —
      o primeiro dia da quinzena recebe documento do fechamento anterior. O
      teste prende o tamanho dela: se um dia ela mudar, é porque a regra de
      corte por data mudou, e isso tem de aparecer aqui.

      O sinal é o do resíduo (`total − soma`): a conferência soma **mais** que o
      publicado, então o resíduo é negativo.
    */
    expect(f.residuo).toBeCloseTo(-8.07, 2);
    /* E o total não se moveu: a conferência não é fonte. */
    expect(f.total).toBeCloseTo(JULHO_2026.primeira.publicado, 2);
  });

  it("a parcela sem fonte diz onde o dado deve ser informado", () => {
    const f = montarFaturado({
      canal: "ROTA",
      quinzena: 1,
      totalDoDemonstrativo: 1,
      cte: 1,
      notasFiscais: null,
      ajustesDaConciliacao: 0,
    });
    const nf = f.partes.find((p) => p.chave === "notas_fiscais_748")!;

    expect(nf.fonte.tipo).toBe("SEM_FONTE");
    if (nf.fonte.tipo !== "SEM_FONTE") throw new Error("a fonte mudou de forma");
    expect(nf.fonte.ondeInformar).toBe(ONDE_INFORMAR_AS_NOTAS);
    expect(nf.fonte.ondeInformar).not.toHaveLength(0);
  });

  it("as duas parcelas com relatório nomeiam o relatório", () => {
    const f = montarFaturado({
      canal: "ROTA",
      quinzena: 1,
      totalDoDemonstrativo: 1,
      cte: 1,
      notasFiscais: 1,
      ajustesDaConciliacao: 1,
    });
    const relatorios = f.partes
      .filter((p) => p.fonte.tipo === "RELATORIO")
      .map((p) => (p.fonte.tipo === "RELATORIO" ? p.fonte.relatorio : ""));

    expect(relatorios).toEqual(["03.08.15", "03.02.59.02"]);
  });
});

describe("diferencaDoTotalGeral", () => {
  it("reproduz a DIFERENÇA - TOTAL GERAL das duas quinzenas", () => {
    for (const q of [JULHO_2026.primeira, JULHO_2026.segunda]) {
      /*
        Parte do número publicado da transportadora, e não do que a decomposição
        soma: o que se está conferindo aqui é a fórmula da diferença
        (`AI40 = AI38 − AI36`), e não a decomposição — que tem teste próprio
        acima, com a sobra de R$ 8,07 medida.
      */
      expect(diferencaDoTotalGeral(q.publicado, q.totalGeralUnidade)).toBeCloseTo(
        q.diferencaPublicada,
        2,
      );
    }
  });

  it("é nula enquanto um dos dois lados faltar", () => {
    expect(diferencaDoTotalGeral(null, 1_081_504.98)).toBeNull();
    expect(diferencaDoTotalGeral(1_084_580.45, null)).toBeNull();
  });
});

describe("o quarto quadro", () => {
  /*
    Sem o 03.08.12.09 o quadro continua reservado — e `null`, não zero: não há
    como afirmar nem que a equipe rendeu nada nem que ela rendeu zero.
  */
  it("sem o 03.08.12.09 fica reservado, e o total é ausência e não zero", () => {
    const q = quadroDaEquipeDeEntrega(null, PARAMETROS);

    expect(q.quadro).toBe("EQUIPE_DE_ENTREGA");
    expect(q.linhas).toEqual([]);
    expect(q.total).toBeNull();
    expect(q.reservado).toContain("AI34");
  });

  it("com a VBZ 06 aprovada, ganha linha e o total é a parcela brutada", () => {
    const q = quadroDaEquipeDeEntrega(
      { fonte: "REQUISICOES", medida: { valor: 182035.14, aprovadas: 4, recebidas: 15 } },
      PARAMETROS,
    );

    expect(q.reservado).toBeNull();
    expect(q.linhas).toHaveLength(1);
    expect(q.linhas[0]!.chave).toBe("equipe_de_entrega");
    /*
      182.035,14 × 1,3669605 — o mesmo fator das demais linhas da quinzena, com
      a precisão que ele tem. Arredondá-lo para as seis casas que a planilha
      exibe daria 248.834,75, e a diferença de nove centavos é do arredondamento
      do fator, não da conta.
    */
    expect(q.total).toBeCloseTo(248834.84, 2);
    expect(q.linhas[0]!.memoria).toContain("4 de 15 requisições");
    expect(q.linhas[0]!.memoria).toContain("VBZ 06");
  });

  /*
    A prova de que separar a VBZ 06 é **reagrupamento e não mudança de
    dinheiro**. O 03.08.20 e a planilha lançam a equipe dentro de outros custos:
    262.282,80 = 74.247,66 + 6.000,00 + 182.035,14, e `Outros Custos!G4` bruta
    esse total inteiro (358.530,22). Separando, os dois quadros somados têm de
    dar exatamente o mesmo número — se não derem, alguém está contando duas
    vezes ou perdendo dinheiro no meio.
  */
  it("equipe + outros custos reproduz a linha única da planilha, ao centavo", () => {
    const equipe = quadroDaEquipeDeEntrega(
      { fonte: "REQUISICOES", medida: { valor: 182035.14, aprovadas: 4, recebidas: 15 } },
      PARAMETROS,
    );
    const outros = quadroDaEquipeDeEntrega(
      { fonte: "REQUISICOES", medida: { valor: 80247.66, aprovadas: 11, recebidas: 15 } },
      PARAMETROS,
    );
    const juntos = quadroDaEquipeDeEntrega(
      { fonte: "REQUISICOES", medida: { valor: 262282.8, aprovadas: 15, recebidas: 15 } },
      PARAMETROS,
    );

    expect(equipe.total! + outros.total!).toBeCloseTo(juntos.total!, 2);
    /* E o número da planilha, `Resumo Geral!AJ29`. */
    expect(juntos.total).toBeCloseTo(358530.22, 2);
    expect(equipe.total! + outros.total!).toBeCloseTo(358530.22, 2);
  });

  it("relatório sem nenhuma requisição da VBZ 06 vale zero **medido**", () => {
    const q = quadroDaEquipeDeEntrega(
      { fonte: "REQUISICOES", medida: { valor: 0, aprovadas: 0, recebidas: 11 } },
      PARAMETROS,
    );
    expect(q.total).toBe(0);
    expect(q.linhas[0]!.memoria).toContain("zero medido");
  });

  it("participa do total geral, como a planilha o soma — e o variável não", () => {
    expect(QUADROS_DO_TOTAL_GERAL).toEqual([
      "REMUNERACAO",
      "OUTROS_CUSTOS",
      "EQUIPE_DE_ENTREGA",
    ]);
    /*
      O variável fora da soma é a afirmação que impede o erro caro: ele abre por
      dentro o `TOTAL REMUNERAÇÃO ROTA DVS`, que já está no primeiro quadro.
    */
    expect(QUADROS_DO_TOTAL_GERAL).not.toContain("VARIAVEL");
  });
});
