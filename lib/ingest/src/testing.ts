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
 * Fixtures resolved from the repo rather than hardcoded.
 *
 * These used to be "the first .xlsx in the folder", which held while there was
 * exactly one. The moment the Ambev's per-equipment files landed beside it,
 * every test silently changed which workbook it was asserting against. Each
 * fixture now names what it wants; filenames are matched on a distinctive
 * fragment because the accented ones arrive in a decomposed form.
 */
function assetsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../attached_assets",
  );
}

function findAsset(fragment: string): string {
  const assets = assetsDir();
  const needle = fragment.toLowerCase();
  const found = readdirSync(assets).find(
    (f) => f.toLowerCase().includes(needle) && f.endsWith(".xlsx"),
  );
  if (!found) {
    throw new Error(`Nenhum .xlsx com "${fragment}" em ${assets}`);
  }
  return path.join(assets, found);
}

/** The combined export: one workbook, sheets `carretas` and `cavalos`. */
export function realExportPath(): string {
  return findAsset("Remunera");
}

/**
 * The per-equipment delivery: the same content split into one file each, with
 * sheets named `Modelo_Carreta` and `Modelo_Cavalo`.
 */
export function modelExportPaths(): { carreta: string; cavalo: string } {
  return {
    carreta: findAsset("Modelo_Carreta"),
    cavalo: findAsset("Modelo_Cavalo"),
  };
}
