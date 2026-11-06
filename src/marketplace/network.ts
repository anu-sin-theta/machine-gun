/**
 * A fetch for URLs that someone else chose (a listing's endpoint). Before each
 * request it resolves the hostname and refuses any address that is private,
 * loopback or otherwise not the public internet, and it never follows
 * redirects (a redirect is another hostname nobody checked).
 *
 * Limit: the address is checked, not pinned. A DNS server that answers
 * differently to the connection than it did to this check (rebinding) is not
 * stopped. Pinning needs a custom connection layer; on a platform with no
 * private network behind the server this check is the practical defence.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** True for loopback, private, link-local, unique-local, multicast, reserved and mapped-private addresses. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && address.split(".")[2] === "0")))
      return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPublicAddress(mapped[1]);
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower))
      return false;
    return true;
  }
  return false;
}

export interface SafeFetchOptions {
  fetch?: typeof fetch;
  resolve?: Resolver;
  /** Skip the address check for this machine's own hostnames (development). */
  allowLocal?: boolean;
}

export function createSafeFetch(options: SafeFetchOptions = {}): typeof fetch {
  const base = options.fetch ?? fetch;
  const resolve = options.resolve ?? defaultResolver;
  return (async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const local =
      options.allowLocal && /^(localhost|127\.0\.0\.1|::1)$/.test(host);
    if (!local) {
      let addresses: string[];
      try {
        addresses = isIP(host) ? [host] : await resolve(host);
      } catch {
        throw new Error(`could not resolve ${host}`);
      }
      if (addresses.length === 0 || !addresses.every(isPublicAddress))
        throw new Error(`${host} does not resolve to a public address`);
    }
    return base(input, { ...init, redirect: "manual" });
  }) as typeof fetch;
}
