import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createTestDatabase, modelExportPaths, type TestDb } from "../testing";
import { corrigirValoresNumericos } from "./planilha-sintetica";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { deleteImportRun, planImportDeletion } from "../deletion";

/**
 * O contrato: excluir uma importação exclui **dados**, nunca a identidade nem
 * o dicionário dos atributos.
 *
 * Este arquivo não descreve como a exclusão funciona por dentro — isso é
 * `deletion.test.ts`. Ele fixa a regra conceitual, e existe porque a regra já
 * foi diferente duas vezes e a segunda versão errava calada.
 *
 * A primeira apagava toda coluna que ficasse sem fato. A segunda protegia a
 * coluna "curada", e definia curada por uma lista de campos em prosa — que não
 * via o ato mais comum da Curadoria: confirmar uma coluna pela tela grava
 * significado, categoria, estado e autor, e nenhuma palavra de texto livre. A
 * coluna sumia como se ninguém a tivesse tocado, e os `curation_event` daquele
 * ato — que não têm chave estrangeira para `attribute` — ficavam apontando para
 * um id inexistente.
 *
 * Daí a regra atual, que não infere nada: **nenhum atributo é apagado porque
 * ficou sem fatos.** Se um dia existir limpeza de coluna órfã, ela será uma
 * operação separada e explícita — ver a nota no fim deste arquivo e o docstring
 * de `attributeIdsLeftWithoutData`.
 *
 * Os seis contratos, um por `it`:
 *
 * 1. atributo nunca curado que fica sem dados permanece;
 * 2. atributo confirmado sem nenhum campo textual permanece;
 * 3. aliases, semântica e histórico permanecem íntegros;
 * 4. excluir e reimportar a mesma planilha reutiliza o mesmo atributo/`code`,
 *    sem duplicar;
 * 5. exclusão parcial não afeta atributo ainda usado por outras importações;
 * 6. não existe outra rota que apague `attribute`, `attribute_alias` ou
 *    `attribute_semantics`.
 */

let ctx: TestDb;

/** Uma coluna do dicionário, como o teste precisa vê-la. */
interface Coluna {
  id: string;
  code: string;
  source_name: string;
  display_name: string | null;
  definition: string | null;
  change_rule: string | null;
  semantics_status: string;
  confirmed_by: string | null;
  first_seen_import_run_id: string | null;
}

async function importar(arquivo: string, opcoes: { revisao?: boolean } = {}) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    receivedBy: "quem.importou@exemplo.com",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  await promote(ctx.db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
    onExistingSnapshot: opcoes.revisao ? "NEW_REVISION" : "FAIL",
  });
  return recebido.importRunId;
}

async function contar(query: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(query);
  return Number(rows[0].n);
}

async function colunas(): Promise<Coluna[]> {
  const { rows } = await ctx.pool.query<Coluna>(
    `SELECT id, code, source_name, display_name, definition, change_rule,
            semantics_status, confirmed_by, first_seen_import_run_id
       FROM attribute ORDER BY code`,
  );
  return rows;
}

beforeAll(async () => {
  ctx = await createTestDatabase("dicionario_exclusao");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("excluir uma importação não apaga o dicionário", () => {
  /** A primeira leitura do arquivo — a que fica por último. */
  let primeira: string;
  /** A correção da mesma vigência: é ela que sai primeiro. */
  let correcao: string;

  let descritoId: string;
  let batizadoId: string;
  let confirmadoId: string;
  let naoCuradoId: string;

  let colunasAntes: Coluna[];
  let aliasesAntes: number;
  let semanticasAntes: number;
  let eventosAntes: number;

  beforeAll(async () => {
    primeira = await importar(modelExportPaths().carreta);

    /*
      Quatro colunas, nos quatro estados em que a perda aconteceria — e as duas
      últimas são as que as regras anteriores não protegiam.

      Escritas direto na projeção de propósito: é o mesmo UPDATE que a curadoria
      faz, sem arrastar `@workspace/curation` para dentro de um teste de
      ingestão (ver `fronteira.test.ts`).
    */
    descritoId = (
      await ctx.pool.query<{ id: string }>(
        `UPDATE attribute
            SET definition  = 'O seguro do casco, por carreta e por mês.',
                change_rule = 'Reajusta na renovação anual da apólice.'
          WHERE id = (SELECT id FROM attribute ORDER BY code LIMIT 1)
          RETURNING id`,
      )
    ).rows[0].id;

    batizadoId = (
      await ctx.pool.query<{ id: string }>(
        `UPDATE attribute
            SET display_name = 'Prazo do FINAME, em meses'
          WHERE id = (SELECT id FROM attribute ORDER BY code OFFSET 1 LIMIT 1)
          RETURNING id`,
      )
    ).rows[0].id;

    /*
      A confirmada sem uma linha de texto: é o que a tela de Curadoria escreve
      quando alguém confirma uma coluna pelo significado
      (`gravarSemanticaConfirmada`) — estado, autor e data, e nada mais. A
      regra anterior a lia como "ninguém tocou nisto".
    */
    confirmadoId = (
      await ctx.pool.query<{ id: string }>(
        `UPDATE attribute
            SET semantics_status = 'CONFIRMED',
                confirmed_by     = 'quem.curou@exemplo.com',
                confirmed_at     = now()
          WHERE id = (SELECT id FROM attribute
                       WHERE semantics_status <> 'CONFIRMED'
                       ORDER BY code OFFSET 2 LIMIT 1)
          RETURNING id`,
      )
    ).rows[0].id;

    // E o ato de curadoria correspondente, que é o que sobrevivia órfão: um
    // `curation_event` não tem chave estrangeira para `attribute`.
    await ctx.pool.query(
      `INSERT INTO curation_event
         (target_kind, target_id, target_label, field, value_before, value_after, actor, reason)
       SELECT 'ATTRIBUTE', a.id, a.code, 'semantics_status', 'UNKNOWN', 'CONFIRMED',
              'quem.curou@exemplo.com', 'confirmado na tela, sem escrever prosa'
         FROM attribute a WHERE a.id = $1`,
      [confirmadoId],
    );

    /*
      E uma que ninguém jamais tocou. Ela é o contrato 1, e é o único dos
      quatro casos que a regra original — "sem fato, sai" — já respondia
      apagando: é aqui que a mudança de conceito aparece inteira.
    */
    naoCuradoId = (
      await ctx.pool.query<{ id: string }>(
        `SELECT id FROM attribute
          WHERE definition IS NULL AND change_rule IS NULL
            AND display_name IS NULL
            AND economic_direction IS NULL AND economic_effect IS NULL
            AND semantics_status <> 'CONFIRMED'
            AND confirmed_by IS NULL
          ORDER BY code LIMIT 1`,
      )
    ).rows[0].id;

    // A correção da mesma vigência, para que exista uma exclusão **parcial**:
    // enquanto ela e a primeira convivem, nenhuma coluna fica sem dado.
    correcao = await importar(corrigirValoresNumericos(modelExportPaths().carreta), {
      revisao: true,
    });

    colunasAntes = await colunas();
    aliasesAntes = await contar(`SELECT count(*) AS n FROM attribute_alias`);
    semanticasAntes = await contar(`SELECT count(*) AS n FROM attribute_semantics`);
    eventosAntes = await contar(
      `SELECT count(*) AS n FROM curation_event WHERE target_kind = 'ATTRIBUTE'`,
    );

    expect(new Set([descritoId, batizadoId, confirmadoId, naoCuradoId]).size).toBe(4);
    expect(eventosAntes).toBeGreaterThan(0);
  }, 900_000);

  /**
   * Contrato 5 — a exclusão parcial.
   *
   * Duas importações sustentam as mesmas colunas. Tirar uma não deixa coluna
   * nenhuma sem dado, e a prévia precisa dizer isso antes de alguém decidir:
   * "nenhuma coluna fica sem dado" é uma informação diferente de "nenhuma
   * coluna é apagada", e as duas valem aqui.
   */
  it("exclusão parcial: o atributo ainda usado por outra importação não é afetado", async () => {
    const plano = (await planImportDeletion(ctx.db, correcao))!;
    expect(plano.refusal).toBeNull();
    expect(plano.removes.facts).toBeGreaterThan(0);
    // Nenhuma coluna fica órfã: a leitura anterior continua sustentando todas.
    expect(plano.removes.attributesKept).toBe(0);

    await deleteImportRun(ctx.db, correcao, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "correção enviada por engano",
    });

    // O dicionário inteiro, igual ao que era — id por id, campo por campo.
    expect(await colunas()).toEqual(colunasAntes);

    // E as colunas continuam com dado, porque a outra importação as sustenta.
    expect(
      await contar(`SELECT count(*) AS n FROM fact WHERE attribute_id = '${descritoId}'`),
    ).toBeGreaterThan(0);
    expect(
      await contar(`SELECT count(*) AS n FROM fact WHERE attribute_id = '${naoCuradoId}'`),
    ).toBeGreaterThan(0);
  });

  /**
   * Contratos 1 e 2 — agora sem nenhuma importação sustentando as colunas.
   *
   * É o caso que a regra antiga resolvia apagando, e o que a regra do meio
   * resolvia apagando **metade**.
   */
  it("excluída a última importação, nenhuma coluna sai — curada ou não", async () => {
    const plano = (await planImportDeletion(ctx.db, primeira))!;
    // Agora sim: sem esta importação, todas as colunas ficam sem dado.
    expect(plano.removes.attributesKept).toBe(colunasAntes.length);

    await deleteImportRun(ctx.db, primeira, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "arquivo do mês errado",
    });

    expect(await contar(`SELECT count(*) AS n FROM fact`)).toBe(0);
    expect(await contar(`SELECT count(*) AS n FROM import_run`)).toBe(0);

    const depois = await colunas();
    expect(depois.length).toBe(colunasAntes.length);
    expect(depois.map((c) => c.code)).toEqual(colunasAntes.map((c) => c.code));

    // Contrato 1: a coluna que ninguém nunca curou continua lá, sem nenhum fato.
    const naoCurado = depois.find((c) => c.id === naoCuradoId)!;
    expect(naoCurado).toBeDefined();
    expect(naoCurado.definition).toBeNull();
    expect(naoCurado.display_name).toBeNull();
    expect(
      await contar(`SELECT count(*) AS n FROM fact WHERE attribute_id = '${naoCuradoId}'`),
    ).toBe(0);

    // Contrato 2: a confirmada sem nenhum campo textual continua lá, e continua
    // confirmada. Os três `toBeNull` são o que faz o contrato ser este e não
    // outro: se ela tivesse prosa, a regra antiga também a teria salvado.
    const confirmado = depois.find((c) => c.id === confirmadoId)!;
    expect(confirmado.definition).toBeNull();
    expect(confirmado.change_rule).toBeNull();
    expect(confirmado.display_name).toBeNull();
    expect(confirmado.semantics_status).toBe("CONFIRMED");
    expect(confirmado.confirmed_by).toBe("quem.curou@exemplo.com");

    // E as duas curadas em prosa, que já eram protegidas, continuam iguais.
    const descrito = depois.find((c) => c.id === descritoId)!;
    expect(descrito.definition).toMatch(/seguro do casco/);
    expect(descrito.change_rule).toMatch(/apólice/);
    expect(depois.find((c) => c.id === batizadoId)!.display_name).toBe(
      "Prazo do FINAME, em meses",
    );

    // O único campo que muda é o ponteiro para o run que deixou de existir.
    for (const linha of depois) expect(linha.first_seen_import_run_id).toBeNull();
  });

  /** Contrato 3 — o que pendura no atributo fica pendurado nele. */
  it("aliases, semântica e histórico de curadoria ficam íntegros", async () => {
    expect(await contar(`SELECT count(*) AS n FROM attribute_alias`)).toBe(aliasesAntes);
    expect(await contar(`SELECT count(*) AS n FROM attribute_semantics`)).toBe(
      semanticasAntes,
    );
    expect(
      await contar(
        `SELECT count(*) AS n FROM curation_event WHERE target_kind = 'ATTRIBUTE'`,
      ),
    ).toBe(eventosAntes);

    // Nenhum alias e nenhuma versão apontando para coluna que não existe — a
    // chave estrangeira já garante isto, e é de graça deixá-lo dito.
    expect(
      await contar(`SELECT count(*) AS n FROM attribute_alias al
                     WHERE NOT EXISTS (SELECT 1 FROM attribute a WHERE a.id = al.attribute_id)`),
    ).toBe(0);

    /*
      E nenhum ato de curadoria órfão. Este é o defeito que motivou a mudança e
      o único destes contratos que o banco **não** garante sozinho:
      `curation_event.target_id` não tem chave estrangeira, então uma exclusão
      que apagasse a coluna passaria sem erro e deixaria a auditoria afirmando
      que alguém confirmou uma coluna inexistente.
    */
    expect(
      await contar(`SELECT count(*) AS n FROM curation_event e
                     WHERE e.target_kind = 'ATTRIBUTE'
                       AND NOT EXISTS (SELECT 1 FROM attribute a WHERE a.id = e.target_id)`),
    ).toBe(0);
  });

  /** Contrato 4 — a identidade é o `code`, e é por ele que o dado volta. */
  it("reimportar a mesma planilha reencontra as colunas, sem duplicar", async () => {
    // O caminho é outro porque a exclusão apaga o arquivo em disco — a mesma
    // razão de `libera o mesmo arquivo para ser enviado de novo`.
    const copia = path.join(tmpdir(), `recuperacao-dicionario-${process.pid}.xlsx`);
    copyFileSync(modelExportPaths().carreta, copia);
    await importar(copia);

    const depois = await colunas();
    // Mesmos ids, mesmos códigos, mesma quantidade: nenhuma linha nova nasceu
    // para um código que já existia.
    expect(depois.map((c) => c.id).sort()).toEqual(colunasAntes.map((c) => c.id).sort());
    expect(
      await contar(
        `SELECT count(*) AS n FROM (SELECT code FROM attribute GROUP BY code HAVING count(*) > 1) d`,
      ),
    ).toBe(0);

    // E os fatos voltaram para as mesmas linhas, curadas inclusive.
    for (const id of [descritoId, confirmadoId, naoCuradoId]) {
      expect(
        await contar(`SELECT count(*) AS n FROM fact WHERE attribute_id = '${id}'`),
      ).toBeGreaterThan(0);
    }
    expect(depois.find((c) => c.id === descritoId)!.definition).toMatch(/seguro do casco/);
    expect(depois.find((c) => c.id === confirmadoId)!.confirmed_by).toBe(
      "quem.curou@exemplo.com",
    );
  });
});

// ---------------------------------------------------------------------------
// Contrato 6 — não há outra porta
// ---------------------------------------------------------------------------

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Todo `.ts`/`.tsx` de produção do monorepo — sem teste, sem build, sem deps. */
function fontesDeProducao(dir: string, saida: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (["node_modules", "dist", "__tests__", ".git"].includes(entrada.name)) continue;
      fontesDeProducao(path.join(dir, entrada.name), saida);
    } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      saida.push(path.join(dir, entrada.name));
    }
  }
  return saida;
}

/**
 * Uma regra que vale num caminho e não nos outros não é regra.
 *
 * `deleteImportRun` é a única exclusão de importação que existe hoje, mas o que
 * este bloco protege não é ela: é a ausência de uma segunda porta. Um `DELETE
 * FROM attribute` escrito amanhã em outra rota, numa CLI ou num script de
 * manutenção compila, roda e desfaz o contrato sem que nenhum teste de
 * comportamento perceba.
 *
 * O escopo é o código que roda: `.ts`/`.tsx` de produção dos pacotes e dos
 * artifacts. Migrations não entram — uma migration que remova colunas órfãs é
 * precisamente a "operação separada e explícita" que este contrato admite, e
 * proibi-la aqui seria proibir o caminho certo junto com o errado.
 */
describe("nenhum outro caminho apaga um atributo", () => {
  it("nenhuma fonte de produção apaga attribute, attribute_alias ou attribute_semantics", () => {
    const PROIBIDO =
      /DELETE\s+FROM\s+"?attribute"?(_alias|_semantics)?\b|\.delete\(\s*attribute(Table|AliasTable|SemanticsTable)\s*\)/i;

    const ofensores = [
      ...fontesDeProducao(path.join(RAIZ, "lib")),
      ...fontesDeProducao(path.join(RAIZ, "artifacts")),
      ...fontesDeProducao(path.join(RAIZ, "scripts")),
    ].filter((arquivo) => PROIBIDO.test(readFileSync(arquivo, "utf8")));

    expect(ofensores.map((f) => path.relative(RAIZ, f))).toEqual([]);
  });

  it("o banco também não apaga: nenhuma cascata e nenhum gatilho sobre attribute", async () => {
    /*
      A varredura de texto acima só vê o que está escrito. Um `ON DELETE
      CASCADE` de `attribute` para `import_run`, `semantic_meaning` ou
      `taxonomy_node` apagaria a coluna sem uma linha de código dizê-lo — bastaria
      alguém excluir o nó da taxonomia. É a mesma pergunta, feita ao banco.
    */
    const { rows: cascatas } = await ctx.pool.query<{ ligacao: string }>(`
      SELECT src.relname || ' -> ' || tgt.relname AS ligacao
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_class tgt ON tgt.oid = c.confrelid
       WHERE c.contype = 'f'
         AND c.confdeltype IN ('c', 'n', 'd')
         AND (src.relname LIKE 'attribute%' OR tgt.relname LIKE 'attribute%')`);
    expect(cascatas.map((r) => r.ligacao)).toEqual([]);

    const { rows: gatilhos } = await ctx.pool.query<{ tgname: string }>(`
      SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname LIKE 'attribute%'`);
    expect(gatilhos.map((r) => r.tgname)).toEqual([]);
  });
});
