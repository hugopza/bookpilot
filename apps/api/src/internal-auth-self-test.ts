import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  InternalApiForbiddenError,
  InternalApiUnauthorizedError,
  createInternalApiAuthService,
  type InternalApiPrincipal,
} from "./internal-auth";

const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000002";

async function main(): Promise<void> {
  await runAuthenticationScenario();
  await runAuthorizationScenario();
  await runRequestHeaderScenario();
  console.log("internal-auth self-test passed");
}

async function runAuthenticationScenario(): Promise<void> {
  const platformToken = "platform_token_for_self_test_123";
  const operatorToken = "operator_token_for_self_test_456";
  const repository = createFakeRepository([
    {
      id: randomUUID(),
      tokenHash: hashToken(platformToken),
      role: "platform_admin",
      organizationId: null,
      description: "platform token",
    },
    {
      id: randomUUID(),
      tokenHash: hashToken(operatorToken),
      role: "organization_operator",
      organizationId: ORGANIZATION_ID,
      description: "org token",
    },
  ]);
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
  const authService = createInternalApiAuthService(createFakeRepository([]));
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
  const token = "header_token_for_self_test_123";
  const repository = createFakeRepository([
    {
      id: randomUUID(),
      tokenHash: hashToken(token),
      role: "platform_admin",
      organizationId: null,
      description: null,
    },
  ]);
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

function asIncomingMessage(
  headers: Record<string, string>,
): IncomingMessage {
  return {
    headers,
  } as IncomingMessage;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createFakeRepository(
  tokens: Array<{
    id: string;
    tokenHash: string;
    role: "platform_admin" | "organization_operator";
    organizationId: string | null;
    description: string | null;
  }>,
) {
  const tokenMap = new Map(tokens.map((token) => [token.tokenHash, token]));
  const markedTokenIds: string[] = [];

  return {
    async getActiveTokenByHash(input: { tokenHash: string; now: Date }) {
      void input.now;
      const token = tokenMap.get(input.tokenHash);

      if (!token) {
        return null;
      }

      return {
        id: token.id,
        role: token.role,
        organizationId: token.organizationId,
        description: token.description,
      };
    },

    async markTokenUsed(input: { tokenId: string; usedAt: Date }): Promise<void> {
      void input.usedAt;
      markedTokenIds.push(input.tokenId);
    },

    getMarkedTokenIds(): string[] {
      return markedTokenIds;
    },
  };
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
