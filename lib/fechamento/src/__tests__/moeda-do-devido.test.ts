import { describe, expect, it } from "vitest";

import { conferirDePara } from "../de-para";
import {
  descontoDeDisponibilidadeDoMes,
  type DiaDeDisponibilidade,
} from "../leitores/disponibilidade";
import { lerPagamento } from "../leitores/pagamento";
import { montarMapaDaQuinzena, type ParametrosDoCadastro } from "../mapa-rota";
import { basesDaQuinzena } from "../persistencia";
import { compararPaineis, painelDeUmaQuinzena } from "../resumo";
import { fixturePagamentoDoPainel } from "./fixtures";

/**
 * A MOEDA DA COMPARAÇÃO, E A COLUNA `AUDITAR`.
 *
 * **O defeito que esta suíte prende.** O painel punha lado a lado dois números
 * que não eram da mesma grandeza. O devido sai do motor **bruto** — a parcela
 * já com o fator de imposto — e com o desconto negativo, que é como a planilha
 * escreve; o demonstrado saía do 03.08.20 pela coluna `S/Imposto` e com o
 * desconto em módulo positivo, que é como o relatório escreve. A coluna
 * `Diferença` media câmbio, não divergência: numa linha em que os dois lados
 * são **a mesma verba do mesmo arquivo**, ela acusava
 * `−18.199,19 − 13.328,30 = −31.527,49`.
 *
 * O teste central é o primeiro: monta o devido a partir do **mesmo** 03.08.20
 * que produz o demonstrado, e exige zero. Não "próximo de zero", não "dentro da
 * tolerância": zero. Uma linha cujos dois lados saem do mesmo arquivo não tem
 * do que divergir, e qualquer número ali é defeito de conversão nosso.
 *
 * O resto da suíte prende o que sobra depois disso — o que **não** fecha e por
 * quê, que é a coluna `Auditar`.
 */

const PARAMETROS: ParametrosDoCadastro = {
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
};

/*
  O 03.08.18 do mês montado para bater com o bloco `DESCONTO DISPONIBILIDADE`
  do 03.08.20 da fixture — R$ 3.800,00. Não é conveniência de teste: os dois
  relatórios **batem ao centavo** no fechamento real, e é justamente por baterem
  que esta linha serve de prova da conversão. Se eles divergissem, a linha
  mediria a divergência deles e não a nossa moeda.
*/
const doMes = descontoDeDisponibilidadeDoMes(
  [
    {
      linha: 1,
      aba: "FF",
      tipoDeFrota: "FF",
      dia: "2026-07-20",
      canal: "ROTA",
      frotaTotal: 0,
      contratada: 0,
      realPrimeiraViagem: 0,
      realSegundaViagem: 0,
      gapTotal: 0,
      gapDaCia: 0,
      gapDaTransportadora: {
        frotaCancelada: 0,
        outrosCancelados: 0,
        frotaNaoCancelada: 0,
        outrosNaoCancelados: 0,
      },
      descontos: { custoFixo: 1000, equipe: 2300, indiretos: 500, fatorAjudante: 0, total: 3800 },
      percentualDeUtilizacao: null,
      percentualDeDisponibilidade: null,
    } satisfies DiaDeDisponibilidade,
  ],
  "ROTA",
);

/** O painel comparado da 2ª quinzena, com os dois lados saídos do mesmo arquivo. */
function painel() {
  const pagamento = lerPagamento(fixturePagamentoDoPainel());
  /*
    Uma viagem sem marca de indisponibilidade. Ela não entra em conta nenhuma
    — o variável é passado à parte — e existe para que `indisponibilidade` seja
    **zero medido** em vez de ausente: é esse estado, e não o `null`, que o
    teste do total do quadro precisa distinguir.
  */
  const diario = [
    {
      viagens: [
        {
          frota: "FROTA FIXA",
          cargaAtual: "Rota",
          tipoDeImposto: "ISS",
          valorFaturado: 0,
          caixasDeRota: 10,
          caixasDeAs: 0,
          tipoDeIndisponibilidade: "",
        },
      ],
    },
  ];
  const bases = basesDaQuinzena(
    pagamento.descontos.map((d) => ({ canal: d.canal, tipo: d.tipo as string, valor: d.valor })),
    "ROTA",
    diario,
    null,
    { quinzena: 2, disponibilidadeDoMes: doMes },
  );
  const mapa = montarMapaDaQuinzena({
    quinzena: 2,
    parametros: PARAMETROS,
    variavel: { frotaFixa: 100000, agregado: 50000, recargaENoturna: 0, vans: 0 },
    bases,
  });
  const demonstrado = painelDeUmaQuinzena(2, conferirDePara(pagamento, { canal: "ROTA" }));
  return {
    mapa,
    comparado: compararPaineis(
      "ROTA",
      { primeira: null, segunda: mapa },
      demonstrado,
      { primeira: null, segunda: null },
    )!,
  };
}

const linha = (chave: string) =>
  painel()
    .comparado.quadros.flatMap((q) => q.linhas)
    .find((l) => l.chave === chave)!;

const quadro = (nome: string) => painel().comparado.quadros.find((q) => q.quadro === nome)!;

describe("o devido e o demonstrado da mesma verba do mesmo arquivo fecham em zero", () => {
  /*
    Cinco linhas, e as cinco pelo mesmo caminho: o motor lê o desconto do
    03.08.20 para montar a base, o de-para lê o mesmo desconto do mesmo
    03.08.20 para montar o demonstrado. Só a moeda os separava.
  */
  const DE_DOCUMENTO = [
    "desconto_devolucao_percentual",
    "desconto_disponibilidade",
    "desconto_complementar_negativo",
    "desconto_devolucao",
    "indisponibilidade_variavel",
  ];

  for (const chave of DE_DOCUMENTO) {
    it(`${chave} fecha ao centavo`, () => {
      const l = linha(chave);
      expect(l.devido.segunda, `${chave} sem devido`).not.toBeNull();
      expect(l.demonstrado.segunda, `${chave} sem demonstrado`).not.toBeNull();
      expect(l.diferenca.segunda).toBe(0);
    });
  }

  it("o desconto chega negativo dos dois lados — sinal é conversão, não subtração", () => {
    /*
      O relatório escreve o desconto em módulo; a planilha o escreve negativo.
      Sem trocar o sinal na conversão, a diferença de uma linha de R$ 4.875,00
      apareceria como o dobro dela.
    */
    const l = linha("desconto_devolucao_percentual");
    expect(l.devido.segunda).toBeLessThan(0);
    expect(l.demonstrado.segunda).toBeLessThan(0);
  });

  it("a parcela sobe pelo fator; o complementar negativo, não", () => {
    /*
      A assimetria é da planilha e está no motor desde sempre — o que faltava
      era o demonstrado respeitá-la. O frete mínimo do relatório vale R$ 700,00,
      e é assim que ele entra nos dois lados: sem fator nenhum.
    */
    const { mapa } = painel();
    expect(mapa.fatorDeImposto).toBeGreaterThan(1.3);
    expect(linha("desconto_complementar_negativo").demonstrado.segunda).toBe(-700);
    expect(linha("desconto_devolucao_percentual").demonstrado.segunda).toBeCloseTo(
      -4875 * mapa.fatorDeImposto,
      2,
    );
  });
});

describe("o total do quadro é somado das linhas, e não lido do relatório", () => {
  it("o quadro do fixo não fecha, e diz qual linha o impede", () => {
    /*
      O `DVS` vale dinheiro no devido e o 03.08.20 não tem linha que corresponda
      — ver a origem dela em `de-para.ts`. Somar o resto e chamar de total daria
      uma diferença que mede a lacuna do painel, não a divergência dos
      documentos. A célula fica vazia, e o motivo vai escrito.
    */
    const q = quadro("REMUNERACAO");
    expect(q.demonstrado.segunda).toBeNull();
    expect(q.diferenca.segunda).toBeNull();
    expect(q.semDemonstrado).toEqual(["Total remuneração rota DVS"]);
  });

  it("o quadro do variável fecha, e o total é a soma das linhas convertidas", () => {
    const q = quadro("VARIAVEL");
    expect(q.semDemonstrado).toEqual([]);

    /* Conjunto uma vez, mais as linhas que não estão nele — com o sinal delas. */
    const doConjunto = q.conjuntos.reduce((s, c) => s + (c.demonstrado.segunda ?? 0), 0);
    const soltas = q.linhas
      .filter((l) => !l.conjunto)
      .reduce((s, l) => s + (l.demonstrado.segunda ?? 0), 0);
    expect(q.demonstrado.segunda).toBeCloseTo(doConjunto + soltas, 2);
  });

  it("a linha de devido zero sem demonstrado não anula o total", () => {
    /*
      `INDISPONIBILIDADE` no quadro do fixo é zero medido de um lado e bloco
      inexistente do outro. Ela não põe nada em nenhuma das duas somas, e por
      isso não pode apagar um total que a aritmética sustenta — o que apaga o do
      fixo é o `DVS`, e só ele.
    */
    const l = linha("indisponibilidade_fixo");
    expect(l.devido.segunda).toBe(0);
    expect(l.demonstrado.segunda).toBeNull();
    expect(quadro("REMUNERACAO").semDemonstrado).not.toContain("Indisponibilidade");
  });
});

describe("o bruto soma de volta o desconto que saiu daquelas verbas, e nenhum outro", () => {
  /*
    O relatório diz, na linha de cada desconto, de qual VBZ ele foi subtraído. A
    regra anterior perguntava isso à planilha — somava de volta o desconto que
    as linhas *daquele quadro dela* mostravam — e a planilha repete a devolução
    e a disponibilidade no quadro do variável, onde são informativas.
  */
  it("o conjunto do fixo sobe pelos descontos que o relatório atribui às VBZ 01, 02 e 03", () => {
    const c = quadro("REMUNERACAO").conjuntos.find((x) => x.chave === "fixo_bruto")!;
    const { mapa } = painel();
    /* 200.000 de verba + 4.875 de devolução + 3.800 de disponibilidade. */
    expect(c.demonstrado.segunda).toBeCloseTo(208675 * mapa.fatorDeImposto, 2);
  });

  it("o conjunto do variável não sobe por desconto nenhum", () => {
    const c = quadro("VARIAVEL").conjuntos.find((x) => x.chave === "variavel_bruto")!;
    const { mapa } = painel();
    /* 80.000 da VBZ 05 + 40.000 da VBZ 07, e nada mais. */
    expect(c.demonstrado.segunda).toBeCloseTo(120000 * mapa.fatorDeImposto, 2);
  });

  it("o frete mínimo não sobe conjunto nenhum — o relatório não diz de qual verba saiu", () => {
    /*
      "Desconto Líquido já subtraído das VBZs de custo Fixo coluna ICMS", sem
      dizer quais. Chutar uma para fechar a conta é exatamente o que este módulo
      não faz; a diferença fica no resíduo do quadro, onde pode ser vista.
    */
    const conferido = conferirDePara(lerPagamento(fixturePagamentoDoPainel()), { canal: "ROTA" });
    const fixo = conferido.quadros.find((q) => q.quadro === "REMUNERACAO")!;
    expect(fixo.residuo).toBe(700);
  });
});

describe("a coluna Auditar mostra o que nenhum documento sustenta, e só isso", () => {
  it("a linha que fecha não é auditada", () => {
    for (const chave of ["desconto_devolucao_percentual", "desconto_disponibilidade"]) {
      expect(linha(chave).auditar, chave).toBeNull();
    }
  });

  it("a linha em conjunto não é auditada por não ter demonstrado próprio", () => {
    /* O que a sustenta é o conjunto; é lá que ela é conferida, e auditada. */
    const l = linha("custo_fixo_padronizado");
    expect(l.demonstrado.segunda).toBeNull();
    expect(l.conjunto).not.toBeNull();
    expect(l.auditar).toBeNull();
  });

  it("o devido em dinheiro sem nenhum demonstrado é auditado", () => {
    const l = linha("rota_dvs");
    expect(l.conjunto).toBeNull();
    expect(l.devido.segunda).toBeGreaterThan(0);
    expect(l.demonstrado.segunda).toBeNull();
    expect(l.auditar).toContain("não traz linha que corresponda");
  });

  it("o conjunto que não fecha é auditado no conjunto, com o valor da diferença", () => {
    const c = quadro("VARIAVEL").conjuntos.find((x) => x.chave === "variavel_bruto")!;
    expect(c.diferenca.segunda).not.toBe(0);
    expect(c.auditar).toContain("discordam");
  });

  it("a auditoria é computada, e some sozinha quando a divergência some", () => {
    /*
      Não há catálogo de exceção: o texto sai da subtração. É o que impede uma
      divergência de sumir da vista por ter sido inscrita numa lista em vez de
      resolvida — e o que garante que uma que se resolva suma sem ninguém
      lembrar de apagar a inscrição.
    */
    const auditadas = painel()
      .comparado.quadros.flatMap((q) => q.linhas)
      .filter((l) => l.auditar !== null);
    for (const l of auditadas) {
      const fecha = l.diferenca.segunda !== null && Math.abs(l.diferenca.segunda) < 0.005;
      expect(fecha, `${l.chave} foi auditada mesmo fechando`).toBe(false);
    }
  });
});
