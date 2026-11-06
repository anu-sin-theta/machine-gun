/**
 * Buyer accounts. Each agent that proposes tasks gets its own bearer token,
 * shown once at creation and stored only as a SHA-256 hash, so a database
 * leak does not leak working tokens.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountsRepo } from "@/adapters/db";
import type { AccountRecord } from "./types";

export const TOKEN_PREFIX = "kvk_";

export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createAccount(
  repo: AccountsRepo,
  raw: unknown,
  deps: { now: () => number; random: (bytes: number) => string },
): Promise<
  | { ok: true; account: AccountRecord; token: string }
  | { ok: false; error: string }
> {
  const input = accountInputSchema.safeParse(raw);
  if (!input.success) return { ok: false, error: "name is required (max 60)" };
  const token = `${TOKEN_PREFIX}${deps.random(32)}`;
  const account: AccountRecord = {
    id: `acct_${deps.random(9)}`,
    name: input.data.name,
    tokenHash: hashToken(token),
    status: "active",
    createdAt: deps.now(),
  };
  if (!(await repo.create(account)))
    return { ok: false, error: "could not create the account, try again" };
  return { ok: true, account, token };
}

/** The active account a bearer token belongs to, or null. */
export async function authenticate(
  repo: AccountsRepo,
  header: string | null,
): Promise<AccountRecord | null> {
  const token = /^Bearer (kvk_[A-Za-z0-9_-]{20,100})$/.exec(header ?? "")?.[1];
  if (!token) return null;
  const account = await repo.getByTokenHash(hashToken(token));
  return account?.status === "active" ? account : null;
}
