import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { changeTable } from "@workspace/db";
import type { TestDb } from "@workspace/ingest/testing";
import { buildFixture, criarBancoComModelosCurados } from "../testing";
import { listPeriods } from "../consolidated";
import { impactoApurado } from "../impacto-apurado";
import { getEndToEndAnalysis, type AtributoNaPonta } from "../end-to-end";

/**
 * O rollup por (atributo × tipo) — e a prova de que o dinheiro dele é o mesmo
 * dinheiro.
 *
 * A tela de posição publica uma linha por atributo dentro de cada equipamento, e
 * cada linha traz impacto. É o ponto do produto onde uma segunda definição de
 * impacto nasceria sem que nada falhasse: bastaria somar os grupos na interface,
 * ou montar um deduplicador só com as linhas do recorte, para obter um número
 * plausível e errado. O produto já pagou por isso uma vez — os 71% que
 * `summariseImpact` documenta.
 *
 * Por isso os testes deste ficheiro não se contentam em conferir o rollup com
 * ele próprio. Eles põem o rollup contra **`impactoApurado`**, que é a porta do
 * produto para o número em dinheiro sobre comparações gravadas, e exigem
 * igualdade linha a linha. As duas leituras chegam ao número por caminhos
 * diferentes — uma diffa dois snapshots em memória, a outra lê `change` do banco
 * —, e as duas passam pela mesma autoridade: `criarDeduplicador` +
 * `resumirImpacto`. Se divergirem, há duas definições de impacto no produto.
 *
 * Os dois casos que mais interessam estão na base real e são medidos aqui:
 *
 * - **composição** — `carreta.custo_fixo` sai da soma nos ativos em que uma
 *   parcela dele também mudou (`COBERTO_POR_PARCELAS`);
 * - **escopo de conjunto** — `carreta.finame` sai da soma porque o cavalo
 *   vinculado responde pelo mesmo dinheiro (`ESCOPO_DE_CONJUNTO`).
 *
 * Nenhum deles é hipotético: são o que a escada de dedução da vigência real
 * remove, e é sobre eles que a igualdade tem de valer.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("ponta_rollup");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Soma um balde por periodicidade, sem nunca cruzar periodicidades. */
function somarPorPeriodicidade(
  partes: Record<string, number>[],
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const parte of partes) {
    for (const [periodicidade, valor] of Object.entries(parte)) {
      total[periodicidade] = (total[periodicidade] ?? 0) + valor;
    }
  }
  return Object.fromEntries(
    Object.entries(total).map(([k, v]) => [k, Number(v.toFixed(2))]),
  );
}

/** As duas pontas mais distantes do histórico — o intervalo com mais caminho. */
async function pontas() {
  const periodos = await listPeriods(ctx.db);
  return {
    inicio: periodos[periodos.length - 1].effective_date,
    fim: periodos[0].effective_date,
    anterior: periodos[1].effective_date,
    recente: periodos[0].effective_date,
  };
}

describe("as partes fecham com o todo", () => {
  it("a soma dos atributos é o impacto da análise, dentro de cada periodicidade", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    expect(analise.byAttribute.length).toBeGreaterThan(0);
    expect(Object.keys(analise.impact.byPeriodicity).length).toBeGreaterThan(0);

    expect(
      somarPorPeriodicidade(analise.byAttribute.map((a) => a.impact.byPeriodicity)),
    ).toEqual(
      Object.fromEntries(
        Object.entries(analise.impact.byPeriodicity).map(([k, v]) => [
          k,
          Number(v.toFixed(2)),
        ]),
      ),
    );
  });

  it("a soma do bruto também fecha — a dedução não é perda de linha", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    /*
      O bruto tem de fechar junto com o oficial. Se só o oficial fechasse, a
      igualdade poderia estar a esconder linhas perdidas no caminho — uma linha
      que sumisse do rollup e da soma daria o mesmo resultado dos dois lados.
    */
    expect(
      somarPorPeriodicidade(
        analise.byAttribute.map((a) => a.impact.brutoByPeriodicity),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(analise.impact.brutoByPeriodicity).map(([k, v]) => [
          k,
          Number(v.toFixed(2)),
        ]),
      ),
    );
  });

  it("a distância entre bruto e oficial é exactamente a escada da dedução", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    const removido = somarPorPeriodicidade(
      analise.impact.rastro.degraus.map((d) => d.removidoByPeriodicity),
    );
    // A vigência real remove por composição **e** por escopo de conjunto.
    expect(analise.impact.rastro.degraus.map((d) => d.etapa)).toEqual([
      "COMPOSICAO",
      "ESCOPO_DE_CONJUNTO",
    ]);
    expect(analise.impact.rastro.degraus.some((d) => d.mudancasRemovidas > 0)).toBe(
      true,
    );

    const bruto = analise.impact.brutoByPeriodicity;
    for (const [periodicidade, oficial] of Object.entries(
      analise.impact.byPeriodicity,
    )) {
      const esperado = (bruto[periodicidade] ?? 0) - (removido[periodicidade] ?? 0);
      expect(Number(oficial.toFixed(2))).toBe(Number(esperado.toFixed(2)));
    }
  });
});

describe("o impacto do rollup é o da autoridade financeira", () => {
  /**
   * O par consecutivo é o que permite a comparação directa.
   *
   * `impactoApurado` lê comparações **gravadas**, e a única comparação gravada
   * que cobre exactamente dois snapshots vizinhos é a canónica daquela vigência.
   * Sobre esse par, as duas leituras olham para o mesmo movimento por caminhos
   * independentes — e é aí que a igualdade tem valor de prova.
   */
  async function comparacaoCanonica(alvo: string): Promise<string[]> {
    const { rows } = await ctx.db.execute<{ id: string }>(sql`
      SELECT cs.id::text AS id
        FROM change_set cs
        JOIN snapshot sb ON sb.id = cs.snapshot_b_id
        JOIN snapshot sa ON sa.id = cs.snapshot_a_id
       WHERE sb.effective_date = ${alvo}::date
         AND sb.status <> 'SUPERSEDED'
         AND sa.effective_date < sb.effective_date
    `);
    return rows.map((r) => r.id);
  }

  it("o total do par consecutivo bate com impactoApurado", async () => {
    const { anterior, recente } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, anterior, recente))!;
    const ids = await comparacaoCanonica(recente);
    expect(ids.length).toBeGreaterThan(0);

    const autoridade = await impactoApurado(ctx.db, ids);
    expect(analise.impact.byPeriodicity).toEqual(autoridade.byPeriodicity);
  });

  it("cada linha do rollup bate com impactoApurado recortado nas mesmas linhas", async () => {
    const { anterior, recente } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, anterior, recente))!;
    const ids = await comparacaoCanonica(recente);

    const comDinheiro = analise.byAttribute.filter(
      (a) => Object.keys(a.impact.byPeriodicity).length > 0,
    );
    expect(comDinheiro.length).toBeGreaterThan(0);

    for (const linha of comDinheiro) {
      /*
        O recorte filtra **o que entra na soma**, e nunca o que o deduplicador
        enxerga — é a regra escrita em `impacto-apurado.ts`, e é a mesma que o
        rollup segue ao receber o deduplicador da leitura inteira. Um índice
        montado só com estas linhas devolveria o titular para dentro da soma, e
        é exactamente essa divergência que este laço apanharia.
      */
      const autoridade = await impactoApurado(ctx.db, ids, [
        and(
          eq(changeTable.attributeCode, linha.attributeCode!),
          eq(changeTable.entityType, linha.entityType!),
        )!,
      ]);
      expect({
        atributo: linha.attributeCode,
        tipo: linha.entityType,
        impacto: linha.impact.byPeriodicity,
      }).toEqual({
        atributo: linha.attributeCode,
        tipo: linha.entityType,
        impacto: autoridade.byPeriodicity,
      });
    }
  });

  it("bate também onde a composição retira dinheiro da soma", async () => {
    const { anterior, recente } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, anterior, recente))!;
    const ids = await comparacaoCanonica(recente);

    const porComposicao = analise.byAttribute.filter(
      (a) => a.foraDaSoma?.motivo === "COBERTO_POR_PARCELAS",
    );
    expect(porComposicao.length).toBeGreaterThan(0);

    for (const linha of porComposicao) {
      const autoridade = await impactoApurado(ctx.db, ids, [
        and(
          eq(changeTable.attributeCode, linha.attributeCode!),
          eq(changeTable.entityType, linha.entityType!),
        )!,
      ]);
      expect(linha.impact.byPeriodicity).toEqual(autoridade.byPeriodicity);
      // E o que saiu saiu mesmo: o bruto da linha é maior do que o oficial.
      expect(linha.impact.brutoByPeriodicity).not.toEqual(
        linha.impact.byPeriodicity,
      );
      expect(linha.foraDaSoma!.ativos).toBeGreaterThan(0);
    }
  });

  it("bate também onde o escopo cavalo↔carreta retira dinheiro da soma", async () => {
    const { anterior, recente } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, anterior, recente))!;
    const ids = await comparacaoCanonica(recente);

    const porConjunto = analise.byAttribute.filter(
      (a) => a.foraDaSoma?.motivo === "ESCOPO_DE_CONJUNTO",
    );
    expect(porConjunto.length).toBeGreaterThan(0);

    for (const linha of porConjunto) {
      /*
        Este é o caso que um deduplicador de fatia erraria com certeza: a regra
        olha para a **outra** série — o cavalo vinculado àquela carreta —, e um
        índice montado só com as linhas da carreta não teria como vê-lo.
      */
      expect(linha.entityType).toBe("CARRETA");
      const autoridade = await impactoApurado(ctx.db, ids, [
        and(
          eq(changeTable.attributeCode, linha.attributeCode!),
          eq(changeTable.entityType, linha.entityType!),
        )!,
      ]);
      expect(linha.impact.byPeriodicity).toEqual(autoridade.byPeriodicity);
      expect(linha.foraDaSoma!.ativos).toBeGreaterThan(0);
    }
  });

  it("o rollup do intervalo longo continua a bater atributo a atributo", async () => {
    /*
      O par consecutivo prova a igualdade; o intervalo longo prova que ela não
      dependia de o par ser vizinho. Aqui não há comparação gravada equivalente
      — o ponta a ponta de dezembro a agosto não existe em `change_set` —, então
      a referência é a própria análise: as partes têm de fechar com o todo, que
      é a mesma invariante do primeiro bloco sobre um caminho de nove vigências.
    */
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    const porTipo = new Map<string, AtributoNaPonta[]>();
    for (const linha of analise.byAttribute) {
      const tipo = linha.entityType ?? "(sem tipo)";
      porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), linha]);
    }
    expect(porTipo.size).toBeGreaterThan(1);

    expect(
      somarPorPeriodicidade(
        [...porTipo.values()].flatMap((linhas) =>
          linhas.map((l) => l.impact.byPeriodicity),
        ),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(analise.impact.byPeriodicity).map(([k, v]) => [
          k,
          Number(v.toFixed(2)),
        ]),
      ),
    );
  });
});

describe("o que a leitura de posição esconderia sozinha", () => {
  it("o revertido é linha, com as movimentações que houve no caminho", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    const revertidos = analise.byAttribute.filter((a) => a.posicao === "REVERTIDO");
    expect(revertidos.length).toBeGreaterThan(0);

    for (const linha of revertidos) {
      // Delta zero: nenhum ativo está diferente **hoje**.
      expect(linha.vehicles).toBe(0);
      expect(linha.impact.byPeriodicity).toEqual({});
      // E mesmo assim houve movimento — que é a notícia que a linha carrega.
      expect(linha.movimentacoes.vigencias).toBeGreaterThanOrEqual(1);
      expect(linha.movimentacoes.ativos).toBeGreaterThanOrEqual(1);
    }
  });

  it("toda linha traz as movimentações apuradas no servidor", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    /*
      A tela não reconstrói contagem nenhuma: o número chega pronto. O laço
      abaixo é o contrato disso — nenhuma linha sai daqui sem o campo, e o campo
      nunca é negativo.
    */
    for (const linha of analise.byAttribute) {
      expect(linha.movimentacoes.vigencias).toBeGreaterThanOrEqual(0);
      expect(linha.movimentacoes.ativos).toBeGreaterThanOrEqual(0);
    }
    expect(
      analise.byAttribute.filter((l) => l.movimentacoes.vigencias > 1).length,
    ).toBeGreaterThan(0);
  });

  it("as movimentações contam vigências do atributo, e não o máximo de um ativo", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    /*
      A contagem por (ativo, atributo) — a que a reversão usa — subestima esta:
      se o ativo A se mexeu em janeiro e o B em março, o máximo por ativo diz uma
      vigência e a resposta certa é duas. Aqui exige-se que a contagem publicada
      seja a do atributo, medindo-a contra o banco.
    */
    const alvo = analise.byAttribute.find((l) => l.movimentacoes.vigencias > 1)!;
    const { rows } = await ctx.db.execute<{ vigencias: number }>(sql`
      SELECT count(DISTINCT sb.effective_date)::int AS vigencias
        FROM "change" c
        JOIN change_set cs ON cs.id = c.change_set_id
        JOIN snapshot sb   ON sb.id = cs.snapshot_b_id
       WHERE sb.effective_date > ${inicio}::date
         AND sb.effective_date <= ${fim}::date
         AND sb.status <> 'SUPERSEDED'
         AND c.change_type = 'VALUE_CHANGED'
         AND c.attribute_code = ${alvo.attributeCode}
    `);
    expect(alvo.movimentacoes.vigencias).toBe(rows[0].vigencias);
  });
});

describe("o denominador de X de Y", () => {
  it("vem do universo canônico, e é maior do que o que mudou", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    expect(analise.universo.length).toBeGreaterThan(0);
    for (const tipo of analise.universo) {
      expect(tipo.atributos).toBeGreaterThan(0);
      expect(tipo.fleet).toBeGreaterThan(0);
      // "34 de 34" não informaria nada; o denominador é o universo, não a tela.
      expect(tipo.atributos).toBeGreaterThan(tipo.alterados);
      expect(tipo.atributos).toBeGreaterThanOrEqual(
        tipo.alterados + tipo.revertidos,
      );
    }
  });

  it("o numerador é a contagem das linhas daquele equipamento", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    for (const tipo of analise.universo) {
      const linhas = analise.byAttribute.filter(
        (a) => a.entityType === tipo.entityType,
      );
      expect(tipo.alterados).toBe(
        linhas.filter((l) => l.posicao === "DIFERENTE").length,
      );
      expect(tipo.revertidos).toBe(
        linhas.filter((l) => l.posicao === "REVERTIDO").length,
      );
    }

    // E nenhuma linha fica fora de um bloco: todo tipo publicado tem universo.
    const tipos = new Set(analise.universo.map((u) => u.entityType));
    for (const linha of analise.byAttribute) {
      if (linha.entityType === null) continue;
      expect(tipos.has(linha.entityType)).toBe(true);
    }
  });

  it("o universo de um tipo não conta os atributos do outro", async () => {
    const { inicio, fim } = await pontas();
    const analise = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    const soma = analise.universo.reduce((t, u) => t + u.atributos, 0);
    for (const tipo of analise.universo) {
      expect(tipo.atributos).toBeLessThan(soma);
    }
  });
});

/**
 * O calendário próprio — a forma do QLP.
 *
 * O QLP vive noutra família de dados (`QUADRO_DE_PESSOAL`), com identidade
 * canônica própria, e publica quando o quadro muda. As pontas escolhidas a
 * partir das vigências de equipamento podem não ter vigência de QLP nenhuma, e
 * um bloco que herdasse essas datas anunciaria uma comparação que não houve.
 *
 * A base real não tem QLP importado, então a forma é reproduzida com dois tipos
 * em calendários diferentes — que é exactamente a situação, sem depender de um
 * export que ainda não chegou.
 */
describe("um equipamento com calendário próprio", () => {
  let calendario: TestDb;

  beforeAll(async () => {
    const { createTestDatabase } = await import("@workspace/ingest/testing");
    calendario = await createTestDatabase("calendario_proprio");

    const escopo = "escopo-partilhado";
    await buildFixture(
      calendario.db,
      [{ code: "cavalo.custo_fixo", dataType: "NUMERIC", isMonetary: true }],
      [
        {
          label: "CAV_JAN",
          effectiveDate: "2026-01-01",
          data: { AAA1A11: { "cavalo.custo_fixo": 100 } },
        },
        {
          label: "CAV_MAR",
          effectiveDate: "2026-03-01",
          data: { AAA1A11: { "cavalo.custo_fixo": 150 } },
        },
      ],
      { entityType: "CAVALO", scopeHash: escopo, canal: "EMPURRADA" },
    );

    // Publica **entre** as duas pontas, e em nenhuma delas.
    await buildFixture(
      calendario.db,
      [{ code: "trecho.frete_ctrc", dataType: "NUMERIC", isMonetary: true }],
      [
        {
          label: "TRE_FEV",
          effectiveDate: "2026-02-01",
          data: { ROTA1: { "trecho.frete_ctrc": 900 } },
        },
      ],
      { entityType: "TRECHO", scopeHash: escopo, canal: "EMPURRADA" },
    );
  }, 600_000);

  afterAll(async () => {
    await calendario?.drop();
  });

  it("aparece no universo com as vigências dele, e sem comparação inventada", async () => {
    const analise = (await getEndToEndAnalysis(
      calendario.db,
      "2026-01-01",
      "2026-03-01",
    ))!;

    const cavalo = analise.universo.find((u) => u.entityType === "CAVALO");
    const trecho = analise.universo.find((u) => u.entityType === "TRECHO");
    expect(cavalo).toBeDefined();
    expect(trecho).toBeDefined();

    // O comparado traz as duas pontas nomeadas.
    expect(cavalo!.reason).toBeNull();
    expect(cavalo!.from).toBe("2026-01-01");
    expect(cavalo!.to).toBe("2026-03-01");

    /*
      O de calendário próprio não herda essas datas. Ele diz que não foi
      comparado, e mostra a vigência que de facto tem — que é o que permite ao
      bloco explicar-se em vez de aparecer vazio.
    */
    expect(trecho!.from).toBeNull();
    expect(trecho!.to).toBeNull();
    expect(trecho!.reason).toContain("não tem vigência nas duas pontas");
    expect(trecho!.vigencias.map((v) => v.date)).toEqual(["2026-02-01"]);
    expect(trecho!.alterados).toBe(0);
    expect(trecho!.revertidos).toBe(0);
  });
});
