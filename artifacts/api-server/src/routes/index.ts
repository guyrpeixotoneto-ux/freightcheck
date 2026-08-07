import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import snapshotsRouter from "./snapshots";
import parametersRouter from "./parameters";
import diffsRouter from "./diffs";
import importsRouter from "./imports";
import shipmentsRouter from "./shipments";
import alertsRouter from "./alerts";
import simulationsRouter from "./simulations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(snapshotsRouter);
router.use(parametersRouter);
router.use(diffsRouter);
router.use(importsRouter);
router.use(shipmentsRouter);
router.use(alertsRouter);
router.use(simulationsRouter);

export default router;
