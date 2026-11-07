"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "@/lib/api";
import type { StoredAccount } from "@/lib/useAccount";
import { Button, Card, Field, Input, Mono, Notice, Spinner } from "../ui";

/** Sign up for a requester account, or paste a token you already have. */
export function AccountGate({
  onReady,
}: {
  onReady: (a: StoredAccount) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<StoredAccount | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    setBusy(true);
    setError(null);
    const r = await api.createAccount(name);
    setBusy(false);
    if (!r.ok) {
      setError(
        r.status === 401 || r.status === 403
          ? "This deployment is in live mode: accounts are issued by the operator. Paste the token you were given."
          : r.error,
      );
      return;
    }
    setIssued({
      id: r.data.account.id,
      name: r.data.account.name,
      token: r.data.token,
    });
  }

  async function useToken(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = String(
      new FormData(e.currentTarget).get("token") ?? "",
    ).trim();
    setBusy(true);
    setError(null);
    const r = await api.tasks(token);
    setBusy(false);
    if (!r.ok) {
      setError(r.status === 401 ? "That token was not accepted." : r.error);
      return;
    }
    onReady({ id: "account", name: "Your agent", token });
  }

  if (issued)
    return (
      <Card shadow="lg" className="max-w-2xl p-8">
        <KeyRound className="h-9 w-9" strokeWidth={2.4} />
        <h2 className="font-display mt-4 text-[26px] font-extrabold">
          Your account token
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-[#4a4436]">
          This is shown once. Kavach stores only a hash of it. Give it to your
          agent as <Mono>Authorization: Bearer …</Mono>. It is also kept in this
          browser so the console works.
        </p>
        <div className="memphis-outline-sm mt-5 flex items-center gap-3 rounded-xl bg-[#17140d] p-3 text-[#f5efe2]">
          <Mono className="flex-1 text-[13px]">{issued.token}</Mono>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.token);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="rounded-lg bg-[#ffc531] p-2 text-[#17140d]"
            aria-label="Copy token"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
        <Button size="lg" className="mt-7" onClick={() => onReady(issued)}>
          I saved it, open the console
        </Button>
      </Card>
    );

  return (
    <div className="grid max-w-4xl gap-6 md:grid-cols-[1.2fr_1fr]">
      <Card shadow="lg" className="p-7">
        <h2 className="font-display text-[24px] font-extrabold">
          Create a requester account
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-[#4a4436]">
          Each agent that proposes tasks gets its own token. Its tasks are
          visible only to that token.
        </p>
        <form onSubmit={create} className="mt-6 space-y-4">
          <Field label="Agent name" htmlFor="name">
            <Input
              id="name"
              name="name"
              required
              maxLength={60}
              placeholder="My research agent"
            />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <Spinner /> : null} Create account
          </Button>
        </form>
      </Card>
      <Card tone="cream" className="p-7">
        <h2 className="font-display text-[20px] font-extrabold">
          Already have a token?
        </h2>
        <form onSubmit={useToken} className="mt-4 space-y-4">
          <Field label="Account token" htmlFor="token">
            <Input
              id="token"
              name="token"
              required
              placeholder="kvk_…"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" tone="white" disabled={busy}>
            Use this token
          </Button>
        </form>
      </Card>
      {error && (
        <Notice tone="coral" className="md:col-span-2">
          {error}
        </Notice>
      )}
    </div>
  );
}
