import { createHmac, timingSafeEqual } from "node:crypto";

import type { NotificationDeliveryStatus } from "@bookpilot/booking-core";
import { ValidationError } from "@bookpilot/booking-core";

export interface NormalizedResendEmailFeedbackEvent {
  providerKey: "resend-email";
  providerEventId: string;
  providerMessageId: string;
  providerStatus: string;
  normalizedStatus: NotificationDeliveryStatus;
  occurredAt: string;
  payload: Record<string, unknown>;
}

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export function normalizeResendEmailFeedbackEvent(
  payload: unknown,
  fallbackOccurredAt: Date,
): NormalizedResendEmailFeedbackEvent {
  const record = asRecord(payload, "webhook payload");
  const providerStatus = readEventType(record);
  const providerMessageId = readProviderMessageId(record);
  const occurredAt = readOccurredAt(record, fallbackOccurredAt);
  const providerEventId =
    readNonEmptyString(record.id) ??
    `${providerMessageId}:${providerStatus}:${occurredAt}`;

  return {
    providerKey: "resend-email",
    providerEventId,
    providerMessageId,
    providerStatus,
    normalizedStatus: normalizeProviderStatus(providerStatus),
    occurredAt,
    payload: record,
  };
}

export function verifyResendWebhookSignature(input: {
  rawBody: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  webhookSecret: string;
}): boolean {
  if (!input.svixId || !input.svixTimestamp || !input.svixSignature) {
    return false;
  }

  const timestamp = Number.parseInt(input.svixTimestamp, 10);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }

  const signingSecret = decodeWebhookSecret(input.webhookSecret);
  const signedContent = `${input.svixId}.${input.svixTimestamp}.${input.rawBody}`;
  const expected = createHmac("sha256", signingSecret)
    .update(signedContent)
    .digest("base64");
  const receivedSignatures = extractSvixSignatures(input.svixSignature);

  return receivedSignatures.some((candidate) => secureEquals(candidate, expected));
}

function normalizeProviderStatus(providerStatus: string): NotificationDeliveryStatus {
  const normalized = providerStatus.trim().toLowerCase();

  const mapping: Record<string, NotificationDeliveryStatus> = {
    "email.sent": "accepted",
    "email.delivered": "delivered",
    "email.delivery_delayed": "deferred",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.opened": "opened",
    "email.clicked": "clicked",
    "email.failed": "failed",
  };

  return mapping[normalized] ?? "unknown";
}

function readEventType(record: Record<string, unknown>): string {
  const directType = readNonEmptyString(record.type);

  if (directType) {
    return directType;
  }

  const directEvent = readNonEmptyString(record.event);

  if (directEvent) {
    return directEvent;
  }

  throw new ValidationError("Resend webhook payload missing event type.");
}

function readProviderMessageId(record: Record<string, unknown>): string {
  const dataRecord = readObjectRecord(record.data);
  const candidates = [
    readNonEmptyString(record.email_id),
    dataRecord ? readNonEmptyString(dataRecord.email_id) : null,
    dataRecord ? readNonEmptyString(dataRecord.emailId) : null,
  ];
  const providerMessageId = candidates.find((value) => value !== null);

  if (!providerMessageId) {
    throw new ValidationError("Resend webhook payload missing provider message id.");
  }

  return providerMessageId;
}

function readOccurredAt(
  record: Record<string, unknown>,
  fallbackOccurredAt: Date,
): string {
  const dataRecord = readObjectRecord(record.data);
  const candidate =
    readNonEmptyString(record.created_at) ??
    readNonEmptyString(record.createdAt) ??
    (dataRecord ? readNonEmptyString(dataRecord.created_at) : null) ??
    (dataRecord ? readNonEmptyString(dataRecord.createdAt) : null);

  if (!candidate) {
    return fallbackOccurredAt.toISOString();
  }

  const parsed = new Date(candidate);

  if (Number.isNaN(parsed.getTime())) {
    return fallbackOccurredAt.toISOString();
  }

  return parsed.toISOString();
}

function extractSvixSignatures(signatureHeader: string): string[] {
  const matches = signatureHeader.matchAll(/v1,([A-Za-z0-9+/=]+)/g);
  return [...matches]
    .map((match) => match[1] ?? "")
    .filter((value) => value.length > 0);
}

function decodeWebhookSecret(secret: string): Buffer {
  if (secret.startsWith("whsec_")) {
    return Buffer.from(secret.slice("whsec_".length), "base64");
  }

  return Buffer.from(secret, "utf8");
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
