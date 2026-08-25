import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, changeTable, justificativaTable } from "@workspace/db";
import {
  iniciarFase,
  instrumentarCicloDaRequisicao,
} from "../lib/observabilidade";

const DEFAULT_ACTOR = "sistema";

/**
 * Plano de Ação — Justificativas.
 *
 * A tela lê `/changes/latest` (mesma rota da aba Planilha de Alterações) para
 * saber o que mudou, agrupa por placa no cliente e usa esta rota só para o
 * que é próprio dela: a justificativa que o gestor escreveu sobre cada
 * alteração (`change.id`), dentro de uma comparação (`changeSetId`).
 */
const router: IRouter = Router();

router.use("/justificativas", instrumentarCicloDaRequisicao);

/** As justificativas de uma comparação, uma por alteração — sempre a mais recente. */
router.get("/justificativas", async (req, res): Promise<void> => {
  const changeSetId =
    typeof req.query.changeSetId === "string"
      ? req.query.changeSetId
      : undefined;
  if (!changeSetId) {
    res.status(400).json({ error: "changeSetId é obrigatório." });
    return;
  }

  const faseSelect = iniciarFase(req, "db.select");
  const rows = await db
    .select()
    .from(justificativaTable)
    .where(eq(justificativaTable.changeSetId, changeSetId))
    .orderBy(desc(justificativaTable.criadoEm));
  faseSelect.fim({ linhas: rows.length });

  // Uma alteração pode ter sido justificada mais de uma vez; a tela mostra só
  // a mais recente, e a lista já vem ordenada da mais nova para a mais antiga.
  const porAlteracao = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (!porAlteracao.has(row.changeId)) porAlteracao.set(row.changeId, row);
  }

  res.json({ justificativas: [...porAlteracao.values()] });
});

/**
 * Justificar uma ou mais alterações de uma vez — o mesmo texto vale para
 * todas as selecionadas, uma linha por alteração.
 */
router.post("/justificativas", async (req, res): Promise<void> => {
  const changeSetId =
    typeof req.body?.changeSetId === "string"
      ? req.body.changeSetId
      : undefined;
  const changeIds = Array.isArray(req.body?.changeIds)
    ? req.body.changeIds.filter(
        (v: unknown): v is number => typeof v === "number" && Number.isFinite(v),
      )
    : [];
  const texto =
    typeof req.body?.texto === "string" ? req.body.texto.trim() : "";

  if (!changeSetId) {
    res.status(400).json({ error: "changeSetId é obrigatório." });
    return;
  }
  if (changeIds.length === 0) {
    res.status(400).json({ error: "Selecione ao menos uma alteração." });
    return;
  }
  if (texto === "") {
    res
      .status(400)
      .json({ error: "A justificativa não pode ficar em branco." });
    return;
  }

  const criadoPor = req.user?.email ?? DEFAULT_ACTOR;

  // `entity_label`/`entity_type` vêm de `change`, não do corpo da requisição:
  // o cliente não é fonte confiável para o que fica gravado como auditoria, e
  // o filtro por `changeSetId` garante que só alterações desta comparação
  // entram, mesmo que o cliente mande um id de outra.
  const faseChanges = iniciarFase(req, "db.select.changes");
  const changes: { id: number; entityLabel: string | null; entityType: string | null }[] =
    await db
      .select({
        id: changeTable.id,
        entityLabel: changeTable.entityLabel,
        entityType: changeTable.entityType,
      })
      .from(changeTable)
      .where(
        and(
          eq(changeTable.changeSetId, changeSetId),
          inArray(changeTable.id, changeIds),
        ),
      );
  faseChanges.fim({ linhas: changes.length });

  if (changes.length === 0) {
    res
      .status(400)
      .json({ error: "Nenhuma das alterações selecionadas pertence a esta comparação." });
    return;
  }

  const faseInsert = iniciarFase(req, "db.insert");
  const inseridas = await db
    .insert(justificativaTable)
    .values(
      changes.map((change) => ({
        changeSetId,
        changeId: change.id,
        entityLabel: change.entityLabel ?? "",
        entityType: change.entityType,
        texto,
        criadoPor,
      })),
    )
    .returning();
  faseInsert.fim({ linhas: inseridas.length });

  res.status(201).json({ justificativas: inseridas });
});

export default router;
