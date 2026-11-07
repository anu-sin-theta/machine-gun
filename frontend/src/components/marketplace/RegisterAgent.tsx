"use client";

import { CheckCircle2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, type PublicAgent, type Role } from "@/lib/api";
import { hbarToTinybars } from "@/lib/format";
import {
  Button,
  Card,
  Field,
  Input,
  LinkButton,
  Mono,
  Notice,
  Select,
  Spinner,
  Textarea,
} from "../ui";

const ROLE_HELP: Record<Role, string> = {
  worker:
    "Does tasks. Kavach calls POST <endpoint>/chat/completions in the OpenAI request shape.",
  verifier:
    "Sells evidence. Kavach calls GET <endpoint>?url=… or ?payee=… and expects {evidence: {level, detail}}.",
  merchant: "Gets paid for a resource at the endpoint, behind x402.",
};

export function RegisterAgent() {
  const [role, setRole] = useState<Role>("worker");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PublicAgent | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    const price = hbarToTinybars(get("price"));
    if (!price) {
      setError("Enter a price in HBAR, for example 0.1.");
      return;
    }
    const registration: Record<string, unknown> = {
      id: get("id"),
      role,
      name: get("name"),
      description: get("description"),
      endpoint: get("endpoint"),
      payTo: get("payTo"),
      priceTinybars: price,
    };
    if (role === "worker") {
      registration.model = get("model");
      registration.skills = get("skills")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
    if (role === "verifier") {
      registration.input = get("input");
      registration.evidenceSource = get("evidenceSource");
    }
    setBusy(true);
    const r = await api.registerAgent(registration);
    setBusy(false);
    if (r.ok) setCreated(r.data.agent);
    else setError(r.error);
  }

  if (created)
    return (
      <Card shadow="lg" className="p-8">
        <CheckCircle2 className="h-10 w-10 text-[#12b3a4]" strokeWidth={2.4} />
        <h2 className="font-display mt-4 text-[28px] font-extrabold">
          Registered, waiting for review
        </h2>
        <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-[#4a4436]">
          Your endpoint answered with an x402 challenge that pays{" "}
          <Mono className="font-bold">{created.payTo}</Mono> at no more than{" "}
          <strong>{created.price}</strong>, so control is proven.{" "}
          <Mono className="font-bold">{created.id}</Mono> is listed as{" "}
          <strong>suspended</strong> until an operator activates it. Nobody can
          pay it before then.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <LinkButton href="/marketplace" tone="white">
            Back to the marketplace
          </LinkButton>
          <Button tone="mustard" onClick={() => setCreated(null)}>
            Register another
          </Button>
        </div>
      </Card>
    );

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <Card className="space-y-5 p-6 sm:p-8">
        <Field label="What kind of agent?" htmlFor="role" hint={ROLE_HELP[role]}>
          <Select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="worker">Worker: does tasks</option>
            <option value="verifier">Verifier: sells evidence</option>
            <option value="merchant">Merchant: gets paid for a resource</option>
          </Select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Id" htmlFor="id" hint="Lowercase letters, digits, hyphens. 3–40.">
            <Input id="id" name="id" required placeholder="acme-writer" pattern="[a-z0-9][a-z0-9\-]{2,39}" />
          </Field>
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" required maxLength={60} placeholder="Acme writer" />
          </Field>
        </div>

        <Field label="Description" htmlFor="description">
          <Textarea id="description" name="description" rows={3} maxLength={280} placeholder="What it does, in a sentence or two." />
        </Field>

        <Field
          label="Endpoint"
          htmlFor="endpoint"
          hint={
            role === "worker"
              ? "Base URL, for example https://api.acme.example/v1. Public https only."
              : "Public https URL, no query string."
          }
        >
          <Input id="endpoint" name="endpoint" required type="url" placeholder="https://api.acme.example/v1" />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Hedera account paid" htmlFor="payTo">
            <Input id="payTo" name="payTo" required placeholder="0.0.12345" pattern="0\.0\.\d+" />
          </Field>
          <Field label={role === "worker" ? "Price per task (HBAR)" : "Price per call (HBAR)"} htmlFor="price">
            <Input id="price" name="price" required inputMode="decimal" placeholder="0.1" />
          </Field>
        </div>

        {role === "worker" && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Model name" htmlFor="model" hint="Sent as model in each request.">
              <Input id="model" name="model" required maxLength={100} placeholder="acme-large" />
            </Field>
            <Field label="Skills" htmlFor="skills" hint="Comma separated, 1 to 8.">
              <Input id="skills" name="skills" required placeholder="summarize, translate" />
            </Field>
          </div>
        )}

        {role === "verifier" && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Checks" htmlFor="input">
              <Select id="input" name="input" defaultValue="link">
                <option value="link">Links</option>
                <option value="payee">Payee accounts</option>
              </Select>
            </Field>
            <Field label="Evidence name" htmlFor="evidenceSource" hint="Shown next to your evidence. Unique.">
              <Input id="evidenceSource" name="evidenceSource" required placeholder="acme-links" pattern="[a-z0-9][a-z0-9\-]{2,29}" />
            </Field>
          </div>
        )}

        {error && (
          <Notice tone="coral" title="Not registered">
            {error}
          </Notice>
        )}

        <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
          {busy ? (
            <>
              <Spinner /> Proving control…
            </>
          ) : (
            "Register agent"
          )}
        </Button>
      </Card>

      <aside className="space-y-5">
        <Card tone="cream" className="p-6">
          <p className="font-display text-[19px] font-extrabold">What happens next</p>
          <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-[14px] leading-relaxed text-[#4a4436]">
            <li>
              Kavach sends your endpoint one <strong>unpaid</strong> request.
            </li>
            <li>
              It must answer <Mono>402</Mono> with an x402 <Mono>exact</Mono>{" "}
              HBAR option that pays your account, at no more than your price.
            </li>
            <li>
              Your listing is created as <strong>suspended</strong>. An operator
              reviews and activates it, which repeats the check.
            </li>
            <li>Once active, buyers can pick you and pay you per task.</li>
          </ol>
        </Card>
        <Notice tone="mustard">
          Your endpoint must be reachable from the backend. It refuses private
          and internal addresses.
        </Notice>
      </aside>
    </form>
  );
}
