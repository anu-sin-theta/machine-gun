/**
 * The built-in demo worker's "model": plain rules, no language model. It
 * summarises the last user message (its first sentences) and lists the links
 * in it, answering in the OpenAI chat-completions shape so it is called
 * exactly like any registered worker.
 */

import { z } from "zod";

export const chatRequestSchema = z.object({
  model: z.string().max(100).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(20_000),
      }),
    )
    .min(1)
    .max(20),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

const LINK = /https?:\/\/[^\s)>"'\]]+/gi;

/** The links in a text, without the sentence punctuation that often follows them. */
export const findLinks = (text: string): string[] => [
  ...new Set((text.match(LINK) ?? []).map((l) => l.replace(/[.,;:!?]+$/, ""))),
];

export function scribe(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // Dots inside links are not sentence ends.
  const sentences =
    flat.replace(LINK, "link").match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  const summary =
    sentences
      .slice(0, 2)
      .map((s) => s.trim())
      .join(" ") || "(empty)";
  const links = findLinks(flat).slice(0, 20);
  const words = flat ? flat.split(" ").length : 0;
  return [
    `Summary: ${summary.slice(0, 600)}`,
    `Length: ${words} words, ${sentences.length} sentences.`,
    links.length
      ? `Links:\n${links.map((l) => `- ${l}`).join("\n")}`
      : "Links: none",
  ].join("\n\n");
}

/** A chat-completions response for one assistant message. */
export function completion(model: string, content: string, created: number) {
  return {
    id: `chatcmpl-${created}`,
    object: "chat.completion",
    created: Math.floor(created / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

export function scribeReply(request: ChatRequest, now: number) {
  const lastUser = [...request.messages]
    .reverse()
    .find((m) => m.role === "user");
  return completion("kavach-scribe-1", scribe(lastUser?.content ?? ""), now);
}
