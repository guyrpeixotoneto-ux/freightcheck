import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { computeMissingChangeSets, listPeriods } from "../consolidated";
import { getFamiliesView, getRangeAnalysis } from "../families-view";
import { getEndToEndAnalysis } from "../end-to-end";

/**
 * O intervalo — a aba Análise do cartão, sobre o export real.
 *
 * A aba existe para responder o que o Freightech não responde: entre duas
 * vigências, o que o cliente mexeu, quanto custou e quanto rendeu. Um número
 * assim é fácil de produzir errado de quatro maneiras, e cada uma delas tem um
 * teste aqui:
 *
 * 1. **Discordar da outra aba.** Um intervalo de uma vigência só tem de dar
 *    exatamente o que a tela daquela vigência já dá. Se as duas abas do mesmo
 *    cartão se contradisserem, nenhuma das duas serve.
 * 2. **Somar entre periodicidades.** R$/mês e R$/ano continuam em baldes
 *    separados, aqui como em todo o resto do produto.
 * 3. **Cancelar perda com ganho.** O líquido é uma leitura; as duas pontas são
 *    o dado. `perdas + ganhos` tem de reconstruir o líquido, balde a balde.
 * 4. **Engolir vigência sem comparação.** A que não tem comparação aparece
 *    nomeada em `gaps`, e nunca contada como zero.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("range_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
  await computeMissingChangeSets(ctx.db, "test:range");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("as pontas do intervalo", () => {
  it("sem escolha, abre na vigência mais recente contra a anterior — uma comparação", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(ctx.db))!;

    expect(analise.to).toBe(periodos[0].effective_date);
    expect(analise.from).toBe(periodos[1]?.effective_date ?? periodos[0].effective_date);

    /*
      A ponta inicial é o ponto de partida, e não um período cujo movimento
      entra na soma: "de julho até agosto" é **uma** comparação. Era o
      contrário, e a tela mostrava o preço — o texto dizia "1 comparação" e o
      alerta acusava julho de ter ficado de fora, sobre a vigência que a pessoa
      tinha acabado de escolher como referência.
    */
    const lidas = [
      ...analise.movements.map((m) => m.period),
      ...analise.gaps.map((g) => g.period),
    ];
    expect(lidas).toEqual([analise.to]);
  });

  it("as duas pontas iguais não são um intervalo", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;
    const analise = (await getRangeAnalysis(ctx.db, alvo, alvo))!;

    expect(analise.movements).toEqual([]);
    expect(analise.gaps).toEqual([]);
    expect(analise.entries).toEqual([]);
    expect(analise.totals.changes).toBe(0);
  });

  it("pontas trocadas dão a mesma leitura — de agosto até abril é abril até agosto", async () => {
    const periodos = await listPeriods(ctx.db);
    if (periodos.length < 2) return;
    const antiga = periodos[periodos.length - 1].effective_date;
    const recente = periodos[0].effective_date;

    const certo = (await getRangeAnalysis(ctx.db, antiga, recente))!;
    const trocado = (await getRangeAnalysis(ctx.db, recente, antiga))!;

    expect(trocado.from).toBe(certo.from);
    expect(trocado.to).toBe(certo.to);
    expect(trocado.impact).toEqual(certo.impact);
    expect(trocado.totals).toEqual(certo.totals);
  });

  it("com a ponta final no meio do histórico, a inicial é a vigência anterior a ela", async () => {
    const periodos = await listPeriods(ctx.db);
    // Uma vigência do meio: nem a mais recente, nem a mais antiga.
    const meio = periodos[Math.floor(periodos.length / 2)].effective_date;
    const anterior = periodos[Math.floor(periodos.length / 2) + 1].effective_date;

    for (const analise of [
      (await getRangeAnalysis(ctx.db, undefined, meio))!,
      (await getEndToEndAnalysis(ctx.db, undefined, meio))!,
    ]) {
      expect(analise.to).toBe(meio);
      // E não a segunda mais recente do histórico, que viria *depois* de `meio`.
      expect(analise.from).toBe(anterior);
      expect(analise.from < analise.to).toBe(true);
    }
  });

  it("uma ponta que não existe no histórico cai no padrão, e não derruba a tela", async () => {
    const padrao = (await getRangeAnalysis(ctx.db))!;
    const inventada = (await getRangeAnalysis(ctx.db, "1999-01-01", "1999-02-01"))!;
    expect(inventada.from).toBe(padrao.from);
    expect(inventada.to).toBe(padrao.to);
  });
});

describe("as duas abas do cartão não se contradizem", () => {
  it("o intervalo de um passo dá exatamente o que a vigência de chegada dá", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;
    const anterior = periodos[1].effective_date;

    const vigencia = (await getFamiliesView(ctx.db, alvo))!;
    const intervalo = (await getRangeAnalysis(ctx.db, anterior, alvo))!;

    expect(intervalo.totals.changes).toBe(vigencia.totals.changes);
    expect(intervalo.totals.vehiclesTouched).toBe(vigencia.totals.vehiclesTouched);
    expect(intervalo.impact.byPeriodicity).toEqual(vigencia.impact.byPeriodicity);
    expect(intervalo.impact.notCalculable).toBe(vigencia.impact.notCalculable);
  });

  it("o ranking do intervalo de um passo tem os mesmos grupos da vigência", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;
    const anterior = periodos[1].effective_date;

    const vigencia = (await getFamiliesView(ctx.db, alvo))!;
    const intervalo = (await getRangeAnalysis(ctx.db, anterior, alvo))!;

    expect(intervalo.entries).toHaveLength(vigencia.groups.length);
    const impactosDaVigencia = vigencia.groups
      .map((g) => g.impact.amount)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const impactosDoIntervalo = intervalo.entries
      .map((e) => e.amount)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    expect(impactosDoIntervalo).toEqual(impactosDaVigencia);
  });
});

describe("perda e ganho nunca viram um número só", () => {
  it("balde a balde, perdas + ganhos reconstroem o líquido", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    for (const valor of Object.values(analise.lossesByPeriodicity)) {
      expect(valor).toBeLessThan(0);
    }
    for (const valor of Object.values(analise.gainsByPeriodicity)) {
      expect(valor).toBeGreaterThan(0);
    }

    const baldes = new Set([
      ...Object.keys(analise.lossesByPeriodicity),
      ...Object.keys(analise.gainsByPeriodicity),
      ...Object.keys(analise.impact.byPeriodicity),
    ]);
    for (const balde of baldes) {
      const perda = analise.lossesByPeriodicity[balde] ?? 0;
      const ganho = analise.gainsByPeriodicity[balde] ?? 0;
      const liquido = analise.impact.byPeriodicity[balde] ?? 0;
      expect(perda + ganho).toBeCloseTo(liquido, 2);
    }
  });
});

describe("nada some no caminho", () => {
  it("toda vigência do intervalo está num dos dois lados: lida ou nomeada", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    // A ponta inicial fica de fora: é o ponto de partida, não um movimento.
    const noIntervalo = periodos
      .map((p) => p.effective_date)
      .filter((d) => d > analise.from && d <= analise.to)
      .sort();
    const cobertas = [
      ...analise.movements.map((m) => m.period),
      ...analise.gaps.map((g) => g.period),
    ].sort();

    expect(cobertas).toEqual(noIntervalo);
    // E nenhuma nos dois lados ao mesmo tempo.
    const lidas = new Set(analise.movements.map((m) => m.period));
    for (const gap of analise.gaps) expect(lidas.has(gap.period)).toBe(false);
  });

  it("nenhuma linha do ranking mistura duas vigências", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const comComparacao = new Set(analise.movements.map((m) => m.period));
    for (const entrada of analise.entries) {
      expect(entrada.key.startsWith(`${entrada.period}|`)).toBe(true);
      expect(comComparacao.has(entrada.period)).toBe(true);
    }
  });

  it("a soma das alterações por vigência fecha com o total do intervalo", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const soma = analise.movements.reduce((total, m) => total + m.changes, 0);
    expect(soma).toBe(analise.totals.changes);
  });
});

describe("o recorte do cartão", () => {
  it("as partes fecham com o todo: somar os recortes dá o total do intervalo", async () => {
    const periodos = await listPeriods(ctx.db);
    const inteiro = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const chaves = [...new Set(inteiro.entries.map((e) => e.parameterKey))];
    let somaDasPartes = 0;
    for (const chave of chaves) {
      const parte = (await getRangeAnalysis(
        ctx.db,
        inteiro.from,
        inteiro.to,
        undefined,
        [chave],
      ))!;
      // Todo grupo do recorte é daquele parâmetro, e de nenhum outro.
      for (const entrada of parte.entries) expect(entrada.parameterKey).toBe(chave);
      somaDasPartes += parte.totals.changes;
    }
    expect(somaDasPartes).toBe(inteiro.totals.changes);
  });

  it("veículos afetados é gente distinta, e não a soma dos grupos", async () => {
    const periodos = await listPeriods(ctx.db);
    const parte = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
      undefined,
      ["AQUISICAO_FINANCIAMENTO|Financiamento"],
    ))!;

    const somaDosGrupos = parte.entries.reduce((s, e) => s + e.vehicles, 0);
    // O mesmo caminhão conta em cada parâmetro que mudou; o distinto é menor.
    expect(parte.totals.vehiclesTouched).toBeLessThan(somaDosGrupos);
    expect(parte.totals.vehiclesTouched).toBeGreaterThan(0);
  });

  it("recortar não ressuscita a dupla contagem pai/parcela", async () => {
    const periodos = await listPeriods(ctx.db);
    const inicio = periodos[periodos.length - 1].effective_date;
    const fim = periodos[0].effective_date;

    /*
      `carreta.custo_fixo` é o titular de uma composição cujas parcelas moram
      noutro cartão. Se o índice de composição fosse montado só sobre o
      recorte, o titular voltaria para dentro da soma e o cartão mostraria o
      mesmo dinheiro duas vezes. O impacto do recorte tem de ser exatamente o
      que o intervalo inteiro atribui àquele parâmetro.
    */
    const chave = "AQUISICAO_FINANCIAMENTO|Custo fixo (total)";
    const parte = (await getRangeAnalysis(ctx.db, inicio, fim, undefined, [chave]))!;
    const inteiro = (await getRangeAnalysis(ctx.db, inicio, fim))!;

    const doParametro = inteiro.entries.filter((e) => e.parameterKey === chave);
    const somaInteiro = doParametro.reduce((s, e) => s + (e.amount ?? 0), 0);
    const somaParte = parte.entries.reduce((s, e) => s + (e.amount ?? 0), 0);
    expect(somaParte).toBeCloseTo(somaInteiro, 2);
  });
});

/**
 * O cartão que é uma tabela.
 *
 * CAVALO e CARRETA no Freightech são inventários: uma linha por ativo e dezenas
 * de colunas ao lado. O escopo deles é a **lista de colunas** da tela de lá, e
 * essas colunas caem em dezenas de parâmetros nossos — recortar por parâmetro
 * entregava a fatia "Caminhão" (chassi, ano, montadora, câmbio) de um cartão
 * cujo assunto inclui amortização, FINAME, manutenção e combustível. Era por
 * isso que a aba Análise do CAVALO dizia "este cartão não tem parâmetro nenhum
 * alimentado pelo export" sobre uma tabela de setenta colunas.
 */
describe("o recorte por coluna", () => {
  const COLUNAS_DO_CARTAO_CAVALO = [
    "cavalo.amortizacao_cavalo",
    "cavalo.finame_cavalo",
    "cavalo.manutencao_reais_km",
    "cavalo.combustivel_consumo_neg",
    "cavalo.chassi",
  ];

  it("traz as colunas pedidas, e nenhuma outra", async () => {
    const periodos = await listPeriods(ctx.db);
    const parte = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
      undefined,
      [],
      COLUNAS_DO_CARTAO_CAVALO,
    ))!;

    expect(parte.entries.length).toBeGreaterThan(0);
    for (const entrada of parte.entries) {
      expect(COLUNAS_DO_CARTAO_CAVALO).toContain(entrada.attributeCode);
    }

    /*
      A prova de que a coluna alcança o que o parâmetro não alcançava: as cinco
      colunas moram em parâmetros diferentes, e o recorte devolve todos eles.
      Recortando por "FROTA|Caminhão" só uma delas apareceria.
    */
    const parametros = new Set(parte.entries.map((e) => e.parameterKey));
    expect(parametros.size).toBeGreaterThan(1);
  });

  it("coluna e parâmetro se somam, e o recorte nunca escapa do cartão", async () => {
    const periodos = await listPeriods(ctx.db);
    const inicio = periodos[periodos.length - 1].effective_date;
    const fim = periodos[0].effective_date;
    const chave = "GERAL|Índice de reajuste";

    const juntos = (await getRangeAnalysis(ctx.db, inicio, fim, undefined, [chave], [
      "cavalo.amortizacao_cavalo",
    ]))!;
    const soParametro = (await getRangeAnalysis(ctx.db, inicio, fim, undefined, [chave]))!;
    const soColuna = (await getRangeAnalysis(ctx.db, inicio, fim, undefined, [], [
      "cavalo.amortizacao_cavalo",
    ]))!;

    expect(juntos.totals.changes).toBe(
      soParametro.totals.changes + soColuna.totals.changes,
    );
    for (const entrada of juntos.entries) {
      const daColuna = entrada.attributeCode === "cavalo.amortizacao_cavalo";
      expect(daColuna || entrada.parameterKey === chave).toBe(true);
    }
  });

  it("ponta a ponta lê o mesmo recorte de colunas", async () => {
    const periodos = await listPeriods(ctx.db);
    const pontas = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
      undefined,
      [],
      COLUNAS_DO_CARTAO_CAVALO,
    ))!;

    for (const entrada of pontas.entries) {
      expect(COLUNAS_DO_CARTAO_CAVALO).toContain(entrada.attributeCode);
    }
    for (const revertido of pontas.reverted) {
      expect(COLUNAS_DO_CARTAO_CAVALO).toContain(revertido.attributeCode);
    }
  });
});

describe("ponta a ponta", () => {
  it("uma vigência contra ela mesma não tem diferença nenhuma", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;
    const analise = (await getEndToEndAnalysis(ctx.db, alvo, alvo))!;
    expect(analise.totals.changes).toBe(0);
    expect(analise.entries).toEqual([]);
    expect(analise.fleet).toEqual({ added: 0, removed: 0 });
  });

  it("não é a soma dos movimentos — e a diferença é o que a tela existe para mostrar", async () => {
    const periodos = await listPeriods(ctx.db);
    const inicio = periodos[periodos.length - 1].effective_date;
    const fim = periodos[0].effective_date;

    const movimentos = (await getRangeAnalysis(ctx.db, inicio, fim))!;
    const pontas = (await getEndToEndAnalysis(ctx.db, inicio, fim))!;

    // Ida e volta conta duas vezes num lado e some no outro.
    expect(pontas.totals.changes).toBeLessThan(movimentos.totals.changes);
    expect(pontas.entries.length).toBeGreaterThan(0);
  });

  it("entrada e saída de frota ficam fora do dinheiro", async () => {
    const periodos = await listPeriods(ctx.db);
    const pontas = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    expect(pontas.fleet.added + pontas.fleet.removed).toBeGreaterThan(0);

    /*
      A prova de que o dinheiro é ativo a ativo: nenhum ativo que só existe numa
      das pontas produziu linha de valor. Se produzisse, um caminhão novo com
      FINAME entraria na conta como se a Ambev tivesse aumentado o preço.
    */
    const { rows: soNumaPonta } = await ctx.db.execute<{ n: number }>(sql`
      WITH a AS (SELECT DISTINCT f.entity_id FROM fact f JOIN snapshot s ON s.id = f.snapshot_id
                  WHERE s.effective_date = ${pontas.from}::date AND s.status <> 'SUPERSEDED'),
           b AS (SELECT DISTINCT f.entity_id FROM fact f JOIN snapshot s ON s.id = f.snapshot_id
                  WHERE s.effective_date = ${pontas.to}::date AND s.status <> 'SUPERSEDED')
      SELECT count(*)::int AS n
        FROM a FULL OUTER JOIN b ON b.entity_id = a.entity_id
       WHERE a.entity_id IS NULL OR b.entity_id IS NULL
    `);
    expect(soNumaPonta[0].n).toBe(pontas.fleet.added + pontas.fleet.removed);
  });

  it("perdas + ganhos reconstroem o líquido, balde a balde", async () => {
    const periodos = await listPeriods(ctx.db);
    const pontas = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const baldes = new Set([
      ...Object.keys(pontas.lossesByPeriodicity),
      ...Object.keys(pontas.gainsByPeriodicity),
      ...Object.keys(pontas.impact.byPeriodicity),
    ]);
    expect(baldes.size).toBeGreaterThan(0);
    for (const balde of baldes) {
      const perda = pontas.lossesByPeriodicity[balde] ?? 0;
      const ganho = pontas.gainsByPeriodicity[balde] ?? 0;
      expect(perda + ganho).toBeCloseTo(pontas.impact.byPeriodicity[balde] ?? 0, 2);
    }
  });

  it("pontas trocadas dão a mesma leitura", async () => {
    const periodos = await listPeriods(ctx.db);
    const antiga = periodos[periodos.length - 1].effective_date;
    const recente = periodos[0].effective_date;
    const certo = (await getEndToEndAnalysis(ctx.db, antiga, recente))!;
    const trocado = (await getEndToEndAnalysis(ctx.db, recente, antiga))!;
    expect(trocado.from).toBe(certo.from);
    expect(trocado.totals).toEqual(certo.totals);
    expect(trocado.impact).toEqual(certo.impact);
  });
});

describe("a visão geral e o cartão não podem se contradizer", () => {
  it("a soma dos parâmetros fecha com o total do intervalo, balde a balde", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const soma: Record<string, number> = {};
    for (const parametro of analise.byParameter) {
      for (const [balde, valor] of Object.entries(parametro.impact.byPeriodicity)) {
        soma[balde] = (soma[balde] ?? 0) + valor;
      }
    }
    const baldes = new Set([
      ...Object.keys(soma),
      ...Object.keys(analise.impact.byPeriodicity),
    ]);
    expect(baldes.size).toBeGreaterThan(0);
    for (const balde of baldes) {
      expect(soma[balde] ?? 0).toBeCloseTo(analise.impact.byPeriodicity[balde] ?? 0, 2);
    }

    const somaDeAlteracoes = analise.byParameter.reduce((t, p) => t + p.changes, 0);
    expect(somaDeAlteracoes).toBe(analise.totals.changes);
  });

  it("o consolidado de um parâmetro é o que o cartão dele mostra sozinho", async () => {
    const periodos = await listPeriods(ctx.db);
    const inicio = periodos[periodos.length - 1].effective_date;
    const fim = periodos[0].effective_date;
    const geral = (await getRangeAnalysis(ctx.db, inicio, fim))!;

    /*
      O salto VISÃO GERAL → CARTÃO. Se a linha do parâmetro na visão geral e a
      tela do cartão dele discordassem, uma das duas estaria errada e não
      haveria como saber qual — e é justamente esse caminho que o produto pede
      para a pessoa percorrer.
    */
    for (const parametro of geral.byParameter.slice(0, 5)) {
      const cartao = (await getRangeAnalysis(ctx.db, inicio, fim, undefined, [
        parametro.parameterKey,
      ]))!;
      expect(cartao.totals.changes).toBe(parametro.changes);
      expect(cartao.totals.vehiclesTouched).toBe(parametro.vehicles);
      expect(cartao.impact.byPeriodicity).toEqual(parametro.impact.byPeriodicity);
      expect(cartao.impact.notCalculable).toBe(parametro.notCalculable);
    }
  });

  it("ponta a ponta também fecha, e diz o que permanece alterado", async () => {
    const periodos = await listPeriods(ctx.db);
    const pontas = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const soma: Record<string, number> = {};
    for (const parametro of pontas.byParameter) {
      for (const [balde, valor] of Object.entries(parametro.impact.byPeriodicity)) {
        soma[balde] = (soma[balde] ?? 0) + valor;
      }
    }
    for (const balde of Object.keys(pontas.impact.byPeriodicity)) {
      expect(soma[balde] ?? 0).toBeCloseTo(pontas.impact.byPeriodicity[balde], 2);
    }
    expect(pontas.byParameter.reduce((t, p) => t + p.changes, 0)).toBe(
      pontas.totals.changes,
    );
  });
});

describe("as duas leituras cobrem o mesmo trecho", () => {
  it("num intervalo de um passo não existe reversão — não há caminho para ir e voltar", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;
    const anterior = periodos[1].effective_date;

    const pontas = (await getEndToEndAnalysis(ctx.db, anterior, alvo))!;
    /*
      A prova de que os dois trechos são o mesmo. Se a leitura de movimentos
      cobrisse uma transição a mais que a de pontas — como cobria, quando a
      ponta inicial entrava na soma —, o que mexeu naquela transição extra
      apareceria aqui como "mexeu e voltou" sem ter voltado coisa nenhuma.
    */
    expect(pontas.reverted).toEqual([]);
  });

  it("num passo, o que mexeu é exatamente o que está diferente nas pontas", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;
    const anterior = periodos[1].effective_date;

    const movimentos = (await getRangeAnalysis(ctx.db, anterior, alvo))!;
    const pontas = (await getEndToEndAnalysis(ctx.db, anterior, alvo))!;

    const codigos = (lista: { attributeCode: string | null }[]) =>
      [...new Set(lista.map((e) => e.attributeCode).filter(Boolean))].sort();
    expect(codigos(pontas.entries)).toEqual(codigos(movimentos.entries));
  });
});

describe("o que foi revertido", () => {
  it("é a subtração das duas leituras, e não um palpite", async () => {
    const periodos = await listPeriods(ctx.db);
    const pontas = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    expect(pontas.reverted.length).toBeGreaterThan(0);
    for (const item of pontas.reverted) {
      expect(item.entities).toBeGreaterThan(0);
      expect(item.periods).toBeGreaterThan(0);
    }

    /*
      A prova: para cada atributo revertido, os ativos que voltaram **não**
      estão entre os que hoje estão diferentes. Se estivessem, o mesmo ativo
      apareceria como "voltou ao ponto de partida" e como "mudou" ao mesmo
      tempo, e uma das duas frases seria mentira.
    */
    for (const item of pontas.reverted) {
      const aindaDiferentes = pontas.entries
        .filter((e) => e.attributeCode === item.attributeCode)
        .reduce((s, e) => s + e.vehicles, 0);
      const { rows } = await ctx.db.execute<{ n: number }>(sql`
        SELECT count(DISTINCT c.entity_id)::int AS n
          FROM "change" c
          JOIN change_set cs ON cs.id = c.change_set_id
          JOIN snapshot sb   ON sb.id = cs.snapshot_b_id
         WHERE sb.effective_date > ${pontas.from}::date
           AND sb.effective_date <= ${pontas.to}::date
           AND sb.status <> 'SUPERSEDED'
           AND c.change_type = 'VALUE_CHANGED'
           AND c.attribute_code = ${item.attributeCode}
      `);
      // Quem mexeu = quem voltou + quem continua diferente.
      expect(rows[0].n).toBe(item.entities + aindaDiferentes);
    }
  });

  it("o recorte do cartão vale também para o revertido", async () => {
    const periodos = await listPeriods(ctx.db);
    const chave = "FROTA|Manutenção cavalo";
    const pontas = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
      undefined,
      [chave],
    ))!;
    for (const item of pontas.reverted) expect(item.parameterKey).toBe(chave);
    for (const entrada of pontas.entries) expect(entrada.parameterKey).toBe(chave);
  });
});
