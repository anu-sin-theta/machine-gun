"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A small, honest indicator: is the backend reachable and its Rust core healthy? */
export function BackendStatus() {
  const [state, setState] = useState<"checking" | "up" | "down">("checking");

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const r = await api.health();
      if (!cancelled) setState(r.ok && r.data.ok ? "up" : "down");
    };
    probe();
    const id = setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <span
      className="memphis-outline-sm inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[13px] font-bold"
      title={
        state === "up"
          ? "Backend reachable; Rust/WASM core self-check passed"
          : state === "down"
            ? "Backend not reachable"
            : "Checking backend"
      }
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full border-2 border-[#17140d]",
          state === "up" && "bg-[#12b3a4]",
          state === "down" && "bg-[#ff5b57]",
          state === "checking" && "bg-[#ffc531]",
        )}
      />
      {state === "up"
        ? "Backend online"
        : state === "down"
          ? "Backend offline"
          : "Connecting…"}
    </span>
  );
}
