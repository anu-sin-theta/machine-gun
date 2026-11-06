"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CIPHER_CHARS = "0123456789abcdefABCDEF#%&*+=-_~";

export interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  className?: string;
  animateOnHover?: boolean;
}

/**
 * React Bits `DecryptedText` (TS-TW):
 * Cycles cipher characters before locking into the target string.
 * Ideal for SHA-256 `actionHash`, `verdictHash`, and 0G TEE request IDs.
 */
export function DecryptedText({
  text,
  speed = 28,
  maxIterations = 12,
  className,
  animateOnHover = true,
}: DecryptedTextProps) {
  const [display, setDisplay] = useState(text);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    let iteration = 0;
    const interval = window.setInterval(() => {
      iteration += 1;
      if (iteration >= maxIterations) {
        setDisplay(text);
        window.clearInterval(interval);
        return;
      }
      setDisplay(
        text
          .split("")
          .map((char, idx) => {
            if (char === " " || char === ":" || char === ".") return char;
            const revealThreshold = Math.floor(
              (iteration / maxIterations) * text.length,
            );
            if (idx <= revealThreshold) return char;
            return (
              CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)] ??
              char
            );
          })
          .join(""),
      );
    }, speed);

    return () => window.clearInterval(interval);
  }, [text, speed, maxIterations, trigger]);

  return (
    <span
      onMouseEnter={() => {
        if (animateOnHover) setTrigger((n) => n + 1);
      }}
      className={cn("inline-block font-mono", className)}
    >
      {display}
    </span>
  );
}
