/**
 * Smoke test of a running deployment in live mode: set LIVE_BASE_URL to the app
 * (and API_TOKEN if it is protected). It makes ONE real payment on testnet
 * (1.5 HBAR to the configured payee) and reads it back from the mirror node.
 * Run it against a deployment with AGENT_MODE unset (live); in demo mode the
 * transaction id is invented and the mirror check will correctly fail.
 */

import { describe, expect, it } from "vitest";
import { fetchMirrorTransaction } from "@/adapters/hedera";
import { loadConfig } from "@/config/env";
import { eventually } from "./helpers";

const base = process.env.LIVE_BASE_URL?.replace(/\/$/, "");
const token = process.env.API_TOKEN;
const config = loadConfig(process.env);

const headers: Record<string, string> = {
  "content-type": "application/json",
  ...(token && { authorization: `Bearer ${token}` }),
};

const check = async (text: string, resource: string) => {
  const res = await fetch(`${base}/api/checks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, resource }),
  });
  return { status: res.status, body: await res.json() };
};

describe.skipIf(!base)("deployed app (live): needs LIVE_BASE_URL", () => {
  it("answers the health check with the WASM core loaded", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, hashesAgree: true });
  });

  it("reports itself ready", async () => {
    const res = await fetch(`${base}/api/status`, { headers });
    const body = await res.json();
    expect(
      body.items?.filter((i: { status: string }) => i.status === "fail"),
    ).toEqual([]);
    expect(res.status).toBe(200);
  });

  it("pays an ordinary bill on its own, and the payment is on Hedera", async () => {
    const { status, body } = await check(
      "Mumbai Power Co: your November electricity bill is 1.5 HBAR. Pay to account 0.0.5001 by Friday. Reference MPC-4471.",
      `${base}/api/x402/merchant/electricity`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "paid",
      decision: { kind: "auto-pay" },
    });
    expect(body.transactionId).toBeTruthy();

    const tx = await eventually(
      () =>
        fetchMirrorTransaction(config.hedera.mirrorNodeUrl, body.transactionId),
      { what: "the settlement on the mirror node" },
    );
    expect(tx.result).toBe("SUCCESS");
    const payee = config.hedera.payeeAccountId;
    expect(
      tx.transfers.find((t) => t.account === payee)?.amount,
    ).toBeGreaterThanOrEqual(150_000_000);
  });

  it("does not pay a scam without an approval", async () => {
    const { status, body } = await check(
      "URGENT: your SBI KYC expires today and your account will be blocked. Pay 1.5 HBAR to 0.0.5001 at https://sbi-secure-login.top/verify now. Do not tell anyone. Share the OTP.",
      `${base}/api/x402/merchant/electricity`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "awaiting-approval",
      decision: { kind: "step-up", tier: "strong" },
    });
    expect(body.approvalUrl).toContain("/authorize");
    expect(body.transactionId).toBeUndefined();
  });

  it("refuses to fetch a merchant on an origin it was not given", async () => {
    const { body } = await check(
      "Please pay 1 HBAR",
      "http://169.254.169.254/latest/meta-data",
    );
    expect(body).toMatchObject({
      status: "failed",
      reason: "RESOURCE_NOT_PAYABLE",
    });
  });
});
