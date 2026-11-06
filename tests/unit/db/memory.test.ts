import { describe, expect, it } from "vitest";
import { createMemoryRepositories, utcDay } from "@/adapters/db";
import { repositoryContract } from "../../contract/repositories.contract";

repositoryContract("memory", createMemoryRepositories);

describe("utcDay", () => {
  it("uses the UTC calendar day", () => {
    expect(utcDay(Date.UTC(2026, 10, 6, 23, 59, 59))).toBe("2026-11-06");
    expect(utcDay(Date.UTC(2026, 10, 7, 0, 0, 0))).toBe("2026-11-07");
  });
});

describe("memory repositories", () => {
  it("do not share state between instances", async () => {
    const a = createMemoryRepositories();
    const b = createMemoryRepositories();
    await a.spend.add("2026-11-06", "HBAR", 5n);
    expect(await b.spend.get("2026-11-06", "HBAR")).toBe(0n);
  });
});
