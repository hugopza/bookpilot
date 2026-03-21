import type {
  NotificationDeliveryFeedbackReconciliationResult,
  NotificationDeliveryStatus,
} from "../domain/entities";
import { ValidationError } from "../domain/errors";
import type { NotificationFeedbackRepository } from "../repositories";
import { parseDateTime } from "../utils/date-time";

export interface IngestNotificationDeliveryFeedbackInput {
  providerKey: string;
  providerEventId: string;
  providerMessageId: string;
  providerStatus: string;
  normalizedStatus: NotificationDeliveryStatus;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export function createNotificationDeliveryFeedbackService(
  repository: NotificationFeedbackRepository,
) {
  return {
    async ingest(
      input: IngestNotificationDeliveryFeedbackInput,
    ): Promise<NotificationDeliveryFeedbackReconciliationResult> {
      const providerKey = requireNonEmptyString(input.providerKey, "providerKey");
      const providerEventId = requireNonEmptyString(
        input.providerEventId,
        "providerEventId",
      );
      const providerMessageId = requireNonEmptyString(
        input.providerMessageId,
        "providerMessageId",
      );
      const providerStatus = requireNonEmptyString(
        input.providerStatus,
        "providerStatus",
      );
      assertValidDeliveryStatus(input.normalizedStatus);
      const occurredAt = parseDateTime(input.occurredAt, "occurredAt");

      return repository.reconcileNotificationDeliveryFeedback({
        providerKey,
        providerEventId,
        providerMessageId,
        providerStatus,
        normalizedStatus: input.normalizedStatus,
        occurredAt,
        receivedAt: new Date(),
        payload: input.payload ?? {},
      });
    },
  };
}

function requireNonEmptyString(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function assertValidDeliveryStatus(value: NotificationDeliveryStatus): void {
  const validStatuses: NotificationDeliveryStatus[] = [
    "accepted",
    "delivered",
    "deferred",
    "bounced",
    "complained",
    "opened",
    "clicked",
    "failed",
    "unknown",
  ];

  if (!validStatuses.includes(value)) {
    throw new ValidationError("normalizedStatus is invalid.");
  }
}
