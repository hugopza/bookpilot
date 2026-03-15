import assert from "node:assert/strict";
import test from "node:test";

import { ConflictError } from "../domain/errors";
import { createBookingService } from "../services/create-booking-service";
import { InMemoryBookingCoreRepository } from "../testing/in-memory-booking-core-repository";

function buildRepository() {
  return new InMemoryBookingCoreRepository({
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
}

test("booking creation creates a customer and a confirmed booking", async () => {
  const repository = buildRepository();
  const service = createBookingService(repository);

  const result = await service.create({
    organizationId: "org-1",
    serviceId: "service-1",
    startsAt: "2026-03-16T09:00:00.000Z",
    customer: {
      fullName: "Sam Customer",
      email: "sam@example.com",
    },
  });

  assert.equal(result.customer.fullName, "Sam Customer");
  assert.equal(result.booking.staffMemberId, "staff-1");
  assert.equal(result.booking.status, "confirmed");
  assert.equal(result.booking.startsAt.toISOString(), "2026-03-16T09:00:00.000Z");
});

test("booking creation rejects overlapping bookings for the same staff member", async () => {
  const repository = buildRepository();
  const service = createBookingService(repository);

  await service.create({
    organizationId: "org-1",
    serviceId: "service-1",
    startsAt: "2026-03-16T09:00:00.000Z",
    customer: {
      fullName: "First Customer",
      email: "first@example.com",
    },
  });

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
});
