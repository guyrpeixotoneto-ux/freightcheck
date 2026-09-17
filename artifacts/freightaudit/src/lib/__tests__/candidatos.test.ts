import { describe, expect, it } from "vitest";
import { numerosDaLinha } from "../candidatos";

/**
 * O que o menu escreve ao lado de cada vigência.
 *
 * A regressão que este bloco guarda é uma frase: **ausência não é zero**. Um
 * par que o servidor ainda não calculou não tem número, e escrever "0
 * alterações" ali seria responder com um número uma pergunta que não foi feita
 * — numa tela de auditoria, a pior forma de errar.
 *
 * A recíproca é a outra metade, e é o que mudou em 16/09/2026: **zero não é
 * ausência**. Calculado o par, a linha escreve o dinheiro e a contagem sempre,
 * mesmo quando os dois dão zero. A coluna em branco ficou sendo uma coisa só —
 * "ainda não calculei" — em vez de duas.
 */
describe("os números de cada linha do menu", () => {
  /** Uma rubrica: um balde por periodicidade, lido pelo sinal do líquido. */
  const comImpacto = (
    alteracoes: number,
    porPeriodicidade: Record<string, number>,
  ) => ({
    alteracoes,
    impacto: {
      baldes: Object.entries(porPeriodicidade).map(([periodicidade, valor]) => ({
        periodicidade,
        valor,
      })),
    },
  });

  /**
   * O recorte que **não mede** dinheiro — hoje só o QLP.
   *
   * É o avesso exato do caso de cima, e a distância entre os dois é a razão de
   * `semImpacto` existir. `R$ 0,00` diz "calculei, e deu zero"; escrevê-lo num
   * recorte que nunca olhou para dinheiro seria a tela afirmando uma conta que
   * ninguém fez — e a contagem ao lado sobreviveria dizendo que algo mudou, o
   * que deixaria a linha se contradizendo sozinha.
   */
  describe("quando o recorte não mede dinheiro", () => {
    const semImpacto = (alteracoes: number) => ({
      alteracoes,
      impacto: { baldes: [] },
      semImpacto:
        "As colunas do QLP chegam sem semântica confirmada, e somar o que a " +
        "curadoria não confirmou seria adivinhação.",
    });

    it("cala a coluna do dinheiro, e mantém a contagem", () => {
      const linha = numerosDaLinha(semImpacto(7));

      expect(linha?.valores).toEqual([]);
      expect(linha?.alteracoes).toBe("7 alterações");
    });

    it("não escreve R$ 0,00 nem quando nada mudou", () => {
      const linha = numerosDaLinha(semImpacto(0));

      expect(linha?.valores).toEqual([]);
      expect(linha?.alteracoes).toBe("0 alterações");
    });

    /* E continua sendo outra coisa que "ainda não calculei": a linha existe. */
    it("é diferente de não ter sido calculado", () => {
      expect(numerosDaLinha(semImpacto(0))).not.toBeNull();
      expect(numerosDaLinha(null)).toBeNull();
    });
  });

  it("não escreve número nenhum para quem ainda não foi calculado", () => {
    expect(numerosDaLinha(null)).toBeNull();
  });

  /* O outro lado da mesma moeda: nada mudou **é** resposta, e vem zerada. */
  it("escreve os zeros quando o cálculo aconteceu e deu zero", () => {
    const linha = numerosDaLinha(comImpacto(0, {}));

    expect(linha?.alteracoes).toBe("0 alterações");
    /*
      Sem balde nenhum no impacto, o zero sai sem periodicidade: `R$ 0,00/mês`
      afirmaria que o que não mudou era mensal, e não há balde que sustente a
      frase. `bruto` em zero é o que faz o seletor pintar a linha de neutro —
      nem ganho, nem perda.
    */
    expect(linha?.valores).toEqual([
      { texto: "R$ 0,00", bruto: 0, leitura: "NEUTRO" },
    ]);
  });

  /*
    O sinal no lugar da palavra: negativo é perda, positivo é ganho, e o valor
    vem em módulo. O prefixo é quem carrega a direção — "−−R$ 302.261,18" diria
    a mesma coisa duas vezes.
  */
  it("escreve o dinheiro com a periodicidade, e a leitura certa", () => {
    const linha = numerosDaLinha(comImpacto(457, { MENSAL: -302261.18 }));

    expect(linha?.alteracoes).toBe("457 alterações");
    expect(linha?.valores).toHaveLength(1);
    expect(linha?.valores[0].texto).toBe("−R$ 302.261,18/mês");
    expect(linha?.valores[0].leitura).toBe("PERDA");
    expect(linha?.valores[0].bruto).toBeLessThan(0);
  });

  it("positivo é ganho, e é a mesma régua", () => {
    const linha = numerosDaLinha(comImpacto(7, { MENSAL: 7238.85 }));

    expect(linha?.valores[0].texto).toBe("+R$ 7.238,85/mês");
    expect(linha?.valores[0].leitura).toBe("GANHO");
  });

  it("uma alteração no singular", () => {
    expect(numerosDaLinha(comImpacto(1, {}))?.alteracoes).toBe("1 alteração");
  });

  /*
    Duas periodicidades viram duas linhas, e nunca uma soma: a parcela é mensal
    e a base de compra é do ato da compra. Somá-las aqui publicaria um total que
    `impactoPorPeriodicidade` se recusa a calcular.
  */
  it("não soma periodicidades diferentes num número só", () => {
    const linha = numerosDaLinha(
      comImpacto(12, { MENSAL: -1000, PONTUAL: -50000 }),
    );

    expect(linha?.valores).toHaveLength(2);
    expect(linha?.valores.map((v) => v.bruto)).toEqual([-1000, -50000]);
  });

  /*
    Três alterações que não moveram dinheiro: a linha diz as duas coisas.

    O balde `MENSAL: 0` continua não virando `R$ 0,00/mês` — a periodicidade
    seria uma afirmação sobre um movimento que não houve. O que sobra é o zero
    seco, que é a notícia: mudou coisa, e não custou nada.
  */
  it("escreve R$ 0,00 quando nenhum balde tem impacto", () => {
    const linha = numerosDaLinha(comImpacto(3, { MENSAL: 0 }));

    expect(linha?.valores).toEqual([
      { texto: "R$ 0,00", bruto: 0, leitura: "NEUTRO" },
    ]);
    expect(linha?.alteracoes).toBe("3 alterações");
  });

  /* Com algum balde valorado, o zero dos outros continua fora da linha. */
  it("o balde zerado não rouba a linha de quem tem notícia", () => {
    const linha = numerosDaLinha(comImpacto(9, { ANUAL: 0, MENSAL: 1200 }));

    expect(linha?.valores.map((v) => v.bruto)).toEqual([1200]);
  });

  /*
    O Monitor Custo Fixo lê os cinco módulos de uma vez. Houve aqui duas linhas
    por periodicidade, uma de custo e uma de receita, porque o que positivo
    queria dizer dependia do lado da DRE. Não depende mais: os cinco falam o
    idioma de quem recebe, positivo é ganho e negativo é perda, e a
    periodicidade volta a ter uma linha com o líquido dela.

    O que continua valendo é a régua de sempre — o sinal do líquido —, e a
    recusa que sobrou: duas periodicidades nunca viram uma.
  */
  describe("quando o recorte consolida vários módulos", () => {
    const doMonitor = (
      alteracoes: number,
      baldes: { periodicidade: string; valor: number }[],
    ) => ({ alteracoes, impacto: { baldes } });

    it("uma linha por periodicidade, lida pelo sinal do líquido", () => {
      const linha = numerosDaLinha(
        doMonitor(31, [
          { periodicidade: "MENSAL", valor: 1200 },
          { periodicidade: "ANUAL", valor: -900 },
        ]),
      );

      expect(linha?.valores).toHaveLength(2);
      expect(linha?.valores[0].texto).toBe("−R$ 900,00/ano");
      expect(linha?.valores[1].texto).toBe("+R$ 1.200,00/mês");
      /* 1200 e −900 continuam dois números: R$/mês não soma com R$/ano. */
      expect(linha?.valores.map((v) => v.bruto)).toEqual([-900, 1200]);
      expect(linha?.valores.map((v) => v.leitura)).toEqual(["PERDA", "GANHO"]);
    });

    /* A periodicidade que não se moveu não ocupa linha. */
    it("a periodicidade que não se moveu não vira linha", () => {
      const linha = numerosDaLinha(
        doMonitor(4, [
          { periodicidade: "MENSAL", valor: 1200 },
          { periodicidade: "ANUAL", valor: 0 },
        ]),
      );

      expect(linha?.valores.map((v) => v.texto)).toEqual(["+R$ 1.200,00/mês"]);
    });

    /*
      Nada se moveu em periodicidade nenhuma: volta o zero seco, sem
      periodicidade. Escrever "R$ 0,00/mês" escolheria uma das periodicidades
      para responder por um recorte em que nenhuma tem o que dizer.
    */
    it("todas as periodicidades zeradas voltam ao zero seco", () => {
      const linha = numerosDaLinha(
        doMonitor(3, [
          { periodicidade: "MENSAL", valor: 0 },
          { periodicidade: "ANUAL", valor: 0 },
        ]),
      );

      expect(linha?.valores).toEqual([
        { texto: "R$ 0,00", bruto: 0, leitura: "NEUTRO" },
      ]);
      expect(linha?.alteracoes).toBe("3 alterações");
    });
  });
  /**
   * O MOVIMENTO DA ALÍQUOTA — a coluna que os Impostos pediram.
   *
   * Naquele módulo o dinheiro do menu é `R$ 0,00` em toda linha por
   * construção: o montante de ICMS é zero nas 1.215 linhas do acervo e o
   * PIS/COFINS de aquisição é 9,250% da nota em todas elas. A grandeza que
   * distingue uma candidata da outra ali é o ponto percentual, e é ela que
   * estas frases escrevem.
   *
   * A régua que este bloco prende é a de sempre, na terceira grandeza:
   * **ausência não é zero, e zero não é ausência**. Recorte que não audita
   * percentual não ganha linha nenhuma; recorte que audita e não viu nada
   * andar escreve que não viu — e não deixa a casa em branco, que nesta tela
   * já quer dizer "ainda não calculei".
   */
  describe("o movimento das alíquotas", () => {
    const comPercentuais = (
      percentuais: {
        rotulo: string;
        alteradas: number;
        maior: number | null;
        ambasDirecoes: boolean;
      }[],
    ) => ({ alteracoes: 0, impacto: { baldes: [] }, percentuais });

    it("a rubrica que não audita percentual segue sem linha nenhuma", () => {
      expect(numerosDaLinha(comImpacto(7, { MENSAL: 1200 }))?.percentuais).toEqual([]);
    });

    it("auditou e nada andou — e isso se escreve, não se cala", () => {
      expect(numerosDaLinha(comPercentuais([]))?.percentuais).toEqual([
        "sem movimento de alíquota",
      ]);
    });

    it("uma alíquota só: o número é ela, com sinal", () => {
      const linha = numerosDaLinha(
        comPercentuais([
          { rotulo: "ICMS", alteradas: 1, maior: 2, ambasDirecoes: false },
        ]),
      );

      expect(linha?.percentuais).toEqual(["ICMS +2,000 p.p."]);
    });

    /* "Até", e não um total: o maior movimento responde, a soma mentiria. */
    it("várias no mesmo sentido saem como o maior movimento, com a contagem", () => {
      const linha = numerosDaLinha(
        comPercentuais([
          { rotulo: "ICMS", alteradas: 3, maior: -6, ambasDirecoes: false },
        ]),
      );

      expect(linha?.percentuais).toEqual(["ICMS até −6,000 p.p. · 3 alíquotas"]);
    });

    it("nos dois sentidos, o sinal some — ele descreveria metade da frota", () => {
      const linha = numerosDaLinha(
        comPercentuais([
          { rotulo: "ICMS", alteradas: 2, maior: -6, ambasDirecoes: true },
        ]),
      );

      expect(linha?.percentuais).toEqual([
        "ICMS até 6,000 p.p. nos dois sentidos · 2 alíquotas",
      ]);
    });

    it("alterada sem medida diz isso — nunca 0,000 p.p.", () => {
      const linha = numerosDaLinha(
        comPercentuais([
          { rotulo: "PIS/COFINS", alteradas: 1, maior: null, ambasDirecoes: false },
        ]),
      );

      expect(linha?.percentuais).toEqual([
        "PIS/COFINS · 1 alíquota, movimento não medido",
      ]);
    });

    it("um tributo por linha — ICMS e PIS/COFINS nunca viram um número só", () => {
      const linha = numerosDaLinha(
        comPercentuais([
          { rotulo: "ICMS", alteradas: 1, maior: 2, ambasDirecoes: false },
          { rotulo: "PIS/COFINS", alteradas: 1, maior: -0.05, ambasDirecoes: false },
        ]),
      );

      expect(linha?.percentuais).toEqual([
        "ICMS +2,000 p.p.",
        "PIS/COFINS −0,050 p.p.",
      ]);
    });

    /* O dinheiro continua sendo dito: as duas colunas convivem na mesma linha. */
    it("não substitui a coluna do dinheiro", () => {
      const linha = numerosDaLinha(comPercentuais([]));

      expect(linha?.valores).toEqual([
        { texto: "R$ 0,00", bruto: 0, leitura: "NEUTRO" },
      ]);
      expect(linha?.alteracoes).toBe("0 alterações");
    });
  });

  /**
   * A rubrica **mede** dinheiro, e mesmo assim não tem o que publicar.
   *
   * É o caso da Auditoria de Seguro, e é diferente do QLP logo acima: lá
   * nenhuma coluna é monetária; aqui o seguro é dinheiro, mudou — de R$ 180,79
   * para R$ 631,41 numa carreta, de R$ 159,80 para R$ 476,87 noutra — e a
   * curadoria ainda não confirmou a semântica, então o motor recusa
   * monetizá-lo. `R$ 0,00` ali afirmaria que o dinheiro não se moveu, ao lado
   * de uma contagem dizendo que dois seguros mudaram: a linha se contradizendo
   * sozinha, e discordando do cartão da mesma tela.
   */
  describe("quando a rubrica mede dinheiro mas a curadoria não confirmou", () => {
    /* O payload como `/seguro/candidatos` passou a respondê-lo. */
    const doSeguro = (alteracoes: number) => ({
      alteracoes,
      impacto: { baldes: [] },
      semImpacto:
        "O aparato se moveu, e nenhuma das colunas monetárias desta rubrica " +
        "tem semântica confirmada pela curadoria.",
    });

    it("não escreve R$ 0,00, e mantém a contagem do que mudou", () => {
      const linha = numerosDaLinha(doSeguro(15));

      expect(linha?.valores).toEqual([]);
      expect(linha?.alteracoes).toBe("15 alterações");
    });

    /* O dia da confirmação: o mesmo recorte, agora com balde, volta a escrever
       o dinheiro — sem que nada nesta função saiba de qual rubrica se trata. */
    it("confirmada a semântica, a mesma linha publica o valor", () => {
      const linha = numerosDaLinha(comImpacto(15, { MENSAL: 767.69 }));

      expect(linha?.valores[0].texto).toBe("+R$ 767,69/mês");
      expect(linha?.alteracoes).toBe("15 alterações");
    });
  });
});
