import type {
  NotificationProviderAdapter,
  NotificationProviderFailureResult,
  NotificationProviderRequest,
  NotificationProviderResult,
  NotificationProviderSuccessResult,
} from "./notification-delivery-adapter";

export interface LocalDevelopmentNotificationAdapterOptions {
  providerName?: string;
  now?: () => Date;
}

export function createLocalDevelopmentNotificationAdapter(
  options: LocalDevelopmentNotificationAdapterOptions = {},
): NotificationProviderAdapter {
  const providerName = options.providerName ?? "local-development-provider";
  const now = options.now ?? (() => new Date());

  return {
    name: providerName,
    async send(request: NotificationProviderRequest): Promise<NotificationProviderResult> {
      const simulation = readSimulation(request.payload);

      if (simulation?.mode === "terminal_failure") {
        return createFailureResult({
          retryable: false,
          code: simulation.code ?? "LOCAL_DELIVERY_TERMINAL_FAILURE",
          message: simulation.message ?? "Local adapter simulated terminal failure.",
          providerStatus: "rejected",
          retryDelayMinutes: undefined,
          request,
          now,
        });
      }

      if (simulation?.mode === "retryable_failure") {
        const failUntilAttempt = simulation.failUntilAttempt ?? 1;

        if (request.attemptNumber <= failUntilAttempt) {
          return createFailureResult({
            retryable: true,
            code: simulation.code ?? "LOCAL_DELIVERY_RETRYABLE_FAILURE",
            message: simulation.message ?? "Local adapter simulated retryable failure.",
            providerStatus: "temporary_failure",
            retryDelayMinutes: simulation.retryDelayMinutes ?? 5,
            request,
            now,
          });
        }
      }

      return createSuccessResult(request, now);
    },
  };
}

function createSuccessResult(
  request: NotificationProviderRequest,
  now: () => Date,
): NotificationProviderSuccessResult {
  return {
    outcome: "succeeded",
    providerMessageId: `local-${request.notificationJobId}-${request.attemptNumber}`,
    providerStatus: "accepted",
    metadata: {
      providerRequestId: request.idempotencyKey,
      acceptedAt: now().toISOString(),
    },
  };
}

function createFailureResult(input: {
  retryable: boolean;
  code: string;
  message: string;
  providerStatus: string;
  retryDelayMinutes: number | undefined;
  request: NotificationProviderRequest;
  now: () => Date;
}): NotificationProviderFailureResult {
  return {
    outcome: "failed",
    retryable: input.retryable,
    code: input.code,
    message: input.message,
    providerStatus: input.providerStatus,
    retryDelayMinutes: input.retryDelayMinutes,
    metadata: {
      providerRequestId: input.request.idempotencyKey,
      failedAt: input.now().toISOString(),
    },
  };
}

interface LocalAdapterSimulation {
  mode: "retryable_failure" | "terminal_failure";
  failUntilAttempt?: number;
  retryDelayMinutes?: number;
  code?: string;
  message?: string;
}

function readSimulation(payload: Record<string, unknown>): LocalAdapterSimulation | null {
  const value = payload.localAdapterSimulation;

  if (!isObjectRecord(value)) {
    return null;
  }

  const mode = value.mode;

  if (mode !== "retryable_failure" && mode !== "terminal_failure") {
    return null;
  }

  const failUntilAttempt =
    typeof value.failUntilAttempt === "number" &&
    Number.isInteger(value.failUntilAttempt) &&
    value.failUntilAttempt > 0
      ? value.failUntilAttempt
      : undefined;

  const retryDelayMinutes =
    typeof value.retryDelayMinutes === "number" &&
    Number.isFinite(value.retryDelayMinutes) &&
    value.retryDelayMinutes > 0
      ? value.retryDelayMinutes
      : undefined;

  return {
    mode,
    failUntilAttempt,
    retryDelayMinutes,
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
