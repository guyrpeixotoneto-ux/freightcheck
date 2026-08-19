import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ESTADOS_POR_DECIDIR,
  ReprocessamentoRecusado,
  captureRaw,
  preview,
  promote,
  receiveFile,
  reprocessImportRun,
  stage,
} from "../pipeline";
import { getImportRun, listImportRuns } from "../history";
import { deleteImportRun, planImportDeletion } from "../deletion";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "../canonical-identity";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";

/**
 * Reler um arquivo que já entrou, sem apagar o que ele já produziu.
 *
 * O SHA-256 responde *este arquivo já entrou?* antes de abrir o arquivo, e
 * `deduplicacao.test.ts` prova que ele não deixa passar. O que este arquivo
 * prova é a outra pergunta, que só aparece com o tempo: **o leitor mudou desde
 * então?** As duas chegam ao Postgres como a mesma linha em `source_file`, e a
 * resposta era a mesma recusa — o que transformava a defesa contra o reenvio
 * acidental numa tranca contra a releitura legítima.
 *
 * O caso que originou tudo isto está escrito inteiro no último bloco: uma
 * planilha de QLP que entrou sem declaração, foi promovida na família errada, e
 * por isso não aparecia na tela do quadro de pessoal — com o arquivo trancado
 * pelo próprio sha.
 */

let ctx: TestDb;

const QUEM = "quem.opera@exemplo.com";

/** A esteira inteira, do recebimento ao PREVIEWED. Promover é outra decisão. */
async function lerAteConferir(importRunId: string) {
  await captureRaw(ctx.db, importRunId);
  await stage(ctx.db, importRunId);
  return preview(ctx.db, importRunId);
}

async function importar(arquivo: string, declaredType?: string) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    receivedBy: QUEM,
    declaredType,
  });
  if (recebido.isDuplicate) return { ...recebido, relatorio: null };
  const relatorio = await lerAteConferir(recebido.importRunId);
  return { ...recebido, relatorio };
}

/** Um quadro de pessoal administrativo: um cargo por unidade, com vigência. */
function planilhaDeQlpAdm(vigencia: string, nomeDaAba = "Planilha1") {
  return escreverPlanilha({
    vigencia,
    abas: [
      {
        nome: nomeDaAba,
        identificador: "Cargo",
        linhas: [
          { placa: "COORDENADOR" },
          { placa: "ANALISTA" },
          { placa: "ASSISTENTE" },
        ],
      },
    ],
  });
}

function planilhaDeCavalo(vigencia: string) {
  return escreverPlanilha({
    vigencia,
    abas: [{ nome: "cavalos", linhas: [{ placa: "ABC1D23" }, { placa: "ABC4D56" }] }],
  });
}

/** Uma vigência por caso, para dois casos não disputarem a mesma identidade. */
let diaSequencial = 0;
function vigenciaUnica(): string {
  diaSequencial++;
  const mes = 1 + Math.floor((diaSequencial - 1) / 28);
  const dia = 1 + ((diaSequencial - 1) % 28);
  return `EMPURRADA_${dia}_${mes}_2031`;
}

async function contar(query: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(query);
  return Number(rows[0].n);
}

beforeAll(async () => {
  ctx = await createTestDatabase("reprocessamento");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

// ---------------------------------------------------------------------------

describe("o reenvio idêntico continua barrado", () => {
  it("o mesmo arquivo, enviado de novo, é recusado sem ser aberto", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const primeira = await importar(arquivo, "CAVALO");
    expect(primeira.isDuplicate).toBe(false);

    const segunda = await importar(arquivo, "CAVALO");
    expect(segunda.isDuplicate).toBe(true);
    expect(segunda.sourceFileId).toBe(primeira.sourceFileId);

    const run = (await getImportRun(ctx.db, segunda.importRunId))!;
    expect(run.status).toBe("SKIPPED_DUPLICATE");

    // Não é "leu e não achou nada": é "não abriu". Os contadores e a frase
    // precisam dizer a mesma coisa, porque foi a divergência entre os dois que
    // mandou um operador procurar defeito nas colunas da planilha dele.
    expect(run.sheets).toBe(0);
    expect(run.rawCells).toBe(0);
    expect(run.rawRows).toBe(0);
    expect(run.stagedFacts).toBe(0);
    expect(run.snapshots).toBe(0);
    expect(run.errors).toBe(0);
  });

  it("a recusa por duplicata diz que nada foi lido, e não que nada foi reconhecido", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    await importar(arquivo, "CAVALO");
    const duplicada = await importar(arquivo, "CAVALO");

    const run = (await getImportRun(ctx.db, duplicada.importRunId))!;
    expect(run.failureReason).toMatch(/já havia sido recebido/);
    expect(run.failureReason).toMatch(/Nada foi lido desta vez/);
    expect(run.failureReason).toMatch(/nenhuma aba, nenhuma célula e nenhum fato/);
    // E aponta a saída, em vez de deixar o operador concluir que o arquivo é ruim.
    expect(run.failureReason).toMatch(/Reprocessar/);

    // A frase antiga dizia que as células tinham sido gravadas. Nenhuma foi.
    expect(run.failureReason).not.toMatch(/célula.{0,20}gravad/i);
  });

  it("reenviar não abre run de leitura: o segundo é terminal na hora", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const primeira = await importar(arquivo, "CAVALO");
    const duplicada = await importar(arquivo, "CAVALO");

    const { rows } = await ctx.pool.query<{ id: string; finished_at: Date | null }>(
      `SELECT id, finished_at FROM import_run WHERE id = $1`,
      [duplicada.importRunId],
    );
    expect(rows[0].finished_at).not.toBeNull();

    // E um só `source_file` para os dois runs: o arquivo não é duplicado em disco.
    expect(
      await contar(
        `SELECT count(*) AS n FROM source_file sf
          JOIN import_run ir ON ir.source_file_id = sf.id
         WHERE ir.id = '${primeira.importRunId}'`,
      ),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("reprocessar é uma releitura, e ela se declara", () => {
  it("cria um run novo sobre o mesmo conteúdo, sem duplicar o arquivo", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    const arquivosAntes = await contar(`SELECT count(*) AS n FROM source_file`);

    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "o leitor passou a entender a coluna de encargos",
      requestedBy: QUEM,
    });

    expect(releitura.importRunId).not.toBe(original.importRunId);
    expect(releitura.reprocessOfRunId).toBe(original.importRunId);
    expect(releitura.sourceFileId).toBe(original.sourceFileId);
    expect(releitura.contentSha256).toBe(original.contentSha256);

    // O mesmo arquivo, uma vez só. Reprocessar não reenvia bytes.
    expect(await contar(`SELECT count(*) AS n FROM source_file`)).toBe(arquivosAntes);
    expect(
      await contar(
        `SELECT count(*) AS n FROM import_run WHERE source_file_id = '${original.sourceFileId}'`,
      ),
    ).toBe(2);

    // E a releitura produz os fatos que a primeira leitura produziu — ela leu
    // mesmo o arquivo, não herdou nada do run anterior.
    const relatorio = await lerAteConferir(releitura.importRunId);
    expect(relatorio.totals.stagedFacts).toBeGreaterThan(0);

    const nova = (await getImportRun(ctx.db, releitura.importRunId))!;
    expect(nova.rawCells).toBeGreaterThan(0);
    expect(nova.contentSha256).toBe(original.contentSha256);
  });

  it("pedida a partir do cartão da duplicata, ancora no recebimento — não na recusa", async () => {
    /*
      O caminho que o operador de verdade percorre.

      O cartão que ele tem na tela é o da tentativa recusada — é nele que
      aparece "este arquivo já havia sido recebido", e é dele que a pergunta
      "e agora?" nasce. Gravar a releitura contra aquele run diria, no banco,
      que ela releu algo que não leu nada.
    */
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });
    const recusada = await importar(arquivo, "CAVALO");
    expect(recusada.isDuplicate).toBe(true);

    const releitura = await reprocessImportRun(ctx.db, recusada.importRunId, {
      reason: "pedido a partir do cartão da tentativa recusada",
    });

    expect(releitura.reprocessOfRunId).toBe(original.importRunId);
    expect(releitura.reprocessOfRunId).not.toBe(recusada.importRunId);

    // E o aviso de exclusão acompanha: quem tem releitura pendurada é o
    // recebimento, não a tentativa recusada.
    expect(
      (await planImportDeletion(ctx.db, original.importRunId))!
        .reprocessamentosReancorados,
    ).toEqual([releitura.importRunId]);
    expect(
      (await planImportDeletion(ctx.db, recusada.importRunId))!
        .reprocessamentosReancorados,
    ).toEqual([]);
  });

  it("a segunda releitura ancora na primeira: a história é uma corrente", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    const primeira = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "primeira releitura desta corrente de leituras",
    });
    const relatorio = await lerAteConferir(primeira.importRunId);
    await promote(ctx.db, primeira.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    const segunda = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "segunda releitura, pedida de novo pelo cartão do recebimento",
    });

    // Corrente, não leque: a segunda relê a primeira, e não o recebimento.
    expect(segunda.reprocessOfRunId).toBe(primeira.importRunId);

    const recebimento = (await getImportRun(ctx.db, original.importRunId))!;
    expect(recebimento.reprocessadoPor).toEqual([primeira.importRunId]);
    const primeiraLida = (await getImportRun(ctx.db, primeira.importRunId))!;
    expect(primeiraLida.reprocessadoPor).toEqual([segunda.importRunId]);
  });

  it("o run original continua exatamente como estava", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    const antes = (await getImportRun(ctx.db, original.importRunId))!;
    const celulasAntes = await contar(
      `SELECT count(*) AS n FROM raw_cell rc
         JOIN raw_row rr ON rr.id = rc.raw_row_id
         JOIN raw_sheet rs ON rs.id = rr.raw_sheet_id
        WHERE rs.import_run_id = '${original.importRunId}'`,
    );

    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "conferindo que a releitura não mexe no que já estava lá",
      requestedBy: QUEM,
    });
    await lerAteConferir(releitura.importRunId);

    const depois = (await getImportRun(ctx.db, original.importRunId))!;
    expect(depois.status).toBe(antes.status);
    expect(depois.rawCells).toBe(antes.rawCells);
    expect(depois.stagedFacts).toBe(antes.stagedFacts);
    expect(depois.snapshots).toBe(antes.snapshots);
    expect(depois.labels).toEqual(antes.labels);
    expect(depois.receivedAt.getTime()).toBe(antes.receivedAt.getTime());
    expect(depois.startedAt.getTime()).toBe(antes.startedAt.getTime());
    expect(depois.reprocessOfRunId).toBeNull();

    // As células RAW do run original continuam sendo dele, e continuam lá: a
    // camada é append-only, e a releitura escreve as suas ao lado.
    expect(
      await contar(
        `SELECT count(*) AS n FROM raw_cell rc
           JOIN raw_row rr ON rr.id = rc.raw_row_id
           JOIN raw_sheet rs ON rs.id = rr.raw_sheet_id
          WHERE rs.import_run_id = '${original.importRunId}'`,
      ),
    ).toBe(celulasAntes);
  });

  it("para em PREVIEWED: reprocessar não publica nada sozinho", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    const vigenciasAntes = await contar(
      `SELECT count(*) AS n FROM snapshot WHERE status <> 'SUPERSEDED'`,
    );
    const fatosAntes = await contar(`SELECT count(*) AS n FROM fact`);

    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "releitura que não deve publicar nada por conta própria",
      requestedBy: QUEM,
    });

    // Recém-aberto: nem lido ainda.
    let run = (await getImportRun(ctx.db, releitura.importRunId))!;
    expect(run.status).toBe("PENDING");
    expect(run.snapshots).toBe(0);

    await lerAteConferir(releitura.importRunId);

    run = (await getImportRun(ctx.db, releitura.importRunId))!;
    expect(run.status).toBe("PREVIEWED");
    expect(run.snapshots).toBe(0);
    expect(run.labels).toEqual([]);

    // Nada mudou na camada canônica sem alguém aprovar.
    expect(
      await contar(`SELECT count(*) AS n FROM snapshot WHERE status <> 'SUPERSEDED'`),
    ).toBe(vigenciasAntes);
    expect(await contar(`SELECT count(*) AS n FROM fact`)).toBe(fatosAntes);
  });

  it("relendo o mesmo conteúdo sob a mesma declaração, nada é duplicado", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    const vigenciasAntes = await contar(
      `SELECT count(*) AS n FROM snapshot WHERE status <> 'SUPERSEDED'`,
    );
    const fatosAntes = await contar(`SELECT count(*) AS n FROM fact`);

    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "releitura sem nenhuma mudança de leitor, para provar a segunda camada",
      requestedBy: QUEM,
    });
    const relatorio = await lerAteConferir(releitura.importRunId);
    await promote(ctx.db, releitura.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    // A segunda camada de defesa — a identidade canônica da vigência — vê que o
    // dado normalizado é o mesmo e não abre revisão. Aprovar uma releitura
    // desnecessária custa um run no histórico, e nada além disso.
    const run = (await getImportRun(ctx.db, releitura.importRunId))!;
    expect(run.status).toBe("SKIPPED_DUPLICATE_DATA");
    expect(
      await contar(`SELECT count(*) AS n FROM snapshot WHERE status <> 'SUPERSEDED'`),
    ).toBe(vigenciasAntes);
    expect(await contar(`SELECT count(*) AS n FROM fact`)).toBe(fatosAntes);
  });
});

// ---------------------------------------------------------------------------

describe("as travas contra o reprocessamento acidental", () => {
  it("sem motivo, ou com um motivo que não é frase, não relê", async () => {
    const original = await importar(planilhaDeCavalo(vigenciaUnica()), "CAVALO");

    await expect(
      reprocessImportRun(ctx.db, original.importRunId, { reason: "" }),
    ).rejects.toBeInstanceOf(ReprocessamentoRecusado);
    await expect(
      reprocessImportRun(ctx.db, original.importRunId, { reason: "   " }),
    ).rejects.toBeInstanceOf(ReprocessamentoRecusado);
    await expect(
      reprocessImportRun(ctx.db, original.importRunId, { reason: "sim" }),
    ).rejects.toThrow(/pelo menos/);

    // E nenhum run foi aberto por uma recusa.
    expect(
      await contar(
        `SELECT count(*) AS n FROM import_run WHERE source_file_id = '${original.sourceFileId}'`,
      ),
    ).toBe(1);
  });

  it("com uma leitura ainda aberta, o segundo pedido é recusado", async () => {
    const original = await importar(planilhaDeCavalo(vigenciaUnica()), "CAVALO");
    // `importar` para em PREVIEWED — uma leitura por decidir.
    expect((await getImportRun(ctx.db, original.importRunId))!.status).toBe("PREVIEWED");

    await expect(
      reprocessImportRun(ctx.db, original.importRunId, {
        reason: "tentando reler com uma leitura ainda em aberto",
      }),
    ).rejects.toThrow(/leitura em andamento/);

    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    // Decidida, a releitura passa.
    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "agora que a primeira leitura foi decidida, a releitura pode começar",
    });
    expect(releitura.importRunId).toBeTruthy();
  });

  it("o banco recusa a segunda leitura aberta, e não só o código", async () => {
    const original = await importar(planilhaDeCavalo(vigenciaUnica()), "CAVALO");

    // O caminho que a corrida abriria: dois INSERT sem passar pela consulta.
    await expect(
      ctx.pool.query(
        `INSERT INTO import_run (source_file_id, status, reprocess_of_run_id, reprocess_reason)
         VALUES ($1, 'PENDING', $2, 'clique duplo simulado, direto no banco')`,
        [original.sourceFileId, original.importRunId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("o índice parcial cobre exatamente os estados que o código chama de abertos", async () => {
    const { rows } = await ctx.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'import_run_leitura_aberta_uq'`,
    );
    expect(rows).toHaveLength(1);

    // A lista existe nos dois lados — o banco não importa TypeScript. O que
    // impede as duas de discordarem é esta asserção.
    const definicao = rows[0].indexdef;
    for (const estado of ESTADOS_POR_DECIDIR) {
      expect(definicao).toContain(`'${estado}'`);
    }
    const citados = definicao.match(/'[A-Z_]+'/g) ?? [];
    expect(new Set(citados.map((c) => c.replaceAll("'", "")))).toEqual(
      new Set(ESTADOS_POR_DECIDIR),
    );
  });

  /**
   * A assimetria é o desenho, e vale a pena escrevê-la.
   *
   * Quem aponta explica — apontar sem motivo é meia auditoria. Mas o motivo
   * pode sobreviver ao ponteiro, porque excluir a leitura relida é legítimo (é
   * o passo final de corrigir um arquivo lido sob o tipo errado). Exigir os
   * dois juntos faria essa exclusão ter de apagar a razão, e a releitura
   * voltaria a parecer um envio comum no histórico.
   */
  it("quem aponta explica — mas o motivo pode sobreviver ao ponteiro", async () => {
    const original = await importar(planilhaDeCavalo(vigenciaUnica()), "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    // Apontar sem dizer por quê: recusado pelo CHECK.
    await expect(
      ctx.pool.query(
        `INSERT INTO import_run (source_file_id, status, reprocess_of_run_id)
         VALUES ($1, 'PROMOTED', $2)`,
        [original.sourceFileId, original.importRunId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Motivo sem ponteiro: aceito, e é o estado de uma releitura cuja leitura
    // relida já foi excluída.
    const { rows } = await ctx.pool.query<{ id: string }>(
      `INSERT INTO import_run (source_file_id, status, reprocess_reason)
       VALUES ($1, 'PROMOTED', 'releitura cuja âncora já saiu') RETURNING id`,
      [original.sourceFileId],
    );
    const orfa = (await getImportRun(ctx.db, rows[0].id))!;
    expect(orfa.reprocessOfRunId).toBeNull();
    expect(orfa.reprocessReason).toBe("releitura cuja âncora já saiu");
  });

  /**
   * O último passo do procedimento, e ele precisa ser possível.
   *
   * Corrigir um arquivo que entrou sob o tipo errado termina em apagar a
   * importação errada — a que gravou vigência na família errada. Uma recusa de
   * exclusão "porque foi reprocessada depois" proibiria justamente o passo
   * final do procedimento que o reprocessamento existe para servir.
   */
  it("excluir a leitura relida é permitido: é o passo final da correção", async () => {
    const original = await importar(planilhaDeCavalo(vigenciaUnica()), "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });
    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "releitura para exercitar a exclusão da leitura relida",
    });
    await lerAteConferir(releitura.importRunId);

    const plano = (await planImportDeletion(ctx.db, original.importRunId))!;
    expect(plano.refusal).toBeNull();
    // Mas quem apaga é avisado de que mexe numa corrente.
    expect(plano.reprocessamentosReancorados).toEqual([releitura.importRunId]);

    await deleteImportRun(ctx.db, original.importRunId, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "importação sob o tipo errado, já corrigida pela releitura",
    });

    // A releitura sobreviveu, e continua sendo uma releitura: a âncora era a
    // cabeça da corrente e ficou nula, mas a razão — que é o fato de auditoria
    // — está lá.
    const sobreviveu = (await getImportRun(ctx.db, releitura.importRunId))!;
    expect(sobreviveu.reprocessOfRunId).toBeNull();
    expect(sobreviveu.reprocessReason).toMatch(/exercitar a exclusão/);
    expect(sobreviveu.rawCells).toBeGreaterThan(0);
  });

  it("excluir o meio da corrente reancora, em vez de deixar ponteiro órfão", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    const meio = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "releitura do meio da corrente, que será excluída depois",
    });
    const rel = await lerAteConferir(meio.importRunId);
    await promote(ctx.db, meio.importRunId, {
      confirmNewEntityTypes: rel.pendingIdentities,
    });

    const ponta = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "releitura da ponta, que deve sobreviver à exclusão do meio",
    });
    await lerAteConferir(ponta.importRunId);
    expect(ponta.reprocessOfRunId).toBe(meio.importRunId);

    await deleteImportRun(ctx.db, meio.importRunId, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "releitura intermediária desnecessária",
    });

    // A corrente se fecha por cima: a ponta passa a reler o recebimento.
    const pontaLida = (await getImportRun(ctx.db, ponta.importRunId))!;
    expect(pontaLida.reprocessOfRunId).toBe(original.importRunId);
    const recebimento = (await getImportRun(ctx.db, original.importRunId))!;
    expect(recebimento.reprocessadoPor).toEqual([ponta.importRunId]);
  });
});

// ---------------------------------------------------------------------------

describe("o histórico distingue recebimento, recusa e releitura", () => {
  it("cada um dos três se identifica sozinho, sem depender dos outros", async () => {
    const arquivo = planilhaDeCavalo(vigenciaUnica());
    const original = await importar(arquivo, "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });
    const duplicada = await importar(arquivo, "CAVALO");
    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "o leitor aprendeu a coluna nova, e este arquivo precisa ser relido",
      requestedBy: QUEM,
    });
    await lerAteConferir(releitura.importRunId);

    const recebimento = (await getImportRun(ctx.db, original.importRunId))!;
    const recusada = (await getImportRun(ctx.db, duplicada.importRunId))!;
    const relida = (await getImportRun(ctx.db, releitura.importRunId))!;

    // 1. O recebimento: não relê ninguém, e sabe que foi relido.
    expect(recebimento.reprocessOfRunId).toBeNull();
    expect(recebimento.reprocessReason).toBeNull();
    expect(recebimento.reprocessadoPor).toEqual([releitura.importRunId]);

    // 2. A tentativa recusada: nem releitura nem recebimento — nada foi aberto.
    expect(recusada.status).toBe("SKIPPED_DUPLICATE");
    expect(recusada.reprocessOfRunId).toBeNull();
    expect(recusada.reprocessadoPor).toEqual([]);
    expect(recusada.rawCells).toBe(0);

    // 3. A releitura: diz de quem é releitura e por quê.
    expect(relida.reprocessOfRunId).toBe(original.importRunId);
    expect(relida.reprocessReason).toMatch(/o leitor aprendeu a coluna nova/);
    expect(relida.reprocessadoPor).toEqual([]);
    expect(relida.rawCells).toBeGreaterThan(0);

    // Os três são leituras do mesmo arquivo, e os três sabem disso.
    for (const run of [recebimento, recusada, relida]) {
      expect(run.contentSha256).toBe(original.contentSha256);
      expect(run.leiturasDoArquivo).toBe(3);
    }
  });

  it("a listagem traz os três campos, para a tela não precisar de outra consulta", async () => {
    const runs = await listImportRuns(ctx.db);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run).toHaveProperty("reprocessOfRunId");
      expect(run).toHaveProperty("reprocessReason");
      expect(run).toHaveProperty("reprocessadoPor");
      expect(run).toHaveProperty("leiturasDoArquivo");
    }
    expect(runs.some((r) => r.reprocessOfRunId !== null)).toBe(true);
  });

  it("a decisão do reprocessamento fica gravada, com o motivo", async () => {
    const original = await importar(planilhaDeCavalo(vigenciaUnica()), "CAVALO");
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });
    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "motivo que precisa sobreviver na auditoria",
      requestedBy: QUEM,
    });

    const { rows } = await ctx.pool.query<{ decisao: string; motivo: string }>(
      `SELECT decisao, motivo FROM import_decision WHERE import_run_id = $1`,
      [releitura.importRunId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].decisao).toBe("REPROCESSAMENTO");
    expect(rows[0].motivo).toMatch(/motivo que precisa sobreviver na auditoria/);
  });
});

// ---------------------------------------------------------------------------

describe("o caso do QLP: relido, ele passa a existir para a tela do quadro", () => {
  /**
   * A história inteira, na ordem em que aconteceu.
   *
   * Um arquivo de QLP Administrativo entra **sem declaração** — a aba da tela
   * ainda não existia. O leitor acha o grão (vigência + unidade + cargo) e
   * produz fatos, então nada parece errado: o cartão diz "aprovada", com
   * número. Só que o tipo, sem declaração, sai do **nome da aba**, e daí sai a
   * família do dataset: `datasetFamilyFor` não reconhece o tipo deduzido e cai
   * no padrão, REMUNERACAO_EQUIPAMENTO.
   *
   * A tela de QLP lê só a família QUADRO_DE_PESSOAL. Resultado: importação
   * aprovada, fatos no banco, e "Nenhuma vigência de QLP Administrativo foi
   * importada" na tela — com o arquivo trancado pelo sha, sem como reenviá-lo.
   */
  it("sem declaração, o QLP é promovido na família errada e a tela não o vê", async () => {
    const vigencia = vigenciaUnica();
    const original = await importar(planilhaDeQlpAdm(vigencia));
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    const familias = await ctx.pool.query<{ dataset_family: string }>(
      `SELECT DISTINCT dataset_family FROM snapshot WHERE import_run_id = $1`,
      [original.importRunId],
    );
    expect(familias.rows.map((r) => r.dataset_family)).toEqual([
      "REMUNERACAO_EQUIPAMENTO",
    ]);

    // O que a tela do quadro de pessoal enxerga desta importação: nada.
    expect(
      await contar(
        `SELECT count(*) AS n FROM snapshot
          WHERE import_run_id = '${original.importRunId}'
            AND dataset_family = '${DATASET_FAMILY_QUADRO_DE_PESSOAL}'`,
      ),
    ).toBe(0);

    // E reenviar não é saída: o sha barra antes de abrir.
    const reenvio = await importar(
      planilhaDeQlpAdm(vigencia),
      "QLP_ADMINISTRATIVO",
    );
    // (a planilha é reescrita, então só o conteúdo idêntico casa — o que casa é
    // o reenvio do mesmo arquivo, abaixo)
    expect(reenvio).toBeTruthy();
  });

  it("reprocessado com a declaração certa, ele passa a gerar QUADRO_DE_PESSOAL", async () => {
    const vigencia = vigenciaUnica();
    const arquivo = planilhaDeQlpAdm(vigencia);

    // 1. Como entrou na época: sem declaração.
    const original = await importar(arquivo);
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });

    expect(
      await contar(
        `SELECT count(*) AS n FROM snapshot
          WHERE dataset_family = '${DATASET_FAMILY_QUADRO_DE_PESSOAL}'
            AND source_label = '${vigencia}'`,
      ),
    ).toBe(0);

    // 2. O reenvio, depois que a aba passou a existir: barrado pelo sha.
    const reenvio = await importar(arquivo, "QLP_ADMINISTRATIVO");
    expect(reenvio.isDuplicate).toBe(true);
    expect((await getImportRun(ctx.db, reenvio.importRunId))!.rawCells).toBe(0);

    // 3. A saída que este trabalho abre: reler o mesmo arquivo, declarando o
    //    que ele é. Sem excluir nada, sem reenviar bytes.
    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "o leitor passou a reconhecer o grão do QLP Administrativo",
      requestedBy: QUEM,
      declaredType: "QLP_ADMINISTRATIVO",
    });
    expect(releitura.declaredType).toBe("QLP_ADMINISTRATIVO");

    const relatorio = await lerAteConferir(releitura.importRunId);
    expect(relatorio.totals.stagedFacts).toBeGreaterThan(0);

    // Aprovar continua sendo decisão de quem opera — e é só aqui que a tela
    // passa a ter o que mostrar.
    await promote(ctx.db, releitura.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    const { rows } = await ctx.pool.query<{
      dataset_family: string;
      entity_type_set: string;
      status: string;
    }>(
      `SELECT dataset_family, entity_type_set, status
         FROM snapshot WHERE import_run_id = $1`,
      [releitura.importRunId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset_family).toBe(DATASET_FAMILY_QUADRO_DE_PESSOAL);
    expect(rows[0].entity_type_set).toContain("QLP_ADMINISTRATIVO");
    expect(rows[0].status).toBe("CLOSED");

    // O recebimento original continua onde estava, com o que ele produziu.
    const antes = (await getImportRun(ctx.db, original.importRunId))!;
    expect(antes.status).toBe("PROMOTED");
    expect(antes.stagedFacts).toBeGreaterThan(0);
    expect(antes.reprocessadoPor).toEqual([releitura.importRunId]);
  });

  it("a releitura em outra família não supersede a vigência antiga — ela fica, e é excluível", async () => {
    const vigencia = vigenciaUnica();
    const arquivo = planilhaDeQlpAdm(vigencia);

    const original = await importar(arquivo);
    await promote(ctx.db, original.importRunId, {
      confirmNewEntityTypes: original.relatorio!.pendingIdentities,
    });
    const releitura = await reprocessImportRun(ctx.db, original.importRunId, {
      reason: "declarando o tipo certo, que muda a família do dataset",
      declaredType: "QLP_ADMINISTRATIVO",
    });
    const relatorio = await lerAteConferir(releitura.importRunId);
    await promote(ctx.db, releitura.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    /*
      A consequência que precisa estar escrita, porque ela não é óbvia.

      A identidade de uma vigência inclui a **família**. Reler declarando outro
      tipo muda a família, e com ela a identidade: a vigência nova não é revisão
      da antiga, é outra vigência. As duas ficam ativas, cada uma na sua família.

      Isso é o certo para a tela do QLP — ela lê a família dela e vê o número
      certo — e é o errado para quem somar a família de equipamento, onde o
      quadro de pessoal nunca deveria ter entrado. O reprocessamento não apaga o
      engano anterior: ele acrescenta a leitura correta ao lado, e a limpeza do
      que estava errado continua sendo exclusão, que é uma decisão explícita.
    */
    const ativas = await ctx.pool.query<{ dataset_family: string }>(
      `SELECT dataset_family FROM snapshot
        WHERE source_label = $1 AND status <> 'SUPERSEDED'
        ORDER BY dataset_family`,
      [vigencia],
    );
    expect(ativas.rows.map((r) => r.dataset_family)).toEqual([
      "QUADRO_DE_PESSOAL",
      "REMUNERACAO_EQUIPAMENTO",
    ]);

    // E a saída para o engano antigo está aberta: a importação que gravou na
    // família errada pode ser excluída agora que a releitura certa foi
    // aprovada. É o passo final do procedimento, e ele não é recusado.
    const plano = (await planImportDeletion(ctx.db, original.importRunId))!;
    expect(plano.refusal).toBeNull();
    expect(plano.labels.length).toBeGreaterThan(0);

    await deleteImportRun(ctx.db, original.importRunId, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "vigência gravada na família errada, já corrigida pela releitura",
    });

    // Sobra uma vigência ativa, na família certa.
    const restantes = await ctx.pool.query<{ dataset_family: string }>(
      `SELECT dataset_family FROM snapshot
        WHERE source_label = $1 AND status <> 'SUPERSEDED'`,
      [vigencia],
    );
    expect(restantes.rows.map((r) => r.dataset_family)).toEqual([
      "QUADRO_DE_PESSOAL",
    ]);
  });
});
