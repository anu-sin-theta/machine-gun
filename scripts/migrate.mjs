#!/usr/bin/env node
// Applies the SQL migrations in ./drizzle to the database in DATABASE_URL, STORAGE_URL or POSTGRES_URL (Neon).
//
//   pnpm db:migrate        (reads DATABASE_URL from .env, or from the environment)
//
// Safe to run repeatedly: Drizzle records applied migrations in its own table.
// The same migration file is tested against a real Postgres engine (PGlite) in
// tests/unit/db/postgres.test.ts.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

// Same names and order as src/config/database-url.ts (a plain script cannot import TypeScript).
const url = ["DATABASE_URL", "STORAGE_URL", "POSTGRES_URL"]
  .map((name) => process.env[name]?.trim())
  .find(Boolean);
if (!url) {
  console.error(
    "No database URL: set DATABASE_URL (or STORAGE_URL) in .env or the environment.",
  );
  process.exit(1);
}

// Show where we are connecting, never the credentials.
const target = new URL(url);
console.log(`Migrating ${target.hostname}${target.pathname} ...`);

await migrate(drizzle(neon(url)), { migrationsFolder: "drizzle" });
console.log("Done: all migrations applied.");
