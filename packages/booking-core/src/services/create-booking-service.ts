import type {
  Booking,
  BookingChannelOrigin,
  Customer,
  CustomerContactInput,
} from "../domain/entities";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import type { BookingRepository } from "../repositories";
import { addMinutes, parseDateTime } from "../utils/date-time";
import { createAvailabilityService } from "./availability-service";

export interface CreateBookingInput {
  organizationId: string;
  serviceId: string;
  startsAt: string;
  staffMemberId?: string;
  customer: CustomerContactInput;
  channelOrigin?: BookingChannelOrigin;
}

export interface CreateBookingResult {
  booking: Booking;
  customer: Customer;
}

export function createBookingService(repository: BookingRepository) {
  return {
    async create(input: CreateBookingInput): Promise<CreateBookingResult> {
      const startsAt = parseDateTime(input.startsAt, "startsAt");
      const channelOrigin = input.channelOrigin ?? "api";
      validateCustomer(input.customer);

      return repository.withTransaction(async (store) => {
        const service = await store.getActiveService(
          input.organizationId,
          input.serviceId,
        );

        if (!service) {
          throw new NotFoundError("Service was not found or is inactive.");
        }

        const availabilityService = createAvailabilityService(store);
        const availability = await availabilityService.lookup({
          organizationId: input.organizationId,
          serviceId: input.serviceId,
          startsAt: startsAt.toISOString(),
          endsAt: addMinutes(startsAt, service.durationMinutes).toISOString(),
          staffMemberId: input.staffMemberId,
        });

        const matchingSlot = availability.slots.find(
          (slot) =>
            slot.startsAt.getTime() === startsAt.getTime() &&
            (input.staffMemberId === undefined ||
              slot.staffMemberId === input.staffMemberId),
        );

        if (!matchingSlot) {
          throw new ConflictError(
            "The requested booking slot is no longer available.",
          );
        }

        const customer =
          (await store.findCustomerByContact(input.organizationId, input.customer)) ??
          (await store.createCustomer(input.organizationId, input.customer));

        const booking = await store.createBooking({
          organizationId: input.organizationId,
          serviceId: input.serviceId,
          customerId: customer.id,
          staffMemberId: matchingSlot.staffMemberId,
          startsAt: matchingSlot.startsAt,
          endsAt: matchingSlot.endsAt,
          channelOrigin,
        });

        return { booking, customer };
      });
    },
  };
}

function validateCustomer(customer: CustomerContactInput): void {
  if (customer.fullName.trim().length === 0) {
    throw new ValidationError("customer.fullName is required.");
  }

  if (!customer.phone && !customer.email) {
    throw new ValidationError(
      "customer.phone or customer.email is required.",
    );
  }
}
