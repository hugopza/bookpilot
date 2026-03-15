import type { Pool, QueryResultRow } from "pg";

import {
  ConflictError,
  type AvailabilityRule,
  type Booking,
  type BookingEvent,
  type BookingEventType,
  type BookingMutationStore,
  type BookingRepository,
  type ConfigurationRepository,
  type Customer,
  type CustomerContactInput,
  type DateRange,
  type ClaimedNotificationJob,
  type NotificationJob,
  type NotificationJobAttempt,
  type Organization,
  type Service,
  type StaffMember,
  type TimeOff,
} from "@bookpilot/booking-core";
import type { NotificationProcessingRepository } from "@bookpilot/booking-core";

interface QueryRunner {
  query<T extends QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export class PostgresBookingCoreRepository
  implements
    BookingRepository,
    ConfigurationRepository,
    NotificationProcessingRepository
{
  constructor(private readonly pool: Pool) {}

  async listOrganizations(): Promise<Organization[]> {
    const result = await this.pool.query<OrganizationRow>(
      `
        select id, name, slug, time_zone
        from organizations
        order by name asc
      `,
    );

    return result.rows.map(mapOrganization);
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    const result = await this.pool.query<OrganizationRow>(
      `
        select id, name, slug, time_zone
        from organizations
        where id = $1
      `,
      [organizationId],
    );

    return result.rows[0] ? mapOrganization(result.rows[0]) : null;
  }

  async getActiveService(
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null> {
    const result = await this.pool.query<ServiceRow>(
      `
        select id, organization_id, name, description, duration_minutes, active
        from services
        where id = $1
          and organization_id = $2
          and active = true
      `,
      [serviceId, organizationId],
    );

    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async listServices(organizationId: string): Promise<Service[]> {
    const result = await this.pool.query<ServiceRow>(
      `
        select id, organization_id, name, description, duration_minutes, active
        from services
        where organization_id = $1
        order by name asc
      `,
      [organizationId],
    );

    return result.rows.map(mapService);
  }

  async listActiveStaffMembers(
    organizationId: string,
    staffMemberId?: string,
  ): Promise<StaffMember[]> {
    const result = await this.pool.query<StaffMemberRow>(
      `
        select id, organization_id, full_name, active
        from staff_members
        where organization_id = $1
          and active = true
          and ($2::uuid is null or id = $2::uuid)
      `,
      [organizationId, staffMemberId ?? null],
    );

    return result.rows.map(mapStaffMember);
  }

  async getStaffMember(
    organizationId: string,
    staffMemberId: string,
  ): Promise<StaffMember | null> {
    const result = await this.pool.query<StaffMemberRow>(
      `
        select id, organization_id, full_name, active
        from staff_members
        where organization_id = $1
          and id = $2
      `,
      [organizationId, staffMemberId],
    );

    return result.rows[0] ? mapStaffMember(result.rows[0]) : null;
  }

  async listStaffMembers(organizationId: string): Promise<StaffMember[]> {
    const result = await this.pool.query<StaffMemberRow>(
      `
        select id, organization_id, full_name, active
        from staff_members
        where organization_id = $1
        order by full_name asc
      `,
      [organizationId],
    );

    return result.rows.map(mapStaffMember);
  }

  async listAvailabilityRules(
    organizationId: string,
    staffMemberIds: string[],
    dayOfWeeks: number[],
  ): Promise<AvailabilityRule[]> {
    if (staffMemberIds.length === 0 || dayOfWeeks.length === 0) {
      return [];
    }

    const result = await this.pool.query<AvailabilityRuleRow>(
      `
        select id, organization_id, staff_member_id, day_of_week, start_time, end_time, is_active
        from availability_rules
        where organization_id = $1
          and is_active = true
          and day_of_week = any($2::smallint[])
          and (staff_member_id is null or staff_member_id = any($3::uuid[]))
      `,
      [organizationId, dayOfWeeks, staffMemberIds],
    );

    return result.rows.map(mapAvailabilityRule);
  }

  async listConfigurationAvailabilityRules(
    organizationId: string,
  ): Promise<AvailabilityRule[]> {
    const result = await this.pool.query<AvailabilityRuleRow>(
      `
        select id, organization_id, staff_member_id, day_of_week, start_time, end_time, is_active
        from availability_rules
        where organization_id = $1
        order by day_of_week asc, start_time asc, id asc
      `,
      [organizationId],
    );

    return result.rows.map(mapAvailabilityRule);
  }

  async listTimeOffs(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
    excludeBookingId?: string,
  ): Promise<TimeOff[]> {
    void excludeBookingId;
    if (staffMemberIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<TimeOffRow>(
      `
        select id, organization_id, staff_member_id, starts_at, ends_at, reason
        from time_off
        where organization_id = $1
          and (staff_member_id is null or staff_member_id = any($2::uuid[]))
          and starts_at < $4
          and ends_at > $3
      `,
      [
        organizationId,
        staffMemberIds,
        range.startsAt.toISOString(),
        range.endsAt.toISOString(),
      ],
    );

    return result.rows.map(mapTimeOff);
  }

  async listConfigurationTimeOffs(organizationId: string): Promise<TimeOff[]> {
    const result = await this.pool.query<TimeOffRow>(
      `
        select id, organization_id, staff_member_id, starts_at, ends_at, reason
        from time_off
        where organization_id = $1
        order by starts_at asc, id asc
      `,
      [organizationId],
    );

    return result.rows.map(mapTimeOff);
  }

  async listBookings(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
    excludeBookingId?: string,
  ): Promise<Booking[]> {
    if (staffMemberIds.length === 0) {
      return [];
    }

    const result = await this.pool.query<BookingRow>(
      `
        select
          id,
          organization_id,
          service_id,
          customer_id,
          staff_member_id,
          starts_at,
          ends_at,
          status,
          channel_origin,
          created_at
        from bookings
        where organization_id = $1
          and staff_member_id = any($2::uuid[])
          and status <> 'cancelled'
          and ($5::uuid is null or id <> $5::uuid)
          and starts_at < $4
          and ends_at > $3
      `,
      [
        organizationId,
        staffMemberIds,
        range.startsAt.toISOString(),
        range.endsAt.toISOString(),
        excludeBookingId ?? null,
      ],
    );

    return result.rows.map(mapBooking);
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
    const result = await this.pool.query<BookingRow>(
      `
        select
          id,
          organization_id,
          service_id,
          customer_id,
          staff_member_id,
          starts_at,
          ends_at,
          status,
          channel_origin,
          created_at
        from bookings
        where organization_id = $1
          and ($2::timestamptz is null or ends_at > $2::timestamptz)
          and ($3::timestamptz is null or starts_at < $3::timestamptz)
          and ($4::text is null or status = $4::text)
          and ($5::uuid is null or staff_member_id = $5::uuid)
          and ($6::uuid is null or service_id = $6::uuid)
          and ($7::uuid is null or customer_id = $7::uuid)
        order by starts_at asc, id asc
      `,
      [
        input.organizationId,
        input.startsAt?.toISOString() ?? null,
        input.endsAt?.toISOString() ?? null,
        input.status ?? null,
        input.staffMemberId ?? null,
        input.serviceId ?? null,
        input.customerId ?? null,
      ],
    );

    return result.rows.map(mapBooking);
  }

  async createOrganization(input: {
    name: string;
    slug: string;
    timeZone: string;
  }): Promise<Organization> {
    try {
      const result = await this.pool.query<OrganizationRow>(
        `
          insert into organizations (name, slug, time_zone)
          values ($1, $2, $3)
          returning id, name, slug, time_zone
        `,
        [input.name, input.slug, input.timeZone],
      );

      return mapOrganization(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Organization slug already exists.");
      }

      throw error;
    }
  }

  async createService(input: {
    organizationId: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    active: boolean;
  }): Promise<Service> {
    const result = await this.pool.query<ServiceRow>(
      `
        insert into services (
          organization_id,
          name,
          description,
          duration_minutes,
          active
        )
        values ($1, $2, $3, $4, $5)
        returning id, organization_id, name, description, duration_minutes, active
      `,
      [
        input.organizationId,
        input.name,
        input.description,
        input.durationMinutes,
        input.active,
      ],
    );

    return mapService(result.rows[0]);
  }

  async createStaffMember(input: {
    organizationId: string;
    fullName: string;
    active: boolean;
  }): Promise<StaffMember> {
    const result = await this.pool.query<StaffMemberRow>(
      `
        insert into staff_members (organization_id, full_name, active)
        values ($1, $2, $3)
        returning id, organization_id, full_name, active
      `,
      [input.organizationId, input.fullName, input.active],
    );

    return mapStaffMember(result.rows[0]);
  }

  async createAvailabilityRule(input: {
    organizationId: string;
    staffMemberId: string | null;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }): Promise<AvailabilityRule> {
    const result = await this.pool.query<AvailabilityRuleRow>(
      `
        insert into availability_rules (
          organization_id,
          staff_member_id,
          day_of_week,
          start_time,
          end_time,
          is_active
        )
        values ($1, $2, $3, $4, $5, $6)
        returning
          id,
          organization_id,
          staff_member_id,
          day_of_week,
          start_time,
          end_time,
          is_active
      `,
      [
        input.organizationId,
        input.staffMemberId,
        input.dayOfWeek,
        input.startTime,
        input.endTime,
        input.isActive,
      ],
    );

    return mapAvailabilityRule(result.rows[0]);
  }

  async createTimeOff(input: {
    organizationId: string;
    staffMemberId: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
  }): Promise<TimeOff> {
    const result = await this.pool.query<TimeOffRow>(
      `
        insert into time_off (
          organization_id,
          staff_member_id,
          starts_at,
          ends_at,
          reason
        )
        values ($1, $2, $3, $4, $5)
        returning id, organization_id, staff_member_id, starts_at, ends_at, reason
      `,
      [
        input.organizationId,
        input.staffMemberId,
        input.startsAt.toISOString(),
        input.endsAt.toISOString(),
        input.reason,
      ],
    );

    return mapTimeOff(result.rows[0]);
  }

  async withTransaction<T>(
    callback: (store: BookingMutationStore) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const store = new TransactionalPostgresBookingCoreStore(client);
      const result = await callback(store);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimPendingNotificationJobs(input: {
    limit: number;
    now: Date;
    staleBefore: Date;
  }): Promise<ClaimedNotificationJob[]> {
    const result = await this.pool.query<ClaimedNotificationJobRow>(
      `
        with candidate_jobs as (
          select id
          from notification_jobs
          where (
            (status = 'pending' and next_attempt_at <= $1)
            or (status = 'processing' and processing_started_at <= $2)
          )
            and attempt_count < max_attempts
          order by next_attempt_at asc, created_at asc
          limit $3
          for update skip locked
        ),
        updated_jobs as (
          update notification_jobs notification_jobs
          set
            status = 'processing',
            attempt_count = notification_jobs.attempt_count + 1,
            processing_token = gen_random_uuid()::text,
            processing_started_at = $1,
            last_error_code = null,
            last_error_message = null,
            updated_at = $1
          from candidate_jobs
          where notification_jobs.id = candidate_jobs.id
          returning
            notification_jobs.id,
            notification_jobs.organization_id,
            notification_jobs.booking_id,
            notification_jobs.customer_id,
            notification_jobs.event_type,
            notification_jobs.status,
            notification_jobs.attempt_count,
            notification_jobs.max_attempts,
            notification_jobs.next_attempt_at,
            notification_jobs.processing_token,
            notification_jobs.processing_started_at,
            notification_jobs.last_error_code,
            notification_jobs.last_error_message,
            notification_jobs.payload,
            notification_jobs.created_at,
            notification_jobs.updated_at
        ),
        inserted_attempts as (
          insert into notification_job_attempts (
            notification_job_id,
            attempt_number,
            processing_token,
            status,
            started_at
          )
          select
            id,
            attempt_count,
            processing_token,
            'processing',
            processing_started_at
          from updated_jobs
          returning
            id,
            notification_job_id,
            attempt_number,
            processing_token,
            status,
            outcome_code,
            outcome_message,
            outcome_payload,
            started_at,
            finished_at
        )
        select
          updated_jobs.id as job_id,
          updated_jobs.organization_id as job_organization_id,
          updated_jobs.booking_id as job_booking_id,
          updated_jobs.customer_id as job_customer_id,
          updated_jobs.event_type as job_event_type,
          updated_jobs.status as job_status,
          updated_jobs.attempt_count as job_attempt_count,
          updated_jobs.max_attempts as job_max_attempts,
          updated_jobs.next_attempt_at as job_next_attempt_at,
          updated_jobs.processing_token as job_processing_token,
          updated_jobs.processing_started_at as job_processing_started_at,
          updated_jobs.last_error_code as job_last_error_code,
          updated_jobs.last_error_message as job_last_error_message,
          updated_jobs.payload as job_payload,
          updated_jobs.created_at as job_created_at,
          updated_jobs.updated_at as job_updated_at,
          inserted_attempts.id as attempt_id,
          inserted_attempts.notification_job_id as attempt_notification_job_id,
          inserted_attempts.attempt_number as attempt_attempt_number,
          inserted_attempts.processing_token as attempt_processing_token,
          inserted_attempts.status as attempt_status,
          inserted_attempts.outcome_code as attempt_outcome_code,
          inserted_attempts.outcome_message as attempt_outcome_message,
          inserted_attempts.outcome_payload as attempt_outcome_payload,
          inserted_attempts.started_at as attempt_started_at,
          inserted_attempts.finished_at as attempt_finished_at
        from updated_jobs
        inner join inserted_attempts
          on inserted_attempts.notification_job_id = updated_jobs.id
         and inserted_attempts.attempt_number = updated_jobs.attempt_count
      `,
      [input.now.toISOString(), input.staleBefore.toISOString(), input.limit],
    );

    return result.rows.map(mapClaimedNotificationJob);
  }

  async markNotificationJobSucceeded(input: {
    notificationJobId: string;
    processingToken: string;
    finishedAt: Date;
    outcomePayload: Record<string, unknown>;
  }): Promise<NotificationJob | null> {
    const result = await this.pool.query<NotificationJobRow>(
      `
        with updated_attempt as (
          update notification_job_attempts
          set
            status = 'succeeded',
            outcome_payload = $4::jsonb,
            finished_at = $3
          where notification_job_id = $1
            and processing_token = $2
            and status = 'processing'
          returning notification_job_id
        )
        update notification_jobs
        set
          status = 'succeeded',
          processing_token = null,
          processing_started_at = null,
          last_error_code = null,
          last_error_message = null,
          updated_at = $3
        where id = $1
          and processing_token = $2
          and exists (select 1 from updated_attempt)
        returning
          id,
          organization_id,
          booking_id,
          customer_id,
          event_type,
          status,
          attempt_count,
          max_attempts,
          next_attempt_at,
          processing_token,
          processing_started_at,
          last_error_code,
          last_error_message,
          payload,
          created_at,
          updated_at
      `,
      [
        input.notificationJobId,
        input.processingToken,
        input.finishedAt.toISOString(),
        JSON.stringify(input.outcomePayload),
      ],
    );

    return result.rows[0] ? mapNotificationJob(result.rows[0]) : null;
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
    const result = await this.pool.query<NotificationJobRow>(
      `
        with updated_attempt as (
          update notification_job_attempts
          set
            status = 'failed',
            outcome_code = $4,
            outcome_message = $5,
            outcome_payload = $6::jsonb,
            finished_at = $3
          where notification_job_id = $1
            and processing_token = $2
            and status = 'processing'
          returning notification_job_id
        )
        update notification_jobs
        set
          status = case
            when $7 = true and attempt_count < max_attempts then 'pending'
            else 'failed'
          end,
          next_attempt_at = case
            when $7 = true and $8::timestamptz is not null and attempt_count < max_attempts
              then $8::timestamptz
            else next_attempt_at
          end,
          processing_token = null,
          processing_started_at = null,
          last_error_code = $4,
          last_error_message = $5,
          updated_at = $3
        where id = $1
          and processing_token = $2
          and exists (select 1 from updated_attempt)
        returning
          id,
          organization_id,
          booking_id,
          customer_id,
          event_type,
          status,
          attempt_count,
          max_attempts,
          next_attempt_at,
          processing_token,
          processing_started_at,
          last_error_code,
          last_error_message,
          payload,
          created_at,
          updated_at
      `,
      [
        input.notificationJobId,
        input.processingToken,
        input.finishedAt.toISOString(),
        input.errorCode,
        input.errorMessage,
        JSON.stringify(input.outcomePayload),
        input.shouldRetry,
        input.retryAt?.toISOString() ?? null,
      ],
    );

    return result.rows[0] ? mapNotificationJob(result.rows[0]) : null;
  }
}

class TransactionalPostgresBookingCoreStore implements BookingMutationStore {
  private readonly reader: QueryRunnerBackedRepository;

  constructor(private readonly runner: QueryRunner) {
    this.reader = new QueryRunnerBackedRepository(runner);
  }

  async getOrganization(organizationId: string): Promise<Organization | null> {
    return this.reader.getOrganization(organizationId);
  }

  async getActiveService(
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null> {
    return this.reader.getActiveService(organizationId, serviceId);
  }

  async listActiveStaffMembers(
    organizationId: string,
    staffMemberId?: string,
  ): Promise<StaffMember[]> {
    return this.reader.listActiveStaffMembers(organizationId, staffMemberId);
  }

  async listAvailabilityRules(
    organizationId: string,
    staffMemberIds: string[],
    dayOfWeeks: number[],
  ): Promise<AvailabilityRule[]> {
    return this.reader.listAvailabilityRules(
      organizationId,
      staffMemberIds,
      dayOfWeeks,
    );
  }

  async listTimeOffs(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
  ): Promise<TimeOff[]> {
    return this.reader.listTimeOffs(organizationId, staffMemberIds, range);
  }

  async listBookings(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
    excludeBookingId?: string,
  ): Promise<Booking[]> {
    return this.reader.listBookings(
      organizationId,
      staffMemberIds,
      range,
      excludeBookingId,
    );
  }

  async getBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<Booking | null> {
    return this.reader.getBooking(organizationId, bookingId);
  }

  async getCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<Customer | null> {
    return this.reader.getCustomer(organizationId, customerId);
  }

  async findCustomerByContact(
    organizationId: string,
    contact: CustomerContactInput,
  ): Promise<Customer | null> {
    const result = await this.runner.query<CustomerRow>(
      `
        select id, organization_id, full_name, phone, email
        from customers
        where organization_id = $1
          and (
            ($2::text is not null and phone = $2::text)
            or ($3::text is not null and lower(email) = $3::text)
          )
        order by created_at asc
        limit 1
      `,
      [
        organizationId,
        contact.phone ?? null,
        contact.email?.toLowerCase() ?? null,
      ],
    );

    return result.rows[0] ? mapCustomer(result.rows[0]) : null;
  }

  async createCustomer(
    organizationId: string,
    contact: CustomerContactInput,
  ): Promise<Customer> {
    const result = await this.runner.query<CustomerRow>(
      `
        insert into customers (organization_id, full_name, phone, email)
        values ($1, $2, $3, $4)
        returning id, organization_id, full_name, phone, email
      `,
      [
        organizationId,
        contact.fullName.trim(),
        contact.phone ?? null,
        contact.email?.toLowerCase() ?? null,
      ],
    );

    return mapCustomer(result.rows[0]);
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
    try {
      const result = await this.runner.query<BookingRow>(
        `
          insert into bookings (
            organization_id,
            service_id,
            customer_id,
            staff_member_id,
            starts_at,
            ends_at,
            status,
            channel_origin
          )
          values ($1, $2, $3, $4, $5, $6, 'confirmed', $7)
          returning
            id,
            organization_id,
            service_id,
            customer_id,
            staff_member_id,
            starts_at,
            ends_at,
            status,
            channel_origin,
            created_at
        `,
        [
          input.organizationId,
          input.serviceId,
          input.customerId,
          input.staffMemberId,
          input.startsAt.toISOString(),
          input.endsAt.toISOString(),
          input.channelOrigin,
        ],
      );

      return mapBooking(result.rows[0]);
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new ConflictError("Booking conflicts with an existing booking.");
      }

      throw error;
    }
  }

  async updateBookingStatus(input: {
    organizationId: string;
    bookingId: string;
    status: Booking["status"];
  }): Promise<Booking> {
    const result = await this.runner.query<BookingRow>(
      `
        update bookings
        set status = $3
        where organization_id = $1
          and id = $2
        returning
          id,
          organization_id,
          service_id,
          customer_id,
          staff_member_id,
          starts_at,
          ends_at,
          status,
          channel_origin,
          created_at
      `,
      [input.organizationId, input.bookingId, input.status],
    );

    return mapBooking(result.rows[0]);
  }

  async updateBookingSchedule(input: {
    organizationId: string;
    bookingId: string;
    staffMemberId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<Booking> {
    try {
      const result = await this.runner.query<BookingRow>(
        `
          update bookings
          set
            staff_member_id = $3,
            starts_at = $4,
            ends_at = $5
          where organization_id = $1
            and id = $2
          returning
            id,
            organization_id,
            service_id,
            customer_id,
            staff_member_id,
            starts_at,
            ends_at,
            status,
            channel_origin,
            created_at
        `,
        [
          input.organizationId,
          input.bookingId,
          input.staffMemberId,
          input.startsAt.toISOString(),
          input.endsAt.toISOString(),
        ],
      );

      return mapBooking(result.rows[0]);
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new ConflictError("Booking conflicts with an existing booking.");
      }

      throw error;
    }
  }

  async createBookingEvent(input: {
    organizationId: string;
    bookingId: string;
    eventType: BookingEventType;
    metadata: Record<string, unknown>;
  }): Promise<BookingEvent> {
    const result = await this.runner.query<BookingEventRow>(
      `
        insert into booking_events (
          organization_id,
          booking_id,
          event_type,
          metadata
        )
        values ($1, $2, $3, $4::jsonb)
        returning
          id,
          organization_id,
          booking_id,
          event_type,
          metadata,
          occurred_at
      `,
      [
        input.organizationId,
        input.bookingId,
        input.eventType,
        JSON.stringify(input.metadata),
      ],
    );

    return mapBookingEvent(result.rows[0]);
  }

  async createNotificationJob(input: {
    organizationId: string;
    bookingId: string;
    customerId: string;
    eventType: BookingEventType;
    payload: Record<string, unknown>;
  }): Promise<NotificationJob> {
    const result = await this.runner.query<NotificationJobRow>(
      `
        insert into notification_jobs (
          organization_id,
          booking_id,
          customer_id,
          event_type,
          status,
          payload
        )
        values ($1, $2, $3, $4, 'pending', $5::jsonb)
        returning
          id,
          organization_id,
          booking_id,
          customer_id,
          event_type,
          status,
          attempt_count,
          max_attempts,
          next_attempt_at,
          processing_token,
          processing_started_at,
          last_error_code,
          last_error_message,
          payload,
          created_at,
          updated_at
      `,
      [
        input.organizationId,
        input.bookingId,
        input.customerId,
        input.eventType,
        JSON.stringify(input.payload),
      ],
    );

    return mapNotificationJob(result.rows[0]);
  }
}

class QueryRunnerBackedRepository {
  constructor(private readonly runner: QueryRunner) {}

  async getOrganization(organizationId: string): Promise<Organization | null> {
    const result = await this.runner.query<OrganizationRow>(
      `
        select id, name, slug, time_zone
        from organizations
        where id = $1
      `,
      [organizationId],
    );

    return result.rows[0] ? mapOrganization(result.rows[0]) : null;
  }

  async getActiveService(
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null> {
    const result = await this.runner.query<ServiceRow>(
      `
        select id, organization_id, name, description, duration_minutes, active
        from services
        where id = $1
          and organization_id = $2
          and active = true
      `,
      [serviceId, organizationId],
    );

    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async listActiveStaffMembers(
    organizationId: string,
    staffMemberId?: string,
  ): Promise<StaffMember[]> {
    const result = await this.runner.query<StaffMemberRow>(
      `
        select id, organization_id, full_name, active
        from staff_members
        where organization_id = $1
          and active = true
          and ($2::uuid is null or id = $2::uuid)
      `,
      [organizationId, staffMemberId ?? null],
    );

    return result.rows.map(mapStaffMember);
  }

  async listAvailabilityRules(
    organizationId: string,
    staffMemberIds: string[],
    dayOfWeeks: number[],
  ): Promise<AvailabilityRule[]> {
    if (staffMemberIds.length === 0 || dayOfWeeks.length === 0) {
      return [];
    }

    const result = await this.runner.query<AvailabilityRuleRow>(
      `
        select id, organization_id, staff_member_id, day_of_week, start_time, end_time, is_active
        from availability_rules
        where organization_id = $1
          and is_active = true
          and day_of_week = any($2::smallint[])
          and (staff_member_id is null or staff_member_id = any($3::uuid[]))
      `,
      [organizationId, dayOfWeeks, staffMemberIds],
    );

    return result.rows.map(mapAvailabilityRule);
  }

  async listTimeOffs(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
    excludeBookingId?: string,
  ): Promise<TimeOff[]> {
    void excludeBookingId;
    if (staffMemberIds.length === 0) {
      return [];
    }

    const result = await this.runner.query<TimeOffRow>(
      `
        select id, organization_id, staff_member_id, starts_at, ends_at, reason
        from time_off
        where organization_id = $1
          and (staff_member_id is null or staff_member_id = any($2::uuid[]))
          and starts_at < $4
          and ends_at > $3
      `,
      [
        organizationId,
        staffMemberIds,
        range.startsAt.toISOString(),
        range.endsAt.toISOString(),
      ],
    );

    return result.rows.map(mapTimeOff);
  }

  async listBookings(
    organizationId: string,
    staffMemberIds: string[],
    range: DateRange,
    excludeBookingId?: string,
  ): Promise<Booking[]> {
    if (staffMemberIds.length === 0) {
      return [];
    }

    const result = await this.runner.query<BookingRow>(
      `
        select
          id,
          organization_id,
          service_id,
          customer_id,
          staff_member_id,
          starts_at,
          ends_at,
          status,
          channel_origin,
          created_at
        from bookings
        where organization_id = $1
          and staff_member_id = any($2::uuid[])
          and status <> 'cancelled'
          and ($5::uuid is null or id <> $5::uuid)
          and starts_at < $4
          and ends_at > $3
      `,
      [
        organizationId,
        staffMemberIds,
        range.startsAt.toISOString(),
        range.endsAt.toISOString(),
        excludeBookingId ?? null,
      ],
    );

    return result.rows.map(mapBooking);
  }

  async getBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<Booking | null> {
    const result = await this.runner.query<BookingRow>(
      `
        select
          id,
          organization_id,
          service_id,
          customer_id,
          staff_member_id,
          starts_at,
          ends_at,
          status,
          channel_origin,
          created_at
        from bookings
        where organization_id = $1
          and id = $2
      `,
      [organizationId, bookingId],
    );

    return result.rows[0] ? mapBooking(result.rows[0]) : null;
  }

  async getCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<Customer | null> {
    const result = await this.runner.query<CustomerRow>(
      `
        select id, organization_id, full_name, phone, email
        from customers
        where organization_id = $1
          and id = $2
      `,
      [organizationId, customerId],
    );

    return result.rows[0] ? mapCustomer(result.rows[0]) : null;
  }
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
}

interface ServiceRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  active: boolean;
}

interface StaffMemberRow {
  id: string;
  organization_id: string;
  full_name: string;
  active: boolean;
}

interface CustomerRow {
  id: string;
  organization_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

interface AvailabilityRuleRow {
  id: string;
  organization_id: string;
  staff_member_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

interface TimeOffRow {
  id: string;
  organization_id: string;
  staff_member_id: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  reason: string | null;
}

interface BookingRow {
  id: string;
  organization_id: string;
  service_id: string;
  customer_id: string;
  staff_member_id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  status: Booking["status"];
  channel_origin: Booking["channelOrigin"];
  created_at: Date | string;
}

interface BookingEventRow {
  id: string;
  organization_id: string;
  booking_id: string;
  event_type: BookingEventType;
  metadata: Record<string, unknown> | string;
  occurred_at: Date | string;
}

interface NotificationJobRow {
  id: string;
  organization_id: string;
  booking_id: string;
  customer_id: string;
  event_type: BookingEventType;
  status: NotificationJob["status"];
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | string;
  processing_token: string | null;
  processing_started_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  payload: Record<string, unknown> | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface NotificationJobAttemptRow {
  id: string;
  notification_job_id: string;
  attempt_number: number;
  processing_token: string;
  status: NotificationJobAttempt["status"];
  outcome_code: string | null;
  outcome_message: string | null;
  outcome_payload: Record<string, unknown> | string;
  started_at: Date | string;
  finished_at: Date | string | null;
}

interface ClaimedNotificationJobRow {
  job_id: string;
  job_organization_id: string;
  job_booking_id: string;
  job_customer_id: string;
  job_event_type: BookingEventType;
  job_status: NotificationJob["status"];
  job_attempt_count: number;
  job_max_attempts: number;
  job_next_attempt_at: Date | string;
  job_processing_token: string | null;
  job_processing_started_at: Date | string | null;
  job_last_error_code: string | null;
  job_last_error_message: string | null;
  job_payload: Record<string, unknown> | string;
  job_created_at: Date | string;
  job_updated_at: Date | string;
  attempt_id: string;
  attempt_notification_job_id: string;
  attempt_attempt_number: number;
  attempt_processing_token: string;
  attempt_status: NotificationJobAttempt["status"];
  attempt_outcome_code: string | null;
  attempt_outcome_message: string | null;
  attempt_outcome_payload: Record<string, unknown> | string;
  attempt_started_at: Date | string;
  attempt_finished_at: Date | string | null;
}

function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timeZone: row.time_zone,
  };
}

function mapService(row: ServiceRow): Service {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    active: row.active,
  };
}

function mapStaffMember(row: StaffMemberRow): StaffMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    fullName: row.full_name,
    active: row.active,
  };
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
  };
}

function mapAvailabilityRule(row: AvailabilityRuleRow): AvailabilityRule {
  return {
    id: row.id,
    organizationId: row.organization_id,
    staffMemberId: row.staff_member_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    isActive: row.is_active,
  };
}

function mapTimeOff(row: TimeOffRow): TimeOff {
  return {
    id: row.id,
    organizationId: row.organization_id,
    staffMemberId: row.staff_member_id,
    startsAt: toDate(row.starts_at),
    endsAt: toDate(row.ends_at),
    reason: row.reason,
  };
}

function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    organizationId: row.organization_id,
    serviceId: row.service_id,
    customerId: row.customer_id,
    staffMemberId: row.staff_member_id,
    startsAt: toDate(row.starts_at),
    endsAt: toDate(row.ends_at),
    status: row.status,
    channelOrigin: row.channel_origin,
    createdAt: toDate(row.created_at),
  };
}

function mapBookingEvent(row: BookingEventRow): BookingEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    bookingId: row.booking_id,
    eventType: row.event_type,
    metadata: toRecord(row.metadata),
    occurredAt: toDate(row.occurred_at),
  };
}

function mapNotificationJob(row: NotificationJobRow): NotificationJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    bookingId: row.booking_id,
    customerId: row.customer_id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: toDate(row.next_attempt_at),
    processingToken: row.processing_token,
    processingStartedAt: row.processing_started_at
      ? toDate(row.processing_started_at)
      : null,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    payload: toRecord(row.payload),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapNotificationJobAttempt(
  row: NotificationJobAttemptRow,
): NotificationJobAttempt {
  return {
    id: row.id,
    notificationJobId: row.notification_job_id,
    attemptNumber: row.attempt_number,
    processingToken: row.processing_token,
    status: row.status,
    outcomeCode: row.outcome_code,
    outcomeMessage: row.outcome_message,
    outcomePayload: toRecord(row.outcome_payload),
    startedAt: toDate(row.started_at),
    finishedAt: row.finished_at ? toDate(row.finished_at) : null,
  };
}

function mapClaimedNotificationJob(
  row: ClaimedNotificationJobRow,
): ClaimedNotificationJob {
  return {
    job: mapNotificationJob({
      id: row.job_id,
      organization_id: row.job_organization_id,
      booking_id: row.job_booking_id,
      customer_id: row.job_customer_id,
      event_type: row.job_event_type,
      status: row.job_status,
      attempt_count: row.job_attempt_count,
      max_attempts: row.job_max_attempts,
      next_attempt_at: row.job_next_attempt_at,
      processing_token: row.job_processing_token,
      processing_started_at: row.job_processing_started_at,
      last_error_code: row.job_last_error_code,
      last_error_message: row.job_last_error_message,
      payload: row.job_payload,
      created_at: row.job_created_at,
      updated_at: row.job_updated_at,
    }),
    attempt: mapNotificationJobAttempt({
      id: row.attempt_id,
      notification_job_id: row.attempt_notification_job_id,
      attempt_number: row.attempt_attempt_number,
      processing_token: row.attempt_processing_token,
      status: row.attempt_status,
      outcome_code: row.attempt_outcome_code,
      outcome_message: row.attempt_outcome_message,
      outcome_payload: row.attempt_outcome_payload,
      started_at: row.attempt_started_at,
      finished_at: row.attempt_finished_at,
    }),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toRecord(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed;
  }

  return value;
}

function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23P01"
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
