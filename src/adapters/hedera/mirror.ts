import { z } from "zod";
import { isHederaEntityId } from "@/core";
import { HederaError, type MirrorNode, type TopicMessage } from "./types";

const messagesSchema = z.object({
  messages: z.array(
    z.object({
      sequence_number: z.number().int(),
      consensus_timestamp: z.string(),
      message: z.string(),
    }),
  ),
  links: z.object({ next: z.string().nullable().optional() }).optional(),
});

const balancesSchema = z.object({
  balances: z.array(z.object({ balance: z.union([z.number(), z.string()]) })),
});

/**
 * SDK transaction ids look like `0.0.1001@1700000000.123456789`; the mirror
 * node REST API wants `0.0.1001-1700000000-123456789`. Null if it is neither.
 */
export function toMirrorTransactionId(transactionId: string): string | null {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d{1,9})$/.exec(transactionId);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return /^\d+\.\d+\.\d+-\d+-\d{1,9}$/.test(transactionId)
    ? transactionId
    : null;
}

const transactionSchema = z.object({
  transactions: z.array(
    z.object({
      result: z.string(),
      name: z.string(),
      transfers: z.array(z.object({ account: z.string(), amount: z.number() })),
    }),
  ),
});

export interface MirrorTransaction {
  result: string;
  name: string;
  /** Net HBAR movement per account, tinybars (negative for senders and fees). */
  transfers: Array<{ account: string; amount: number }>;
}

/** The mirror node's view of a transaction, or null if it has not appeared yet (it lags a few seconds). */
export async function fetchMirrorTransaction(
  baseUrl: string,
  transactionId: string,
  doFetch: typeof fetch = fetch,
): Promise<MirrorTransaction | null> {
  const id = toMirrorTransactionId(transactionId);
  if (!id)
    throw new HederaError(
      "INVALID_MESSAGE",
      `bad transaction id ${transactionId}`,
    );
  const res = await doFetch(
    `${new URL(baseUrl).origin}/api/v1/transactions/${id}`,
    { headers: { accept: "application/json" } },
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new HederaError(
      "MIRROR_FAILED",
      `mirror node returned ${res.status}`,
    );
  const parsed = transactionSchema.safeParse(await res.json());
  const tx = parsed.success ? parsed.data.transactions[0] : undefined;
  if (!tx)
    throw new HederaError("MIRROR_FAILED", "unexpected mirror node response");
  return { result: tx.result, name: tx.name, transfers: tx.transfers };
}

export interface MirrorNodeConfig {
  baseUrl: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** Safety cap on pagination requests. */
  maxPages?: number;
}

export function createMirrorNode(config: MirrorNodeConfig): MirrorNode {
  const doFetch = config.fetch ?? fetch;
  const origin = new URL(config.baseUrl).origin;
  const maxPages = config.maxPages ?? 20;

  async function getJson(url: string): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(url, { headers: { accept: "application/json" } });
    } catch (e) {
      throw new HederaError(
        "MIRROR_FAILED",
        e instanceof Error ? e.message : String(e),
      );
    }
    if (res.status === 404) return null;
    if (!res.ok)
      throw new HederaError(
        "MIRROR_FAILED",
        `mirror node returned ${res.status}`,
      );
    return res.json();
  }

  return {
    async listTopicMessages(topicId, options = {}) {
      if (!isHederaEntityId(topicId))
        throw new HederaError("INVALID_MESSAGE", `bad topic id ${topicId}`);
      const limit = Math.min(options.maxMessages ?? 100, 1000);
      const query = new URLSearchParams({
        order: "asc",
        limit: String(Math.min(limit, 100)),
      });
      if (options.afterSequence !== undefined)
        query.set("sequencenumber", `gt:${options.afterSequence}`);

      const out: TopicMessage[] = [];
      let next: string | null | undefined =
        `${origin}/api/v1/topics/${topicId}/messages?${query}`;
      for (
        let page = 0;
        next && page < maxPages && out.length < limit;
        page++
      ) {
        const json = await getJson(next);
        if (json === null) return out;
        const parsed = messagesSchema.safeParse(json);
        if (!parsed.success)
          throw new HederaError(
            "MIRROR_FAILED",
            "unexpected mirror node response",
          );
        for (const m of parsed.data.messages) {
          if (out.length >= limit) break;
          out.push({
            sequenceNumber: m.sequence_number,
            consensusTimestamp: m.consensus_timestamp,
            payload: new Uint8Array(Buffer.from(m.message, "base64")),
          });
        }
        // `links.next` is a path; only ever follow it on the configured origin.
        const link = parsed.data.links?.next;
        next = link ? `${origin}${link}` : null;
      }
      return out;
    },

    async getHbarBalance(accountId) {
      if (!isHederaEntityId(accountId))
        throw new HederaError("INVALID_MESSAGE", `bad account id ${accountId}`);
      const json = await getJson(
        `${origin}/api/v1/balances?account.id=${encodeURIComponent(accountId)}`,
      );
      if (json === null) return null;
      const parsed = balancesSchema.safeParse(json);
      if (!parsed.success)
        throw new HederaError(
          "MIRROR_FAILED",
          "unexpected mirror node response",
        );
      const first = parsed.data.balances[0];
      return first ? BigInt(first.balance) : null;
    },
  };
}
