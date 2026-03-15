import type {
  Booking,
  BookingChannelOrigin,
  Customer,
  CustomerContactInput,
} from "../domain/entities";
import { ValidationError } from "../domain/errors";
import type { BookingRepository } from "../repositories";
import { parseDateTime } from "../utils/date-time";
import { resolveBookableSlot } from "./resolve-bookable-slot";

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
        const { slot } = await resolveBookableSlot(store, {
          organizationId: input.organizationId,
          serviceId: input.serviceId,
          startsAt,
          staffMemberId: input.staffMemberId,
        });

        const customer =
          (await store.findCustomerByContact(input.organizationId, input.customer)) ??
          (await store.createCustomer(input.organizationId, input.customer));

        const booking = await store.createBooking({
          organizationId: input.organizationId,
          serviceId: input.serviceId,
          customerId: customer.id,
          staffMemberId: slot.staffMemberId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
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
