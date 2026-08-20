import { describe, expect, it } from "vitest";
import type { AtributoNaPonta, UniversoDoTipo } from "../analise";
import {
  agruparPorParametro,
  blocosDaPosicao,
  totaisDaPosicao,
  TIPOS_DA_REMUNERACAO,
} from "../posicao";

/**
 * As regras da tela de posição.
 *
 * O defeito que estes testes existem para impedir é o silêncio: uma tela que se
 * apresenta como *o retrato da remuneração inteira* e engole a linha que não
 * soube arrumar. Um bloco que some, um equipamento novo que não aparece, um
 * atributo sem tipo que desaparece da contagem — nenhum deles dá erro, e todos
 * fazem a tela afirmar completude que não tem.
 *
 * O segundo é o denominador. "34 de 34" é uma frase que não informa nada, e é
 * exactamente o que sai de contar as linhas da própria tela. O denominador tem
 * de vir do universo canônico, e os contadores do topo têm de ser a soma dos
 * blocos — nunca uma segunda contagem que possa discordar deles.
 */

const linha = (patch: Partial<AtributoNaPonta> = {}): AtributoNaPonta => ({
  key: `${patch.attributeCode ?? "x"}|${patch.entityType ?? "CAVALO"}`,
  attributeCode: "cavalo.finame_cavalo",
  entityType: "CAVALO",
  equipment: "cavalo",
  title: "FINAME",
  parameterKey: "FROTA|Financiamento",
  parameterName: "Financiamento",
  family: "FROTA",
  unit: null,
  posicao: "DIFERENTE",
  vehicles: 5,
  fleet: 62,
  coverage: "PARCIAL",
  coverageLabel: "5 de 62 cavalos",
  aggregate: null,
  dominantPattern: null,
  patterns: 1,
  impact: {
    byPeriodicity: {},
    brutoByPeriodicity: {},
    notCalculable: 0,
    calculatedChanges: 0,
  },
  foraDaSoma: null,
  movimentacoes: { vigencias: 1, ativos: 5 },
  inconclusiveReason: null,
  groups: [],
  ...patch,
});

const tipo = (patch: Partial<UniversoDoTipo> = {}): UniversoDoTipo => ({
  entityType: "CAVALO",
  equipment: "cavalo",
  from: "2026-01-02",
  fromLabel: "jan/2026",
  to: "2026-08-01",
  toLabel: "ago/2026",
  vigencias: [{ date: "2026-01-02", label: "jan/2026" }],
  reason: null,
  fleet: 62,
  atributos: 70,
  alterados: 24,
  revertidos: 11,
  ...patch,
});

describe("os blocos da tela", () => {
  it("os cinco tipos aparecem sempre, mesmo sem vigência nenhuma", () => {
    const { blocos } = blocosDaPosicao([], []);

    expect(blocos.map((b) => b.tipo.entityType)).toEqual([
      "CAVALO",
      "CARRETA",
      "TRECHO",
      "QLP_ADMINISTRATIVO",
      "QLP_OPERACIONAL",
    ]);
    // Sem universo é o que faz o bloco explicar-se em vez de aparecer vazio.
    for (const bloco of blocos) {
      expect(bloco.universo).toBeNull();
      expect(bloco.linhas).toEqual([]);
      expect(bloco.tipo.semDado.length).toBeGreaterThan(0);
    }
  });

  it("não existe bloco de conjunto — conjunto é escopo, não equipamento", () => {
    /*
      Um sexto bloco mostraria pela terceira vez o dinheiro que a dedução retira
      da soma justamente para não o contar duas vezes. O conjunto aparece como
      selo na linha, alimentado por `foraDaSoma`.
    */
    expect(TIPOS_DA_REMUNERACAO.map((t) => t.entityType)).not.toContain("CONJUNTO");

    const { blocos } = blocosDaPosicao(
      [],
      [
        linha({
          entityType: "CARRETA",
          attributeCode: "carreta.finame",
          foraDaSoma: {
            motivo: "ESCOPO_DE_CONJUNTO",
            explicacao: "O cavalo vinculado responde por este valor.",
            ativos: 15,
            valor: -65708.81,
          },
        }),
      ],
    );
    expect(blocos.map((b) => b.tipo.entityType)).not.toContain("CONJUNTO");
    expect(blocos.find((b) => b.tipo.entityType === "CARRETA")!.linhas).toHaveLength(1);
  });

  it("um equipamento que a lista não nomeia ganha bloco na mesma", () => {
    /*
      A lista dos cinco é o que sabemos hoje, e não um filtro. Um DOLLY que
      entrasse no export sumiria de uma tela que promete o retrato inteiro — e
      sumiria calado, que é a pior forma.
    */
    const { blocos } = blocosDaPosicao(
      [tipo({ entityType: "DOLLY", equipment: "dolly", atributos: 9, alterados: 2 })],
      [linha({ entityType: "DOLLY", attributeCode: "dolly.eixo" })],
    );

    const dolly = blocos.find((b) => b.tipo.entityType === "DOLLY");
    expect(dolly).toBeDefined();
    expect(dolly!.tipo.titulo).toBe("dolly");
    expect(dolly!.linhas).toHaveLength(1);
    // E vem depois dos conhecidos, que é a ordem em que a operação se lê.
    expect(blocos.at(-1)!.tipo.entityType).toBe("DOLLY");
  });

  it("a linha sem equipamento não cabe em bloco e não some", () => {
    const orfa = linha({ entityType: null, attributeCode: "sem_tipo", title: "Órfã" });
    const { blocos, semEquipamento } = blocosDaPosicao([tipo()], [linha(), orfa]);

    expect(semEquipamento).toEqual([orfa]);
    for (const bloco of blocos) {
      expect(bloco.linhas).not.toContain(orfa);
    }
  });

  it("cada linha entra no bloco do próprio equipamento, e em nenhum outro", () => {
    const doCavalo = linha({ entityType: "CAVALO" });
    const daCarreta = linha({ entityType: "CARRETA", attributeCode: "carreta.finame" });
    const { blocos } = blocosDaPosicao(
      [tipo(), tipo({ entityType: "CARRETA", equipment: "carreta" })],
      [doCavalo, daCarreta],
    );

    expect(blocos.find((b) => b.tipo.entityType === "CAVALO")!.linhas).toEqual([doCavalo]);
    expect(blocos.find((b) => b.tipo.entityType === "CARRETA")!.linhas).toEqual([daCarreta]);
  });

  it("o bloco de calendário próprio chega com as vigências dele e sem pontas", () => {
    /*
      É a forma do QLP: outra família de dados, calendário próprio. O universo
      chega do servidor já a dizer que não houve comparação — a tela não deduz
      isso, e por isso não tem como enganar-se a dizer que houve.
    */
    const qlp = tipo({
      entityType: "QLP_ADMINISTRATIVO",
      equipment: "QLP administrativo",
      from: null,
      fromLabel: null,
      to: null,
      toLabel: null,
      reason: "Este equipamento não tem vigência nas duas pontas do período.",
      vigencias: [{ date: "2026-02-15", label: "fev/2026" }],
      atributos: 35,
      alterados: 0,
      revertidos: 0,
    });
    const { blocos } = blocosDaPosicao([qlp], []);

    const bloco = blocos.find((b) => b.tipo.entityType === "QLP_ADMINISTRATIVO")!;
    expect(bloco.universo!.reason).not.toBeNull();
    expect(bloco.universo!.from).toBeNull();
    expect(bloco.universo!.vigencias).toHaveLength(1);
  });
});

describe("os contadores do topo", () => {
  it("são a soma dos blocos, e não uma segunda contagem", () => {
    const universo = [
      tipo({ atributos: 70, alterados: 24, revertidos: 11 }),
      tipo({ entityType: "CARRETA", atributos: 58, alterados: 18, revertidos: 10 }),
    ];
    expect(totaisDaPosicao(universo)).toEqual({
      alterados: 42,
      revertidos: 21,
      atributos: 128,
    });
  });

  it("o denominador é o universo, e não o número de linhas da tela", () => {
    /*
      Se o denominador saísse da tela, ele seria igual ao numerador e a frase
      seria "24 de 24" — verdadeira e inútil. O universo canônico é o que dá
      sentido ao "de".
    */
    const universo = [tipo({ atributos: 70, alterados: 24 })];
    const totais = totaisDaPosicao(universo);
    expect(totais.atributos).toBeGreaterThan(totais.alterados);
  });

  it("sem universo, os três contadores são zero e não indefinidos", () => {
    expect(totaisDaPosicao([])).toEqual({ alterados: 0, revertidos: 0, atributos: 0 });
  });
});

describe("o parâmetro agrupa, e não reordena", () => {
  it("mantém a ordem em que as linhas chegaram do servidor", () => {
    /*
      O servidor ordena pelo dinheiro. Reordenar aqui por nome faria a linha de
      maior impacto aparecer no meio da tabela porque o nome dela começa com R.
    */
    const grupos = agruparPorParametro([
      linha({ parameterName: "Zelo", attributeCode: "a" }),
      linha({ parameterName: "Alfa", attributeCode: "b" }),
      linha({ parameterName: "Zelo", attributeCode: "c" }),
    ]);

    expect(grupos.map(([nome]) => nome)).toEqual(["Zelo", "Alfa"]);
    expect(grupos[0][1].map((l) => l.attributeCode)).toEqual(["a", "c"]);
  });

  it("não perde nem duplica linha nenhuma", () => {
    const linhas = [
      linha({ parameterName: "Alfa", attributeCode: "a" }),
      linha({ parameterName: "Beta", attributeCode: "b" }),
      linha({ parameterName: "Alfa", attributeCode: "c" }),
    ];
    const agrupadas = agruparPorParametro(linhas).flatMap(([, l]) => l);
    expect(agrupadas).toHaveLength(linhas.length);
    expect(new Set(agrupadas.map((l) => l.attributeCode))).toEqual(
      new Set(["a", "b", "c"]),
    );
  });
});
