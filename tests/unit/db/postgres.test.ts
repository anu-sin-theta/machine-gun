/**
 * Runs the repository contract and the real migration against PGlite, a real
 * Postgres engine compiled to WebAssembly. This is not Neon, but it executes the
 * same SQL: the migration file, the jsonb and numeric columns, the upserts and
 * the conditional UPDATE behind "an approval is spent once".
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { createPostgresRepositories } from "@/adapters/db/postgres";
import { repositoryContract } from "../../contract/repositories.contract";

const client = new PGlite();
const db = drizzle(client);
await migrate(db, { migrationsFolder: "drizzle" });

repositoryContract("postgres (PGlite)", () => createPostgresRepositories(db));

describe("the migration", () => {
  it("creates the four tables with the columns and indexes the adapter relies on", async () => {
    const tables = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "auto_spend_ledger",
        "checks",
        "pending_approvals",
        "used_nonces",
      ]),
    );
    const checks = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'checks'",
    );
    expect(checks.rows.map((r) => r.column_name)).toEqual(
      expect.arrayContaining(["transaction_id", "verdict_hash", "amount"]),
    );
    const indexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'pending_approvals'",
    );
    expect(indexes.rows.map((r) => r.indexname)).toContain(
      "pending_approvals_state_uq",
    );
  });

  it("stores money beyond 2^53 exactly in the numeric ledger", async () => {
    const repos = createPostgresRepositories(db);
    const big = 123456789012345678901234567890n;
    expect(await repos.spend.add("2026-11-07", "HBAR-big", big)).toBe(big);
    expect(await repos.spend.add("2026-11-07", "HBAR-big", 1n)).toBe(big + 1n);
  });
});
