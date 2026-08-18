import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { loadAttributeClassifications } from "../classification";
import { getPanoramaDeAlteracoes, type ParametroAlterado } from "../panorama";

/**
 * O panorama, sobre o export real.
 *
 * Os números vieram da aritmética sobre os dois arquivos de `attached_assets`,
 * medida fora deste código antes de ser esperada aqui — contando transições de
 * valor entre vigências consecutivas, placa a placa. É o contrato desta
 * leitura: ela existe para responder *o que mudou* sem que ninguém precise
 * escolher um parâmetro primeiro, e cada bloco abaixo protege uma forma
 * diferente de errar essa resposta.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("panorama_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const de = (
  panorama: Awaited<ReturnType<typeof getPanoramaDeAlteracoes>>,
  code: string,
): ParametroAlterado | undefined =>
  panorama!.parametros.find((p) => p.code === code);

describe("o primeiro nível responde o que mudou", () => {
  it("lista muito mais do que o FINAME", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // Dezenove parâmetros do cavalo e dezesseis da carreta mudaram no export.
    // O número exato importa menos do que a ordem de grandeza: abrir num
    // parâmetro escondia dezenas de alterações reais.
    expect(panorama.parametros.length).toBeGreaterThan(25);
    expect(panorama.totais.alteracoes).toBeGreaterThan(2000);
  });

  it("atravessa os dois equipamentos numa lista só", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const tipos = new Set(panorama.parametros.map((p) => p.entityType));
    expect([...tipos].sort()).toEqual(["CARRETA", "CAVALO"]);
  });

  it("conta as transições de valor, e não as linhas do arquivo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // Medido no arquivo: finameCavalo muda 37 vezes, em 15 das 64 placas.
    const finame = de(panorama, "cavalo.finame_cavalo")!;
    expect(finame.changes).toBe(37);
    expect(finame.entities).toBe(15);
    expect(finame.entitiesNaSerie).toBe(64);

    // E o IPVA do cavalo muda 122 vezes, em 62 placas — muito mais do que o
    // parâmetro em que a aba abria.
    const ipva = de(panorama, "cavalo.ipva_licenciamento")!;
    expect(ipva.changes).toBe(122);
    expect(ipva.entities).toBe(62);
  });
});

describe("as duas contas nunca viram uma", () => {
  it("o ranking financeiro só admite quem passa na régua", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    for (const code of panorama.maiorImpacto) {
      const p = de(panorama, code)!;
      expect(p.impactoCalculavel).toBe(true);
      expect(p.semanticsStatus).toBe("CONFIRMED");
      expect(p.isMonetary).toBe(true);
      expect(p.aggregation).toBe("SUM");
    }
  });

  it("quem lidera em alterações não lidera em dinheiro", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // `manutencao_vida_meses` muda 494 vezes e não é dinheiro nenhum. Um
    // ranking só, ordenado por quantidade, o poria acima de tudo que custa.
    expect(panorama.maisAlterados[0]).not.toBe(panorama.maiorImpacto[0]);
    const lider = de(panorama, panorama.maisAlterados[0])!;
    expect(lider.impactoCalculavel).toBe(false);
  });

  it("o ranking financeiro está ordenado pela variação de preço, dentro de cada periodicidade", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    expect(panorama.impactoPorPeriodicidade.length).toBeGreaterThan(0);

    // Dentro do grupo, e não na lista achatada: entre periodicidades a ordem é
    // a da leitura — mensal antes de anual —, porque comparar R$/mês com
    // R$/ano exigiria uma conversão que aqui não se faz.
    for (const grupo of panorama.impactoPorPeriodicidade) {
      const precos = grupo.codes.map((c) =>
        Math.abs(de(panorama, c)!.variacao?.preco ?? 0),
      );
      expect([...precos].sort((a, b) => b - a)).toEqual(precos);
    }
  });

  it("preço mais frota reconstrói a variação total, sempre", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const comVariacao = panorama.parametros.filter((p) => p.variacao !== null);
    expect(comVariacao.length).toBeGreaterThan(0);

    for (const p of comVariacao) {
      const v = p.variacao!;
      expect(v.preco + v.frota).toBeCloseTo(v.total, 2);
    }
  });
});

describe("quem não passa na régua aparece mesmo assim", () => {
  it("o lucro variável entra na lista, com o motivo escrito", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const lucro = de(panorama, "cavalo.lucro_variavel_previsto_cavalo")!;

    expect(lucro.changes).toBe(107);
    expect(lucro.entities).toBe(34);
    expect(lucro.impactoCalculavel).toBe(false);
    expect(lucro.impactoMotivo).not.toBe("");
    expect(lucro.variacao).toBeNull();
    expect(panorama.semLeituraFinanceira).toContain(
      "cavalo.lucro_variavel_previsto_cavalo",
    );
  });

  it("todo parâmetro sem régua tem motivo, e nenhum com régua tem", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    for (const p of panorama.parametros) {
      expect(p.impactoMotivo === "").toBe(p.impactoCalculavel);
    }
  });
});

describe("o total manda e a parcela desce", () => {
  it("as parcelas de um total que mudou ficam fora dos dois rankings", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // As 27 transições de juros e as 10 de amortização já estão dentro das 37
    // do `finame_cavalo`: listá-las ao lado contaria o mesmo real de novo.
    for (const parcela of [
      "cavalo.juros_finame_cavalo",
      "cavalo.amortizacao_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ]) {
      expect(de(panorama, parcela)?.papel).toBe("PARCELA");
      expect(de(panorama, parcela)?.dentroDe).toBe("cavalo.finame_cavalo");
      expect(panorama.maiorImpacto).not.toContain(parcela);
      expect(panorama.maisAlterados).not.toContain(parcela);
    }

    // E o total continua lá, uma vez.
    expect(panorama.maiorImpacto).toContain("cavalo.finame_cavalo");
  });

  it("a parcela continua na lista, para o drill-down do total", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    expect(de(panorama, "cavalo.juros_finame_cavalo")).toBeDefined();

    const total = de(panorama, "cavalo.finame_cavalo")!;
    expect(total.papel).toBe("TOTAL");
    expect(total.parcelas).toEqual([
      "cavalo.amortizacao_cavalo",
      "cavalo.juros_finame_cavalo",
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    ]);
  });

  it("tira dos rankings o que já contém o outro equipamento", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // `carreta.custo_fixo` são R$ 1,2 milhão que já incluem os R$ 867 mil de
    // `cavalo.finame_cavalo`. Somar as duas linhas contaria cada cavalo duas
    // vezes — que é exatamente o que o produto recusa do outro lado, em
    // `motor.ts`.
    for (const code of [
      "carreta.finame",
      "carreta.custo_fixo",
      "carreta.lucro_variavel_previsto",
    ]) {
      const p = de(panorama, code);
      expect(p?.papel).toBe("CONJUNTO");
      expect(p?.contem).toBeTruthy();
      expect(p?.evidencia).toBeTruthy();
      expect(panorama.maiorImpacto).not.toContain(code);
      expect(panorama.maisAlterados).not.toContain(code);
      expect(panorama.visaoDeConjunto).toContain(code);
    }
  });

  it("a parcela volta a ser raiz quando o total saiu por escopo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    /*
      A regra é a mesma e o exemplo dela mudou de dono em 18/08/2026.
      `lucro_fixomodelo_novo_ciclo` era a parcela que voltava a ser raiz quando
      `custo_fixo` saía por conjunto — até medir-se que ela também é de
      conjunto: é a soma da parcela da carreta com a do cavalo, 284 de 284
      pares. Quem volta a ser raiz agora é a parcela própria da carreta, e é ela
      que a carreta perderia se a saída do total a levasse junto.
    */
    expect(panorama.maisAlterados).toContain("carreta.lucro_fixomodelo_novo_ciclo_carreta");
    expect(panorama.maiorImpacto).toContain("carreta.lucro_fixomodelo_novo_ciclo_carreta");
  });

  it("a decomposição da carreta é a mesma que o motor de composição usa", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    /*
      Disjunta de verdade: `finame_implemento + lucro_fixomodelo_novo_ciclo_carreta`
      é o par que `regras.test.ts` fixa do outro lado, e nenhum real do cavalo
      entra nele. Com a coluna do conjunto no lugar da parcela — como estava
      até 18/08/2026 — a lista continuava com dois códigos e o lucro fixo do
      cavalo vinha dentro de um deles.
    */
    const daCarreta = panorama.maiorImpacto.filter(
      (c) => de(panorama, c)!.entityType === "CARRETA",
    );
    expect(daCarreta.sort()).toEqual([
      "carreta.finame_implemento",
      "carreta.lucro_fixomodelo_novo_ciclo_carreta",
    ]);
  });
});

describe("o ranking financeiro não mistura periodicidades", () => {
  it("separa MENSAL de ANUAL em listas próprias", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    const periodicidades = panorama.impactoPorPeriodicidade.map((g) => g.periodicity);
    expect(periodicidades).toContain("MENSAL");
    expect(periodicidades).toContain("ANUAL");
    // MENSAL primeiro: é a periodicidade do custo fixo, que é o que se confere.
    expect(periodicidades.indexOf("MENSAL")).toBeLessThan(
      periodicidades.indexOf("ANUAL"),
    );

    for (const grupo of panorama.impactoPorPeriodicidade) {
      for (const code of grupo.codes) {
        expect(de(panorama, code)!.periodicity).toBe(grupo.periodicity);
      }
    }
  });

  it("o IPVA anual não disputa lugar com o FINAME mensal", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // −R$ 731 mil/ano contra −R$ 52 mil/mês: numa lista só o IPVA lidera, e a
    // ordem inverte assim que alguém anualiza o outro. Converter para comparar
    // seria projeção linear, que só a Simulação admite — e sempre marcada.
    const mensal = panorama.impactoPorPeriodicidade.find(
      (g) => g.periodicity === "MENSAL",
    )!;
    const anual = panorama.impactoPorPeriodicidade.find(
      (g) => g.periodicity === "ANUAL",
    )!;
    expect(mensal.codes).toContain("cavalo.finame_cavalo");
    expect(anual.codes).toEqual(["cavalo.ipva_licenciamento"]);
    expect(mensal.codes).not.toContain("cavalo.ipva_licenciamento");
  });
});

describe("a reconciliação é medida agora, não citada", () => {
  it("mede o quanto cada identidade declarada fecha nestes dados", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // Medido no arquivo: 532 das 533 linhas com total não nulo fecham.
    const finame = de(panorama, "cavalo.finame_cavalo")!;
    expect(finame.reconciliacao).not.toBeNull();
    expect(finame.reconciliacao!.linhas).toBe(533);
    expect(finame.reconciliacao!.fecham).toBe(532);
    expect(finame.reconciliacao!.percentual).toBeCloseTo(99.8, 1);

    // E o custo fixo da carreta fecha em todas as 644 com total não nulo.
    const custoFixo = de(panorama, "carreta.custo_fixo")!;
    expect(custoFixo.reconciliacao!.linhas).toBe(644);
    expect(custoFixo.reconciliacao!.fecham).toBe(644);
  });

  it("quem não é total de nada não inventa reconciliação", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    expect(de(panorama, "cavalo.ipva_licenciamento")!.reconciliacao).toBeNull();
  });
});

/**
 * O corte por classe de custo.
 *
 * A régua destes números é a mesma de sempre — aritmética sobre os dois
 * arquivos de `attached_assets`, medida em 16/08/2026 —, e o que eles protegem
 * é uma promessa só: **o recorte é um filtro, e não uma segunda contagem**. Se
 * um dia fixo + variável + sem classe pararem de reconstruir o todo, a tela
 * passa a ter dois números para a mesma pergunta e nenhum jeito de saber qual
 * está certo.
 */
describe("fixo e variável se leem separados", () => {
  it("classifica cada parâmetro pela classe do próprio atributo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    // A classe é do atributo desde a 0030. A família da categoria dá o palpite
    // — `operacao` sugere VARIAVEL —, e é o atributo que carrega a resposta:
    // dois atributos na mesma categoria podem discordar sem duplicar o nó.
    const diesel = de(panorama, "cavalo.combustivel_consumo_neg")!;
    expect(diesel.classeDeCusto).toBe("VARIAVEL");
    expect(diesel.grupoDeCusto).toBe("Combustível");

    const ipva = de(panorama, "cavalo.ipva_licenciamento")!;
    expect(ipva.classeDeCusto).toBe("FIXO");
    expect(ipva.grupoDeCusto).toBe("Seguro do ativo");

    // O cadastral não é uma terceira classe de dinheiro: o odômetro descreve o
    // ativo e não remunera nada. Cai em SEM_CLASSE *com o grupo à mostra*, que
    // é o que separa "não é custo" de "ninguém classificou ainda".
    const odometro = de(panorama, "cavalo.odometro_entrada")!;
    expect(odometro.classeDeCusto).toBe("SEM_CLASSE");
    expect(odometro.grupoDeCusto).toBe("Especificação técnica");
  });

  /**
   * A correção de curadoria de 16/08/2026 chega aqui sozinha.
   *
   * Nada neste arquivo nem em `panorama.ts` sabe o que é um tacógrafo. A coluna
   * mudou de caixa porque `guessTaxonomyCode` passou a colocá-la em
   * `cf_outros`, e a classe desce pela mesma herança que todo mundo lê — este
   * teste é a prova de que corrigir a taxonomia basta, e de que nenhum módulo
   * precisou de exceção própria.
   */
  it("herda a colocação corrigida na taxonomia, sem lógica no panorama", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    const tacografo = de(panorama, "carreta.tacografo")!;
    expect(tacografo.classeDeCusto).toBe("FIXO");
    expect(tacografo.grupoDeCusto).toBe("Outros do ativo");

    // E ele sai do recorte sem classe junto — não fica nos dois.
    const semClasse = panorama.recortes.find((r) => r.classe === "SEM_CLASSE")!;
    expect(semClasse.maisAlterados).not.toContain("carreta.tacografo");
    const fixo = panorama.recortes.find((r) => r.classe === "FIXO")!;
    expect(fixo.maisAlterados).toContain("carreta.tacografo");
  });

  /**
   * O mesmo, pelo leitor que Composição e DRE usam.
   *
   * `loadAttributeClassifications` é a porta por onde `@workspace/composition` e
   * `@workspace/dre` perguntam a classe, e ela resolve a herança pela mesma
   * junção do panorama. Provar a correção nos dois lugares é o que sustenta a
   * afirmação de que existe **uma** resposta para "fixo ou variável" — se um
   * dia ela precisar de exceção num módulo, este teste é o que cai primeiro.
   */
  it("entrega a mesma classe ao leitor de Composição e DRE", async () => {
    const porId = await loadAttributeClassifications(ctx.db);
    const porCodigo = new Map([...porId.values()].map((c) => [c.attributeCode, c]));

    /*
      A capacidade saiu de Combustível (variável) para Especificação técnica.
      Ela não mudou de valor em vigência nenhuma, então não aparece no panorama
      — e é justamente por isso que a prova dela mora aqui.
    */
    const capacidade = porCodigo.get("cavalo.combustivel_capacidade")!;
    expect(capacidade.costClass).toBeNull();
    expect(capacidade.taxonomyName).toBe("Especificação técnica");

    // Os quatro itens do implemento, incluindo os três que não mudaram e por
    // isso nunca chegariam ao panorama.
    for (const code of [
      "carreta.faixa_reflexiva",
      "carreta.revestimento",
      "carreta.tacografo",
      "carreta.rastreador",
    ]) {
      expect(porCodigo.get(code)?.costClass).toBe("FIXO");
      expect(porCodigo.get(code)?.taxonomyName).toBe("Outros do ativo");
    }

    // E o que move o fixo sem ser o fixo continua fora dele.
    for (const code of ["carreta.carencia", "cavalo.carencia"]) {
      expect(porCodigo.get(code)?.costClass).toBeNull();
      expect(porCodigo.get(code)?.taxonomyName).toBe("Contrato e vigência");
    }
  });

  it("os três recortes reconstroem o todo, parâmetro a parâmetro", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const recorte = (classe: string) =>
      panorama.recortes.find((r) => r.classe === classe)!;

    const somaDe = (campo: keyof (typeof panorama)["totais"]) =>
      panorama.recortes.reduce((s, r) => s + r.totais[campo], 0);

    /*
      Medido em 18/08/2026, depois de a classe de custo sair da taxonomia.

      Os números mudaram de 13/10/4 e a mudança é a esperada: `lucro variável` e
      `remuneração de capital` deixaram as classes de custo e foram para
      Remuneração ao transportador, que é receita e sai como NAO_APLICAVEL. Elas
      nunca foram custo — estavam na classe de custo mais próxima por falta de um
      lado de receita na árvore.
    */
    expect(recorte("FIXO").totais.linhasEconomicas).toBe(11);
    expect(recorte("VARIAVEL").totais.linhasEconomicas).toBe(
      panorama.totais.linhasEconomicas -
        recorte("FIXO").totais.linhasEconomicas -
        recorte("SEM_CLASSE").totais.linhasEconomicas,
    );
    expect(somaDe("linhasEconomicas")).toBe(panorama.totais.linhasEconomicas);

    expect(somaDe("parametrosAlterados")).toBe(panorama.totais.parametrosAlterados);
    expect(somaDe("comImpacto")).toBe(panorama.totais.comImpacto);
    expect(somaDe("semImpacto")).toBe(panorama.totais.semImpacto);
    expect(somaDe("alteracoes")).toBe(panorama.totais.alteracoes);

    // E as listas, não só as contagens: nenhum código se perde entre os cortes,
    // e nenhum aparece em dois.
    const codigos = panorama.recortes.flatMap((r) => r.maisAlterados);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect([...codigos].sort()).toEqual([...panorama.maisAlterados].sort());
  });

  it("preserva a ordem do ranking dentro de cada recorte", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;

    /*
      A sublista tem de sair na mesma ordem da lista inteira. Reordenar dentro
      da classe não mudaria os números, mas mudaria a leitura: um parâmetro que
      é o quarto no panorama não pode virar o primeiro só porque três dos que
      vinham antes dele eram de outra classe — quem compara o mês com o anterior
      leria uma subida que não houve.
    */
    for (const recorte of panorama.recortes) {
      const posicao = recorte.maisAlterados.map((c) =>
        panorama.maisAlterados.indexOf(c),
      );
      expect(posicao).toEqual([...posicao].sort((a, b) => a - b));

      // A ordem por alterações continua valendo dentro do corte.
      const mudancas = recorte.maisAlterados.map((c) => de(panorama, c)!.changes);
      expect(mudancas).toEqual([...mudancas].sort((a, b) => b - a));
    }
  });

  it("o recorte carrega as mesmas exclusões de parcela e de conjunto", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const fixo = panorama.recortes.find((r) => r.classe === "FIXO")!;

    // `juros_finame_cavalo` é parcela de um total que também mudou: está fora
    // do ranking inteiro, e continua fora do recorte de fixo.
    expect(fixo.maisAlterados).not.toContain("cavalo.juros_finame_cavalo");

    // `carreta.custo_fixo` já contém o cavalo: fora dos rankings, e presente na
    // visão de conjunto — do lado do fixo, que é a classe dela.
    expect(fixo.maisAlterados).not.toContain("carreta.custo_fixo");
    expect(fixo.visaoDeConjunto).toContain("carreta.custo_fixo");

    /*
      E a coluna de conjunto do lucro variável saiu do recorte de variável: ela
      é receita, não custo, e desde que a árvore ganhou Remuneração ao
      transportador ela mora lá — sem classe de custo, como toda receita.
    */
    const variavel = panorama.recortes.find((r) => r.classe === "VARIAVEL")!;
    expect(variavel.visaoDeConjunto).toEqual([]);
    const semClasse = panorama.recortes.find((r) => r.classe === "SEM_CLASSE")!;
    expect(semClasse.visaoDeConjunto).toContain("carreta.lucro_variavel_previsto");
  });

  it("mostra que o dinheiro apurado hoje é todo do custo fixo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const fixo = panorama.recortes.find((r) => r.classe === "FIXO")!;
    const variavel = panorama.recortes.find((r) => r.classe === "VARIAVEL")!;

    /*
      O achado que o corte torna visível, e a razão de ele existir: a maior
      parte das alterações é de custo variável — combustível, manutenção — e
      **nenhuma** delas passa na régua do impacto, enquanto as quatro apuráveis
      são todas de custo fixo. Numa lista só, os dois fatos ficam misturados e a
      tela parece dizer que o mês foi caro em financiamento.

      Medido em 18/08/2026: 1.888, e não mais 2.155. A diferença é o lucro
      variável, que saiu do custo variável para Remuneração ao transportador —
      ele nunca foi custo, e o número novo é o que sempre deveria ter sido.
    */
    expect(variavel.totais.alteracoes).toBe(1888);
    expect(variavel.totais.comImpacto).toBe(0);
    expect(variavel.maiorImpacto).toEqual([]);
    expect(variavel.impactoPorPeriodicidade).toEqual([]);

    /*
      Três, e não mais quatro: `lucro fixo do novo ciclo` era a quarta e saiu do
      custo fixo junto com a remuneração de capital. Ela continua apurável e
      continua no panorama inteiro — mudou de recorte, não de existência, que é
      exatamente o que a soma dos três recortes acima prova.
    */
    expect(fixo.totais.comImpacto).toBe(3);
    expect(panorama.maiorImpacto).toEqual(
      expect.arrayContaining(fixo.maiorImpacto),
    );

    // As periodicidades vazias não sobram como grupos sem linha nenhuma.
    for (const grupo of fixo.impactoPorPeriodicidade) {
      expect(grupo.codes.length).toBeGreaterThan(0);
    }
  });
});

describe("as pontas são por equipamento", () => {
  it("reproduz os totais da coluna nas duas pontas do cavalo", async () => {
    const panorama = (await getPanoramaDeAlteracoes(ctx.db))!;
    const finame = de(panorama, "cavalo.finame_cavalo")!;

    // Os mesmos números que a matriz mostra e que o cliente confere no Excel.
    expect(finame.from!.sourceLabel).toBe("EMPURRADA_2_12_2025");
    expect(finame.from!.total).toBeCloseTo(887408.65, 2);
    expect(finame.to!.sourceLabel).toBe("EMPURRADA_1_8_2026");
    expect(finame.to!.total).toBeCloseTo(867860.23, 2);
    expect(finame.variacao!.total).toBeCloseTo(-19548.42, 2);
  });
});
