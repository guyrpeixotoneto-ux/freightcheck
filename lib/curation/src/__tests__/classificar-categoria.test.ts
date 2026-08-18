import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { curationEventTable, taxonomyNodeTable } from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import {
  criarCategoria,
  definirClasseDeCusto,
  listarCategorias,
  moverCategoriaParaFamilia,
} from "../catalogo";
import { runProposalPass } from "../engine";
import { seedTaxonomy } from "../taxonomy";

/**
 * Mover uma categoria de família, e dizer como um atributo se comporta.
 *
 * São dois atos, e este arquivo guarda a separação entre eles — que é a coisa
 * que mais custou para chegar ao lugar certo.
 *
 * **Mover** responde *o que a categoria é*, e continua sendo um `UPDATE` de
 * caminho em vez de um carimbo: `path` é ancestralidade materializada, e é a
 * árvore que explica por que Escolta armada mora ao lado de Combustível. Por isso
 * quase todo caso abaixo confere o caminho, e não um campo.
 *
 * **Definir a classe de custo** responde *como o valor se comporta*, e é do
 * atributo. Era da categoria, decidido movendo-a entre `custo_fixo` e
 * `custo_variavel` — e não podia continuar sendo: `Pessoal e encargos` é fixo
 * quando descreve o cavalo e variável quando descreve o trecho, e com a classe
 * na árvore a mesma natureza precisava de dois nós.
 */

let ctx: TestDb;
const ATOR = "guy@operalog.com.br";
const POR_QUE =
  "Escolta armada é contratada por viagem no trecho de agosto — anda com a operação.";

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

describe("a categoria nova nasce fora de família, que é o estado que esta tela existe para resolver", () => {
  it("criada na tela de confirmação, entra sob Não classificado", async () => {
    const r = await criarCategoria(ctx.db, { name: "Escolta armada", actor: ATOR });
    expect(r.desfecho).toBe("CRIADO");
    expect(r.item).toMatchObject({ caminho: "Não classificado › Escolta armada" });
  });

  it("a lista diz quantas colunas dependem de cada categoria", async () => {
    // A materialidade da decisão: uma categoria com dezoito colunas dentro
    // decide de que lado da conta caem dezoito colunas.
    const categorias = await listarCategorias(ctx.db);
    const combustivel = categorias.find((c) => c.code === "cv_combustivel")!;
    expect(combustivel.atributos).toBeGreaterThan(0);
    expect(categorias.find((c) => c.code === "escolta_armada")!.atributos).toBe(0);
  });
});

describe("mover leva a categoria para outra família", () => {
  it("põe a categoria dentro da família, e o caminho passa a ser a explicação", async () => {
    const r = await moverCategoriaParaFamilia(ctx.db, {
      code: "escolta_armada",
      familia: "operacao",
      actor: ATOR,
      reason: POR_QUE,
    });

    expect(r.desfecho).toBe("MOVIDA");
    expect(r.caminhoAnterior).toBe("Não classificado › Escolta armada");
    expect(r.categoria).toMatchObject({ caminho: "Consumo e operação › Escolta armada" });

    const no = await acharNo("escolta_armada");
    expect(no.path).toBe("natureza/operacao/escolta_armada");
    expect(no.depth).toBe(2);
  });

  it("a árvore não carrega mais classe de custo nenhuma", async () => {
    /*
      O ponto do desenho novo: mover diz o que a categoria é, e mais nada.

      A coluna `taxonomy_node.cost_class` ainda existe, e está morta — a 0030 a
      zerou e ninguém a lê. Ela não foi derrubada por uma razão operacional: o
      `DROP` faria a proposta do Publishing removê-la de Production antes de
      Production ter rodado a fila. O que este teste guarda é que nenhum nó
      volta a declarar classe, que é a parte que importa.
    */
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM taxonomy_node WHERE cost_class IS NOT NULL
    `);
    expect(rows[0].n).toBe(0);
  });

  it("registra autor, justificativa e o caminho de antes e de depois", async () => {
    const no = await acharNo("escolta_armada");
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
      valueBefore: "natureza/nao_classificado/escolta_armada",
      valueAfter: "natureza/operacao/escolta_armada",
    });
  });

  it("mover de novo para a mesma família não move nada e não escreve evento", async () => {
    const antes = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);

    const r = await moverCategoriaParaFamilia(ctx.db, {
      code: "escolta_armada",
      familia: "operacao",
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

  it("mover de novo é permitido, e é uma correção com autor e razão", async () => {
    const r = await moverCategoriaParaFamilia(ctx.db, {
      code: "escolta_armada",
      familia: "frota",
      actor: ATOR,
      reason: "Correção: o contrato de setembro paga pedágio por mês, fixo.",
    });
    expect(r.categoria.caminho).toBe("Frota e equipamento › Escolta armada");

    // E de volta, para os casos abaixo continuarem lendo o mesmo estado.
    await moverCategoriaParaFamilia(ctx.db, {
      code: "escolta_armada",
      familia: "operacao",
      actor: ATOR,
      reason: POR_QUE,
    });
  });

  it("cadastro também é destino, e não vira custo por isso", async () => {
    await criarCategoria(ctx.db, { name: "Número do contrato", actor: ATOR });
    const r = await moverCategoriaParaFamilia(ctx.db, {
      code: "numero_do_contrato",
      familia: "cadastro",
      actor: ATOR,
      reason: "É identificação do contrato; não remunera nada.",
    });
    expect(r.categoria.caminho).toBe("Cadastro e identificação › Número do contrato");
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

    const r = await moverCategoriaParaFamilia(ctx.db, {
      code: "lavagem",
      familia: "operacao",
      actor: ATOR,
      reason: "Lavagem acontece por viagem realizada.",
    });
    expect(r.nosMovidos).toBe(2);

    const filho = await acharNo("lavagem_externa");
    expect(filho.path).toBe("natureza/operacao/lavagem/lavagem_externa");
    expect(filho.depth).toBe(3);

  });
});

describe("o que mover recusa", () => {
  it("exige justificativa — isto decide de que lado da conta o dinheiro cai", async () => {
    await expect(
      moverCategoriaParaFamilia(ctx.db, {
        code: "escolta_armada",
        familia: "frota",
        actor: ATOR,
        reason: "   ",
      }),
    ).rejects.toThrow(/justificativa/);
  });

  it("exige responsável identificado", async () => {
    await expect(
      moverCategoriaParaFamilia(ctx.db, {
        code: "escolta_armada",
        familia: "frota",
        actor: "",
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/responsável identificado/);
  });

  it("recusa mover uma família para dentro de outra", async () => {
    // "Custo Fixo" não se classifica: ele **é** a classificação.
    await expect(
      moverCategoriaParaFamilia(ctx.db, {
        code: "operacao",
        familia: "operacao",
        actor: ATOR,
        reason: "Tentando inverter a árvore.",
      }),
    ).rejects.toThrow(/é uma das famílias da árvore/);
  });

  it("recusa uma família que não existe", async () => {
    await expect(
      moverCategoriaParaFamilia(ctx.db, {
        code: "escolta_armada",
        familia: "TALVEZ",
        actor: ATOR,
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/não existe/);
  });

  it("recusa uma categoria que não existe", async () => {
    await expect(
      moverCategoriaParaFamilia(ctx.db, {
        code: "nao_existe",
        familia: "frota",
        actor: ATOR,
        reason: POR_QUE,
      }),
    ).rejects.toThrow(/não encontrada/);
  });

  it("nada foi gravado por nenhuma das recusas", async () => {
    expect((await acharCategoria("escolta_armada"))!.caminho).toBe("Consumo e operação › Escolta armada");
    expect((await acharNo("operacao")).path).toBe("natureza/operacao");
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

describe("a classe de custo é do atributo, e não da natureza", () => {
  const CAVALO = "cavalo.ipva_licenciamento";

  it("chega da promoção com o padrão da família já preenchido", async () => {
    // `cavalo.ipva_licenciamento` nasce CONFIRMED e mora em Proteção, cuja
    // família sugere FIXO. Sem a garantia da promoção ele ficaria nulo para
    // sempre, porque a passada de propostas não olha confirmados.
    const { rows } = await ctx.db.execute<{ c: string | null }>(
      sql`SELECT cost_class AS c FROM attribute WHERE code = ${CAVALO}`,
    );
    expect(rows[0].c).toBe("FIXO");
  });

  it("a curadoria sobrepõe o padrão, na projeção e na versão em vigor", async () => {
    const r = await definirClasseDeCusto(ctx.db, {
      code: CAVALO,
      classe: "VARIAVEL",
      actor: ATOR,
      reason: "Neste contrato o licenciamento é rateado por viagem.",
    });
    expect(r).toMatchObject({ desfecho: "GRAVADA", de: "FIXO", para: "VARIAVEL" });

    const { rows } = await ctx.db.execute<{ a: string | null; v: string | null }>(sql`
      SELECT a.cost_class AS a, v.cost_class AS v
        FROM attribute a
        JOIN attribute_semantics v
          ON v.attribute_id = a.id AND v.effective_until IS NULL
       WHERE a.code = ${CAVALO}
    `);
    expect(rows[0]).toEqual({ a: "VARIAVEL", v: "VARIAVEL" });
  });

  it("não toca no status — dizer o comportamento não é confirmar a aritmética", async () => {
    const { rows: antes } = await ctx.db.execute<{ s: string }>(
      sql`SELECT semantics_status AS s FROM attribute WHERE code = ${CAVALO}`,
    );
    await definirClasseDeCusto(ctx.db, {
      code: CAVALO,
      classe: "FIXO",
      actor: ATOR,
      reason: "Correção: o contrato de setembro volta a cobrar por mês.",
    });
    const { rows: depois } = await ctx.db.execute<{ s: string }>(
      sql`SELECT semantics_status AS s FROM attribute WHERE code = ${CAVALO}`,
    );
    expect(depois[0].s).toBe(antes[0].s);
  });

  /*
    A razão de tudo isto: a mesma natureza, dois contextos, duas classes — e um
    nó só. Com a classe na árvore, este teste exigiria `Custo Fixo › Pessoal` e
    `Custo Variável › Pessoal`, e "o que é isto?" passaria a ter duas respostas.
  */
  it("dois atributos na mesma categoria podem ter classes diferentes", async () => {
    const { rows: irmaos } = await ctx.db.execute<{ code: string }>(sql`
      SELECT code FROM attribute
       WHERE taxonomy_node_id = (
             SELECT taxonomy_node_id FROM attribute WHERE code = ${CAVALO})
         AND code <> ${CAVALO}
       LIMIT 1
    `);
    if (irmaos.length === 0) return;

    // O irmão discorda: mesma categoria, mesma natureza, classe diferente.
    await definirClasseDeCusto(ctx.db, {
      code: irmaos[0].code,
      classe: "VARIAVEL",
      actor: ATOR,
      reason: "Neste equipamento o valor anda com a quilometragem.",
    });

    const { rows } = await ctx.db.execute<{ code: string; cost_class: string }>(sql`
      SELECT code, cost_class FROM attribute
       WHERE code IN (${CAVALO}, ${irmaos[0].code})
    `);
    const classes = new Set(rows.map((r) => r.cost_class));
    expect(classes.size).toBe(2);
    expect(new Set(rows.map((r) => r.code)).size).toBe(2);
  });

  it("já estava é resposta, e não uma segunda gravação", async () => {
    const r = await definirClasseDeCusto(ctx.db, {
      code: CAVALO,
      classe: "FIXO",
      actor: ATOR,
      reason: "Sem mudança.",
    });
    expect(r.desfecho).toBe("JA_ESTAVA");
  });

  it("exige responsável — isto decide de que lado a conta cai", async () => {
    await expect(
      definirClasseDeCusto(ctx.db, {
        code: CAVALO,
        classe: "FIXO",
        actor: "",
        reason: "Qualquer.",
      }),
    ).rejects.toThrow(/responsável/);
  });

  /*
    A justificativa em prosa deixou de ser exigida junto com o campo que a
    pedia na curadoria — a classe é gravada pela mesma tela que confirma a
    interpretação. O que o evento tem de guardar continua sendo o que mudou,
    de quê para quê e por quem: é isso que um revisor lê.
  */
  it("grava sem justificativa, e o evento ainda diz o que mudou e por quem", async () => {
    const r = await definirClasseDeCusto(ctx.db, {
      code: CAVALO,
      classe: "VARIAVEL",
      actor: ATOR,
    });
    expect(r.desfecho).toBe("GRAVADA");

    const [evento] = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetLabel, CAVALO),
          eq(curationEventTable.field, "cost_class"),
        ),
      )
      .orderBy(desc(curationEventTable.createdAt))
      .limit(1);
    expect(evento.valueAfter).toBe("VARIAVEL");
    expect(evento.actor).toBe(ATOR);
    expect(evento.reason).toBeNull();
  });
});
