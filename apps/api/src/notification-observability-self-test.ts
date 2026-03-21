import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  InMemoryBookingCoreRepository,
  NotFoundError,
  ValidationError,
  createNotificationDeliveryObservabilityService,
  type NotificationDeliveryFeedbackEvent,
  type NotificationJob,
  type NotificationJobAttempt,
  type Organization,
} from "@bookpilot/booking-core";

const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const SECOND_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000002";

async function main(): Promise<void> {
  await runObservabilityScenario();
  await runValidationScenario();
  console.log("notification-observability self-test passed");
}

async function runObservabilityScenario(): Promise<void> {
  const organization: Organization = {
    id: ORGANIZATION_ID,
    name: "BookPilot Studio",
    slug: "bookpilot-studio",
    timeZone: "UTC",
  };
  const secondOrganization: Organization = {
    id: SECOND_ORGANIZATION_ID,
    name: "Second Studio",
    slug: "second-studio",
    timeZone: "UTC",
  };
  const jobWithTimeline = buildNotificationJob({
    organizationId: ORGANIZATION_ID,
    status: "succeeded",
    eventType: "booking_created",
    createdAt: new Date("2026-03-21T10:00:00.000Z"),
  });
  const pendingJob = buildNotificationJob({
    organizationId: ORGANIZATION_ID,
    status: "pending",
    eventType: "booking_cancelled",
    createdAt: new Date("2026-03-21T11:00:00.000Z"),
  });
  const secondOrganizationJob = buildNotificationJob({
    organizationId: SECOND_ORGANIZATION_ID,
    status: "succeeded",
    eventType: "booking_rescheduled",
    createdAt: new Date("2026-03-21T12:00:00.000Z"),
  });

  const attempts: NotificationJobAttempt[] = [
    buildNotificationAttempt({
      notificationJobId: jobWithTimeline.id,
      attemptNumber: 1,
      status: "succeeded",
      providerMessageId: "resend_msg_001",
      deliveryStatus: "delivered",
      deliveryStatusUpdatedAt: new Date("2026-03-21T10:05:00.000Z"),
      providerStatus: "email.delivered",
    }),
    buildNotificationAttempt({
      notificationJobId: jobWithTimeline.id,
      attemptNumber: 2,
      status: "succeeded",
      providerMessageId: "resend_msg_001",
      deliveryStatus: "opened",
      deliveryStatusUpdatedAt: new Date("2026-03-21T10:10:00.000Z"),
      providerStatus: "email.opened",
    }),
    buildNotificationAttempt({
      notificationJobId: pendingJob.id,
      attemptNumber: 1,
      status: "processing",
      providerMessageId: null,
      deliveryStatus: null,
      deliveryStatusUpdatedAt: null,
      providerStatus: null,
    }),
    buildNotificationAttempt({
      notificationJobId: secondOrganizationJob.id,
      attemptNumber: 1,
      status: "succeeded",
      providerMessageId: "resend_msg_002",
      deliveryStatus: "delivered",
      deliveryStatusUpdatedAt: new Date("2026-03-21T12:05:00.000Z"),
      providerStatus: "email.delivered",
    }),
  ];

  const feedbackEvents: NotificationDeliveryFeedbackEvent[] = [
    buildFeedbackEvent({
      providerEventId: "evt_001",
      providerMessageId: "resend_msg_001",
      providerStatus: "email.delivered",
      normalizedStatus: "delivered",
      occurredAt: new Date("2026-03-21T10:05:00.000Z"),
      receivedAt: new Date("2026-03-21T10:05:10.000Z"),
      organizationId: ORGANIZATION_ID,
      notificationJobId: jobWithTimeline.id,
      notificationJobAttemptId: attempts[0]?.id ?? null,
    }),
    buildFeedbackEvent({
      providerEventId: "evt_002",
      providerMessageId: "resend_msg_001",
      providerStatus: "email.opened",
      normalizedStatus: "opened",
      occurredAt: new Date("2026-03-21T10:10:00.000Z"),
      receivedAt: new Date("2026-03-21T10:10:15.000Z"),
      organizationId: ORGANIZATION_ID,
      notificationJobId: jobWithTimeline.id,
      notificationJobAttemptId: attempts[1]?.id ?? null,
    }),
    buildFeedbackEvent({
      providerEventId: "evt_003",
      providerMessageId: "resend_msg_002",
      providerStatus: "email.delivered",
      normalizedStatus: "delivered",
      occurredAt: new Date("2026-03-21T12:05:00.000Z"),
      receivedAt: new Date("2026-03-21T12:05:10.000Z"),
      organizationId: SECOND_ORGANIZATION_ID,
      notificationJobId: secondOrganizationJob.id,
      notificationJobAttemptId: attempts[3]?.id ?? null,
    }),
  ];

  const repository = new InMemoryBookingCoreRepository({
    organizations: [organization, secondOrganization],
    notificationJobs: [jobWithTimeline, pendingJob, secondOrganizationJob],
    notificationJobAttempts: attempts,
    notificationDeliveryFeedbackEvents: feedbackEvents,
  });
  const observabilityService =
    createNotificationDeliveryObservabilityService(repository);

  const listedJobs = await observabilityService.listOrganizationJobs({
    organizationId: ORGANIZATION_ID,
  });

  assert.equal(listedJobs.length, 2);
  assert.equal(listedJobs[0]?.job.id, pendingJob.id);
  assert.equal(listedJobs[0]?.latestDeliveryStatus.normalizedStatus, null);
  assert.equal(listedJobs[1]?.job.id, jobWithTimeline.id);
  assert.equal(listedJobs[1]?.latestDeliveryStatus.normalizedStatus, "opened");
  assert.equal(listedJobs[1]?.latestDeliveryStatus.providerStatus, "email.opened");

  const filteredJobs = await observabilityService.listOrganizationJobs({
    organizationId: ORGANIZATION_ID,
    status: "succeeded",
  });

  assert.equal(filteredJobs.length, 1);
  assert.equal(filteredJobs[0]?.job.id, jobWithTimeline.id);

  const details = await observabilityService.getOrganizationJob({
    organizationId: ORGANIZATION_ID,
    notificationJobId: jobWithTimeline.id,
  });

  assert.equal(details.job.id, jobWithTimeline.id);
  assert.equal(details.latestDeliveryStatus.normalizedStatus, "opened");
  assert.equal(details.attempts.length, 2);
  assert.equal(details.attempts[0]?.attemptNumber, 1);
  assert.equal(details.attempts[1]?.attemptNumber, 2);
  assert.equal(
    Object.prototype.hasOwnProperty.call(details.attempts[0] ?? {}, "outcomePayload"),
    false,
  );
  assert.equal(details.feedbackTimeline.length, 2);
  assert.equal(details.feedbackTimeline[0]?.providerEventId, "evt_001");
  assert.equal(details.feedbackTimeline[1]?.providerEventId, "evt_002");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      details.feedbackTimeline[0] ?? {},
      "payload",
    ),
    false,
  );

  await assert.rejects(
    () =>
      observabilityService.getOrganizationJob({
        organizationId: ORGANIZATION_ID,
        notificationJobId: secondOrganizationJob.id,
      }),
    NotFoundError,
  );
}

async function runValidationScenario(): Promise<void> {
  const repository = new InMemoryBookingCoreRepository({
    organizations: [
      {
        id: ORGANIZATION_ID,
        name: "BookPilot Studio",
        slug: "bookpilot-studio",
        timeZone: "UTC",
      },
    ],
  });
  const observabilityService =
    createNotificationDeliveryObservabilityService(repository);

  await assert.rejects(
    () =>
      observabilityService.listOrganizationJobs({
        organizationId: ORGANIZATION_ID,
        limit: 0,
      }),
    ValidationError,
  );
}

function buildNotificationJob(input: {
  organizationId: string;
  status: NotificationJob["status"];
  eventType: NotificationJob["eventType"];
  createdAt: Date;
}): NotificationJob {
  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    bookingId: randomUUID(),
    customerId: randomUUID(),
    deliveryChannel: "email",
    eventType: input.eventType,
    status: input.status,
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: input.createdAt,
    processingToken: null,
    processingStartedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    payload: {
      customerEmail: "customer@example.com",
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function buildNotificationAttempt(input: {
  notificationJobId: string;
  attemptNumber: number;
  status: NotificationJobAttempt["status"];
  providerMessageId: string | null;
  deliveryStatus: NotificationJobAttempt["deliveryStatus"];
  deliveryStatusUpdatedAt: Date | null;
  providerStatus: string | null;
}): NotificationJobAttempt {
  const startedAt = new Date("2026-03-21T10:00:00.000Z");
  return {
    id: randomUUID(),
    notificationJobId: input.notificationJobId,
    attemptNumber: input.attemptNumber,
    processingToken: randomUUID(),
    status: input.status,
    providerKey: "resend-email",
    providerMessageId: input.providerMessageId,
    deliveryStatus: input.deliveryStatus,
    deliveryStatusUpdatedAt: input.deliveryStatusUpdatedAt,
    deliveryStatusMetadata:
      input.providerStatus === null
        ? {}
        : {
            providerStatus: input.providerStatus,
          },
    outcomeCode: null,
    outcomeMessage: null,
    outcomePayload: {},
    startedAt,
    finishedAt:
      input.status === "processing"
        ? null
        : new Date(startedAt.getTime() + input.attemptNumber * 1000),
  };
}

function buildFeedbackEvent(input: {
  providerEventId: string;
  providerMessageId: string;
  providerStatus: string;
  normalizedStatus: NotificationDeliveryFeedbackEvent["normalizedStatus"];
  occurredAt: Date;
  receivedAt: Date;
  organizationId: string;
  notificationJobId: string;
  notificationJobAttemptId: string | null;
}): NotificationDeliveryFeedbackEvent {
  return {
    id: randomUUID(),
    providerKey: "resend-email",
    providerEventId: input.providerEventId,
    providerMessageId: input.providerMessageId,
    providerStatus: input.providerStatus,
    normalizedStatus: input.normalizedStatus,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    organizationId: input.organizationId,
    notificationJobId: input.notificationJobId,
    notificationJobAttemptId: input.notificationJobAttemptId,
    payload: {
      type: input.providerStatus,
    },
  };
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
