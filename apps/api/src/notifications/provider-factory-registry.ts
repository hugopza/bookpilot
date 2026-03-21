import type { NotificationProviderAdapterFactory } from "./organization-configured-notification-delivery-port";
import { createResendEmailNotificationProviderAdapter } from "./email/resend-email-notification-adapter";
import { createLocalDevelopmentNotificationAdapter } from "./local-development-notification-adapter";
import {
  NotificationProviderSetupError,
  type NotificationProviderCredentialsResolver,
} from "./provider-credentials-resolver";

export interface CreateNotificationProviderFactoriesOptions {
  credentialsResolver: NotificationProviderCredentialsResolver;
  localDevelopmentProviderNameFallback: string;
  resendFetchImplementation?: typeof fetch;
}

export function createNotificationProviderFactories(
  options: CreateNotificationProviderFactoriesOptions,
): Record<string, NotificationProviderAdapterFactory> {
  return {
    "local-development": (input) =>
      createLocalDevelopmentNotificationAdapter({
        providerName:
          readOptionalString(input.providerConfig.providerName) ??
          options.localDevelopmentProviderNameFallback,
      }),

    "resend-email": async (input) => {
      if (input.channel !== "email") {
        throw new NotificationProviderSetupError(
          "resend-email provider can only be used with email channel.",
          "PROVIDER_CHANNEL_MISMATCH",
          false,
        );
      }

      const credentials = await options.credentialsResolver.resolve({
        organizationId: input.organizationId,
        channel: input.channel,
        providerKey: input.providerKey,
        providerConfig: input.providerConfig,
      });

      return createResendEmailNotificationProviderAdapter({
        apiKey: requireString(credentials.apiKey, "apiKey"),
        fromEmail: requireString(input.providerConfig.fromEmail, "fromEmail"),
        fromName: readOptionalString(input.providerConfig.fromName),
        replyTo: readOptionalString(input.providerConfig.replyTo),
        subjectPrefix: readOptionalString(input.providerConfig.subjectPrefix),
        apiBaseUrl: readOptionalString(input.providerConfig.apiBaseUrl) ?? undefined,
        fetchImplementation: options.resendFetchImplementation,
      });
    },
  };
}

function requireString(value: unknown, fieldName: string): string {
  const normalized = readOptionalString(value);

  if (!normalized) {
    throw new NotificationProviderSetupError(
      `${fieldName} must be a non-empty string.`,
      "PROVIDER_CONFIGURATION_INVALID",
      false,
    );
  }

  return normalized;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
