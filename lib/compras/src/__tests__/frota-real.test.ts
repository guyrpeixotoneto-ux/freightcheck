import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { getVisaoDeFrota, montarComposicao } from "@workspace/composition";
import { acharPlaca, buscarPlacas, remuneradoDaPlaca, type ConsultaDaPlaca } from "../frota";
import { produtoDe, produtosDoBalcao } from "../catalogo";
import { matrizDaFrota, type MatrizDaFrota } from "../matriz";

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
  /*
    Sem `&& l.presente`: a lista da Composição passou a ser só o que veio na
    vigência, então toda linha daqui já é de um cavalo presente — ver o campo
    ausente em `LinhaDaFrota`.
  */
  const cavalo = frota.linhas.find((l) => l.placa !== null);
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

/**
 * A matriz da frota, contra o mesmo export.
 *
 * O que este bloco protege é a promessa do módulo em uma frase: **a célula de
 * uma placa na matriz e a ficha dessa placa são o mesmo número.** Tudo o mais
 * aqui — os totais, as marcas de vazio — decorre disso; se a célula divergir da
 * ficha, o resto é aritmética sobre um número errado.
 */
describe("a matriz da frota", () => {
  let matriz: MatrizDaFrota;

  beforeAll(async () => {
    matriz = (await matrizDaFrota(ctx.db, { period: AGOSTO }))!;
  }, 120_000);

  it("traz a frota inteira, sem pedir placa nenhuma", () => {
    expect(matriz.effectiveDate).toBe(AGOSTO);
    expect(matriz.linhas.length).toBeGreaterThan(1);
    expect(matriz.resumo.veiculos).toBe(matriz.linhas.length);
    /* Cavalo e carreta juntos — a compra não conhece a fronteira entre os dois. */
    expect(matriz.resumo.porTipo.map((t) => t.entityType)).toEqual(["CAVALO", "CARRETA"]);
    for (const tipo of matriz.resumo.porTipo) expect(tipo.veiculos).toBeGreaterThan(0);
  });

  it("as colunas são as do catálogo, na ordem dele", () => {
    expect(matriz.colunas.map((c) => c.produto.chave)).toEqual(
      produtosDoBalcao("FROTA").map((p) => p.chave),
    );
    /* Uma célula por coluna em toda linha — a tabela não tem buraco de forma. */
    for (const linha of matriz.linhas) {
      expect(linha.celulas).toHaveLength(matriz.colunas.length);
    }
  });

  /**
   * A prova central. Percorre a ficha de uma placa e exige que cada produto dela
   * bata com a célula correspondente — valor, gaveta e a ausência de valor.
   */
  it("a célula de uma placa é o destaque da ficha dela — número a número", async () => {
    const linha = matriz.linhas.find((l) => l.placa === placaDoCavalo)!;
    expect(linha).toBeDefined();

    const ficha = (await remuneradoDaPlaca(ctx.db, placaDoCavalo, { period: AGOSTO }))!;
    for (const [i, coluna] of matriz.colunas.entries()) {
      const produto = ficha.produtos.find((p) => p.produto.chave === coluna.produto.chave)!;
      const celula = linha.celulas[i]!;
      expect(celula.valor).toBe(produto.destaque?.valor ?? null);
      expect(celula.gaveta).toBe(produto.destaque?.gaveta ?? null);
      expect(celula.colunas).toBe(produto.linhas.length);
    }
  });

  /**
   * O vazio diz de qual vazio se trata — e a classificação é fechada: onde não
   * há número, há sempre um motivo, e onde há número não há motivo nenhum.
   */
  it("toda célula sem número traz o motivo, e nenhuma com número traz", () => {
    for (const linha of matriz.linhas) {
      for (const celula of linha.celulas) {
        if (celula.valor === null) expect(celula.vazio).not.toBeNull();
        else expect(celula.vazio).toBeNull();
      }
      /* Sem coluna é sem coluna: nenhum motivo mente sobre quantas existem. */
      for (const celula of linha.celulas) {
        if (celula.vazio === "SEM_COLUNA") expect(celula.colunas).toBe(0);
        else expect(celula.colunas).toBeGreaterThan(0);
      }
    }
  });

  /**
   * O pneu — a ressalva que este produto inteiro existe para carregar. Na
   * matriz ela viaja na coluna, porque não cabe em oitenta células.
   */
  it("a coluna de pneu chega ressalvada, e o total dela não é lido como preço", () => {
    const pneu = matriz.colunas.find((c) => c.produto.chave === "pneu")!;
    expect(pneu.produto.ressalva?.motivo).toBe("COLUNA_ZERADA_NA_SERIE");
  });

  /**
   * A recusa que a inversão do eixo poderia ter perdido: **gavetas não se
   * somam.** Onde há total, todas as células que o formam estão na mesma
   * gaveta — e o total é exatamente a soma delas, sem arredondamento pelo meio.
   */
  it("o total de uma coluna é a soma das células, e só existe dentro de uma gaveta", () => {
    for (const [i, coluna] of matriz.colunas.entries()) {
      const comValor = matriz.linhas
        .map((l) => l.celulas[i]!)
        .filter((c) => c.valor !== null);

      expect(coluna.veiculosComValor).toBe(comValor.length);

      if (coluna.total === null) {
        expect(coluna.semTotal).not.toBeNull();
        if (coluna.semTotal === "SEM_VALOR") expect(comValor).toHaveLength(0);
        else expect(new Set(comValor.map((c) => c.gaveta)).size).toBeGreaterThan(1);
        continue;
      }

      expect(coluna.semTotal).toBeNull();
      expect(new Set(comValor.map((c) => c.gaveta)).size).toBe(1);
      expect(coluna.gaveta).toBe(comValor[0]!.gaveta);
      expect(coluna.total).toBeCloseTo(
        comValor.reduce((s, c) => s + c.valor!, 0),
        2,
      );
    }
  });

  /**
   * A soma não parece o todo: o que não pertence a produto nenhum sai contado,
   * como no balcão. Sem isto, a matriz se anunciaria como tudo o que a fonte
   * diz de um veículo, quando é o recorte do que se compra.
   */
  it("as rubricas fora do catálogo saem contadas, e não escondidas", () => {
    expect(matriz.foraDoCatalogo.length).toBeGreaterThan(0);
    for (const rubrica of matriz.foraDoCatalogo) expect(rubrica.colunas).toBeGreaterThan(0);
  });

  it("um tipo pedido de propósito recorta a matriz, sem mudar as colunas", async () => {
    const soCarretas = (await matrizDaFrota(ctx.db, {
      period: AGOSTO,
      entityTypes: ["CARRETA"],
    }))!;
    expect(soCarretas.linhas.every((l) => l.entityType === "CARRETA")).toBe(true);
    expect(soCarretas.linhas.length).toBeLessThan(matriz.linhas.length);
    expect(soCarretas.colunas.map((c) => c.produto.chave)).toEqual(
      matriz.colunas.map((c) => c.produto.chave),
    );
  });
});
