import { describe, expect, it } from "vitest";

import { competencia, dentroDaCompetencia } from "../periodo";
import {
  descontoDeDisponibilidadeDoMes,
  type DiaDeDisponibilidade,
} from "../leitores/disponibilidade";

/**
 * O 03.08.18 É QUINZENAL, E CADA COMPETÊNCIA É LIDA NO PRÓPRIO PERÍODO.
 *
 * **O defeito que este arquivo fecha.** `disponibilidadeDoMes` lia as duas
 * competências com **um** intervalo — de min(início) a max(fim), ou seja, o mês
 * inteiro para as duas. Um 03.08.18 mensal anexado à 1ª quinzena entrava com os
 * trinta e um dias, o da 2ª também, e as duas remessas se sobrepunham em cada
 * dia. Quem resolvia a sobreposição era a desduplicação por `(aba, dia)`, que
 * ficava com a **primeira** linha que via — e "a primeira" é a ordem em que o
 * banco devolveu as linhas, que não é uma regra de negócio.
 *
 * **A correção é de leitura, não de soma.** Cada competência passa a ser
 * consultada no seu próprio período: a 1ª contribui com os dias 1 a 15 do que
 * recebeu, a 2ª com os dias 16 ao fim do que recebeu. A sobreposição some na
 * origem, e a desduplicação deixa de decidir qualquer coisa.
 *
 * **Por que quinzenal, e não mensal.** Chegamos a tratar o 03.08.18 como fonte
 * do mês, porque o arquivo que a 1ª quinzena de julho/2026 recebeu tinha a aba
 * `Van` com o mês todo e a `FF` só com a primeira metade. A comparação linha a
 * linha das duas remessas mostrou o que aquilo era: o arquivo da 1ª é um
 * subconjunto perfeito do outro — 42 linhas contra 56, zero divergência de
 * valor, e só a aba `FF` dele carrega autofiltro. Era um arquivo podado à mão,
 * não uma regra. O relatório abre uma linha por dia e é emitido por quinzena
 * como os outros.
 *
 * Os números são os reais de julho/2026 — CDD Belém · Horizonte, canal Rota.
 */

const PRIMEIRA = competencia(2026, 7, 1);
const SEGUNDA = competencia(2026, 7, 2);

/** Os totais reais do 03.08.18 de julho/2026, por aba e por quinzena. */
const REAL = {
  FF: {
    1: { custoFixo: 5870.63, equipe: 36747.87, indiretos: 0, fatorAjudante: 320.85, total: 42939.35 },
    2: { custoFixo: 3031.01, equipe: 26044.61, indiretos: 0, fatorAjudante: 0, total: 29075.62 },
  },
  Van: {
    1: { custoFixo: 7135.28, equipe: 4080.45, indiretos: 0, fatorAjudante: 0, total: 11215.73 },
    2: { custoFixo: 5351.44, equipe: 3060.36, indiretos: 0, fatorAjudante: 0, total: 8411.8 },
  },
} as const;

/** O bloco `DESCONTO DISPONIBILIDADE` do 03.08.20 da 2ª quinzena, Rota. */
const DO_DEMONSTRATIVO = 91642.5;
/** O que só a 2ª metade vale — o número que **tem** de divergir. */
const SO_A_SEGUNDA_METADE = 37487.42;

type Descontos = { custoFixo: number; equipe: number; indiretos: number; fatorAjudante: number; total: number };

function dia(aba: "FF" | "Van", data: string, descontos: Descontos): DiaDeDisponibilidade {
  return {
    linha: 1,
    aba,
    tipoDeFrota: aba === "FF" ? "FF" : "VAN",
    dia: data,
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
    descontos,
    percentualDeUtilizacao: null,
    percentualDeDisponibilidade: null,
  };
}

/** O 03.08.18 do mês inteiro — as duas abas, as duas metades. */
const MENSAL = (): DiaDeDisponibilidade[] => [
  dia("FF", "2026-07-10", REAL.FF[1]),
  dia("FF", "2026-07-20", REAL.FF[2]),
  dia("Van", "2026-07-10", REAL.Van[1]),
  dia("Van", "2026-07-20", REAL.Van[2]),
];

/** O arquivo podado que a 1ª quinzena de julho/2026 de fato recebeu. */
const PODADO = (): DiaDeDisponibilidade[] => [
  dia("FF", "2026-07-10", REAL.FF[1]),
  dia("Van", "2026-07-10", REAL.Van[1]),
  dia("Van", "2026-07-20", REAL.Van[2]),
];

/**
 * O que `disponibilidadeDoMes` faz hoje: uma consulta por competência, cada uma
 * cortada pelo **seu** período, e as listas concatenadas.
 *
 * O corte real é `WHERE competencia_id = ? AND dia BETWEEN ? AND ?`; aqui ele é
 * `dentroDaCompetencia`, que é a mesma regra escrita uma vez só, em `periodo.ts`.
 */
function comOCorte(porCompetencia: { periodo: typeof PRIMEIRA; linhas: DiaDeDisponibilidade[] }[]) {
  const linhas = porCompetencia.flatMap((c) =>
    c.linhas.filter((l) => dentroDaCompetencia(c.periodo, l.dia)),
  );
  return descontoDeDisponibilidadeDoMes(linhas, "ROTA");
}

/**
 * O que ela fazia **antes**: um intervalo só, do início da 1ª ao fim da 2ª.
 *
 * Existe para o controle negativo. Sem ele, os testes abaixo passariam com a
 * leitura antiga também — o que os tornaria decorativos.
 */
function semOCorte(porCompetencia: { linhas: DiaDeDisponibilidade[] }[]) {
  return descontoDeDisponibilidadeDoMes(
    porCompetencia.flatMap((c) => c.linhas),
    "ROTA",
  );
}

describe("o total do mês não depende de como o arquivo foi anexado", () => {
  it("o mesmo arquivo mensal nas duas competências dá o total do demonstrativo", () => {
    const lido = comOCorte([
      { periodo: PRIMEIRA, linhas: MENSAL() },
      { periodo: SEGUNDA, linhas: MENSAL() },
    ]);
    expect(lido.total).toBe(DO_DEMONSTRATIVO);
    expect(lido.dias).toBe(2);
    /* E sem nada para a rede pegar: o corte já resolveu. */
    expect(lido.conflitos).toEqual([]);
  });

  it("o podado na 1ª e o mensal na 2ª — o caso real de julho/2026 — dá o mesmo", () => {
    const lido = comOCorte([
      { periodo: PRIMEIRA, linhas: PODADO() },
      { periodo: SEGUNDA, linhas: MENSAL() },
    ]);
    expect(lido.total).toBe(DO_DEMONSTRATIVO);
    expect(lido.conflitos).toEqual([]);
  });

  it("o arquivo partido em duas remessas de meia quinzena dá o mesmo", () => {
    const daPrimeira = MENSAL().filter((l) => dentroDaCompetencia(PRIMEIRA, l.dia));
    const daSegunda = MENSAL().filter((l) => dentroDaCompetencia(SEGUNDA, l.dia));
    const lido = comOCorte([
      { periodo: PRIMEIRA, linhas: daPrimeira },
      { periodo: SEGUNDA, linhas: daSegunda },
    ]);
    expect(lido.total).toBe(DO_DEMONSTRATIVO);
  });

  it("o mensal na 2ª e nada na 1ª DIVERGE — e é isso que se quer", () => {
    /*
      A afirmação que impede o produto de fingir completude. O 03.08.18 da 1ª
      quinzena não chegou; os dias 1 a 15 não existem em lugar nenhum, e o
      corte não os inventa. O total sai R$ 37.487,42 — só a segunda metade — e
      **não** bate com o 03.08.20. A tela cobra o relatório da 1ª quinzena.

      Era exatamente este caso que a leitura antiga escondia: sem o corte, o
      mensal anexado à 2ª contava os trinta e um dias e a 1ª quinzena parecia
      atendida por um arquivo que ela nunca recebeu.
    */
    const lido = comOCorte([
      { periodo: PRIMEIRA, linhas: [] },
      { periodo: SEGUNDA, linhas: MENSAL() },
    ]);
    expect(lido.total).toBe(SO_A_SEGUNDA_METADE);
    expect(lido.total).not.toBe(DO_DEMONSTRATIVO);

    /* O controle negativo: sem o corte, o mesmo envio dava o mês inteiro. */
    expect(semOCorte([{ linhas: MENSAL() }]).total).toBe(DO_DEMONSTRATIVO);
  });
});

describe("a desduplicação virou rede, e a rede não sorteia", () => {
  it("a mesma linha duas vezes, com os mesmos números, entra uma vez", () => {
    /*
      Duas remessas do mesmo relatório dentro da mesma competência. Não há o que
      decidir: é a mesma linha, e somá-la duas vezes dobraria o desconto.
    */
    const lido = descontoDeDisponibilidadeDoMes([...MENSAL(), ...MENSAL()], "ROTA");
    expect(lido.total).toBe(DO_DEMONSTRATIVO);
    expect(lido.conflitos).toEqual([]);
  });

  it("a mesma linha com valores diferentes recusa o total e nomeia o dia", () => {
    /*
      Duas emissões discordantes do 03.08.18 na mesma competência — ou um
      relatório com duas filiais, que esta leitura não distingue. Nos dois casos
      escolher uma é sortear.
    */
    const outraEmissao = { ...REAL.FF[2], total: 30000, equipe: 26969 };
    const lido = descontoDeDisponibilidadeDoMes(
      [...MENSAL(), dia("FF", "2026-07-20", outraEmissao)],
      "ROTA",
    );

    expect(lido.total).toBeNull();
    expect(lido.parcelas).toBeNull();
    expect(lido.agrupadoComoNoDemonstrativo).toBeNull();
    expect(lido.conflitos).toEqual([
      { aba: "FF", dia: "2026-07-20", valores: [REAL.FF[2].total, 30000] },
    ]);

    /* Os dias continuam sendo fato — é o valor deles que está em disputa. */
    expect(lido.dias).toBe(2);
    expect(lido.periodo).toEqual({ de: "2026-07-10", ate: "2026-07-20" });
  });

  it("o controle negativo: a regra antiga entregava um total, e era o da primeira linha", () => {
    /*
      Sem esta asserção o teste acima não prova nada: um total nulo poderia ser
      o comportamento de sempre. A regra antiga somava R$ 91.642,50 — o valor da
      linha que chegou primeiro — e ninguém ficava sabendo que havia disputa.
      Trocar a ordem das duas linhas dava outro total, do mesmo mês.
    */
    const antiga = (linhas: DiaDeDisponibilidade[]) => {
      const vistos = new Map<string, DiaDeDisponibilidade>();
      for (const d of linhas) {
        const chave = `${d.aba} ${d.dia}`;
        if (!vistos.has(chave)) vistos.set(chave, d);
      }
      return [...vistos.values()].reduce((s, d) => s + d.descontos.total, 0);
    };
    const outraEmissao = { ...REAL.FF[2], total: 30000, equipe: 26969 };
    const conflitante = dia("FF", "2026-07-20", outraEmissao);

    expect(antiga([...MENSAL(), conflitante])).toBe(DO_DEMONSTRATIVO);
    expect(antiga([conflitante, ...MENSAL()])).toBe(92566.88);
  });

  it("FF e Van do mesmo dia não são conflito — são dois descontos", () => {
    const lido = descontoDeDisponibilidadeDoMes(
      [dia("FF", "2026-07-10", REAL.FF[1]), dia("Van", "2026-07-10", REAL.Van[1])],
      "ROTA",
    );
    expect(lido.conflitos).toEqual([]);
    expect(lido.total).toBe(54155.08);
  });
});
