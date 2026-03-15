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
    excludeBookingId?: string,
  ): Promise<Booking[]>;
}

export interface BookingMutationStore extends AvailabilityRepository {
  getBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<Booking | null>;
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
  updateBookingStatus(input: {
    organizationId: string;
    bookingId: string;
    status: Booking["status"];
  }): Promise<Booking>;
  updateBookingSchedule(input: {
    organizationId: string;
    bookingId: string;
    staffMemberId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<Booking>;
}

export interface BookingRepository extends AvailabilityRepository {
  listManagedBookings(input: {
    organizationId: string;
    startsAt?: Date;
    endsAt?: Date;
    status?: Booking["status"];
    staffMemberId?: string;
    serviceId?: string;
    customerId?: string;
  }): Promise<Booking[]>;
  withTransaction<T>(
    callback: (store: BookingMutationStore) => Promise<T>,
  ): Promise<T>;
}

export interface ConfigurationRepository
  extends Pick<AvailabilityRepository, "getOrganization"> {
  listOrganizations(): Promise<Organization[]>;
  createOrganization(input: {
    name: string;
    slug: string;
    timeZone: string;
  }): Promise<Organization>;
  listServices(organizationId: string): Promise<Service[]>;
  createService(input: {
    organizationId: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    active: boolean;
  }): Promise<Service>;
  getStaffMember(
    organizationId: string,
    staffMemberId: string,
  ): Promise<StaffMember | null>;
  listStaffMembers(organizationId: string): Promise<StaffMember[]>;
  createStaffMember(input: {
    organizationId: string;
    fullName: string;
    active: boolean;
  }): Promise<StaffMember>;
  listConfigurationAvailabilityRules(
    organizationId: string,
  ): Promise<AvailabilityRule[]>;
  createAvailabilityRule(input: {
    organizationId: string;
    staffMemberId: string | null;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }): Promise<AvailabilityRule>;
  listConfigurationTimeOffs(organizationId: string): Promise<TimeOff[]>;
  createTimeOff(input: {
    organizationId: string;
    staffMemberId: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
  }): Promise<TimeOff>;
}
