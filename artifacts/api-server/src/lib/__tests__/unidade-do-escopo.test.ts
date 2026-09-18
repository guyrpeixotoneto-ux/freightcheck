import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { encerrarPoolDoProcesso } from "@workspace/db";
import {
  conciliarEscoposImportados,
  unidadeDeclaradaDoEnvio,
  unidadeDoEscopo,
} from "../unidade-do-escopo";

/**
 * A TRAVESSIA DA LATERAL ATÉ A UNIDADE CADASTRADA — as duas pontes, e o que
 * acontece quando nenhuma responde.
 *
 * O caso real que este arquivo guarda: o acervo de CAMAÇARI importado com
 * CAMAÇARI aberta na lateral, e esta função respondendo `SEM_CADASTRO` — a tela
 * de Ativos e Parados recusava a série mandando associar à mão um vínculo que a
 * importação tinha em mãos. A primeira asserção é a ponte que a importação
 * grava; a segunda é a manual, que continua de pé para quem precisa dela.
 *
 * E há uma terceira coisa aqui, que é a que a tela precisa para não mandar
 * ninguém ao lugar errado: as **duas** ausências. "Não há unidade cadastrada
 * nenhuma" e "há, e este escopo ficou de fora" pedem telas diferentes.
 */

let ctx: TestDb;
/** O arquivo e a execução de onde as vigências deste arquivo pendem. */
let arquivoId: string;
let runId: string;

/** O CNPJ do caso real, com o sufixo que o export cola no código. */
const CAMACARI_CNPJ = "07526557001505";
const CAMACARI_CODE = "07526557001505_CERV";
const HASH_DE_CAMACARI = "hash-camacari";
const HASH_DE_BELEM = "hash-belem";

/**
 * Uma vigência com o escopo pendurado — o caminho que a leitura percorre.
 *
 * `scope_hash` é do **conjunto** de descritores de uma vigência, e o caminho
 * dele até as linhas de `scope` passa por `snapshot` e `snapshot_scope`. Montar
 * isso à mão é o preço de testar a travessia sem importar uma planilha inteira,
 * e vale: o que se está conferindo aqui é a consulta, não o pipeline.
 *
 * O arquivo e a execução são de `beforeAll` e ficam de pé o teste todo: a
 * camada RAW é imutável por gatilho (`0001`), e apagá-los entre os casos é
 * recusado pelo banco — com razão. O que a limpeza desfaz são as vigências,
 * que nascem DRAFT e podem mesmo ser apagadas.
 */
async function vigenciaComEscopo(
  scopeHash: string,
  escopo: { code: string; nome: string; unidadeId: string | null },
): Promise<void> {
  const { rows } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO scope (scope_type, code, name, unidade_id)
    VALUES ('UNIDADE', ${escopo.code}, ${escopo.nome}, ${escopo.unidadeId})
    ON CONFLICT (scope_type, code) DO UPDATE SET unidade_id = EXCLUDED.unidade_id
    RETURNING id
  `);
  const scopeId = rows[0]!.id;

  const { rows: snap } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO snapshot (
      source_file_id, import_run_id, source_label, effective_date, scope_hash,
      entity_type_set, dataset_family, canal, canonical_scope
    ) VALUES (
      ${arquivoId}, ${runId}, ${scopeHash}, '2041-01-01', ${scopeHash},
      'CAVALO', 'REMUNERACAO', 'EMPURRADA',
      freightcheck_canonical_scope(
        ${JSON.stringify([{ scopeType: "UNIDADE", code: escopo.code }])}::jsonb
      )
    )
    RETURNING id
  `);
  await ctx.db.execute(sql`
    INSERT INTO snapshot_scope (snapshot_id, scope_id) VALUES (${snap[0]!.id}, ${scopeId})
    ON CONFLICT DO NOTHING
  `);
}

async function cadastrarUnidade(nome: string, cnpj: string | null): Promise<string> {
  const { rows } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO unidade (nome, cnpj, codigo_gerencial)
    VALUES (${nome}, ${cnpj}, ${cnpj === null ? nome : null})
    RETURNING id
  `);
  return rows[0]!.id;
}

async function limpar(): Promise<void> {
  await ctx.db.execute(sql`DELETE FROM remuneracao_unidade`);
  await ctx.db.execute(sql`DELETE FROM snapshot_scope`);
  await ctx.db.execute(sql`DELETE FROM snapshot`);
  await ctx.db.execute(sql`DELETE FROM scope`);
  await ctx.db.execute(sql`DELETE FROM unidade`);
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_unidade_do_escopo");
  process.env.DATABASE_URL = ctx.url;

  const { rows: arquivo } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO source_file (filename, content_sha256, byte_size, mime_type, storage_path)
    VALUES ('escopos.xlsx', 'sha-dos-escopos', 1, 'application/x', '/tmp/escopos')
    RETURNING id
  `);
  arquivoId = arquivo[0]!.id;
  const { rows: run } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO import_run (source_file_id, status) VALUES (${arquivoId}, 'PROMOTED')
    RETURNING id
  `);
  runId = run[0]!.id;
}, 300_000);

beforeEach(limpar);

afterAll(async () => {
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

describe("a ponte que a importação grava", () => {
  it("resolve o escopo importado, sem cadastro manual nenhum", async () => {
    const camacari = await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: camacari,
    });

    expect(await unidadeDoEscopo(ctx.db, HASH_DE_CAMACARI)).toEqual({
      tipo: "RESOLVIDO",
      unidadeId: camacari,
      nome: "CAMAÇARI",
    });
  });

  /*
    As duas pontes apontando para a mesma unidade são **uma** resposta.

    É o caso normal depois desta mudança: quem já tinha associado à mão continua
    tendo a linha de `remuneracao_unidade`, e a importação seguinte grava
    `scope.unidade_id` com a mesma unidade. Sem a união das duas leituras, o dia
    seguinte à importação viraria `AMBIGUO` numa unidade que ninguém tocou — a
    tela pararia de desenhar a série por causa de uma concordância.
  */
  it("não vira ambíguo quando a ponte manual e a importada concordam", async () => {
    const camacari = await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: camacari,
    });
    await ctx.db.execute(sql`
      INSERT INTO remuneracao_unidade (scope_hash, codigo, nome, canal, vigencia_inicial, unidade_id)
      VALUES (${HASH_DE_CAMACARI}, ${CAMACARI_CODE}, 'CAMAÇARI', 'EMPURRADA', '2041-01-01', ${camacari})
    `);

    expect((await unidadeDoEscopo(ctx.db, HASH_DE_CAMACARI)).tipo).toBe("RESOLVIDO");
  });

  it("continua ambíguo quando as duas discordam — ninguém escolhe em silêncio", async () => {
    const camacari = await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);
    const outra = await cadastrarUnidade("CDD CARUARU", "03134910000236");
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: camacari,
    });
    await ctx.db.execute(sql`
      INSERT INTO remuneracao_unidade (scope_hash, codigo, nome, canal, vigencia_inicial, unidade_id)
      VALUES (${HASH_DE_CAMACARI}, ${CAMACARI_CODE}, 'CAMAÇARI', 'EMPURRADA', '2041-01-01', ${outra})
    `);

    const resposta = await unidadeDoEscopo(ctx.db, HASH_DE_CAMACARI);
    expect(resposta.tipo).toBe("AMBIGUO");
  });
});

describe("as duas ausências, que a tela precisa distinguir", () => {
  it("diz que não há cadastro nenhum quando a unidade nunca foi cadastrada", async () => {
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: null,
    });

    expect(await unidadeDoEscopo(ctx.db, HASH_DE_CAMACARI)).toEqual({
      tipo: "SEM_CADASTRO",
      unidadeCadastrada: false,
    });
  });

  it("diz que há cadastro quando o que falta é a associação deste escopo", async () => {
    await cadastrarUnidade("CDD RECIFE", "03134910000236");
    await vigenciaComEscopo(HASH_DE_BELEM, {
      code: "443",
      nome: "CDD BELÉM",
      unidadeId: null,
    });

    expect(await unidadeDoEscopo(ctx.db, HASH_DE_BELEM)).toEqual({
      tipo: "SEM_CADASTRO",
      unidadeCadastrada: true,
    });
  });
});

/**
 * O HISTÓRICO — o acervo que entrou antes de a unidade existir no cadastro.
 *
 * É a metade do conserto que a importação sozinha não faz: ela liga o escopo ao
 * que **já existe**, e um acervo importado antes do cadastro ficou com o escopo
 * nulo. Sem esta passada, o conserto dele seria reimportar tudo — que é
 * exatamente o que a tela não pode mandar alguém fazer.
 */
describe("os escopos já importados, quando a unidade é cadastrada depois", () => {
  it("ganham a unidade pelo CNPJ dentro do código, sem reimportar nada", async () => {
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: null,
    });
    expect((await unidadeDoEscopo(ctx.db, HASH_DE_CAMACARI)).tipo).toBe("SEM_CADASTRO");

    const camacari = await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);
    const { associados } = await conciliarEscoposImportados(ctx.db);

    expect(associados).toEqual([{ code: CAMACARI_CODE, nome: "CAMAÇARI" }]);
    expect(await unidadeDoEscopo(ctx.db, HASH_DE_CAMACARI)).toEqual({
      tipo: "RESOLVIDO",
      unidadeId: camacari,
      nome: "CAMAÇARI",
    });
  });

  it("é idempotente: a segunda passada não escreve linha nenhuma", async () => {
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: null,
    });
    await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);

    await conciliarEscoposImportados(ctx.db);
    expect((await conciliarEscoposImportados(ctx.db)).associados).toEqual([]);
  });

  /*
    E a asserção que protege o desenho: o nome não associa nada. O escopo se
    chama CAMAÇARI, a unidade cadastrada se chama CAMAÇARI, e o código não é
    documento nenhum — a resposta continua sendo a associação manual. Dois CDDs
    podem chamar-se igual.
  */
  it("não associa por nome, nem com o nome idêntico", async () => {
    await vigenciaComEscopo(HASH_DE_BELEM, {
      code: "443",
      nome: "CAMAÇARI",
      unidadeId: null,
    });
    await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);

    expect((await conciliarEscoposImportados(ctx.db)).associados).toEqual([]);
    expect((await unidadeDoEscopo(ctx.db, HASH_DE_BELEM)).tipo).toBe("SEM_CADASTRO");
  });

  /*
    E não sobrescreve decisão de gente: o escopo que alguém associou à mão a uma
    unidade fica como está, mesmo quando o CNPJ dentro do código diria outra.
    Corrigir isso é ato de quem cadastrou, não efeito colateral de um cadastro
    novo noutra tela.
  */
  it("não sobrescreve a unidade que já estava associada", async () => {
    const recife = await cadastrarUnidade("CDD RECIFE", "03134910000236");
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: recife,
    });
    await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);

    expect((await conciliarEscoposImportados(ctx.db)).associados).toEqual([]);
    const resposta = await unidadeDoEscopo(ctx.db, HASH_DE_CAMACARI);
    expect(resposta).toEqual({
      tipo: "RESOLVIDO",
      unidadeId: recife,
      nome: "CDD RECIFE",
    });
  });
});

/**
 * O QUE O ENVIO DECLARA — a tradução de "onde eu estava" em identidade.
 *
 * A tela manda o escopo aberto na lateral, nunca um `unidade_id`: mandar
 * identidade faria o cliente afirmar o que ele escolheu, em vez de relatar onde
 * estava. Quem traduz é isto.
 */
describe("a unidade que um envio declara", () => {
  it("honra a associação que este escopo já tem", async () => {
    const camacari = await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: camacari,
    });

    expect(
      await unidadeDeclaradaDoEnvio(ctx.db, {
        scopeHash: HASH_DE_CAMACARI,
        codigo: CAMACARI_CODE,
      }),
    ).toBe(camacari);
  });

  it("cai no CNPJ do código quando o escopo ainda não tem ponte nenhuma", async () => {
    const camacari = await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);

    expect(
      await unidadeDeclaradaDoEnvio(ctx.db, {
        scopeHash: "hash-que-nao-existe",
        codigo: CAMACARI_CODE,
      }),
    ).toBe(camacari);
  });

  it("não declara nada quando o escopo é ambíguo", async () => {
    const camacari = await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);
    const outra = await cadastrarUnidade("CDD CARUARU", "03134910000236");
    await vigenciaComEscopo(HASH_DE_CAMACARI, {
      code: CAMACARI_CODE,
      nome: "CAMAÇARI",
      unidadeId: camacari,
    });
    await ctx.db.execute(sql`
      INSERT INTO remuneracao_unidade (scope_hash, codigo, nome, canal, vigencia_inicial, unidade_id)
      VALUES (${HASH_DE_CAMACARI}, ${CAMACARI_CODE}, 'CAMAÇARI', 'EMPURRADA', '2041-01-01', ${outra})
    `);

    expect(
      await unidadeDeclaradaDoEnvio(ctx.db, {
        scopeHash: HASH_DE_CAMACARI,
        codigo: CAMACARI_CODE,
      }),
    ).toBeNull();
  });

  it("não declara nada quando o envio saiu da Visão Geral", async () => {
    await cadastrarUnidade("CAMAÇARI", CAMACARI_CNPJ);
    expect(
      await unidadeDeclaradaDoEnvio(ctx.db, { scopeHash: null, codigo: null }),
    ).toBeNull();
  });
});
