/**
 * Which URLs the server may call on behalf of a listing. Anyone who can
 * register an agent chooses its endpoint, and the buyer agent fetches it, so
 * this is the SSRF boundary: only public https hosts by name, with no
 * credentials, query, fragment or odd port.
 *
 * Limits worth knowing: this checks the URL, not what DNS answers when it is
 * fetched, so a hostname that later resolves to a private address is not
 * caught here. Resolve and pin addresses in the fetch layer before accepting
 * untrusted registrations on a network with sensitive internal services.
 */

export type EndpointCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const INTERNAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".corp",
];

const isLocalHost = (host: string) =>
  LOCAL_HOSTS.has(host) || host.endsWith(".localhost");

/** WHATWG URL parsing already turns decimal, octal and hex IPv4 into dotted form. */
const isIpLiteral = (host: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

export function validateEndpoint(
  raw: string,
  options: { allowLocalHttp?: boolean } = {},
): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.username || url.password)
    return { ok: false, reason: "credentials in the URL are not allowed" };
  if (url.search)
    return { ok: false, reason: "the endpoint must not have a query" };
  if (url.hash)
    return { ok: false, reason: "the endpoint must not have a fragment" };

  const host = url.hostname.toLowerCase();
  if (options.allowLocalHttp && isLocalHost(host)) {
    // Development only: http on this machine.
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return { ok: false, reason: "only http and https are allowed" };
    return { ok: true, url: `${url.origin}${url.pathname}` };
  }

  if (url.protocol !== "https:")
    return { ok: false, reason: "only https is allowed" };
  if (isLocalHost(host))
    return { ok: false, reason: "local addresses are not allowed" };
  if (isIpLiteral(host))
    return { ok: false, reason: "use a hostname, not an IP address" };
  if (!host.includes(".") || INTERNAL_SUFFIXES.some((s) => host.endsWith(s)))
    return { ok: false, reason: "internal hostnames are not allowed" };
  if (url.port) return { ok: false, reason: "custom ports are not allowed" };
  return { ok: true, url: `${url.origin}${url.pathname}` };
}

/** A private-network IPv4 address (10/8, 172.16/12, 192.168/16): a development machine on a LAN. */
const isPrivateLanIp = (host: string) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  );
};

/**
 * True when the app runs on a development machine: on localhost, or reached by
 * a private LAN address (so other devices on the network can use it). Then
 * agents running on this machine (http://localhost:…) may be listed and called.
 * A public deployment has a public hostname and never qualifies.
 */
export function isLocalOrigin(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return isLocalHost(host) || isPrivateLanIp(host);
  } catch {
    return false;
  }
}
