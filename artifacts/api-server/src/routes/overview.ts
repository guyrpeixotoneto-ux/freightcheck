import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { importRunTable, stagedFactTable } from "@workspace/db";
import {
  captureRaw,
  getImportRunSheets,
  getImportRunSnapshots,
  listImportRuns,
  preview,
  receiveFile,
  stage,
} from "@workspace/ingest";
import { getOverview } from "@workspace/comparison";
import { classificarFalha } from "../lib/classificar-falha";

/** O motivo gravado num run cuja causa não se sabe explicar a quem opera. */
const MOTIVO_INESPERADO =
  "Não foi possível concluir a importação. O estado do banco está em " +
  "/api/healthz.";

/**
 * Read-only views over what the system already holds: the panel, the import
 * history, and the sheets behind a given run.
 *
 * Nothing here forecasts or annualises. These pages exist so the locked menu
 * items could be opened honestly rather than merely unlocked.
 */
const router: IRouter = Router();

router.get("/overview", async (req, res): Promise<void> => {
  res.json(await getOverview(db));
});

router.get("/imports", async (req, res): Promise<void> => {
  res.json(await listImportRuns(db));
});

router.get("/imports/:id", async (req, res): Promise<void> => {
  const [sheets, snapshots] = await Promise.all([
    getImportRunSheets(db, req.params.id),
    getImportRunSnapshots(db, req.params.id),
  ]);
  res.json({ sheets, snapshots });
});

/**
 * Upload, then process in the background.
 *
 * Two things this route learned the hard way.
 *
 * The first: capturing 43k cells, staging and previewing takes about seven
 * seconds, and holding an HTTP connection open that long is asking a proxy to
 * cut it. So the request returns as soon as the bytes are safely in RAW and the
 * rest runs detached; the client polls the run's status.
 *
 * The second: the bytes arrive as base64 inside a JSON body. The first version
 * sent them as `application/octet-stream` to avoid a multipart dependency, and
 * the platform's proxy answered 502 without ever reaching this code. A JSON
 * POST is the most boring request on the web and no proxy refuses it; the 33%
 * base64 overhead on a 200 KB workbook is not worth a transport nobody
 * supports.
 *
 * Nothing reaches the canonical layer either way: promotion is a separate,
 * deliberate call.
 */
router.post(
  "/imports",
  async (req, res, next): Promise<void> => {
    try {
      const { filename, contentBase64 } = (req.body ?? {}) as {
        filename?: string;
        contentBase64?: string;
      };

      if (!filename || !filename.toLowerCase().endsWith(".xlsx")) {
        res.status(415).json({
          error: `"${filename ?? "arquivo"}" não é .xlsx. O Freightec entrega planilhas Excel.`,
        });
        return;
      }
      if (!contentBase64) {
        res.status(400).json({ error: "Arquivo vazio ou não recebido." });
        return;
      }

      const bytes = Buffer.from(contentBase64, "base64");
      if (bytes.length === 0) {
        res.status(400).json({ error: "Arquivo vazio depois de decodificado." });
        return;
      }

      const scratch = mkdtempSync(path.join(tmpdir(), "freightcheck-"));
      const filePath = path.join(scratch, `${randomUUID()}.xlsx`);
      writeFileSync(filePath, bytes);

      const received = await receiveFile(db, {
        filePath,
        filename,
        receivedBy: "upload",
      });

      if (received.isDuplicate) {
        res.status(409).json({
          error:
            `Este arquivo já foi importado — o conteúdo tem o mesmo SHA-256 de um envio ` +
            `anterior. Reenviar o mesmo conteúdo não gera vigência nova.`,
          duplicate: true,
        });
        return;
      }

      // Answer now; keep working after.
      res.json({ importRunId: received.importRunId, filename, status: "RECEIVED" });

      const runId = received.importRunId;
      void (async () => {
        try {
          await captureRaw(db, runId);
          await stage(db, runId);
          await preview(db, runId);
        } catch (err) {
          /*
            O motivo fica gravado, e gravado é para sempre: `failureReason` é
            campo de leitura humana, e o `err.message` de uma falha de banco ali
            é pior do que numa resposta HTTP — a resposta passa, o campo fica.
          */
          const desfecho = classificarFalha(err);
          const message =
            desfecho.tipo === "REGRA" ? desfecho.mensagem : MOTIVO_INESPERADO;
          try {
            await db
              .update(importRunTable)
              .set({ status: "FAILED", failureReason: message })
              .where(eq(importRunTable.id, runId));
          } catch {
            // Recording the failure failed too. Swallowing is deliberate: an
            // unhandled rejection here would take the whole server down, and a
            // lost error message is a smaller problem than a dead process.
          }
        }
      })();
    } catch (err) {
      /*
        422 é para a recusa que se escreve a quem envia. Uma falha de banco
        chegava aqui como 422 com a consulta do drizzle dentro — o número
        dizendo que o defeito era do arquivo, e o corpo mostrando SQL.
      */
      const desfecho = classificarFalha(err);
      if (desfecho.tipo !== "REGRA") {
        next(err);
        return;
      }
      req.log.warn({ err }, "Upload refused");
      if (!res.headersSent) res.status(422).json({ error: desfecho.mensagem });
    }
  },
);

/** Where a run is, and its preview once there is one. */
router.get("/imports/:id/status", async (req, res): Promise<void> => {
  const [run] = await db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, req.params.id));
  if (!run) {
    res.status(404).json({ error: "Importação não encontrada." });
    return;
  }

  const snapshots =
    run.status === "PREVIEWED" || run.status === "PROMOTED"
      ? await getImportRunSnapshotLabels(db, run.id)
      : [];

  res.json({
    importRunId: run.id,
    status: run.status,
    failureReason: run.failureReason,
    sheets: run.rawSheetCount,
    rawCells: run.rawCellCount,
    facts: run.stagedFactCount,
    snapshots: run.snapshotCount,
    errors: run.errorCount,
    warnings: run.warningCount,
    labels: snapshots,
  });
});

/*
  Havia aqui um segundo `POST /imports/:id/promote`.

  Ele promovia e então semeava a taxonomia, rodava a passada de proposta,
  aplicava as confirmações e disparava as comparações que faltavam — tudo o que
  faz uma base recém-importada ficar utilizável. E **nunca rodava**:
  `routes/index.ts` monta `importsRouter` antes de `overviewRouter`, e o Express
  serve a primeira rota que casa. Medido em 17/08/2026, chamando a rota pelo
  router real: a resposta é a de `imports.ts`, e a taxonomia fica com zero nós.

  Um caminho aparente é pior que caminho nenhum — quem lesse este arquivo
  concluiria que a curadoria é atualizada a cada promoção, e foi essa leitura
  que deixou o defeito passar. O que ele prometia agora é verdade, e é feito
  onde se pode garantir: dentro da transação de `promote`, em
  `lib/ingest/src/pipeline.ts` — semântica inicial, árvore da taxonomia e
  confirmações canônicas, nessa ordem. A passada de proposta continua fora, por
  ser inferência e não estrutura.
*/

/** Vigência labels a run has staged, for the preview card. */
async function getImportRunSnapshotLabels(
  database: typeof db,
  importRunId: string,
): Promise<string[]> {
  const rows = await database
    .selectDistinct({ label: stagedFactTable.snapshotLabel })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId))
    .orderBy(stagedFactTable.snapshotLabel);
  return rows.map((r) => r.label);
}

export default router;
