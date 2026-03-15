import type {
  AvailabilityRule,
  Booking,
  BookingChannelOrigin,
  Customer,
  CustomerContactInput,
  DateRange,
  Organization,
  Service,
  StaffMember,
  TimeOff,
} from "./domain/entities";

export interface AvailabilityRepository {
  getOrganization(organizationId: string): Promise<Organization | null>;
  getActiveService(
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null>;
  listActiveStaffMembers(
    organizationId: string,
    staffMemberId?: string,
  ): Promise<StaffMember[]>;
  listAvailabilityRules(
    organizationId: string,
    staffMemberIds: string[],
    dayOfWeeks: number[],
  ): Promise<AvailabilityRule[]>;
  listTimeOffs(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
  ): Promise<TimeOff[]>;
  listBookings(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
  ): Promise<Booking[]>;
}

export interface BookingMutationStore extends AvailabilityRepository {
  findCustomerByContact(
    organizationId: string,
    contact: CustomerContactInput,
  ): Promise<Customer | null>;
  createCustomer(
    organizationId: string,
    contact: CustomerContactInput,
  ): Promise<Customer>;
  createBooking(input: {
    organizationId: string;
    serviceId: string;
    customerId: string;
    staffMemberId: string;
    startsAt: Date;
    endsAt: Date;
    channelOrigin: BookingChannelOrigin;
  }): Promise<Booking>;
}

export interface BookingRepository extends AvailabilityRepository {
  withTransaction<T>(
    callback: (store: BookingMutationStore) => Promise<T>,
  ): Promise<T>;
}
