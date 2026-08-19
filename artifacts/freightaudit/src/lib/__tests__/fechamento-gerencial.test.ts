import { describe, expect, it } from "vitest";
import {
  anosComCompetencia,
  hojeEm,
  percentualConferido,
  periodoDaQuinzena,
  periodosDoAno,
  quinzenasDoAno,
  resumirUnidades,
  resumoExecutivo,
} from "../fechamento-gerencial";
import type { Competencia, ResumoDeApuracao } from "@/lib/fechamento";

/**
 * O que a Visão Gerencial decide sozinha.
 *
 * É a home do ambiente Fechamento: a tela que responde antes de perguntar, com
 * um percentual por unidade lido por quem tem menos contexto. Nada aqui testa
 * pixel. O que roda são as decisões que, se errarem, fazem a tela mentir com
 * aparência de total:
 *
 * 1. o período da quinzena, que precisa ser o mesmo que o servidor grava;
 * 2. a grade do ano, que nasce com as 24 casas e não com as que têm dado;
 * 3. a diferença entre a quinzena que passou vazia e a que ainda não venceu;
 * 4. o denominador do percentual de fechamento, que é a competência e não o
 *    calendário;
 * 5. os totais, que só somam o que a apuração gravou.
 */

const HOJE = "2026-08-19";

/** Uma competência com o mínimo que os testes precisam nomear. */
function comp(entrada: {
  unidade?: string;
  nomeDaUnidade?: string | null;
  transportadora?: { codigo: string; nome: string | null };
  ano?: number;
  mes?: number;
  quinzena?: 1 | 2;
  estado?: Competencia["estado"];
}): Competencia {
  const ano = entrada.ano ?? 2026;
  const mes = entrada.mes ?? 8;
  const quinzena = entrada.quinzena ?? 1;
  const codigo = entrada.unidade ?? "CDD1";
  const transportadora = entrada.transportadora ?? { codigo: "T1", nome: "Horizonte" };
  const base = periodoDaQuinzena(ano, mes, quinzena);
  const estado = entrada.estado ?? "ABERTA";
  return {
    id: `${codigo}|${transportadora.codigo}|${base.chave}`,
    chave: base.chave,
    ano,
    mes,
    quinzena,
    inicio: base.inicio,
    fim: base.fim,
    rotulo: `${base.inicio.slice(8, 10)}/${base.inicio.slice(5, 7)}/${ano}`,
    unidade: { codigo, nome: entrada.nomeDaUnidade ?? null },
    transportadora,
    estado,
    abertaEm: `${base.inicio}T00:00:00.000Z`,
    apuradaEm: null,
    encerradaEm: estado === "ENCERRADA" ? `${base.fim}T23:00:00.000Z` : null,
    motivoDaReabertura: null,
  };
}

function linha(
  competencia: Competencia,
  apuracao?: Partial<NonNullable<ResumoDeApuracao["apuracao"]>>,
): ResumoDeApuracao {
  return {
    competencia,
    relatorios: [],
    apuracao: apuracao
      ? {
          rodadaEm: `${competencia.fim}T12:00:00.000Z`,
          emitido: 0,
          naoConferido: 0,
          diferenca: 0,
          aQuestionar: 0,
          aQuestionarQuantidade: 0,
          ...apuracao,
        }
      : null,
  };
}

describe("o período da quinzena", () => {
  /*
    A interface remonta a quinzena em vez de importar `@workspace/fechamento`: o
    bundle da tela não carrega o motor de apuração, e por isso o pacote não é
    dependência daqui — nem para o teste, que abriria a porta para o código do
    app importá-lo por acidente.

    O preço dessa fronteira é este teste. Ele prende os valores que o servidor
    grava em `fechamento_competencia` (`periodo.ts` do motor: chave, primeiro e
    último dia), escritos à mão para que uma mudança de regra lá reprove aqui em
    vez de a tela passar a mostrar a competência do servidor na casa errada da
    grade.
  */
  it("grava a chave e os dias que o motor de fechamento grava", () => {
    expect(periodoDaQuinzena(2026, 8, 1)).toMatchObject({
      chave: "2026-08-Q1",
      inicio: "2026-08-01",
      fim: "2026-08-15",
    });
    expect(periodoDaQuinzena(2026, 8, 2)).toMatchObject({
      chave: "2026-08-Q2",
      inicio: "2026-08-16",
      fim: "2026-08-31",
    });
    expect(periodoDaQuinzena(2026, 4, 2).fim).toBe("2026-04-30");
  });

  it("cobre o ano inteiro sem buraco nem sobreposição", () => {
    const dias = periodosDoAno(2026);

    expect(dias).toHaveLength(24);
    expect(dias[0].inicio).toBe("2026-01-01");
    expect(dias[23].fim).toBe("2026-12-31");
    for (let i = 1; i < dias.length; i += 1) {
      const anterior = new Date(`${dias[i - 1].fim}T00:00:00Z`).getTime();
      const atual = new Date(`${dias[i].inicio}T00:00:00Z`).getTime();
      expect(atual - anterior).toBe(86_400_000);
    }
  });

  it("fecha fevereiro no dia que o ano tem — 28 em 2026, 29 em 2024", () => {
    expect(periodoDaQuinzena(2026, 2, 2).fim).toBe("2026-02-28");
    expect(periodoDaQuinzena(2024, 2, 2).fim).toBe("2024-02-29");
  });

  it("lê o dia de hoje no fuso de quem lê, e não em UTC", () => {
    // 15/08 às 21h em Brasília (UTC−3) já é 16/08 em UTC. A quinzena que corre
    // para quem opera é a primeira, e é essa que a tela precisa enxergar.
    expect(hojeEm(new Date(2026, 7, 15, 21, 0, 0))).toBe("2026-08-15");
  });
});

describe("a grade do ano", () => {
  /*
    A quinzena que passou sem competência aberta é a informação mais importante
    desta tela, e ela só existe se houver uma casa vazia esperando por ela.
    Montar a grade a partir do que existe faria o buraco desaparecer — que é o
    contrário do que a grade serve para mostrar.
  */
  it("tem 24 casas em ordem de calendário, mesmo sem competência nenhuma", () => {
    const grade = quinzenasDoAno([], 2026, HOJE);

    expect(grade).toHaveLength(24);
    expect(grade[0].chave).toBe("2026-01-Q1");
    expect(grade[23].chave).toBe("2026-12-Q2");
    expect(grade.every((q) => q.competencias.length === 0)).toBe(true);
  });

  it("separa a quinzena que passou vazia da que ainda não venceu", () => {
    const grade = quinzenasDoAno([], 2026, HOJE);
    const em = (chave: string) => grade.find((q) => q.chave === chave)!.situacao;

    expect(em("2026-07-Q2")).toBe("SEM_COMPETENCIA");
    // 16 a 31/08 ainda corre em 19/08: não é buraco, é calendário.
    expect(em("2026-08-Q2")).toBe("FUTURA");
    expect(em("2026-12-Q2")).toBe("FUTURA");
  });

  it("chama de vencida a competência aberta cuja quinzena já terminou", () => {
    const grade = quinzenasDoAno(
      [linha(comp({ mes: 7, quinzena: 2 })), linha(comp({ mes: 8, quinzena: 2 }))],
      2026,
      HOJE,
    );
    const em = (chave: string) => grade.find((q) => q.chave === chave)!.situacao;

    expect(em("2026-07-Q2")).toBe("VENCIDA");
    expect(em("2026-08-Q2")).toBe("EM_CURSO");
  });

  /*
    Uma unidade pode ter mais de uma competência na mesma quinzena — uma por
    transportadora. A quinzena só está encerrada quando todas estiverem: dar a
    casa por fechada com uma transportadora em aberto é declarar fechado um
    período que ainda deve dinheiro.
  */
  it("só encerra a quinzena quando todas as competências dela encerraram", () => {
    const uma = comp({ mes: 7, quinzena: 1, estado: "ENCERRADA" });
    const outra = comp({
      mes: 7,
      quinzena: 1,
      estado: "APURADA",
      transportadora: { codigo: "T2", nome: "Aurora" },
    });

    expect(quinzenasDoAno([linha(uma), linha(outra)], 2026, HOJE)[12].situacao).toBe("VENCIDA");
    expect(quinzenasDoAno([linha(uma)], 2026, HOJE)[12].situacao).toBe("ENCERRADA");
  });

  it("soma na casa da quinzena só o que a apuração gravou", () => {
    const grade = quinzenasDoAno(
      [
        linha(comp({ mes: 7, quinzena: 1 }), { emitido: 100, naoConferido: 20, aQuestionar: 5, aQuestionarQuantidade: 1 }),
        linha(
          comp({ mes: 7, quinzena: 1, transportadora: { codigo: "T2", nome: "Aurora" } }),
        ),
      ],
      2026,
      HOJE,
    );

    expect(grade[12]).toMatchObject({
      competencias: expect.objectContaining({ length: 2 }),
      apuradas: 1,
      emitido: 100,
      naoConferido: 20,
      aQuestionar: 5,
      aQuestionarQuantidade: 1,
    });
  });
});

describe("o resumo por unidade", () => {
  const linhas = [
    // CDD1: duas encerradas, uma vencida em aberto.
    linha(comp({ unidade: "CDD1", mes: 5, quinzena: 1, estado: "ENCERRADA" }), { emitido: 1000, naoConferido: 100 }),
    linha(comp({ unidade: "CDD1", mes: 5, quinzena: 2, estado: "ENCERRADA" }), { emitido: 1000, naoConferido: 0 }),
    linha(comp({ unidade: "CDD1", mes: 6, quinzena: 1, estado: "APURADA" }), {
      emitido: 500,
      naoConferido: 50,
      aQuestionar: 80,
      aQuestionarQuantidade: 2,
    }),
    // CDD2: uma só, e ainda em curso.
    linha(comp({ unidade: "CDD2", mes: 8, quinzena: 2, estado: "ABERTA" })),
  ];

  /*
    O denominador é a competência que existe, não a quinzena do calendário. Uma
    unidade que abriu a primeira competência em maio não está reprovada por
    janeiro: o sistema não sabe se ela deveria ter operado. O que o calendário
    tem a dizer vira `lacunas`, contado à parte e só nas quinzenas já vencidas.
  */
  it("mede o fechamento sobre as competências do ano, e conta a lacuna à parte", () => {
    const [cdd1] = resumirUnidades(linhas, 2026, HOJE).filter((u) => u.codigo === "CDD1");

    expect(cdd1.competencias).toBe(3);
    expect(cdd1.encerradas).toBe(2);
    expect(cdd1.percentualEncerrado).toBeCloseTo(66.67, 1);
    expect(cdd1.vencidas).toBe(1);
    expect(cdd1.emCurso).toBe(0);
    // 24 quinzenas, 15 já vencidas em 19/08 (jan a jul inteiros, mais 01–15/08),
    // e 3 delas têm competência.
    expect(cdd1.lacunas).toBe(12);
  });

  it("não conta como vencida a competência cuja quinzena ainda corre", () => {
    const [cdd2] = resumirUnidades(linhas, 2026, HOJE).filter((u) => u.codigo === "CDD2");

    expect(cdd2.vencidas).toBe(0);
    expect(cdd2.emCurso).toBe(1);
    expect(cdd2.percentualEncerrado).toBe(0);
  });

  /*
    A ordem é a do trabalho que falta, e não a alfabética: quem tem quinzena
    vencida em aberto vem primeiro. É a mesma regra dos contadores da lateral —
    destaque para o que tem fila atrás.
  */
  it("põe na frente a unidade com mais quinzena vencida em aberto", () => {
    expect(resumirUnidades(linhas, 2026, HOJE).map((u) => u.codigo)).toEqual(["CDD1", "CDD2"]);
  });

  it("ignora o que é de outro ano", () => {
    const comOutroAno = [...linhas, linha(comp({ unidade: "CDD9", ano: 2025, mes: 3 }))];

    expect(resumirUnidades(comOutroAno, 2026, HOJE).map((u) => u.codigo)).not.toContain("CDD9");
    expect(anosComCompetencia(comOutroAno)).toEqual([2026, 2025]);
  });

  /*
    A lista chega do servidor da quinzena mais nova para a mais antiga, e uma
    unidade renomeada deve aparecer pelo nome de agora — não pelo primeiro que
    já teve.
  */
  it("nomeia a unidade pelo nome mais recente que ela recebeu", () => {
    const [u] = resumirUnidades(
      [
        linha(comp({ unidade: "CDD1", mes: 7, nomeDaUnidade: "CDD Olinda" })),
        linha(comp({ unidade: "CDD1", mes: 5, nomeDaUnidade: "Olinda" })),
        linha(comp({ unidade: "CDD1", mes: 3 })),
      ],
      2026,
      HOJE,
    );

    expect(u.nome).toBe("CDD Olinda");
  });
});

describe("o resumo executivo do ano", () => {
  it("soma as unidades e devolve nulo onde não há o que medir", () => {
    const vazio = resumoExecutivo([]);

    expect(vazio.unidades).toBe(0);
    expect(vazio.percentualEncerrado).toBeNull();
    expect(vazio.percentualConferido).toBeNull();
  });

  it("soma o que as unidades trazem, sem recompor nada", () => {
    const unidades = resumirUnidades(
      [
        linha(comp({ unidade: "CDD1", mes: 5, estado: "ENCERRADA" }), { emitido: 1000, naoConferido: 100 }),
        linha(comp({ unidade: "CDD2", mes: 5, estado: "APURADA" }), {
          emitido: 1000,
          naoConferido: 300,
          aQuestionar: 40,
          aQuestionarQuantidade: 3,
        }),
      ],
      2026,
      HOJE,
    );
    const total = resumoExecutivo(unidades);

    expect(total.unidades).toBe(2);
    expect(total.competencias).toBe(2);
    expect(total.encerradas).toBe(1);
    expect(total.percentualEncerrado).toBe(50);
    expect(total.emitido).toBe(2000);
    expect(total.percentualConferido).toBe(80);
    expect(total.aQuestionar).toBe(40);
    expect(total.aQuestionarQuantidade).toBe(3);
  });

  /*
    `0/0` não é 100% conferido nem 0%: é um período sem o que conferir. A barra
    cheia ali seria mentira por arredondamento.
  */
  it("não dá percentual de conferência quando não houve emissão", () => {
    expect(percentualConferido({ emitido: 0, naoConferido: 0 })).toBeNull();
    expect(percentualConferido({ emitido: 100, naoConferido: 25 })).toBe(75);
  });
});
