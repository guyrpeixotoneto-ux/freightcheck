import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  computeChangeSet,
  findPreviousSnapshot,
  getChangeProvenance,
  getChangeSetBreakdown,
  getChangeSetForPair,
  listChangeSets,
  listChanges,
  listComparableSnapshots,
  type ChangeFilters,
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
