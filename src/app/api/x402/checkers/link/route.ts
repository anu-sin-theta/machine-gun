import { NextResponse } from "next/server";
import { checkLink, linkQuerySchema } from "@/adapters/x402/checkers";
import { paidRoute } from "@/adapters/x402/server";

/** 0.05 HBAR in tinybars. */
const PRICE = 5_000_000n;

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
    return NextResponse.json(checkLink(query.data.url));
  },
  {
    amount: PRICE,
    description: "Link intelligence: lookalike, redirect and domain checks",
  },
);
