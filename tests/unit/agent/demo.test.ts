import { beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "@/agent";
import {
  createDemoPorts,
  DEMO_MERCHANTS,
  DEMO_PAYEE,
  demoExtract,
  getDemoAudit,
  resetDemoState,
} from "@/agent/demo";
import { makeHarness } from "./harness";

const ORIGIN = "http://localhost:3000";
const merchant = (path: string) => `${ORIGIN}${path}`;
const BILL =
  "Mumbai Power Co: November bill is 1.5 HBAR. Pay to account 0.0.5001 by Friday.";
const SCAM =
  "URGENT: your SBI KYC expires today and your account will be blocked. Pay 1.5 HBAR to 0.0.5001 at https://sbi-secure-login.top/verify now. Do not tell anyone. Share the OTP.";

beforeEach(() => resetDemoState());

/** The real pipeline, real policy and approval flow, with demo ports. */
async function demo() {
  const h = await makeHarness();
  Object.assign(h.deps, createDemoPorts([ORIGIN]));
  const run = (text: string, path = "/api/x402/merchant/electricity") =>
    runCheck(h.deps, { text, resource: merchant(path) });
  return { h, run };
}

describe("demoExtract", () => {
  it("finds the account, link, amount and pressure phrases", () => {
    const e = demoExtract(SCAM);
    expect(e).toMatchObject({
      payeeAccount: "0.0.5001",
      link: "https://sbi-secure-login.top/verify",
      amountText: "1.5",
      currency: "HBAR",
    });
    expect(e.pressureTactics.length).toBeGreaterThanOrEqual(3);
  });

  it("finds nothing alarming in an ordinary bill", () => {
    const e = demoExtract(BILL);
    expect(e.pressureTactics).toEqual([]);
    expect(e.link).toBeNull();
  });

  it("keeps the summary short and tidy", () => {
    expect(
      demoExtract(`${"word ".repeat(200)}\n\n`).summary.length,
    ).toBeLessThanOrEqual(300);
  });
});

describe("demo ports", () => {
  it("reads text only", async () => {
    const { zerog } = createDemoPorts([ORIGIN]);
    await expect(
      zerog.extract({ kind: "image", mimeType: "image/png", base64: "AAAA" }),
    ).rejects.toThrow(/text only/);
  });

  it("judges by pressure language: none low, one medium, secrecy or OTP high", async () => {
    const { zerog } = createDemoPorts([ORIGIN]);
    const level = async (text: string) =>
      (await zerog.judge(demoExtract(text), [])).value.level;
    expect(await level(BILL)).toBe("low");
    expect(await level("Please pay today, thanks")).toBe("medium");
    expect(await level("Please share the OTP")).toBe("high");
    expect(await level(SCAM)).toBe("high");
  });

  it("labels its model so nothing passes for 0G", async () => {
    const { zerog } = createDemoPorts([ORIGIN]);
    const out = await zerog.extract({ kind: "text", text: BILL });
    expect(out.model).toBe("demo-heuristic");
    expect(out.requestId).toMatch(/^demo_req_/);
  });

  it("probes only allowed origins and known demo merchants", async () => {
    const { probe } = createDemoPorts([ORIGIN]);
    expect(await probe.challenge(merchant("/api/x402/merchant/rent"))).toEqual({
      payTo: DEMO_PAYEE,
      amount: DEMO_MERCHANTS["/api/x402/merchant/rent"]?.amount,
    });
    await expect(
      probe.challenge("http://169.254.169.254/x"),
    ).rejects.toMatchObject({
      kind: "RESOURCE_NOT_PAYABLE",
      message: "origin not allowed",
    });
    await expect(
      probe.challenge(merchant("/api/x402/merchant/nope")),
    ).rejects.toMatchObject({ message: "unknown demo merchant" });
    await expect(probe.challenge("::::")).rejects.toMatchObject({
      message: "bad url",
    });
  });

  it("runs the real link analysis", async () => {
    const { checkers } = createDemoPorts([ORIGIN]);
    expect(
      (await checkers.link("https://paypa1.com.account-verify.top")).level,
    ).toBe("high");
    expect((await checkers.link("https://www.paypal.com/")).level).toBe("low");
  });
});

describe("the whole loop in demo mode", () => {
  it("pays an ordinary bill, writes an audit trail and builds payee reputation", async () => {
    const { run } = await demo();
    const out = await run(BILL);
    expect(out).toMatchObject({
      status: "paid",
      decision: { kind: "auto-pay" },
    });
    expect(out.transactionId).toMatch(/^0\.0\.1001@\d+\.\d{9}$/);
    expect(getDemoAudit(out.checkId).map((e) => e.type)).toEqual([
      "check.received",
      "check.verdict",
      "check.decision",
      "payment.settled",
    ]);
    const { checkers } = createDemoPorts([ORIGIN]);
    expect((await checkers.reputation(DEMO_PAYEE)).detail).toContain(
      "1 paid ok",
    );
  });

  it("holds a scam for the strongest approval", async () => {
    const { run } = await demo();
    const out = await run(SCAM);
    expect(out).toMatchObject({
      status: "awaiting-approval",
      verdict: { level: "high" },
      decision: { kind: "step-up", tier: "strong" },
    });
    expect(out.approvalUrl).toBeTruthy();
    expect(
      out.verdict?.reasons.some((r) => r.includes("BRAND_IMPERSONATION")),
    ).toBe(true);
  });

  it("holds a request that names a different account", async () => {
    const { run } = await demo();
    const out = await run("Electricity bill 1.5 HBAR. Pay account 0.0.9999.");
    expect(out.decision).toMatchObject({ kind: "step-up", tier: "strong" });
    expect(out.verdict?.reasons.join(" ")).toContain("0.0.9999");
  });

  it("asks for approval over the auto cap and blocks over the hard cap", async () => {
    const { run } = await demo();
    expect(
      (await run("Rent 12 HBAR to 0.0.5001", "/api/x402/merchant/rent"))
        .decision,
    ).toMatchObject({ kind: "step-up", tier: "fresh" });
    expect(
      await run("Tuition 60 HBAR to 0.0.5001", "/api/x402/merchant/tuition"),
    ).toMatchObject({ status: "blocked", reason: "OVER_HARD_CAP" });
  });

  it("fails an unknown merchant before reading or paying anything", async () => {
    const { run } = await demo();
    expect(await run(BILL, "/api/x402/merchant/unknown")).toMatchObject({
      status: "failed",
      reason: "RESOURCE_NOT_PAYABLE",
    });
  });

  it("resets cleanly", async () => {
    const { run } = await demo();
    const out = await run(BILL);
    resetDemoState();
    expect(getDemoAudit(out.checkId)).toEqual([]);
  });
});
