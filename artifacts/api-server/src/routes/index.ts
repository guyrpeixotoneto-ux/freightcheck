import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fleetAnalysisRouter from "./fleet-analysis";
import curationRouter from "./curation";
import changesRouter from "./changes";
import overviewRouter from "./overview";

/**
 * F0/F1 surface.
 *
 * The routes built on the previous schema (dashboard, snapshots, parameters,
 * diffs, imports, shipments, simulations, alerts) were removed together with
 * that schema — see docs/ARQUITETURA.md §1. They are rebuilt on the canonical
 * model in F5, once the comparison engine and the impact policy exist.
 *
 * `curation` is the F2 surface; `changes` is F3 — Alterações and Comparar.
 *
 * `fleet-analysis` is kept as-is for now: it reads the workbook directly and
 * does not depend on the database, so the existing Fleet Analysis screen keeps
 * working while the canonical layer is being built.
 */
const router: IRouter = Router();

router.use(healthRouter);
router.use(fleetAnalysisRouter);
router.use(curationRouter);
router.use(changesRouter);
router.use(overviewRouter);

export default router;
