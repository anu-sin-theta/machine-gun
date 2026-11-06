/**
 * Server side: the checkers and the demo merchant are ordinary Next route
 * handlers behind `withX402`, priced in HBAR and settled through the
 * configured facilitator. `withX402` settles only after the handler returns a
 * success status, so a failed check is never charged.
 */

import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { withX402 } from "@x402/next";
import { type NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/config/env";
import { HBAR_ASSET_ID } from "./guard";

type Handler = (req: NextRequest) => Promise<NextResponse>;

export interface PriceSpec {
  /** Tinybars. */
  amount: bigint;
  description: string;
}

/** Route config for an HBAR-priced `exact` payment. */
export function hbarRouteConfig(
  spec: PriceSpec,
  network: "hedera:testnet" | "hedera:mainnet",
  payTo: string,
) {
  if (spec.amount <= 0n) throw new RangeError("price must be > 0");
  return {
    accepts: [
      {
        scheme: "exact" as const,
        price: { asset: HBAR_ASSET_ID, amount: spec.amount.toString() },
        network,
        payTo,
      },
    ],
    description: spec.description,
  };
}

let server: x402ResourceServer | undefined;

function getResourceServer(): x402ResourceServer {
  server ??= new x402ResourceServer(
    new HTTPFacilitatorClient({ url: getConfig().x402.facilitatorUrl }),
  ).register("hedera:*", new ExactHederaScheme());
  return server;
}

/**
 * Wraps a handler so it requires payment. Built on the first request, so
 * importing the route never reads config. Returns 503 when the payee account
 * is not configured, rather than serving the content for free.
 */
export function paidRoute(handler: Handler, spec: PriceSpec): Handler {
  let wrapped: Handler | undefined;
  return async (req) => {
    if (!wrapped) {
      const { hedera } = getConfig();
      if (!hedera.payeeAccountId)
        return NextResponse.json(
          { error: "payee account not configured" },
          { status: 503 },
        );
      wrapped = withX402(
        handler,
        hbarRouteConfig(
          spec,
          `hedera:${hedera.network}`,
          hedera.payeeAccountId,
        ),
        getResourceServer(),
      ) as Handler;
    }
    return wrapped(req);
  };
}
