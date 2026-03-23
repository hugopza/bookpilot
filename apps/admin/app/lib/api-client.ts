import type { SessionState } from "./types";

interface ApiErrorPayload {
  error?: string;
  code?: string;
}

export async function apiRequest<T>(
  session: SessionState,
  input: {
    method: "GET" | "POST" | "PUT";
    path: string;
    body?: unknown;
  },
): Promise<T> {
  const apiBaseUrl = session.apiBaseUrl.trim();
  const token = session.token.trim();

  if (!apiBaseUrl) {
    throw new Error("API base URL is required.");
  }

  if (!token) {
    throw new Error("Internal API token is required.");
  }

  const url = new URL(input.path, ensureTrailingSlash(apiBaseUrl));
  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);

  const requestInit: RequestInit = {
    method: input.method,
    headers,
  };

  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
    requestInit.body = JSON.stringify(input.body);
  }

  const response = await fetch(url.toString(), requestInit);
  const responseText = await response.text();
  const responsePayload = responseText ? parseJson(responseText) : null;

  if (!response.ok) {
    const apiError = isApiErrorPayload(responsePayload) ? responsePayload : null;
    const errorText = apiError?.error ?? `Request failed with status ${response.status}.`;
    const codeText = apiError?.code ? ` (${apiError.code})` : "";
    throw new Error(`${errorText}${codeText}`);
  }

  return responsePayload as T;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Response body is not valid JSON.");
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.error !== undefined && typeof candidate.error !== "string") {
    return false;
  }

  if (candidate.code !== undefined && typeof candidate.code !== "string") {
    return false;
  }

  return true;
}

