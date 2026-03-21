import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import {
  InMemoryBookingCoreRepository,
  createNotificationDeliveryFeedbackService,
  type NotificationDeliveryStatus,
  type NotificationJob,
  type NotificationJobAttempt,
} from "@bookpilot/booking-core";

import {
  normalizeResendEmailFeedbackEvent,
  verifyResendWebhookSignature,
} from "./notifications/email/resend-email-feedback";

const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

async function main(): Promise<void> {
  await runFeedbackReconciliationScenario();
  await runResendNormalizationScenario();
  await runResendSignatureScenario();
  console.log("notification-feedback self-test passed");
}

async function runFeedbackReconciliationScenario(): Promise<void> {
  const notificationJob: NotificationJob = {
    id: randomUUID(),
    organizationId: ORGANIZATION_ID,
    bookingId: randomUUID(),
    customerId: randomUUID(),
    deliveryChannel: "email",
    eventType: "booking_created",
    status: "succeeded",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: new Date("2026-03-21T08:00:00.000Z"),
    processingToken: null,
    processingStartedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    payload: {
      customerEmail: "customer@example.com",
    },
    createdAt: new Date("2026-03-21T08:00:00.000Z"),
    updatedAt: new Date("2026-03-21T08:00:00.000Z"),
  };

  const attempt: NotificationJobAttempt = {
    id: randomUUID(),
    notificationJobId: notificationJob.id,
    attemptNumber: 1,
    processingToken: randomUUID(),
    status: "succeeded",
    providerKey: "resend-email",
    providerMessageId: "resend_message_001",
    deliveryStatus: "accepted",
    deliveryStatusUpdatedAt: new Date("2026-03-21T08:00:00.000Z"),
    deliveryStatusMetadata: {
      providerStatus: "email.sent",
    },
    outcomeCode: null,
    outcomeMessage: null,
    outcomePayload: {},
    startedAt: new Date("2026-03-21T08:00:00.000Z"),
    finishedAt: new Date("2026-03-21T08:00:01.000Z"),
  };

  const repository = new InMemoryBookingCoreRepository({
    notificationJobs: [notificationJob],
    notificationJobAttempts: [attempt],
  });
  const feedbackService = createNotificationDeliveryFeedbackService(repository);

  const delivered = await feedbackService.ingest({
    providerKey: "resend-email",
    providerEventId: "evt_001",
    providerMessageId: "resend_message_001",
    providerStatus: "email.delivered",
    normalizedStatus: "delivered",
    occurredAt: "2026-03-21T08:05:00.000Z",
    payload: {
      type: "email.delivered",
    },
  });

  assert.equal(delivered.duplicate, false);
  assert.equal(delivered.matched, true);
  assert.equal(delivered.updatedAttempt, true);

  const afterDelivered = repository.listPersistedNotificationJobAttempts(
    ORGANIZATION_ID,
  );
  assert.equal(afterDelivered[0]?.deliveryStatus, "delivered");
  assert.equal(
    afterDelivered[0]?.deliveryStatusUpdatedAt?.toISOString(),
    "2026-03-21T08:05:00.000Z",
  );

  const duplicate = await feedbackService.ingest({
    providerKey: "resend-email",
    providerEventId: "evt_001",
    providerMessageId: "resend_message_001",
    providerStatus: "email.delivered",
    normalizedStatus: "delivered",
    occurredAt: "2026-03-21T08:05:00.000Z",
    payload: {
      type: "email.delivered",
    },
  });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.updatedAttempt, false);

  const outOfOrder = await feedbackService.ingest({
    providerKey: "resend-email",
    providerEventId: "evt_002",
    providerMessageId: "resend_message_001",
    providerStatus: "email.opened",
    normalizedStatus: "opened",
    occurredAt: "2026-03-21T08:03:00.000Z",
    payload: {
      type: "email.opened",
    },
  });

  assert.equal(outOfOrder.duplicate, false);
  assert.equal(outOfOrder.matched, true);
  assert.equal(outOfOrder.updatedAttempt, false);

  const afterOutOfOrder = repository.listPersistedNotificationJobAttempts(
    ORGANIZATION_ID,
  );
  assert.equal(afterOutOfOrder[0]?.deliveryStatus, "delivered");

  const unmatched = await feedbackService.ingest({
    providerKey: "resend-email",
    providerEventId: "evt_003",
    providerMessageId: "unknown_message_id",
    providerStatus: "email.bounced",
    normalizedStatus: "bounced",
    occurredAt: "2026-03-21T08:06:00.000Z",
    payload: {
      type: "email.bounced",
    },
  });

  assert.equal(unmatched.duplicate, false);
  assert.equal(unmatched.matched, false);
  assert.equal(unmatched.updatedAttempt, false);

  const events = repository.listPersistedNotificationDeliveryFeedbackEvents();
  assert.equal(events.length, 3);
}

async function runResendNormalizationScenario(): Promise<void> {
  const payload = {
    id: "evt_100",
    type: "email.delivered",
    created_at: "2026-03-21T09:00:00.000Z",
    data: {
      email_id: "resend_message_abc",
    },
  };

  const normalized = normalizeResendEmailFeedbackEvent(
    payload,
    new Date("2026-03-21T09:01:00.000Z"),
  );

  assert.equal(normalized.providerKey, "resend-email");
  assert.equal(normalized.providerEventId, "evt_100");
  assert.equal(normalized.providerMessageId, "resend_message_abc");
  assert.equal(normalized.providerStatus, "email.delivered");
  assert.equal(normalized.normalizedStatus, "delivered");
  assert.equal(normalized.occurredAt, "2026-03-21T09:00:00.000Z");
}

async function runResendSignatureScenario(): Promise<void> {
  const webhookSecretBytes = Buffer.from("bookpilot-secret-bytes");
  const webhookSecret = `whsec_${webhookSecretBytes.toString("base64")}`;
  const svixId = "msg_123";
  const svixTimestamp = `${Math.floor(Date.now() / 1000)}`;
  const rawBody = JSON.stringify({
    id: "evt_200",
    type: "email.delivered",
    data: {
      email_id: "resend_message_200",
    },
  });
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSignature = createHmac("sha256", webhookSecretBytes)
    .update(signedContent)
    .digest("base64");

  const valid = verifyResendWebhookSignature({
    rawBody,
    svixId,
    svixTimestamp,
    svixSignature: `v1,${expectedSignature}`,
    webhookSecret,
  });
  const invalid = verifyResendWebhookSignature({
    rawBody,
    svixId,
    svixTimestamp,
    svixSignature: "v1,invalid",
    webhookSecret,
  });

  assert.equal(valid, true);
  assert.equal(invalid, false);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

void (() => {
  const _ensureStatusCompiles: NotificationDeliveryStatus = "accepted";
  return _ensureStatusCompiles;
})();
