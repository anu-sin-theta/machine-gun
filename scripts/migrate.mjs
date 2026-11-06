#!/usr/bin/env node
// Applies the SQL migrations in ./drizzle to the database in DATABASE_URL (Neon).
//
//   pnpm db:migrate        (reads DATABASE_URL from .env, or from the environment)
//
// Safe to run repeatedly: Drizzle records applied migrations in its own table.
// The same migration file is tested against a real Postgres engine (PGlite) in
// tests/unit/db/postgres.test.ts.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env or the environment.");
  process.exit(1);
}

// Show where we are connecting, never the credentials.
const target = new URL(url);
console.log(`Migrating ${target.hostname}${target.pathname} ...`);

await migrate(drizzle(neon(url)), { migrationsFolder: "drizzle" });
console.log("Done: all migrations applied.");
