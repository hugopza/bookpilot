import { randomUUID } from "node:crypto";

import type {
  AvailabilityRule,
  Booking,
  Customer,
  CustomerContactInput,
  DateRange,
  Organization,
  Service,
  StaffMember,
  TimeOff,
} from "../domain/entities";
import { ConflictError } from "../domain/errors";
import type {
  AvailabilityRepository,
  BookingMutationStore,
  BookingRepository,
} from "../repositories";
import { overlaps } from "../utils/date-time";

interface SeedData {
  organizations?: Organization[];
  services?: Service[];
  staffMembers?: StaffMember[];
  customers?: Customer[];
  availabilityRules?: AvailabilityRule[];
  timeOffs?: TimeOff[];
  bookings?: Booking[];
}

export class InMemoryBookingCoreRepository
  implements BookingRepository, BookingMutationStore
{
  private readonly organizations = new Map<string, Organization>();
  private readonly services = new Map<string, Service>();
  private readonly staffMembers = new Map<string, StaffMember>();
  private readonly customers = new Map<string, Customer>();
  private readonly availabilityRules = new Map<string, AvailabilityRule>();
  private readonly timeOffs = new Map<string, TimeOff>();
  private readonly bookings = new Map<string, Booking>();

  constructor(seedData: SeedData = {}) {
    seedData.organizations?.forEach((organization) =>
      this.organizations.set(organization.id, organization),
    );
    seedData.services?.forEach((service) => this.services.set(service.id, service));
    seedData.staffMembers?.forEach((staffMember) =>
      this.staffMembers.set(staffMember.id, staffMember),
    );
    seedData.customers?.forEach((customer) =>
      this.customers.set(customer.id, customer),
    );
    seedData.availabilityRules?.forEach((rule) =>
      this.availabilityRules.set(rule.id, rule),
    );
    seedData.timeOffs?.forEach((timeOff) => this.timeOffs.set(timeOff.id, timeOff));
    seedData.bookings?.forEach((booking) => this.bookings.set(booking.id, booking));
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    return this.organizations.get(organizationId) ?? null;
  }

  async getActiveService(
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null> {
    const service = this.services.get(serviceId) ?? null;

    if (!service || service.organizationId !== organizationId || !service.active) {
      return null;
    }

    return service;
  }

  async listActiveStaffMembers(
    organizationId: string,
    staffMemberId?: string,
  ): Promise<StaffMember[]> {
    return [...this.staffMembers.values()].filter(
      (staffMember) =>
        staffMember.organizationId === organizationId &&
        staffMember.active &&
        (staffMemberId === undefined || staffMember.id === staffMemberId),
    );
  }

  async listAvailabilityRules(
    organizationId: string,
    staffMemberIds: string[],
    dayOfWeeks: number[],
  ): Promise<AvailabilityRule[]> {
    return [...this.availabilityRules.values()].filter(
      (rule) =>
        rule.organizationId === organizationId &&
        rule.isActive &&
        dayOfWeeks.includes(rule.dayOfWeek) &&
        (rule.staffMemberId === null || staffMemberIds.includes(rule.staffMemberId)),
    );
  }

  async listTimeOffs(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
  ): Promise<TimeOff[]> {
    return [...this.timeOffs.values()].filter(
      (timeOff) =>
        timeOff.organizationId === organizationId &&
        (timeOff.staffMemberId === null ||
          staffMemberIds.includes(timeOff.staffMemberId)) &&
        overlaps(
          timeOff.startsAt,
          timeOff.endsAt,
          range.startsAt,
          range.endsAt,
        ),
    );
  }

  async listBookings(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
  ): Promise<Booking[]> {
    return [...this.bookings.values()].filter(
      (booking) =>
        booking.organizationId === organizationId &&
        staffMemberIds.includes(booking.staffMemberId) &&
        overlaps(booking.startsAt, booking.endsAt, range.startsAt, range.endsAt),
    );
  }

  async findCustomerByContact(
    organizationId: string,
    contact: CustomerContactInput,
  ): Promise<Customer | null> {
    return (
      [...this.customers.values()].find(
        (customer) =>
          customer.organizationId === organizationId &&
          ((contact.phone !== undefined &&
            contact.phone !== null &&
            customer.phone === contact.phone) ||
            (contact.email !== undefined &&
              contact.email !== null &&
              customer.email?.toLowerCase() === contact.email.toLowerCase())),
      ) ?? null
    );
  }

  async createCustomer(
    organizationId: string,
    contact: CustomerContactInput,
  ): Promise<Customer> {
    const customer: Customer = {
      id: randomUUID(),
      organizationId,
      fullName: contact.fullName.trim(),
      phone: contact.phone ?? null,
      email: contact.email?.toLowerCase() ?? null,
    };

    this.customers.set(customer.id, customer);

    return customer;
  }

  async createBooking(input: {
    organizationId: string;
    serviceId: string;
    customerId: string;
    staffMemberId: string;
    startsAt: Date;
    endsAt: Date;
    channelOrigin: Booking["channelOrigin"];
  }): Promise<Booking> {
    const hasConflict = [...this.bookings.values()].some(
      (booking) =>
        booking.organizationId === input.organizationId &&
        booking.staffMemberId === input.staffMemberId &&
        booking.status !== "cancelled" &&
        overlaps(booking.startsAt, booking.endsAt, input.startsAt, input.endsAt),
    );

    if (hasConflict) {
      throw new ConflictError("Booking conflicts with an existing booking.");
    }

    const booking: Booking = {
      id: randomUUID(),
      organizationId: input.organizationId,
      serviceId: input.serviceId,
      customerId: input.customerId,
      staffMemberId: input.staffMemberId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "confirmed",
      channelOrigin: input.channelOrigin,
      createdAt: new Date(),
    };

    this.bookings.set(booking.id, booking);

    return booking;
  }

  async withTransaction<T>(
    callback: (store: BookingMutationStore) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }
}

export function asAvailabilityRepository(
  repository: InMemoryBookingCoreRepository,
): AvailabilityRepository {
  return repository;
}
