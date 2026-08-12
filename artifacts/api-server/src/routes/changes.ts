import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import {
  computeChangeSet,
  findPreviousSnapshot,
  getAttributeSeries,
  getChangeProvenance,
  getChangeSetBreakdown,
  getChangeSetForPair,
  getFamiliesView,
  getGroupedView,
  getGroupVehicles,
  FREIGHTECH_SEM_DADO,
  listChangeSets,
  listChanges,
  listComparableSnapshots,
  getConsolidated,
  listContexts,
  listPeriods,
  ContextNotFoundError,
  type ChangeFilters,
  type SeriesContext,
} from "@workspace/comparison";

/**
 * Alterações e Comparar (F3).
 *
 * `/changes/latest` answers the one question the product exists for — what
 * changed since the previous vigência — without the caller having to know
 * which snapshot that was.
 */
const router: IRouter = Router();

function parseFilters(query: Record<string, unknown>): ChangeFilters {
  const str = (key: string) =>
    typeof query[key] === "string" && query[key] !== "" ? (query[key] as string) : undefined;
  const num = (key: string) => {
    const value = str(key);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    costClass: str("costClass"),
    changeType: str("changeType"),
    category: str("category"),
    semanticsStatus: str("semanticsStatus"),
    comparability: str("comparability"),
    impactConfidence: str("impactConfidence"),
    attributeCode: str("attributeCode"),
    entityLabel: str("entityLabel"),
    search: str("search"),
    minAbsImpact: num("minAbsImpact"),
    limit: num("limit"),
    offset: num("offset"),
  };
}

/**
 * O contexto pedido na query, quando pedido.
 *
 * `scopeHash` sozinho basta; `canal` é aceito junto para quando a mesma unidade
 * entregar em mais de um canal. Nada pedido significa "o mais recente", e a
 * resposta diz qual foi — ver `GroupedView.context`.
 */
function parseContext(query: Record<string, unknown>): Partial<SeriesContext> | undefined {
  const scopeHash = typeof query.scopeHash === "string" && query.scopeHash !== ""
    ? query.scopeHash
    : undefined;
  const hasCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !hasCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    // `?canal=` vazio quer dizer "as vigências sem canal legível no rótulo",
    // que é uma partição real e não a ausência de filtro.
    ...(hasCanal ? { channel: (query.canal as string) === "" ? null : (query.canal as string) } : {}),
  };
}

/** Recusa escrita vira 404 com a frase; o resto continua sendo 500. */
function sendContextError(res: Response, err: unknown): boolean {
  if (err instanceof ContextNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
}

/** As unidades e canais que já entregaram vigência — o seletor de contexto. */
router.get("/contexts", async (req, res): Promise<void> => {
  try {
    res.json(await listContexts(db));
  } catch (err) {
    req.log.error({ err }, "Error listing contexts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/snapshots", async (req, res): Promise<void> => {
  try {
    res.json(await listComparableSnapshots(db));
  } catch (err) {
    req.log.error({ err }, "Error listing snapshots");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/change-sets", async (req, res): Promise<void> => {
  try {
    res.json(await listChangeSets(db));
  } catch (err) {
    req.log.error({ err }, "Error listing change sets");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * The newest vigência against the one before it, computing the comparison on
 * demand if it has not been made yet.
 */
router.get("/changes/latest", async (req, res): Promise<void> => {
  try {
    const snapshots = await listComparableSnapshots(db);
    if (snapshots.length === 0) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }

    /**
     * Vigências only compare inside their own series. When the Ambev ships
     * carretas and cavalos as separate files there are two series, and simply
     * taking "the newest snapshot" would answer for one equipment type while
     * silently dropping the other.
     */
    const seriesKey = (s: (typeof snapshots)[number]) =>
      `${s.scopeHash}|${s.entityTypeSet}`;
    const series = [...new Set(snapshots.map(seriesKey))]
      .map((key) => {
        const members = snapshots.filter((s) => seriesKey(s) === key);
        return {
          key,
          entityTypeSet: members[0].entityTypeSet,
          latest: members[members.length - 1],
          count: members.length,
        };
      })
      // Deterministic: newest first, then by name so ties never reorder.
      .sort(
        (a, b) =>
          b.latest.effectiveDate.localeCompare(a.latest.effectiveDate) ||
          a.entityTypeSet.localeCompare(b.entityTypeSet),
      );

    const requested = req.query.entityTypeSet;
    const chosen =
      (typeof requested === "string" &&
        series.find((s) => s.entityTypeSet === requested)) ||
      series[0];
    const latest = chosen.latest;
    const previousId = await findPreviousSnapshot(db, latest.id);
    if (!previousId) {
      res.status(409).json({
        error: `"${latest.sourceLabel}" é a primeira vigência da série; não há anterior com que comparar.`,
      });
      return;
    }

    const set = await computeChangeSet(db, previousId, latest.id, {
      computedBy: "api:latest",
    });
    const filters = parseFilters(req.query as Record<string, unknown>);
    const [changes, breakdown] = await Promise.all([
      listChanges(db, set.id, filters),
      getChangeSetBreakdown(db, set.id),
    ]);
    res.json({
      set,
      breakdown,
      // So the screen can offer the other series instead of pretending this is
      // the whole fleet.
      series: series.map((s) => ({
        entityTypeSet: s.entityTypeSet,
        vigencias: s.count,
        latestLabel: s.latest.sourceLabel,
      })),
      selectedSeries: chosen.entityTypeSet,
      ...changes,
    });
  } catch (err) {
    req.log.error({ err }, "Error computing latest changes");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Consolidated: the fleet for one period, summing the series that delivered.
 *
 * A projection over the independent series — no snapshot is merged, nothing
 * waits for anything. When a series is missing the analysis still runs on what
 * arrived, and the response names what is absent so the caller can say so.
 */
router.get("/changes/consolidated", async (req, res): Promise<void> => {
  try {
    const period = typeof req.query.period === "string" ? req.query.period : undefined;
    const context = parseContext(req.query as Record<string, unknown>);
    const view = await getConsolidated(db, period, context);
    if (!view) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }

    const filters = parseFilters(req.query as Record<string, unknown>);
    const [changes, breakdown] = await Promise.all([
      listChanges(db, view.changeSetIds, filters),
      getChangeSetBreakdown(db, view.changeSetIds),
    ]);
    res.json({
      view,
      breakdown,
      // Os períodos são os do mesmo contexto da view — listar os de outra
      // unidade num seletor que muda esta tela seria oferecer uma escolha que
      // troca de assunto sem avisar.
      periods: await listPeriods(db, view.context),
      ...changes,
    });
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building consolidated view");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Início — a vigência escolhida, agrupada por atributo e equipamento.
 *
 * A rota que a tela principal lê. Devolve tudo o que os Níveis 1 e 2 precisam
 * numa resposta só: os grupos, o impacto **desta** vigência, o acumulado
 * histórico num campo separado (nunca somados nem confundidos), as séries
 * presentes e as ausentes, e as vigências disponíveis para o seletor.
 *
 * Não calcula comparação nenhuma: lê as que a importação já produziu. Abrir uma
 * tela não pode disparar trabalho pesado nem fazer o número depender de quem
 * abriu primeiro.
 */
router.get("/changes/grouped", async (req, res): Promise<void> => {
  try {
    const period = typeof req.query.period === "string" ? req.query.period : undefined;
    const context = parseContext(req.query as Record<string, unknown>);
    const view = await getGroupedView(db, period, context);
    if (!view) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(view);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building grouped view");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * A vigência arrumada por família e parâmetro — a leitura familiar ao Freightech.
 *
 * Devolve tudo o que `/changes/grouped` devolve, mais o resumo executivo e a
 * árvore de famílias. É uma projeção sobre os mesmos grupos: nada é
 * reclassificado, nada é recalculado, e a soma das famílias fecha com o total
 * da vigência dentro de cada periodicidade.
 */
router.get("/changes/families", async (req, res): Promise<void> => {
  try {
    const period = typeof req.query.period === "string" ? req.query.period : undefined;
    const context = parseContext(req.query as Record<string, unknown>);
    const view = await getFamiliesView(db, period, context);
    if (!view) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json({ ...view, freightechSemDado: FREIGHTECH_SEM_DADO });
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building families view");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Nível 2 — os veículos por trás de um cartão, um por linha. */
router.get("/changes/grouped/vehicles", async (req, res): Promise<void> => {
  try {
    const { period, attributeCode, entityType, changeType, comparability, impactConfidence } =
      req.query as Record<string, string | undefined>;
    if (!period || !attributeCode || !entityType) {
      res.status(400).json({ error: "Informe period, attributeCode e entityType." });
      return;
    }
    const context = parseContext(req.query as Record<string, unknown>);
    res.json(
      await getGroupVehicles(db, {
        period,
        attributeCode,
        entityType,
        changeType,
        comparability,
        impactConfidence,
        scopeHash: context?.scopeHash,
        ...(context && "channel" in context ? { channel: context.channel } : {}),
      }),
    );
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error listing group vehicles");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Nível 2 — a série do atributo nas vigências, com numerador e denominador. */
router.get("/attributes/:code/series", async (req, res): Promise<void> => {
  try {
    const context = parseContext(req.query as Record<string, unknown>);
    const series = await getAttributeSeries(db, req.params.code, context);
    if (!series) {
      res.status(404).json({ error: "Atributo não encontrado." });
      return;
    }
    res.json(series);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error loading attribute series");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Comparar: any two snapshots the user picks. */
router.post("/change-sets", async (req, res): Promise<void> => {
  try {
    const { snapshotAId, snapshotBId, force } = req.body ?? {};
    if (!snapshotAId || !snapshotBId) {
      res.status(400).json({ error: "Informe snapshotAId e snapshotBId." });
      return;
    }
    const set = await computeChangeSet(db, snapshotAId, snapshotBId, {
      computedBy: "api:compare",
      force: Boolean(force),
    });
    res.json(set);
  } catch (err) {
    // Refusals here are meaningful — mismatched scope, same snapshot twice —
    // and the message is written for the person reading it.
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Comparison refused");
    res.status(422).json({ error: message });
  }
});

router.get("/change-sets/:id/changes", async (req, res): Promise<void> => {
  try {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const [changes, breakdown] = await Promise.all([
      listChanges(db, req.params.id, filters),
      getChangeSetBreakdown(db, req.params.id),
    ]);
    res.json({ breakdown, ...changes });
  } catch (err) {
    req.log.error({ err }, "Error listing changes");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/change-sets/pair/:aId/:bId", async (req, res): Promise<void> => {
  try {
    const set = await getChangeSetForPair(db, req.params.aId, req.params.bId);
    if (!set) {
      res.status(404).json({ error: "Comparação ainda não calculada." });
      return;
    }
    res.json(set);
  } catch (err) {
    req.log.error({ err }, "Error fetching change set");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Both sides of one change, down to the originating cell. */
router.get("/changes/:id/provenance", async (req, res): Promise<void> => {
  try {
    const provenance = await getChangeProvenance(db, Number(req.params.id));
    if (!provenance) {
      res.status(404).json({ error: "Alteração não encontrada." });
      return;
    }
    res.json(provenance);
  } catch (err) {
    req.log.error({ err }, "Error fetching provenance");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
