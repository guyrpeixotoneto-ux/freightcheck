/**
 * O que estes casos protegem.
 *
 * Não é a lista de recomendações — ela muda a cada vigência. É a propriedade
 * que a aba Cliente inteira sustenta: **o sinal matemático da variação não é o
 * sinal econômico dela**, e uma recomendação errada é pior do que nenhuma.
 *
 * Os números vêm do export real (9 vigências, `EMPURRADA_2_12_2025` →
 * `EMPURRADA_1_8_2026`), medidos em 16/08/2026 e registrados em
 * `docs/DIAGNOSTICO-ABA-CLIENTE.md`.
 */
import { describe, expect, it } from "vitest";
import type { ParametroAlterado } from "@workspace/comparison";
import {
  COMPORTAMENTO_ECONOMICO,
  comportamentoDe,
  efeitoQuandoAumenta,
  efeitoQuandoDiminui,
} from "@workspace/knowledge";
import {
  avaliarParametro,
  ehIntermitente,
  ordenarPorPrioridade,
  projetarImpacto,
  type Recomendacao,
  type TransicoesDoParametro,
} from "../recomendacao";
import { totalizar } from "../motor";

function parametro(over: Partial<ParametroAlterado> = {}): ParametroAlterado {
  return {
    code: "cavalo.finame_cavalo",
    title: "Custo fixo do cavalo",
    entityType: "CAVALO",
    equipment: "Cavalo",
    changes: 10,
    entities: 10,
    entitiesNaSerie: 64,
    from: null,
    to: null,
    variacao: null,
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    semanticsStatus: "CONFIRMED",
    impactoCalculavel: true,
    impactoMotivo: "",
    classeDeCusto: "FIXO",
    grupoDeCusto: "Financiamento",
    papel: "TOTAL",
    dentroDe: null,
    parcelas: [],
    contem: null,
    evidencia: null,
    reconciliacao: null,
    ...over,
  };
}

const variacao = (preco: number) => ({
  total: preco,
  preco,
  frota: 0,
  entraram: { entities: 0, amount: 0 },
  sairam: { entities: 0, amount: 0 },
  comparados: 60,
});

function transicoes(
  padroes: { antes: number; depois: number; entidades: number }[],
  vigencia = "EMPURRADA_2_2_2026",
  ativosQueOscilam = 0,
): TransicoesDoParametro {
  const total = padroes.reduce((s, p) => s + p.entidades, 0);
  return {
    code: "x",
    total,
    comZero: padroes
      .filter((p) => p.antes === 0 || p.depois === 0)
      .reduce((s, p) => s + p.entidades, 0),
    ativosQueOscilam,
    padroes: padroes.map((p) => ({
      ...p,
      effectiveDate: "2026-02-01",
      sourceLabel: vigencia,
    })),
  };
}

describe("os dois efeitos derivam de um sentido só", () => {
  it("nunca se contradizem", () => {
    // Dois campos independentes permitiriam "aumenta → aumenta" ao lado de
    // "diminui → aumenta", e a tela passaria a dizer que o parâmetro só
    // melhora. Derivar os dois torna esse estado impossível de escrever.
    for (const sentido of ["DIRETO", "INVERSO"] as const) {
      expect(efeitoQuandoAumenta(sentido)).not.toBe(efeitoQuandoDiminui(sentido));
    }
    expect(efeitoQuandoAumenta("NULO")).toBe("SEM_EFEITO");
    expect(efeitoQuandoDiminui("NULO")).toBe("SEM_EFEITO");
  });

  it("taxa e entrada têm a mesma unidade e sentidos opostos", () => {
    // O caso que prova que unidade não determina comportamento: as duas são
    // PERCENT, e taxa maior aumenta os juros que recebo enquanto entrada maior
    // reduz a parcela.
    expect(comportamentoDe("cavalo.taxa_finame")?.sentido).toBe("DIRETO");
    expect(comportamentoDe("cavalo.percentual_entrada")?.sentido).toBe("INVERSO");
  });
});

describe("o sinal matemático não é o sinal econômico", () => {
  it("TJLP caindo é remuneração caindo — e não vira proposta, porque é índice de terceiro", () => {
    /*
      Cavalo QYW2F98, virada de Jan para Fev/2026: TJLP 7,70 → 7,26 derrubou os
      juros de R$ 2.623,49 para R$ 2.538,34 por mês. Quem lesse "o número caiu,
      logo ficou mais barato para mim" leria exatamente ao contrário.
    */
    const r = avaliarParametro({
      parametro: parametro({
        code: "cavalo.tjlp",
        title: "TJLP",
        unit: "PERCENT",
        isMonetary: false,
        aggregation: "NONE",
        impactoCalculavel: true,
        variacao: variacao(-85.15),
        periodicity: null,
      }),
      comportamento: comportamentoDe("cavalo.tjlp"),
      transicoes: transicoes([{ antes: 7.7, depois: 7.26, entidades: 6 }]),
    });

    expect(r.efeito).toBe("REDUZ");
    expect(r.situacao).toBe("INVESTIGAR");
    expect(r.valorRecomendado).toBeNull();
    expect(r.oQuePerguntar).toMatch(/índice publicado/i);
  });

  it("direções opostas na mesma vigência não viram um líquido", () => {
    /*
      Dez cavalos mexeram em TJLP na mesma virada: seis para baixo e quatro para
      cima, com efeito líquido de +R$ 128,52 nos juros. Uma tela que mostrasse
      só o líquido diria "a TJLP nos favoreceu" enquanto seis placas perderam.
    */
    const r = avaliarParametro({
      parametro: parametro({ code: "cavalo.tjlp", unit: "PERCENT" }),
      comportamento: comportamentoDe("cavalo.tjlp"),
      transicoes: transicoes([
        { antes: 7.7, depois: 7.26, entidades: 6 },
        { antes: 6.19, depois: 7.68, entidades: 4 },
      ]),
    });

    expect(r.direcoesMistas).toBe(true);
    expect(r.efeito).toBe("INDETERMINADO");
    expect(r.situacao).toBe("INVESTIGAR");
    expect(r.porque).toMatch(/direções opostas/i);
  });
});

describe("o relógio não é uma premissa", () => {
  it("a vida do cavalo sobe e não gera recomendação nenhuma", () => {
    /*
      494 de 494 transições para cima, +0,083 por vigência, e igual a
      manutencaoVidaMeses ÷ 12,17: é a idade do cavalo em anos. Uma regra
      "subiu ⇒ peça para baixar" teria proposto rejuvenescer 64 caminhões.
    */
    const r = avaliarParametro({
      parametro: parametro({
        code: "cavalo.combustivel_vida_cavalo",
        title: "Vida do combustível",
        unit: "ANO",
        isMonetary: false,
        aggregation: "AVG",
        impactoCalculavel: false,
        impactoMotivo: "não é um valor monetário",
        changes: 494,
        entities: 64,
      }),
      comportamento: comportamentoDe("cavalo.combustivel_vida_cavalo"),
      transicoes: transicoes([{ antes: 4.92, depois: 5, entidades: 60 }]),
    });

    expect(r.papel).toBe("RELOGIO");
    expect(r.situacao).toBe("NAO_PROPOR");
    expect(r.valorRecomendado).toBeNull();
    expect(r.porque).toMatch(/rejuvenescer/);
  });

  it("mas o consumo negociado, esse tem o sentido inverso do enunciado", () => {
    // km/l maior ⇒ menos litros reconhecidos ⇒ menor remuneração. Só que sem
    // volume e sem preço do litro o impacto não fecha: investiga, não propõe.
    const r = avaliarParametro({
      parametro: parametro({
        code: "cavalo.combustivel_consumo_neg",
        unit: "KM_L",
        isMonetary: false,
        aggregation: "NONE",
        impactoCalculavel: false,
        impactoMotivo: "não é um valor monetário",
      }),
      comportamento: comportamentoDe("cavalo.combustivel_consumo_neg"),
      transicoes: transicoes([{ antes: 2.03, depois: 2.2, entidades: 20 }]),
    });

    expect(r.sentido).toBe("INVERSO");
    expect(r.efeito).toBe("REDUZ");
    expect(r.situacao).toBe("INVESTIGAR");
    expect(r.impacto).toBeNull();
    expect(r.oQuePerguntar).toMatch(/quilometragem/i);
  });
});

describe("a variação que é artefato da fonte", () => {
  it("coluna que alterna entre um valor e zero investiga, nunca propõe", () => {
    /*
      `lucroVariavelPrevistoCavalo` aparece na aba Impacto com −R$ 23.466,25.
      107 das 107 transições têm zero de um dos lados: não é preço caindo, é a
      coluna aparecendo e sumindo. Uma aba ingênua pediria de volta R$ 23 mil
      que ninguém tirou.
    */
    // 30 placas voltam a ter valor depois de zerar — a assinatura medida.
    const t = transicoes(
      [
        { antes: 2662.6, depois: 0, entidades: 34 },
        { antes: 0, depois: 2662.6, entidades: 34 },
      ],
      "EMPURRADA_2_2_2026",
      30,
    );
    expect(ehIntermitente(t)).toBe(true);

    const r = avaliarParametro({
      parametro: parametro({
        code: "cavalo.lucro_variavel_previsto_cavalo",
        impactoCalculavel: false,
        impactoMotivo: "a semântica é presumida",
      }),
      comportamento: comportamentoDe("cavalo.lucro_variavel_previsto_cavalo"),
      transicoes: t,
    });

    expect(r.situacao).toBe("INVESTIGAR");
    expect(r.valorRecomendado).toBeNull();
    expect(r.porque).toMatch(/aparecendo e sumindo/);
  });

  it("um financiamento que encerra não é intermitência", () => {
    // `finameCavalo` tem 49% das transições com zero e `finame` da carreta,
    // 30% — os dois bem abaixo do corte de proporção, mesmo com 9 placas que
    // zeram e voltam quando o novo ciclo entra.
    expect(
      ehIntermitente(
        transicoes(
          [
            { antes: 7937.22, depois: 0, entidades: 15 },
            { antes: 0, depois: 3318.01, entidades: 3 },
            { antes: 10662.56, depois: 10577.41, entidades: 19 },
          ],
          "EMPURRADA_2_2_2026",
          9,
        ),
      ),
    ).toBe(false);
  });

  it("um item que passou a ser cadastrado também não é — e este é o caso difícil", () => {
    /*
      O tacógrafo tem **8 de 8** transições com zero de um dos lados: pela
      proporção sozinha ele seria lido como coluna que pisca, e um ganho de
      R$ 21,03 por implemento viraria uma investigação. Nenhuma placa volta
      depois de zerar — os zeros dele apontam todos para o mesmo lado, porque
      é um item que passou a existir no cadastro.
    */
    const t = transicoes(
      [
        { antes: 0, depois: 21.03, entidades: 7 },
        { antes: 21.03, depois: 0, entidades: 1 },
      ],
      "EMPURRADA_2_5_2026",
      0,
    );
    expect(t.comZero / t.total).toBe(1);
    expect(ehIntermitente(t)).toBe(false);

    const r = avaliarParametro({
      parametro: parametro({
        code: "carreta.tacografo",
        entityType: "CARRETA",
        entities: 7,
        impactoCalculavel: false,
        impactoMotivo: "a semântica é presumida",
      }),
      comportamento: comportamentoDe("carreta.tacografo"),
      transicoes: t,
    });

    expect(r.efeito).toBe("AUMENTA");
    expect(r.situacao).toBe("NAO_PROPOR");
  });
});

describe("um número só se propõe quando ele é a premissa", () => {
  it("montante calculado a partir de outra coluna não vira valor a propor", () => {
    /*
      O IPVA do cavalo caiu R$ 731.586,01 por ano e é negociável — mas o número
      da coluna é resultado de uma alíquota sobre a nota, e "revisar de
      R$ 7.210 para R$ 21.259,89" seria o número errado para as 32 placas que
      não estavam no par dominante. O que se pede é a base.
    */
    const r = avaliarParametro({
      parametro: parametro({
        code: "cavalo.ipva_licenciamento",
        title: "IPVA / Licenciamento",
        periodicity: "ANUAL",
        entities: 62,
        variacao: variacao(-731586.01),
      }),
      comportamento: comportamentoDe("cavalo.ipva_licenciamento"),
      transicoes: transicoes([
        { antes: 21259.89, depois: 7210, entidades: 30 },
        { antes: 11089.38, depois: 4096.31, entidades: 20 },
        { antes: 4096.31, depois: 2513.19, entidades: 12 },
      ]),
    });

    expect(r.efeito).toBe("REDUZ");
    expect(r.situacao).toBe("INVESTIGAR");
    expect(r.valorRecomendado).toBeNull();
    expect(r.oQuePerguntar).toMatch(/base contratual/i);
    // O dinheiro continua à vista: o que se recusa é o valor a propor.
    expect(r.impacto?.valor).toBe(-731586.01);
  });

  it("padrão que explica só parte da frota não vira valor a propor", () => {
    const r = avaliarParametro({
      parametro: parametro({
        code: "carreta.seguro",
        entityType: "CARRETA",
        entities: 40,
        variacao: variacao(-5000),
      }),
      comportamento: comportamentoDe("carreta.seguro"),
      // 8 de 40 ativos no par dominante: é valor por ativo, não premissa.
      transicoes: transicoes([
        { antes: 627.86, depois: 177.23, entidades: 8 },
        { antes: 545.39, depois: 228.31, entidades: 7 },
        { antes: 494.31, depois: 177.23, entidades: 6 },
        { antes: 631.41, depois: 180.79, entidades: 5 },
      ]),
    });

    expect(r.situacao).toBe("INVESTIGAR");
    expect(r.valorRecomendado).toBeNull();
    expect(r.oQueAconteceu?.padroes).toBe(4);
    expect(r.oQueAconteceu?.cobertura).toBeLessThan(0.6);
    expect(r.porque).toMatch(/pares distintos/);
  });
});

describe("o que é legítimo não vira pedido", () => {
  it("FINAME que encerra é mecanismo próprio, não distorção", () => {
    const r = avaliarParametro({
      parametro: parametro({ variacao: variacao(-52223.9) }),
      comportamento: comportamentoDe("cavalo.finame_cavalo"),
      transicoes: transicoes([{ antes: 7937.22, depois: 3318.01, entidades: 10 }]),
    });

    expect(r.efeito).toBe("REDUZ");
    expect(r.situacao).toBe("NAO_PROPOR");
    expect(r.impacto?.valor).toBe(-52223.9);
  });

  it("o que subiu a nosso favor sai da lista dizendo que é favorável", () => {
    // `carreta.seguro` foi de R$ 177,23 para R$ 627,86 em 6 implementos.
    const r = avaliarParametro({
      parametro: parametro({
        code: "carreta.seguro",
        entityType: "CARRETA",
        variacao: variacao(2375.61),
      }),
      comportamento: comportamentoDe("carreta.seguro"),
      transicoes: transicoes([{ antes: 177.23, depois: 627.86, entidades: 6 }]),
    });

    expect(r.efeito).toBe("AUMENTA");
    expect(r.situacao).toBe("NAO_PROPOR");
    expect(r.porque).toMatch(/a nosso favor/);
  });
});

describe("a proposta, quando ela cabe", () => {
  it("parâmetro negociável que nos reduz vira proposta condicionada", () => {
    const r = avaliarParametro({
      parametro: parametro({
        code: "carreta.lucro_fixomodelo_novo_ciclo",
        entityType: "CARRETA",
        title: "Lucro fixo do novo ciclo",
        variacao: variacao(-4000),
      }),
      comportamento: comportamentoDe("carreta.lucro_fixomodelo_novo_ciclo"),
      transicoes: transicoes([{ antes: 4570.52, depois: 1252.51, entidades: 16 }]),
    });

    expect(r.situacao).toBe("PROPOR_AJUSTE");
    expect(r.valorAtual).toBe(1252.51);
    expect(r.valorRecomendado).toBe(4570.52);
    expect(r.diferenca).toBe(3318.01);
    // A fonte é o que de fato sustenta o número — a vigência anterior —, e a
    // frase diz onde confirmar. Prometer "o contrato diz 4570,52" seria
    // afirmar o que não se leu.
    expect(r.fonte).toBe("VIGENCIA_ANTERIOR");
    expect(r.oQuePerguntar).toMatch(/Confirmar em contrato/);
    expect(r.confianca).toBe("MEDIA");
  });

  it("sem fonte de referência declarada, investiga em vez de inventar valor", () => {
    const r = avaliarParametro({
      parametro: parametro({
        code: "cavalo.lucro_variavel_previsto_cavalo",
        variacao: variacao(-23466.25),
      }),
      // Comportamento sem `fonteDoValorRecomendado`, e negociável.
      comportamento: {
        code: "x",
        papel: "MONTANTE",
        sentido: "DIRETO",
        acionavel: "NEGOCIAVEL",
        mecanismo: "Componente do valor fixo.",
        evidencia: "—",
      },
      transicoes: transicoes([{ antes: 5000, depois: 4000, entidades: 5 }]),
    });

    expect(r.situacao).toBe("INVESTIGAR");
    expect(r.valorRecomendado).toBeNull();
    expect(r.oQuePerguntar).toMatch(/valor contratado/i);
  });

  it("sem comportamento declarado, não recomenda nada", () => {
    const r = avaliarParametro({
      parametro: parametro({ code: "cavalo.coluna_nova", variacao: variacao(-9999) }),
      comportamento: null,
      transicoes: transicoes([{ antes: 10, depois: 1, entidades: 3 }]),
    });

    expect(r.situacao).toBe("NAO_CALCULAVEL");
    expect(r.efeito).toBe("INDETERMINADO");
    expect(r.valorRecomendado).toBeNull();
  });
});

describe("mensal e anual nunca se somam", () => {
  it("a projeção sai marcada como premissa", () => {
    const i = projetarImpacto(-52223.9, "MENSAL");
    expect(i.mensal).toBe(-52223.9);
    expect(i.anual).toBe(-626686.8);
    expect(i.projetado).toBe(true);
    expect(i.explicacao).toMatch(/premissa/i);
  });

  it("pontual não vira mensal nem anual", () => {
    const i = projetarImpacto(542637.3, "PONTUAL");
    expect(i.mensal).toBeNull();
    expect(i.anual).toBeNull();
    expect(i.projetado).toBe(false);
  });

  it("sem periodicidade confirmada, não projeta", () => {
    const i = projetarImpacto(100, null);
    expect(i.mensal).toBeNull();
    expect(i.anual).toBeNull();
  });

  it("os totais mantêm as periodicidades separadas", () => {
    const base = avaliarParametro({
      parametro: parametro({ variacao: variacao(-52223.9) }),
      comportamento: comportamentoDe("cavalo.finame_cavalo"),
      transicoes: transicoes([{ antes: 7937.22, depois: 3318.01, entidades: 10 }]),
    });
    const ipva = avaliarParametro({
      parametro: parametro({
        code: "cavalo.ipva_licenciamento",
        periodicity: "ANUAL",
        variacao: variacao(-731586.01),
        entities: 62,
      }),
      comportamento: comportamentoDe("cavalo.ipva_licenciamento"),
      transicoes: transicoes([{ antes: 11089.38, depois: 4096.31, entidades: 60 }]),
    });

    const t = totalizar([base, ipva]);
    expect(t.porPeriodicidade.map((p) => p.periodicity)).toEqual(["MENSAL", "ANUAL"]);
    expect(t.porPeriodicidade[0].identificado).toBe(52223.9);
    expect(t.porPeriodicidade[1].identificado).toBe(731586.01);
    // Nada em `porPeriodicidade` soma as duas — não existe um campo que o faça.
    expect(t.percentualExplicado).toBe(100);
  });

  it("sem dinheiro apurado, o percentual explicado é nulo e não 100%", () => {
    // "Não havia nada a explicar" e "explicamos tudo" não são a mesma frase.
    const t = totalizar([]);
    expect(t.percentualExplicado).toBeNull();
    expect(t.analisadas).toBe(0);
  });
});

describe("a ordem é econômica", () => {
  it("propostas e investigações se intercalam por dinheiro, não por situação", () => {
    /*
      Uma investigação de R$ 731 mil vale mais atenção do que uma proposta de
      R$ 300, e separá-las por situação enterraria a maior pergunta do mês
      embaixo da menor proposta.
    */
    const rec = (over: Partial<Recomendacao>): Recomendacao =>
      ({
        code: "x",
        title: "x",
        entityType: "CAVALO",
        equipment: "Cavalo",
        situacao: "INVESTIGAR",
        confianca: "MEDIA",
        papel: "MONTANTE",
        sentido: "DIRETO",
        acionavel: "NEGOCIAVEL",
        mecanismo: "",
        efeito: "REDUZ",
        direcoesMistas: false,
        oQueAconteceu: null,
        porque: "",
        impacto: null,
        impactoMotivo: "",
        valorAtual: null,
        valorRecomendado: null,
        diferenca: null,
        fonte: null,
        oQuePerguntar: null,
        veiculosAfetados: 1,
        veiculosNaSerie: 64,
        alteracoes: 1,
        alimenta: [],
        dependeDe: [],
        evidencia: "",
        ...over,
      }) as Recomendacao;

    const ordenado = ordenarPorPrioridade([
      rec({
        code: "proposta_pequena",
        situacao: "PROPOR_AJUSTE",
        impacto: projetarImpacto(-300, "MENSAL"),
      }),
      rec({ code: "favoravel", situacao: "NAO_PROPOR", impacto: projetarImpacto(999999, "MENSAL") }),
      rec({
        code: "investigacao_grande",
        situacao: "INVESTIGAR",
        impacto: projetarImpacto(-731586.01, "ANUAL"),
      }),
    ]);

    expect(ordenado.map((r) => r.code)).toEqual([
      "investigacao_grande",
      "proposta_pequena",
      "favoravel",
    ]);
  });
});

describe("a tabela de comportamento", () => {
  it("não tem código repetido", () => {
    const codes = COMPORTAMENTO_ECONOMICO.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("toda entrada carrega evidência e mecanismo", () => {
    // Uma linha sem evidência é um palpite com aparência de regra — e ela
    // decide o sinal de uma recomendação.
    for (const c of COMPORTAMENTO_ECONOMICO) {
      expect(c.evidencia.length, c.code).toBeGreaterThan(20);
      expect(c.mecanismo.length, c.code).toBeGreaterThan(20);
    }
  });

  it("só quem tem fonte de referência pode virar proposta", () => {
    for (const c of COMPORTAMENTO_ECONOMICO) {
      if (c.fonteDoValorRecomendado === undefined) continue;
      expect(
        ["NEGOCIAVEL", "INDEXADO_EXTERNO"],
        `${c.code} declara fonte de valor sem ser acionável`,
      ).toContain(c.acionavel);
    }
  });

  it("nenhum parâmetro NULO declara fonte de valor a propor", () => {
    for (const c of COMPORTAMENTO_ECONOMICO) {
      if (c.sentido !== "NULO") continue;
      expect(c.fonteDoValorRecomendado, c.code).toBeUndefined();
    }
  });
});
