import type { NotificationChannel } from "@bookpilot/booking-core";

export interface ResolveNotificationProviderCredentialsInput {
  organizationId: string;
  channel: NotificationChannel;
  providerKey: string;
  providerConfig: Record<string, unknown>;
}

export interface NotificationProviderCredentialsResolver {
  resolve(
    input: ResolveNotificationProviderCredentialsInput,
  ): Promise<Record<string, unknown>>;
}

export class NotificationProviderSetupError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface EnvironmentNotificationProviderCredentialsResolverOptions {
  env?: NodeJS.ProcessEnv;
  jsonCredentialsEnvVarName?: string;
  envVarPrefix?: string;
}

const DEFAULT_JSON_CREDENTIALS_ENV_VAR_NAME =
  "NOTIFICATION_PROVIDER_CREDENTIALS_JSON";
const DEFAULT_ENV_VAR_PREFIX = "NOTIFICATION_PROVIDER_CREDENTIAL_";

export function createEnvironmentNotificationProviderCredentialsResolver(
  options: EnvironmentNotificationProviderCredentialsResolverOptions = {},
): NotificationProviderCredentialsResolver {
  const env = options.env ?? process.env;
  const jsonCredentialsEnvVarName =
    options.jsonCredentialsEnvVarName ?? DEFAULT_JSON_CREDENTIALS_ENV_VAR_NAME;
  const envVarPrefix = options.envVarPrefix ?? DEFAULT_ENV_VAR_PREFIX;
  const parsedCredentialsByRef = parseCredentialDictionary(
    env[jsonCredentialsEnvVarName],
    jsonCredentialsEnvVarName,
  );

  return {
    async resolve(
      input: ResolveNotificationProviderCredentialsInput,
    ): Promise<Record<string, unknown>> {
      const credentialRef = readCredentialRef(input.providerConfig);
      const fromDictionary = parsedCredentialsByRef[credentialRef];

      if (fromDictionary) {
        return fromDictionary;
      }

      const envVarName = `${envVarPrefix}${toEnvSafeKey(credentialRef)}`;
      const rawEnvValue = env[envVarName];

      if (!rawEnvValue) {
        throw new NotificationProviderSetupError(
          `Credentials were not found for credentialRef "${credentialRef}".`,
          "PROVIDER_CREDENTIALS_NOT_FOUND",
          false,
        );
      }

      return parseSingleCredentialValue(rawEnvValue, envVarName);
    },
  };
}

function readCredentialRef(providerConfig: Record<string, unknown>): string {
  const value = providerConfig.credentialRef;

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NotificationProviderSetupError(
      "providerConfig.credentialRef is required for secure credential resolution.",
      "PROVIDER_CREDENTIAL_REF_MISSING",
      false,
    );
  }

  return value.trim();
}

function parseCredentialDictionary(
  value: string | undefined,
  envVarName: string,
): Record<string, Record<string, unknown>> {
  if (!value || value.trim().length === 0) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new NotificationProviderSetupError(
      `${envVarName} must contain valid JSON.`,
      "PROVIDER_CREDENTIALS_JSON_INVALID",
      false,
    );
  }

  if (!isObjectRecord(parsed)) {
    throw new NotificationProviderSetupError(
      `${envVarName} must be a JSON object keyed by credentialRef.`,
      "PROVIDER_CREDENTIALS_JSON_INVALID",
      false,
    );
  }

  const entries = Object.entries(parsed);
  const normalized: Record<string, Record<string, unknown>> = {};

  for (const [key, entryValue] of entries) {
    if (isObjectRecord(entryValue)) {
      normalized[key] = entryValue;
      continue;
    }

    if (typeof entryValue === "string" && entryValue.trim().length > 0) {
      normalized[key] = {
        apiKey: entryValue.trim(),
      };
      continue;
    }

    throw new NotificationProviderSetupError(
      `Credential entry "${key}" in ${envVarName} must be an object or non-empty string.`,
      "PROVIDER_CREDENTIALS_JSON_INVALID",
      false,
    );
  }

  return normalized;
}

function parseSingleCredentialValue(
  value: string,
  envVarName: string,
): Record<string, unknown> {
  const trimmed = value.trim();

  if (trimmed.startsWith("{")) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new NotificationProviderSetupError(
        `${envVarName} contains invalid JSON.`,
        "PROVIDER_CREDENTIALS_VALUE_INVALID",
        false,
      );
    }

    if (!isObjectRecord(parsed)) {
      throw new NotificationProviderSetupError(
        `${envVarName} JSON must be an object.`,
        "PROVIDER_CREDENTIALS_VALUE_INVALID",
        false,
      );
    }

    return parsed;
  }

  return {
    apiKey: trimmed,
  };
}

function toEnvSafeKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
