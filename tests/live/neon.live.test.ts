import { describe } from "vitest";
import { createNeonRepositories } from "@/adapters/db/neon";
import { databaseUrlFrom } from "@/config/database-url";
import { repositoryContract } from "../contract/repositories.contract";

const url = databaseUrlFrom(process.env);

// Runs the same contract suite as the in-memory and PGlite tests, over Neon's HTTP driver.
// Apply the migration first: pnpm db:migrate. It leaves a few test rows behind (random ids).
describe.skipIf(!url)("neon (live): needs DATABASE_URL or STORAGE_URL", () => {
  repositoryContract("neon", () => createNeonRepositories(url as string));
});
