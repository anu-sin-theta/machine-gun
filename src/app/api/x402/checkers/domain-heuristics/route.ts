import { NextResponse } from "next/server";
import { linkQuerySchema } from "@/adapters/x402/checkers";
import { paidRoute } from "@/adapters/x402/server";
import { BUILT_IN_PRICES } from "@/marketplace/builtins";
import { domainHeuristics } from "@/marketplace/heuristics";

export const GET = paidRoute(
  async (req) => {
    const query = linkQuerySchema.safeParse({
      url: req.nextUrl.searchParams.get("url") ?? "",
    });
    if (!query.success)
      return NextResponse.json(
        { error: "url is required (max 2000 chars)" },
        { status: 400 },
      );
    return NextResponse.json({ evidence: domainHeuristics(query.data.url) });
  },
  {
    amount: BUILT_IN_PRICES.domainHeuristics,
    description: "Domain heuristics: a lightweight second opinion on a link",
  },
);
