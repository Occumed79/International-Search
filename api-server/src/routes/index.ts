import { Router, type IRouter } from "express";
import healthRouter from "./health";
import searchRouter from "./search";
import providersRouter from "./providers";
import bookmarksRouter from "./bookmarks";
import statsRouter from "./stats";
import networkRouter from "./network";
import networkIntelligenceRouter from "./networkIntelligence";
import commandCenterRouter from "./commandCenter";
import commandCenterDetailRouter from "./commandCenterDetail";
import configRouter from "./config";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(networkRouter);
router.use(networkIntelligenceRouter);
router.use(commandCenterRouter);
router.use(commandCenterDetailRouter);
router.use(searchRouter);
router.use(providersRouter);
router.use(bookmarksRouter);
router.use(statsRouter);

export default router;
