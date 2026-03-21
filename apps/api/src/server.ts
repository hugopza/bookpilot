import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  type AvailabilityLookupInput,
  ConflictError,
  createAvailabilityRuleConfigurationService,
  createBookingManagementService,
  createNotificationChannelConfigurationService,
  type CreateBookingInput,
  type NotificationChannel,
  createOrganizationConfigurationService,
  createServiceConfigurationService,
  createStaffMemberConfigurationService,
  createTimeOffConfigurationService,
  DomainError,
  NotFoundError,
  ValidationError,
  createAvailabilityService,
  createBookingService,
} from "@bookpilot/booking-core";
import { Pool } from "pg";

import { PostgresBookingCoreRepository } from "./postgres-booking-core-repository";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to start the API.");
}

const repository = new PostgresBookingCoreRepository(
  new Pool({
    connectionString: databaseUrl,
  }),
);

const availabilityService = createAvailabilityService(repository);
const bookingService = createBookingService(repository);
const bookingManagementService = createBookingManagementService(repository);
const organizationConfigurationService =
  createOrganizationConfigurationService(repository);
const serviceConfigurationService = createServiceConfigurationService(repository);
const staffMemberConfigurationService =
  createStaffMemberConfigurationService(repository);
const availabilityRuleConfigurationService =
  createAvailabilityRuleConfigurationService(repository);
const timeOffConfigurationService = createTimeOffConfigurationService(repository);
const notificationChannelConfigurationService =
  createNotificationChannelConfigurationService(repository);
const port = Number(process.env.PORT ?? "3001");

const server = createServer(async (request, response) => {
  try {
    const url = getRequestUrl(request);
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/health") {
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && pathname === "/organizations") {
      const result = await organizationConfigurationService.list();
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/organizations") {
      const payload = await readJsonBody(request);
      const result = await organizationConfigurationService.create(
        asCreateOrganizationInput(payload),
      );
      writeJson(response, 201, result);
      return;
    }

    if (request.method === "POST" && pathname === "/availability/search") {
      const payload = await readJsonBody(request);
      const result = await availabilityService.lookup(
        asAvailabilityLookupInput(payload),
      );
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/bookings") {
      const payload = await readJsonBody(request);
      const result = await bookingService.create(asCreateBookingInput(payload));
      writeJson(response, 201, result);
      return;
    }

    const organizationResource = matchOrganizationResource(pathname);

    if (organizationResource) {
      const { organizationId, resource } = organizationResource;

      if (request.method === "GET" && resource === "services") {
        const result = await serviceConfigurationService.list(organizationId);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && resource === "services") {
        const payload = await readJsonBody(request);
        const result = await serviceConfigurationService.create(
          asCreateServiceConfigurationInput(payload, organizationId),
        );
        writeJson(response, 201, result);
        return;
      }

      if (request.method === "GET" && resource === "staff-members") {
        const result = await staffMemberConfigurationService.list(organizationId);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && resource === "staff-members") {
        const payload = await readJsonBody(request);
        const result = await staffMemberConfigurationService.create(
          asCreateStaffMemberConfigurationInput(payload, organizationId),
        );
        writeJson(response, 201, result);
        return;
      }

      if (request.method === "GET" && resource === "availability-rules") {
        const result = await availabilityRuleConfigurationService.list(
          organizationId,
        );
        writeJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && resource === "availability-rules") {
        const payload = await readJsonBody(request);
        const result = await availabilityRuleConfigurationService.create(
          asCreateAvailabilityRuleConfigurationInput(payload, organizationId),
        );
        writeJson(response, 201, result);
        return;
      }

      if (request.method === "GET" && resource === "time-off") {
        const result = await timeOffConfigurationService.list(organizationId);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && resource === "time-off") {
        const payload = await readJsonBody(request);
        const result = await timeOffConfigurationService.create(
          asCreateTimeOffConfigurationInput(payload, organizationId),
        );
        writeJson(response, 201, result);
        return;
      }

      if (request.method === "GET" && resource === "bookings") {
        const result = await bookingManagementService.list(
          asListBookingsInput(url.searchParams, organizationId),
        );
        writeJson(response, 200, result);
        return;
      }

      if (
        request.method === "GET" &&
        resource === "notification-channel-configurations"
      ) {
        const result = await notificationChannelConfigurationService.list(
          organizationId,
        );
        writeJson(response, 200, result);
        return;
      }
    }

    const notificationChannelConfigurationAction =
      matchOrganizationNotificationChannelConfigurationAction(pathname);

    if (notificationChannelConfigurationAction) {
      const { organizationId, channel } = notificationChannelConfigurationAction;

      if (request.method === "GET") {
        const result = await notificationChannelConfigurationService.get(
          organizationId,
          channel,
        );

        if (!result) {
          writeJson(response, 404, { error: "Not found" });
          return;
        }

        writeJson(response, 200, result);
        return;
      }

      if (request.method === "PUT") {
        const payload = await readJsonBody(request);
        const result = await notificationChannelConfigurationService.upsert(
          asUpsertNotificationChannelConfigurationInput(
            payload,
            organizationId,
            channel,
          ),
        );
        writeJson(response, 200, result);
        return;
      }
    }

    const bookingAction = matchBookingAction(pathname);

    if (bookingAction) {
      const { organizationId, bookingId, action } = bookingAction;

      if (request.method === "POST" && action === "cancel") {
        const result = await bookingManagementService.cancel({
          organizationId,
          bookingId,
        });
        writeJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && action === "reschedule") {
        const payload = await readJsonBody(request);
        const result = await bookingManagementService.reschedule(
          asRescheduleBookingInput(payload, organizationId, bookingId),
        );
        writeJson(response, 200, result);
        return;
      }
    }

    writeJson(response, 404, { error: "Not found" });
  } catch (error) {
    handleError(response, error);
  }
});

server.listen(port, () => {
  console.log(`BookPilot API listening on port ${port}`);
});

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");

  if (body.length === 0) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof ValidationError) {
    writeJson(response, 400, { error: error.message, code: error.code });
    return;
  }

  if (error instanceof NotFoundError) {
    writeJson(response, 404, { error: error.message, code: error.code });
    return;
  }

  if (error instanceof ConflictError) {
    writeJson(response, 409, { error: error.message, code: error.code });
    return;
  }

  if (error instanceof DomainError) {
    writeJson(response, 400, { error: error.message, code: error.code });
    return;
  }

  console.error(error);
  writeJson(response, 500, { error: "Internal server error" });
}

function asAvailabilityLookupInput(value: unknown): AvailabilityLookupInput {
  const record = asRecord(value);

  return {
    organizationId: readRequiredString(record, "organizationId"),
    serviceId: readRequiredString(record, "serviceId"),
    startsAt: readRequiredString(record, "startsAt"),
    endsAt: readRequiredString(record, "endsAt"),
    staffMemberId: readOptionalString(record, "staffMemberId"),
    slotIntervalMinutes: readOptionalNumber(record, "slotIntervalMinutes"),
  };
}

function asCreateBookingInput(value: unknown): CreateBookingInput {
  const record = asRecord(value);
  const customerRecord = asRecord(record.customer, "customer");

  return {
    organizationId: readRequiredString(record, "organizationId"),
    serviceId: readRequiredString(record, "serviceId"),
    startsAt: readRequiredString(record, "startsAt"),
    staffMemberId: readOptionalString(record, "staffMemberId"),
    channelOrigin: readOptionalChannelOrigin(record.channelOrigin),
    customer: {
      fullName: readRequiredString(customerRecord, "fullName"),
      phone: readOptionalString(customerRecord, "phone"),
      email: readOptionalString(customerRecord, "email"),
    },
  };
}

function asCreateOrganizationInput(value: unknown): {
  name: string;
  slug: string;
  timeZone?: string;
} {
  const record = asRecord(value);

  return {
    name: readRequiredString(record, "name"),
    slug: readRequiredString(record, "slug"),
    timeZone: readOptionalString(record, "timeZone"),
  };
}

function asCreateServiceConfigurationInput(
  value: unknown,
  organizationId: string,
): {
  organizationId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  active?: boolean;
} {
  const record = asRecord(value);

  return {
    organizationId,
    name: readRequiredString(record, "name"),
    description: readOptionalString(record, "description"),
    durationMinutes: readRequiredNumber(record, "durationMinutes"),
    active: readOptionalBoolean(record, "active"),
  };
}

function asCreateStaffMemberConfigurationInput(
  value: unknown,
  organizationId: string,
): {
  organizationId: string;
  fullName: string;
  active?: boolean;
} {
  const record = asRecord(value);

  return {
    organizationId,
    fullName: readRequiredString(record, "fullName"),
    active: readOptionalBoolean(record, "active"),
  };
}

function asCreateAvailabilityRuleConfigurationInput(
  value: unknown,
  organizationId: string,
): {
  organizationId: string;
  staffMemberId?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive?: boolean;
} {
  const record = asRecord(value);

  return {
    organizationId,
    staffMemberId: readOptionalString(record, "staffMemberId"),
    dayOfWeek: readRequiredNumber(record, "dayOfWeek"),
    startTime: readRequiredString(record, "startTime"),
    endTime: readRequiredString(record, "endTime"),
    isActive: readOptionalBoolean(record, "isActive"),
  };
}

function asCreateTimeOffConfigurationInput(
  value: unknown,
  organizationId: string,
): {
  organizationId: string;
  staffMemberId?: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
} {
  const record = asRecord(value);

  return {
    organizationId,
    staffMemberId: readOptionalString(record, "staffMemberId"),
    startsAt: readRequiredString(record, "startsAt"),
    endsAt: readRequiredString(record, "endsAt"),
    reason: readOptionalString(record, "reason"),
  };
}

function asListBookingsInput(
  searchParams: URLSearchParams,
  organizationId: string,
): {
  organizationId: string;
  startsAt?: string;
  endsAt?: string;
  status?: "confirmed" | "cancelled";
  staffMemberId?: string;
  serviceId?: string;
  customerId?: string;
} {
  const status = searchParams.get("status");

  if (status !== null && status !== "confirmed" && status !== "cancelled") {
    throw new ValidationError("status is invalid.");
  }

  return {
    organizationId,
    startsAt: searchParams.get("startsAt") ?? undefined,
    endsAt: searchParams.get("endsAt") ?? undefined,
    status: status ?? undefined,
    staffMemberId: searchParams.get("staffMemberId") ?? undefined,
    serviceId: searchParams.get("serviceId") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
  };
}

function asRescheduleBookingInput(
  value: unknown,
  organizationId: string,
  bookingId: string,
): {
  organizationId: string;
  bookingId: string;
  startsAt: string;
  staffMemberId?: string;
} {
  const record = asRecord(value);

  return {
    organizationId,
    bookingId,
    startsAt: readRequiredString(record, "startsAt"),
    staffMemberId: readOptionalString(record, "staffMemberId"),
  };
}

function asUpsertNotificationChannelConfigurationInput(
  value: unknown,
  organizationId: string,
  channel: NotificationChannel,
): {
  organizationId: string;
  channel: NotificationChannel;
  enabled: boolean;
  notificationProviderKey?: string | null;
  providerConfig?: Record<string, unknown>;
} {
  const record = asRecord(value);

  return {
    organizationId,
    channel,
    enabled: readRequiredBoolean(record, "enabled"),
    notificationProviderKey:
      readOptionalString(record, "notificationProviderKey") ?? null,
    providerConfig:
      record.providerConfig === undefined
        ? undefined
        : readRecord(record.providerConfig, "providerConfig"),
  };
}

function asRecord(
  value: unknown,
  fieldName = "request body",
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function readRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(
  record: Record<string, unknown>,
  fieldName: string,
): string {
  const value = record[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = record[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string when provided.`);
  }

  return value;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  fieldName: string,
): number | undefined {
  const value = record[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a finite number.`);
  }

  return value;
}

function readRequiredNumber(
  record: Record<string, unknown>,
  fieldName: string,
): number {
  const value = record[fieldName];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a finite number.`);
  }

  return value;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  fieldName: string,
): boolean | undefined {
  const value = record[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new ValidationError(`${fieldName} must be a boolean when provided.`);
  }

  return value;
}

function readRequiredBoolean(
  record: Record<string, unknown>,
  fieldName: string,
): boolean {
  const value = record[fieldName];

  if (typeof value !== "boolean") {
    throw new ValidationError(`${fieldName} must be a boolean.`);
  }

  return value;
}

function readOptionalChannelOrigin(
  value: unknown,
): CreateBookingInput["channelOrigin"] {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    value === "api" ||
    value === "web" ||
    value === "whatsapp" ||
    value === "voice" ||
    value === "dashboard"
  ) {
    return value;
  }

  throw new ValidationError("channelOrigin is invalid.");
}

function getRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://localhost");
}

function matchOrganizationResource(
  pathname: string,
): { organizationId: string; resource: string } | null {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length !== 3 || segments[0] !== "organizations") {
    return null;
  }

  return {
    organizationId: segments[1] ?? "",
    resource: segments[2] ?? "",
  };
}

function matchBookingAction(
  pathname: string,
): { organizationId: string; bookingId: string; action: string } | null {
  const segments = pathname.split("/").filter(Boolean);

  if (
    segments.length !== 5 ||
    segments[0] !== "organizations" ||
    segments[2] !== "bookings"
  ) {
    return null;
  }

  return {
    organizationId: segments[1] ?? "",
    bookingId: segments[3] ?? "",
    action: segments[4] ?? "",
  };
}

function matchOrganizationNotificationChannelConfigurationAction(
  pathname: string,
): { organizationId: string; channel: NotificationChannel } | null {
  const segments = pathname.split("/").filter(Boolean);

  if (
    segments.length !== 4 ||
    segments[0] !== "organizations" ||
    segments[2] !== "notification-channel-configurations"
  ) {
    return null;
  }

  const channel = segments[3];

  if (
    channel !== "whatsapp" &&
    channel !== "sms" &&
    channel !== "email" &&
    channel !== "push" &&
    channel !== "voice"
  ) {
    throw new ValidationError("channel is invalid.");
  }

  return {
    organizationId: segments[1] ?? "",
    channel,
  };
}
