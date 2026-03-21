import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  InternalApiForbiddenError,
  InternalApiNotFoundError,
  InternalApiUnauthorizedError,
  InternalApiValidationError,
  createInternalApiAuthService,
  createInternalApiTokenLifecycleService,
  type InternalApiPrincipal,
  type InternalApiRole,
  type InternalApiTokenAuditRecord,
} from "./internal-auth";

const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000002";

async function main(): Promise<void> {
  await runAuthenticationScenario();
  await runAuthorizationScenario();
  await runRequestHeaderScenario();
  await runLifecycleScenario();
  await runCrossTenantLifecycleScenario();
  console.log("internal-auth self-test passed");
}

async function runAuthenticationScenario(): Promise<void> {
  const repository = new InMemoryInternalApiTokenRepository();
  const platformToken = await repository.seedToken({
    role: "platform_admin",
    organizationId: null,
    description: "platform token",
    active: true,
  });
  const operatorToken = await repository.seedToken({
    role: "organization_operator",
    organizationId: ORGANIZATION_ID,
    description: "org token",
    active: true,
  });
  const authService = createInternalApiAuthService(repository);

  const platformPrincipal = await authService.authenticateBearerToken(platformToken);
  const operatorPrincipal = await authService.authenticateBearerToken(operatorToken);

  assert.equal(platformPrincipal.role, "platform_admin");
  assert.equal(platformPrincipal.organizationId, null);
  assert.equal(operatorPrincipal.role, "organization_operator");
  assert.equal(operatorPrincipal.organizationId, ORGANIZATION_ID);

  await assert.rejects(
    () => authService.authenticateBearerToken("invalid_token_not_registered"),
    InternalApiUnauthorizedError,
  );

  assert.equal(repository.getMarkedTokenIds().includes(platformPrincipal.tokenId), true);
  assert.equal(repository.getMarkedTokenIds().includes(operatorPrincipal.tokenId), true);
}

async function runAuthorizationScenario(): Promise<void> {
  const authService = createInternalApiAuthService(
    new InMemoryInternalApiTokenRepository(),
  );
  const platformPrincipal: InternalApiPrincipal = {
    tokenId: randomUUID(),
    role: "platform_admin",
    organizationId: null,
    description: null,
  };
  const organizationPrincipal: InternalApiPrincipal = {
    tokenId: randomUUID(),
    role: "organization_operator",
    organizationId: ORGANIZATION_ID,
    description: null,
  };

  authService.assertPlatformAdmin(platformPrincipal);
  authService.assertOrganizationAccess(platformPrincipal, ORGANIZATION_ID);
  authService.assertOrganizationAccess(organizationPrincipal, ORGANIZATION_ID);

  await assert.rejects(
    async () => {
      authService.assertPlatformAdmin(organizationPrincipal);
    },
    InternalApiForbiddenError,
  );

  await assert.rejects(
    async () => {
      authService.assertOrganizationAccess(
        organizationPrincipal,
        OTHER_ORGANIZATION_ID,
      );
    },
    InternalApiForbiddenError,
  );
}

async function runRequestHeaderScenario(): Promise<void> {
  const repository = new InMemoryInternalApiTokenRepository();
  const token = await repository.seedToken({
    role: "platform_admin",
    organizationId: null,
    description: null,
    active: true,
  });
  const authService = createInternalApiAuthService(repository);
  const request = asIncomingMessage({
    authorization: `Bearer ${token}`,
  });
  const principal = await authService.authenticateRequest(request);

  assert.equal(principal.role, "platform_admin");

  await assert.rejects(
    () => authService.authenticateRequest(asIncomingMessage({})),
    InternalApiUnauthorizedError,
  );
  await assert.rejects(
    () =>
      authService.authenticateRequest(
        asIncomingMessage({
          authorization: "Basic test",
        }),
      ),
    InternalApiUnauthorizedError,
  );
}

async function runLifecycleScenario(): Promise<void> {
  const repository = new InMemoryInternalApiTokenRepository();
  const lifecycleService = createInternalApiTokenLifecycleService(repository);
  const platformActor: InternalApiPrincipal = {
    tokenId: randomUUID(),
    role: "platform_admin",
    organizationId: null,
    description: null,
  };
  const organizationActor: InternalApiPrincipal = {
    tokenId: randomUUID(),
    role: "organization_operator",
    organizationId: ORGANIZATION_ID,
    description: null,
  };

  const issued = await lifecycleService.issue({
    actor: platformActor,
    role: "organization_operator",
    organizationId: ORGANIZATION_ID,
    description: "Ops token",
  });

  assert.equal(issued.token.startsWith("bpia_"), true);
  assert.equal(issued.tokenRecord.role, "organization_operator");
  assert.equal(issued.tokenRecord.organizationId, ORGANIZATION_ID);
  assert.equal(issued.tokenRecord.active, true);

  const listForOrgOperator = await lifecycleService.list({
    actor: organizationActor,
  });
  assert.equal(listForOrgOperator.length, 1);
  assert.equal(listForOrgOperator[0]?.id, issued.tokenRecord.id);

  const rotated = await lifecycleService.rotate({
    actor: organizationActor,
    tokenId: issued.tokenRecord.id,
    description: "Ops token rotated",
  });

  assert.notEqual(rotated.token, issued.token);
  assert.equal(rotated.revokedToken.id, issued.tokenRecord.id);
  assert.equal(rotated.revokedToken.active, false);
  assert.equal(rotated.tokenRecord.active, true);
  assert.equal(rotated.tokenRecord.description, "Ops token rotated");

  const revoked = await lifecycleService.revoke({
    actor: organizationActor,
    tokenId: rotated.tokenRecord.id,
  });
  assert.equal(revoked.active, false);

  const listedAfterRevocation = await lifecycleService.list({
    actor: organizationActor,
    active: false,
  });
  assert.equal(listedAfterRevocation.length, 2);
}

async function runCrossTenantLifecycleScenario(): Promise<void> {
  const repository = new InMemoryInternalApiTokenRepository();
  const lifecycleService = createInternalApiTokenLifecycleService(repository);
  const organizationActor: InternalApiPrincipal = {
    tokenId: randomUUID(),
    role: "organization_operator",
    organizationId: ORGANIZATION_ID,
    description: null,
  };
  const otherOrgToken = await lifecycleService.issue({
    actor: {
      tokenId: randomUUID(),
      role: "platform_admin",
      organizationId: null,
      description: null,
    },
    role: "organization_operator",
    organizationId: OTHER_ORGANIZATION_ID,
    description: "other org token",
  });

  await assert.rejects(
    () =>
      lifecycleService.issue({
        actor: organizationActor,
        role: "platform_admin",
      }),
    InternalApiForbiddenError,
  );

  await assert.rejects(
    () =>
      lifecycleService.list({
        actor: organizationActor,
        organizationId: OTHER_ORGANIZATION_ID,
      }),
    InternalApiForbiddenError,
  );

  await assert.rejects(
    () =>
      lifecycleService.rotate({
        actor: organizationActor,
        tokenId: otherOrgToken.tokenRecord.id,
      }),
    InternalApiForbiddenError,
  );

  await assert.rejects(
    () =>
      lifecycleService.revoke({
        actor: organizationActor,
        tokenId: otherOrgToken.tokenRecord.id,
      }),
    InternalApiForbiddenError,
  );

  await assert.rejects(
    () =>
      lifecycleService.rotate({
        actor: {
          tokenId: randomUUID(),
          role: "platform_admin",
          organizationId: null,
          description: null,
        },
        tokenId: "00000000-0000-0000-0000-000000000999",
      }),
    InternalApiNotFoundError,
  );

  await assert.rejects(
    () =>
      lifecycleService.issue({
        actor: {
          tokenId: randomUUID(),
          role: "platform_admin",
          organizationId: null,
          description: null,
        },
        role: "organization_operator",
        organizationId: null,
      }),
    InternalApiValidationError,
  );
}

function asIncomingMessage(
  headers: Record<string, string>,
): IncomingMessage {
  return {
    headers,
  } as IncomingMessage;
}

class InMemoryInternalApiTokenRepository {
  private readonly tokenByHash = new Map<
    string,
    {
      id: string;
      tokenHash: string;
      role: InternalApiRole;
      organizationId: string | null;
      description: string | null;
      active: boolean;
      expiresAt: Date | null;
      lastUsedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();
  private readonly tokenById = new Map<
    string,
    {
      id: string;
      tokenHash: string;
      role: InternalApiRole;
      organizationId: string | null;
      description: string | null;
      active: boolean;
      expiresAt: Date | null;
      lastUsedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();
  private readonly markedTokenIds: string[] = [];

  async seedToken(input: {
    role: InternalApiRole;
    organizationId: string | null;
    description: string | null;
    active: boolean;
  }): Promise<string> {
    const rawToken = `seed_token_${randomUUID()}`;
    const now = new Date();
    const record = {
      id: randomUUID(),
      tokenHash: hashToken(rawToken),
      role: input.role,
      organizationId: input.organizationId,
      description: input.description,
      active: input.active,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.tokenByHash.set(record.tokenHash, record);
    this.tokenById.set(record.id, record);
    return rawToken;
  }

  async getActiveTokenByHash(input: { tokenHash: string; now: Date }) {
    const token = this.tokenByHash.get(input.tokenHash);

    if (!token || !token.active) {
      return null;
    }

    if (token.expiresAt !== null && token.expiresAt <= input.now) {
      return null;
    }

    return {
      id: token.id,
      role: token.role,
      organizationId: token.organizationId,
      description: token.description,
    };
  }

  async markTokenUsed(input: { tokenId: string; usedAt: Date }): Promise<void> {
    const token = this.tokenById.get(input.tokenId);

    if (!token) {
      return;
    }

    token.lastUsedAt = input.usedAt;
    token.updatedAt = input.usedAt;
    this.markedTokenIds.push(input.tokenId);
  }

  async createToken(input: {
    tokenHash: string;
    role: InternalApiRole;
    organizationId: string | null;
    description: string | null;
    expiresAt: Date | null;
  }): Promise<InternalApiTokenAuditRecord> {
    const now = new Date();
    const record = {
      id: randomUUID(),
      tokenHash: input.tokenHash,
      role: input.role,
      organizationId: input.organizationId,
      description: input.description,
      active: true,
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.tokenByHash.set(record.tokenHash, record);
    this.tokenById.set(record.id, record);
    return asAuditRecord(record);
  }

  async getTokenById(tokenId: string): Promise<InternalApiTokenAuditRecord | null> {
    const record = this.tokenById.get(tokenId);
    return record ? asAuditRecord(record) : null;
  }

  async listTokens(input: {
    organizationId?: string;
    role?: InternalApiRole;
    active?: boolean;
    limit: number;
  }): Promise<InternalApiTokenAuditRecord[]> {
    return [...this.tokenById.values()]
      .filter((record) => {
        if (input.organizationId !== undefined) {
          return record.organizationId === input.organizationId;
        }

        return true;
      })
      .filter((record) => (input.role ? record.role === input.role : true))
      .filter((record) =>
        input.active === undefined ? true : record.active === input.active,
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, input.limit)
      .map(asAuditRecord);
  }

  async revokeToken(input: {
    tokenId: string;
    revokedAt: Date;
  }): Promise<InternalApiTokenAuditRecord | null> {
    const record = this.tokenById.get(input.tokenId);

    if (!record) {
      return null;
    }

    record.active = false;
    record.updatedAt = input.revokedAt;
    return asAuditRecord(record);
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
    const existing = this.tokenById.get(input.tokenId);

    if (!existing) {
      return null;
    }

    if (!existing.active) {
      throw new InternalApiValidationError(
        "Inactive tokens cannot be rotated. Issue a new token instead.",
      );
    }

    existing.active = false;
    existing.updatedAt = input.now;

    const rotated = {
      id: randomUUID(),
      tokenHash: input.tokenHash,
      role: existing.role,
      organizationId: existing.organizationId,
      description: input.description,
      active: true,
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };

    this.tokenByHash.set(rotated.tokenHash, rotated);
    this.tokenById.set(rotated.id, rotated);

    return {
      revokedToken: asAuditRecord(existing),
      newToken: asAuditRecord(rotated),
    };
  }

  getMarkedTokenIds(): string[] {
    return this.markedTokenIds;
  }
}

function asAuditRecord(record: {
  id: string;
  role: InternalApiRole;
  organizationId: string | null;
  description: string | null;
  active: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): InternalApiTokenAuditRecord {
  return {
    id: record.id,
    role: record.role,
    organizationId: record.organizationId,
    description: record.description,
    active: record.active,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
