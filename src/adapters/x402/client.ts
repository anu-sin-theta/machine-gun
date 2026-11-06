import { x402Client } from "@x402/core/client";
import type { SchemeNetworkClient } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { type GuardConfig, SpendGuard } from "./guard";

export class X402Error extends Error {
  constructor(
    readonly kind: "GUARD_REJECTED" | "PAYMENT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "X402Error";
  }
}

/**
 * x402 client whose every payment goes through `guard` first. The built-in
 * spend controls are off: they are tuned for USD stablecoins, and the guard
 * already enforces asset, payee, cap and budget for HBAR.
 */
export function createGuardedClient(
  guard: SpendGuard,
  scheme: SchemeNetworkClient,
  network: GuardConfig["network"],
): x402Client {
  const reserved = new Map<string, bigint>();
  return x402Client
    .fromConfig({
      schemes: [{ network, client: scheme }],
      spendControls: false,
    })
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const result = guard.reserve(selectedRequirements);
      if (!result.ok) return { abort: true, reason: `GUARD:${result.reason}` };
      reserved.set(key(selectedRequirements), result.amount);
    })
    .onPaymentCreationFailure(async ({ selectedRequirements }) => {
      const amount = reserved.get(key(selectedRequirements));
      if (amount !== undefined) guard.release(amount);
      reserved.delete(key(selectedRequirements));
    });
}

const key = (r: { payTo: string; amount: string; asset: string }) =>
  `${r.payTo}|${r.asset}|${r.amount}`;

export interface PayingFetch {
  fetch: typeof fetch;
  guard: SpendGuard;
}

export interface PayingFetchConfig extends GuardConfig {
  accountId: string;
  /** DER-encoded private key from portal.hedera.com. */
  privateKey: string;
  /** Underlying fetch; injected in tests. */
  baseFetch?: typeof fetch;
  /** Replaces the Hedera signer scheme; injected in tests. */
  scheme?: SchemeNetworkClient;
}

/** A fetch that pays 402 challenges from the allowed checkers, within budget. */
export function createPayingFetch(config: PayingFetchConfig): PayingFetch {
  const guard = new SpendGuard(config);
  const scheme =
    config.scheme ??
    new ExactHederaScheme(
      createClientHederaSigner(
        config.accountId,
        PrivateKey.fromStringDer(config.privateKey),
        { network: config.network },
      ),
    );
  const client = createGuardedClient(guard, scheme, config.network);
  const paying = wrapFetchWithPayment(config.baseFetch ?? fetch, client);

  return {
    guard,
    fetch: (async (input, init) => {
      try {
        return await paying(input, init);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const guardHit = /GUARD:([A-Z_]+)/.exec(message);
        if (guardHit)
          throw new X402Error("GUARD_REJECTED", guardHit[1] as string);
        throw new X402Error("PAYMENT_FAILED", message);
      }
    }) as typeof fetch,
  };
}
