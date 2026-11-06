import { NextResponse } from "next/server";
import { getMirrorNode, loadPayeeReputation } from "@/adapters/hedera";
import { payeeQuerySchema } from "@/adapters/x402/checkers";
import { paidRoute } from "@/adapters/x402/server";
import { getConfig } from "@/config/env";
import { BUILT_IN_PRICES } from "@/marketplace/builtins";

const PRICE = BUILT_IN_PRICES.reputation;

export const GET = paidRoute(
  async (req) => {
    const query = payeeQuerySchema.safeParse({
      payee: req.nextUrl.searchParams.get("payee") ?? "",
    });
    if (!query.success)
      return NextResponse.json(
        { error: "payee must be a Hedera account id" },
        { status: 400 },
      );
    const topicId = getConfig().hedera.reputationTopicId;
    if (!topicId)
      return NextResponse.json(
        { error: "reputation topic not configured" },
        { status: 503 },
      );
    const evidence = await loadPayeeReputation(
      getMirrorNode(),
      topicId,
      query.data.payee,
    );
    return NextResponse.json({ evidence });
  },
  {
    amount: PRICE,
    description: "Payee reputation from the Kavach402 HCS reputation topic",
  },
);
