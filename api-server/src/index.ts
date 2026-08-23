import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapNetworkData } from "./services/networkBootstrap";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");

  // The bundled Command Center dataset is a one-time/bootstrap maintenance job.
  // Render must see an open web-service port immediately; do not block port binding
  // while hundreds of thousands of provider/pricing/availability rows are loaded.
  setTimeout(() => {
    logger.info("Starting bundled Command Center -> Neon bootstrap");
    void bootstrapNetworkData()
      .then(() => {
        logger.info("Bundled Command Center -> Neon bootstrap complete");
      })
      .catch((err: unknown) => {
        // Use Pino's conventional `err` key so the actual PostgreSQL error/stack is serialized.
        // A bootstrap failure must not take the web service down; the next deployment/start can retry.
        logger.error({ err }, "Bundled Command Center -> Neon bootstrap failed");
      });
  }, 1000);
});

server.on("error", (err: Error) => {
  logger.error({ err }, "Web server failed to bind");
  process.exit(1);
});
