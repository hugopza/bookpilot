import { randomUUID } from "node:crypto";

import type {
  AvailabilityRule,
  Booking,
  BookingEvent,
  BookingEventType,
  ClaimedNotificationJob,
  Customer,
  CustomerContactInput,
  DateRange,
  NotificationJob,
  NotificationJobAttempt,
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
  ConfigurationRepository,
  NotificationProcessingRepository,
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
  bookingEvents?: BookingEvent[];
  notificationJobs?: NotificationJob[];
  notificationJobAttempts?: NotificationJobAttempt[];
}

export class InMemoryBookingCoreRepository
  implements
    BookingRepository,
    BookingMutationStore,
    ConfigurationRepository,
    NotificationProcessingRepository
{
  private readonly organizations = new Map<string, Organization>();
  private readonly services = new Map<string, Service>();
  private readonly staffMembers = new Map<string, StaffMember>();
  private readonly customers = new Map<string, Customer>();
  private readonly availabilityRules = new Map<string, AvailabilityRule>();
  private readonly timeOffs = new Map<string, TimeOff>();
  private readonly bookings = new Map<string, Booking>();
  private readonly bookingEvents = new Map<string, BookingEvent>();
  private readonly notificationJobs = new Map<string, NotificationJob>();
  private readonly notificationJobAttempts = new Map<string, NotificationJobAttempt>();

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
    seedData.bookingEvents?.forEach((bookingEvent) =>
      this.bookingEvents.set(bookingEvent.id, bookingEvent),
    );
    seedData.notificationJobs?.forEach((notificationJob) =>
      this.notificationJobs.set(notificationJob.id, notificationJob),
    );
    seedData.notificationJobAttempts?.forEach((notificationJobAttempt) =>
      this.notificationJobAttempts.set(
        notificationJobAttempt.id,
        notificationJobAttempt,
      ),
    );
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    return this.organizations.get(organizationId) ?? null;
  }

  async listOrganizations(): Promise<Organization[]> {
    return [...this.organizations.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
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

  async listServices(organizationId: string): Promise<Service[]> {
    return [...this.services.values()]
      .filter((service) => service.organizationId === organizationId)
      .sort((left, right) => left.name.localeCompare(right.name));
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

  async getStaffMember(
    organizationId: string,
    staffMemberId: string,
  ): Promise<StaffMember | null> {
    const staffMember = this.staffMembers.get(staffMemberId) ?? null;

    if (!staffMember || staffMember.organizationId !== organizationId) {
      return null;
    }

    return staffMember;
  }

  async listStaffMembers(organizationId: string): Promise<StaffMember[]> {
    return [...this.staffMembers.values()]
      .filter((staffMember) => staffMember.organizationId === organizationId)
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
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
    excludeBookingId?: string,
  ): Promise<TimeOff[]> {
    void excludeBookingId;
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

  async listConfigurationAvailabilityRules(
    organizationId: string,
  ): Promise<AvailabilityRule[]> {
    return [...this.availabilityRules.values()]
      .filter((rule) => rule.organizationId === organizationId)
      .sort((left, right) =>
        left.dayOfWeek - right.dayOfWeek ||
        left.startTime.localeCompare(right.startTime),
      );
  }

  async listConfigurationTimeOffs(organizationId: string): Promise<TimeOff[]> {
    return [...this.timeOffs.values()]
      .filter((timeOff) => timeOff.organizationId === organizationId)
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  }

  async listBookings(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
    excludeBookingId?: string,
  ): Promise<Booking[]> {
    return [...this.bookings.values()].filter(
      (booking) =>
        booking.organizationId === organizationId &&
        staffMemberIds.includes(booking.staffMemberId) &&
        booking.id !== excludeBookingId &&
        overlaps(booking.startsAt, booking.endsAt, range.startsAt, range.endsAt),
    );
  }

  async listManagedBookings(input: {
    organizationId: string;
    startsAt?: Date;
    endsAt?: Date;
    status?: Booking["status"];
    staffMemberId?: string;
    serviceId?: string;
    customerId?: string;
  }): Promise<Booking[]> {
    return [...this.bookings.values()]
      .filter((booking) => {
        if (booking.organizationId !== input.organizationId) {
          return false;
        }

        if (input.status && booking.status !== input.status) {
          return false;
        }

        if (input.staffMemberId && booking.staffMemberId !== input.staffMemberId) {
          return false;
        }

        if (input.serviceId && booking.serviceId !== input.serviceId) {
          return false;
        }

        if (input.customerId && booking.customerId !== input.customerId) {
          return false;
        }

        if (input.startsAt && booking.endsAt <= input.startsAt) {
          return false;
        }

        if (input.endsAt && booking.startsAt >= input.endsAt) {
          return false;
        }

        return true;
      })
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  }

  async getBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<Booking | null> {
    const booking = this.bookings.get(bookingId) ?? null;

    if (!booking || booking.organizationId !== organizationId) {
      return null;
    }

    return booking;
  }

  async getCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<Customer | null> {
    const customer = this.customers.get(customerId) ?? null;

    if (!customer || customer.organizationId !== organizationId) {
      return null;
    }

    return customer;
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

  async createOrganization(input: {
    name: string;
    slug: string;
    timeZone: string;
  }): Promise<Organization> {
    const organization: Organization = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      timeZone: input.timeZone,
    };

    this.organizations.set(organization.id, organization);
    return organization;
  }

  async createService(input: {
    organizationId: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    active: boolean;
  }): Promise<Service> {
    const service: Service = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      durationMinutes: input.durationMinutes,
      active: input.active,
    };

    this.services.set(service.id, service);
    return service;
  }

  async createStaffMember(input: {
    organizationId: string;
    fullName: string;
    active: boolean;
  }): Promise<StaffMember> {
    const staffMember: StaffMember = {
      id: randomUUID(),
      organizationId: input.organizationId,
      fullName: input.fullName,
      active: input.active,
    };

    this.staffMembers.set(staffMember.id, staffMember);
    return staffMember;
  }

  async createAvailabilityRule(input: {
    organizationId: string;
    staffMemberId: string | null;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }): Promise<AvailabilityRule> {
    const rule: AvailabilityRule = {
      id: randomUUID(),
      organizationId: input.organizationId,
      staffMemberId: input.staffMemberId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      isActive: input.isActive,
    };

    this.availabilityRules.set(rule.id, rule);
    return rule;
  }

  async createTimeOff(input: {
    organizationId: string;
    staffMemberId: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
  }): Promise<TimeOff> {
    const timeOff: TimeOff = {
      id: randomUUID(),
      organizationId: input.organizationId,
      staffMemberId: input.staffMemberId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
    };

    this.timeOffs.set(timeOff.id, timeOff);
    return timeOff;
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

  async updateBookingStatus(input: {
    organizationId: string;
    bookingId: string;
    status: Booking["status"];
  }): Promise<Booking> {
    const booking = await this.getBooking(input.organizationId, input.bookingId);

    if (!booking) {
      throw new Error("Booking not found.");
    }

    const updatedBooking: Booking = {
      ...booking,
      status: input.status,
    };

    this.bookings.set(updatedBooking.id, updatedBooking);
    return updatedBooking;
  }

  async updateBookingSchedule(input: {
    organizationId: string;
    bookingId: string;
    staffMemberId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<Booking> {
    const booking = await this.getBooking(input.organizationId, input.bookingId);

    if (!booking) {
      throw new Error("Booking not found.");
    }

    const hasConflict = [...this.bookings.values()].some(
      (existingBooking) =>
        existingBooking.organizationId === input.organizationId &&
        existingBooking.id !== input.bookingId &&
        existingBooking.staffMemberId === input.staffMemberId &&
        existingBooking.status !== "cancelled" &&
        overlaps(
          existingBooking.startsAt,
          existingBooking.endsAt,
          input.startsAt,
          input.endsAt,
        ),
    );

    if (hasConflict) {
      throw new ConflictError("Booking conflicts with an existing booking.");
    }

    const updatedBooking: Booking = {
      ...booking,
      staffMemberId: input.staffMemberId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    };

    this.bookings.set(updatedBooking.id, updatedBooking);
    return updatedBooking;
  }

  async createBookingEvent(input: {
    organizationId: string;
    bookingId: string;
    eventType: BookingEventType;
    metadata: Record<string, unknown>;
  }): Promise<BookingEvent> {
    const bookingEvent: BookingEvent = {
      id: randomUUID(),
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      eventType: input.eventType,
      metadata: input.metadata,
      occurredAt: new Date(),
    };

    this.bookingEvents.set(bookingEvent.id, bookingEvent);
    return bookingEvent;
  }

  async createNotificationJob(input: {
    organizationId: string;
    bookingId: string;
    customerId: string;
    eventType: BookingEventType;
    payload: Record<string, unknown>;
  }): Promise<NotificationJob> {
    const now = new Date();
    const notificationJob: NotificationJob = {
      id: randomUUID(),
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      customerId: input.customerId,
      eventType: input.eventType,
      status: "pending",
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: now,
      processingToken: null,
      processingStartedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    };

    this.notificationJobs.set(notificationJob.id, notificationJob);
    return notificationJob;
  }

  async withTransaction<T>(
    callback: (store: BookingMutationStore) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }

  async claimPendingNotificationJobs(input: {
    limit: number;
    now: Date;
    staleBefore: Date;
  }): Promise<ClaimedNotificationJob[]> {
    const claimableJobs = [...this.notificationJobs.values()]
      .filter((job) => {
        if (job.status === "pending" && job.nextAttemptAt <= input.now) {
          return job.attemptCount < job.maxAttempts;
        }

        if (
          job.status === "processing" &&
          job.processingStartedAt !== null &&
          job.processingStartedAt <= input.staleBefore
        ) {
          return job.attemptCount < job.maxAttempts;
        }

        return false;
      })
      .sort((left, right) => left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime())
      .slice(0, input.limit);

    return claimableJobs.map((job) => {
      const processingToken = randomUUID();
      const attemptNumber = job.attemptCount + 1;
      const updatedJob: NotificationJob = {
        ...job,
        status: "processing",
        attemptCount: attemptNumber,
        processingToken,
        processingStartedAt: input.now,
        updatedAt: input.now,
      };
      const attempt: NotificationJobAttempt = {
        id: randomUUID(),
        notificationJobId: job.id,
        attemptNumber,
        processingToken,
        status: "processing",
        outcomeCode: null,
        outcomeMessage: null,
        outcomePayload: {},
        startedAt: input.now,
        finishedAt: null,
      };

      this.notificationJobs.set(updatedJob.id, updatedJob);
      this.notificationJobAttempts.set(attempt.id, attempt);

      return {
        job: updatedJob,
        attempt,
      };
    });
  }

  async markNotificationJobSucceeded(input: {
    notificationJobId: string;
    processingToken: string;
    finishedAt: Date;
    outcomePayload: Record<string, unknown>;
  }): Promise<NotificationJob | null> {
    const job = this.notificationJobs.get(input.notificationJobId) ?? null;

    if (
      !job ||
      job.status !== "processing" ||
      job.processingToken !== input.processingToken
    ) {
      return null;
    }

    const attempt = this.findAttemptByProcessingToken(input.processingToken);

    if (!attempt || attempt.status !== "processing") {
      return null;
    }

    const updatedJob: NotificationJob = {
      ...job,
      status: "succeeded",
      processingToken: null,
      processingStartedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: input.finishedAt,
    };
    const updatedAttempt: NotificationJobAttempt = {
      ...attempt,
      status: "succeeded",
      outcomePayload: input.outcomePayload,
      finishedAt: input.finishedAt,
    };

    this.notificationJobs.set(updatedJob.id, updatedJob);
    this.notificationJobAttempts.set(updatedAttempt.id, updatedAttempt);
    return updatedJob;
  }

  async markNotificationJobFailed(input: {
    notificationJobId: string;
    processingToken: string;
    finishedAt: Date;
    retryAt: Date | null;
    shouldRetry: boolean;
    errorCode: string;
    errorMessage: string;
    outcomePayload: Record<string, unknown>;
  }): Promise<NotificationJob | null> {
    const job = this.notificationJobs.get(input.notificationJobId) ?? null;

    if (
      !job ||
      job.status !== "processing" ||
      job.processingToken !== input.processingToken
    ) {
      return null;
    }

    const attempt = this.findAttemptByProcessingToken(input.processingToken);

    if (!attempt || attempt.status !== "processing") {
      return null;
    }

    const hasRemainingAttempts = job.attemptCount < job.maxAttempts;
    const nextStatus =
      input.shouldRetry && input.retryAt !== null && hasRemainingAttempts
        ? "pending"
        : "failed";
    const updatedJob: NotificationJob = {
      ...job,
      status: nextStatus,
      nextAttemptAt: input.retryAt ?? job.nextAttemptAt,
      processingToken: null,
      processingStartedAt: null,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      updatedAt: input.finishedAt,
    };
    const updatedAttempt: NotificationJobAttempt = {
      ...attempt,
      status: "failed",
      outcomeCode: input.errorCode,
      outcomeMessage: input.errorMessage,
      outcomePayload: input.outcomePayload,
      finishedAt: input.finishedAt,
    };

    this.notificationJobs.set(updatedJob.id, updatedJob);
    this.notificationJobAttempts.set(updatedAttempt.id, updatedAttempt);
    return updatedJob;
  }

  listPersistedBookingEvents(organizationId: string): BookingEvent[] {
    return [...this.bookingEvents.values()]
      .filter((bookingEvent) => bookingEvent.organizationId === organizationId)
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  }

  listPersistedNotificationJobs(organizationId: string): NotificationJob[] {
    return [...this.notificationJobs.values()]
      .filter((notificationJob) => notificationJob.organizationId === organizationId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  listPersistedNotificationJobAttempts(
    organizationId: string,
  ): NotificationJobAttempt[] {
    const jobIds = new Set(
      [...this.notificationJobs.values()]
        .filter((notificationJob) => notificationJob.organizationId === organizationId)
        .map((notificationJob) => notificationJob.id),
    );

    return [...this.notificationJobAttempts.values()]
      .filter((attempt) => jobIds.has(attempt.notificationJobId))
      .sort((left, right) => left.attemptNumber - right.attemptNumber);
  }

  private findAttemptByProcessingToken(
    processingToken: string,
  ): NotificationJobAttempt | null {
    return (
      [...this.notificationJobAttempts.values()].find(
        (attempt) => attempt.processingToken === processingToken,
      ) ?? null
    );
  }
}

export function asAvailabilityRepository(
  repository: InMemoryBookingCoreRepository,
): AvailabilityRepository {
  return repository;
}
