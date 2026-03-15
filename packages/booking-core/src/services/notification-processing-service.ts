import type { ClaimedNotificationJob, NotificationJob } from "../domain/entities";
import type { NotificationProcessingRepository } from "../repositories";

const DEFAULT_RETRY_DELAY_MINUTES = 5;
const DEFAULT_STALE_ATTEMPT_MINUTES = 15;

export interface NotificationDeliveryResultSuccess {
  outcome: "succeeded";
  payload?: Record<string, unknown>;
}

export interface NotificationDeliveryResultFailure {
  outcome: "failed";
  retryable: boolean;
  code: string;
  message: string;
  payload?: Record<string, unknown>;
  retryDelayMinutes?: number;
}

export type NotificationDeliveryResult =
  | NotificationDeliveryResultSuccess
  | NotificationDeliveryResultFailure;

export interface NotificationDeliveryPort {
  deliver(job: ClaimedNotificationJob): Promise<NotificationDeliveryResult>;
}

export interface ProcessPendingNotificationJobsInput {
  limit: number;
  now?: Date;
  staleAttemptMinutes?: number;
}

export interface ProcessPendingNotificationJobsResult {
  claimedJobs: number;
  succeededJobs: number;
  failedJobs: number;
  retriedJobs: number;
}

export function createNotificationProcessingService(
  repository: NotificationProcessingRepository,
  deliveryPort: NotificationDeliveryPort,
) {
  return {
    async processPending(
      input: ProcessPendingNotificationJobsInput,
    ): Promise<ProcessPendingNotificationJobsResult> {
      const now = input.now ?? new Date();
      const staleAttemptMinutes =
        input.staleAttemptMinutes ?? DEFAULT_STALE_ATTEMPT_MINUTES;
      const staleBefore = new Date(
        now.getTime() - staleAttemptMinutes * 60 * 1000,
      );

      const claimedJobs = await repository.claimPendingNotificationJobs({
        limit: input.limit,
        now,
        staleBefore,
      });

      let succeededJobs = 0;
      let failedJobs = 0;
      let retriedJobs = 0;

      for (const claimedJob of claimedJobs) {
        const result = await safeDeliver(deliveryPort, claimedJob);

        if (result.outcome === "succeeded") {
          const updatedJob = await repository.markNotificationJobSucceeded({
            notificationJobId: claimedJob.job.id,
            processingToken: claimedJob.attempt.processingToken,
            finishedAt: now,
            outcomePayload: result.payload ?? {},
          });

          if (updatedJob) {
            succeededJobs += 1;
          }

          continue;
        }

        const retryDelayMinutes =
          result.retryDelayMinutes ?? DEFAULT_RETRY_DELAY_MINUTES;
        const retryAt = result.retryable
          ? new Date(now.getTime() + retryDelayMinutes * 60 * 1000)
          : null;
        const updatedJob = await repository.markNotificationJobFailed({
          notificationJobId: claimedJob.job.id,
          processingToken: claimedJob.attempt.processingToken,
          finishedAt: now,
          retryAt,
          shouldRetry: result.retryable,
          errorCode: result.code,
          errorMessage: result.message,
          outcomePayload: result.payload ?? {},
        });

        if (!updatedJob) {
          continue;
        }

        if (updatedJob.status === "pending") {
          retriedJobs += 1;
        } else {
          failedJobs += 1;
        }
      }

      return {
        claimedJobs: claimedJobs.length,
        succeededJobs,
        failedJobs,
        retriedJobs,
      };
    },
  };
}

async function safeDeliver(
  deliveryPort: NotificationDeliveryPort,
  claimedJob: ClaimedNotificationJob,
): Promise<NotificationDeliveryResult> {
  try {
    return await deliveryPort.deliver(claimedJob);
  } catch (error) {
    return {
      outcome: "failed",
      retryable: true,
      code: "UNHANDLED_NOTIFICATION_PROCESSOR_ERROR",
      message: error instanceof Error ? error.message : "Unknown processor error.",
      payload: {},
    };
  }
}

export function createNoopNotificationDeliveryPort(): NotificationDeliveryPort {
  return {
    async deliver(job: ClaimedNotificationJob): Promise<NotificationDeliveryResult> {
      return {
        outcome: "succeeded",
        payload: {
          mode: "noop",
          notificationJobId: job.job.id,
        },
      };
    },
  };
}
