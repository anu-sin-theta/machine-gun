import { connection, NextResponse } from "next/server";
import { getConfig } from "@/config/env";
import { getDirectory } from "@/marketplace";
import { agentCard } from "@/tasks/card";

/**
 * Discovery: where outside agents learn what Kavach402 offers and how to call
 * it. Follows the A2A AgentCard shape; see docs/MARKETPLACE.md for what an A2A
 * client can and cannot do with it today.
 */
export async function GET() {
  await connection();
  const workers = await getDirectory().all({
    role: "worker",
    status: "active",
  });
  return NextResponse.json(agentCard(getConfig().baseUrl, workers), {
    headers: { "cache-control": "public, max-age=60" },
  });
}
