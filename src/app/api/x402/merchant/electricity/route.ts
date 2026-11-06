import { NextResponse } from "next/server";
import { paidRoute } from "@/adapters/x402/server";

/** 1.5 HBAR in tinybars: under the default auto cap, so a low-risk check auto-pays. */
const PRICE = 150_000_000n;

/** Demo merchant: the thing the agent is asked to pay for. */
export const GET = paidRoute(
  async () =>
    NextResponse.json({
      receipt: "KAVACH-DEMO-ELECTRICITY-0001",
      item: "Electricity bill, November",
      paidTinybars: PRICE.toString(),
    }),
  { amount: PRICE, description: "Demo merchant: electricity bill" },
);
