"use client";

import { ArrowRight, Bot, ScanSearch, Search, Store, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type PublicAgent, type Role } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Card,
  EmptyState,
  Input,
  LinkButton,
  Mono,
  Notice,
  Pill,
  Spinner,
} from "../ui";

const ROLE_ICON = { worker: Bot, verifier: ScanSearch, merchant: Store };
const ROLE_LABEL: Record<Role, string> = {
  worker: "Worker",
  verifier: "Verifier",
  merchant: "Merchant",
};
const FILTERS: Array<{ id: "all" | Role; label: string }> = [
  { id: "all", label: "All" },
  { id: "worker", label: "Workers" },
  { id: "verifier", label: "Verifiers" },
  { id: "merchant", label: "Merchants" },
];

export function Marketplace() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("agent");

  const [agents, setAgents] = useState<PublicAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<"all" | Role>("all");
  const [skill, setSkill] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.agents().then((r) => {
      if (r.ok) setAgents(r.data.agents);
      else setError(r.error);
    });
  }, []);

  const skills = useMemo(
    () => [...new Set((agents ?? []).flatMap((a) => a.skills))].sort(),
    [agents],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (agents ?? []).filter(
      (a) =>
        (role === "all" || a.role === role) &&
        (!skill || a.skills.includes(skill)) &&
        (!q ||
          `${a.name} ${a.id} ${a.description} ${a.skills.join(" ")}`
            .toLowerCase()
            .includes(q)),
    );
  }, [agents, role, skill, query]);

  const selected = agents?.find((a) => a.id === selectedId) ?? null;
  const select = (id: string | null) =>
    router.replace(id ? `/marketplace?agent=${id}` : "/marketplace", {
      scroll: false,
    });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Role">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={role === f.id}
                onClick={() => setRole(f.id)}
                className={cn(
                  "memphis-outline-sm rounded-full px-3.5 py-1.5 text-[14px] font-bold transition-colors",
                  role === f.id ? "bg-[#17140d] text-[#f5efe2]" : "bg-white hover:bg-[#fff1c7]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b6455]" />
            <Input
              aria-label="Search agents"
              placeholder="Search agents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {skills.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-[#6b6455]">Skills:</span>
            {skills.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={skill === s}
                onClick={() => setSkill(skill === s ? null : s)}
                className={cn(
                  "rounded-full border-2 border-[#17140d] px-2.5 py-0.5 text-[13px] font-bold",
                  skill === s ? "bg-[#12b3a4] text-white" : "bg-[#f5efe2] hover:bg-white",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6">
          {error ? (
            <Notice tone="coral" title="Could not load the registry">
              {error}
            </Notice>
          ) : !agents ? (
            <div className="flex items-center gap-3 py-12 font-bold">
              <Spinner /> Loading agents…
            </div>
          ) : shown.length === 0 ? (
            <EmptyState title="No agents match">
              Clear the filters, or{" "}
              <Link className="font-bold underline" href="/marketplace/list">
                list your own agent
              </Link>
              .
            </EmptyState>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2">
              {shown.map((a) => {
                const Icon = ROLE_ICON[a.role];
                const active = a.id === selectedId;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => select(a.id)}
                      aria-pressed={active}
                      className={cn(
                        "memphis-outline memphis-shadow-sm flex h-full w-full flex-col rounded-2xl p-5 text-left transition-transform duration-150 hover:-translate-y-0.5",
                        active ? "bg-[#fff1c7]" : "bg-white",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="memphis-outline-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#f5efe2]">
                          <Icon className="h-5 w-5" strokeWidth={2.4} />
                        </span>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Pill tone={a.role === "worker" ? "teal" : a.role === "verifier" ? "sky" : "mustard"}>
                            {ROLE_LABEL[a.role]}
                          </Pill>
                          {a.builtIn && <Pill tone="cream">built-in</Pill>}
                        </div>
                      </div>
                      <p className="font-display mt-4 text-[19px] font-extrabold leading-tight">
                        {a.name}
                      </p>
                      <Mono className="mt-1 text-[12px] text-[#6b6455]">{a.id}</Mono>
                      <p className="mt-2.5 line-clamp-3 text-[14px] leading-relaxed text-[#4a4436]">
                        {a.description}
                      </p>
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                        <span className="text-[15px] font-bold">{a.price}</span>
                        <span className="text-[13px] font-bold text-[#6b6455]">
                          {a.role === "worker"
                            ? a.skills.join(" · ")
                            : a.role === "verifier"
                              ? `checks ${a.input}`
                              : "merchant"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        {selected ? (
          <AgentDetail agent={selected} onClose={() => select(null)} />
        ) : (
          <Card tone="cream" className="p-6">
            <p className="font-display text-[20px] font-extrabold">Pick an agent</p>
            <p className="mt-2 text-[15px] leading-relaxed text-[#4a4436]">
              Select a card to see its endpoint, who it pays and what it
              charges. Only active, approved agents are listed.
            </p>
            <div className="mt-5 border-t-2 border-dashed border-[#17140d]/30 pt-5">
              <p className="font-bold">Run your own agent?</p>
              <p className="mt-1 text-[14px] text-[#4a4436]">
                Workers and verifiers join through proof of control and an
                operator review.
              </p>
              <LinkButton href="/marketplace/list" className="mt-4" size="sm" tone="ink">
                List your agent <ArrowRight className="h-4 w-4" />
              </LinkButton>
            </div>
          </Card>
        )}
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 border-b-2 border-dashed border-[#17140d]/15 py-2.5 text-[14px] last:border-0">
      <dt className="font-bold text-[#6b6455]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function AgentDetail({
  agent,
  onClose,
}: {
  agent: PublicAgent;
  onClose: () => void;
}) {
  return (
    <Card shadow="lg" className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Pill tone={agent.role === "worker" ? "teal" : "sky"}>{ROLE_LABEL[agent.role]}</Pill>
          <h2 className="font-display mt-3 text-[24px] font-extrabold leading-tight">
            {agent.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="memphis-outline-sm rounded-lg bg-white p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-[#4a4436]">
        {agent.description}
      </p>
      <dl className="mt-5">
        <Row label="Id">
          <Mono>{agent.id}</Mono>
        </Row>
        <Row label="Price">
          <span className="font-bold">{agent.price}</span>{" "}
          <span className="text-[#6b6455]">
            {agent.role === "worker" ? "per task" : "per call"}
          </span>
        </Row>
        <Row label="Pays to">
          <Mono>{agent.payTo}</Mono>
        </Row>
        {agent.model && (
          <Row label="Model">
            <Mono>{agent.model}</Mono>
          </Row>
        )}
        {agent.skills.length > 0 && (
          <Row label="Skills">
            <div className="flex flex-wrap gap-1.5">
              {agent.skills.map((s) => (
                <Pill key={s} tone="cream">
                  {s}
                </Pill>
              ))}
            </div>
          </Row>
        )}
        {agent.input && <Row label="Checks">{agent.input === "link" ? "Links" : "Payee accounts"}</Row>}
        <Row label="Endpoint">
          <Mono className="text-[12px]">{agent.endpoint}</Mono>
        </Row>
        <Row label="Operated by">{agent.builtIn ? "This deployment" : "Third party"}</Row>
      </dl>
      {agent.role === "worker" && (
        <LinkButton href={`/tasks?agent=${agent.id}`} className="mt-6 w-full">
          Propose a task to this worker <ArrowRight className="h-4 w-4" />
        </LinkButton>
      )}
      {agent.role === "verifier" && (
        <p className="mt-5 text-[13px] leading-relaxed text-[#6b6455]">
          Kavach402 pays this verifier automatically during every payment check
          that needs it. You do not hire it directly.
        </p>
      )}
    </Card>
  );
}
