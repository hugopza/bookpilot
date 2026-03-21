import type {
  BookingEventType,
  NotificationChannel,
  NotificationDeliveryFeedbackEvent,
  NotificationDeliveryStatus,
  NotificationJob,
  NotificationJobAttempt,
  NotificationJobLatestDeliveryStatus,
} from "../domain/entities";
import { NotFoundError, ValidationError } from "../domain/errors";
import type { NotificationObservabilityRepository } from "../repositories";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListNotificationDeliveryObservabilityJobsInput {
  organizationId: string;
  status?: NotificationJob["status"];
  deliveryChannel?: NotificationChannel;
  eventType?: BookingEventType;
  limit?: number;
}

export interface GetNotificationDeliveryObservabilityJobInput {
  organizationId: string;
  notificationJobId: string;
}

export interface NotificationDeliveryObservabilityJobSummary {
  id: string;
  bookingId: string;
  customerId: string;
  deliveryChannel: NotificationChannel;
  eventType: BookingEventType;
  status: NotificationJob["status"];
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  processingStartedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationDeliveryLatestStatusSummary {
  notificationJobAttemptId: string | null;
  providerMessageId: string | null;
  normalizedStatus: NotificationDeliveryStatus | null;
  providerStatus: string | null;
  occurredAt: Date | null;
}

export interface NotificationDeliveryObservabilityJobListItem {
  job: NotificationDeliveryObservabilityJobSummary;
  latestDeliveryStatus: NotificationDeliveryLatestStatusSummary;
}

export interface NotificationDeliveryObservabilityAttemptSummary {
  id: string;
  attemptNumber: number;
  status: NotificationJobAttempt["status"];
  providerKey: string | null;
  providerMessageId: string | null;
  deliveryStatus: NotificationDeliveryStatus | null;
  deliveryStatusUpdatedAt: Date | null;
  deliveryStatusMetadata: Record<string, unknown>;
  outcomeCode: string | null;
  outcomeMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface NotificationDeliveryObservabilityFeedbackTimelineEntry {
  id: string;
  providerKey: string;
  providerEventId: string;
  providerMessageId: string;
  providerStatus: string;
  normalizedStatus: NotificationDeliveryStatus;
  occurredAt: Date;
  receivedAt: Date;
  notificationJobAttemptId: string | null;
}

export interface NotificationDeliveryObservabilityJobDetails {
  organizationId: string;
  notificationJobId: string;
  job: NotificationDeliveryObservabilityJobSummary;
  latestDeliveryStatus: NotificationDeliveryLatestStatusSummary;
  attempts: NotificationDeliveryObservabilityAttemptSummary[];
  feedbackTimeline: NotificationDeliveryObservabilityFeedbackTimelineEntry[];
}

export function createNotificationDeliveryObservabilityService(
  repository: NotificationObservabilityRepository,
) {
  return {
    async listOrganizationJobs(
      input: ListNotificationDeliveryObservabilityJobsInput,
    ): Promise<NotificationDeliveryObservabilityJobListItem[]> {
      await requireOrganization(repository, input.organizationId);
      assertValidNotificationJobStatus(input.status);
      assertValidNotificationChannel(input.deliveryChannel);
      assertValidBookingEventType(input.eventType);
      const limit = parseListLimit(input.limit);

      const entries =
        await repository.listOrganizationNotificationJobsWithLatestDeliveryStatus({
          organizationId: input.organizationId,
          status: input.status,
          deliveryChannel: input.deliveryChannel,
          eventType: input.eventType,
          limit,
        });

      return entries.map((entry) => ({
        job: asJobSummary(entry.job),
        latestDeliveryStatus: asLatestDeliveryStatusSummary(
          entry.latestDeliveryStatus,
        ),
      }));
    },

    async getOrganizationJob(
      input: GetNotificationDeliveryObservabilityJobInput,
    ): Promise<NotificationDeliveryObservabilityJobDetails> {
      await requireOrganization(repository, input.organizationId);
      const notificationJob =
        await repository.getOrganizationNotificationJobWithLatestDeliveryStatus({
          organizationId: input.organizationId,
          notificationJobId: input.notificationJobId,
        });

      if (!notificationJob) {
        throw new NotFoundError("Notification job was not found.");
      }

      const [attempts, feedbackTimeline] = await Promise.all([
        repository.listOrganizationNotificationJobAttempts({
          organizationId: input.organizationId,
          notificationJobId: input.notificationJobId,
        }),
        repository.listOrganizationNotificationDeliveryFeedbackEvents({
          organizationId: input.organizationId,
          notificationJobId: input.notificationJobId,
        }),
      ]);

      return {
        organizationId: input.organizationId,
        notificationJobId: input.notificationJobId,
        job: asJobSummary(notificationJob.job),
        latestDeliveryStatus: asLatestDeliveryStatusSummary(
          notificationJob.latestDeliveryStatus,
        ),
        attempts: attempts.map(asAttemptSummary),
        feedbackTimeline: feedbackTimeline.map(asFeedbackTimelineEntry),
      };
    },
  };
}

async function requireOrganization(
  repository: Pick<NotificationObservabilityRepository, "getOrganization">,
  organizationId: string,
): Promise<void> {
  const organization = await repository.getOrganization(organizationId);

  if (!organization) {
    throw new NotFoundError("Organization was not found.");
  }
}

function parseListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIST_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ValidationError("limit must be a positive integer.");
  }

  if (limit > MAX_LIST_LIMIT) {
    throw new ValidationError(`limit cannot be greater than ${MAX_LIST_LIMIT}.`);
  }

  return limit;
}

function assertValidNotificationJobStatus(
  status: NotificationJob["status"] | undefined,
): void {
  if (status === undefined) {
    return;
  }

  const validStatuses: NotificationJob["status"][] = [
    "pending",
    "processing",
    "succeeded",
    "failed",
  ];

  if (!validStatuses.includes(status)) {
    throw new ValidationError("status is invalid.");
  }
}

function assertValidNotificationChannel(
  deliveryChannel: NotificationChannel | undefined,
): void {
  if (deliveryChannel === undefined) {
    return;
  }

  const validChannels: NotificationChannel[] = [
    "whatsapp",
    "sms",
    "email",
    "push",
    "voice",
  ];

  if (!validChannels.includes(deliveryChannel)) {
    throw new ValidationError("deliveryChannel is invalid.");
  }
}

function assertValidBookingEventType(eventType: BookingEventType | undefined): void {
  if (eventType === undefined) {
    return;
  }

  const validEventTypes: BookingEventType[] = [
    "booking_created",
    "booking_cancelled",
    "booking_rescheduled",
  ];

  if (!validEventTypes.includes(eventType)) {
    throw new ValidationError("eventType is invalid.");
  }
}

function asJobSummary(
  job: NotificationJob,
): NotificationDeliveryObservabilityJobSummary {
  return {
    id: job.id,
    bookingId: job.bookingId,
    customerId: job.customerId,
    deliveryChannel: job.deliveryChannel,
    eventType: job.eventType,
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt,
    processingStartedAt: job.processingStartedAt,
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function asLatestDeliveryStatusSummary(
  value: NotificationJobLatestDeliveryStatus,
): NotificationDeliveryLatestStatusSummary {
  return {
    notificationJobAttemptId: value.notificationJobAttemptId,
    providerMessageId: value.providerMessageId,
    normalizedStatus: value.normalizedStatus,
    providerStatus: value.providerStatus,
    occurredAt: value.occurredAt,
  };
}

function asAttemptSummary(
  attempt: NotificationJobAttempt,
): NotificationDeliveryObservabilityAttemptSummary {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    providerKey: attempt.providerKey,
    providerMessageId: attempt.providerMessageId,
    deliveryStatus: attempt.deliveryStatus,
    deliveryStatusUpdatedAt: attempt.deliveryStatusUpdatedAt,
    deliveryStatusMetadata: attempt.deliveryStatusMetadata,
    outcomeCode: attempt.outcomeCode,
    outcomeMessage: attempt.outcomeMessage,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
  };
}

function asFeedbackTimelineEntry(
  event: NotificationDeliveryFeedbackEvent,
): NotificationDeliveryObservabilityFeedbackTimelineEntry {
  return {
    id: event.id,
    providerKey: event.providerKey,
    providerEventId: event.providerEventId,
    providerMessageId: event.providerMessageId,
    providerStatus: event.providerStatus,
    normalizedStatus: event.normalizedStatus,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    notificationJobAttemptId: event.notificationJobAttemptId,
  };
}
