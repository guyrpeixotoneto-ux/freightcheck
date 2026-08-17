import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { attributeTable, CONFIRMED_SEMANTICS } from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { getVisaoDeFrota, type VisaoDeFrota } from "../frota";
import { getAlteracoesDoEquipamento } from "../ficha";
import { montarComposicao } from "../motor";

/**
 * Uma importação **limpa** — e o que ela já deixa apurável.
 *
 * O contraste com `composicao-real.test.ts` é o objeto deste arquivo. Lá o
 * `beforeAll` semeia a taxonomia, roda a proposta e aplica as confirmações
 * antes de perguntar qualquer coisa; aqui não se chama nada disso. Este banco é
 * o que existe depois de alguém arrastar a planilha para a tela de importação e
 * promover — e mais nada.
 *
 * O defeito que ele fecha foi medido em 17/08/2026 contra o export de
 * agosto/2026: os 62 cavalos com o FINAME no banco, e os 62 cards lendo "não
 * apurado". Os valores nunca faltaram. O que faltava era o registro de
 * `CONFIRMED_SEMANTICS` — decisões humanas escritas desde 10/08/2026, com a
 * medição de cada uma ao lado — ser aplicado por algum caminho que um arquivo
 * real percorresse. Ele era chamado pelo `dev-seed`, pelo `curate-report` e
 * pelos testes; nenhum dos três é por onde a planilha entra.
 *
 * Por isso as asserções deste arquivo são sobre **o que a importação faz
 * sozinha**. Um teste que primeiro curasse a base e depois conferisse o número
 * não teria detectado nada — foi exatamente essa a forma dos testes que
 * existiam quando o produto estava quebrado em produção.
 */

let ctx: TestDb;
let cavalos: VisaoDeFrota;

/** A última vigência do export: EMPURRADA_1_8_2026. */
const AGOSTO = "2026-08-01";
const JULHO = "2026-07-02";

/**
 * O bloco fixo dos cavalos em agosto/2026, medido na planilha.
 *
 * `sum(finameCavalo)` sobre as 62 placas da vigência. As parcelas
 * (amortização + juros + lucro fixo) fecham com o total nas 62 linhas, e é por
 * isso que o total do motor tem de ser exatamente este: o motor soma a raiz e
 * absorve as parcelas, e qualquer outro número aqui significaria dupla contagem
 * ou parcela perdida.
 */
const BLOCO_FIXO_CAVALOS_AGOSTO = 867_860.23;

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("importacao_limpa");
  cavalos = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: AGOSTO }))!;
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o que a promoção deixa pronto, sem curadoria nenhuma", () => {
  it("confirma as colunas do bloco fixo do cavalo", async () => {
    const codigos = [
      "cavalo.finame_cavalo",
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ];
    for (const code of codigos) {
      const [attribute] = await ctx.db
        .select()
        .from(attributeTable)
        .where(eq(attributeTable.code, code));
      expect(attribute, code).toBeDefined();
      expect(attribute.semanticsStatus, code).toBe("CONFIRMED");
      expect(attribute.periodicity, code).toBe("MENSAL");
      expect(attribute.unit, code).toBe("BRL");
      expect(attribute.aggregation, code).toBe("SUM");
      // A confirmação continua sendo de uma pessoa. A importação replica a
      // decisão dela; não assina no lugar dela.
      expect(attribute.confirmedBy, code).toMatch(/@/);
      expect(attribute.confirmedBy, code).not.toMatch(/^(engine|api|cli|import):/);
    }
  });

  /**
   * A mesma semântica na versão em vigor, e não só na projeção.
   *
   * É o que a comparação lê na data de cada vigência. Confirmar apenas
   * `attribute` deixaria o motor somando pela versão que continua dizendo "não
   * sei" — e o número sumiria da conta sem uma linha de erro.
   */
  it("carimba também a versão de semântica em vigor", async () => {
    const { rows } = await ctx.db.execute<{ status: string; periodicity: string }>(sql`
      SELECT v.semantics_status AS status, v.periodicity
        FROM attribute_semantics v
        JOIN attribute a ON a.id = v.attribute_id
       WHERE a.code = 'cavalo.finame_cavalo'
         AND v.effective_until IS NULL
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("CONFIRMED");
    expect(rows[0].periodicity).toBe("MENSAL");
  });

  it("não confirma nada além do registro", async () => {
    const confirmados = await ctx.db
      .select({ code: attributeTable.code })
      .from(attributeTable)
      .where(eq(attributeTable.semanticsStatus, "CONFIRMED"));
    /*
      Exatamente o registro, nem uma coluna a mais. A conferência é contra a
      própria lista, e não contra um número escrito aqui: uma entrada nova no
      registro é trabalho legítimo, e não deve reprovar este teste — o que ele
      guarda é que a **importação** não confirme nada por conta própria.
    */
    expect(confirmados.map((c) => c.code).sort()).toEqual(
      CONFIRMED_SEMANTICS.map((e) => e.code).sort(),
    );
    // O resto da planilha continua UNKNOWN, que é o sistema funcionando.
    expect(confirmados.map((c) => c.code)).not.toContain(
      "cavalo.lucro_variavel_previsto_cavalo",
    );
  });
});

describe("agosto/2026, a prova de aceitação", () => {
  it("apura o bloco fixo dos 62 cavalos e fecha o total da frota", () => {
    expect(cavalos.linhas).toHaveLength(62);
    expect(cavalos.periodLabel).toBe("agosto/2026");
    expect(cavalos.resumo.comValorApurado).toBe(62);
    expect(cavalos.resumo.mensalTotal).toBeCloseTo(BLOCO_FIXO_CAVALOS_AGOSTO, 2);
    // Nenhum card lendo "não apurado" — que é o defeito, dito como asserção.
    expect(cavalos.linhas.filter((l) => l.mensal === null)).toHaveLength(0);
    expect(cavalos.linhas.filter((l) => l.status.naoApuradoPor !== null)).toHaveLength(
      0,
    );
  });

  it("a RPG1B56 recebe o FINAME dela, e só ele", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPG1B56")!;
    expect(linha).toBeDefined();
    expect(linha.mensal).toBeCloseTo(16_769.83, 2);

    const composicao = (await montarComposicao(ctx.db, linha.entityId, {
      period: AGOSTO,
    }))!;
    const mensais = composicao.linhas.filter((l) => l.gaveta === "MENSAL");
    expect(mensais.map((l) => l.code)).toEqual(["cavalo.finame_cavalo"]);

    /*
      As três parcelas continuam visíveis dentro da explicação do total — o que
      elas não fazem é somar de novo. 10.487,27 + 6.282,56 + 0 = 16.769,83.
    */
    const finame = mensais[0];
    expect(finame.explicacao.parcelas).toHaveLength(3);
    expect(finame.explicacao.divergencia).toBeCloseTo(0, 2);
  });

  /**
   * O que a planilha **não** permite medir continua fora — e nomeado.
   *
   * Três limites do arquivo, os três pedidos por escrito, e os três verificados
   * sobre o mesmo ativo.
   */
  it("mantém o lucro variável previsto fora da conta enquanto ninguém confirma o que ele é", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPG1B56")!;
    const composicao = (await montarComposicao(ctx.db, linha.entityId, {
      period: JULHO,
    }))!;

    const lucroVariavel = composicao.naoApurados.find(
      (n) => n.code === "cavalo.lucro_variavel_previsto_cavalo",
    )!;
    expect(lucroVariavel).toBeDefined();
    expect(lucroVariavel.motivo).toBe("SEMANTICA_NAO_CONFIRMADA");
    // Em julho ele vale 4.686,50 e mesmo assim não entra em total nenhum.
    expect(lucroVariavel.valorNumerico).toBeCloseTo(4_686.5, 2);
    expect(composicao.linhas.map((l) => l.code)).not.toContain(
      "cavalo.lucro_variavel_previsto_cavalo",
    );
  });

  it("não transforma R$/km nem km/l em remuneração mensal", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPG1B56")!;
    const composicao = (await montarComposicao(ctx.db, linha.entityId, {
      period: JULHO,
    }))!;
    const razoes = [
      "cavalo.manutencao_reais_km",
      "cavalo.reaiskm",
      "cavalo.combustivel_consumo_neg",
    ];
    for (const code of razoes) {
      expect(composicao.linhas.map((l) => l.code), code).not.toContain(code);
    }
    /*
      A planilha não traz quilometragem rodada por placa no período — só as
      razões. Sem o fato de produção, multiplicar por uma quantidade estimada
      seria inventar o número, e é por isso que nenhuma delas tem lugar num
      total mensal.
    */
    expect(composicao.totais.find((t) => t.gaveta === "MENSAL")!.valor).toBeCloseTo(
      16_769.83,
      2,
    );
  });

  it("trata o IPVA como anual, sem dividir por doze em silêncio", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPG1B56")!;
    const composicao = (await montarComposicao(ctx.db, linha.entityId, {
      period: AGOSTO,
    }))!;

    const ipva = composicao.linhas.find((l) => l.code === "cavalo.ipva_licenciamento")!;
    expect(ipva).toBeDefined();
    expect(ipva.gaveta).toBe("ANUAL");
    expect(ipva.periodicity).toBe("ANUAL");
    // O valor entra na gaveta anual **inteiro**, como veio da fonte.
    expect(ipva.valor).toBeCloseTo(4_145.26, 2);

    const anual = composicao.totais.find((t) => t.gaveta === "ANUAL")!;
    expect(anual.valor).toBeCloseTo(4_145.26, 2);
    // E não encosta no mensal: 4.145,26 ÷ 12 = 345,44 não aparece em lugar nenhum.
    expect(composicao.totais.find((t) => t.gaveta === "MENSAL")!.valor).toBeCloseTo(
      16_769.83,
      2,
    );
  });

  /**
   * O card da RPG1B56 continua contando a história dele.
   *
   * A remuneração apurada aparecer não pode apagar o que mudou: o ativo parou,
   * e o lucro variável previsto foi a zero junto.
   */
  it("continua mostrando ATIVO → PARADO e o lucro variável indo a zero", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPG1B56")!;
    const alteracoes = (await getAlteracoesDoEquipamento(ctx.db, linha.entityId, {
      period: AGOSTO,
    }))!;

    const porCodigo = new Map(
      alteracoes.alteracoes.map((a) => [a.attributeCode, a]),
    );

    const ativo = porCodigo.get("cavalo.ativo")!;
    expect(ativo).toBeDefined();
    expect(ativo.valueBefore).toBe("ATIVO");
    expect(ativo.valueAfter).toBe("PARADO");

    const lucroVariavel = porCodigo.get("cavalo.lucro_variavel_previsto_cavalo")!;
    expect(lucroVariavel).toBeDefined();
    expect(Number(lucroVariavel.valueBefore)).toBeCloseTo(4_686.5, 2);
    expect(Number(lucroVariavel.valueAfter)).toBe(0);

    /*
      E a remuneração apurada não se move com isso: o bloco fixo é o mesmo em
      julho e agosto, porque um caminhão parado continua sendo financiado.
    */
    expect(linha.mensal).toBeCloseTo(16_769.83, 2);
    expect(linha.variacao?.absoluta).toBeCloseTo(0, 2);
  });
});
