"use client";

import { type MouseEvent, type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
  interactive?: boolean;
  onClick?: () => void;
}

/**
 * React Bits `SpotlightCard` + TasteSkill 2.5 Card Rules:
 * - Surface `#121316` one step off `#070708` ground
 * - 1px border (`white/10`) + 1px inner top highlight (`white/6`)
 * - 2px hover lift (`-translate-y-0.5`) on interactive cards (`--m-in: 140ms`)
 * - Soft radial spotlight tracking pointer coordinates
 */
export function SpotlightCard({
  children,
  className,
  spotlightColor = "rgba(16, 185, 129, 0.13)",
  interactive = false,
  onClick,
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={cn(
        "relative overflow-hidden rounded-[20px] border border-white/[0.09] bg-[#121316] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-[transform,border-color] duration-[140ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        interactive &&
          "cursor-pointer hover:-translate-y-0.5 hover:border-white/[0.18]",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(460px circle at ${pos.x}px ${pos.y}px, ${spotlightColor}, transparent 45%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
