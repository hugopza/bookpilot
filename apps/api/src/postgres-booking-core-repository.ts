import type { Pool, QueryResultRow } from "pg";

import {
  ConflictError,
  type AvailabilityRule,
  type Booking,
  type BookingMutationStore,
  type BookingRepository,
  type ConfigurationRepository,
  type Customer,
  type CustomerContactInput,
  type DateRange,
  type Organization,
  type Service,
  type StaffMember,
  type TimeOff,
} from "@bookpilot/booking-core";

interface QueryRunner {
  query<T extends QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export class PostgresBookingCoreRepository
  implements BookingRepository, ConfigurationRepository
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
  ): Promise<TimeOff[]> {
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
  ): Promise<Booking[]> {
    return this.reader.listBookings(organizationId, staffMemberIds, range);
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
  ): Promise<TimeOff[]> {
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

    return result.rows.map(mapBooking);
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

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
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
