import { timingSafeEqual } from "node:crypto";

/** True when no token is configured, or the request carries the right bearer token. */
export function isAuthorized(
  header: string | null,
  token: string | undefined,
): boolean {
  if (!token) return true;
  const given = /^Bearer (.+)$/.exec(header ?? "")?.[1];
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
