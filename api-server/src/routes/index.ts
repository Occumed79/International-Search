import { Router, type IRouter } from "express";
import healthRouter from "./health";
import searchRouter from "./search";
import providersRouter from "./providers";
import bookmarksRouter from "./bookmarks";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(providersRouter);
router.use(bookmarksRouter);
router.use(statsRouter);

export default router;
