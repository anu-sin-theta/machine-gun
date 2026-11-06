/**
 * "domain-heuristics": a deliberately simple second opinion on a link. It is
 * written independently of the Rust link-intel engine (different code,
 * different and smaller rule set) so that two verifiers can disagree, which is
 * the point of paying more than one. It never fetches anything.
 */

import type { Evidence } from "@/adapters/zerog";

type Level = "low" | "medium" | "high";
const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

/** Top-level domains that are cheap to register and over-represented in abuse. */
const RISKY_TLDS = new Set([
  "top",
  "xyz",
  "click",
  "zip",
  "mov",
  "icu",
  "cyou",
  "buzz",
  "rest",
  "support",
  "country",
  "gq",
  "tk",
  "ml",
  "cf",
  "ga",
  "work",
  "loan",
  "men",
]);

const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "ow.ly",
  "shorturl.at",
]);

interface Signal {
  code: string;
  level: Level;
}

export function domainSignals(rawUrl: string): Signal[] {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [{ code: "INVALID_URL", level: "high" }];
  }
  const signals: Signal[] = [];
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return [{ code: "NON_HTTP_SCHEME", level: "high" }];
  if (url.username || url.password)
    signals.push({ code: "CREDENTIALS_IN_URL", level: "high" });

  const host = url.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("["))
    signals.push({ code: "IP_ADDRESS_HOST", level: "high" });
  if (host.split(".").some((label) => label.startsWith("xn--")))
    signals.push({ code: "PUNYCODE_LABEL", level: "medium" });
  if (SHORTENERS.has(host))
    signals.push({ code: "URL_SHORTENER", level: "medium" });

  const tld = host.split(".").at(-1) ?? "";
  if (RISKY_TLDS.has(tld)) signals.push({ code: "RISKY_TLD", level: "medium" });
  if (url.protocol === "http:") signals.push({ code: "NO_TLS", level: "low" });
  if ((host.match(/-/g) ?? []).length >= 4)
    signals.push({ code: "MANY_HYPHENS", level: "low" });
  if (host.length > 50) signals.push({ code: "LONG_HOST", level: "low" });
  return signals;
}

export function domainHeuristics(rawUrl: string): Evidence {
  const signals = domainSignals(rawUrl);
  const level = signals.reduce<Level>(
    (top, s) => (RANK[s.level] > RANK[top] ? s.level : top),
    "low",
  );
  return {
    source: "domain-heuristics",
    level,
    detail: signals.length
      ? signals.map((s) => s.code).join(", ")
      : "no signals",
  };
}
