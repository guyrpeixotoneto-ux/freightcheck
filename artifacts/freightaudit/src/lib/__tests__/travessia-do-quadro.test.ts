import { describe, expect, it } from "vitest";
import { travessiaDoQuadro } from "../travessia-do-quadro";
import type { AuditoriaDoQuadro } from "../qlp-auditoria";

/**
 * A travessia para o quadro de pessoal.
 *
 * A pergunta que a produziu foi se o cartão do "onde aconteceu" não poderia
 * ranquear QLP administrativo e operacional junto do cavalo e da carreta. A
 * resposta está no cabeçalho de `lib/travessia-do-quadro.ts`: não, porque o QLP
 * é outra família de dados, com vigência própria e consolidada entre unidades.
 *
 * O que estes testes prendem é a consequência disso no desenho — **a vigência
 * do quadro viaja com o número, sempre**. É ela que impede uma contagem de
 * outra competência de ser lida como desta, que é o defeito que a faixa foi
 * escrita para não cometer.
 */

const auditoria = (over: Partial<AuditoriaDoQuadro> = {}): AuditoriaDoQuadro =>
  ({
    quadro: "ADMINISTRATIVO",
    effectiveDate: "2026-08-16",
    periodLabel: "Ago/2026",
    serieEntregue: true,
    colunasDesconhecidas: [],
    resumo: {
      quadro: "ADMINISTRATIVO",
      cargos: 34,
      conferem: 30,
      divergem: 4,
      semBase: 0,
      efetivo: 412,
      foraDaSoma: 9,
    },
    contas: [],
    benchmark: null,
    abono: null,
    linhas: [],
    ...over,
  }) as AuditoriaDoQuadro;

describe("a travessia para o quadro de pessoal", () => {
  it("publica a vigência **do quadro**, e não a da tela que pergunta", () => {
    /*
      O Panorama pode estar lendo agosto/2026 · 1ª quinzena do equipamento
      enquanto o quadro só tem a 2ª. Sem esta linha, "34 cargos" apareceria
      debaixo de um cabeçalho de outra competência.
    */
    const linhas = travessiaDoQuadro({ ADMINISTRATIVO: auditoria() });

    expect(linhas).toHaveLength(1);
    expect(linhas[0].rotulo).toBe("QLP Administrativo");
    /*
      A quinzena, e não só o mês: o `periodLabel` do servidor é mensal
      ("Ago/2026"), e uma pastilha mensal ao lado de uma tela que também lê
      agosto pareceria a mesma competência. `rotuloDaVigencia` escreve a
      quinzena a partir do dia 16.
    */
    expect(linhas[0].vigencia).toBe("agosto/2026 · 2ª quinzena");
    expect(linhas[0].href).toBe("/qlp-administrativo");
  });

  it("conta cargos e efetivo como coisas diferentes", () => {
    /* Cada linha é um cargo, não uma pessoa — quem diz quantas pessoas há é a
       coluna de quantidade. É a primeira lição do dicionário do QLP. */
    const linhas = travessiaDoQuadro({ ADMINISTRATIVO: auditoria() });
    expect(linhas[0].contagem).toBe("34 cargos · efetivo de 412");
  });

  it("efetivo ausente não vira zero", () => {
    /* O quadro pode não trazer a coluna, e "efetivo de 0" seria uma afirmação
       sobre a operação que o dado não sustenta. */
    const linhas = travessiaDoQuadro({
      ADMINISTRATIVO: auditoria({
        resumo: { ...auditoria().resumo, efetivo: null },
      }),
    });
    expect(linhas[0].contagem).toBe("34 cargos");
  });

  it("o quadro sem vigência importada não vira linha", () => {
    /*
      `null` é o 404 da rota traduzido — "este quadro não tem vigência
      importada" —, e é o caso comum do operacional enquanto o primeiro export
      não chega. Uma linha vazia ali convidaria para um módulo sem dado.
    */
    const linhas = travessiaDoQuadro({ ADMINISTRATIVO: auditoria(), OPERACIONAL: null });

    expect(linhas.map((l) => l.quadro)).toEqual(["ADMINISTRATIVO"]);
  });

  it("sem quadro nenhum não há faixa", () => {
    expect(travessiaDoQuadro({})).toEqual([]);
    expect(travessiaDoQuadro({ ADMINISTRATIVO: null, OPERACIONAL: null })).toEqual([]);
  });

  it("a vigência que não entregou este quadro diz isso, em vez de contar", () => {
    /*
      `serieEntregue: false` é o estado em que o acervo tem o quadro mas a
      quinzena aberta dele não trouxe o arquivo — chegou o administrativo e não
      o operacional, na mesma data. A linha continua (o módulo abre), e o que
      ela não faz é publicar a contagem de outra quinzena como se fosse desta.
    */
    const linhas = travessiaDoQuadro({
      OPERACIONAL: auditoria({
        quadro: "OPERACIONAL",
        serieEntregue: false,
        periodLabel: "Ago/2026",
        resumo: { ...auditoria().resumo, quadro: "OPERACIONAL", cargos: 0, efetivo: null },
      }),
    });

    expect(linhas[0].rotulo).toBe("QLP Operacional");
    expect(linhas[0].vigencia).toBe("agosto/2026 · 2ª quinzena");
    expect(linhas[0].contagem).toBeNull();
    expect(linhas[0].ressalva).toContain("não trouxe o arquivo");
    expect(linhas[0].href).toBe("/qlp-operacional");
  });

  it("sem a data, cai no rótulo mensal do servidor — e sem os dois não atravessa", () => {
    /*
      O caso é uma versão anterior da rota ainda em cache, de antes de ela
      devolver a vigência. O mensal é menos do que se quer aqui, mas é mais que
      nada; sem nenhum dos dois a contagem estaria certa e a única ressalva que
      a torna honesta nesta tela — de que quinzena ela é — estaria em branco.
    */
    const semData = { ...auditoria(), effectiveDate: "" } as AuditoriaDoQuadro;
    expect(travessiaDoQuadro({ ADMINISTRATIVO: semData })[0].vigencia).toBe("Ago/2026");

    const semNada = { ...semData, periodLabel: "" } as AuditoriaDoQuadro;
    expect(travessiaDoQuadro({ ADMINISTRATIVO: semNada })).toEqual([]);
  });

  it("os dois quadros saem na mesma ordem, com a vigência de cada um", () => {
    /* As duas podem ser datas diferentes: o quadro forma vigências próprias, e
       cada linha responde pela sua. */
    const linhas = travessiaDoQuadro({
      ADMINISTRATIVO: auditoria({ periodLabel: "Ago/2026" }),
      OPERACIONAL: auditoria({
        quadro: "OPERACIONAL",
        effectiveDate: "2026-07-01",
        periodLabel: "Jul/2026",
        resumo: { ...auditoria().resumo, quadro: "OPERACIONAL", cargos: 12, efetivo: 88 },
      }),
    });

    expect(linhas.map((l) => [l.rotulo, l.vigencia, l.contagem])).toEqual([
      ["QLP Administrativo", "agosto/2026 · 2ª quinzena", "34 cargos · efetivo de 412"],
      ["QLP Operacional", "julho/2026 · 1ª quinzena", "12 cargos · efetivo de 88"],
    ]);
  });
});
