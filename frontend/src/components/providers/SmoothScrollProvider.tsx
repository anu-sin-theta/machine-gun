"use client";

import Lenis from "lenis";
import { type ReactNode, useEffect } from "react";
import { ensureGsapRegistered, gsap, ScrollTrigger } from "@/lib/gsap";

export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureGsapRegistered();

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
    });

    lenis.on("scroll", ScrollTrigger.update);

    const update = (time: number) => {
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(update);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
