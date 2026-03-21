import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { BookingEventType, NotificationJob } from "@bookpilot/booking-core";
import { InMemoryBookingCoreRepository } from "@bookpilot/booking-core";

import { createLocalDevelopmentNotificationAdapter } from "./notifications/local-development-notification-adapter";
import { createNotificationWorkerRunner } from "./notifications/notification-worker-runner";

const TEST_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

async function main(): Promise<void> {
  await runSingleBatchScenario();
  await runPollingScenario();
  console.log("notification-worker self-test passed");
}

async function runSingleBatchScenario(): Promise<void> {
  const firstRunTime = new Date("2026-03-20T10:00:00.000Z");
  const retryDueTime = new Date("2026-03-20T10:02:00.000Z");
  let adapterNow = firstRunTime;
  const repository = new InMemoryBookingCoreRepository({
    notificationJobs: [
      buildPendingNotificationJob({
        eventType: "booking_created",
        payload: {},
        createdAt: new Date("2026-03-20T09:30:00.000Z"),
      }),
      buildPendingNotificationJob({
        eventType: "booking_rescheduled",
        payload: {
          localAdapterSimulation: {
            mode: "retryable_failure",
            failUntilAttempt: 1,
            retryDelayMinutes: 2,
            code: "SIMULATED_TEMPORARY_FAILURE",
            message: "Temporary provider failure.",
          },
        },
        createdAt: new Date("2026-03-20T09:31:00.000Z"),
      }),
      buildPendingNotificationJob({
        eventType: "booking_cancelled",
        payload: {
          localAdapterSimulation: {
            mode: "terminal_failure",
            code: "SIMULATED_TERMINAL_FAILURE",
            message: "Terminal provider failure.",
          },
        },
        createdAt: new Date("2026-03-20T09:32:00.000Z"),
      }),
    ],
  });
  const runner = createNotificationWorkerRunner({
    repository,
    adapter: createLocalDevelopmentNotificationAdapter({
      providerName: "local-test-provider",
      now: () => adapterNow,
    }),
    batchSize: 10,
    pollIntervalMs: 10,
    staleAttemptMinutes: 15,
    logger: createSilentLogger(),
  });

  const firstRunResult = await runner.runOnce({
    now: firstRunTime,
  });

  assert.deepEqual(firstRunResult, {
    claimedJobs: 3,
    succeededJobs: 1,
    failedJobs: 1,
    retriedJobs: 1,
  });

  const jobsAfterFirstRun = mapJobsByEventType(
    repository.listPersistedNotificationJobs(TEST_ORGANIZATION_ID),
  );
  const createdJob = jobsAfterFirstRun.get("booking_created");
  const rescheduledJob = jobsAfterFirstRun.get("booking_rescheduled");
  const cancelledJob = jobsAfterFirstRun.get("booking_cancelled");

  assert.equal(createdJob?.status, "succeeded");
  assert.equal(createdJob?.attemptCount, 1);
  assert.equal(rescheduledJob?.status, "pending");
  assert.equal(rescheduledJob?.attemptCount, 1);
  assert.equal(rescheduledJob?.nextAttemptAt.toISOString(), retryDueTime.toISOString());
  assert.equal(rescheduledJob?.lastErrorCode, "SIMULATED_TEMPORARY_FAILURE");
  assert.equal(cancelledJob?.status, "failed");
  assert.equal(cancelledJob?.attemptCount, 1);
  assert.equal(cancelledJob?.lastErrorCode, "SIMULATED_TERMINAL_FAILURE");

  const attemptsAfterFirstRun = repository.listPersistedNotificationJobAttempts(
    TEST_ORGANIZATION_ID,
  );
  assert.equal(attemptsAfterFirstRun.length, 3);

  const createdAttempt = attemptsAfterFirstRun.find(
    (attempt) => attempt.notificationJobId === createdJob?.id,
  );
  const retryableAttempt = attemptsAfterFirstRun.find(
    (attempt) => attempt.notificationJobId === rescheduledJob?.id,
  );
  const terminalAttempt = attemptsAfterFirstRun.find(
    (attempt) => attempt.notificationJobId === cancelledJob?.id,
  );

  assert.equal(createdAttempt?.status, "succeeded");
  assert.equal(
    getProviderName(createdAttempt?.outcomePayload),
    "local-test-provider",
  );
  assert.equal(retryableAttempt?.status, "failed");
  assert.equal(retryableAttempt?.outcomeCode, "SIMULATED_TEMPORARY_FAILURE");
  assert.equal(terminalAttempt?.status, "failed");
  assert.equal(terminalAttempt?.outcomeCode, "SIMULATED_TERMINAL_FAILURE");

  adapterNow = retryDueTime;
  const secondRunResult = await runner.runOnce({
    now: retryDueTime,
  });

  assert.deepEqual(secondRunResult, {
    claimedJobs: 1,
    succeededJobs: 1,
    failedJobs: 0,
    retriedJobs: 0,
  });

  const jobsAfterSecondRun = mapJobsByEventType(
    repository.listPersistedNotificationJobs(TEST_ORGANIZATION_ID),
  );
  assert.equal(jobsAfterSecondRun.get("booking_rescheduled")?.status, "succeeded");
  assert.equal(
    jobsAfterSecondRun.get("booking_rescheduled")?.attemptCount,
    2,
  );

  const attemptsAfterSecondRun = repository.listPersistedNotificationJobAttempts(
    TEST_ORGANIZATION_ID,
  );
  assert.equal(attemptsAfterSecondRun.length, 4);
  const secondRetryAttempt = attemptsAfterSecondRun.find(
    (attempt) =>
      attempt.notificationJobId === jobsAfterSecondRun.get("booking_rescheduled")?.id &&
      attempt.attemptNumber === 2,
  );
  assert.equal(secondRetryAttempt?.status, "succeeded");
}

async function runPollingScenario(): Promise<void> {
  const now = new Date("2026-03-20T11:00:00.000Z");
  const repository = new InMemoryBookingCoreRepository({
    notificationJobs: [
      buildPendingNotificationJob({
        eventType: "booking_created",
        payload: {},
        createdAt: new Date("2026-03-20T10:00:00.000Z"),
      }),
    ],
  });
  const runner = createNotificationWorkerRunner({
    repository,
    adapter: createLocalDevelopmentNotificationAdapter({
      providerName: "local-test-provider",
      now: () => now,
    }),
    batchSize: 1,
    pollIntervalMs: 10,
    staleAttemptMinutes: 15,
    logger: createSilentLogger(),
  });
  const handle = runner.start();

  await waitUntil(
    () =>
      repository.listPersistedNotificationJobs(TEST_ORGANIZATION_ID)[0]?.status ===
      "succeeded",
    300,
  );
  await handle.stop();

  const attempts = repository.listPersistedNotificationJobAttempts(
    TEST_ORGANIZATION_ID,
  );
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.status, "succeeded");
}

function buildPendingNotificationJob(input: {
  eventType: BookingEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}): NotificationJob {
  return {
    id: randomUUID(),
    organizationId: TEST_ORGANIZATION_ID,
    bookingId: randomUUID(),
    customerId: randomUUID(),
    eventType: input.eventType,
    status: "pending",
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: new Date(input.createdAt.getTime() - 60 * 1000),
    processingToken: null,
    processingStartedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    payload: input.payload,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function mapJobsByEventType(
  jobs: NotificationJob[],
): Map<BookingEventType, NotificationJob> {
  const map = new Map<BookingEventType, NotificationJob>();

  for (const job of jobs) {
    map.set(job.eventType, job);
  }

  return map;
}

function createSilentLogger() {
  return {
    info() {
      return;
    },
    error() {
      return;
    },
  };
}

function getProviderName(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) {
    return null;
  }

  const providerDelivery = payload.providerDelivery;

  if (
    isObjectRecord(providerDelivery) &&
    typeof providerDelivery.provider === "string"
  ) {
    return providerDelivery.provider;
  }

  return null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for polling worker to process jobs.");
    }

    await sleep(10);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
