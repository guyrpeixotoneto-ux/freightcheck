import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resolveContext } from "@workspace/comparison";
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
   * As duas placas que abriram este trabalho, sobre o dado real.
   *
   * `RZG4I77` e `RZG5A37` estão em março/2026 e abril/2026 do export e em mais
   * nenhuma vigência. A Cobertura continua cobrando as duas em agosto — e deve,
   * porque ninguém registrou baixa —, e a Composição de agosto não as tem,
   * porque elas não vieram em agosto.
   *
   * **O que mudou.** Maio/2026 é a vigência em que a antiga união com a
   * vigência anterior as fazia aparecer: 64 linhas para 62 cavalos recebidos,
   * as duas com "fora da vigência" na coluna do valor. Em junho elas evaporavam
   * sem que nada dissesse por quê. Era a Composição respondendo "recebido" em
   * oito vigências e "recebido + saiu no mês passado" na nona.
   *
   * Agora maio traz 62, como todas as outras — e as duas placas continuam
   * acessíveis pela ficha, que é onde se pergunta pela vida de um equipamento.
   */
  it("não traz em maio/2026 os cavalos que só existiram até abril", async () => {
    const MAIO = "2026-05-02";
    const maio = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: MAIO }))!;

    expect(maio.linhas).toHaveLength(62);
    for (const placa of ["RZG4I77", "RZG5A37"]) {
      expect(maio.linhas.find((l) => l.placa === placa), placa).toBeUndefined();
    }

    /* E elas existem: abril é o último mês em que o arquivo as trouxe. */
    const abril = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: "2026-04-02" }))!;
    for (const placa of ["RZG4I77", "RZG5A37"]) {
      expect(abril.linhas.find((l) => l.placa === placa), placa).toBeDefined();
    }
    expect(abril.linhas).toHaveLength(64);
  });

  /**
   * A frota encolhe de 64 para 62 e o total não é lido como queda de preço.
   *
   * Abril tem 64 cavalos; maio tem 62, e são os mesmos 62 mais nenhum. Este
   * teste fixa que `mensalTotal` de maio é a soma **do que veio em maio** e que
   * `variacaoTotal` fala só dos comparáveis — os dois cavalos que saíram não
   * viram uma redução de remuneração, porque não são uma.
   */
  it("a saída de dois cavalos entre abril e maio não vira queda de remuneração", async () => {
    const abril = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: "2026-04-02" }))!;
    const maio = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: "2026-05-02" }))!;

    expect(abril.resumo.equipamentos).toBe(64);
    expect(maio.resumo.equipamentos).toBe(62);

    /* O total é exatamente a soma das linhas que estão na lista. */
    const soma = maio.linhas.reduce((s, l) => s + (l.mensal ?? 0), 0);
    expect(maio.resumo.mensalTotal).toBeCloseTo(Number(soma.toFixed(2)), 2);

    /*
      A variação só existe para quem tem as duas pontas. Os dois que saíram não
      estão na lista de maio, então não há linha deles a variar — e se houvesse,
      ela viria com `variacao: null`, porque `calcularVariacao` recusa uma ponta
      nula. De um jeito ou de outro, a saída não entra no total da variação.
    */
    const comVariacao = maio.linhas.filter((l) => l.variacao !== null);
    const somaDasVariacoes = comVariacao.reduce((s, l) => s + l.variacao!.absoluta, 0);
    expect(maio.resumo.variacaoTotal).toBeCloseTo(Number(somaDasVariacoes.toFixed(2)), 2);

    /* Nenhuma linha de maio fala em saída de frota. */
    expect(maio.linhas.some((l) => l.status.motivos.join(" ").includes("saiu da frota"))).toBe(
      false,
    );
  });

  /**
   * O teste que existe por causa do achado — e que mudou de contrato em
   * 18/08/2026.
   *
   * Ele afirmava que a soma das duas frotas **reproduz** o `custoFixo` da fonte,
   * e passava. A identidade era verdadeira e a leitura dela era falsa: o
   * `custoFixo` da fonte conta o lucro fixo do cavalo duas vezes nos pares em
   * que o financiamento do cavalo já acabou — uma vez dentro de `finame` (que
   * contém `finameCavalo`) e outra dentro de `lucroFixomodeloNovoCiclo`. Medido:
   * 51 de 51 pares com `lucroFixomodeloNovoCicloCavalo` não nulo, zero exceções.
   *
   * Reproduzir a fonte deixou de ser o alvo. A soma das duas frotas agora fica
   * **abaixo** do `custoFixo` exatamente pelo valor repetido — e é essa
   * diferença, e não a igualdade, que este teste guarda.
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
      O que sobra da fonte tem nome: é a parte de `lucroFixomodeloNovoCiclo` que
      não é da carreta — isto é, o lucro fixo do cavalo vinculado, pela
      decomposição medida em 284 de 284 pares. É a diferença entre a coluna do
      conjunto e a parcela própria da carreta, e não a soma bruta da coluna do
      cavalo: um cavalo cuja carreta não está nesta vigência não tem esse valor
      repetido em lugar nenhum, e somá-lo aqui inventaria R$ 3.566,00 de
      diferença que a fonte não tem.
    */
    const { rows: repetido } = await ctx.db.execute<{ soma: string }>(sql`
      SELECT (
        (SELECT sum(f.value_numeric)
           FROM fact f JOIN attribute a ON a.id = f.attribute_id
           JOIN snapshot s ON s.id = f.snapshot_id
          WHERE a.code = 'carreta.lucro_fixomodelo_novo_ciclo'
            AND s.effective_date = ${AGOSTO}::date)
        -
        (SELECT sum(f.value_numeric)
           FROM fact f JOIN attribute a ON a.id = f.attribute_id
           JOIN snapshot s ON s.id = f.snapshot_id
          WHERE a.code = 'carreta.lucro_fixomodelo_novo_ciclo_carreta'
            AND s.effective_date = ${AGOSTO}::date)
      )::text AS soma
    `);
    const lucroDoCavaloRepetido = Number(repetido[0].soma);
    expect(lucroDoCavaloRepetido).toBeGreaterThan(0);

    expect(carretas.resumo.mensalTotal + cavalos.resumo.mensalTotal).toBeCloseTo(
      custoFixoDaFonte - lucroDoCavaloRepetido,
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

  it("as três colunas de conjunto aparecem na ficha da carreta, e fora do total", async () => {
    const alguma = carretas.linhas.find((l) => l.placa === "RZM0C81")!;
    const c = (await montarComposicao(ctx.db, alguma.entityId, { period: AGOSTO }))!;

    const conjunto = c.naoApurados.filter((n) => n.motivo === "ESCOPO_DE_CONJUNTO");
    expect(conjunto.map((n) => n.code).sort()).toEqual([
      "carreta.custo_fixo",
      "carreta.finame",
      "carreta.lucro_fixomodelo_novo_ciclo",
    ]);
    expect(c.linhas.some((l) => l.code === "carreta.custo_fixo")).toBe(false);

    // E o valor da coluna continua visível: quem confere a planilha vai achá-lo.
    expect(conjunto.find((n) => n.code === "carreta.custo_fixo")!.valorNumerico).toBeCloseTo(
      23_408.92,
      2,
    );
  });
});

/**
 * As duas correções de 18/08/2026, medidas contra o export real.
 *
 * A primeira é dinheiro que saiu de onde não devia estar. A segunda é a frase
 * que a tela tinha permissão de dizer e não devia ter.
 */
describe("a dupla contagem do lucro fixo, e a pendência que a tela escondia", () => {
  it("o lucro fixo do conjunto sai do total da carreta, e a parcela dela entra", async () => {
    const alguma = carretas.linhas.find((l) => l.placa === "RZM0C81")!;
    const c = (await montarComposicao(ctx.db, alguma.entityId, { period: AGOSTO }))!;

    const conjunto = c.naoApurados.find(
      (n) => n.code === "carreta.lucro_fixomodelo_novo_ciclo",
    )!;
    expect(conjunto.motivo).toBe("ESCOPO_DE_CONJUNTO");
    // O valor continua na tela: quem confere a planilha vai encontrá-lo lá.
    expect(conjunto.valorNumerico).not.toBeNull();

    /*
      E a linha própria da carreta ocupou o lugar. Sem esta metade, excluir a
      coluna de conjunto teria levado embora também o dinheiro do implemento.
    */
    expect(
      c.linhas.some((l) => l.code === "carreta.lucro_fixomodelo_novo_ciclo_carreta"),
    ).toBe(true);
  });

  /**
   * O total da frota de carretas em agosto/2026, com o número antes e depois.
   *
   * R$ 336.803,77 era `finameImplemento` + `lucroFixomodeloNovoCiclo`, e os
   * R$ 34.793,84 de diferença são o lucro fixo dos cavalos vinculados — o mesmo
   * dinheiro que já está na linha de cada cavalo.
   */
  it("a frota de carretas encolhe exatamente o que era do cavalo", () => {
    expect(carretas.resumo.mensalTotal).toBeCloseTo(302_009.93, 2);
    expect(cavalos.resumo.mensalTotal).toBeCloseTo(867_860.23, 2);
  });

  it("nenhuma das duas frotas pode se declarar apurada", () => {
    for (const frota of [cavalos, carretas]) {
      /*
        O ponto do teste é a combinação: **todo** equipamento tem valor apurado
        e, ao mesmo tempo, nenhum está completo. Era exatamente essa combinação
        que a tela lia como "100% apurado" — e é ela que `apuracaoCompleta`
        passa a responder sozinha.
      */
      expect(frota.resumo.comValorApurado).toBe(frota.resumo.equipamentos);
      expect(frota.resumo.componentesSemClassificacao).toBeGreaterThan(0);
      expect(frota.resumo.equipamentosComPendencia).toBe(frota.resumo.equipamentos);
      expect(frota.resumo.apuracaoCompleta).toBe(false);
    }
  });

  /**
   * O caso que motivou tudo: R$ 216.173,31 por mês de lucro variável previsto,
   * fora da conta e fora da contagem.
   *
   * Ele continua fora da conta — ninguém mediu a periodicidade dele, e somá-lo
   * ao mensal seria presumir. O que muda é que ele deixou de ser invisível.
   */
  it("o lucro variável previsto do cavalo aparece como pendência declarada", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "QYP3G72")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;

    const lucro = c.naoApurados.find(
      (n) => n.code === "cavalo.lucro_variavel_previsto_cavalo",
    )!;
    expect(lucro.semClassificacao).toBe(true);
    expect(lucro.valorNumerico).toBeGreaterThan(0);
    expect(c.linhas.some((l) => l.code === "cavalo.lucro_variavel_previsto_cavalo")).toBe(false);
    expect(c.completude.parcial).toBe(true);
    expect(c.completude.semClassificacao).toBeGreaterThan(0);
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
      A manutenção por quilômetro é o caso D5 da arquitetura, e o motivo que a
      tela exibe mudou em 29/08/2026 — para melhor.

      Até então ela parava no primeiro portão: ninguém tinha confirmado o
      significado da coluna, e dizer "falta a quilometragem" a respeito de uma
      coluna cujo significado não foi confirmado mandaria pedir à Ambev um dado
      que talvez nem resolvesse. Agora a curadoria confirmou o que ela é — uma
      razão em R$/km —, e por isso o motivo passou a ser o seguinte da fila:
      **a base operacional não veio**. É a pergunta certa para fazer à Ambev, e
      é o que separa "ninguém olhou" de "olharam, e falta o km".
    */
    const manutencao = c.naoApurados.find((n) => n.code === "cavalo.manutencao_reais_km")!;
    expect(manutencao.motivo).toBe("BASE_AUSENTE");
    expect(manutencao.unit).toBe("BRL_KM");
    expect(manutencao.baseQueFalta).toContain("quilometragem");
    expect(manutencao.monetarioPotencial).toBe(true);
    expect(manutencao.semClassificacao).toBe(false);
  });

  /**
   * O bloco de 29/08/2026, medido pelo lado de quem lê a ficha.
   *
   * Quarenta e uma colunas saíram de "ninguém olhou" para "alguém decidiu que
   * não é dinheiro", e a afirmação que este teste prende é a que autorizou o
   * commit: **o total não se moveu.** Os números da frota estão travados mais
   * acima (867.860,23 e 302.009,93); aqui trava-se o que era para mudar — a
   * lista de pendências — e o que não era: as quatro linhas apuradas.
   */
  it("classificar os números não apurados não moveu um centavo", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;

    expect(c.linhas).toHaveLength(4);
    expect(c.totais.find((t) => t.gaveta === "MENSAL")!.valor).toBeCloseTo(16_769.83, 2);

    /*
      Cinco, e eram trinta e quatro. Os que sobram são exatamente os que não se
      decidem por medição: o lucro variável previsto (é dinheiro, e a
      periodicidade é decisão de negócio), o custo variável simulado (fórmula
      não confirmada) e as três colunas que a fonte manda zeradas na série
      inteira.
    */
    const semClasse = c.naoApurados.filter((n) => n.semClassificacao).map((n) => n.code);
    expect(semClasse.sort()).toEqual([
      "cavalo.custo_aluguel",
      "cavalo.custo_variavel_simulado",
      "cavalo.lucro_variavel_previsto_cavalo",
      "cavalo.valor_icms",
      "cavalo.valor_pneu",
    ]);

    /*
      E nenhuma das 41 confirmadas virou dinheiro: se uma delas tivesse entrado
      num total, o número acima teria mudado — mas a checagem direta é esta,
      porque ela falha com o nome do culpado.
    */
    const confirmadasQueEntraram = c.linhas.filter((l) =>
      ["cavalo.manutencao_reais_km", "cavalo.taxa_finame", "cavalo.ano", "cavalo.ciclo"].includes(
        l.code,
      ),
    );
    expect(confirmadasQueEntraram).toEqual([]);
  });
});

/**
 * A outra metade da rastreabilidade: **nada da placa ficou pelo caminho.**
 *
 * A ficha já provava, acima, que todo número exibido sabe de qual célula veio.
 * Estes testes provam o inverso — que toda célula que o arquivo trouxe para a
 * placa chegou à ficha —, e é o inverso que protege contra o defeito que não
 * aparece: uma coluna renomeada na origem, ou que passe a colidir com outra,
 * não produz erro nenhum. Produz uma ficha menor, com todas as linhas exibidas
 * conferindo entre si.
 */
describe("o rastreio de um equipamento — do arquivo até a ficha", () => {
  it("fecha a conta de conservação da placa: 77 células = 75 fatos + 2 de endereço", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;
    const r = c.rastreio;

    expect(r.linhasDoArquivo).toBe(1);
    expect(r.celulas).toBe(77);
    expect(r.viraramFato).toBe(75);
    /* Placa e Vigencia: não viram valor porque são o endereço do valor. */
    expect(r.endereco).toBe(2);
    expect(r.colunaSemCabecalho + r.colunaAmbigua + r.semDestino).toBe(0);
    expect(r.amostras).toEqual([]);
    expect(r.fecha).toBe(true);
  });

  it("o que virou fato é exatamente o que a ficha mostra", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: AGOSTO }))!;
    expect(c.rastreio.fatos).toBe(c.linhas.length + c.naoApurados.length);
    expect(c.rastreio.fatosSemCelula).toBe(0);
  });

  /*
    A frota inteira e não uma placa: o defeito que este rastreio existe para
    pegar é de coluna, e uma coluna que some some para todo mundo — mas uma
    coluna que colide com outra pode sumir só para as linhas em que as duas
    vêm preenchidas. Uma placa só não veria a diferença.
  */
  it("fecha para os 133 equipamentos de agosto/2026, sem exceção", async () => {
    const equipamentos = [...cavalos.linhas, ...carretas.linhas];
    expect(equipamentos).toHaveLength(133);

    const naoFecham: string[] = [];
    for (const equipamento of equipamentos) {
      const c = (await montarComposicao(ctx.db, equipamento.entityId, {
        period: AGOSTO,
        comAnterior: false,
      }))!;
      if (!c.rastreio.fecha) naoFecham.push(`${c.placa}: ${JSON.stringify(c.rastreio)}`);
    }
    expect(naoFecham).toEqual([]);
  }, 120_000);

  it("uma vigência em que a placa não veio não inventa conta nenhuma", async () => {
    const linha = cavalos.linhas.find((l) => l.placa === "RPH2G11")!;
    const c = (await montarComposicao(ctx.db, linha.entityId, { period: "2025-12-02" }))!;
    if (!c.presente) {
      expect(c.rastreio.celulas).toBe(0);
      expect(c.rastreio.fatos).toBe(0);
    } else {
      expect(c.rastreio.fecha).toBe(true);
    }
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
    // A vigência e o contexto vão resolvidos, como a rota os passa.
    const context = (await resolveContext(ctx.db))!;
    let comVinculo = 0;
    for (const linha of cavalos.linhas) {
      const vinculo = await getVinculoDoCavalo(ctx.db, linha.entityId, {
        effectiveDate: AGOSTO,
        context,
      });
      if (vinculo === null) continue;
      comVinculo += 1;
      expect(vinculo.carretaEntityId, `${linha.placa} → ${vinculo.placaCarreta}`).not.toBeNull();
      expect(vinculo.totalDoConjunto).not.toBeNull();
      expect(vinculo.ambiguidade).toBeNull();
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
