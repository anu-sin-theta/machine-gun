import { NextResponse } from "next/server";
import { paidRoute } from "@/adapters/x402/server";
import { BUILT_IN_PRICES } from "@/marketplace/builtins";
import { chatRequestSchema, scribeReply } from "@/marketplace/scribe";

/** The built-in demo worker: an OpenAI-compatible chat-completions endpoint behind x402. */
export const POST = paidRoute(
  async (req) => {
    const body = chatRequestSchema.safeParse(
      await req.json().catch(() => null),
    );
    if (!body.success)
      return NextResponse.json(
        { error: { message: "messages are required" } },
        { status: 400 },
      );
    return NextResponse.json(scribeReply(body.data, Date.now()));
  },
  {
    amount: BUILT_IN_PRICES.scribe,
    description: "Scribe: summarise text and list its links",
  },
);
