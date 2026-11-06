import { NextResponse } from "next/server";
import { getSimulator } from "@/adapters/world";

/** The simulated World issuer. 404s unless WORLD_MODE=simulated, so it cannot be reached in a real deployment. */
async function handle(req: Request): Promise<Response> {
  const simulator = getSimulator();
  if (!simulator)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return simulator.handle(req);
}

export const GET = handle;
export const POST = handle;
