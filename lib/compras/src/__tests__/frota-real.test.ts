import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { getVisaoDeFrota, montarComposicao } from "@workspace/composition";
import { acharPlaca, buscarPlacas, remuneradoDaPlaca, type ConsultaDaPlaca } from "../frota";
import { produtoDe } from "../catalogo";

/**
 * O balcão da frota contra o export real da Freightec.
 *
 * O que este arquivo protege, em uma frase: **o remunerado que a tela de compra
 * mostra é o mesmo que a auditoria apura.** A prova disso não é uma inspeção
 * visual — é a comparação linha a linha contra `montarComposicao`, no mesmo
 * banco e na mesma vigência, em `nenhum número é inventado pelo caminho`.
 *
 * As placas não estão fixadas no código de propósito. Elas saem da própria
 * vigência, porque o que se afirma aqui é sobre o comportamento do balcão, e
 * não sobre um veículo em particular; fixar uma placa faria a suíte quebrar no
 * dia em que aquele cavalo saísse da frota, por um motivo que não é defeito.
 */

let ctx: TestDb;
let consultaDeCavalo: ConsultaDaPlaca;
let placaDoCavalo: string;

/** A última vigência do export: EMPURRADA_1_8_2026. */
const AGOSTO = "2026-08-01";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("compras_frota");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);

  /*
    A placa sai da própria visão de frota, e não de um prefixo escolhido a dedo:
    é a mesma lista que a tela de Composição oferece, então o cavalo escolhido
    aqui é necessariamente um que o produto sabe apurar.
  */
  const frota = (await getVisaoDeFrota(ctx.db, "CAVALO", { period: AGOSTO }))!;
  const cavalo = frota.linhas.find((l) => l.placa !== null && l.presente);
  if (!cavalo) throw new Error("o export real não trouxe cavalo com placa nesta vigência");
  placaDoCavalo = cavalo.placa!;
  consultaDeCavalo = (await remuneradoDaPlaca(ctx.db, placaDoCavalo, { period: AGOSTO }))!;
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("achar a placa", () => {
  it("encontra pelo prefixo, e ignora caixa e pontuação", async () => {
    const cruas = await buscarPlacas(ctx.db, placaDoCavalo.slice(0, 3).toLowerCase());
    expect(cruas.map((p) => p.placa)).toContain(placaDoCavalo);

    const comHifen = `${placaDoCavalo.slice(0, 3)}-${placaDoCavalo.slice(3)}`;
    expect((await acharPlaca(ctx.db, comHifen))?.placa).toBe(placaDoCavalo);
  });

  it("recusa um termo curto demais em vez de devolver a frota inteira", async () => {
    expect(await buscarPlacas(ctx.db, placaDoCavalo.slice(0, 1))).toEqual([]);
    expect(await buscarPlacas(ctx.db, "")).toEqual([]);
  });

  it("respeita o limite pedido — a busca oferece escolhas, não um relatório", async () => {
    const duasLetras = await buscarPlacas(ctx.db, placaDoCavalo.slice(0, 2), 3);
    expect(duasLetras.length).toBeLessThanOrEqual(3);
  });

  it("devolve null para placa que não existe — e a consulta devolve null junto", async () => {
    expect(await acharPlaca(ctx.db, "XXX0X00")).toBeNull();
    expect(await remuneradoDaPlaca(ctx.db, "XXX0X00", { period: AGOSTO })).toBeNull();
  });
});

describe("o remunerado de um cavalo", () => {
  it("abre na vigência pedida, com o ativo presente", () => {
    expect(consultaDeCavalo.entityType).toBe("CAVALO");
    expect(consultaDeCavalo.effectiveDate).toBe(AGOSTO);
    expect(consultaDeCavalo.presente).toBe(true);
    expect(consultaDeCavalo.placa.corrente).toBe(true);
  });

  it("oferece todos os produtos do balcão, inclusive os que a fonte não responde", () => {
    /*
      A lista é a do catálogo, e não a dos dados. Um produto sem coluna nesta
      placa aparece vazio: some-lo faria a tela responder "a Ambev não remunera
      isto" com um silêncio.
    */
    const chaves = consultaDeCavalo.produtos.map((p) => p.produto.chave);
    expect(chaves).toContain("pneu");
    expect(chaves).toContain("manutencao-avulsa");
    expect(chaves).toContain("financiamento");
    expect(chaves).toContain("aquisicao");
  });

  /**
   * A prova central: **nenhum número é inventado pelo caminho**.
   *
   * Toda linha que o balcão exibe tem de existir na composição do mesmo ativo,
   * com o mesmo valor. O balcão reagrupa; ele não calcula.
   */
  it("nenhum número é inventado pelo caminho — tudo vem da composição", async () => {
    const composicao = (await montarComposicao(ctx.db, consultaDeCavalo.placa.entityId, {
      period: AGOSTO,
      comAnterior: false,
    }))!;

    const daComposicao = new Map<string, number | null>([
      ...composicao.linhas.map((l) => [l.code, l.valor] as const),
      ...composicao.naoApurados.map((c) => [c.code, c.valorNumerico] as const),
    ]);

    const linhas = consultaDeCavalo.produtos.flatMap((p) => p.linhas);
    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) {
      expect(daComposicao.has(linha.code)).toBe(true);
      expect(linha.valor).toBe(daComposicao.get(linha.code));
    }
  });

  /**
   * O outro lado da mesma prova: **nenhuma coluna é perdida pelo caminho**.
   *
   * Toda coluna da composição ou virou linha de um produto, ou foi contada em
   * `foraDoCatalogo`. Sem esta prova, uma rubrica que o catálogo não reclamasse
   * sumiria da tela sem deixar rastro — que é a falha silenciosa que este
   * módulo inteiro existe para não cometer.
   */
  it("nenhuma coluna é perdida pelo caminho", async () => {
    const composicao = (await montarComposicao(ctx.db, consultaDeCavalo.placa.entityId, {
      period: AGOSTO,
      comAnterior: false,
    }))!;
    const naFonte = composicao.linhas.length + composicao.naoApurados.length;

    const emProdutos = consultaDeCavalo.produtos.reduce((n, p) => n + p.linhas.length, 0);
    const foraDoCatalogo = consultaDeCavalo.foraDoCatalogo.reduce((n, r) => n + r.colunas, 0);

    expect(emProdutos + foraDoCatalogo).toBe(naFonte);
    expect(emProdutos).toBeGreaterThan(0);
    expect(foraDoCatalogo).toBeGreaterThan(0);
  });

  /**
   * O achado que a ressalva do catálogo anuncia, medido aqui no dado real.
   *
   * `valorPneu` é zero em toda a série. O balcão mostra o zero — é o que a
   * fonte declara —, e o que a ressalva acrescenta é que zero, nesta coluna,
   * não quer dizer "a Ambev paga zero por pneu".
   */
  it("o pneu chega com número zero e com a ressalva ao lado", () => {
    const pneu = consultaDeCavalo.produtos.find((p) => p.produto.chave === "pneu")!;
    expect(pneu.produto.ressalva?.motivo).toBe("COLUNA_ZERADA_NA_SERIE");

    const valor = pneu.linhas.find((l) => l.code === "cavalo.valor_pneu");
    expect(valor).toBeDefined();
    expect(valor!.valor).toBe(0);
  });

  /**
   * A manutenção é R$/km, e a tela tem de dizer o que falta para virar reais.
   *
   * A frase sai da composição — `explicacao` mais `baseQueFalta` — e não é
   * reescrita aqui: duas maneiras de explicar a mesma lacuna fariam parecer que
   * são duas lacunas.
   */
  it("a manutenção diz que é razão e qual base falta", () => {
    const manutencao = consultaDeCavalo.produtos.find(
      (p) => p.produto.chave === "manutencao-avulsa",
    )!;
    const razao = manutencao.linhas.find((l) => l.code === "cavalo.manutencao_reais_km");
    expect(razao).toBeDefined();
    expect(razao!.apurado).toBe(false);
    expect(razao!.motivo).toBeTruthy();
    expect(produtoDe("manutencao-avulsa")!.ressalva?.motivo).toBe("RAZAO_SEM_BASE");
  });

  /**
   * O destaque existe quando exatamente uma linha responde a pergunta, e some
   * quando mais de uma responde. É o que impede a tela de somar alternativas —
   * a taxa do contrato e a da matriz do BID não se somam em hipótese nenhuma.
   */
  it("o financiamento tem destaque, e ele é o que a composição apurou", () => {
    const financiamento = consultaDeCavalo.produtos.find(
      (p) => p.produto.chave === "financiamento",
    )!;
    expect(financiamento.destaque).not.toBeNull();
    expect(financiamento.destaque!.apurado).toBe(true);
    expect(financiamento.destaque!.unit).toBe("BRL");
    expect(financiamento.destaque!.valor).toBeGreaterThan(0);
    expect(financiamento.destaque!.gaveta).toBe("MENSAL");
  });

  it("o destaque nunca é uma linha não apurada", () => {
    for (const produto of consultaDeCavalo.produtos) {
      if (produto.destaque === null) continue;
      expect(produto.destaque.apurado).toBe(true);
      expect(produto.destaque.unit).toBe("BRL");
    }
  });

  /**
   * O IPVA é anual, e sai como a fonte o entrega — o ano inteiro, não dividido
   * por doze. Quem confere uma guia compara com o ano.
   */
  it("o IPVA sai anual, sem projeção mensal", () => {
    const ipva = consultaDeCavalo.produtos.find(
      (p) => p.produto.chave === "ipva-licenciamento",
    )!;
    const linha = ipva.linhas.find((l) => l.code === "cavalo.ipva_licenciamento");
    expect(linha).toBeDefined();
    expect(linha!.periodicity).toBe("ANUAL");
    expect(ipva.produto.ressalva?.motivo).toBe("OUTRA_PERIODICIDADE");
  });

  /**
   * O atalho para a carreta: quem compra pneu compra para o conjunto, e o
   * pedido de compra não conhece a fronteira entre cavalo e implemento.
   */
  it("o cavalo aponta a carreta que puxa, e a carreta abre sozinha", async () => {
    expect(consultaDeCavalo.vinculo).not.toBeNull();

    const carreta = (await remuneradoDaPlaca(ctx.db, consultaDeCavalo.vinculo!.placa, {
      period: AGOSTO,
    }))!;
    expect(carreta.entityType).toBe("CARRETA");
    expect(carreta.presente).toBe(true);
    /* A carreta não puxa ninguém: o atalho é de mão única, e some do outro lado. */
    expect(carreta.vinculo).toBeNull();
  });
});
