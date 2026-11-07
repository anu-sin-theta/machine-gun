import { describe, expect, it } from "vitest";
import { DATABASE_URL_NAMES, databaseUrlFrom } from "@/config/database-url";
import { loadConfig } from "@/config/env";

const POOLED = "postgresql://user:pw@ep-x-pooler.example.neon.tech/db";
const OTHER = "postgresql://user:pw@ep-y.example.neon.tech/db";

describe("databaseUrlFrom", () => {
  it("prefers DATABASE_URL, then STORAGE_URL, then POSTGRES_URL", () => {
    expect(DATABASE_URL_NAMES).toEqual([
      "DATABASE_URL",
      "STORAGE_URL",
      "POSTGRES_URL",
    ]);
    expect(
      databaseUrlFrom({
        DATABASE_URL: POOLED,
        STORAGE_URL: OTHER,
        POSTGRES_URL: OTHER,
      }),
    ).toBe(POOLED);
    expect(databaseUrlFrom({ STORAGE_URL: POOLED, POSTGRES_URL: OTHER })).toBe(
      POOLED,
    );
    expect(databaseUrlFrom({ POSTGRES_URL: POOLED })).toBe(POOLED);
  });

  it("skips blank values and returns undefined when nothing is set", () => {
    expect(databaseUrlFrom({ DATABASE_URL: "  ", STORAGE_URL: POOLED })).toBe(
      POOLED,
    );
    expect(databaseUrlFrom({ DATABASE_URL: "", STORAGE_URL: "" })).toBe(
      undefined,
    );
    expect(databaseUrlFrom({})).toBe(undefined);
  });
});

describe("the app config", () => {
  it("uses the Vercel Neon integration's STORAGE_URL", () => {
    expect(loadConfig({ STORAGE_URL: POOLED }).databaseUrl).toBe(POOLED);
  });

  it("keeps DATABASE_URL first when both are set", () => {
    expect(
      loadConfig({ DATABASE_URL: POOLED, STORAGE_URL: OTHER }).databaseUrl,
    ).toBe(POOLED);
  });

  it("falls back to the in-memory store when none is set", () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined();
  });
});
