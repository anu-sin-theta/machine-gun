"use client";

import { ArrowRight, Bot, ScanSearch, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type PublicAgent } from "@/lib/api";
import { Card, Notice, Pill, Spinner } from "../ui";

const ROLE_ICON = { worker: Bot, verifier: ScanSearch, merchant: Store };
const ROLE_CHIP: Record<PublicAgent["role"], string> = {
  worker: "#12b3a4",
  verifier: "#3aa0ff",
  merchant: "#ffc531",
};

/** The real registry, straight from GET /api/agents. */
export function LiveRegistry() {
  const [agents, setAgents] = useState<PublicAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.agents().then((r) => {
      if (r.ok) setAgents(r.data.agents);
      else setError(r.error);
    });
  }, []);

  if (error)
    return (
      <Notice tone="mustard" title="The live registry is not reachable">
        {error} Start the backend (<code className="font-mono">pnpm dev</code>{" "}
        in the repository root) and reload.
      </Notice>
    );
  if (!agents)
    return (
      <div className="flex items-center gap-3 py-10 text-[15px] font-bold">
        <Spinner /> Loading the registry…
      </div>
    );

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {agents.slice(0, 8).map((a) => {
        const Icon = ROLE_ICON[a.role];
        return (
          <Link
            key={a.id}
            href={`/marketplace?agent=${a.id}`}
            className="group"
          >
            <Card className="flex h-full flex-col p-5 transition-transform duration-150 group-hover:-translate-y-1">
              <div className="flex items-start justify-between gap-2">
                <span
                  style={{ backgroundColor: ROLE_CHIP[a.role] }}
                  className="memphis-outline-sm flex h-11 w-11 items-center justify-center rounded-xl text-white"
                >
                  <Icon className="h-5 w-5" strokeWidth={2.4} />
                </span>
                <Pill tone={a.role === "worker" ? "teal" : "sky"}>
                  {a.role}
                </Pill>
              </div>
              <p className="font-display mt-4 text-[19px] font-extrabold leading-tight">
                {a.name}
              </p>
              <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-[#4a4436]">
                {a.description}
              </p>
              <div className="mt-auto flex items-center justify-between border-t-2 border-dashed border-[#17140d]/15 pt-3.5 text-[14px] font-bold">
                <span>{a.price}</span>
                <span className="inline-flex items-center gap-1 text-[#ff5b57]">
                  Inspect{" "}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
