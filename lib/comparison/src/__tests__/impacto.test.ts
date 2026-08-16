import { describe, expect, it } from "vitest";
import { chaveDeAgrupamento, decomporPontaAPonta, diaDoInstante } from "../impacto";
import type { QuinzenaPeriod, QuinzenaRow } from "../impacto";

/**
 * As duas regras do Impacto que não precisam de banco para serem conferidas.
 *
 * A primeira é a que decide em que dia um ativo entrou na frota, e ela é a mais
 * fácil de errar por parecer trivial: a fonte grava o dia como um instante em
 * ponto flutuante, e as duas simplificações óbvias — truncar a hora, arredondar
 * para a meia-noite mais próxima — produzem cada uma um grupo errado na tabela
 * do cliente. Os casos abaixo são exatamente os três formatos que o export real
 * entrega no mesmo campo.
 *
 * A segunda é a identidade que separa preço de frota. Ela é a razão de existir
 * dos cartões do topo, e um teste sobre ela é o que impede alguém de, mais
 * tarde, "simplificar" a conta somando entrada de ativo à variação.
 */

describe("diaDoInstante", () => {
  it("mantém o meio-dia no dia dele", () => {
    expect(diaDoInstante(new Date("2021-01-01T12:00:00Z"))).toBe("2021-01-01");
  });

  it("mantém o último segundo do dia no dia dele", () => {
    // 44105,999988… — como a carreta que entrou em 01/10/20 chega no arquivo.
    expect(diaDoInstante(new Date("2020-10-01T23:59:59.000Z"))).toBe("2020-10-01");
  });

  it("leva o milissegundo antes da meia-noite para o dia seguinte", () => {
    // O mesmo campo, com o serial do dia seguinte e o erro de representação:
    // é o cavalo que a planilha do cliente mostra sob 01/06/21.
    expect(diaDoInstante(new Date("2021-05-31T23:59:59.999Z"))).toBe("2021-06-01");
  });

  it("não mexe na meia-noite exata", () => {
    expect(diaDoInstante(new Date("2022-09-01T00:00:00Z"))).toBe("2022-09-01");
  });
});

describe("chaveDeAgrupamento", () => {
  const vazio = { valueDate: null, valueNumeric: null, valueText: null };

  it("usa a data quando a importação já reconheceu uma", () => {
    expect(chaveDeAgrupamento({ ...vazio, valueDate: "2021-01-01" })).toEqual({
      key: "2021-01-01",
      label: "01/01/21",
      order: "2021-01-01",
    });
  });

  it("lê o instante ISO que o export entrega como texto", () => {
    expect(
      chaveDeAgrupamento({ ...vazio, valueText: "2021-07-15T23:59:59.999Z" }),
    ).toMatchObject({ key: "2021-07-16", label: "16/07/21" });
  });

  it("lê o serial cru que a importação se recusou a converter", () => {
    // 44197,5 — a coluna `data` como ela chega quando o arquivo não a formata
    // como data (o AMBIGUOUS_DATE_SERIAL de lib/ingest/src/values.ts).
    expect(chaveDeAgrupamento({ ...vazio, valueNumeric: "44197.5" })).toMatchObject({
      key: "2021-01-01",
      label: "01/01/21",
    });
  });

  it("agrupa pelo que veio escrito quando não é data plausível", () => {
    // Nunca descartar: um ativo sem grupo sumiria da tabela, e sumir é o único
    // resultado inaceitável desta leitura.
    expect(chaveDeAgrupamento({ ...vazio, valueNumeric: "6" })).toMatchObject({
      key: "6",
      label: "6",
    });
    expect(chaveDeAgrupamento({ ...vazio, valueText: "STANDART" })).toMatchObject({
      key: "STANDART",
    });
  });

  it("devolve null só quando não há valor nenhum", () => {
    expect(chaveDeAgrupamento(vazio)).toBeNull();
    expect(chaveDeAgrupamento({ ...vazio, valueText: "   " })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const periodo = (
  sourceLabel: string,
  total: number | null,
  delivered = true,
): QuinzenaPeriod => ({
  effectiveDate: `2026-0${sourceLabel.at(-1)}-01`,
  sourceLabel,
  delivered,
  entities: 0,
  withValue: 0,
  total,
});

const linha = (plate: string, valores: (number | null)[]): QuinzenaRow => ({
  entityId: plate,
  plate,
  cells: valores.map((v) => ({
    value: v,
    state: v === null ? ("FORA_DA_FROTA" as const) : ("VALOR" as const),
    delta: null,
    movimento: null,
  })),
  total: null,
  first: null,
  last: null,
  delta: null,
  periods: valores.filter((v) => v !== null).length,
});

describe("decomporPontaAPonta", () => {
  it("separa o que foi preço do que foi frota, e as parcelas fecham", () => {
    const rows = [
      linha("FICOU", [100, 120]), // +20 de preço
      linha("ENTROU", [null, 200]), // frota, não preço
      linha("SAIU", [200, null]), // frota, não preço
    ];
    // Os totais das colunas saem das próprias linhas, como saem na leitura de
    // verdade: um total escrito à mão poderia divergir das parcelas, e aí o
    // teste passaria a medir a fixture em vez da conta.
    const totalEm = (i: number) =>
      rows.reduce((soma, l) => soma + (l.cells[i].value ?? 0), 0);
    const periods = [periodo("V1", totalEm(0)), periodo("V2", totalEm(1))];

    const p = decomporPontaAPonta(periods, rows)!;

    expect(p.comparados).toEqual({ entities: 1, delta: 20 });
    expect(p.entraram).toEqual({ entities: 1, amount: 200, foraDaFrota: 1 });
    expect(p.sairam).toEqual({ entities: 1, amount: 200, foraDaFrota: 1 });
    // A frota trocou um ativo de R$ 200 por outro de R$ 200: o total sobe 20, e
    // os 20 são de preço. Ler os 200 que entraram como aumento seria dizer que
    // o cliente ficou dez vezes mais caro.
    expect(p.totalFrom).toBe(300);
    expect(p.totalTo).toBe(320);
    expect(p.delta).toBe(20);
    expect(p.comparados.delta + p.entraram.amount - p.sairam.amount).toBe(p.delta);
  });

  it("ignora as vigências que não entregaram o equipamento ao escolher as pontas", () => {
    const periods = [
      periodo("V1", 100),
      periodo("V2", null, false),
      periodo("V3", 130),
    ];
    const rows = [linha("A", [100, null, 130])];

    const p = decomporPontaAPonta(periods, rows)!;

    // A ponta final é V3, e não a V2 que não trouxe o arquivo — tomá-la como
    // ponta faria a frota inteira aparecer como devolvida.
    expect(p.fromLabel).toBe("V1");
    expect(p.toLabel).toBe("V3");
    expect(p.comparados).toEqual({ entities: 1, delta: 30 });
  });

  it("não decompõe nada quando só há uma vigência entregue", () => {
    expect(decomporPontaAPonta([periodo("V1", 100)], [linha("A", [100])])).toBeNull();
  });
});
