import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Database } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";

/**
 * Each test file gets a scratch database created from the versioned
 * migrations — never from `drizzle push`. If a migration is broken, the tests
 * cannot run, which is the point.
 */

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

function urlFor(dbName: string): string {
  return ADMIN_URL.replace("/postgres?", `/${dbName}?`);
}

type Pool = ReturnType<typeof createDb>["pool"];

export interface TestDb {
  db: Database;
  pool: Pool;
  url: string;
  drop: () => Promise<void>;
}

export async function createTestDatabase(name: string): Promise<TestDb> {
  const dbName = `fc_test_${name}_${process.pid}`;
  const admin = createDb(ADMIN_URL);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.pool.query(`CREATE DATABASE "${dbName}"`);
  await admin.pool.end();

  const url = urlFor(dbName);
  await runMigrations(url);

  const { db, pool } = createDb(url);
  return {
    db,
    pool,
    url,
    drop: async () => {
      await pool.end();
      const cleanup = createDb(ADMIN_URL);
      await cleanup.pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await cleanup.pool.end();
    },
  };
}

/**
 * The real Freightec export, resolved from the repo rather than hardcoded.
 * The filename carries accented characters in a decomposed form, so it is
 * matched by extension instead of by literal name.
 */
export function realExportPath(): string {
  const assets = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../attached_assets",
  );
  const found = readdirSync(assets).find((f) => f.endsWith(".xlsx"));
  if (!found) {
    throw new Error(`No .xlsx export found in ${assets}`);
  }
  return path.join(assets, found);
}
