import type { Booking } from "../domain/entities";
import { NotFoundError, ValidationError } from "../domain/errors";
import type { BookingRepository } from "../repositories";
import { assertValidRange, parseDateTime } from "../utils/date-time";
import { resolveBookableSlot } from "./resolve-bookable-slot";

export interface ListBookingsInput {
  organizationId: string;
  startsAt?: string;
  endsAt?: string;
  status?: Booking["status"];
  staffMemberId?: string;
  serviceId?: string;
  customerId?: string;
}

export interface CancelBookingInput {
  organizationId: string;
  bookingId: string;
}

export interface RescheduleBookingInput {
  organizationId: string;
  bookingId: string;
  startsAt: string;
  staffMemberId?: string;
}

export function createBookingManagementService(repository: BookingRepository) {
  return {
    async list(input: ListBookingsInput): Promise<Booking[]> {
      await requireOrganization(repository, input.organizationId);

      const startsAt = input.startsAt
        ? parseDateTime(input.startsAt, "startsAt")
        : undefined;
      const endsAt = input.endsAt ? parseDateTime(input.endsAt, "endsAt") : undefined;

      if (startsAt && endsAt) {
        assertValidRange(startsAt, endsAt);
      } else if (startsAt && !endsAt) {
        throw new ValidationError("endsAt is required when startsAt is provided.");
      } else if (!startsAt && endsAt) {
        throw new ValidationError("startsAt is required when endsAt is provided.");
      }

      if (
        input.status !== undefined &&
        input.status !== "confirmed" &&
        input.status !== "cancelled"
      ) {
        throw new ValidationError("status is invalid.");
      }

      return repository.listManagedBookings({
        organizationId: input.organizationId,
        startsAt,
        endsAt,
        status: input.status,
        staffMemberId: normalizeOptionalString(input.staffMemberId) ?? undefined,
        serviceId: normalizeOptionalString(input.serviceId) ?? undefined,
        customerId: normalizeOptionalString(input.customerId) ?? undefined,
      });
    },

    async cancel(input: CancelBookingInput): Promise<Booking> {
      return repository.withTransaction(async (store) => {
        const booking = await store.getBooking(input.organizationId, input.bookingId);

        if (!booking) {
          throw new NotFoundError("Booking was not found.");
        }

        if (booking.status === "cancelled") {
          return booking;
        }

        return store.updateBookingStatus({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          status: "cancelled",
        });
      });
    },

    async reschedule(input: RescheduleBookingInput): Promise<Booking> {
      const startsAt = parseDateTime(input.startsAt, "startsAt");

      return repository.withTransaction(async (store) => {
        const booking = await store.getBooking(input.organizationId, input.bookingId);

        if (!booking) {
          throw new NotFoundError("Booking was not found.");
        }

        if (booking.status === "cancelled") {
          throw new ValidationError("Cancelled bookings cannot be rescheduled.");
        }

        const requestedStaffMemberId =
          normalizeOptionalString(input.staffMemberId) ?? booking.staffMemberId;
        const { slot } = await resolveBookableSlot(store, {
          organizationId: input.organizationId,
          serviceId: booking.serviceId,
          startsAt,
          staffMemberId: requestedStaffMemberId,
          excludeBookingId: booking.id,
        });

        return store.updateBookingSchedule({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          staffMemberId: slot.staffMemberId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        });
      });
    },
  };
}

async function requireOrganization(
  repository: Pick<BookingRepository, "getOrganization">,
  organizationId: string,
): Promise<void> {
  const organization = await repository.getOrganization(organizationId);

  if (!organization) {
    throw new NotFoundError("Organization was not found.");
  }
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
