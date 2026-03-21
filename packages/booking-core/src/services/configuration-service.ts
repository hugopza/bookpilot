import type {
  AvailabilityRule,
  NotificationChannel,
  Organization,
  OrganizationNotificationChannelConfiguration,
  Service,
  StaffMember,
  TimeOff,
} from "../domain/entities";
import { NotFoundError, ValidationError } from "../domain/errors";
import type { ConfigurationRepository } from "../repositories";
import { parseDateTime } from "../utils/date-time";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  timeZone?: string;
}

export interface CreateServiceInput {
  organizationId: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  active?: boolean;
}

export interface CreateStaffMemberInput {
  organizationId: string;
  fullName: string;
  active?: boolean;
}

export interface CreateAvailabilityRuleInput {
  organizationId: string;
  staffMemberId?: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive?: boolean;
}

export interface CreateTimeOffInput {
  organizationId: string;
  staffMemberId?: string | null;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
}

export interface UpsertOrganizationNotificationChannelConfigurationInput {
  organizationId: string;
  channel: NotificationChannel;
  enabled: boolean;
  notificationProviderKey?: string | null;
  providerConfig?: Record<string, unknown>;
}

export function createOrganizationConfigurationService(
  repository: ConfigurationRepository,
) {
  return {
    async list(): Promise<Organization[]> {
      return repository.listOrganizations();
    },

    async create(input: CreateOrganizationInput): Promise<Organization> {
      const name = requireNonEmptyTrimmedString(input.name, "name");
      const slug = requireSlug(input.slug);
      const timeZone = requireNonEmptyTrimmedString(
        input.timeZone ?? "UTC",
        "timeZone",
      );

      return repository.createOrganization({
        name,
        slug,
        timeZone,
      });
    },
  };
}

export function createServiceConfigurationService(
  repository: ConfigurationRepository,
) {
  return {
    async list(organizationId: string): Promise<Service[]> {
      await requireOrganization(repository, organizationId);
      return repository.listServices(organizationId);
    },

    async create(input: CreateServiceInput): Promise<Service> {
      await requireOrganization(repository, input.organizationId);

      const name = requireNonEmptyTrimmedString(input.name, "name");
      const durationMinutes = requirePositiveInteger(
        input.durationMinutes,
        "durationMinutes",
      );

      return repository.createService({
        organizationId: input.organizationId,
        name,
        description: normalizeOptionalString(input.description),
        durationMinutes,
        active: input.active ?? true,
      });
    },
  };
}

export function createStaffMemberConfigurationService(
  repository: ConfigurationRepository,
) {
  return {
    async list(organizationId: string): Promise<StaffMember[]> {
      await requireOrganization(repository, organizationId);
      return repository.listStaffMembers(organizationId);
    },

    async create(input: CreateStaffMemberInput): Promise<StaffMember> {
      await requireOrganization(repository, input.organizationId);

      return repository.createStaffMember({
        organizationId: input.organizationId,
        fullName: requireNonEmptyTrimmedString(input.fullName, "fullName"),
        active: input.active ?? true,
      });
    },
  };
}

export function createAvailabilityRuleConfigurationService(
  repository: ConfigurationRepository,
) {
  return {
    async list(organizationId: string): Promise<AvailabilityRule[]> {
      await requireOrganization(repository, organizationId);
      return repository.listConfigurationAvailabilityRules(organizationId);
    },

    async create(input: CreateAvailabilityRuleInput): Promise<AvailabilityRule> {
      await requireOrganization(repository, input.organizationId);

      const staffMemberId = normalizeOptionalString(input.staffMemberId);

      if (staffMemberId) {
        await requireStaffMember(repository, input.organizationId, staffMemberId);
      }

      requireDayOfWeek(input.dayOfWeek);
      assertValidTimeRange(input.startTime, input.endTime);

      return repository.createAvailabilityRule({
        organizationId: input.organizationId,
        staffMemberId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        isActive: input.isActive ?? true,
      });
    },
  };
}

export function createTimeOffConfigurationService(
  repository: ConfigurationRepository,
) {
  return {
    async list(organizationId: string): Promise<TimeOff[]> {
      await requireOrganization(repository, organizationId);
      return repository.listConfigurationTimeOffs(organizationId);
    },

    async create(input: CreateTimeOffInput): Promise<TimeOff> {
      await requireOrganization(repository, input.organizationId);

      const staffMemberId = normalizeOptionalString(input.staffMemberId);

      if (staffMemberId) {
        await requireStaffMember(repository, input.organizationId, staffMemberId);
      }

      const startsAt = parseDateTime(input.startsAt, "startsAt");
      const endsAt = parseDateTime(input.endsAt, "endsAt");

      if (endsAt <= startsAt) {
        throw new ValidationError("endsAt must be later than startsAt.");
      }

      return repository.createTimeOff({
        organizationId: input.organizationId,
        staffMemberId,
        startsAt,
        endsAt,
        reason: normalizeOptionalString(input.reason),
      });
    },
  };
}

export function createNotificationChannelConfigurationService(
  repository: ConfigurationRepository,
) {
  return {
    async list(
      organizationId: string,
    ): Promise<OrganizationNotificationChannelConfiguration[]> {
      await requireOrganization(repository, organizationId);
      return repository.listOrganizationNotificationChannelConfigurations(
        organizationId,
      );
    },

    async get(
      organizationId: string,
      channel: NotificationChannel,
    ): Promise<OrganizationNotificationChannelConfiguration | null> {
      await requireOrganization(repository, organizationId);
      assertValidNotificationChannel(channel);
      return repository.getOrganizationNotificationChannelConfiguration(
        organizationId,
        channel,
      );
    },

    async upsert(
      input: UpsertOrganizationNotificationChannelConfigurationInput,
    ): Promise<OrganizationNotificationChannelConfiguration> {
      await requireOrganization(repository, input.organizationId);
      assertValidNotificationChannel(input.channel);

      const notificationProviderKey = normalizeOptionalString(
        input.notificationProviderKey,
      );
      const providerConfig = requireRecord(input.providerConfig ?? {}, "providerConfig");

      if (input.enabled && !notificationProviderKey) {
        throw new ValidationError(
          "notificationProviderKey is required when the channel is enabled.",
        );
      }

      return repository.upsertOrganizationNotificationChannelConfiguration({
        organizationId: input.organizationId,
        channel: input.channel,
        enabled: input.enabled,
        notificationProviderKey,
        providerConfig,
      });
    },
  };
}

async function requireOrganization(
  repository: ConfigurationRepository,
  organizationId: string,
): Promise<void> {
  const organization = await repository.getOrganization(organizationId);

  if (!organization) {
    throw new NotFoundError("Organization was not found.");
  }
}

async function requireStaffMember(
  repository: ConfigurationRepository,
  organizationId: string,
  staffMemberId: string,
): Promise<void> {
  const staffMember = await repository.getStaffMember(organizationId, staffMemberId);

  if (!staffMember) {
    throw new NotFoundError("Staff member was not found.");
  }
}

function requireNonEmptyTrimmedString(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireSlug(value: string): string {
  const slug = requireNonEmptyTrimmedString(value, "slug");

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ValidationError(
      "slug must contain only lowercase letters, numbers, and hyphens.",
    );
  }

  return slug;
}

function requirePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function requireDayOfWeek(dayOfWeek: number): void {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new ValidationError("dayOfWeek must be an integer between 0 and 6.");
  }
}

function assertValidTimeRange(startTime: string, endTime: string): void {
  const startSeconds = parseTimeToSeconds(startTime, "startTime");
  const endSeconds = parseTimeToSeconds(endTime, "endTime");

  if (endSeconds <= startSeconds) {
    throw new ValidationError("endTime must be later than startTime.");
  }
}

function parseTimeToSeconds(value: string, fieldName: string): number {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    throw new ValidationError(`${fieldName} must be in HH:MM or HH:MM:SS format.`);
  }

  const [hoursText, minutesText, secondsText = "00"] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);

  if (
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    throw new ValidationError(`${fieldName} is invalid.`);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function requireRecord(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertValidNotificationChannel(channel: NotificationChannel): void {
  const validChannels: NotificationChannel[] = [
    "whatsapp",
    "sms",
    "email",
    "push",
    "voice",
  ];

  if (!validChannels.includes(channel)) {
    throw new ValidationError("channel is invalid.");
  }
}
