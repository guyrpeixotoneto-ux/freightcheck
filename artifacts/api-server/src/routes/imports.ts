import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  captureRaw,
  deleteImportRun,
  ensureImportStorageDir,
  getImportRun,
  getImportRunSheets,
  getImportRunSnapshots,
  getImportRunStatus,
  ImportDeletionRefused,
  listImportDeletions,
  listImportRuns,
  markRunFailed,
  planImportDeletion,
  preview,
  promote,
  stage,
  receiveFile,
} from "@workspace/ingest";

/**
 * Importações (F1) — receber um arquivo, contar o que saiu dele, e só então
 * deixar alguém aprovar.
 *
 * A ordem importa: nada aqui escreve na camada canônica exceto
 * POST /imports/:id/promote, e ele exige um run já conferido (PREVIEWED). Ler
 * o arquivo e promovê-lo são dois pedidos separados porque entre eles existe
 * uma decisão humana — é essa separação que o pipeline chama de preview.
 */
const router: IRouter = Router();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quem enviou é quem está logado — toda rota daqui exige sessão.
 *
 * O nome vinha do corpo do pedido, o que fazia o histórico registrar o que o
 * cliente dissesse. Este padrão sobrou para o caso de a sessão não estar lá, o
 * que hoje o middleware impede; um `upload` no histórico é sinal de que alguém
 * abriu uma exceção no portão.
 */
const DEFAULT_ACTOR = "upload";

export type DecodedUpload = { filename: string; bytes: Buffer };

export type DecodeResult =
  | { ok: true; value: DecodedUpload }
  | { ok: false; error: string };

/**
 * O corpo do upload, conferido antes de virar arquivo em disco.
 *
 * Cada recusa aqui existe porque a alternativa é pior: sem o filtro de base64,
 * `Buffer.from` descarta em silêncio o que não reconhece e entrega um zip
 * truncado; sem a assinatura "PK", um .xlsx que na verdade é um CSV renomeado
 * só falharia lá dentro do leitor, com uma mensagem sobre estrutura de zip que
 * não ajuda ninguém a entender que mandou o arquivo errado.
 */
export function decodeUpload(body: unknown): DecodeResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Envie um JSON com filename e contentBase64." };
  }
  const { filename, contentBase64 } = body as Record<string, unknown>;

  if (typeof filename !== "string" || filename.trim() === "") {
    return { ok: false, error: "filename é obrigatório." };
  }
  // basename: o nome vem do cliente e é gravado como veio. Um "../" dentro
  // dele nunca chega a tocar em caminho nenhum aqui, mas também não precisa
  // existir no registro.
  const safeName = path.basename(filename.trim());
  if (!safeName.toLowerCase().endsWith(".xlsx")) {
    return {
      ok: false,
      error: `Só lemos .xlsx, e "${safeName}" não é um. Exporte a planilha do Freightec nesse formato.`,
    };
  }

  if (typeof contentBase64 !== "string" || contentBase64.trim() === "") {
    return { ok: false, error: "contentBase64 é obrigatório." };
  }
  const encoded = contentBase64.trim();
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(encoded)) {
    return { ok: false, error: "contentBase64 não está em base64 válido." };
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) {
    return { ok: false, error: "O arquivo chegou vazio." };
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      ok: false,
      error: `"${safeName}" não é uma planilha do Excel: o conteúdo não começa como um arquivo .xlsx. Confira se o que foi enviado é mesmo o export, e não um CSV renomeado.`,
    };
  }

  return { ok: true, value: { filename: safeName, bytes } };
}

/**
 * Por que este run não pode ser aprovado agora.
 *
 * O pipeline recusa com a frase dele — "run X is PROMOTED; this step requires
 * PREVIEWED" —, que é exata e serve para quem depura. Na tela quem lê é quem
 * opera, e a pergunta que essa pessoa tem é outra: já entrou? deu errado?
 * ainda está lendo? Cada estado responde a uma delas.
 */
export function whyCannotPromote(status: string): string | null {
  switch (status) {
    case "PREVIEWED":
      return null;
    case "PENDING":
    case "READING":
    case "STAGED":
      return "O arquivo ainda está sendo lido. Espere o resumo aparecer antes de aprovar.";
    case "PROMOTING":
      return "Esta importação já está sendo aprovada neste momento.";
    case "PROMOTED":
      return "Esta importação já foi aprovada; os dados dela já estão no sistema.";
    case "FAILED":
      return "Esta importação falhou ao ser lida, então não há o que aprovar. Corrija a origem e envie o arquivo de novo.";
    case "SKIPPED_DUPLICATE":
      return "Este arquivo foi recusado como duplicata: o conteúdo já havia entrado antes. Não há o que aprovar.";
    case "ABORTED":
      return "Esta importação foi abortada. Envie o arquivo de novo para recomeçar.";
    default:
      return `Esta importação está em ${status.toLowerCase()} e só pode ser aprovada depois de conferida.`;
  }
}

/**
 * Ler o arquivo até o preview, fora do ciclo da requisição.
 *
 * São dezenas de milhares de células: manter a conexão aberta até o fim daria
 * timeout no proxy antes de dar resposta. O cliente recebe o id na hora e
 * pergunta o estado por /status — e qualquer falha vira FAILED com motivo, em
 * vez de um run parado para sempre em READING.
 */
async function readInBackground(
  importRunId: string,
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    await captureRaw(db, importRunId);
    await stage(db, importRunId);
    await preview(db, importRunId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    log.error({ err, importRunId }, "Import pipeline failed");
    try {
      await markRunFailed(db, importRunId, message);
    } catch (markErr) {
      // Se nem isso foi possível, o banco é que está fora. O run fica no
      // estado em que parou; o log é o único lugar onde isso ainda pode ser
      // visto.
      log.error({ err: markErr, importRunId }, "Could not mark run as failed");
    }
  }
}

router.get("/imports", async (req, res): Promise<void> => {
  try {
    res.json(await listImportRuns(db));
  } catch (err) {
    req.log.error({ err }, "Error listing import runs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/imports", async (req, res): Promise<void> => {
  const decoded = decodeUpload(req.body);
  if (!decoded.ok) {
    res.status(400).json({ error: decoded.error });
    return;
  }

  try {
    const { filename, bytes } = decoded.value;
    // O nome em disco é o próprio sha256: dois envios do mesmo conteúdo
    // apontam para o mesmo arquivo, e nomes vindos do cliente nunca viram
    // caminho.
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const filePath = path.join(
      ensureImportStorageDir(),
      `${contentSha256}.xlsx`,
    );
    writeFileSync(filePath, bytes);

    const received = await receiveFile(db, {
      filePath,
      filename,
      receivedBy: req.user?.email ?? DEFAULT_ACTOR,
    });

    if (received.isDuplicate) {
      // A tentativa fica registrada como SKIPPED_DUPLICATE — recusar não é
      // esquecer. O motivo já foi escrito pelo pipeline, para quem opera.
      const run = await getImportRunStatus(db, received.importRunId);
      res.status(409).json({
        error:
          run?.failureReason ??
          `Este arquivo já havia sido recebido (sha256 ${contentSha256.slice(0, 16)}…).`,
        importRunId: received.importRunId,
      });
      return;
    }

    res.status(202).json({
      importRunId: received.importRunId,
      contentSha256: received.contentSha256,
      status: "PENDING",
    });

    void readInBackground(received.importRunId, req.log);
  } catch (err) {
    req.log.error({ err }, "Error receiving import");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/imports/:id/status", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const status = await getImportRunStatus(db, req.params.id);
    if (!status) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    res.json(status);
  } catch (err) {
    req.log.error({ err }, "Error loading import run status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/imports/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const run = await getImportRun(db, req.params.id);
    if (!run) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    const [sheets, snapshots] = await Promise.all([
      getImportRunSheets(db, req.params.id),
      getImportRunSnapshots(db, req.params.id),
    ]);
    res.json({ run, sheets, snapshots });
  } catch (err) {
    req.log.error({ err }, "Error loading import run detail");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/imports/:id/promote", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    // O estado é conferido antes para que a recusa mais comum — aprovar duas
    // vezes, com dois cliques ou duas abas — volte em português e como 409,
    // e não como a frase interna do pipeline dentro de um 422.
    const current = await getImportRunStatus(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    const refusal = whyCannotPromote(current.status);
    if (refusal) {
      res.status(409).json({ error: refusal });
      return;
    }

    // Equipamento novo é declaração de quem promove, nunca efeito colateral de
    // um nome de aba: a lista chega do corpo do pedido, o pipeline recusa o
    // que não estiver nela, e o que sobra é a frase que a tela mostra.
    const confirmNewEntityTypes = Array.isArray(req.body?.confirmNewEntityTypes)
      ? (req.body.confirmNewEntityTypes as unknown[])
          .filter((t): t is string => typeof t === "string" && t.trim() !== "")
          .map((t) => t.trim().toUpperCase())
      : undefined;

    const result = await promote(db, req.params.id, {
      // Reimportar a mesma vigência é uma correção, e correção se declara:
      // o padrão recusa, e só quem pede NEW_REVISION escreve a revisão N+1.
      onExistingSnapshot:
        req.body?.onExistingSnapshot === "NEW_REVISION" ? "NEW_REVISION" : "FAIL",
      promotedBy: req.user?.email ?? DEFAULT_ACTOR,
      confirmNewEntityTypes,
    });
    res.json(result);
  } catch (err) {
    // Recusas de regra — o run ainda não foi conferido, ou a vigência já
    // existe — são escritas para quem opera e chegam inteiras à tela, em vez
    // de virarem um 500 mudo. A transação já desfez o que tinha começado.
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Promotion refused");
    res.status(422).json({ error: message });
  }
});

/**
 * O que a exclusão tiraria, antes de tirar.
 *
 * A pergunta "tem certeza?" não é responsável por si só: quem está na tela não
 * tem como saber que aquele arquivo sustenta nove vigências e quarenta mil
 * fatos. Esta rota é o que transforma a confirmação numa decisão — e é a mesma
 * conta que a exclusão vai fazer, escrita uma vez só em `planImportDeletion`.
 */
router.get("/imports/:id/deletion", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const plan = await planImportDeletion(db, req.params.id);
    if (!plan) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    res.json(plan);
  } catch (err) {
    req.log.error({ err }, "Error planning import deletion");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Excluir uma importação.
 *
 * Quem exclui é quem está logado, e o nome vai para `import_deletion` junto com
 * o que saiu — o registro sobrevive ao dado, que é a única forma de "isto foi
 * apagado" continuar sendo uma afirmação verificável depois.
 *
 * As recusas — um run ainda sendo lido, uma vigência corrigida por importação
 * posterior — voltam como 409 com a frase inteira. Não são erros do servidor:
 * são a ordem em que as coisas podem ser desfeitas.
 */
router.delete("/imports/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const motivo =
      typeof req.body?.reason === "string" && req.body.reason.trim() !== ""
        ? req.body.reason.trim()
        : null;

    const result = await deleteImportRun(db, req.params.id, {
      deletedBy: req.user?.email ?? DEFAULT_ACTOR,
      reason: motivo,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ImportDeletionRefused) {
      const notFound = err.message.includes("não encontrada");
      req.log.warn({ err, importRunId: req.params.id }, "Deletion refused");
      res.status(notFound ? 404 : 409).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Error deleting import run");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** O histórico das exclusões — o que já não está mais aqui, e por ordem de quem. */
router.get("/import-deletions", async (req, res): Promise<void> => {
  try {
    res.json(await listImportDeletions(db));
  } catch (err) {
    req.log.error({ err }, "Error listing import deletions");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
