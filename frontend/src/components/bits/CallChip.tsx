"use client";

import { Check, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CallChipProps {
  label: string;
  cost?: string;
  status: "idle" | "running" | "ok" | "warn" | "blocked";
  durationMs?: number;
  className?: string;
}

/**
 * React Bits Micro `CallChip`:
 * Tool-call pill whose fill wipes across as a timer ticks, ending emerald or crimson.
 */
export function CallChip({
  label,
  cost,
  status,
  durationMs,
  className,
}: CallChipProps) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-3 py-1 font-mono text-xs transition-colors duration-200",
        status === "idle" &&
          "border-white/10 bg-[#17191D] text-[#7C8494]",
        status === "running" &&
          "border-sky-500/40 bg-sky-500/10 text-sky-200",
        status === "ok" &&
          "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
        status === "warn" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-200",
        status === "blocked" &&
          "border-rose-500/45 bg-rose-500/15 text-rose-200",
        className,
      )}
    >
      {status === "running" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
      ) : status === "ok" ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : status === "warn" || status === "blocked" ? (
        <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-[#7C8494]" />
      )}

      <span className="font-medium">{label}</span>

      {cost ? (
        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#D6DAE1]">
          {cost}
        </span>
      ) : null}

      {durationMs !== undefined ? (
        <span className="text-[10px] text-[#7C8494]">{durationMs}ms</span>
      ) : null}
    </div>
  );
}
