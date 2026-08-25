import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, justificativaTable } from "@workspace/db";

const DEFAULT_ACTOR = "sistema";

/**
 * Plano de Ação — Justificativas.
 *
 * A tela lê `/changes/latest` (mesma rota da aba Planilha de Alterações) para
 * saber o que mudou, agrupa por placa no cliente e usa esta rota só para o
 * que é próprio dela: a justificativa que o gestor escreveu sobre cada placa,
 * dentro de uma comparação (`changeSetId`).
 */
const router: IRouter = Router();

/** As justificativas de uma comparação, uma por placa — sempre a mais recente. */
router.get("/justificativas", async (req, res): Promise<void> => {
  const changeSetId =
    typeof req.query.changeSetId === "string" ? req.query.changeSetId : undefined;
  if (!changeSetId) {
    res.status(400).json({ error: "changeSetId é obrigatório." });
    return;
  }

  const rows = await db
    .select()
    .from(justificativaTable)
    .where(eq(justificativaTable.changeSetId, changeSetId))
    .orderBy(desc(justificativaTable.criadoEm));

  // Uma placa pode ter sido justificada mais de uma vez; a tela mostra só a
  // mais recente, e a lista já vem ordenada da mais nova para a mais antiga.
  const porPlaca = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!porPlaca.has(row.entityLabel)) porPlaca.set(row.entityLabel, row);
  }

  res.json({ justificativas: [...porPlaca.values()] });
});

/**
 * Justificar uma ou mais placas de uma vez — o mesmo texto vale para todas as
 * selecionadas, uma linha por placa.
 */
router.post("/justificativas", async (req, res): Promise<void> => {
  const changeSetId =
    typeof req.body?.changeSetId === "string" ? req.body.changeSetId : undefined;
  const entityLabels = Array.isArray(req.body?.entityLabels)
    ? req.body.entityLabels.filter((v: unknown): v is string => typeof v === "string" && v !== "")
    : [];
  const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";

  if (!changeSetId) {
    res.status(400).json({ error: "changeSetId é obrigatório." });
    return;
  }
  if (entityLabels.length === 0) {
    res.status(400).json({ error: "Selecione ao menos uma placa." });
    return;
  }
  if (texto === "") {
    res.status(400).json({ error: "A justificativa não pode ficar em branco." });
    return;
  }

  const entityType =
    typeof req.body?.entityType === "string" && req.body.entityType !== ""
      ? req.body.entityType
      : null;
  const criadoPor = req.user?.email ?? DEFAULT_ACTOR;

  const inseridas = await db
    .insert(justificativaTable)
    .values(
      entityLabels.map((entityLabel: string) => ({
        changeSetId,
        entityLabel,
        entityType,
        texto,
        criadoPor,
      })),
    )
    .returning();

  res.status(201).json({ justificativas: inseridas });
});

export default router;
