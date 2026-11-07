"use client";

import { ExternalLink, Play } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, type CheckResult } from "@/lib/api";
import { explainReason } from "@/lib/format";
import { useOperatorToken } from "@/lib/useOperatorToken";
import { cn } from "@/lib/utils";
import { CheckStatusPill, RiskPill } from "../status";
import { Button, Card, Field, Input, Mono, Notice, Select, Spinner, Textarea } from "../ui";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

/** The backend's demo merchants: their own x402 402 sets payee and amount. */
const MERCHANTS = [
  { path: "/api/x402/merchant/electricity", label: "Electricity · 1.5 HBAR" },
  { path: "/api/x402/merchant/rent", label: "Rent · 12 HBAR" },
  { path: "/api/x402/merchant/tuition", label: "Tuition · 60 HBAR" },
];

const EXAMPLES = [
  {
    id: "electricity",
    label: "Electricity bill",
    merchant: MERCHANTS[0].path,
    text: "Mumbai Power Co: your November electricity bill is 1.5 HBAR. Pay to account 0.0.5001 by Friday. Reference MPC-4471.",
  },
  {
    id: "scam",
    label: "Phishing scam",
    merchant: MERCHANTS[0].path,
    text: "URGENT: your SBI KYC expires today and your account will be blocked. Pay 1.5 HBAR to 0.0.5001 at https://sbi-secure-login.top/verify now. Do not tell anyone. Share the OTP when asked.",
  },
  {
    id: "wrong-account",
    label: "Wrong account",
    merchant: MERCHANTS[0].path,
    text: "Mumbai Power Co: November electricity bill, 1.5 HBAR. Pay to account 0.0.9999.",
  },
  {
    id: "rent",
    label: "Rent (over the limit)",
    merchant: MERCHANTS[1].path,
    text: "Landlord reminder: November rent is 12 HBAR, pay to account 0.0.5001. Thank you.",
  },
  {
    id: "tuition",
    label: "Tuition (too large)",
    merchant: MERCHANTS[2].path,
    text: "College office: semester tuition of 60 HBAR is due. Pay to account 0.0.5001.",
  },
];

function headline(r: CheckResult): string {
  if (r.status === "paid") return "Paid. The request looked ordinary and was within limits.";
  if (r.status === "awaiting-approval")
    return r.decision?.tier === "strong"
      ? "Held. This looks risky: only the strongest World ID approval can release it."
      : "Held for a human. A World ID approval is needed before paying.";
  if (r.status === "blocked") return "Blocked. Nothing was paid.";
  return "The check did not finish. Nothing was paid.";
}

export function PaymentCheck() {
  const [text, setText] = useState(EXAMPLES[0].text);
  const [merchant, setMerchant] = useState(EXAMPLES[0].merchant);
  const [active, setActive] = useState(EXAMPLES[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const operator = useOperatorToken();
  const [needsToken, setNeedsToken] = useState(false);

  async function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const r = await api.runCheck(text, `${BACKEND}${merchant}`, operator.token);
    setBusy(false);
    if (r.ok) {
      setResult(r.data);
      setNeedsToken(false);
    } else if (r.status === 401) {
      setNeedsToken(true);
      setError(
        operator.token
          ? "That operator token was not accepted."
          : "This deployment protects payment checks with its operator token (API_TOKEN). Enter it below.",
      );
    } else setError(r.error);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      <Card className="p-6">
        <form onSubmit={run} className="space-y-5">
          <div>
            <p className="text-[14px] font-bold">Try an example</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  aria-pressed={active === ex.id}
                  onClick={() => {
                    setActive(ex.id);
                    setText(ex.text);
                    setMerchant(ex.merchant);
                    setResult(null);
                  }}
                  className={cn(
                    "rounded-full border-2 border-[#17140d] px-3 py-1 text-[13px] font-bold",
                    active === ex.id ? "bg-[#17140d] text-[#f5efe2]" : "bg-white hover:bg-[#fff1c7]",
                  )}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
          <Field
            label="The payment request, as you received it"
            htmlFor="check-text"
            hint="Untrusted text. Kavach reads it privately but takes payee and amount only from the merchant's own 402."
          >
            <Textarea
              id="check-text"
              rows={5}
              value={text}
              required
              maxLength={4000}
              onChange={(e) => {
                setText(e.target.value);
                setActive("");
              }}
            />
          </Field>
          <Field label="Merchant (x402 resource)" htmlFor="check-merchant">
            <Select id="check-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)}>
              {MERCHANTS.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {(needsToken || operator.token) && (
            <Field label="Operator token" htmlFor="check-token" hint="Kept in this tab only.">
              <Input
                id="check-token"
                type="password"
                autoComplete="off"
                value={operator.token}
                onChange={(e) => operator.save(e.target.value.trim())}
              />
            </Field>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? (
              <>
                <Spinner /> Checking…
              </>
            ) : (
              <>
                <Play className="h-5 w-5" /> Check and pay if safe
              </>
            )}
          </Button>
        </form>
      </Card>

      <div aria-live="polite">
        {error && <Notice tone="coral">{error}</Notice>}
        {!result && !error && (
          <Card tone="cream" className="p-6">
            <p className="font-display text-[20px] font-extrabold">What Kavach does</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-[#4a4436]">
              <li>Asks the merchant for its x402 challenge: the only source of payee and amount.</li>
              <li>Reads the request privately on 0G for payee, links and pressure tactics.</li>
              <li>Pays verifiers for evidence about the payee and any link.</li>
              <li>The Rust policy decides: pay, ask for World ID, or block.</li>
            </ol>
          </Card>
        )}
        {result && (
          <Card shadow="lg" className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <CheckStatusPill status={result.status} />
              {result.verdict && <RiskPill level={result.verdict.level} />}
            </div>
            <h2 className="font-display mt-4 text-[24px] font-extrabold leading-tight">{headline(result)}</h2>

            {result.decision && (
              <div className="mt-5">
                <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#6b6455]">Policy</p>
                <ul className="mt-2 space-y-1.5 text-[15px]">
                  {result.decision.reasons.map((r) => (
                    <li key={r}>• {explainReason(r)}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.verdict && result.verdict.reasons.length > 0 && (
              <div className="mt-5">
                <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#6b6455]">Why</p>
                <ul className="mt-2 space-y-1.5 text-[15px]">
                  {result.verdict.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.reason && (
              <Notice tone="mustard" className="mt-5">
                {explainReason(result.reason)}
              </Notice>
            )}

            <dl className="mt-6 space-y-1.5 border-t-2 border-dashed border-[#17140d]/20 pt-4 text-[13px]">
              <div className="flex gap-2">
                <dt className="font-bold text-[#6b6455]">Check</dt>
                <dd>
                  <Mono>{result.checkId}</Mono>
                </dd>
              </div>
              {result.transactionId && (
                <div className="flex gap-2">
                  <dt className="font-bold text-[#6b6455]">Transaction</dt>
                  <dd>
                    <Mono>{result.transactionId}</Mono>
                  </dd>
                </div>
              )}
            </dl>

            {result.approvalUrl && (
              <a
                href={result.approvalUrl}
                target="_blank"
                rel="noreferrer"
                className="memphis-btn-sm mt-6 inline-flex items-center gap-2 rounded-xl bg-[#17140d] px-4 py-2.5 text-[15px] font-bold text-[#f5efe2]"
              >
                Approve with World ID <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
