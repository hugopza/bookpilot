import { Pool } from "pg";

import { PostgresBookingCoreRepository } from "./postgres-booking-core-repository";
import { createOrganizationConfiguredNotificationDeliveryPort } from "./notifications/organization-configured-notification-delivery-port";
import { createEnvironmentNotificationProviderCredentialsResolver } from "./notifications/provider-credentials-resolver";
import { createNotificationProviderFactories } from "./notifications/provider-factory-registry";
import { createNotificationWorkerRunner } from "./notifications/notification-worker-runner";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_STALE_ATTEMPT_MINUTES = 15;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the notification worker.");
  }

  const batchSize = readPositiveIntegerEnv(
    "NOTIFICATION_WORKER_BATCH_SIZE",
    DEFAULT_BATCH_SIZE,
  );
  const pollIntervalMs = readPositiveIntegerEnv(
    "NOTIFICATION_WORKER_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  const staleAttemptMinutes = readPositiveIntegerEnv(
    "NOTIFICATION_WORKER_STALE_ATTEMPT_MINUTES",
    DEFAULT_STALE_ATTEMPT_MINUTES,
  );
  const providerNameFallback =
    process.env.NOTIFICATION_PROVIDER_NAME ?? "local-development-provider";

  const pool = new Pool({
    connectionString: databaseUrl,
  });
  const repository = new PostgresBookingCoreRepository(pool);
  const credentialsResolver =
    createEnvironmentNotificationProviderCredentialsResolver();
  const providerFactories = createNotificationProviderFactories({
    credentialsResolver,
    localDevelopmentProviderNameFallback: providerNameFallback,
  });
  const deliveryPort = createOrganizationConfiguredNotificationDeliveryPort({
    configurationReader: repository,
    providerFactories,
  });

  const runner = createNotificationWorkerRunner({
    repository,
    deliveryPort,
    batchSize,
    pollIntervalMs,
    staleAttemptMinutes,
  });

  const runHandle = runner.start();
  console.log("Notification worker started.", {
    batchSize,
    pollIntervalMs,
    staleAttemptMinutes,
    providerRegistryKeys: Object.keys(providerFactories),
    providerNameFallback,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Notification worker received ${signal}. Shutting down...`);

    try {
      await runHandle.stop();
    } finally {
      await pool.end();
    }

    console.log("Notification worker stopped.");
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

void main().catch((error: unknown) => {
  console.error("Notification worker failed to start.", error);
  process.exitCode = 1;
});
