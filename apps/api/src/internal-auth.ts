import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { Pool } from "pg";

export type InternalApiRole = "platform_admin" | "organization_operator";

export interface InternalApiPrincipal {
  tokenId: string;
  role: InternalApiRole;
  organizationId: string | null;
  description: string | null;
}

export class InternalApiUnauthorizedError extends Error {
  readonly code = "INTERNAL_API_UNAUTHORIZED";

  constructor(message: string) {
    super(message);
    this.name = "InternalApiUnauthorizedError";
  }
}

export class InternalApiForbiddenError extends Error {
  readonly code = "INTERNAL_API_FORBIDDEN";

  constructor(message: string) {
    super(message);
    this.name = "InternalApiForbiddenError";
  }
}

interface InternalApiTokenRecord {
  id: string;
  role: InternalApiRole;
  organizationId: string | null;
  description: string | null;
}

interface InternalApiAuthRepository {
  getActiveTokenByHash(input: {
    tokenHash: string;
    now: Date;
  }): Promise<InternalApiTokenRecord | null>;
  markTokenUsed(input: { tokenId: string; usedAt: Date }): Promise<void>;
}

interface InternalApiTokenRow {
  id: string;
  role: InternalApiRole;
  organization_id: string | null;
  description: string | null;
}

export class PostgresInternalApiAuthRepository
  implements InternalApiAuthRepository
{
  constructor(private readonly pool: Pool) {}

  async getActiveTokenByHash(input: {
    tokenHash: string;
    now: Date;
  }): Promise<InternalApiTokenRecord | null> {
    const result = await this.pool.query<InternalApiTokenRow>(
      `
        select
          id,
          role,
          organization_id,
          description
        from internal_api_tokens
        where token_hash = $1
          and active = true
          and (expires_at is null or expires_at > $2::timestamptz)
        limit 1
      `,
      [input.tokenHash, input.now.toISOString()],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      id: result.rows[0].id,
      role: result.rows[0].role,
      organizationId: result.rows[0].organization_id,
      description: result.rows[0].description,
    };
  }

  async markTokenUsed(input: { tokenId: string; usedAt: Date }): Promise<void> {
    await this.pool.query(
      `
        update internal_api_tokens
        set
          last_used_at = $2::timestamptz,
          updated_at = now()
        where id = $1
      `,
      [input.tokenId, input.usedAt.toISOString()],
    );
  }
}

export function createInternalApiAuthService(
  repository: InternalApiAuthRepository,
) {
  return {
    async authenticateRequest(
      request: IncomingMessage,
      now = new Date(),
    ): Promise<InternalApiPrincipal> {
      const bearerToken = readBearerTokenFromRequest(request);
      return this.authenticateBearerToken(bearerToken, now);
    },

    async authenticateBearerToken(
      token: string,
      now = new Date(),
    ): Promise<InternalApiPrincipal> {
      const normalizedToken = normalizeBearerToken(token);
      const tokenHash = hashBearerToken(normalizedToken);
      const tokenRecord = await repository.getActiveTokenByHash({
        tokenHash,
        now,
      });

      if (!tokenRecord) {
        throw new InternalApiUnauthorizedError(
          "Internal API token is missing, inactive, expired, or invalid.",
        );
      }

      await repository.markTokenUsed({
        tokenId: tokenRecord.id,
        usedAt: now,
      });

      return {
        tokenId: tokenRecord.id,
        role: tokenRecord.role,
        organizationId: tokenRecord.organizationId,
        description: tokenRecord.description,
      };
    },

    assertPlatformAdmin(principal: InternalApiPrincipal | null): void {
      assertAuthenticated(principal);

      if (principal.role !== "platform_admin") {
        throw new InternalApiForbiddenError(
          "Platform-admin access is required for this endpoint.",
        );
      }
    },

    assertOrganizationAccess(
      principal: InternalApiPrincipal | null,
      organizationId: string,
    ): void {
      assertAuthenticated(principal);

      if (principal.role === "platform_admin") {
        return;
      }

      if (
        principal.role === "organization_operator" &&
        principal.organizationId === organizationId
      ) {
        return;
      }

      throw new InternalApiForbiddenError(
        "Token is not authorized for the requested organization.",
      );
    },
  };
}

function readBearerTokenFromRequest(request: IncomingMessage): string {
  const authorizationHeader = readSingleHeader(request, "authorization");

  if (!authorizationHeader) {
    throw new InternalApiUnauthorizedError("Authorization header is required.");
  }

  if (!authorizationHeader.startsWith("Bearer ")) {
    throw new InternalApiUnauthorizedError(
      "Authorization header must use Bearer authentication.",
    );
  }

  return authorizationHeader.slice("Bearer ".length);
}

function readSingleHeader(
  request: IncomingMessage,
  headerName: string,
): string | null {
  const value = request.headers[headerName];

  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeBearerToken(token: string): string {
  const normalized = token.trim();

  if (normalized.length < 16) {
    throw new InternalApiUnauthorizedError("Bearer token is invalid.");
  }

  return normalized;
}

function hashBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertAuthenticated(
  principal: InternalApiPrincipal | null,
): asserts principal is InternalApiPrincipal {
  if (!principal) {
    throw new InternalApiUnauthorizedError(
      "Authentication is required for this endpoint.",
    );
  }
}
