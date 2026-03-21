import type {
  NotificationProviderAdapter,
  NotificationProviderFailureResult,
  NotificationProviderRequest,
  NotificationProviderResult,
  NotificationProviderSuccessResult,
} from "../notification-delivery-adapter";

type FetchLike = typeof fetch;

export interface ResendEmailNotificationProviderAdapterOptions {
  apiKey: string;
  fromEmail: string;
  fromName?: string | null;
  replyTo?: string | null;
  subjectPrefix?: string | null;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  fetchImplementation?: FetchLike;
}

const DEFAULT_API_BASE_URL = "https://api.resend.com";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

export function createResendEmailNotificationProviderAdapter(
  options: ResendEmailNotificationProviderAdapterOptions,
): NotificationProviderAdapter {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new Error("Fetch implementation is required for Resend adapter.");
  }

  const apiKey = requireNonEmptyString(options.apiKey, "apiKey");
  const fromEmail = requireNonEmptyString(options.fromEmail, "fromEmail");
  const fromName = normalizeOptionalString(options.fromName);
  const replyTo = normalizeOptionalString(options.replyTo);
  const subjectPrefix = normalizeOptionalString(options.subjectPrefix);
  const apiBaseUrl = normalizeApiBaseUrl(
    options.apiBaseUrl ?? DEFAULT_API_BASE_URL,
  );
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return {
    name: "resend-email",
    async send(request: NotificationProviderRequest): Promise<NotificationProviderResult> {
      const toEmail = resolveRecipientEmail(request.payload);

      if (!toEmail) {
        return {
          outcome: "failed",
          retryable: false,
          code: "RECIPIENT_EMAIL_MISSING",
          message: "Notification payload did not include a recipient email.",
          providerStatus: "invalid_request",
          metadata: {
            provider: "resend-email",
            eventType: request.eventType,
            channel: request.channel,
          },
        };
      }

      const subject = buildSubject(request, subjectPrefix);
      const text = buildTextBody(request);
      const fromValue = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
      const requestBody = {
        from: fromValue,
        to: [toEmail],
        subject,
        text,
        headers: {
          "X-BookPilot-Idempotency-Key": request.idempotencyKey,
        },
        ...(replyTo ? { reply_to: replyTo } : {}),
      };

      try {
        const response = await fetchWithTimeout(fetchImplementation, requestTimeoutMs, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }, `${apiBaseUrl}/emails`);

        const responseBody = await parseJsonSafe(response);

        if (response.ok) {
          const providerMessageId =
            typeof responseBody.id === "string"
              ? responseBody.id
              : `resend-${request.notificationJobId}-${request.attemptNumber}`;

          return {
            outcome: "succeeded",
            providerMessageId,
            providerStatus: "accepted",
            metadata: {
              httpStatus: response.status,
              id: responseBody.id ?? null,
              to: toEmail,
            },
          };
        }

        return normalizeHttpFailure(response.status, responseBody);
      } catch (error) {
        return normalizeException(error);
      }
    },
  };
}

async function fetchWithTimeout(
  fetchImplementation: FetchLike,
  timeoutMs: number,
  init: RequestInit,
  url: string,
): Promise<Response> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    return await fetchImplementation(url, {
      ...init,
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonSafe(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeHttpFailure(
  status: number,
  responseBody: Record<string, unknown>,
): NotificationProviderFailureResult {
  const message = readResponseErrorMessage(responseBody) ?? `Resend HTTP ${status}.`;
  const retryable = status >= 500 || status === 429 || status === 408;

  return {
    outcome: "failed",
    retryable,
    code: `RESEND_HTTP_${status}`,
    message,
    providerStatus: `http_${status}`,
    metadata: {
      httpStatus: status,
      error: responseBody.error ?? null,
      message: responseBody.message ?? null,
    },
  };
}

function normalizeException(error: unknown): NotificationProviderFailureResult {
  if (error instanceof Error && error.name === "AbortError") {
    return {
      outcome: "failed",
      retryable: true,
      code: "RESEND_TIMEOUT",
      message: "Resend request timed out.",
      providerStatus: "timeout",
      metadata: {},
    };
  }

  return {
    outcome: "failed",
    retryable: true,
    code: "RESEND_NETWORK_ERROR",
    message: error instanceof Error ? error.message : "Unknown network error.",
    providerStatus: "network_error",
    metadata: {},
  };
}

function resolveRecipientEmail(payload: Record<string, unknown>): string | null {
  const direct = readNonEmptyString(payload.customerEmail);

  if (direct) {
    return direct;
  }

  return readNonEmptyString(payload.recipientEmail);
}

function buildSubject(
  request: NotificationProviderRequest,
  subjectPrefix: string | null,
): string {
  const custom = readNonEmptyString(request.payload.subject);
  const baseSubject =
    custom ??
    {
      booking_created: "Booking confirmation",
      booking_cancelled: "Booking cancellation",
      booking_rescheduled: "Booking reschedule confirmation",
    }[request.eventType];

  if (subjectPrefix) {
    return `${subjectPrefix} ${baseSubject}`;
  }

  return baseSubject;
}

function buildTextBody(request: NotificationProviderRequest): string {
  const custom = readNonEmptyString(request.payload.text);

  if (custom) {
    return custom;
  }

  return [
    `Event: ${request.eventType}`,
    `Booking ID: ${request.bookingId}`,
    `Organization ID: ${request.organizationId}`,
    `Customer ID: ${request.customerId}`,
  ].join("\n");
}

function readResponseErrorMessage(
  responseBody: Record<string, unknown>,
): string | null {
  const value = responseBody.message;

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = readNonEmptyString(value);

  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  return value ? readNonEmptyString(value) : null;
}

function normalizeApiBaseUrl(value: string): string {
  const normalized = requireNonEmptyString(value, "apiBaseUrl");
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
