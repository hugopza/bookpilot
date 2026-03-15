import { ValidationError } from "../domain/errors";

const MAX_RANGE_DAYS = 31;

export function parseDateTime(value: string, fieldName: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid ISO-8601 datetime.`);
  }

  return parsed;
}

export function assertValidRange(startsAt: Date, endsAt: Date): void {
  if (endsAt <= startsAt) {
    throw new ValidationError("endsAt must be later than startsAt.");
  }

  const days = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60 * 24);

  if (days > MAX_RANGE_DAYS) {
    throw new ValidationError("Availability windows are limited to 31 days.");
  }
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

export function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export function listUtcDays(startsAt: Date, endsAt: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfUtcDay(startsAt);
  const lastDay = startOfUtcDay(new Date(endsAt.getTime() - 1));

  while (cursor <= lastDay) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return days;
}

export function combineUtcDateAndTime(day: Date, time: string): Date {
  const [hoursText, minutesText, secondsText = "0"] = time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);

  if (
    [hours, minutes, seconds].some((part) => Number.isNaN(part)) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    throw new ValidationError(`Invalid time value "${time}".`);
  }

  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hours,
      minutes,
      seconds,
    ),
  );
}

export function overlaps(
  leftStartsAt: Date,
  leftEndsAt: Date,
  rightStartsAt: Date,
  rightEndsAt: Date,
): boolean {
  return leftStartsAt < rightEndsAt && rightStartsAt < leftEndsAt;
}
