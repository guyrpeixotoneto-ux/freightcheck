import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import {
  gravarPresenca,
  preencherPresencasPendentes,
  setImportRunHidden,
} from "@workspace/ingest";
import {
  criarBancoComExportRealPromovido,
  type TestDb,
} from "@workspace/ingest/testing";
import { contagensPorVigencia } from "../tipos-da-vigencia";
import { resolveContext } from "../series";

/**
 * A presença da vigência — o que a contagem por tipo passou a ler em vez de
 * reconstruir a cada tela.
 *
 * ---------------------------------------------------------------------------
 * O que estes testes prendem
 * ---------------------------------------------------------------------------
 * Não a tabela: a **semântica que ela não pode mudar**. A contagem já existia e
 * já estava certa; a `0081` mudou apenas de onde o número sai. Por isso quase
 * todo teste aqui é uma igualdade entre os dois caminhos — o antigo, sobre os
 * fatos, e o novo, sobre a presença — nas condições em que eles poderiam
 * divergir. Apagar `snapshot_presenca` devolve o banco ao comportamento
 * anterior à mudança, e é assim que o "antes" é obtido sem manter duas
 * implementações.
 *
 * A condição que mais importa é a ocultação, e ela é a razão de a tabela ter o
 * grão que tem: `fato_visivel` esconde o fato pela **origem** dele, não pela
 * importação do snapshot. Guardar a contagem pronta por vigência — o desenho do
 * censo do balanço, da `0080` — daria número errado exatamente aí, e há um
 * teste abaixo que monta esse caso.
 *
 * A base é o export real promovido pelo pipeline de verdade, e não uma fixture
 * montada à mão: é o `promote` que grava a presença, e um teste que a inserisse
 * por fora provaria a tabela sem provar o gancho.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("comparison_presenca");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

/**
 * O contexto da unidade real, resolvido **uma vez**.
 *
 * A tela resolve o contexto e depois lê; re-resolver a cada leitura mudaria o
 * recorte no meio do teste — e com a importação mais recente oculta
 * `resolveContext` devolve `null`, que é comportamento correto do produto e
 * ruído aqui. Guardar o contexto é o que mantém a comparação apples-to-apples.
 */
let contextoFixo: Awaited<ReturnType<typeof resolveContext>>;
async function contexto() {
  if (!contextoFixo) {
    contextoFixo = await resolveContext(ctx.db);
    if (!contextoFixo) throw new Error("nenhum contexto — a fixture não importou nada");
  }
  return contextoFixo;
}

/** As contagens como a tela as vê: `data → tipo → entidades`, achatadas. */
async function lidas() {
  const mapa = await contagensPorVigencia(ctx.db, await contexto());
  const saida: Record<string, Record<string, number>> = {};
  for (const [data, porTipo] of mapa) {
    saida[data] = Object.fromEntries([...porTipo].sort());
  }
  return saida;
}

/** Apaga a presença — devolve a leitura ao caminho anterior à `0081`. */
async function semPresenca() {
  await ctx.db.execute(sql`DELETE FROM snapshot_presenca`);
}

/** Repõe a presença de tudo, como o backfill da partida faz. */
async function comPresenca() {
  await preencherPresencasPendentes(ctx.db);
}

/**
 * Monta uma vigência sintética, no escopo real, com fatos de **duas origens**.
 *
 * Um snapshot fechado não pode ser reaberto — `snapshot_is_immutable` só admite
 * CLOSED → SUPERSEDED —, e é justamente essa rigidez que sustenta a mudança.
 * Então o cenário é montado como a promoção o monta: um snapshot novo nasce em
 * DRAFT, recebe os fatos, e só então fecha.
 *
 * Os fatos são copiados de duas vigências reais preservando o
 * `origin_import_run_id` de cada uma — que é exatamente o que a promoção faz
 * com o componente que o arquivo novo não tocou. O resultado é uma vigência
 * visível cujo conteúdo depende da visibilidade de **outras** importações: o
 * caso que uma contagem gravada por vigência erraria.
 */
/**
 * Uma importação descartável, para servir de **segunda origem**.
 *
 * O export real inteiro — as nove vigências — entrou numa importação só, então
 * não há duas origens no acervo para montar o cenário que interessa. Esta aqui
 * existe só para ser a outra ponta: nada é importado por ela, ela apenas
 * carimba fatos que a vigência sintética recebe.
 */
async function runDescartavel(marca: string): Promise<string> {
  const { rows: arquivo } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO source_file (filename, content_sha256, byte_size, storage_path)
    VALUES (${`${marca}.xlsx`}, ${marca.padEnd(64, "0").slice(0, 64)}, 1, ${`/tmp/${marca}`})
    RETURNING id
  `);
  const { rows: run } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO import_run (source_file_id) VALUES (${arquivo[0]!.id}::uuid) RETURNING id
  `);
  return run[0]!.id;
}

async function vigenciaComDuasOrigens(
  data: string,
  base: { id: string },
  outraOrigem: { import_run_id: string },
): Promise<{ id: string; soDaOutraOrigem: string }> {
  const [ano, mes, dia] = data.split("-");
  const { rows } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO snapshot (source_file_id, import_run_id, source_label, effective_date,
                          scope_hash, entity_type_set, status, dataset_family, canal,
                          canonical_scope)
    SELECT s.source_file_id, s.import_run_id,
           ${`EMPURRADA_${Number(dia)}_${Number(mes)}_${ano}`}, ${data}::date,
           s.scope_hash, s.entity_type_set, 'DRAFT', s.dataset_family, s.canal,
           s.canonical_scope
      FROM snapshot s WHERE s.id = ${base.id}::uuid
    RETURNING id
  `);
  const novo = rows[0]!.id;

  await ctx.db.execute(sql`
    INSERT INTO fact (snapshot_id, entity_id, attribute_id, value_numeric, value_text,
                      value_boolean, value_date, value_hash, is_null, null_reason,
                      raw_cell_id, origin_import_run_id)
    SELECT ${novo}::uuid, f.entity_id, f.attribute_id, f.value_numeric, f.value_text,
           f.value_boolean, f.value_date, f.value_hash, f.is_null, f.null_reason,
           f.raw_cell_id, f.origin_import_run_id
      FROM fact f WHERE f.snapshot_id = ${base.id}::uuid
  `);

  /*
    Agora as duas origens, escritas enquanto o snapshot ainda é DRAFT — que é a
    única janela em que `fact` aceita escrita, e a mesma que a promoção usa.

    Uma entidade fica **inteira** na outra origem: ocultá-la faz essa entidade
    desaparecer da vigência, e é o que prova que a ocultação atravessa o fato
    herdado. Outra fica **dividida** entre as duas: é a que teria sido contada
    duas vezes se a leitura somasse pré-agregados por origem.
  */
  const { rows: escolhidas } = await ctx.db.execute<{ entity_id: string }>(sql`
    SELECT DISTINCT entity_id FROM fact
     WHERE snapshot_id = ${novo}::uuid
     ORDER BY entity_id LIMIT 2
  `);
  const soDaOutra = escolhidas[0]!.entity_id;
  const dividida = escolhidas[1]!.entity_id;

  await ctx.db.execute(sql`
    UPDATE fact SET origin_import_run_id = ${outraOrigem.import_run_id}::uuid
     WHERE snapshot_id = ${novo}::uuid AND entity_id = ${soDaOutra}::uuid
  `);
  await ctx.db.execute(sql`
    UPDATE fact SET origin_import_run_id = ${outraOrigem.import_run_id}::uuid
     WHERE snapshot_id = ${novo}::uuid AND entity_id = ${dividida}::uuid
       AND id IN (
         SELECT id FROM fact
          WHERE snapshot_id = ${novo}::uuid AND entity_id = ${dividida}::uuid
          ORDER BY id LIMIT 1
       )
  `);

  await ctx.db.execute(
    sql`UPDATE snapshot SET status = 'CLOSED' WHERE id = ${novo}::uuid`,
  );
  await gravarPresenca(ctx.db, novo);
  return { id: novo, soDaOutraOrigem: soDaOutra };
}

/** As duas vigências mais antigas do contexto, para montar herança entre elas. */
async function duasVigencias() {
  const { rows } = await ctx.db.execute<{
    id: string;
    d: string;
    import_run_id: string;
  }>(sql`
    SELECT s.id, s.effective_date::text AS d, s.import_run_id
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
     ORDER BY s.effective_date
     LIMIT 2
  `);
  expect(rows).toHaveLength(2);
  return { anterior: rows[0]!, seguinte: rows[1]! };
}

describe("o contrato não mudou", () => {
  it("golden: a contagem pela presença é idêntica à do caminho ao vivo, no export real", async () => {
    await semPresenca();
    const aoVivo = await lidas();

    await comPresenca();
    const pelaPresenca = await lidas();

    expect(pelaPresenca).toEqual(aoVivo);

    // E o export real tem conteúdo, para o teste não passar com os dois vazios.
    const datas = Object.keys(aoVivo);
    expect(datas.length).toBeGreaterThan(1);
    expect(Object.values(aoVivo).some((t) => (t.CAVALO ?? 0) > 0)).toBe(true);
  });

  it("o promote grava a presença sozinho — o backfill não tem o que fazer num banco novo", async () => {
    /*
      A fixture importou pelo pipeline real. Se o gancho da promoção não
      estivesse ligado, o backfill teria trabalho aqui — e é isso que este
      teste recusa.
    */
    await comPresenca();
    expect(await preencherPresencasPendentes(ctx.db)).toBe(0);

    const { rows } = await ctx.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM snapshot_presenca`,
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it("vigência sem presença gravada cai no caminho de sempre, misturada com as que têm", async () => {
    await comPresenca();
    const tudoPreenchido = await lidas();

    const { anterior } = await duasVigencias();
    await ctx.db.execute(
      sql`DELETE FROM snapshot_presenca WHERE snapshot_id = ${anterior.id}::uuid`,
    );

    const meioAMeio = await lidas();
    expect(meioAMeio).toEqual(tudoPreenchido);

    await comPresenca();
  });
});

describe("ocultar e restaurar — o caso que o grão existe para acertar", () => {
  it("ocultar a importação da própria vigência tira a vigência da contagem", async () => {
    await comPresenca();
    const { anterior } = await duasVigencias();
    const antes = await lidas();
    expect(antes[anterior.d]).toBeDefined();

    await setImportRunHidden(ctx.db, anterior.import_run_id, true, {
      by: "teste",
      reason: "conferir a contagem",
    });
    expect((await lidas())[anterior.d]).toBeUndefined();

    await setImportRunHidden(ctx.db, anterior.import_run_id, false, {
      by: "teste",
      reason: "devolver",
    });
    expect((await lidas())[anterior.d]).toEqual(antes[anterior.d]);
  });

  it("ocultar uma das origens de um snapshot desconta só o que veio dela", async () => {
    const { seguinte } = await duasVigencias();
    const data = "2029-01-01";
    const outraOrigem = await runDescartavel(`origem-${data}`);
    await vigenciaComDuasOrigens(data, seguinte, { import_run_id: outraOrigem });

    const comAsDuas = await lidas();
    expect(comAsDuas[data]).toBeDefined();

    await setImportRunHidden(ctx.db, outraOrigem, true, {
      by: "teste",
      reason: "o caso que o grão de vigência erraria",
    });

    /*
      A vigência sintética **continua visível** — a importação dela não foi
      ocultada —, mas perdeu as entidades cujos fatos vinham da origem oculta.
      Uma contagem gravada por vigência não teria como saber disso: é
      exatamente o número que o desenho da `0080` erraria aqui.
    */
    const comUmaOculta = await lidas();
    expect(comUmaOculta[data]).toBeDefined();
    const somaAntes = Object.values(comAsDuas[data]!).reduce((a, b) => a + b, 0);
    const somaDepois = Object.values(comUmaOculta[data]!).reduce((a, b) => a + b, 0);
    expect(somaDepois).toBe(somaAntes - 1);

    // E o caminho ao vivo concorda — é o que prova a equivalência.
    await semPresenca();
    expect(await lidas()).toEqual(comUmaOculta);

    await setImportRunHidden(ctx.db, outraOrigem, false, {
      by: "teste",
      reason: "devolver",
    });
    await comPresenca();
    expect((await lidas())[data]).toEqual(comAsDuas[data]);
  });
});

describe("a gravação", () => {
  it("é idempotente: gravar três vezes deixa o mesmo estado", async () => {
    const { anterior } = await duasVigencias();
    const contar = async () => {
      const { rows } = await ctx.db.execute<{ n: string }>(
        sql`SELECT count(*) AS n FROM snapshot_presenca WHERE snapshot_id = ${anterior.id}::uuid`,
      );
      return Number(rows[0]!.n);
    };

    await gravarPresenca(ctx.db, anterior.id);
    const primeira = await contar();
    await gravarPresenca(ctx.db, anterior.id);
    await gravarPresenca(ctx.db, anterior.id);

    expect(await contar()).toBe(primeira);
    expect(primeira).toBeGreaterThan(0);
  });

  it("o backfill é reentrante: a segunda passada não tem o que fazer", async () => {
    await semPresenca();
    const primeira = await preencherPresencasPendentes(ctx.db);
    const segunda = await preencherPresencasPendentes(ctx.db);

    expect(primeira).toBeGreaterThan(0);
    expect(segunda).toBe(0);
  });

  it("apagar o snapshot leva a presença junto — é o cascade que responde pelo purge", async () => {
    const { anterior, seguinte } = await duasVigencias();
    const { id: alvo } = await vigenciaComDuasOrigens("2029-02-01", seguinte, { import_run_id: await runDescartavel("origem-cascade") });

    const contar = async () => {
      const { rows } = await ctx.db.execute<{ n: string }>(
        sql`SELECT count(*) AS n FROM snapshot_presenca WHERE snapshot_id = ${alvo}::uuid`,
      );
      return Number(rows[0]!.n);
    };
    expect(await contar()).toBeGreaterThan(0);

    /*
      A exclusão física é a única porta que apaga `fact`, e é ela que o
      `ON DELETE CASCADE` cobre — sem nenhuma lógica paralela de invalidação.
      Exercida aqui sob a mesma marca de purga que o gatilho reconhece.
    */
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('freightcheck.purge_import_run', 'on', true)`);
      await tx.execute(sql`DELETE FROM fact WHERE snapshot_id = ${alvo}::uuid`);
      await tx.execute(sql`DELETE FROM snapshot WHERE id = ${alvo}::uuid`);
    });

    expect(await contar()).toBe(0);
  });
});

describe("as invariantes que não podem ser refatoradas por engano", () => {
  /**
   * O teste que trava a otimização errada.
   *
   * A tentação, olhando a tabela, é somar uma contagem por origem em vez de
   * contar entidades distintas na leitura — parece equivalente e é mais barato.
   * Não é: uma entidade com fato de duas origens no mesmo snapshot seria
   * contada duas vezes. Este teste monta exatamente esse caso e exige o número
   * certo, para que a soma não passe despercebida.
   */
  it("entidade com fato de duas origens no mesmo snapshot conta uma vez, não duas", async () => {
    const { anterior, seguinte } = await duasVigencias();
    const data = "2029-03-01";
    const { id: alvo } = await vigenciaComDuasOrigens(data, seguinte, { import_run_id: await runDescartavel(`origem-${data}`) });

    // Há entidade com presença por duas origens — senão o teste não prova nada.
    const { rows: repetidas } = await ctx.db.execute<{ n: string }>(sql`
      SELECT count(*) AS n FROM (
        SELECT entity_id FROM snapshot_presenca
         WHERE snapshot_id = ${alvo}::uuid
         GROUP BY entity_id HAVING count(*) > 1
      ) t
    `);
    expect(Number(repetidas[0]!.n)).toBeGreaterThan(0);

    /*
      E ainda assim a contagem por tipo é de entidades distintas. Somar as
      linhas de presença daria um número maior — é o que isto proíbe.
    */
    const { rows: distintas } = await ctx.db.execute<{ tipo: string; n: string }>(sql`
      SELECT entity_type AS tipo, count(DISTINCT entity_id)::text AS n
        FROM snapshot_presenca WHERE snapshot_id = ${alvo}::uuid
       GROUP BY 1
    `);
    const contado = await lidas();
    for (const { tipo, n } of distintas) {
      expect(contado[data]?.[tipo]).toBe(Number(n));
    }

    const { rows: linhas } = await ctx.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM snapshot_presenca WHERE snapshot_id = ${alvo}::uuid`,
    );
    const somaDistintas = distintas.reduce((a, d) => a + Number(d.n), 0);
    expect(Number(linhas[0]!.n)).toBeGreaterThan(somaDistintas);
  });

  /**
   * O `CONJUNTO` ficou de fora da precomputação de propósito: ele conta o par
   * cavalo→carreta por `entity_identifier.is_current`, que é estado do presente
   * e não da vigência. Congelá-lo mudaria a semântica atual, e a Fase 3 não se
   * propôs a isso. Este teste prende a decisão.
   */
  it("CONJUNTO continua sendo apurado ao vivo, fora de snapshot_presenca", async () => {
    const fonte = readFileSync(join(__dirname, "..", "tipos-da-vigencia.ts"), "utf8");
    const inicio = fonte.indexOf("por_conjunto AS (");
    expect(inicio).toBeGreaterThan(-1);
    const trecho = fonte.slice(inicio, fonte.indexOf("SELECT d, tipo, entidades FROM por_entidade"));

    expect(trecho).toContain("fato_visivel");
    expect(trecho).toContain("carreta.is_current");
    expect(trecho).not.toContain("snapshot_presenca");
  });
});
