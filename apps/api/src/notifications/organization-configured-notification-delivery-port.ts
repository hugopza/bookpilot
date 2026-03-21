import type {
  ClaimedNotificationJob,
  NotificationChannel,
  NotificationDeliveryPort,
  NotificationDeliveryResult,
  OrganizationNotificationChannelConfiguration,
} from "@bookpilot/booking-core";

import {
  createAdapterBackedNotificationDeliveryPort,
  type NotificationProviderAdapter,
} from "./notification-delivery-adapter";

export interface NotificationProviderAdapterFactoryInput {
  organizationId: string;
  channel: NotificationChannel;
  providerKey: string;
  providerConfig: Record<string, unknown>;
}

export type NotificationProviderAdapterFactory = (
  input: NotificationProviderAdapterFactoryInput,
) => NotificationProviderAdapter;

export interface OrganizationNotificationChannelConfigurationReader {
  getOrganizationNotificationChannelConfiguration(
    organizationId: string,
    channel: NotificationChannel,
  ): Promise<OrganizationNotificationChannelConfiguration | null>;
}

export interface OrganizationConfiguredNotificationDeliveryPortOptions {
  configurationReader: OrganizationNotificationChannelConfigurationReader;
  providerFactories: Record<string, NotificationProviderAdapterFactory>;
}

export function createOrganizationConfiguredNotificationDeliveryPort(
  options: OrganizationConfiguredNotificationDeliveryPortOptions,
): NotificationDeliveryPort {
  const adapterCache = new Map<string, NotificationProviderAdapter>();

  return {
    async deliver(job: ClaimedNotificationJob): Promise<NotificationDeliveryResult> {
      const channel = job.job.deliveryChannel;
      const configuration =
        await options.configurationReader.getOrganizationNotificationChannelConfiguration(
          job.job.organizationId,
          channel,
        );

      if (!configuration) {
        return failureResult(
          "NOTIFICATION_CHANNEL_NOT_CONFIGURED",
          "Notification channel is not configured for organization.",
          channel,
        );
      }

      if (!configuration.enabled) {
        return failureResult(
          "NOTIFICATION_CHANNEL_DISABLED",
          "Notification channel is disabled for organization.",
          channel,
        );
      }

      if (!configuration.notificationProviderKey) {
        return failureResult(
          "NOTIFICATION_PROVIDER_NOT_CONFIGURED",
          "Notification provider is not configured for organization channel.",
          channel,
        );
      }

      const providerFactory =
        options.providerFactories[configuration.notificationProviderKey];

      if (!providerFactory) {
        return failureResult(
          "NOTIFICATION_PROVIDER_NOT_REGISTERED",
          "Configured notification provider is not registered in worker.",
          channel,
          configuration.notificationProviderKey,
        );
      }

      const adapter = getCachedAdapter(
        adapterCache,
        configuration,
        providerFactory,
      );
      const deliveryPort = createAdapterBackedNotificationDeliveryPort(adapter);
      return deliveryPort.deliver(job);
    },
  };
}

function getCachedAdapter(
  cache: Map<string, NotificationProviderAdapter>,
  configuration: OrganizationNotificationChannelConfiguration,
  factory: NotificationProviderAdapterFactory,
): NotificationProviderAdapter {
  const cacheKey = `${configuration.organizationId}:${configuration.channel}:${configuration.notificationProviderKey}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const created = factory({
    organizationId: configuration.organizationId,
    channel: configuration.channel,
    providerKey: configuration.notificationProviderKey ?? "",
    providerConfig: configuration.providerConfig,
  });
  cache.set(cacheKey, created);
  return created;
}

function failureResult(
  code: string,
  message: string,
  channel: NotificationChannel,
  providerKey?: string,
): NotificationDeliveryResult {
  return {
    outcome: "failed",
    retryable: false,
    code,
    message,
    payload: {
      providerResolution: {
        channel,
        providerKey: providerKey ?? null,
      },
    },
  };
}
