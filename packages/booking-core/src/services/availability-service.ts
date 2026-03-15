import type {
  AvailabilityRule,
  AvailabilitySlot,
  Booking,
  DateRange,
  Organization,
  Service,
  StaffMember,
  TimeOff,
} from "../domain/entities";
import { NotFoundError, ValidationError } from "../domain/errors";
import type { AvailabilityRepository } from "../repositories";
import {
  addMinutes,
  assertValidRange,
  combineUtcDateAndTime,
  listUtcDays,
  overlaps,
  parseDateTime,
} from "../utils/date-time";

export interface AvailabilityLookupInput {
  organizationId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  staffMemberId?: string;
  slotIntervalMinutes?: number;
}

export interface AvailabilityLookupResult {
  organization: Organization;
  service: Service;
  slots: AvailabilitySlot[];
}

export function createAvailabilityService(repository: AvailabilityRepository) {
  return {
    async lookup(
      input: AvailabilityLookupInput,
    ): Promise<AvailabilityLookupResult> {
      const startsAt = parseDateTime(input.startsAt, "startsAt");
      const endsAt = parseDateTime(input.endsAt, "endsAt");
      const slotIntervalMinutes = input.slotIntervalMinutes ?? 15;

      assertValidRange(startsAt, endsAt);

      if (slotIntervalMinutes <= 0) {
        throw new ValidationError("slotIntervalMinutes must be greater than zero.");
      }

      const organization = await repository.getOrganization(input.organizationId);

      if (!organization) {
        throw new NotFoundError("Organization was not found.");
      }

      const service = await repository.getActiveService(
        input.organizationId,
        input.serviceId,
      );

      if (!service) {
        throw new NotFoundError("Service was not found or is inactive.");
      }

      const staffMembers = await repository.listActiveStaffMembers(
        input.organizationId,
        input.staffMemberId,
      );

      if (input.staffMemberId && staffMembers.length === 0) {
        throw new NotFoundError("Staff member was not found or is inactive.");
      }

      if (staffMembers.length === 0) {
        return {
          organization,
          service,
          slots: [],
        };
      }

      const range: DateRange = { startsAt, endsAt };
      const staffMemberIds = staffMembers.map((staffMember) => staffMember.id);
      const dayOfWeeks = [
        ...new Set(listUtcDays(startsAt, endsAt).map((day) => day.getUTCDay())),
      ];

      const [rules, timeOffs, bookings] = await Promise.all([
        repository.listAvailabilityRules(
          input.organizationId,
          staffMemberIds,
          dayOfWeeks,
        ),
        repository.listTimeOffs(input.organizationId, staffMemberIds, range),
        repository.listBookings(input.organizationId, staffMemberIds, range),
      ]);

      return {
        organization,
        service,
        slots: buildAvailabilitySlots({
          organizationId: input.organizationId,
          serviceId: input.serviceId,
          serviceDurationMinutes: service.durationMinutes,
          slotIntervalMinutes,
          range,
          staffMembers,
          rules,
          timeOffs,
          bookings,
        }),
      };
    },
  };
}

interface BuildAvailabilitySlotsInput {
  organizationId: string;
  serviceId: string;
  serviceDurationMinutes: number;
  slotIntervalMinutes: number;
  range: DateRange;
  staffMembers: StaffMember[];
  rules: AvailabilityRule[];
  timeOffs: TimeOff[];
  bookings: Booking[];
}

function buildAvailabilitySlots(
  input: BuildAvailabilitySlotsInput,
): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  const days = listUtcDays(input.range.startsAt, input.range.endsAt);

  for (const staffMember of input.staffMembers) {
    const staffRulesByDay = groupRulesByDay(input.rules, staffMember.id);
    const relevantTimeOffs = input.timeOffs.filter(
      (timeOff) =>
        timeOff.staffMemberId === null || timeOff.staffMemberId === staffMember.id,
    );
    const relevantBookings = input.bookings.filter(
      (booking) =>
        booking.staffMemberId === staffMember.id && booking.status !== "cancelled",
    );

    for (const day of days) {
      const dayOfWeek = day.getUTCDay();
      const dailyRules =
        staffRulesByDay.staffSpecific.get(dayOfWeek) ??
        staffRulesByDay.organizationWide.get(dayOfWeek) ??
        [];

      for (const rule of dailyRules) {
        const windowStartsAt = combineUtcDateAndTime(day, rule.startTime);
        const windowEndsAt = combineUtcDateAndTime(day, rule.endTime);

        let candidateStartsAt = new Date(windowStartsAt);

        while (
          addMinutes(candidateStartsAt, input.serviceDurationMinutes) <=
          windowEndsAt
        ) {
          const candidateEndsAt = addMinutes(
            candidateStartsAt,
            input.serviceDurationMinutes,
          );

          if (
            candidateStartsAt >= input.range.startsAt &&
            candidateEndsAt <= input.range.endsAt &&
            !relevantTimeOffs.some((timeOff) =>
              overlaps(
                candidateStartsAt,
                candidateEndsAt,
                timeOff.startsAt,
                timeOff.endsAt,
              ),
            ) &&
            !relevantBookings.some((booking) =>
              overlaps(
                candidateStartsAt,
                candidateEndsAt,
                booking.startsAt,
                booking.endsAt,
              ),
            )
          ) {
            slots.push({
              organizationId: input.organizationId,
              serviceId: input.serviceId,
              staffMemberId: staffMember.id,
              startsAt: candidateStartsAt,
              endsAt: candidateEndsAt,
            });
          }

          candidateStartsAt = addMinutes(
            candidateStartsAt,
            input.slotIntervalMinutes,
          );
        }
      }
    }
  }

  return deduplicateSlots(slots);
}

function groupRulesByDay(rules: AvailabilityRule[], staffMemberId: string) {
  const staffSpecific = new Map<number, AvailabilityRule[]>();
  const organizationWide = new Map<number, AvailabilityRule[]>();

  for (const rule of rules) {
    const target =
      rule.staffMemberId === staffMemberId ? staffSpecific : organizationWide;
    const current = target.get(rule.dayOfWeek) ?? [];
    current.push(rule);
    target.set(rule.dayOfWeek, current);
  }

  return { staffSpecific, organizationWide };
}

function deduplicateSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const seen = new Set<string>();

  return [...slots]
    .sort((left, right) => {
      const startsDifference =
        left.startsAt.getTime() - right.startsAt.getTime();

      if (startsDifference !== 0) {
        return startsDifference;
      }

      return left.staffMemberId.localeCompare(right.staffMemberId);
    })
    .filter((slot) => {
      const key = `${slot.staffMemberId}:${slot.startsAt.toISOString()}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}
