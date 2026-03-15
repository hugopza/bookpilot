import { ConflictError, NotFoundError } from "../domain/errors";
import type { AvailabilityRepository } from "../repositories";
import { addMinutes } from "../utils/date-time";
import { createAvailabilityService } from "./availability-service";

export async function resolveBookableSlot(
  repository: AvailabilityRepository,
  input: {
    organizationId: string;
    serviceId: string;
    startsAt: Date;
    staffMemberId?: string;
    excludeBookingId?: string;
  },
) {
  const service = await repository.getActiveService(
    input.organizationId,
    input.serviceId,
  );

  if (!service) {
    throw new NotFoundError("Service was not found or is inactive.");
  }

  const availability = await createAvailabilityService(repository).lookup({
    organizationId: input.organizationId,
    serviceId: input.serviceId,
    startsAt: input.startsAt.toISOString(),
    endsAt: addMinutes(input.startsAt, service.durationMinutes).toISOString(),
    staffMemberId: input.staffMemberId,
    excludeBookingId: input.excludeBookingId,
  });

  const matchingSlot = availability.slots.find(
    (slot) =>
      slot.startsAt.getTime() === input.startsAt.getTime() &&
      (input.staffMemberId === undefined ||
        slot.staffMemberId === input.staffMemberId),
  );

  if (!matchingSlot) {
    throw new ConflictError("The requested booking slot is no longer available.");
  }

  return {
    service,
    slot: matchingSlot,
  };
}
