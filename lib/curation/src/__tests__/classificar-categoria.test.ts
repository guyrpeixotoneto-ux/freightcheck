import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { curationEventTable, taxonomyNodeTable } from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import {
  classificarCategoria,
  criarCategoria,
  listarCategorias,
} from "../catalogo";
import { runProposalPass } from "../engine";
import { seedTaxonomy } from "../taxonomy";

/**
 * Classificar uma categoria em custo fixo, variável ou "não é custo".
 *
 * O que se guarda aqui é a decisão de **mover** em vez de carimbar. A coluna
 * `cost_class` existe e seria mais curto escrevê-la no próprio nó; o modelo diz
 * outra coisa — a classe é declarada nas classes e herdada por tudo abaixo —, e
 * é a árvore que responde "por que isto é variável?". Um nó pendurado em "Não
 * classificado" com FIXO escrito dentro responderia "porque alguém escreveu
 * FIXO", que é a mesma informação sem explicação nenhuma em volta.
 *
 * Por isso quase todo caso abaixo confere **o caminho**, e não o campo.
 */

let ctx: TestDb;
const ATOR = "guy@operalog.com.br";
const POR_QUE =
  "Pedágio é repassado por viagem no contrato de agosto — anda com a quilometragem.";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("classificar_categoria");
  await seedTaxonomy(ctx.db, "test:bootstrap");
  await runProposalPass(ctx.db, "test:proposal");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

const acharNo = async (code: string) => {
  const [linha] = await ctx.db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, code));
  return linha;
};

const acharCategoria = async (code: string) =>
  (await listarCategorias(ctx.db)).find((c) => c.code === code);

describe("a categoria nova nasce sem classe, que é o estado que esta tela existe para resolver", () => {
  it("criada na tela de confirmação, entra sob Não classificado e sem classe", async () => {
    const r = await criarCategoria(ctx.db, { name: "Pedágio", actor: ATOR });
    expect(r.desfecho).toBe("CRIADO");
    expect(r.item).toMatchObject({
      caminho: "Não classificado › Pedágio",
      costClass: null,
    });
  });

  it("a lista diz quantas colunas dependem de cada classificação", async () => {
    // A materialidade da decisão: uma categoria com dezoito colunas dentro
    // decide de que lado da conta caem dezoito colunas.
    const categorias = await listarCategorias(ctx.db);
    const combustivel = categorias.find((c) => c.code === "cv_combustivel")!;
    expect(combustivel.atributos).toBeGreaterThan(0);
    expect(categorias.find((c) => c.code === "pedagio")!.atributos).toBe(0);
  });
});

describe("classificar move a categoria na árvore", () => {
  it("põe a categoria dentro da classe, e o caminho passa a ser a explicação", async () => {
    const r = await classificarCategoria(ctx.db, {
      code: "pedagio",
      classe: "VARIAVEL",
      actor: ATOR,
      reason: POR_QUE,
    });

    expect(r.desfecho).toBe("MOVIDA");
    expect(r.caminhoAnterior).toBe("Não classificado › Pedágio");
    expect(r.categoria).toMatchObject({
      caminho: "Custo Variável › Pedágio",
      costClass: "VARIAVEL",
    });

    const no = await acharNo("pedagio");
    expect(no.path).toBe("remuneracao/custo_variavel/pedagio");
    expect(no.depth).toBe(2);
  });

  it("a classe vem da herança, e não de um carimbo no próprio nó", async () => {
    // O ponto do desenho: `cost_class` continua nula no nó, e a resposta vem do
    // ancestral mais próximo que a declara — que é como todo o resto da árvore
    // funciona desde o primeiro dia.
    const no = await acharNo("pedagio");
    expect(no.costClass).toBeNull();
    expect((await acharCategoria("pedagio"))!.costClass).toBe("VARIAVEL");
  });

  it("a mesma resposta chega pela consulta que o produto usa de verdade", async () => {
    // `INHERITED_COST_CLASS_JOIN`, escrita aqui como a comparação a executa: o
    // ancestral de caminho mais longo que declara classe.
    const { rows } = await ctx.db.execute<{ cost_class: string | null }>(sql`
      SELECT inherited.cost_class
        FROM taxonomy_node node
        LEFT JOIN LATERAL (
          SELECT ancestor.cost_class
            FROM taxonomy_node ancestor
           WHERE ancestor.cost_class IS NOT NULL
             AND (node.path = ancestor.path OR node.path LIKE ancestor.path || '/%')
           ORDER BY length(ancestor.path) DESC
           LIMIT 1
        ) AS inherited ON true
       WHERE node.code = 'pedagio'
    `);
    expect(rows[0].cost_class).toBe("VARIAVEL");
  });

  it("registra autor, justificativa e o caminho de antes e de depois", async () => {
    const no = await acharNo("pedagio");
    const eventos = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetId, no.id),
          eq(curationEventTable.field, "parent_id"),
        ),
      );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      actor: ATOR,
      reason: POR_QUE,
      valueBefore: "remuneracao/nao_classificado/pedagio",
      valueAfter: "remuneracao/custo_variavel/pedagio",
    });
  });

  it("classificar de novo na mesma classe não move nada e não escreve evento", async () => {
    const antes = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);

    const r = await classificarCategoria(ctx.db, {
      code: "pedagio",
      classe: "VARIAVEL",
      actor: ATOR,
      reason: POR_QUE,
    });
    expect(r.desfecho).toBe("JA_ESTAVA");
    expect(r.nosMovidos).toBe(0);

    const depois = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);
    expect(depois[0].n).toBe(antes[0].n);
  });

  it("reclassificar é permitido, e é uma correção com autor e razão", async () => {
    const r = await classificarCategoria(ctx.db, {
      code: "pedagio",
      classe: "FIXO",
      actor: ATOR,
      reason: "Correção: o contrato de setembro paga pedágio por mês, fixo.",
    });
    expect(r.categoria.caminho).toBe("Custo Fixo › Pedágio");
    expect(r.categoria.costClass).toBe("FIXO");

    // E de volta, para os casos abaixo continuarem lendo o mesmo estado.
    await classificarCategoria(ctx.db, {
      code: "pedagio",
      classe: "VARIAVEL",
      actor: ATOR,
      reason: POR_QUE,
    });
  });

  it("'não é custo' também é uma resposta, e ela não inventa classe", async () => {
    await criarCategoria(ctx.db, { name: "Número do contrato", actor: ATOR });
    const r = await classificarCategoria(ctx.db, {
      code: "numero_do_contrato",
      classe: "NAO_E_CUSTO",
      actor: ATOR,
      reason: "É identificação do contrato; não remunera nada.",
    });
    expect(r.categoria.caminho).toBe("Cadastral (não remuneratório) › Número do contrato");
    // `cadastral` não declara classe de propósito: cadastro não é custo, e
    // chamá-lo de FIXO o poria num total.
    expect(r.categoria.costClass).toBeNull();
  });
});

describe("a subárvore inteira anda junto", () => {
  it("um filho não fica para trás com o caminho antigo", async () => {
    // `path` é ancestralidade materializada: um filho com o caminho velho se
    // desliga do pai e some de toda consulta por prefixo — inclusive da que
    // resolve classe de custo.
    const pai = await acharNo("nao_classificado");
    await criarCategoria(ctx.db, { name: "Lavagem", actor: ATOR });
    const lavagem = await acharNo("lavagem");
    await ctx.db.insert(taxonomyNodeTable).values({
      parentId: lavagem.id,
      code: "lavagem_externa",
      name: "Lavagem externa",
      kind: "SUBGROUP",
      path: `${lavagem.path}/lavagem_externa`,
      depth: lavagem.depth + 1,
      sortOrder: 0,
      createdBy: ATOR,
    });
    expect(pai).toBeDefined();

    const r = await classificarCategoria(ctx.db, {
      code: "lavagem",
      classe: "VARIAVEL",
      actor: ATOR,
      reason: "Lavagem acontece por viagem realizada.",
    });
    expect(r.nosMovidos).toBe(2);

    const filho = await acharNo("lavagem_externa");
    expect(filho.path).toBe("remuneracao/custo_variavel/lavagem/lavagem_externa");
    expect(filho.depth).toBe(3);
    expect((await acharCategoria("lavagem_externa"))!.costClass).toBe("VARIAVEL");
  });
});

describe("o que a classificação recusa", () => {
  it("exige justificativa — isto decide de que lado da conta o dinheiro cai", async () => {
    await expect(
      classificarCategoria(ctx.db, {
        code: "pedagio",
        classe: "FIXO",
        actor: ATOR,
        reason: "   ",
      }),
    ).rejects.toThrow(/justificativa/);
  });

  it("exige responsável identificado", async () => {
    await expect(
      classificarCategoria(ctx.db, {
        code: "pedagio",
        classe: "FIXO",
        actor: "",
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/responsável identificado/);
  });

  it("recusa mover uma classe para dentro de outra", async () => {
    // "Custo Fixo" não se classifica: ele **é** a classificação.
    await expect(
      classificarCategoria(ctx.db, {
        code: "custo_fixo",
        classe: "VARIAVEL",
        actor: ATOR,
        reason: "Tentando inverter a árvore.",
      }),
    ).rejects.toThrow(/é uma das classes da árvore/);
  });

  it("recusa uma classe que não existe", async () => {
    await expect(
      classificarCategoria(ctx.db, {
        code: "pedagio",
        // @ts-expect-error — é justamente o pedido malformado que se testa.
        classe: "TALVEZ",
        actor: ATOR,
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/não existe/);
  });

  it("recusa uma categoria que não existe", async () => {
    await expect(
      classificarCategoria(ctx.db, {
        code: "nao_existe",
        classe: "FIXO",
        actor: ATOR,
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/não encontrada/);
  });

  it("nada foi gravado por nenhuma das recusas", async () => {
    expect((await acharCategoria("pedagio"))!.caminho).toBe("Custo Variável › Pedágio");
    expect((await acharNo("custo_fixo")).path).toBe("remuneracao/custo_fixo");
  });
});

describe("a árvore continua íntegra depois de tudo", () => {
  it("todo caminho continua sendo o do pai mais o próprio código", async () => {
    // A invariante que um UPDATE de prefixo mal escrito quebraria em silêncio.
    const { rows } = await ctx.db.execute<{ code: string; path: string; esperado: string }>(sql`
      SELECT filho.code, filho.path, pai.path || '/' || filho.code AS esperado
        FROM taxonomy_node filho
        JOIN taxonomy_node pai ON pai.id = filho.parent_id
       WHERE filho.path <> pai.path || '/' || filho.code
    `);
    expect(rows).toEqual([]);
  });

  it("a profundidade continua sendo a distância até a raiz", async () => {
    const { rows } = await ctx.db.execute<{ code: string }>(sql`
      SELECT filho.code
        FROM taxonomy_node filho
        JOIN taxonomy_node pai ON pai.id = filho.parent_id
       WHERE filho.depth <> pai.depth + 1
    `);
    expect(rows).toEqual([]);
  });

  it("nenhum caminho ficou duplicado", async () => {
    const { rows } = await ctx.db.execute<{ path: string }>(sql`
      SELECT path FROM taxonomy_node GROUP BY path HAVING count(*) > 1
    `);
    expect(rows).toEqual([]);
  });
});
