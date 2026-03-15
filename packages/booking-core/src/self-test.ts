import assert from "node:assert/strict";

import { ConflictError } from "./domain/errors";
import { createAvailabilityService } from "./services/availability-service";
import { createBookingService } from "./services/create-booking-service";
import { InMemoryBookingCoreRepository } from "./testing/in-memory-booking-core-repository";

async function main(): Promise<void> {
  await runAvailabilityScenario();
  await runBookingScenario();
  console.log("booking-core self-test passed");
}

async function runAvailabilityScenario(): Promise<void> {
  const repository = new InMemoryBookingCoreRepository({
    organizations: [
      {
        id: "org-1",
        name: "BookPilot Clinic",
        slug: "bookpilot-clinic",
        timeZone: "UTC",
      },
    ],
    services: [
      {
        id: "service-1",
        organizationId: "org-1",
        name: "Initial Consultation",
        description: null,
        durationMinutes: 60,
        active: true,
      },
    ],
    staffMembers: [
      {
        id: "staff-1",
        organizationId: "org-1",
        fullName: "Alex Doe",
        active: true,
      },
    ],
    availabilityRules: [
      {
        id: "rule-1",
        organizationId: "org-1",
        staffMemberId: "staff-1",
        dayOfWeek: 1,
        startTime: "09:00:00",
        endTime: "12:00:00",
        isActive: true,
      },
    ],
    timeOffs: [
      {
        id: "time-off-1",
        organizationId: "org-1",
        staffMemberId: "staff-1",
        startsAt: new Date("2026-03-16T10:00:00.000Z"),
        endsAt: new Date("2026-03-16T11:00:00.000Z"),
        reason: "Break",
      },
    ],
    bookings: [
      {
        id: "booking-1",
        organizationId: "org-1",
        serviceId: "service-1",
        customerId: "customer-1",
        staffMemberId: "staff-1",
        startsAt: new Date("2026-03-16T11:00:00.000Z"),
        endsAt: new Date("2026-03-16T12:00:00.000Z"),
        status: "confirmed",
        channelOrigin: "api",
        createdAt: new Date("2026-03-15T10:00:00.000Z"),
      },
    ],
  });
  const service = createAvailabilityService(repository);

  const result = await service.lookup({
    organizationId: "org-1",
    serviceId: "service-1",
    startsAt: "2026-03-16T09:00:00.000Z",
    endsAt: "2026-03-16T12:00:00.000Z",
  });

  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0]?.startsAt.toISOString(), "2026-03-16T09:00:00.000Z");
  assert.equal(result.slots[0]?.endsAt.toISOString(), "2026-03-16T10:00:00.000Z");
}

async function runBookingScenario(): Promise<void> {
  const repository = new InMemoryBookingCoreRepository({
    organizations: [
      {
        id: "org-1",
        name: "BookPilot Studio",
        slug: "bookpilot-studio",
        timeZone: "UTC",
      },
    ],
    services: [
      {
        id: "service-1",
        organizationId: "org-1",
        name: "Coaching Session",
        description: null,
        durationMinutes: 60,
        active: true,
      },
    ],
    staffMembers: [
      {
        id: "staff-1",
        organizationId: "org-1",
        fullName: "Jamie Doe",
        active: true,
      },
    ],
    availabilityRules: [
      {
        id: "rule-1",
        organizationId: "org-1",
        staffMemberId: "staff-1",
        dayOfWeek: 1,
        startTime: "09:00:00",
        endTime: "12:00:00",
        isActive: true,
      },
    ],
  });
  const service = createBookingService(repository);

  const created = await service.create({
    organizationId: "org-1",
    serviceId: "service-1",
    startsAt: "2026-03-16T09:00:00.000Z",
    customer: {
      fullName: "Sam Customer",
      email: "sam@example.com",
    },
  });

  assert.equal(created.customer.fullName, "Sam Customer");
  assert.equal(created.booking.staffMemberId, "staff-1");
  assert.equal(created.booking.status, "confirmed");

  await assert.rejects(
    () =>
      service.create({
        organizationId: "org-1",
        serviceId: "service-1",
        startsAt: "2026-03-16T09:00:00.000Z",
        customer: {
          fullName: "Second Customer",
          email: "second@example.com",
        },
      }),
    ConflictError,
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
