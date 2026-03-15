import assert from "node:assert/strict";
import test from "node:test";

import { createAvailabilityService } from "../services/availability-service";
import { InMemoryBookingCoreRepository } from "../testing/in-memory-booking-core-repository";

test("availability lookup returns bookable slots and excludes conflicting periods", async () => {
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
});
