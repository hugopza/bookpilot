import type {
  ClaimedNotificationJob,
  NotificationDeliveryPort,
  NotificationDeliveryResult,
} from "@bookpilot/booking-core";

export interface NotificationProviderRequest {
  notificationJobId: string;
  organizationId: string;
  bookingId: string;
  customerId: string;
  eventType: ClaimedNotificationJob["job"]["eventType"];
  attemptNumber: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface NotificationProviderSuccessResult {
  outcome: "succeeded";
  providerMessageId: string;
  providerStatus: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationProviderFailureResult {
  outcome: "failed";
  retryable: boolean;
  code: string;
  message: string;
  providerStatus: string;
  retryDelayMinutes?: number;
  metadata?: Record<string, unknown>;
}

export type NotificationProviderResult =
  | NotificationProviderSuccessResult
  | NotificationProviderFailureResult;

export interface NotificationProviderAdapter {
  readonly name: string;
  send(request: NotificationProviderRequest): Promise<NotificationProviderResult>;
}

export function createAdapterBackedNotificationDeliveryPort(
  adapter: NotificationProviderAdapter,
): NotificationDeliveryPort {
  return {
    async deliver(job: ClaimedNotificationJob): Promise<NotificationDeliveryResult> {
      const request = toProviderRequest(job);
      const attemptedAt = new Date().toISOString();
      const providerResult = await adapter.send(request);

      if (providerResult.outcome === "succeeded") {
        return {
          outcome: "succeeded",
          payload: {
            providerDelivery: {
              provider: adapter.name,
              attemptedAt,
              idempotencyKey: request.idempotencyKey,
              request: {
                notificationJobId: request.notificationJobId,
                eventType: request.eventType,
                attemptNumber: request.attemptNumber,
              },
              result: {
                outcome: "succeeded",
                providerMessageId: providerResult.providerMessageId,
                providerStatus: providerResult.providerStatus,
                metadata: providerResult.metadata ?? {},
              },
            },
          },
        };
      }

      return {
        outcome: "failed",
        retryable: providerResult.retryable,
        code: providerResult.code,
        message: providerResult.message,
        retryDelayMinutes: providerResult.retryDelayMinutes,
        payload: {
          providerDelivery: {
            provider: adapter.name,
            attemptedAt,
            idempotencyKey: request.idempotencyKey,
            request: {
              notificationJobId: request.notificationJobId,
              eventType: request.eventType,
              attemptNumber: request.attemptNumber,
            },
            result: {
              outcome: "failed",
              providerStatus: providerResult.providerStatus,
              code: providerResult.code,
              message: providerResult.message,
              retryable: providerResult.retryable,
              retryDelayMinutes: providerResult.retryDelayMinutes ?? null,
              metadata: providerResult.metadata ?? {},
            },
          },
        },
      };
    },
  };
}

function toProviderRequest(job: ClaimedNotificationJob): NotificationProviderRequest {
  return {
    notificationJobId: job.job.id,
    organizationId: job.job.organizationId,
    bookingId: job.job.bookingId,
    customerId: job.job.customerId,
    eventType: job.job.eventType,
    attemptNumber: job.attempt.attemptNumber,
    idempotencyKey: job.attempt.processingToken,
    payload: job.job.payload,
  };
}
