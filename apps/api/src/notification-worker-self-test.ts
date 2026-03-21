import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type {
  BookingEventType,
  NotificationChannel,
  NotificationJob,
  OrganizationNotificationChannelConfiguration,
} from "@bookpilot/booking-core";
import { InMemoryBookingCoreRepository } from "@bookpilot/booking-core";
import {
  createOrganizationConfiguredNotificationDeliveryPort,
} from "./notifications/organization-configured-notification-delivery-port";
import { createEnvironmentNotificationProviderCredentialsResolver } from "./notifications/provider-credentials-resolver";
import { createNotificationProviderFactories } from "./notifications/provider-factory-registry";
import { createNotificationWorkerRunner } from "./notifications/notification-worker-runner";

const TEST_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

async function main(): Promise<void> {
  await runConfiguredProviderResolutionScenario();
  await runResendEmailProviderScenario();
  await runPollingScenario();
  console.log("notification-worker self-test passed");
}

async function runConfiguredProviderResolutionScenario(): Promise<void> {
  const firstRunTime = new Date("2026-03-20T10:00:00.000Z");
  const retryDueTime = new Date("2026-03-20T10:02:00.000Z");

  const repository = new InMemoryBookingCoreRepository({
    organizationNotificationChannelConfigurations: [
      buildChannelConfiguration({
        channel: "email",
        enabled: true,
        notificationProviderKey: "local-development",
      }),
      buildChannelConfiguration({
        channel: "whatsapp",
        enabled: true,
        notificationProviderKey: "local-development",
      }),
      buildChannelConfiguration({
        channel: "sms",
        enabled: false,
        notificationProviderKey: null,
      }),
    ],
    notificationJobs: [
      buildPendingNotificationJob({
        eventType: "booking_created",
        deliveryChannel: "email",
        payload: {},
        createdAt: new Date("2026-03-20T09:30:00.000Z"),
      }),
      buildPendingNotificationJob({
        eventType: "booking_rescheduled",
        deliveryChannel: "whatsapp",
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
        deliveryChannel: "sms",
        payload: {},
        createdAt: new Date("2026-03-20T09:32:00.000Z"),
      }),
    ],
  });

  const runner = createNotificationWorkerRunner({
    repository,
    deliveryPort: createOrganizationConfiguredNotificationDeliveryPort({
      configurationReader: repository,
      providerFactories: createNotificationProviderFactories({
        credentialsResolver: createEnvironmentNotificationProviderCredentialsResolver(
          { env: {} },
        ),
        localDevelopmentProviderNameFallback: "local-test-provider",
      }),
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
  assert.equal(cancelledJob?.lastErrorCode, "NOTIFICATION_CHANNEL_DISABLED");

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
  const disabledChannelAttempt = attemptsAfterFirstRun.find(
    (attempt) => attempt.notificationJobId === cancelledJob?.id,
  );

  assert.equal(createdAttempt?.status, "succeeded");
  assert.equal(
    getProviderName(createdAttempt?.outcomePayload),
    "local-test-provider",
  );
  assert.equal(retryableAttempt?.status, "failed");
  assert.equal(retryableAttempt?.outcomeCode, "SIMULATED_TEMPORARY_FAILURE");
  assert.equal(disabledChannelAttempt?.status, "failed");
  assert.equal(
    disabledChannelAttempt?.outcomeCode,
    "NOTIFICATION_CHANNEL_DISABLED",
  );
  assert.equal(
    getProviderResolutionChannel(disabledChannelAttempt?.outcomePayload),
    "sms",
  );

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
}

async function runPollingScenario(): Promise<void> {
  const now = new Date("2026-03-20T11:00:00.000Z");
  const repository = new InMemoryBookingCoreRepository({
    organizationNotificationChannelConfigurations: [
      buildChannelConfiguration({
        channel: "email",
        enabled: true,
        notificationProviderKey: "local-development",
      }),
    ],
    notificationJobs: [
      buildPendingNotificationJob({
        eventType: "booking_created",
        deliveryChannel: "email",
        payload: {},
        createdAt: new Date("2026-03-20T10:00:00.000Z"),
      }),
    ],
  });
  const runner = createNotificationWorkerRunner({
    repository,
    deliveryPort: createOrganizationConfiguredNotificationDeliveryPort({
      configurationReader: repository,
      providerFactories: createNotificationProviderFactories({
        credentialsResolver: createEnvironmentNotificationProviderCredentialsResolver(
          { env: {} },
        ),
        localDevelopmentProviderNameFallback: "local-test-provider",
      }),
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

async function runResendEmailProviderScenario(): Promise<void> {
  const now = new Date("2026-03-20T12:00:00.000Z");
  const repository = new InMemoryBookingCoreRepository({
    organizationNotificationChannelConfigurations: [
      {
        id: randomUUID(),
        organizationId: TEST_ORGANIZATION_ID,
        channel: "email",
        enabled: true,
        notificationProviderKey: "resend-email",
        providerConfig: {
          credentialRef: "org_main_email",
          fromEmail: "noreply@example.com",
          subjectPrefix: "[BookPilot]",
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        organizationId: "00000000-0000-0000-0000-000000000002",
        channel: "email",
        enabled: true,
        notificationProviderKey: "resend-email",
        providerConfig: {
          credentialRef: "missing_credentials_ref",
          fromEmail: "noreply@example.com",
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
    notificationJobs: [
      buildPendingNotificationJob({
        eventType: "booking_created",
        deliveryChannel: "email",
        payload: {
          customerEmail: "customer1@example.com",
        },
        createdAt: now,
      }),
      {
        ...buildPendingNotificationJob({
          eventType: "booking_cancelled",
          deliveryChannel: "email",
          payload: {
            customerEmail: "customer2@example.com",
          },
          createdAt: now,
        }),
        organizationId: "00000000-0000-0000-0000-000000000002",
      },
    ],
  });

  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImplementation: typeof fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init: init ?? {} });

    return new Response(
      JSON.stringify({
        id: "resend_test_123",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  const runner = createNotificationWorkerRunner({
    repository,
    deliveryPort: createOrganizationConfiguredNotificationDeliveryPort({
      configurationReader: repository,
      providerFactories: createNotificationProviderFactories({
        credentialsResolver: createEnvironmentNotificationProviderCredentialsResolver({
          env: {
            NOTIFICATION_PROVIDER_CREDENTIALS_JSON: JSON.stringify({
              org_main_email: {
                apiKey: "resend_test_api_key",
              },
            }),
          },
        }),
        localDevelopmentProviderNameFallback: "local-test-provider",
        resendFetchImplementation: fetchImplementation,
      }),
    }),
    batchSize: 10,
    pollIntervalMs: 10,
    staleAttemptMinutes: 15,
    logger: createSilentLogger(),
  });

  const result = await runner.runOnce({
    now,
  });

  assert.deepEqual(result, {
    claimedJobs: 2,
    succeededJobs: 1,
    failedJobs: 1,
    retriedJobs: 0,
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.url, "https://api.resend.com/emails");

  const firstOrgAttempts = repository.listPersistedNotificationJobAttempts(
    TEST_ORGANIZATION_ID,
  );
  assert.equal(firstOrgAttempts.length, 1);
  assert.equal(firstOrgAttempts[0]?.status, "succeeded");
  assert.equal(
    getProviderName(firstOrgAttempts[0]?.outcomePayload),
    "resend-email",
  );

  const secondOrgAttempts = repository.listPersistedNotificationJobAttempts(
    "00000000-0000-0000-0000-000000000002",
  );
  assert.equal(secondOrgAttempts.length, 1);
  assert.equal(secondOrgAttempts[0]?.status, "failed");
  assert.equal(secondOrgAttempts[0]?.outcomeCode, "PROVIDER_CREDENTIALS_NOT_FOUND");
}

function buildPendingNotificationJob(input: {
  eventType: BookingEventType;
  deliveryChannel: NotificationChannel;
  payload: Record<string, unknown>;
  createdAt: Date;
}): NotificationJob {
  return {
    id: randomUUID(),
    organizationId: TEST_ORGANIZATION_ID,
    bookingId: randomUUID(),
    customerId: randomUUID(),
    deliveryChannel: input.deliveryChannel,
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

function buildChannelConfiguration(input: {
  channel: NotificationChannel;
  enabled: boolean;
  notificationProviderKey: string | null;
}): OrganizationNotificationChannelConfiguration {
  const now = new Date("2026-03-20T09:00:00.000Z");
  return {
    id: randomUUID(),
    organizationId: TEST_ORGANIZATION_ID,
    channel: input.channel,
    enabled: input.enabled,
    notificationProviderKey: input.notificationProviderKey,
    providerConfig: {
      providerName: "local-test-provider",
    },
    createdAt: now,
    updatedAt: now,
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
  const providerDelivery = readObjectRecord(payload?.providerDelivery);

  if (!providerDelivery) {
    return null;
  }

  return typeof providerDelivery.provider === "string"
    ? providerDelivery.provider
    : null;
}

function getProviderResolutionChannel(
  payload: Record<string, unknown> | undefined,
): string | null {
  const providerResolution = readObjectRecord(payload?.providerResolution);

  if (!providerResolution) {
    return null;
  }

  return typeof providerResolution.channel === "string"
    ? providerResolution.channel
    : null;
}

function readObjectRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
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
