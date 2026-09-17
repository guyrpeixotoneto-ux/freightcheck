import { describe, expect, it } from "vitest";
import { impactoPorPeriodicidade, linhasDeFiname } from "../finame";
import { linhasDeAluguel } from "../aluguel";
import { impactoDeIpva, linhasDeIpva } from "../ipva";
import { impactoDeImpostos, linhasDeImpostos } from "../impostos";
import { impactoDeLucroFixo, linhasDeLucroFixo } from "../lucro-fixo";
import {
  MODULOS_DO_MONITOR,
  NATUREZA_DO_MODULO,
  ROTA_DO_MODULO,
  SITUACOES_DO_IMPACTO,
  consolidar,
  impactoDoModulo,
  normalizarLinhas,
  resumirModulo,
  type LinhaDeRubrica,
  type ModuloDoMonitor,
  type ParDoMonitor,
} from "../monitor-custo-fixo";
import type { AlteracaoDoMotor } from "../recorte-de-rubrica";

/**
 * O que estes testes prendem.
 *
 * O Monitor não calcula dinheiro: ele compõe o que os quatro módulos
 * publicaram. Um teste que só verificasse os números do Monitor contra si mesmo
 * não provaria nada — provaria que ele é consistente com a própria aritmética.
 *
 * Então o que se prende aqui é a **reconciliação**: para as mesmas linhas, o que
 * o Monitor mostra tem de ser, campo a campo, o que a função de impacto do
 * módulo devolve. E as invariantes que uma tela financeira não pode perder: a
 * identidade dos baldes, periodicidades que não se somam, custo que não se soma
 * com receita, ausência que não vira zero.
 *
 * Sem banco, como os quatro recortes: alterações do motor construídas à mão.
 */

const PAR: ParDoMonitor = {
  baseId: "a1",
  comparadaId: "b2",
  baseRotulo: "EMPURRADA_1_08_2026",
  comparadaRotulo: "EMPURRADA_2_08_2026",
  baseData: "2026-08-01",
  comparadaData: "2026-08-16",
};

function alteracao(over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor {
  return {
    id: 1,
    changeType: "VALUE_CHANGED",
    attributeCode: "cavalo.finame_cavalo",
    entityLabel: "ABC1D23",
    entityType: "CAVALO",
    valueBefore: "8450",
    valueAfter: "8760",
    deltaAbsolute: "310",
    deltaPercent: "3.668639",
    comparability: "COMPARABLE",
    impactConfidence: "CALCULATED",
    impactAmount: "310",
    impactPeriodicity: "MENSAL",
    ...over,
  };
}

/** As cinco leituras de rubrica, cada uma com a fábrica de linha dela. */
const LINHAS_DO_MODULO: Record<
  ModuloDoMonitor,
  (a: readonly AlteracaoDoMotor[]) => LinhaDeRubrica[]
> = {
  FINAME: (a) => linhasDeFiname(a),
  ALUGUEL: (a) => linhasDeAluguel(a),
  IPVA: (a) => linhasDeIpva(a),
  IMPOSTOS: (a) => linhasDeImpostos(a),
  LUCRO_FIXO: (a) => linhasDeLucroFixo(a),
};

/** Um módulo inteiro, do motor ao resumo — o caminho que a rota percorre. */
function resumoDe(modulo: ModuloDoMonitor, alteracoes: readonly AlteracaoDoMotor[]) {
  const linhas = LINHAS_DO_MODULO[modulo](alteracoes);
  const impacto = impactoDoModulo(modulo, linhas);
  const normalizadas = normalizarLinhas(modulo, linhas, PAR, "cs-1");
  return {
    linhas,
    impacto,
    normalizadas,
    resumo: resumirModulo(modulo, normalizadas, impacto, PAR),
  };
}

/** Um acervo com alteração dos cinco módulos, em periodicidades diferentes. */
const ACERVO = {
  FINAME: [
    alteracao({ id: 1 }),
    alteracao({
      id: 2,
      entityLabel: "DEF2G45",
      attributeCode: "cavalo.juros_finame_cavalo",
      impactAmount: "-120",
    }),
    // Tributo da compra: é do módulo Impostos, e sai do total daqui.
    alteracao({
      id: 3,
      attributeCode: "cavalo.valor_pis_cofins",
      impactAmount: "3000",
      impactPeriodicity: "PONTUAL",
    }),
    // Prazo: não é dinheiro, e não é falha de precificação.
    alteracao({
      id: 4,
      attributeCode: "cavalo.periodo_finame",
      valueBefore: "60",
      valueAfter: "48",
      deltaPercent: "-20",
      impactConfidence: "NOT_CALCULABLE",
      impactAmount: null,
      impactPeriodicity: null,
    }),
  ],
  IPVA: [
    alteracao({
      id: 10,
      attributeCode: "cavalo.ipva_licenciamento",
      valueBefore: "2400",
      valueAfter: "2450",
      impactAmount: "50",
      impactPeriodicity: "ANUAL",
    }),
    // Base: nenhum módulo a soma.
    alteracao({
      id: 11,
      attributeCode: "cavalo.valor_nf_compra",
      impactAmount: "50000",
      impactPeriodicity: "PONTUAL",
    }),
  ],
  IMPOSTOS: [
    alteracao({
      id: 20,
      attributeCode: "cavalo.valor_pis_cofins",
      valueBefore: "10000",
      valueAfter: "13000",
      impactAmount: "3000",
      impactPeriodicity: "PONTUAL",
    }),
    // Alíquota: percentual, não vira dinheiro nenhum.
    alteracao({
      id: 21,
      attributeCode: "cavalo.percentual_icms",
      valueBefore: "12",
      valueAfter: "18",
      deltaPercent: "50",
      impactConfidence: "NOT_CALCULABLE",
      impactAmount: null,
      impactPeriodicity: null,
    }),
  ],
  /*
    O aluguel do implemento, e a parcela FINAME que o contém.

    As duas mudam pelo mesmo valor, porque nos alugados são o mesmo dinheiro —
    e é exatamente esse par que o Monitor precisa publicar sem somar duas vezes:
    aqui a parcela cai em FORA_DO_TOTAL (rubrica do FINAME) e o aluguel é o
    único que entra no balde mensal.
  */
  ALUGUEL: [
    alteracao({
      id: 40,
      attributeCode: "carreta.custo_aluguel",
      entityType: "CARRETA",
      valueBefore: "5363.55",
      valueAfter: "5663.55",
      deltaAbsolute: "300",
      impactAmount: "300",
      impactPeriodicity: "MENSAL",
    }),
    alteracao({
      id: 41,
      attributeCode: "carreta.finame_implemento",
      entityType: "CARRETA",
      valueBefore: "5363.55",
      valueAfter: "5663.55",
      deltaAbsolute: "300",
      impactAmount: "300",
      impactPeriodicity: "MENSAL",
    }),
  ],
  LUCRO_FIXO: [
    alteracao({
      id: 30,
      attributeCode: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
      valueBefore: "4000",
      valueAfter: "4600",
      impactAmount: "600",
      impactPeriodicity: "MENSAL",
    }),
  ],
} satisfies Record<ModuloDoMonitor, AlteracaoDoMotor[]>;

const consolidadoDoAcervo = () =>
  consolidar(MODULOS_DO_MONITOR.map((m) => resumoDe(m, ACERVO[m]).resumo));

describe("o consolidado fecha com a auditoria de origem", () => {
  it.each(MODULOS_DO_MONITOR)(
    "publica, para %s, exatamente o impacto que o módulo calculou",
    (modulo) => {
      const { impacto, resumo } = resumoDe(modulo, ACERVO[modulo]);
      /*
        A igualdade é de objeto, e não de um valor escolhido a dedo: qualquer
        balde que o Monitor acrescentasse, perdesse ou arredondasse de outro
        jeito reprova aqui.
      */
      expect(resumo.porPeriodicidade).toEqual(impacto.porPeriodicidade);
    },
  );

  it("classifica como fora do total exatamente o que o módulo tirou da soma", () => {
    const { impacto, resumo } = resumoDe("FINAME", ACERVO.FINAME);
    // O módulo tirou uma linha por ser de outra rubrica (o PIS/COFINS).
    expect(impacto.modulo === "FINAME" && impacto.foraDaSoma).toBe(1);
    expect(resumo.porSituacao.FORA_DO_TOTAL).toBe(1);
  });

  it("no aluguel, publica o mensal uma vez só — a parcela que o contém sai fora", () => {
    /*
      O caso que o módulo existe para não errar: a parcela FINAME do implemento
      alugado **é** o aluguel, e as duas chegam alteradas pelo mesmo valor. Se as
      duas entrassem, o Monitor publicaria R$ 600,00 de aumento onde houve
      R$ 300,00.
    */
    const { impacto, resumo } = resumoDe("ALUGUEL", ACERVO.ALUGUEL);
    expect(impacto.porPeriodicidade).toEqual({ MENSAL: 300 });
    expect(resumo.porPeriodicidade).toEqual({ MENSAL: 300 });
    expect(resumo.porSituacao.FORA_DO_TOTAL).toBe(1);
  });

  it("e o FINAME, do outro lado, tira a parcela do total quando o aluguel se move", () => {
    /*
      A outra metade da mesma garantia, medida pela régua do FINAME: com a
      parcela e o aluguel alterados no mesmo veículo, quem sai é a parcela — a
      regra de `cobertasPorParcelasEm`, agora com a terceira parcela dentro.
    */
    const { impacto } = resumoDe("FINAME", ACERVO.ALUGUEL);
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.modulo === "FINAME" && impacto.cobertasPorParcelas).toBe(1);
  });

  it("não conta como sem valoração o que o módulo não conta como não precificado", () => {
    const { impacto, resumo } = resumoDe("FINAME", ACERVO.FINAME);
    // O prazo é `NAO_MONETARIA` aqui e `naoCalculavel: 0` lá — as duas dizem a
    // mesma coisa: não faltou precificar nada, porque prazo não é dinheiro.
    expect(impacto.naoCalculavel).toBe(0);
    expect(resumo.porSituacao.SEM_VALORACAO).toBe(0);
    expect(resumo.porSituacao.NAO_MONETARIA).toBe(1);
  });

  it("conta como sem valoração a rubrica monetária que o motor não precificou", () => {
    const { impacto, resumo } = resumoDe("FINAME", [
      alteracao({ impactConfidence: "NOT_CALCULABLE", impactAmount: null }),
    ]);
    expect(impacto.naoCalculavel).toBe(1);
    expect(resumo.porSituacao.SEM_VALORACAO).toBe(1);
  });

  it("respeita a regra de parcelas do FINAME sem reescrevê-la", () => {
    // Parcela e amortização mudando no mesmo veículo: o total sai, as partes
    // ficam. Quem decide é `cobertasPorParcelasEm`, no próprio módulo.
    const { impacto, resumo } = resumoDe("FINAME", [
      alteracao({ id: 1, attributeCode: "cavalo.finame_cavalo", impactAmount: "310" }),
      alteracao({
        id: 2,
        attributeCode: "cavalo.amortizacao_cavalo",
        impactAmount: "200",
      }),
    ]);
    expect(impacto.modulo === "FINAME" && impacto.cobertasPorParcelas).toBe(1);
    expect(resumo.porSituacao.FORA_DO_TOTAL).toBe(1);
    expect(resumo.porPeriodicidade).toEqual({ MENSAL: 200 });
  });
});

describe("a identidade dos baldes", () => {
  it("fecha: valoradas + sem valoração + não monetárias + fora do total = alterações", () => {
    const consolidado = consolidadoDoAcervo();
    const soma = SITUACOES_DO_IMPACTO.reduce(
      (total, s) => total + consolidado.porSituacao[s],
      0,
    );
    expect(soma).toBe(consolidado.alteracoes);
    expect(consolidado.alteracoes).toBeGreaterThan(0);
  });

  it("fecha também dentro de cada módulo", () => {
    for (const modulo of MODULOS_DO_MONITOR) {
      const { resumo } = resumoDe(modulo, ACERVO[modulo]);
      const soma = SITUACOES_DO_IMPACTO.reduce(
        (total, s) => total + resumo.porSituacao[s],
        0,
      );
      expect(soma).toBe(resumo.alteracoes);
    }
  });

  it("abre cada líquido em aumentos e reduções sem inventar dinheiro", () => {
    const consolidado = consolidadoDoAcervo();
    for (const balde of consolidado.baldes) {
      for (const lado of [balde.custo, balde.receita]) {
        expect(lado.aumentos + lado.reducoes).toBeCloseTo(lado.liquido, 2);
      }
    }
  });
});

describe("o que nunca pode acontecer", () => {
  it("nunca soma periodicidades diferentes", () => {
    const consolidado = consolidadoDoAcervo();
    const periodicidades = consolidado.baldes.map((b) => b.periodicidade);
    // O acervo tem mensal, anual e pontual: três baldes, e nenhum total único.
    expect(new Set(periodicidades).size).toBe(periodicidades.length);
    expect(periodicidades).toEqual(["ANUAL", "MENSAL", "PONTUAL"]);
    expect(consolidado).not.toHaveProperty("impactoTotal");
  });

  it("nunca soma custo com receita", () => {
    const consolidado = consolidadoDoAcervo();
    const mensal = consolidado.baldes.find((b) => b.periodicidade === "MENSAL")!;
    /*
      FINAME: +310 e −120. Aluguel: +300 — e **só** o aluguel, porque a parcela
      FINAME que o acompanha no mesmo veículo saiu do total pela regra de
      parcelas. Se ela tivesse entrado, este número seria 790, e o Monitor
      estaria publicando o dobro do aumento de um contrato de locação.

      Lucro Fixo: +600, e ele é receita — por isso não entra no custo.
    */
    expect(mensal.custo.liquido).toBe(490);
    expect(mensal.receita.liquido).toBe(600);
    // O resultado é derivado à vista, com os dois componentes ao lado.
    expect(mensal.resultado).toBe(110);
  });

  it("preserva o sinal do módulo de receita, sem invertê-lo", () => {
    const { normalizadas } = resumoDe("LUCRO_FIXO", ACERVO.LUCRO_FIXO);
    const linha = normalizadas.find((l) => l.impacto.situacao === "VALORADO")!;
    // Mais receita é `AUMENTO` da rubrica. Quem diz que isso é bom é a natureza.
    expect(linha.impacto.valor).toBe(600);
    expect(linha.impacto.direcao).toBe("AUMENTO");
    expect(linha.impacto.natureza).toBe("RECEITA");
  });

  it("nunca transforma ausência de valor em R$ 0,00", () => {
    const { normalizadas } = resumoDe("FINAME", ACERVO.FINAME);
    for (const l of normalizadas) {
      if (l.impacto.situacao === "VALORADO") continue;
      expect(l.impacto.valor).toBeNull();
      expect(l.impacto.periodicidade).toBeNull();
    }
  });

  it("mantém identificável o que ficou fora do total, com o motivo", () => {
    const { normalizadas } = resumoDe("FINAME", ACERVO.FINAME);
    const fora = normalizadas.find((l) => l.impacto.situacao === "FORA_DO_TOTAL")!;
    expect(fora.variavel.chave).toBe("pis_cofins");
    expect(fora.impacto.motivo).toContain("Impostos");
    // Continua na lista: sair da soma não é sair da tela.
    expect(normalizadas).toHaveLength(ACERVO.FINAME.length);
  });

  it("não conta o mesmo veículo duas vezes em entidades afetadas", () => {
    const consolidado = consolidadoDoAcervo();
    // ABC1D23 aparece nos quatro módulos; DEF2G45, só no FINAME.
    expect(consolidado.entidadesAfetadas).toBe(2);
    // E a soma das contagens por módulo daria mais do que a frota tem.
    const somaIngenua = consolidado.porModulo.reduce(
      (t, m) => t + m.entidades.length,
      0,
    );
    expect(somaIngenua).toBeGreaterThan(consolidado.entidadesAfetadas);
  });
});

describe("a rastreabilidade até a origem", () => {
  it("guarda o módulo, o change_id e a rota da auditoria em cada linha", () => {
    const consolidado = MODULOS_DO_MONITOR.flatMap(
      (m) => resumoDe(m, ACERVO[m]).normalizadas,
    );
    for (const l of consolidado) {
      expect(l.origem.modulo).toBe(l.modulo);
      expect(l.origem.rota).toBe(ROTA_DO_MODULO[l.modulo]);
      expect(l.origem.changeSetId).toBe("cs-1");
      expect(l.changeId).not.toBeNull();
      expect(l.impacto.natureza).toBe(NATUREZA_DO_MODULO[l.modulo]);
    }
  });

  it("dá chaves distintas a linhas de módulos diferentes sobre a mesma coluna", () => {
    // O mesmo PIS/COFINS, lido por FINAME e por Impostos: duas linhas, dois ids.
    const doFiname = resumoDe("FINAME", [
      alteracao({ id: 99, attributeCode: "cavalo.valor_pis_cofins" }),
    ]).normalizadas;
    const deImpostos = resumoDe("IMPOSTOS", [
      alteracao({ id: 99, attributeCode: "cavalo.valor_pis_cofins" }),
    ]).normalizadas;
    expect(doFiname[0]!.id).not.toBe(deImpostos[0]!.id);
    // E só uma das duas entra no total, porque só uma delas é dona da coluna.
    expect(doFiname[0]!.impacto.situacao).toBe("FORA_DO_TOTAL");
    expect(deImpostos[0]!.impacto.situacao).toBe("VALORADO");
  });
});

describe("a prioridade", () => {
  it("usa os cortes do cockpit, e escreve as parcelas que somaram o score", () => {
    const { normalizadas } = resumoDe("IMPOSTOS", [
      alteracao({
        attributeCode: "cavalo.valor_pis_cofins",
        valueBefore: "10000",
        valueAfter: "30000",
        deltaPercent: "200",
        impactAmount: "20000",
        impactPeriodicity: "PONTUAL",
      }),
    ]);
    const linha = normalizadas[0]!;
    // 35 (impacto apurado) + 20 (variação de 100% ou mais) = 55 → ALTO (≥45).
    expect(linha.prioridade.score).toBe(55);
    expect(linha.prioridade.nivel).toBe("ALTO");
    expect(linha.prioridade.motivos.map((m) => m.label)).toEqual([
      "impacto financeiro apurado",
      "variação de 100% ou mais",
    ]);
  });

  it("não dá nota alta a uma alteração sem impacto e sem variação", () => {
    const { normalizadas } = resumoDe("FINAME", [
      alteracao({
        attributeCode: "cavalo.periodo_finame",
        deltaPercent: null,
        impactConfidence: "NOT_CALCULABLE",
        impactAmount: null,
      }),
    ]);
    expect(normalizadas[0]!.prioridade.nivel).toBe("BAIXO");
  });
});
