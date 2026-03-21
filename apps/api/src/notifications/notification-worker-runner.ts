import {
  createNotificationProcessingService,
  type NotificationDeliveryPort,
  type NotificationProcessingRepository,
  type ProcessPendingNotificationJobsResult,
} from "@bookpilot/booking-core";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_STALE_ATTEMPT_MINUTES = 15;

export interface NotificationWorkerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface NotificationWorkerRunnerOptions {
  repository: NotificationProcessingRepository;
  deliveryPort: NotificationDeliveryPort;
  batchSize?: number;
  pollIntervalMs?: number;
  staleAttemptMinutes?: number;
  logger?: NotificationWorkerLogger;
}

export interface RunNotificationWorkerBatchInput {
  now?: Date;
}

export interface NotificationWorkerRunHandle {
  stop(): Promise<void>;
}

export function createNotificationWorkerRunner(
  options: NotificationWorkerRunnerOptions,
) {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const staleAttemptMinutes =
    options.staleAttemptMinutes ?? DEFAULT_STALE_ATTEMPT_MINUTES;
  const logger = options.logger ?? createConsoleLogger();

  assertPositiveInteger(batchSize, "batchSize");
  assertPositiveInteger(pollIntervalMs, "pollIntervalMs");
  assertPositiveInteger(staleAttemptMinutes, "staleAttemptMinutes");

  const processingService = createNotificationProcessingService(
    options.repository,
    options.deliveryPort,
  );

  let activeRun: Promise<void> | null = null;
  let stopController: AbortController | null = null;

  return {
    async runOnce(
      input: RunNotificationWorkerBatchInput = {},
    ): Promise<ProcessPendingNotificationJobsResult> {
      return processingService.processPending({
        limit: batchSize,
        staleAttemptMinutes,
        now: input.now,
      });
    },

    start(): NotificationWorkerRunHandle {
      if (activeRun !== null || stopController !== null) {
        throw new Error("Notification worker runner is already running.");
      }

      stopController = new AbortController();
      const signal = stopController.signal;

      activeRun = runLoop(signal).finally(() => {
        activeRun = null;
        stopController = null;
      });

      return {
        async stop(): Promise<void> {
          if (stopController !== null) {
            stopController.abort();
          }

          if (activeRun !== null) {
            await activeRun;
          }
        },
      };
    },
  };

  async function runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await processingService.processPending({
          limit: batchSize,
          staleAttemptMinutes,
        });

        if (result.claimedJobs > 0) {
          logger.info("Processed notification jobs.", {
            claimedJobs: result.claimedJobs,
            succeededJobs: result.succeededJobs,
            failedJobs: result.failedJobs,
            retriedJobs: result.retriedJobs,
          });
        }
      } catch (error) {
        logger.error("Notification worker iteration failed.", {
          error: serializeError(error),
        });
      }

      await waitForNextPoll(pollIntervalMs, signal);
    }
  }
}

function waitForNextPoll(intervalMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);

    const onAbort = (): void => {
      clearTimeout(timeout);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    message: String(error),
  };
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
}

function createConsoleLogger(): NotificationWorkerLogger {
  return {
    info(message, context) {
      console.log(message, context ?? {});
    },
    error(message, context) {
      console.error(message, context ?? {});
    },
  };
}
