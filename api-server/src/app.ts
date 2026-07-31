import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Resolve frontend dist relative to the repo root (process.cwd())
const possiblePaths = [
  path.resolve(process.cwd(), "price-intel/dist/public"),
  path.resolve(process.cwd(), "../price-intel/dist/public"),
];

const staticDir = possiblePaths.find((p) => fs.existsSync(p));

if (staticDir) {
  logger.info({ staticDir }, "Serving frontend static files");
  app.use(express.static(staticDir));
  // Express 5 requires named wildcard params — use regex instead
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  logger.warn({ tried: possiblePaths }, "Frontend dist not found — API-only mode");
  app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "International Search API is running. Frontend not built." });
  });
}

// Global error handler — always return JSON (never Express HTML error pages)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled server error");
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({
    error: "Internal server error",
    message: err?.message || "Something went wrong while processing the search.",
  });
});

export default app;
