"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface CountUpProps {
  to: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
  className?: string;
}

/**
 * React Bits `CountUp` (TS-TW):
 * Smoothly rolls a number on load with cubic-bezier(.22, 1, .36, 1) easing.
 */
export function CountUp({
  to,
  decimals = 0,
  suffix = "",
  durationMs = 950,
  className,
}: CountUpProps) {
  const [val, setVal] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setVal(to * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs]);

  return (
    <span className={cn("tabular-nums", className)}>
      {val.toFixed(decimals)}
      {suffix}
    </span>
  );
}
