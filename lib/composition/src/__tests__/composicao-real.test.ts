import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { getVisaoDeFrota, type VisaoDeFrota } from "../frota";
import { getAlteracoesDoEquipamento, getHistorico, getVinculoDoCavalo } from "../ficha";
import { montarComposicao } from "../motor";

/**
 * A composição contra o export real da Freightec.
 *
 * Os números abaixo foram medidos no arquivo antes de este módulo existir, e é
 * isso que os torna um contrato de regressão: se o motor deixar de reproduzi-los,
 * ele mudou de ideia sobre o que compõe a remuneração de um equipamento.
 *
 * O achado que este arquivo protege acima de todos: **`carreta.finame` já contém
 * o cavalo.** Um refactor que voltasse a somar `custoFixo` na linha da carreta
 * passaria em toda tela do produto e inflaria a frota em mais de um milhão de
 * reais por mês. Aqui ele para.
 */

let ctx: TestDb;
let cavalos: VisaoDeFrota;
let carretas: VisaoDeFrota;

/** A última vigência do export: EMPURRADA_1_8_2026. */
const AGOSTO = "2026-08-01";
const JULHO = "2026-07-02";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("composition_real");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);

  cavalos = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: AGOSTO }))!;
  carretas = (await getVisaoDeFrota(ctx.db, "CARRETA", { period: AGOSTO }))!;
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a frota de agosto/2026", () => {
  it("traz os 62 cavalos e as 71 carretas da vigência", () => {
    expect(cavalos.linhas).toHaveLength(62);
    expect(carretas.linhas).toHaveLength(71);
    expect(cavalos.periodLabel).toBe("agosto/2026");
    expect(cavalos.serieEntregue).toBe(true);
  });

  it("apura a remuneração mensal de todos eles", () => {
    expect(cavalos.resumo.comValorApurado).toBe(62);
    expect(carretas.resumo.comValorApurado).toBe(71);
    expect(cavalos.resumo.mensalTotal).toBeGreaterThan(0);
    expect(carretas.resumo.mensalTotal).toBeGreaterThan(0);
  });

  /**
   * O teste que existe por causa do achado.
   *
   * `carreta.custo_fixo` soma R$ 1.579.155,13 em agosto/2026, e desse valor
   * R$ 1.048.665,73 são o `finameCavalo` dos cavalos vinculados — o mesmo
   * dinheiro que já está na linha de cada cavalo. O total da carreta tem de
   * ficar **abaixo** da soma de `custoFixo` exatamente por essa diferença.
   */
  it("a carreta não carrega o cavalo dentro do próprio total", async () => {
    const { rows } = await ctx.db.execute<{ custo_fixo: string; finame_cavalo: string }>(sql`
      SELECT (SELECT sum(f.value_numeric)::text
                FROM fact f JOIN attribute a ON a.id = f.attribute_id
                JOIN snapshot s ON s.id = f.snapshot_id
               WHERE a.code = 'carreta.custo_fixo'
                 AND s.effective_date = ${AGOSTO}::date) AS custo_fixo,
             (SELECT sum(f.value_numeric)::text
                FROM fact f JOIN attribute a ON a.id = f.attribute_id
                JOIN snapshot s ON s.id = f.snapshot_id
               WHERE a.code = 'cavalo.finame_cavalo'
                 AND s.effective_date = ${AGOSTO}::date) AS finame_cavalo
    `);
    const custoFixoDaFonte = Number(rows[0].custo_fixo);
    const cavaloDentro = Number(rows[0].finame_cavalo);

    expect(cavalos.resumo.mensalTotal).toBeCloseTo(cavaloDentro, 2);
    expect(carretas.resumo.mensalTotal).toBeLessThan(custoFixoDaFonte);
    /*
      A conta fecha nos dois sentidos: o que a carreta soma mais o que o cavalo
      soma dá o custoFixo da fonte, a menos das carretas sem cavalo vinculado —
      cuja parcela de cavalo é zero. Somar as duas frotas passa a ser legítimo
      justamente porque nenhuma contém a outra.
    */
    expect(carretas.resumo.mensalTotal + cavalos.resumo.mensalTotal).toBeCloseTo(
      custoFixoDaFonte,
      0,
    );
  });

  /**
   * A identidade que prova a decomposição — por par, e não só no agregado.
   *
   * `(carreta própria) + (cavalo próprio) = custoFixo` em todos os 558 pares
   * das 9 vigências. Exaustiva porque nada do conjunto fica sem dono, e disjunta
   * porque nenhum real tem dois. Um agregado que fecha pode esconder duas
   * compensações que se anulam; esta conta, por par, não pode.
   */
  it("a soma do par cavalo + carreta reproduz o custoFixo da fonte, par a par", async () => {
    const { rows } = await ctx.db.execute<{ pares: number; fecha: number }>(sql`
      WITH carreta AS (
        SELECT s.effective_date AS vig, ei.identifier_value AS pc,
               max(f.value_numeric) FILTER (WHERE a.code='carreta.lucro_fixomodelo_novo_ciclo') AS lf,
               max(f.value_numeric) FILTER (WHERE a.code='carreta.finame_implemento') AS fi,
               max(f.value_numeric) FILTER (WHERE a.code='carreta.custo_fixo') AS cf
          FROM fact f JOIN attribute a ON a.id=f.attribute_id JOIN snapshot s ON s.id=f.snapshot_id
          JOIN entity_identifier ei ON ei.entity_id=f.entity_id
               AND ei.identifier_type='PLACA' AND ei.is_current
         WHERE a.entity_type='CARRETA' GROUP BY 1,2),
      cavalo AS (
        SELECT s.effective_date AS vig,
               max(f.value_text) FILTER (WHERE a.code='cavalo.placa_carreta') AS pc,
               max(f.value_numeric) FILTER (WHERE a.code='cavalo.finame_cavalo') AS fin_cav
          FROM fact f JOIN attribute a ON a.id=f.attribute_id JOIN snapshot s ON s.id=f.snapshot_id
          JOIN entity_identifier ei ON ei.entity_id=f.entity_id
               AND ei.identifier_type='PLACA' AND ei.is_current
         WHERE a.entity_type='CAVALO' GROUP BY 1, ei.identifier_value)
      SELECT count(*)::int AS pares,
             count(*) FILTER (WHERE abs((c.fi + c.lf) + v.fin_cav - c.cf) <= 0.01)::int AS fecha
        FROM carreta c JOIN cavalo v ON v.vig = c.vig AND v.pc = c.pc
    `);
    expect(rows[0].pares).toBe(558);
    expect(rows[0].fecha).toBe(558);
  });

  it("as duas colunas de conjunto aparecem na ficha da carreta, e fora do total", async () => {
    const alguma = carretas.linhas.find((l) => l.placa === "RZM0C81")!;
    const c = (await montarComposicao(ctx.db, alguma.entityId, { period: AGOSTO }))!;

    const conjunto = c.naoApurados.filter((n) => n.motivo === "ESCOPO_DE_CONJUNTO");
    expect(conjunto.map((n) => n.code).sort()).toEqual([
      "carreta.custo_fixo",
      "carreta.finame",
    ]);
    expect(c.linhas.some((l) => l.code === "carreta.custo_fixo")).toBe(false);

    // E o valor da coluna continua visível: quem confere a planilha vai achá-lo.
    expect(conjunto.find((n) => n.code === "carreta.custo_fixo")!.valorNumerico).toBeCloseTo(
      23_408.92,
      2,
    );
  });
});

describe("a ficha de um cavalo", () => {
  it("apura o mensal pelo total confirmado e absorve as três parcelas", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;

    const mensal = c.linhas.filter((l) => l.gaveta === "MENSAL");
    expect(mensal.map((l) => l.code)).toEqual(["cavalo.finame_cavalo"]);
    expect(mensal[0].valor).toBeCloseTo(16_769.83, 2);

    const absorvidas = c.naoApurados.filter((n) => n.motivo === "PARCELA_DE_TOTAL");
    expect(absorvidas.map((n) => n.code).sort()).toEqual([
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ]);
    expect(mensal[0].explicacao.parcelas).toHaveLength(3);
  });

  it("mantém o IPVA anual fora do mensal, sem dividir por doze", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;
    const anual = c.linhas.find((l) => l.code === "cavalo.ipva_licenciamento")!;
    expect(anual.gaveta).toBe("ANUAL");
    expect(c.totais.map((t) => t.gaveta)).toEqual(["MENSAL", "ANUAL", "AQUISICAO"]);
  });

  it("o valor da nota vai para aquisição, e nunca para a remuneração", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;
    const nf = c.linhas.find((l) => l.code === "cavalo.valor_nf_compra")!;
    expect(nf.gaveta).toBe("AQUISICAO");
    expect(c.totais.find((t) => t.gaveta === "MENSAL")!.valor).toBeLessThan(nf.valor);
  });

  it("cada linha calculável sabe dizer de qual célula veio", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;
    for (const l of c.linhas) {
      expect(l.origem?.sourceLabel, l.code).toBe("EMPURRADA_1_8_2026");
      expect(l.origem?.sheetName, l.code).toBe("cavalos");
      expect(l.origem?.columnHeader, l.code).toBe(l.sourceName);
      expect(l.origem?.rowIndex, l.code).toBeGreaterThan(0);
    }
  });

  it("todos os 75 atributos do cavalo aparecem — nenhum é engolido", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;
    expect(c.linhas.length + c.naoApurados.length).toBe(75);
  });

  it("declara o que ainda não sabe apurar, em vez de fingir completude", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;
    expect(c.completude.parcial).toBe(true);
    expect(c.completude.semRegraFinanceira).toBeGreaterThan(0);

    /*
      A manutenção por quilômetro é o caso D5 da arquitetura. Hoje ela para no
      primeiro portão — ninguém confirmou o significado da coluna — e o motivo
      exibido é esse, que é o verdadeiro: dizer "falta a quilometragem" a
      respeito de uma coluna cujo significado não foi confirmado mandaria pedir
      à Ambev um dado que talvez nem resolvesse.

      A base que faltaria já vai junto, porque ela não depende da curadoria: a
      unidade é R$/km, e R$/km precisa de km. É a pergunta que a tela pode
      fazer desde já, sem prometer que a resposta destrava o cálculo sozinha.
    */
    const manutencao = c.naoApurados.find((n) => n.code === "cavalo.manutencao_reais_km")!;
    expect(manutencao.motivo).toBe("SEMANTICA_NAO_CONFIRMADA");
    expect(manutencao.unit).toBe("BRL_KM");
    expect(manutencao.baseQueFalta).toContain("quilometragem");
    expect(manutencao.monetarioPotencial).toBe(true);
  });
});

describe("o histórico e as alterações", () => {
  it("percorre as nove vigências e termina no número da ficha", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const historico = (await getHistorico(ctx.db, linha.entityId))!;
    expect(historico.pontos).toHaveLength(9);
    expect(historico.pontos[0].periodLabel).toBe("dezembro/2025");
    expect(historico.pontos[8].periodLabel).toBe("agosto/2026");
    expect(historico.pontos[8].mensal).toBeCloseTo(linha.mensal!, 2);
  });

  it("a série de um componente cobre todas as vigências, inclusive as vazias", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const historico = (await getHistorico(ctx.db, linha.entityId))!;
    const ipva = historico.componentes.find((c) => c.code === "cavalo.ipva_licenciamento")!;
    expect(ipva.pontos).toHaveLength(9);
    expect(ipva.financeiro).toBe(true);
    // O achado do IPVA: o valor cai ao longo da série, e a série mostra a queda.
    expect(ipva.pontos[0].valor!).toBeGreaterThan(ipva.pontos[8].valor!);
  });

  it("lê as alterações do motor de comparação e diz quais mexem no total", async () => {
    /* Um cavalo que de fato mudou entre jul e ago/2026. */
    const mudou = cavalos.linhas.find(
      (l) => l.variacao !== null && l.variacao.absoluta !== 0,
    );
    expect(mudou, "algum cavalo variou entre jul e ago/2026").toBeDefined();

    const alteracoes = (await getAlteracoesDoEquipamento(ctx.db, mudou!.entityId, {
      period: AGOSTO,
    }))!;
    expect(alteracoes.de?.effectiveDate).toBe(JULHO);
    expect(alteracoes.alteracoes.length).toBeGreaterThan(0);
    expect(alteracoes.alteracoes.every((a) => a.entityLabel === mudou!.placa)).toBe(true);

    // A decomposição fecha: o que as linhas calculáveis explicam é a variação.
    expect(alteracoes.explicado).toBeCloseTo(alteracoes.variacaoMensal!.absoluta, 2);
    expect(alteracoes.naoAtribuido).toBeCloseTo(0, 2);
  });

  it("na primeira vigência da série não há anterior a comparar", async () => {
    const dezembro = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: "2025-12-02" }))!;
    const linha = dezembro.linhas[0];
    expect(linha.variacao).toBeNull();
    const alteracoes = (await getAlteracoesDoEquipamento(ctx.db, linha.entityId, {
      period: "2025-12-02",
    }))!;
    expect(alteracoes.de).toBeNull();
    expect(alteracoes.alteracoes).toHaveLength(0);
  });
});

describe("o vínculo cavalo–carreta", () => {
  it("resolve a carreta de cada cavalo, e ela existe no banco", async () => {
    let comVinculo = 0;
    for (const linha of cavalos.linhas) {
      const vinculo = await getVinculoDoCavalo(ctx.db, linha.entityId, { period: AGOSTO });
      if (vinculo === null) continue;
      comVinculo += 1;
      expect(vinculo.carretaEntityId, `${linha.placa} → ${vinculo.placaCarreta}`).not.toBeNull();
      expect(vinculo.totalDoConjunto).not.toBeNull();
    }
    // Um para um, nos 62 cavalos da vigência.
    expect(comVinculo).toBe(62);
  });

  it("a carreta não é lida como cavalo em lugar nenhum", () => {
    const placasDeCavalo = new Set(cavalos.linhas.map((l) => l.placa));
    for (const carreta of carretas.linhas) {
      expect(placasDeCavalo.has(carreta.placa)).toBe(false);
      expect(carreta.entityType).toBe("CARRETA");
    }
  });
});

describe("filtros e isolamento", () => {
  it("o filtro por vigência muda o número, e a frota continua a mesma", async () => {
    const junho = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: "2026-06-02" }))!;
    expect(junho.periodLabel).toBe("junho/2026");
    expect(junho.linhas).toHaveLength(62);
    expect(junho.resumo.mensalTotal).not.toBe(cavalos.resumo.mensalTotal);
  });

  it("busca por placa e por chassi encontram o mesmo ativo", async () => {
    const alvo = cavalos.linhas.find((l) => l.chassi !== null)!;
    const porPlaca = (await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: AGOSTO,
      filtros: { busca: alvo.placa!.slice(0, 5) },
    }))!;
    const porChassi = (await getVisaoDeFrota(ctx.db, "CAVALO", {
      period: AGOSTO,
      filtros: { busca: alvo.chassi! },
    }))!;
    expect(porPlaca.linhas.some((l) => l.entityId === alvo.entityId)).toBe(true);
    expect(porChassi.linhas.map((l) => l.entityId)).toEqual([alvo.entityId]);
  });

  it("os atributos de um tipo nunca aparecem na ficha do outro", async () => {
    const cavalo = (await montarComposicao(ctx.db, cavalos.linhas[0].entityId, {
      period: AGOSTO,
    }))!;
    const carreta = (await montarComposicao(ctx.db, carretas.linhas[0].entityId, {
      period: AGOSTO,
    }))!;
    const todosDoCavalo = [...cavalo.linhas, ...cavalo.naoApurados].map((x) => x.code);
    const todosDaCarreta = [...carreta.linhas, ...carreta.naoApurados].map((x) => x.code);
    expect(todosDoCavalo.every((c) => c.startsWith("cavalo."))).toBe(true);
    expect(todosDaCarreta.every((c) => c.startsWith("carreta."))).toBe(true);
  });
});
