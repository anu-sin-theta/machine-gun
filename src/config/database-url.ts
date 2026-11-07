/**
 * Where the Postgres connection string may be set, in order of preference.
 *
 * `DATABASE_URL` is the app's own name. `STORAGE_URL` is what Vercel's Neon
 * integration creates when its variable prefix is "STORAGE", and `POSTGRES_URL`
 * is its default for Vercel Postgres templates. Accepting them means a database
 * added from the Vercel dashboard works without renaming anything.
 *
 * Always use the pooled string (the host contains "-pooler"): the app talks to
 * Neon over HTTP, one request per query.
 */
export const DATABASE_URL_NAMES = [
  "DATABASE_URL",
  "STORAGE_URL",
  "POSTGRES_URL",
] as const;

/** The first non-empty connection string among `DATABASE_URL_NAMES`, or undefined. */
export function databaseUrlFrom(
  env: Readonly<Record<string, unknown>>,
): string | undefined {
  for (const name of DATABASE_URL_NAMES) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
