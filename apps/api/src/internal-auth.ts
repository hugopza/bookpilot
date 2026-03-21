import { createHash, randomBytes } from "node:crypto";
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

export class InternalApiValidationError extends Error {
  readonly code = "INTERNAL_API_VALIDATION";

  constructor(message: string) {
    super(message);
    this.name = "InternalApiValidationError";
  }
}

export class InternalApiNotFoundError extends Error {
  readonly code = "INTERNAL_API_NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "InternalApiNotFoundError";
  }
}

interface InternalApiTokenAuthRecord {
  id: string;
  role: InternalApiRole;
  organizationId: string | null;
  description: string | null;
}

export interface InternalApiTokenAuditRecord {
  id: string;
  role: InternalApiRole;
  organizationId: string | null;
  description: string | null;
  active: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InternalApiAuthRepository {
  getActiveTokenByHash(input: {
    tokenHash: string;
    now: Date;
  }): Promise<InternalApiTokenAuthRecord | null>;
  markTokenUsed(input: { tokenId: string; usedAt: Date }): Promise<void>;
}

interface InternalApiTokenLifecycleRepository {
  createToken(input: {
    tokenHash: string;
    role: InternalApiRole;
    organizationId: string | null;
    description: string | null;
    expiresAt: Date | null;
  }): Promise<InternalApiTokenAuditRecord>;
  getTokenById(tokenId: string): Promise<InternalApiTokenAuditRecord | null>;
  listTokens(input: {
    organizationId?: string;
    role?: InternalApiRole;
    active?: boolean;
    limit: number;
  }): Promise<InternalApiTokenAuditRecord[]>;
  revokeToken(input: {
    tokenId: string;
    revokedAt: Date;
  }): Promise<InternalApiTokenAuditRecord | null>;
  rotateToken(input: {
    tokenId: string;
    tokenHash: string;
    description: string | null;
    expiresAt: Date | null;
    now: Date;
  }): Promise<{
    revokedToken: InternalApiTokenAuditRecord;
    newToken: InternalApiTokenAuditRecord;
  } | null>;
}

interface InternalApiTokenRow {
  id: string;
  role: InternalApiRole;
  organization_id: string | null;
  description: string | null;
  active: boolean;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresInternalApiAuthRepository
  implements InternalApiAuthRepository, InternalApiTokenLifecycleRepository
{
  constructor(private readonly pool: Pool) {}

  async getActiveTokenByHash(input: {
    tokenHash: string;
    now: Date;
  }): Promise<InternalApiTokenAuthRecord | null> {
    const result = await this.pool.query<InternalApiTokenRow>(
      `
        select
          id,
          role,
          organization_id,
          description,
          active,
          expires_at,
          last_used_at,
          created_at,
          updated_at
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

  async createToken(input: {
    tokenHash: string;
    role: InternalApiRole;
    organizationId: string | null;
    description: string | null;
    expiresAt: Date | null;
  }): Promise<InternalApiTokenAuditRecord> {
    const result = await this.pool.query<InternalApiTokenRow>(
      `
        insert into internal_api_tokens (
          token_hash,
          role,
          organization_id,
          description,
          active,
          expires_at
        )
        values ($1, $2, $3, $4, true, $5::timestamptz)
        returning
          id,
          role,
          organization_id,
          description,
          active,
          expires_at,
          last_used_at,
          created_at,
          updated_at
      `,
      [
        input.tokenHash,
        input.role,
        input.organizationId,
        input.description,
        input.expiresAt?.toISOString() ?? null,
      ],
    );

    return mapInternalApiTokenAuditRecord(result.rows[0]);
  }

  async getTokenById(tokenId: string): Promise<InternalApiTokenAuditRecord | null> {
    const result = await this.pool.query<InternalApiTokenRow>(
      `
        select
          id,
          role,
          organization_id,
          description,
          active,
          expires_at,
          last_used_at,
          created_at,
          updated_at
        from internal_api_tokens
        where id = $1
        limit 1
      `,
      [tokenId],
    );

    return result.rows[0] ? mapInternalApiTokenAuditRecord(result.rows[0]) : null;
  }

  async listTokens(input: {
    organizationId?: string;
    role?: InternalApiRole;
    active?: boolean;
    limit: number;
  }): Promise<InternalApiTokenAuditRecord[]> {
    const result = await this.pool.query<InternalApiTokenRow>(
      `
        select
          id,
          role,
          organization_id,
          description,
          active,
          expires_at,
          last_used_at,
          created_at,
          updated_at
        from internal_api_tokens
        where ($1::uuid is null or organization_id = $1::uuid)
          and ($2::text is null or role = $2::text)
          and ($3::boolean is null or active = $3::boolean)
        order by created_at desc, id desc
        limit $4
      `,
      [
        input.organizationId ?? null,
        input.role ?? null,
        input.active ?? null,
        input.limit,
      ],
    );

    return result.rows.map(mapInternalApiTokenAuditRecord);
  }

  async revokeToken(input: {
    tokenId: string;
    revokedAt: Date;
  }): Promise<InternalApiTokenAuditRecord | null> {
    const result = await this.pool.query<InternalApiTokenRow>(
      `
        update internal_api_tokens
        set
          active = false,
          updated_at = $2::timestamptz
        where id = $1
        returning
          id,
          role,
          organization_id,
          description,
          active,
          expires_at,
          last_used_at,
          created_at,
          updated_at
      `,
      [input.tokenId, input.revokedAt.toISOString()],
    );

    return result.rows[0] ? mapInternalApiTokenAuditRecord(result.rows[0]) : null;
  }

  async rotateToken(input: {
    tokenId: string;
    tokenHash: string;
    description: string | null;
    expiresAt: Date | null;
    now: Date;
  }): Promise<{
    revokedToken: InternalApiTokenAuditRecord;
    newToken: InternalApiTokenAuditRecord;
  } | null> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");

      const existing = await client.query<InternalApiTokenRow>(
        `
          select
            id,
            role,
            organization_id,
            description,
            active,
            expires_at,
            last_used_at,
            created_at,
            updated_at
          from internal_api_tokens
          where id = $1
          for update
        `,
        [input.tokenId],
      );

      if (!existing.rows[0]) {
        await client.query("rollback");
        return null;
      }

      if (!existing.rows[0].active) {
        throw new InternalApiValidationError(
          "Inactive tokens cannot be rotated. Issue a new token instead.",
        );
      }

      const revoked = await client.query<InternalApiTokenRow>(
        `
          update internal_api_tokens
          set
            active = false,
            updated_at = $2::timestamptz
          where id = $1
          returning
            id,
            role,
            organization_id,
            description,
            active,
            expires_at,
            last_used_at,
            created_at,
            updated_at
        `,
        [input.tokenId, input.now.toISOString()],
      );

      const revokedToken = revoked.rows[0];

      if (!revokedToken) {
        throw new InternalApiValidationError("Token rotation failed.");
      }

      const inserted = await client.query<InternalApiTokenRow>(
        `
          insert into internal_api_tokens (
            token_hash,
            role,
            organization_id,
            description,
            active,
            expires_at
          )
          values ($1, $2, $3, $4, true, $5::timestamptz)
          returning
            id,
            role,
            organization_id,
            description,
            active,
            expires_at,
            last_used_at,
            created_at,
            updated_at
        `,
        [
          input.tokenHash,
          revokedToken.role,
          revokedToken.organization_id,
          input.description,
          input.expiresAt?.toISOString() ?? null,
        ],
      );

      await client.query("commit");

      return {
        revokedToken: mapInternalApiTokenAuditRecord(revokedToken),
        newToken: mapInternalApiTokenAuditRecord(inserted.rows[0]),
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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

export interface ListInternalApiTokensInput {
  actor: InternalApiPrincipal;
  organizationId?: string;
  role?: InternalApiRole;
  active?: boolean;
  limit?: number;
}

export interface IssueInternalApiTokenInput {
  actor: InternalApiPrincipal;
  role: InternalApiRole;
  organizationId?: string | null;
  description?: string | null;
  expiresAt?: string | null;
}

export interface IssueInternalApiTokenResult {
  token: string;
  tokenRecord: InternalApiTokenAuditRecord;
}

export interface RotateInternalApiTokenInput {
  actor: InternalApiPrincipal;
  tokenId: string;
  description?: string | null;
  expiresAt?: string | null;
}

export interface RotateInternalApiTokenResult {
  token: string;
  revokedToken: InternalApiTokenAuditRecord;
  tokenRecord: InternalApiTokenAuditRecord;
}

export interface RevokeInternalApiTokenInput {
  actor: InternalApiPrincipal;
  tokenId: string;
}

const DEFAULT_TOKEN_LIST_LIMIT = 100;
const MAX_TOKEN_LIST_LIMIT = 500;

export function createInternalApiTokenLifecycleService(
  repository: InternalApiTokenLifecycleRepository,
) {
  return {
    async list(input: ListInternalApiTokensInput): Promise<InternalApiTokenAuditRecord[]> {
      const limit = normalizeListLimit(input.limit);
      const scope = resolveListScope(input.actor, input.organizationId, input.role);

      return repository.listTokens({
        organizationId: scope.organizationId,
        role: scope.role,
        active: input.active,
        limit,
      });
    },

    async issue(input: IssueInternalApiTokenInput): Promise<IssueInternalApiTokenResult> {
      const role = normalizeInternalApiRole(input.role);
      const organizationId = normalizeOptionalString(input.organizationId);
      const description = normalizeOptionalString(input.description);
      const expiresAt = parseOptionalFutureDateTime(input.expiresAt, "expiresAt");

      assertScopeValidity(role, organizationId);
      assertActorCanManageScope(input.actor, role, organizationId);

      const token = generateInternalApiToken();
      const tokenRecord = await repository.createToken({
        tokenHash: hashBearerToken(token),
        role,
        organizationId,
        description,
        expiresAt,
      });

      return {
        token,
        tokenRecord,
      };
    },

    async rotate(
      input: RotateInternalApiTokenInput,
    ): Promise<RotateInternalApiTokenResult> {
      const existingToken = await repository.getTokenById(input.tokenId);

      if (!existingToken) {
        throw new InternalApiNotFoundError("Internal API token was not found.");
      }

      assertActorCanManageExistingToken(input.actor, existingToken);

      if (!existingToken.active) {
        throw new InternalApiValidationError(
          "Inactive tokens cannot be rotated. Issue a new token instead.",
        );
      }

      const now = new Date();
      const description =
        input.description === undefined
          ? existingToken.description
          : normalizeOptionalString(input.description);
      const parsedExpiresAt = parseOptionalFutureDateTime(
        input.expiresAt,
        "expiresAt",
      );
      const expiresAt =
        input.expiresAt === undefined ? existingToken.expiresAt : parsedExpiresAt;
      const token = generateInternalApiToken();
      const rotated = await repository.rotateToken({
        tokenId: input.tokenId,
        tokenHash: hashBearerToken(token),
        description,
        expiresAt,
        now,
      });

      if (!rotated) {
        throw new InternalApiNotFoundError("Internal API token was not found.");
      }

      return {
        token,
        revokedToken: rotated.revokedToken,
        tokenRecord: rotated.newToken,
      };
    },

    async revoke(
      input: RevokeInternalApiTokenInput,
    ): Promise<InternalApiTokenAuditRecord> {
      const existingToken = await repository.getTokenById(input.tokenId);

      if (!existingToken) {
        throw new InternalApiNotFoundError("Internal API token was not found.");
      }

      assertActorCanManageExistingToken(input.actor, existingToken);

      if (!existingToken.active) {
        return existingToken;
      }

      const revoked = await repository.revokeToken({
        tokenId: input.tokenId,
        revokedAt: new Date(),
      });

      if (!revoked) {
        throw new InternalApiNotFoundError("Internal API token was not found.");
      }

      return revoked;
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

function normalizeListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_TOKEN_LIST_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new InternalApiValidationError("limit must be a positive integer.");
  }

  if (limit > MAX_TOKEN_LIST_LIMIT) {
    throw new InternalApiValidationError(
      `limit cannot exceed ${MAX_TOKEN_LIST_LIMIT}.`,
    );
  }

  return limit;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalFutureDateTime(
  value: string | null | undefined,
  fieldName: string,
): Date | null {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new InternalApiValidationError(
      `${fieldName} must be a valid ISO-8601 datetime.`,
    );
  }

  if (parsed <= new Date()) {
    throw new InternalApiValidationError(`${fieldName} must be in the future.`);
  }

  return parsed;
}

function normalizeInternalApiRole(role: InternalApiRole): InternalApiRole {
  if (role === "platform_admin" || role === "organization_operator") {
    return role;
  }

  throw new InternalApiValidationError("role is invalid.");
}

function assertScopeValidity(
  role: InternalApiRole,
  organizationId: string | null,
): void {
  if (role === "platform_admin" && organizationId !== null) {
    throw new InternalApiValidationError(
      "platform_admin tokens cannot be organization-scoped.",
    );
  }

  if (role === "organization_operator" && organizationId === null) {
    throw new InternalApiValidationError(
      "organization_operator tokens require organizationId.",
    );
  }
}

function assertActorCanManageScope(
  actor: InternalApiPrincipal,
  role: InternalApiRole,
  organizationId: string | null,
): void {
  if (actor.role === "platform_admin") {
    return;
  }

  if (
    actor.role === "organization_operator" &&
    actor.organizationId !== null &&
    role === "organization_operator" &&
    organizationId === actor.organizationId
  ) {
    return;
  }

  throw new InternalApiForbiddenError(
    "Token is not authorized to manage this token scope.",
  );
}

function assertActorCanManageExistingToken(
  actor: InternalApiPrincipal,
  token: InternalApiTokenAuditRecord,
): void {
  assertActorCanManageScope(actor, token.role, token.organizationId);
}

function resolveListScope(
  actor: InternalApiPrincipal,
  organizationId: string | undefined,
  role: InternalApiRole | undefined,
): { organizationId?: string; role?: InternalApiRole } {
  if (actor.role === "platform_admin") {
    return {
      organizationId,
      role,
    };
  }

  if (organizationId && organizationId !== actor.organizationId) {
    throw new InternalApiForbiddenError(
      "Token cannot list tokens for another organization.",
    );
  }

  if (role && role !== "organization_operator") {
    throw new InternalApiForbiddenError(
      "Token cannot list tokens outside organization_operator scope.",
    );
  }

  return {
    organizationId: actor.organizationId ?? undefined,
    role: "organization_operator",
  };
}

function mapInternalApiTokenAuditRecord(
  row: InternalApiTokenRow,
): InternalApiTokenAuditRecord {
  return {
    id: row.id,
    role: row.role,
    organizationId: row.organization_id,
    description: row.description,
    active: row.active,
    expiresAt: row.expires_at ? toDate(row.expires_at) : null,
    lastUsedAt: row.last_used_at ? toDate(row.last_used_at) : null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function generateInternalApiToken(): string {
  return `bpia_${randomBytes(32).toString("base64url")}`;
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
