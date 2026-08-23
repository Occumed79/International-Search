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

async function start(): Promise<void> {
  await bootstrapNetworkData();

  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

void start().catch((error: unknown) => {
  logger.error({ error }, "Application startup failed");
  process.exit(1);
});
