/**
 * What comes back from a worker is untrusted text. Before a buyer sees it:
 * only the assistant message is kept, control characters are stripped, it is
 * capped, and every link in it goes through the link engine, so a worker that
 * slips a phishing link into an answer is flagged rather than passed along.
 */

import { checkLink } from "@/adapters/x402/checkers";
import { findLinks } from "@/marketplace/scribe";
import type { OutputWarning } from "./types";

export const MAX_OUTPUT = 20_000;
const MAX_LINKS_CHECKED = 10;

// Every control character except tab and newline, plus the Unicode line and paragraph separators.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;

/** The assistant's text from a chat-completions response, cleaned and capped; null if there is none. */
export function readAnswer(json: unknown): string | null {
  const content = (
    json as { choices?: Array<{ message?: { content?: unknown } }> } | null
  )?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const cleaned = content.replace(CONTROL, "");
  return cleaned.trim() ? cleaned.slice(0, MAX_OUTPUT) : null;
}

export function scanAnswer(text: string): OutputWarning[] {
  const links = findLinks(text);
  const warnings: OutputWarning[] = [];
  for (const url of links.slice(0, MAX_LINKS_CHECKED)) {
    const { report } = checkLink(url);
    if (report.level === "low") continue;
    warnings.push({
      url: url.slice(0, 300),
      level: report.level,
      signals: report.signals.slice(0, 5).map((s) => s.code),
    });
  }
  return warnings;
}
