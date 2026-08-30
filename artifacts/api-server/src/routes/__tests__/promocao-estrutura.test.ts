import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { sql } from "drizzle-orm";
import {
  attributeTable,
  CONFIRMED_SEMANTICS,
  contarNosCanonicos,
  encerrarPoolDoProcesso,
  taxonomyNodeTable,
} from "@workspace/db";
import { listarVigenciasDaAuditoria } from "@workspace/comparison";
import {
  createTestDatabase,
  modelExportPaths,
  realExportPath,
  type TestDb,
} from "@workspace/ingest/testing";

/**
 * **A estrutura obrigatória, garantida pela rota que a tela chama.**
 *
 * Este arquivo prova o que nenhum teste provava: que arrastar uma planilha para
 * a tela de Importações e clicar em promover deixa a base **utilizável**, sem
 * `dev:seed`, sem CLI e sem curadoria externa.
 *
 * Ele sobe o router **inteiro**, na mesma ordem de montagem do produto
 * (`routes/index.ts`), e conversa por HTTP: `POST /imports` com o arquivo em
 * base64, espera o run chegar a PREVIEWED, e `POST /imports/:id/promote`. Não
 * é cerimônia — é o objeto do teste. O defeito que ele fecha era exatamente de
 * roteamento: existiam **dois** `POST /imports/:id/promote`, e o único que
 * semeava a taxonomia era o segundo, que o Express nunca alcançava. Um teste
 * que chamasse `promote()` direto da biblioteca teria passado o tempo todo.
 *
 * Medido em 17/08/2026, antes da correção, por este mesmo caminho: **zero nós**
 * de taxonomia depois da promoção, 138 de 138 atributos sem nó, e `cost_class`
 * nulo em 267 de 267 linhas de comparação.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

/** Os nós da árvore, contados dela mesma — nunca um número escrito à mão. */
const NOS_CANONICOS = contarNosCanonicos();

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-01";

interface Resposta {
  status: number;
  body: any;
}

async function post(caminho: string, corpo: unknown): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** O envio como a tela o faz: o arquivo em base64 dentro de um JSON. */
async function enviar(filePath: string): Promise<string> {
  const enviado = await post("/imports", {
    filename: path.basename(filePath),
    contentBase64: readFileSync(filePath).toString("base64"),
  });
  expect(enviado.status, JSON.stringify(enviado.body)).toBe(202);
  const importRunId = enviado.body.importRunId as string;

  // A leitura roda destacada, como em produção; a tela faz este mesmo poll.
  for (let tentativa = 0; tentativa < 600; tentativa++) {
    const estado = await get(`/imports/${importRunId}/status`);
    const status = estado.body.status as string;
    if (status === "PREVIEWED") return importRunId;
    if (status === "VALIDATION_ERROR" || status === "READ_ERROR") {
      throw new Error(`Leitura falhou: ${estado.body.failureReason}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("O run não chegou a PREVIEWED.");
}

async function promover(importRunId: string): Promise<Resposta> {
  const previa = await get(`/imports/${importRunId}`);
  return post(`/imports/${importRunId}/promote`, {
    confirmNewEntityTypes: previa.body.pendingIdentities ?? [],
    onExistingSnapshot: "FAIL",
  });
}

let primeira: Resposta;

beforeAll(async () => {
  ctx = await createTestDatabase("api_promocao_estrutura");
  process.env.DATABASE_URL = ctx.url;
  process.env.IMPORT_STORAGE_DIR = mkdtempSync(
    path.join(tmpdir(), "promocao-estrutura-"),
  );

  const { default: router } = await import("../index");
  const app = express();
  app.use(express.json({ limit: "64mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(router);
  /*
    O contrato JSON, montado como no `app.ts`. Não é cerimônia de teste: desde
    que a tradução das recusas e o diagnóstico de schema saíram dos `catch` das
    rotas, é ele quem responde 404, 400, 422, 503 e 500 — e um app de teste sem
    ele mede o `finalhandler` do Express, que devolve HTML.
  */
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  primeira = await promover(await enviar(realExportPath()));
  expect(primeira.status, JSON.stringify(primeira.body)).toBe(200);
}, 600_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

describe("a promoção garante a estrutura obrigatória — banco vazio, sem seed", () => {
  /**
   * Quem respondeu.
   *
   * A rota morta de `overview.ts` devolvia `proposal`, `confirmations` e
   * `versions`. A viva devolve `taxonomia` e `semanticasConfirmadas`. Conferir
   * a forma da resposta é a maneira de este teste continuar sabendo qual das
   * duas está no ar caso alguém registre uma segunda de novo.
   */
  it("responde pela rota viva, e ela faz o trabalho", () => {
    expect(primeira.body).toHaveProperty("taxonomia");
    expect(primeira.body).toHaveProperty("semanticasConfirmadas");
    expect(primeira.body).not.toHaveProperty("proposal");
    expect(primeira.body).not.toHaveProperty("versions");
  });

  it("1. semeia a árvore canônica inteira", async () => {
    /*
      A árvore já vem da fila de migrations desde a 0031, que a reorganizou e
      criou os nós que faltavam. A promoção continua sendo quem **garante** que
      ela existe — e num banco migrado a garantia encontra tudo no lugar, que é
      o desfecho certo, não uma promoção que não fez nada.
    */
    expect(primeira.body.taxonomia).toEqual({
      nosCriados: 0,
      nosExistentes: NOS_CANONICOS,
    });

    const nos = await ctx.db.select().from(taxonomyNodeTable);
    expect(nos).toHaveLength(NOS_CANONICOS);
    // Eram 22 quando as classes eram econômicas. A árvore semântica é maior:
    // ganhou remuneração, direcionador operacional e as naturezas que vinham
    // caindo em "Outros".
    expect(NOS_CANONICOS).toBe(46);
    // A árvore que a tela oferece no seletor "Nó da taxonomia" existe.
    const arvore = await get("/curation/taxonomy?flat=true");
    expect(arvore.body).toHaveLength(NOS_CANONICOS);
  });

  it("2. vincula todo atributo canônico ao seu nó", async () => {
    const { rows } = await ctx.db.execute<{ code: string; node: string }>(sql`
      SELECT a.code, n.code AS node
        FROM attribute a
        JOIN taxonomy_node n ON n.id = a.taxonomy_node_id
       ORDER BY a.code
    `);
    expect(rows).toHaveLength(CONFIRMED_SEMANTICS.length);
    expect(rows.map((r) => r.code).sort()).toEqual(
      CONFIRMED_SEMANTICS.map((e) => e.code).sort(),
    );
    // Cada um no nó que o registro declara, e não num nó qualquer.
    const esperado = new Map(
      CONFIRMED_SEMANTICS.map((e) => [e.code, e.taxonomyCode]),
    );
    for (const row of rows) expect(row.node, row.code).toBe(esperado.get(row.code));

    // E a versão em vigor carrega o mesmo nó — é ela que a comparação lê.
    const [{ semNo }] = (
      await ctx.db.execute<{ semNo: number }>(sql`
        SELECT count(*)::int AS "semNo"
          FROM attribute_semantics v
          JOIN attribute a ON a.id = v.attribute_id
         WHERE v.effective_until IS NULL
           AND a.semantics_status = 'CONFIRMED'
           AND v.taxonomy_node_id IS NULL
      `)
    ).rows;
    expect(semNo).toBe(0);
  });

  it("3. resolve a classe de custo nesses atributos", async () => {
    const { loadAttributeClassificationsAt } = await import("@workspace/comparison");
    const classificacoes = [
      ...(await loadAttributeClassificationsAt(ctx.db, AGOSTO)).values(),
    ];
    const confirmados = classificacoes.filter(
      (c) => c.semanticsStatus === "CONFIRMED",
    );
    expect(confirmados).toHaveLength(CONFIRMED_SEMANTICS.length);
    for (const c of confirmados) {
      expect(c.taxonomyName, c.attributeCode).not.toBeNull();
    }

    /*
      Classe de custo em todo mundo, **exceto** o que não é custo.

      São duas famílias, e não uma. `lucroFixomodeloNovoCiclo` é remuneração ao
      transportador — receita —, e `ano`, `ciclo`, `mesDeEntrada`,
      `operadorPromax`, `odometroEntrada` são cadastro. Nenhum dos dois é custo,
      e carimbar classe neles poria receita e ficha técnica dentro de um total
      de custo, que é o erro que a família própria existe para impedir. Ver
      `attribute.cost_class`: `NAO_APLICAVEL` é afirmação, nulo é lacuna, e
      nestas duas famílias o nulo é a resposta certa.

      A lista era só `remuneracao_transportador`, e o comentário acima dela já
      dizia "pela mesma razão que cadastro sai" — a família de cadastro nunca
      esteve na asserção porque nenhum atributo dela era confirmado ainda. As 41
      classificações de 29/08/2026 confirmaram treze, e a asserção passou a
      reprovar o caso que o próprio comentário descrevia como esperado.

      O que este laço continua recusando é o que importa: classe nula em
      `custo_fixo`, `custo_variavel` ou `capital` — ali o nulo é coluna que
      ninguém classificou, e ela some de um total sem avisar.
    */
    const SEM_CLASSE_DE_CUSTO = ["cadastro", "remuneracao_transportador"];
    const semClasse = confirmados
      .filter((c) => c.costClass === null)
      .map((c) => c.attributeCode)
      .sort();
    for (const code of semClasse) {
      expect(
        (await ctx.db.execute<{ familia: string }>(sql`
          SELECT split_part(n.path, '/', 2) AS familia
            FROM attribute a JOIN taxonomy_node n ON n.id = a.taxonomy_node_id
           WHERE a.code = ${code}
        `)).rows[0]?.familia,
        code,
      ).toBeOneOf(SEM_CLASSE_DE_CUSTO);
    }
    /*
      O que se prova aqui é que a promoção **garante** a classe, e não que a
      árvore a herda: desde a migration 0030 a classe é coluna do atributo, e
      nenhum nó a declara. `finameCavalo` está em `cf_financiamento`, que vive
      na família `capital` — e é dela que vem o padrão FIXO que a promoção
      gravou no atributo.
    */
    const finame = confirmados.find((c) => c.attributeCode === "cavalo.finame_cavalo")!;
    expect(finame.costClass).toBe("FIXO");
    expect(finame.taxonomyName).toBe("Financiamento e juros");
  });

  it("4. carimba a classe de custo nas comparações novas", async () => {
    const { computeChangeSet } = await import("@workspace/comparison");
    const { rows: snaps } = await ctx.db.execute<{ id: string }>(sql`
      SELECT id::text FROM snapshot
       WHERE status <> 'SUPERSEDED' AND effective_date IN (${JULHO}::date, ${AGOSTO}::date)
       ORDER BY effective_date
    `);
    expect(snaps).toHaveLength(2);

    const set = await computeChangeSet(ctx.db, snaps[0].id, snaps[1].id, {
      computedBy: "test:estrutura",
    });
    /*
      267 alterações entre julho e agosto/2026 — a forma do export, e por isso
      um número escrito à mão.

      Os outros dois **não são mais** números escritos à mão, e a razão é o dia
      em que este teste reprovou. Eram `17` e `19`, o retrato de quantas colunas
      canônicas existiam quando ele foi escrito; as 41 classificações de
      29/08/2026 levaram os mesmos números a 166 e 169 sem que nada tivesse
      quebrado, e o teste passou a reprovar toda entrega da `main` por cinco
      merges seguidos. Um número que sobe sempre que alguém cura uma coluna não
      prova nada sobre a promoção — só cobra que quem curou lembre de vir aqui.

      O que este caso existe para prender é o carimbo, e ele é uma equivalência:
      **a linha da comparação carrega classe e grupo exatamente quando o
      atributo dela os tem.** `cost_class` e `taxonomy_name` são gravados na
      linha no instante em que a comparação é calculada, e antes da correção de
      17/08/2026 saíam nulos em 267 de 267. A equivalência reprova aquele estado
      igual, reprova o inverso (carimbo em linha cujo atributo não tem o campo)
      e não envelhece com a curadoria.

      O `CASE` sobre `FIXO`/`VARIAVEL` não é conveniência de consulta: é a regra
      de `inheritedCostClassJoin`, e é ela que a comparação aplica. Um atributo
      `NAO_APLICAVEL` chega à linha como classe **nula**, de propósito —
      `NAO_APLICAVEL` afirma que aquilo não é custo, e repeti-lo na linha o
      ofereceria a quem filtra por classe. São três hoje (`cavalo.ciclo` e as
      duas colunas de `lucroFixomodeloNovoCiclo`), e comparar contra
      `a.cost_class` cru os acusaria de divergência quando o que eles mostram é
      a regra funcionando.
    */
    const [linhas] = (
      await ctx.db.execute<{
        total: number;
        classeDivergente: number;
        grupoDivergente: number;
        comClasse: number;
        comGrupo: number;
      }>(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (
                 WHERE c.cost_class IS DISTINCT FROM
                   CASE WHEN a.cost_class IN ('FIXO', 'VARIAVEL') THEN a.cost_class END
               )::int AS "classeDivergente",
               count(*) FILTER (
                 WHERE (c.taxonomy_name IS NOT NULL) <> (n.id IS NOT NULL)
               )::int AS "grupoDivergente",
               count(*) FILTER (WHERE c.cost_class IS NOT NULL)::int AS "comClasse",
               count(*) FILTER (WHERE c.taxonomy_name IS NOT NULL)::int AS "comGrupo"
          FROM "change" c
          JOIN attribute a ON a.code = c.attribute_code
          LEFT JOIN taxonomy_node n ON n.id = a.taxonomy_node_id
         WHERE c.change_set_id = ${set.id}::uuid
      `)
    ).rows;

    expect(linhas.total).toBe(267);
    expect(linhas.classeDivergente).toBe(0);
    expect(linhas.grupoDivergente).toBe(0);
    /*
      E o piso: o estado que a correção de 17/08/2026 desfez era zero nos dois.
      A equivalência acima é satisfeita por uma base sem curadoria nenhuma —
      nada carimbado, nada a carimbar —, e este par recusa esse verde vazio.
    */
    expect(linhas.comClasse).toBeGreaterThan(0);
    expect(linhas.comGrupo).toBeGreaterThan(0);
  });
});

describe("5. a segunda importação não duplica nada", () => {
  let segunda: Resposta;
  let antes: { nos: number; versoes: number; confirmados: number; eventos: number };

  const contar = async () => {
    const [linha] = (
      await ctx.db.execute<{
        nos: number;
        versoes: number;
        confirmados: number;
        eventos: number;
      }>(sql`
        SELECT (SELECT count(*) FROM taxonomy_node)::int AS nos,
               (SELECT count(*) FROM attribute_semantics)::int AS versoes,
               (SELECT count(*) FROM attribute WHERE semantics_status = 'CONFIRMED')::int
                 AS confirmados,
               (SELECT count(*) FROM curation_event)::int AS eventos
      `)
    ).rows;
    return linha;
  };

  beforeAll(async () => {
    antes = await contar();
    /*
      Outro arquivo, mesmo conteúdo: `Modelo_Cavalo` é a metade do export
      combinado, entregue em arquivo próprio. Bytes diferentes — então o
      recebimento não o recusa por duplicidade de arquivo — e dados que a base
      já tem, que é o caso real de reenvio.
    */
    segunda = await promover(await enviar(modelExportPaths().cavalo));
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(200);
  }, 600_000);

  it("não cria nó, versão nem confirmação de novo", async () => {
    expect(segunda.body.taxonomia).toEqual({
      nosCriados: 0,
      nosExistentes: NOS_CANONICOS,
    });
    expect(segunda.body.semanticasConfirmadas.aplicadas).toBe(0);
    expect(segunda.body.semanticasConfirmadas.jaConfirmadas).toBe(
      CONFIRMED_SEMANTICS.length,
    );
    expect(segunda.body.semanticasConfirmadas.divergentes).toEqual([]);
    expect(segunda.body.semanticasConfirmadas.incoerentes).toEqual([]);

    const depois = await contar();
    expect(depois.nos).toBe(antes.nos);
    expect(depois.confirmados).toBe(antes.confirmados);
    /*
      Versões e eventos são as duas medidas que uma reaplicação silenciosa
      inflaria: uma versão nova por atributo, ou um `curation_event` por campo
      "alterado" de um valor para ele mesmo. Nenhum dos dois se move.
    */
    expect(depois.versoes).toBe(antes.versoes);
    expect(depois.eventos).toBe(antes.eventos);
  });

  /**
   * A promoção entrega as vigências já comparadas — e **diz** que entregou.
   *
   * A tela de Alterações materializava um par por vez (o mais recente da
   * série), então a base ficava com vigências promovidas e nunca comparadas
   * até alguém abrir unidade por unidade. A rota agora garante a série inteira
   * de cada unidade que o arquivo tocou, e o corpo da resposta é o que
   * transforma "rodou depois do commit" em algo conferível: quantos pares
   * eram elegíveis, quantos já existiam, quantos nasceram agora e o que ficou
   * para trás.
   */
  it("deixa as comparações materializadas e relata o que fez", async () => {
    for (const resposta of [primeira, segunda]) {
      expect(resposta.body).toHaveProperty("comparacoes");
      expect(resposta.body.comparacoesFalha).toBeNull();
      expect(resposta.body.comparacoes.falhas).toEqual([]);
      // O denominador da Visão Gerencial fecha com as três parcelas.
      expect(resposta.body.comparacoes.paresElegiveis).toBe(
        resposta.body.comparacoes.jaExistiam +
          resposta.body.comparacoes.calculados +
          resposta.body.comparacoes.falhas.length,
      );
    }

    // A primeira promoção é a que traz vigência nova, e ela sai comparada.
    expect(primeira.body.comparacoes.unidades.length).toBeGreaterThan(0);
    expect(primeira.body.comparacoes.calculados).toBeGreaterThan(0);

    /*
      A segunda é o reenvio do mesmo dado em outro arquivo: nada entrou, e por
      isso não há contexto a garantir nem par a recalcular. Zero aqui é a
      idempotência funcionando — e não a garantia deixando de rodar, o que a
      conta do `paresElegiveis` acima e a leitura da home abaixo separam.
    */
    expect(segunda.body.comparacoes.calculados).toBe(0);

    /*
      E o que a home lê depois disso: nenhuma vigência com anterior ficou sem
      comparação. É a conta que aparecia como "4% · 1 de 25" enquanto o
      trabalho dependia de alguém abrir cada unidade.
    */
    const vigencias = await listarVigenciasDaAuditoria(ctx.db);
    const comAnterior = vigencias.filter((v) => v.anterior !== null);
    expect(comAnterior.length).toBeGreaterThan(0);
    expect(comAnterior.filter((v) => v.comparacao?.status !== "DONE")).toEqual([]);
  });

  it("mantém a assinatura humana de quem decidiu", async () => {
    const confirmados = await ctx.db
      .select()
      .from(attributeTable)
      .where(sql`${attributeTable.semanticsStatus} = 'CONFIRMED'`);
    for (const attribute of confirmados) {
      expect(attribute.confirmedBy, attribute.code).toMatch(/@/);
      expect(attribute.confirmedBy, attribute.code).not.toMatch(/^import:/);
    }
  });
});
