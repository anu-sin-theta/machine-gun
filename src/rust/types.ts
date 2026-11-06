/** JSON shapes for the Rust link-intel engine (rust/kavach-core/src/linkintel.rs). */

import type { RiskLevel } from "@/core";

export interface Brand {
  name: string;
  /** Lowercase tokens that identify the brand inside a host, e.g. "hdfcbank". */
  tokens: string[];
  /** Registrable domains the brand really owns, e.g. "hdfcbank.com". */
  domains: string[];
}

export interface LinkIntelConfig {
  brands: Brand[];
  /** Last label of the public suffix, e.g. "zip", "top". */
  suspiciousTlds: string[];
  /** Registrable domains of URL shorteners. */
  shorteners: string[];
}

export interface LinkInput {
  url: string;
  /** URLs of each redirect hop after `url`; the last is the landing page. */
  redirectChain?: string[];
  /** Registrable-domain age from RDAP. Unknown is not a signal: omit it. */
  domainAgeDays?: number;
}

export type Severity = "info" | "low" | "medium" | "high";
export type SignalStage = "entry" | "landing";

export type SignalCode =
  | "INVALID_URL"
  | "NON_HTTP_SCHEME"
  | "USERINFO_IN_URL"
  | "IP_HOST"
  | "INVALID_PUNYCODE"
  | "MIXED_SCRIPT"
  | "CONFUSABLE_BRAND"
  | "BRAND_IMPERSONATION"
  | "LOOKALIKE_BRAND"
  | "NEW_DOMAIN"
  | "REDIRECT_DOWNGRADE"
  | "REDIRECT_CROSS_DOMAIN"
  | "HTTP_NOT_HTTPS"
  | "URL_SHORTENER"
  | "SUSPICIOUS_TLD"
  | "NONSTANDARD_PORT"
  | "NO_REGISTRABLE_DOMAIN"
  | "EXCESSIVE_SUBDOMAINS"
  | "LONG_HOST"
  | "MANY_HYPHENS"
  | "LONG_REDIRECT_CHAIN"
  | "IDN_DOMAIN";

export interface LinkSignal {
  code: SignalCode;
  severity: Severity;
  stage: SignalStage;
  detail: string;
}

export interface LinkReport {
  /** Punycode host of the entry URL, if it parsed. */
  host: string | null;
  /** Same host in Unicode, as a user would see it. */
  unicodeHost: string | null;
  registrableDomain: string | null;
  landingHost: string | null;
  /** 0..=100 */
  score: number;
  level: RiskLevel;
  signals: LinkSignal[];
}
