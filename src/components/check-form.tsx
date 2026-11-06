"use client";

import {
  type FormEvent,
  startTransition,
  useActionState,
  useState,
} from "react";
import { type FormState, submitCheck } from "@/app/actions";
import { CheckResult } from "./check-result";

export interface Merchant {
  url: string;
  label: string;
}

interface Example {
  id: string;
  label: string;
  text: string;
  /** Path of the demo merchant this example pays. */
  merchantPath: string;
}

const EXAMPLES: Example[] = [
  {
    id: "electricity",
    label: "Electricity bill",
    merchantPath: "/api/x402/merchant/electricity",
    text: "Mumbai Power Co: your November electricity bill is 1.5 HBAR. Pay to account 0.0.5001 by Friday. Reference MPC-4471.",
  },
  {
    id: "scam",
    label: "Phishing scam",
    merchantPath: "/api/x402/merchant/electricity",
    text: "URGENT: your SBI KYC expires today and your account will be blocked. Pay 1.5 HBAR to 0.0.5001 at https://sbi-secure-login.top/verify now. Do not tell anyone. Share the OTP when asked.",
  },
  {
    id: "wrong-account",
    label: "Wrong account",
    merchantPath: "/api/x402/merchant/electricity",
    text: "Mumbai Power Co: November electricity bill, 1.5 HBAR. Pay to account 0.0.9999.",
  },
  {
    id: "rent",
    label: "Rent (over the limit)",
    merchantPath: "/api/x402/merchant/rent",
    text: "Landlord reminder: November rent is 12 HBAR, pay to account 0.0.5001. Thank you.",
  },
  {
    id: "tuition",
    label: "Tuition (too large)",
    merchantPath: "/api/x402/merchant/tuition",
    text: "College office: semester tuition of 60 HBAR is due. Pay to account 0.0.5001.",
  },
];

export function CheckForm({
  baseUrl,
  merchants,
  demo,
  network,
}: {
  baseUrl: string;
  /** Demo merchants to pick from, or null to type any merchant URL. */
  merchants: Merchant[] | null;
  demo: boolean;
  network: "testnet" | "mainnet";
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    submitCheck,
    {},
  );
  const [text, setText] = useState("");
  const [resource, setResource] = useState(
    merchants?.[0]?.url ?? `${baseUrl}/api/x402/merchant/electricity`,
  );

  // Not `<form action>`: React 19 resets the form after an action, which would snap the
  // merchant dropdown back to its first option while our state still holds another.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  function fillExample(example: Example) {
    setText(example.text);
    setResource(`${baseUrl}${example.merchantPath}`);
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm"
      >
        <div>
          <p className="text-sm font-medium">Try an example</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                data-testid={`example-${example.id}`}
                onClick={() => fillExample(example)}
                className="rounded-full border border-border px-3 py-1 text-sm hover:bg-neutral-bg"
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="text" className="block text-sm font-medium">
            Payment request
          </label>
          <textarea
            id="text"
            name="text"
            required
            maxLength={4000}
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the invoice, message or note you were asked to pay."
            className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm"
          />
        </div>

        <div>
          <label htmlFor="resource" className="block text-sm font-medium">
            Merchant
          </label>
          {merchants ? (
            <select
              id="resource"
              name="resource"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-sm"
            >
              {merchants.map((m) => (
                <option key={m.url} value={m.url}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="resource"
              name="resource"
              type="url"
              required
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 font-mono text-sm"
            />
          )}
          <p className="mt-1 text-xs text-muted">
            The merchant&apos;s own payment request decides who is paid and how
            much. The text above is only read for warning signs.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          data-testid="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Check, then pay if it is safe"}
        </button>
      </form>

      <div aria-live="polite">
        {state.error ? (
          <p
            role="alert"
            data-testid="error"
            className="rounded-lg bg-bad-bg p-3 text-sm text-bad-fg"
          >
            {state.error}
          </p>
        ) : null}
        {state.view ? (
          <CheckResult view={state.view} demo={demo} network={network} />
        ) : null}
      </div>
    </div>
  );
}
