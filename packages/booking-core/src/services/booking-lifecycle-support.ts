import type { Booking, BookingEventType, Customer } from "../domain/entities";
import type { BookingMutationStore } from "../repositories";

export async function recordBookingLifecycle(input: {
  store: BookingMutationStore;
  booking: Booking;
  customer: Customer;
  eventType: BookingEventType;
  metadata?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const metadata = input.metadata ?? {};
  const payload = input.payload ?? {};

  await input.store.createBookingEvent({
    organizationId: input.booking.organizationId,
    bookingId: input.booking.id,
    eventType: input.eventType,
    metadata,
  });

  await input.store.createNotificationJob({
    organizationId: input.booking.organizationId,
    bookingId: input.booking.id,
    customerId: input.customer.id,
    eventType: input.eventType,
    payload,
  });
}
