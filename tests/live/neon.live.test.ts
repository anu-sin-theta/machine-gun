import { describe } from "vitest";
import { createNeonRepositories } from "@/adapters/db/neon";
import { repositoryContract } from "../contract/repositories.contract";

const url = process.env.DATABASE_URL;

// Runs the same contract suite as the in-memory and PGlite tests, over Neon's HTTP driver.
// Apply the migration first: pnpm db:migrate. It leaves a few test rows behind (random ids).
describe.skipIf(!url)("neon (live): needs DATABASE_URL", () => {
  repositoryContract("neon", () => createNeonRepositories(url as string));
});
