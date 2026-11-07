import { decodePaymentRequiredHeader } from "@x402/core/http";
import { HBAR_ASSET_ID } from "@/adapters/x402";

export type ChallengeRead =
  | { ok: true; payTo: string; amount: bigint }
  | { ok: false; reason: string };

/** Reads the HBAR `exact` option on `network` from an unpaid response's x402 challenge. */
export function readChallenge(
  res: Response,
  network: "hedera:testnet" | "hedera:mainnet",
): ChallengeRead {
  if (res.status !== 402)
    return { ok: false, reason: `expected an x402 402, got ${res.status}` };
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) return { ok: false, reason: "402 without payment requirements" };
  let accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
  }>;
  try {
    accepts = decodePaymentRequiredHeader(header).accepts;
  } catch {
    return { ok: false, reason: "unreadable payment requirements" };
  }
  const option = accepts.find(
    (a) =>
      a.scheme === "exact" &&
      a.network === network &&
      a.asset === HBAR_ASSET_ID &&
      /^[1-9]\d*$/.test(a.amount),
  );
  if (!option)
    return { ok: false, reason: `no HBAR exact option on ${network}` };
  return { ok: true, payTo: option.payTo, amount: BigInt(option.amount) };
}

/** Where a worker's OpenAI-compatible endpoint takes tasks. */
export const chatCompletionsUrl = (endpoint: string) =>
  `${endpoint.replace(/\/+$/, "")}/chat/completions`;

/**
 * What demo mode sends in place of a signed x402 payment when it calls a
 * third-party agent. Nothing is settled: an agent that wants to be testable
 * against a demo deployment may accept it, and must never accept it when it
 * expects real money (see examples/gemini-agents).
 */
export const DEMO_PAYMENT = "demo-unsettled";
