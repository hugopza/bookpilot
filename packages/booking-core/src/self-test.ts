import assert from "node:assert/strict";

import { ConflictError } from "./domain/errors";
import { createAvailabilityService } from "./services/availability-service";
import { createBookingManagementService } from "./services/booking-management-service";
import {
  createAvailabilityRuleConfigurationService,
  createOrganizationConfigurationService,
  createServiceConfigurationService,
  createStaffMemberConfigurationService,
  createTimeOffConfigurationService,
} from "./services/configuration-service";
import { createBookingService } from "./services/create-booking-service";
import { InMemoryBookingCoreRepository } from "./testing/in-memory-booking-core-repository";

async function main(): Promise<void> {
  await runConfigurationScenario();
  console.log("booking-core self-test passed");
}

async function runConfigurationScenario(): Promise<void> {
  const repository = new InMemoryBookingCoreRepository();
  const organizationConfigurationService =
    createOrganizationConfigurationService(repository);
  const serviceConfigurationService =
    createServiceConfigurationService(repository);
  const staffMemberConfigurationService =
    createStaffMemberConfigurationService(repository);
  const availabilityRuleConfigurationService =
    createAvailabilityRuleConfigurationService(repository);
  const timeOffConfigurationService = createTimeOffConfigurationService(repository);
  const bookingService = createBookingService(repository);
  const bookingManagementService = createBookingManagementService(repository);
  const availabilityService = createAvailabilityService(repository);

  const organization = await organizationConfigurationService.create({
    name: "BookPilot Studio",
    slug: "bookpilot-studio",
    timeZone: "UTC",
  });

  const service = await serviceConfigurationService.create({
    organizationId: organization.id,
    name: "Coaching Session",
    durationMinutes: 60,
  });

  const staffMember = await staffMemberConfigurationService.create({
    organizationId: organization.id,
    fullName: "Jamie Doe",
  });

  await availabilityRuleConfigurationService.create({
    organizationId: organization.id,
    staffMemberId: staffMember.id,
    dayOfWeek: 1,
    startTime: "09:00:00",
    endTime: "12:00:00",
  });

  await timeOffConfigurationService.create({
    organizationId: organization.id,
    staffMemberId: staffMember.id,
    startsAt: "2026-03-16T10:00:00.000Z",
    endsAt: "2026-03-16T11:00:00.000Z",
    reason: "Break",
  });

  const organizations = await organizationConfigurationService.list();
  const services = await serviceConfigurationService.list(organization.id);
  const staffMembers = await staffMemberConfigurationService.list(organization.id);
  const rules = await availabilityRuleConfigurationService.list(organization.id);
  const timeOffs = await timeOffConfigurationService.list(organization.id);

  assert.equal(organizations.length, 1);
  assert.equal(services.length, 1);
  assert.equal(staffMembers.length, 1);
  assert.equal(rules.length, 1);
  assert.equal(timeOffs.length, 1);

  const createdBooking = await bookingService.create({
    organizationId: organization.id,
    serviceId: service.id,
    startsAt: "2026-03-16T11:00:00.000Z",
    customer: {
      fullName: "Sam Customer",
      email: "sam@example.com",
    },
  });

  assert.equal(createdBooking.customer.fullName, "Sam Customer");
  assert.equal(createdBooking.booking.staffMemberId, staffMember.id);
  assert.equal(createdBooking.booking.status, "confirmed");

  const listedBookings = await bookingManagementService.list({
    organizationId: organization.id,
    startsAt: "2026-03-16T00:00:00.000Z",
    endsAt: "2026-03-17T00:00:00.000Z",
  });

  assert.equal(listedBookings.length, 1);
  assert.equal(listedBookings[0]?.id, createdBooking.booking.id);

  const availability = await availabilityService.lookup({
    organizationId: organization.id,
    serviceId: service.id,
    startsAt: "2026-03-16T09:00:00.000Z",
    endsAt: "2026-03-16T12:00:00.000Z",
  });

  assert.equal(availability.slots.length, 1);
  assert.equal(
    availability.slots[0]?.startsAt.toISOString(),
    "2026-03-16T09:00:00.000Z",
  );
  assert.equal(
    availability.slots[0]?.endsAt.toISOString(),
    "2026-03-16T10:00:00.000Z",
  );

  const rescheduledBooking = await bookingManagementService.reschedule({
    organizationId: organization.id,
    bookingId: createdBooking.booking.id,
    startsAt: "2026-03-16T09:00:00.000Z",
  });

  assert.equal(
    rescheduledBooking.startsAt.toISOString(),
    "2026-03-16T09:00:00.000Z",
  );
  assert.equal(
    rescheduledBooking.endsAt.toISOString(),
    "2026-03-16T10:00:00.000Z",
  );

  await assert.rejects(
    () =>
      bookingService.create({
        organizationId: organization.id,
        serviceId: service.id,
        startsAt: "2026-03-16T09:00:00.000Z",
        customer: {
          fullName: "Second Customer",
          email: "second@example.com",
        },
      }),
    ConflictError,
  );

  const cancelledBooking = await bookingManagementService.cancel({
    organizationId: organization.id,
    bookingId: createdBooking.booking.id,
  });

  assert.equal(cancelledBooking.status, "cancelled");

  const cancelledBookings = await bookingManagementService.list({
    organizationId: organization.id,
    status: "cancelled",
  });

  assert.equal(cancelledBookings.length, 1);
  assert.equal(cancelledBookings[0]?.id, createdBooking.booking.id);

  const availabilityAfterCancellation = await availabilityService.lookup({
    organizationId: organization.id,
    serviceId: service.id,
    startsAt: "2026-03-16T09:00:00.000Z",
    endsAt: "2026-03-16T12:00:00.000Z",
  });

  assert.equal(availabilityAfterCancellation.slots.length, 2);
  assert.equal(
    availabilityAfterCancellation.slots[0]?.startsAt.toISOString(),
    "2026-03-16T09:00:00.000Z",
  );
  assert.equal(
    availabilityAfterCancellation.slots[1]?.startsAt.toISOString(),
    "2026-03-16T11:00:00.000Z",
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
