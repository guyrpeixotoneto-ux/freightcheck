import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { curationEventTable, semanticMeaningTable, taxonomyNodeTable } from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import {
  criarCategoria,
  criarSignificado,
  listarCategorias,
  listarSignificados,
  procurarSignificado,
  seedSignificados,
  type Escopo,
} from "../catalogo";
import { derivarSemantica, SIGNIFICADOS_PADRAO } from "../significado";
import { seedTaxonomy } from "../taxonomy";

/**
 * O cadastro canônico — o que a criação inline pode e o que ela recusa.
 *
 * O tema deste arquivo é a duplicata. Um cadastro que a operação alimenta na
 * própria tela de confirmação é um cadastro que enche depressa, e um catálogo
 * com `R$/litro` ao lado de `R$ por litro` e `combustivel` ao lado de
 * `Combustível` é pior do que um select fechado: ele parece organizado e
 * separa em dois grupos o que é uma coisa só, sem que nenhuma tela acuse.
 */

let ctx: TestDb;
const ATOR = "guy@operalog.com.br";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("catalogo");
  await seedTaxonomy(ctx.db, "test:bootstrap");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o catálogo inicial vem com a migration, e a autoridade o confere", () => {
  it("as quinze linhas estão lá antes de qualquer código rodar", async () => {
    // É o motivo de o catálogo estar na migration e não só numa função de
    // seed: "rodem o backfill" é a instrução que ninguém executa, e sem
    // catálogo a tela nova abre com a lista vazia.
    const catalogo = await listarSignificados(ctx.db);
    expect(catalogo.length).toBe(SIGNIFICADOS_PADRAO.length);
    for (const padrao of SIGNIFICADOS_PADRAO) {
      expect(catalogo.map((c) => c.code)).toContain(padrao.code);
    }
  });

  /**
   * O teste que impede a cópia de divergir.
   *
   * A migration grava sete campos derivados por linha; `derivarSemantica` é a
   * fonte deles. Se alguém editar um sem o outro, isto aponta qual linha e qual
   * campo — mesmo padrão do teste de equivalência da constraint da 0023.
   */
  it("cada linha gravada é exatamente o que a autoridade deriva", async () => {
    const catalogo = await listarSignificados(ctx.db);
    const divergencias: string[] = [];

    for (const linha of catalogo) {
      const esperado = derivarSemantica(linha);
      for (const campo of [
        "unit",
        "periodicity",
        "aggregation",
        "isMonetary",
        "currency",
        "valueKind",
        "denominator",
      ] as const) {
        if (linha[campo] !== esperado[campo]) {
          divergencias.push(
            `${linha.code}.${campo}: banco=${String(linha[campo])} autoridade=${String(esperado[campo])}`,
          );
        }
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("o catálogo inicial se declara como tal e tem autor de sistema", async () => {
    const catalogo = await listarSignificados(ctx.db);
    for (const linha of catalogo) {
      expect(linha.isSeed).toBe(true);
      expect(linha.createdBy).toBe("system:catalogo-inicial");
    }
  });

  it("semear de novo não escreve nada", async () => {
    const { criados } = await seedSignificados(ctx.db, "test:reseed");
    expect(criados).toBe(0);
  });
});

describe("escolher e pesquisar", () => {
  it("a lista abre pelos montantes, que é o que trava a fila", async () => {
    const catalogo = await listarSignificados(ctx.db);
    expect(catalogo[0].forma).toBe("MONTANTE");
  });

  it("pesquisar por parte do rótulo encontra o significado existente", async () => {
    const achados = await procurarSignificado(ctx.db, "R$ por litro");
    expect(achados[0]?.tipo).toBe("IGUAL");
    expect(achados[0]?.item.code).toBe("taxa_litro");
  });

  it("pesquisar sem acento encontra o que tem acento", async () => {
    const achados = await procurarSignificado(ctx.db, "quilometros por litro");
    expect(achados[0]?.item.label).toBe("Quilômetros por litro");
  });
});

describe("criar significado sem sair da tela", () => {
  it("cadastra, deriva e devolve pronto para ser selecionado", async () => {
    const r = await criarSignificado(ctx.db, { label: "R$ por hora", actor: ATOR });
    expect(r.desfecho).toBe("CRIADO");
    expect(r.item).toMatchObject({
      code: "taxa_hora",
      label: "R$ por hora",
      unit: "BRL_HORA",
      aggregation: "NONE",
      isMonetary: false,
      valueKind: "RATE",
      denominator: "HORA",
      isSeed: false,
      createdBy: ATOR,
    });

    // Já disponível para a confirmação seguinte, sem recarregar nada.
    const catalogo = await listarSignificados(ctx.db);
    expect(catalogo.map((c) => c.code)).toContain("taxa_hora");
  });

  it("registra autoria e data — e um evento de curadoria com a derivação", async () => {
    const [linha] = await ctx.db
      .select()
      .from(semanticMeaningTable)
      .where(eq(semanticMeaningTable.code, "taxa_hora"));
    expect(linha.createdBy).toBe(ATOR);
    expect(linha.createdAt).toBeInstanceOf(Date);

    const eventos = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetKind, "SEMANTIC_MEANING"),
          eq(curationEventTable.targetId, linha.id),
        ),
      );
    expect(eventos).toHaveLength(1);
    expect(eventos[0].actor).toBe(ATOR);
    expect(eventos[0].reason).toContain("RATE");
  });

  it("exige responsável identificado", async () => {
    await expect(
      criarSignificado(ctx.db, { label: "R$ por tonelada", actor: "  " }),
    ).rejects.toThrow(/responsável identificado/);
  });

  it("recusa o rótulo que a autoridade não traduz, ensinando o formato", async () => {
    // Cadastrar isto criaria uma opção sem derivação: a pessoa escolheria, o
    // botão habilitaria, e o atributo seria confirmado fora de qualquer soma.
    const r = await criarSignificado(ctx.db, { label: "por litro", actor: ATOR });
    expect(r.desfecho).toBe("NAO_ENTENDIDO");
    expect(r.item).toBeNull();
    expect(r.mensagem).toContain("R$ por litro");

    const [{ total }] = await ctx.db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(semanticMeaningTable)
      .where(eq(semanticMeaningTable.normalizedLabel, "por litro"));
    expect(total).toBe(0);
  });
});

describe("a duplicata, nas suas duas formas", () => {
  it("o mesmo texto devolve o que existe, sem criar um segundo", async () => {
    const antes = (await listarSignificados(ctx.db)).length;
    const r = await criarSignificado(ctx.db, { label: "r$ POR hora", actor: ATOR });
    expect(r.desfecho).toBe("JA_EXISTE");
    expect(r.item?.code).toBe("taxa_hora");
    expect((await listarSignificados(ctx.db)).length).toBe(antes);
  });

  /**
   * A duplicata que um índice sobre o texto não pegaria.
   *
   * `R$/litro` e `R$ por litro` são textos diferentes e a mesma economia. Sem
   * a chave canônica derivada de forma + base, o cadastro teria dois grupos
   * para uma coisa só — e a agregação, a comparação e a DRE separariam colunas
   * que deveriam somar juntas.
   */
  it("o mesmo significado escrito de outro jeito é recusado como equivalente", async () => {
    const r = await criarSignificado(ctx.db, { label: "R$/litro", actor: ATOR });
    expect(r.desfecho).toBe("JA_EXISTE");
    expect(r.item?.code).toBe("taxa_litro");
    expect(r.mensagem).toContain("mesma economia");
  });

  it("o plural não abre um segundo cadastro", async () => {
    const r = await criarSignificado(ctx.db, { label: "R$ por horas", actor: ATOR });
    expect(r.desfecho).toBe("JA_EXISTE");
    expect(r.item?.code).toBe("taxa_hora");
  });

  it("o banco recusa a duplicata mesmo se o código a deixasse passar", async () => {
    // A guarda escrita duas vezes, como no resto deste módulo: uma legível e
    // uma inescapável.
    await expect(
      ctx.pool.query(
        `INSERT INTO semantic_meaning
           (scope_type, scope_code, code, label, normalized_label, forma, base,
            unit, aggregation, is_monetary, value_kind, created_by)
         VALUES ('GLOBAL','*','taxa_litro','Outro rótulo','outro rotulo','TAXA','LITRO',
                 'BRL_LITRO','NONE',false,'RATE','x@y.com')`,
      ),
    ).rejects.toThrow(/semantic_meaning_code_uq/);
  });

  it("o banco recusa um significado incoerente — taxa somável não é gravável", async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO semantic_meaning
           (scope_type, scope_code, code, label, normalized_label, forma, base,
            unit, aggregation, is_monetary, value_kind, created_by)
         VALUES ('GLOBAL','*','taxa_absurda','R$ por absurdo','r$ por absurdo','TAXA','ABSURDO',
                 'BRL_ABSURDO','SUM',false,'RATE','x@y.com')`,
      ),
    ).rejects.toThrow(/semantic_meaning_semantica_coerente/);
  });
});

describe("escopo — o cadastro não precisará ser rechaveado", () => {
  const acme: Escopo = { scopeType: "EMPRESA", scopeCode: "acme" };
  const beta: Escopo = { scopeType: "EMPRESA", scopeCode: "beta" };

  it("dois escopos podem ter o mesmo rótulo, cada um com o seu", async () => {
    await criarSignificado(ctx.db, { label: "R$ por pallet", actor: ATOR, escopo: acme });
    const naBeta = await criarSignificado(ctx.db, {
      label: "R$ por pallet",
      actor: ATOR,
      escopo: beta,
    });
    // Não é duplicata: são cadastros de inquilinos diferentes.
    expect(naBeta.desfecho).toBe("CRIADO");
  });

  it("dentro de um escopo, continua sendo duplicata", async () => {
    const r = await criarSignificado(ctx.db, {
      label: "R$/pallet",
      actor: ATOR,
      escopo: acme,
    });
    expect(r.desfecho).toBe("JA_EXISTE");
    expect(r.item?.code).toBe("taxa_pallet");
  });

  it("a lista de um escopo não enxerga a do outro", async () => {
    const naAcme = await listarSignificados(ctx.db, acme);
    const global = await listarSignificados(ctx.db);
    expect(naAcme.map((s) => s.code)).toContain("taxa_pallet");
    expect(global.map((s) => s.code)).not.toContain("taxa_pallet");
    // E o global também não vazou para o escopo novo: `seedSignificados` é que
    // o povoa, e ninguém o chamou aqui.
    expect(naAcme.map((s) => s.code)).not.toContain("taxa_hora");
  });

  it("semear um escopo novo o povoa sem tocar no global", async () => {
    const { criados } = await seedSignificados(ctx.db, "test:scope", acme);
    expect(criados).toBe(SIGNIFICADOS_PADRAO.length);
    const global = await listarSignificados(ctx.db);
    expect(global.length).toBe(SIGNIFICADOS_PADRAO.length + 1); // + taxa_hora
  });
});

describe("categorias — hierarquia por dentro, linguagem de negócio por fora", () => {
  it("a lista fala em caminho de negócio, e não em nó de taxonomia", async () => {
    const categorias = await listarCategorias(ctx.db);
    const manutencao = categorias.find((c) => c.code === "cv_manutencao");
    expect(manutencao?.caminho).toBe("Custo Variável › Manutenção");
    expect(manutencao?.costClass).toBe("VARIAVEL");
  });

  it("as classes e a raiz não são escolhíveis — classificar em 'Custo Fixo' é não classificar", async () => {
    const codigos = (await listarCategorias(ctx.db)).map((c) => c.code);
    expect(codigos).not.toContain("remuneracao");
    expect(codigos).not.toContain("custo_fixo");
    expect(codigos).toContain("cv_pneus");
  });

  it("selecionar uma categoria existente é achá-la pela busca", async () => {
    const categorias = await listarCategorias(ctx.db);
    const r = await criarCategoria(ctx.db, { name: "Combustível", actor: ATOR });
    expect(r.desfecho).toBe("JA_EXISTE");
    expect(r.item?.code).toBe("cv_combustivel");
    expect((await listarCategorias(ctx.db)).length).toBe(categorias.length);
  });

  /** O caso literal do pedido. */
  it("'combustivel' encontra 'Combustível' em vez de criar outro", async () => {
    const r = await criarCategoria(ctx.db, { name: "combustivel", actor: ATOR });
    expect(r.desfecho).toBe("JA_EXISTE");
    expect(r.item?.name).toBe("Combustível");
  });

  it("cadastra a categoria nova, com autor, e já pronta para ser selecionada", async () => {
    const r = await criarCategoria(ctx.db, { name: "Pedágio", actor: ATOR });
    expect(r.desfecho).toBe("CRIADO");
    expect(r.item).toMatchObject({
      name: "Pedágio",
      code: "pedagio",
      // Sob "Não classificado": a classe de custo não se lê no nome, e um
      // palpite entre fixo e variável mudaria de lado quatro telas do produto.
      caminho: "Não classificado › Pedágio",
      costClass: null,
    });

    const [linha] = await ctx.db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, "pedagio"));
    expect(linha.createdBy).toBe(ATOR);
    expect(linha.path).toBe("remuneracao/nao_classificado/pedagio");
  });

  it("a árvore inicial continua sem autor, e isso é uma resposta", async () => {
    const [linha] = await ctx.db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, "cv_pneus"));
    expect(linha.createdBy).toBeNull();
  });

  it("registra o evento de curadoria com o motivo da classe em aberto", async () => {
    const [linha] = await ctx.db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, "pedagio"));
    const eventos = await ctx.db
      .select()
      .from(curationEventTable)
      .where(eq(curationEventTable.targetId, linha.id));
    expect(eventos[0].actor).toBe(ATOR);
    expect(eventos[0].reason).toContain("classe de custo");
  });

  it("criar de novo devolve a que existe, a menos de acento e caixa", async () => {
    const r = await criarCategoria(ctx.db, { name: "pedagio", actor: ATOR });
    expect(r.desfecho).toBe("JA_EXISTE");
    expect(r.item?.code).toBe("pedagio");
  });

  it("exige responsável identificado", async () => {
    await expect(
      criarCategoria(ctx.db, { name: "Lavagem", actor: "" }),
    ).rejects.toThrow(/responsável identificado/);
  });
});
