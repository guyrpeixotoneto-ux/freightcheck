import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setImportRunHidden } from "@workspace/ingest";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { listPeriods } from "../consolidated";
import { getRangeAnalysis } from "../families-view";
import { evolucaoPorPlaca } from "../evolucao-por-placa";
import { listContexts } from "../series";

/**
 * A Evolução por Placa contra a base real — os **contratos de reconciliação**.
 *
 * A tela lê o mesmo intervalo que a Linha do Tempo e o soma por outro eixo. Isso
 * cria exatamente uma classe de defeito, e ela é cara: dois painéis do mesmo
 * produto publicando números diferentes para o mesmo escopo, os dois com cara de
 * verdade. Este arquivo é a régua que impede isso — cada `it` abaixo é uma
 * igualdade que precisa continuar valendo, e não um exemplo escolhido a dedo.
 *
 * As dez afirmações, na ordem em que foram pedidas:
 *
 *  1. soma das células de uma placa = acumulado daquela placa;
 *  2. soma dos acumulados = impacto líquido da visão, no mesmo escopo;
 *  3. ganhos e perdas reconciliam com a fonte;
 *  4. alteração sem valoração não vira R$ 0 em silêncio;
 *  5. importação oculta não aparece;
 *  6. unidade, canal e recorte temporal são respeitados;
 *  7. as vigências saem em ordem cronológica;
 *  8. placa sem alteração não ganha alteração fictícia;
 *  9. o que o domínio não conta como alteração continua não contando;
 * 10. a autoridade de impacto continua sendo a mesma do resto do produto.
 */

let ctx: TestDb;
let de: string;
let ate: string;

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("evolucao_por_placa_real");
  const periodos = await listPeriods(ctx.db);
  de = periodos[periodos.length - 1].effective_date;
  ate = periodos[0].effective_date;
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const centavos = (v: number) => Number(v.toFixed(2));

describe("a matriz fecha consigo mesma", () => {
  it("a soma das células de uma placa é o acumulado dela", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    expect(evolucao.ativos.length).toBeGreaterThan(0);

    for (const ativo of evolucao.ativos) {
      const soma = ativo.celulas.reduce((total, c) => total + (c.net ?? 0), 0);
      if (ativo.acumulado === null) {
        // Nenhuma célula valorada — e então nenhuma célula com líquido.
        expect(ativo.celulas.every((c) => c.net === null)).toBe(true);
      } else {
        expect(centavos(soma)).toBeCloseTo(ativo.acumulado, 2);
      }
    }
  });

  it("ganho e perda de cada célula reconstroem o líquido dela", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    for (const ativo of evolucao.ativos) {
      for (const celula of ativo.celulas) {
        if (celula.net === null) {
          expect(celula.ganho).toBe(0);
          expect(celula.perda).toBe(0);
        } else {
          expect(centavos(celula.ganho + celula.perda)).toBeCloseTo(celula.net, 2);
        }
      }
      expect(centavos(ativo.ganho + ativo.perda)).toBeCloseTo(ativo.acumulado ?? 0, 2);
    }
  });

  it("os cartões do topo somam as linhas da matriz, e não uma segunda conta", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const { totais, ativos } = evolucao;

    expect(totais.ativos).toBe(ativos.length);
    expect(totais.alteracoes).toBe(ativos.reduce((s, a) => s + a.alteracoes, 0));
    expect(totais.comPerda).toBe(
      ativos.filter((a) => a.acumulado !== null && a.acumulado < 0).length,
    );
    expect(totais.comGanho).toBe(
      ativos.filter((a) => a.acumulado !== null && a.acumulado > 0).length,
    );
    expect(centavos(totais.ganho + totais.perda)).toBeCloseTo(totais.liquido, 2);
  });
});

describe("a matriz fecha com o resto do FreightCheck", () => {
  it("a soma dos acumulados é o impacto oficial que a Linha do Tempo publica", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const range = (await getRangeAnalysis(ctx.db, de, ate))!;

    const oficial = range.impact.byPeriodicity[evolucao.periodicidade] ?? 0;
    expect(evolucao.totais.liquido).toBeCloseTo(oficial, 2);

    const soma = evolucao.ativos.reduce((total, a) => total + (a.acumulado ?? 0), 0);
    expect(centavos(soma)).toBeCloseTo(oficial, 2);
  });

  it("perdas e ganhos reconciliam com os da mesma leitura de intervalo", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const range = (await getRangeAnalysis(ctx.db, de, ate))!;

    expect(evolucao.totais.perda).toBeCloseTo(
      range.lossesByPeriodicity[evolucao.periodicidade] ?? 0,
      2,
    );
    expect(evolucao.totais.ganho).toBeCloseTo(
      range.gainsByPeriodicity[evolucao.periodicidade] ?? 0,
      2,
    );
  });

  it("conta as mesmas alterações e os mesmos ativos tocados que o intervalo", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const range = (await getRangeAnalysis(ctx.db, de, ate))!;

    /*
      As linhas sem `entity_id` — eixo de atributo — contam na vigência e não
      numa placa. A diferença entre as duas contagens é exatamente elas, e é por
      isso que a igualdade é escrita com a diferença explícita em vez de com uma
      tolerância: uma placa a mais na matriz é um ativo inventado.
    */
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM alteracao_visivel c
       JOIN change_set cs ON cs.id = c.change_set_id
       JOIN snapshot sb ON sb.id = cs.snapshot_b_id
       WHERE c.entity_id IS NULL
         AND c.entity_type IS DISTINCT FROM 'TRECHO'
         AND sb.effective_date > ${de}::date
         AND sb.effective_date <= ${ate}::date
    `);
    expect(evolucao.totais.alteracoes + rows[0].n).toBe(range.totals.changes);
    expect(evolucao.totais.ativos).toBe(range.totals.vehiclesTouched);
  });

  it("periodicidades continuam separadas: cada uma fecha com o balde dela", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const range = (await getRangeAnalysis(ctx.db, de, ate))!;
    expect(evolucao.periodicidades.length).toBeGreaterThan(1);

    for (const { periodicity } of evolucao.periodicidades) {
      const recorte = (await evolucaoPorPlaca(ctx.db, {
        from: de,
        to: ate,
        periodicidade: periodicity,
      }))!;
      expect(recorte.periodicidade).toBe(periodicity);
      expect(recorte.totais.liquido).toBeCloseTo(
        range.impact.byPeriodicity[periodicity] ?? 0,
        2,
      );
    }
  });
});

describe("o que a matriz se recusa a dizer", () => {
  it("alteração sem valoração é contada, e nunca vira R$ 0", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    expect(evolucao.totais.alteracoesSemValoracao).toBeGreaterThan(0);

    for (const ativo of evolucao.ativos) {
      for (const celula of ativo.celulas) {
        // Uma célula que só tem pendência não sai como zero apurado.
        if (celula.valoradas === 0 && celula.foraDoTotal === 0) {
          expect(celula.estado).toBe("SEM_VALORACAO");
          expect(celula.net).toBeNull();
        }
        // E a contagem nunca some: tudo que entrou está num dos quatro
        // baldes — apurada, sem preço, fora por dupla contagem, ou de outra
        // periodicidade.
        expect(
          celula.valoradas +
            celula.semValoracao +
            celula.foraDoTotal +
            celula.outraPeriodicidade,
        ).toBe(celula.alteracoes);
      }
      expect(
        ativo.celulas.reduce((s, c) => s + c.alteracoes, 0),
      ).toBe(ativo.alteracoes);
    }
  });

  it("uma placa sem alteração numa vigência não ganha célula fictícia", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;

    for (const ativo of evolucao.ativos) {
      // Célula esparsa: existe só onde houve alteração, e toda célula tem pelo
      // menos uma. Zero-alterações não é um estado possível.
      expect(ativo.celulas.every((c) => c.alteracoes > 0)).toBe(true);
      expect(ativo.vigenciasAfetadas).toBe(ativo.celulas.length);
      expect(ativo.vigenciasAfetadas).toBeLessThanOrEqual(evolucao.colunas.length);
    }
  });

  it("nenhuma placa da matriz está fora das colunas do intervalo", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const colunas = new Set(evolucao.colunas.map((c) => c.period));
    for (const ativo of evolucao.ativos) {
      for (const celula of ativo.celulas) expect(colunas.has(celula.period)).toBe(true);
    }
  });

  it("as vigências saem em ordem cronológica, e as células com elas", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const colunas = evolucao.colunas.map((c) => c.period);
    expect(colunas).toEqual([...colunas].sort());
    expect(colunas[0] > evolucao.from).toBe(true);
    expect(colunas[colunas.length - 1]).toBe(evolucao.to);

    for (const ativo of evolucao.ativos) {
      const datas = ativo.celulas.map((c) => c.period);
      expect(datas).toEqual([...datas].sort());
    }
  });

  it("a ponta de partida não vira coluna — ela é referência, não período somado", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    expect(evolucao.colunas.some((c) => c.period === de)).toBe(false);
  });
});

describe("o recorte", () => {
  it("um intervalo mais curto é um subconjunto do longo, célula a célula", async () => {
    const periodos = (await listPeriods(ctx.db)).map((p) => p.effective_date);
    const meio = periodos[Math.floor(periodos.length / 2)];

    const longa = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const curta = (await evolucaoPorPlaca(ctx.db, {
      from: meio,
      to: ate,
      periodicidade: longa.periodicidade,
    }))!;

    expect(curta.colunas.length).toBeLessThan(longa.colunas.length);
    for (const coluna of curta.colunas) expect(coluna.period > meio).toBe(true);

    const celulaLonga = new Map(
      longa.ativos.flatMap((a) => a.celulas.map((c) => [`${a.entityId}|${c.period}`, c])),
    );
    for (const ativo of curta.ativos) {
      for (const celula of ativo.celulas) {
        const mesma = celulaLonga.get(`${ativo.entityId}|${celula.period}`);
        expect(mesma).toBeDefined();
        expect(mesma!.net).toBe(celula.net);
        expect(mesma!.alteracoes).toBe(celula.alteracoes);
      }
    }
  });

  it("a unidade e o canal do contexto recortam a leitura inteira", async () => {
    const contextos = await listContexts(ctx.db);
    expect(contextos.length).toBeGreaterThan(0);

    const evolucao = (await evolucaoPorPlaca(ctx.db, {
      from: de,
      to: ate,
      context: { scopeHash: contextos[0].scopeHash, channel: contextos[0].channel },
    }))!;
    expect(evolucao.context.scopeHash).toBe(contextos[0].scopeHash);
    expect(evolucao.context.channel).toBe(contextos[0].channel);

    // Um contexto que não existe é recusa escrita, e nunca uma matriz vazia
    // que a tela leria como "esta unidade não mudou nada".
    await expect(
      evolucaoPorPlaca(ctx.db, { context: { scopeHash: "não-existe" } }),
    ).rejects.toThrow(/Nenhuma vigência importada para o contexto pedido/);
  });

  it("o recorte por tipo troca a população, e as duas partes somam o todo", async () => {
    const geral = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const cavalo = (await evolucaoPorPlaca(ctx.db, {
      from: de,
      to: ate,
      tipo: "CAVALO",
      periodicidade: geral.periodicidade,
    }))!;
    const carreta = (await evolucaoPorPlaca(ctx.db, {
      from: de,
      to: ate,
      tipo: "CARRETA",
      periodicidade: geral.periodicidade,
    }))!;

    expect(cavalo.ativos.every((a) => a.entityType === "CAVALO")).toBe(true);
    expect(carreta.ativos.every((a) => a.entityType === "CARRETA")).toBe(true);
    expect(cavalo.totais.alteracoes + carreta.totais.alteracoes).toBe(
      geral.totais.alteracoes,
    );
  });
});

describe("a importação oculta", () => {
  /*
    Cada arquivo do Freightec traz o histórico inteiro de um equipamento: a
    importação da carreta responde por todas as vigências de carreta. Ocultá-la
    é, portanto, o teste mais forte disponível aqui — não some uma vigência,
    some uma frota — e é o que a tela de Importações de fato faz quando alguém
    marca um envio como oculto.
  */
  it("uma frota ocultada some da matriz, e volta inteira quando reexibida", async () => {
    const antes = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    expect(antes.ativos.some((a) => a.entityType === "CARRETA")).toBe(true);

    const { rows } = await ctx.db.execute<{ import_run_id: string }>(sql`
      SELECT DISTINCT s.import_run_id::text AS import_run_id
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
         AND 'CARRETA' = ANY (string_to_array(s.entity_type_set, '+'))
       LIMIT 1
    `);
    const importRunId = rows[0].import_run_id;

    await setImportRunHidden(ctx.db, importRunId, true, {
      by: "teste@teste.com",
      reason: "evolução por placa não pode ler importação oculta",
    });
    try {
      const oculta = await evolucaoPorPlaca(ctx.db, { from: de, to: ate });
      /*
        `null` é uma resposta legítima e não uma falha: se a importação oculta
        respondia pelo contexto inteiro, o que resta é "nenhuma vigência", que
        a rota traduz em 404 e a tela em convite a importar. O que **não** pode
        acontecer é uma carreta oculta continuar aparecendo.
      */
      if (oculta !== null) {
        expect(oculta.ativos.some((a) => a.entityType === "CARRETA")).toBe(false);
        expect(oculta.totais.alteracoes).toBeLessThan(antes.totais.alteracoes);
      }
    } finally {
      await setImportRunHidden(ctx.db, importRunId, false, { by: "teste@teste.com" });
    }

    const depois = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    expect(depois.totais.alteracoes).toBe(antes.totais.alteracoes);
    expect(depois.totais.liquido).toBeCloseTo(antes.totais.liquido, 2);
    expect(depois.ativos.length).toBe(antes.ativos.length);
  });
});

describe("a identidade do ativo", () => {
  it("a linha é o ativo canônico, e o rótulo é a placa corrente dele", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;

    const ids = evolucao.ativos.map((a) => a.entityId);
    expect(new Set(ids).size).toBe(ids.length);

    const { rows } = await ctx.db.execute<{ entity_id: string; placa: string }>(sql`
      SELECT entity_id::text AS entity_id, identifier_value AS placa
        FROM entity_identifier
       WHERE identifier_type = 'PLACA' AND is_current
    `);
    const placaCorrente = new Map(rows.map((r) => [r.entity_id, r.placa]));
    for (const ativo of evolucao.ativos) {
      expect(ativo.plate).toBe(placaCorrente.get(ativo.entityId) ?? null);
      // Placa anterior é evidência ao lado da linha — nunca uma segunda linha.
      expect(ativo.placasAnteriores).not.toContain(ativo.plate);
    }
  });

  it("as rubricas de uma placa somam o acumulado dela", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    for (const ativo of evolucao.ativos) {
      const soma = ativo.rubricas.reduce((total, r) => total + (r.impacto ?? 0), 0);
      expect(centavos(soma)).toBeCloseTo(ativo.acumulado ?? 0, 2);
      expect(ativo.rubricas.reduce((total, r) => total + r.alteracoes, 0)).toBe(
        ativo.alteracoes,
      );
    }
  });

  it("as rubricas do escopo somam o líquido do escopo", async () => {
    const evolucao = (await evolucaoPorPlaca(ctx.db, { from: de, to: ate }))!;
    const soma = evolucao.rubricas.reduce((total, r) => total + (r.impacto ?? 0), 0);
    expect(centavos(soma)).toBeCloseTo(evolucao.totais.liquido, 2);
  });
});
