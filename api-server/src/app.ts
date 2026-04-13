import express, { type Express } from "express";
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
// Works whether running from repo root or api-server/
const possiblePaths = [
  path.resolve(process.cwd(), "price-intel/dist/public"),
  path.resolve(process.cwd(), "../price-intel/dist/public"),
];

const staticDir = possiblePaths.find((p) => fs.existsSync(p));

if (staticDir) {
  logger.info({ staticDir }, "Serving frontend static files");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  logger.warn({ tried: possiblePaths }, "Frontend dist not found — API-only mode");
  app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "International Search API is running. Frontend not built." });
  });
}

export default app;
