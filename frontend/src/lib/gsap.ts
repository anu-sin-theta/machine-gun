"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TextPlugin } from "gsap/TextPlugin";

let registered = false;

export function ensureGsapRegistered(): void {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(useGSAP, ScrollTrigger, TextPlugin, Flip);
  registered = true;
}

export { Flip, gsap, ScrollTrigger, TextPlugin, useGSAP };
