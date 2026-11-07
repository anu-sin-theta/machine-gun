"use client";

import { ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type PublicAgent } from "@/lib/api";
import { useOperatorToken } from "@/lib/useOperatorToken";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Mono,
  Notice,
  Pill,
  Spinner,
} from "../ui";

/** Review registrations: activate a proven listing, or suspend one. Needs the operator token. */
export function OperatorConsole() {
  const { token, save } = useOperatorToken();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PublicAgent[] | null>(null);
  const [active, setActive] = useState<PublicAgent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "teal" | "coral";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      api.agents({ status: "suspended" }),
      api.agents({ status: "active" }),
    ]);
    if (p.ok) setPending(p.data.agents);
    if (a.ok) setActive(a.data.agents);
    if (!p.ok || !a.ok)
      setMessage({
        tone: "coral",
        text: p.ok ? (a.ok ? "" : a.error) : p.error,
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(agent: PublicAgent, status: "active" | "suspended") {
    setBusy(agent.id);
    setMessage(null);
    const r = await api.setAgentStatus(token, agent.id, status);
    setBusy(null);
    if (r.ok) {
      setMessage({
        tone: "teal",
        text:
          status === "active"
            ? `${agent.id} is active: control proven again, buyers can now pick it.`
            : `${agent.id} is suspended: it will not be suggested or paid.`,
      });
      load();
    } else
      setMessage({
        tone: "coral",
        text:
          r.status === 401
            ? "The operator token was not accepted."
            : r.status === 403
              ? "This deployment has no API_TOKEN set, so nobody can manage listings."
              : `${agent.id}: ${r.error}`,
      });
  }

  const row = (agent: PublicAgent, action: "active" | "suspended") => (
    <li
      key={agent.id}
      className="memphis-outline-sm flex flex-wrap items-center gap-4 rounded-xl bg-white p-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{agent.name}</span>
          <Pill tone={agent.role === "worker" ? "teal" : "sky"}>
            {agent.role}
          </Pill>
          {agent.builtIn && <Pill tone="cream">built-in</Pill>}
        </div>
        <p className="mt-1 text-[13px] text-[#6b6455]">
          <Mono>{agent.id}</Mono> · {agent.price} · pays{" "}
          <Mono>{agent.payTo}</Mono>
        </p>
        <p className="mt-0.5 text-[13px] text-[#6b6455]">
          <Mono className="text-[12px]">{agent.endpoint}</Mono>
        </p>
      </div>
      <Button
        size="sm"
        tone={action === "active" ? "teal" : "white"}
        disabled={!token || busy !== null}
        onClick={() => setStatus(agent, action)}
      >
        {busy === agent.id ? <Spinner /> : null}
        {action === "active" ? "Activate" : "Suspend"}
      </Button>
    </li>
  );

  return (
    <div className="space-y-8">
      <Card tone="cream" className="p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0" strokeWidth={2.4} />
          <div className="flex-1">
            <p className="font-bold">Operator token</p>
            <p className="text-[14px] text-[#4a4436]">
              The backend&apos;s <Mono>API_TOKEN</Mono>. Kept in this tab only.
            </p>
            {token ? (
              <div className="mt-3 flex items-center gap-3 text-[14px]">
                <span>
                  Using <Mono>{token.slice(0, 6)}…</Mono>
                </span>
                <Button size="sm" tone="white" onClick={() => save("")}>
                  Clear
                </Button>
              </div>
            ) : (
              <form
                className="mt-3 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(draft.trim());
                }}
              >
                <div className="w-full max-w-sm">
                  <Field label="API_TOKEN" htmlFor="op-token">
                    <Input
                      id="op-token"
                      type="password"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <Button type="submit" tone="ink">
                  Use token
                </Button>
              </form>
            )}
          </div>
        </div>
      </Card>

      {message?.text && <Notice tone={message.tone}>{message.text}</Notice>}

      <section>
        <h2 className="font-display text-[24px] font-extrabold">
          Waiting for review
        </h2>
        <p className="mt-1 text-[15px] text-[#4a4436]">
          These proved control at registration. Activating checks the endpoint
          again.
        </p>
        <div className="mt-4">
          {!pending ? (
            <Spinner />
          ) : pending.length === 0 ? (
            <EmptyState title="Nothing to review">
              New registrations from /marketplace/list appear here.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {pending.map((a) => row(a, "active"))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-display text-[24px] font-extrabold">Active</h2>
        <div className="mt-4">
          {!active ? (
            <Spinner />
          ) : (
            <ul className="space-y-3">
              {active.map((a) => row(a, "suspended"))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
