import { Pool } from "pg";

import {
  InternalApiValidationError,
  PostgresInternalApiAuthRepository,
  createInternalApiTokenBootstrapService,
} from "./internal-auth";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to bootstrap the first platform_admin token.",
    );
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  });
  const repository = new PostgresInternalApiAuthRepository(pool);
  const bootstrapService = createInternalApiTokenBootstrapService(repository);

  try {
    const result = await bootstrapService.bootstrapFirstPlatformAdminToken({
      description: process.env.INTERNAL_API_BOOTSTRAP_DESCRIPTION,
      expiresAt: process.env.INTERNAL_API_BOOTSTRAP_EXPIRES_AT,
    });

    console.log("Bootstrap platform_admin token created.");
    console.log(`token_id=${result.tokenRecord.id}`);
    console.log(`role=${result.tokenRecord.role}`);
    console.log(`organization_id=${result.tokenRecord.organizationId ?? "null"}`);
    console.log(`expires_at=${result.tokenRecord.expiresAt?.toISOString() ?? "null"}`);
    console.log("raw_token");
    console.log(result.token);
    console.log(
      "Store this token securely now. It is only returned once and never stored plaintext.",
    );
  } catch (error) {
    if (error instanceof InternalApiValidationError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error("Bootstrap command failed.", error);
  process.exitCode = 1;
});
