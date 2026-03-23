export function toDateTimeLocalInput(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export function toIsoDateTime(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid datetime.`);
  }

  return parsed.toISOString();
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function emptyStringToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function emptyStringToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function appendTrimmedSearchParam(
  searchParams: URLSearchParams,
  key: string,
  value: string,
): void {
  const trimmed = value.trim();

  if (trimmed.length > 0) {
    searchParams.set(key, trimmed);
  }
}

export function appendIsoDateTimeSearchParam(
  searchParams: URLSearchParams,
  key: string,
  value: string,
): void {
  const trimmed = value.trim();

  if (trimmed.length > 0) {
    searchParams.set(key, toIsoDateTime(trimmed, key));
  }
}

export function parseJsonObject(value: string, fieldName: string): Record<string, unknown> {
  const trimmed = value.trim();

  if (!trimmed) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

