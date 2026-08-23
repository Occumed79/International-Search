import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapNetworkData } from "./services/networkBootstrapV2";

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

const BOOTSTRAP_RETRY_MS = 30_000;
let bootstrapInFlight = false;
let bootstrapComplete = false;
let bootstrapAttempt = 0;
let retryTimer: NodeJS.Timeout | null = null;

async function runNetworkBootstrap(reason: "startup" | "retry"): Promise<void> {
  if (bootstrapComplete || bootstrapInFlight) return;

  if (!process.env.NEON_DATABASE_URL) {
    logger.error(
      { reason },
      "NEON_DATABASE_URL is not configured; provider network data cannot be loaded",
    );
    return;
  }

  bootstrapInFlight = true;
  bootstrapAttempt += 1;

  try {
    logger.info(
      { reason, attempt: bootstrapAttempt },
      "Starting bundled Command Center -> Neon bootstrap",
    );

    await bootstrapNetworkData();
    bootstrapComplete = true;

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    logger.info(
      { attempt: bootstrapAttempt },
      "Bundled Command Center -> Neon bootstrap complete",
    );
  } catch (err: unknown) {
    logger.error(
      { err, attempt: bootstrapAttempt },
      "Bundled Command Center -> Neon bootstrap failed; scheduling automatic retry",
    );

    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void runNetworkBootstrap("retry");
      }, BOOTSTRAP_RETRY_MS);
    }
  } finally {
    bootstrapInFlight = false;
  }
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");

  setTimeout(() => {
    void runNetworkBootstrap("startup");
  }, 1000);
});

server.on("error", (err: Error) => {
  logger.error({ err }, "Web server failed to bind");
  process.exit(1);
});
