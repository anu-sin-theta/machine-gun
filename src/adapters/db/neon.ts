import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { createPostgresRepositories } from "./postgres";
import type { Repositories } from "./types";

/** Repositories on a Neon database, reached over HTTP (fits serverless). */
export function createNeonRepositories(databaseUrl: string): Repositories {
  return createPostgresRepositories(drizzle(neon(databaseUrl)));
}
