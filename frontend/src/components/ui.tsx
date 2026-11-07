/**
 * The Memphis UI kit: hard outlines, flat offset shadows, one palette. Every
 * page builds from these so spacing, borders and states stay consistent.
 */

import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

type Tone = "coral" | "teal" | "mustard" | "sky" | "white" | "ink";

const TONE_BG: Record<Tone, string> = {
  coral: "bg-[#ff5b57] text-white",
  teal: "bg-[#12b3a4] text-white",
  mustard: "bg-[#ffc531] text-[#17140d]",
  sky: "bg-[#3aa0ff] text-white",
  white: "bg-white text-[#17140d]",
  ink: "bg-[#17140d] text-[#f5efe2]",
};

/** Page-width container with equal gutters. */
export function Wrap({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>
      {children}
    </div>
  );
}

export function Button({
  tone = "coral",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-bold disabled:cursor-not-allowed disabled:opacity-50",
        size === "lg"
          ? "memphis-btn-lg rounded-2xl px-6 py-3.5 text-[16px]"
          : "memphis-btn-sm rounded-xl",
        size === "md" && "px-4 py-2.5 text-[15px]",
        size === "sm" && "px-3 py-1.5 text-[13px]",
        TONE_BG[tone],
        className,
      )}
    />
  );
}

export function LinkButton({
  href,
  tone = "coral",
  size = "md",
  className,
  children,
  external,
}: {
  href: string;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 font-bold",
    size === "lg"
      ? "memphis-btn-lg rounded-2xl px-6 py-3.5 text-[16px]"
      : "memphis-btn-sm rounded-xl",
    size === "md" && "px-4 py-2.5 text-[15px]",
    size === "sm" && "px-3 py-1.5 text-[13px]",
    TONE_BG[tone],
    className,
  );
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

export function Card({
  className,
  children,
  tone = "white",
  shadow = "sm",
}: {
  className?: string;
  children: ReactNode;
  tone?: Tone | "cream";
  shadow?: "sm" | "lg" | "none";
}) {
  return (
    <div
      className={cn(
        "memphis-outline rounded-2xl",
        shadow === "sm" && "memphis-shadow-sm",
        shadow === "lg" && "memphis-shadow-lg",
        tone === "cream" ? "bg-[#f5efe2] text-[#17140d]" : TONE_BG[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({
  tone = "white",
  className,
  children,
}: {
  tone?: Tone | "cream";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "memphis-outline-sm inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-bold",
        tone === "cream" ? "bg-[#f5efe2] text-[#17140d]" : TONE_BG[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Section eyebrow + heading + lead, top-aligned. */
export function SectionHead({
  eyebrow,
  title,
  lead,
  align = "left",
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-[#12b3a4]">
        {eyebrow}
      </p>
      <h2 className="font-display mt-2 text-[34px] font-extrabold leading-[1.08] tracking-[-0.02em] sm:text-[42px]">
        {title}
      </h2>
      {lead && (
        <p className="mt-4 text-[17px] leading-relaxed text-[#4a4436]">{lead}</p>
      )}
    </div>
  );
}

export function Mono({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <code className={cn("font-mono text-[0.92em] break-all", className)}>
      {children}
    </code>
  );
}

const fieldBase =
  "memphis-outline-sm w-full rounded-xl bg-white px-3.5 py-2.5 text-[15px] text-[#17140d] outline-none placeholder:text-[#8a8270] focus:bg-[#fffaf0] focus:ring-4 focus:ring-[#ffc531]/60";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[14px] font-bold">
        {label}
      </label>
      {children}
      {hint && <p className="text-[13px] text-[#6b6455]">{hint}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(fieldBase, "leading-relaxed", props.className)}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldBase, props.className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-[3px] border-current border-r-transparent",
        className,
      )}
    />
  );
}

/** A message box for errors, notes and successes. */
export function Notice({
  tone = "white",
  title,
  children,
  className,
}: {
  tone?: "white" | "coral" | "teal" | "mustard";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const bg = {
    white: "bg-white",
    coral: "bg-[#ffe1df]",
    teal: "bg-[#d8f5f1]",
    mustard: "bg-[#fff1c7]",
  }[tone];
  return (
    <div
      role={tone === "coral" ? "alert" : undefined}
      className={cn(
        "memphis-outline-sm rounded-xl px-4 py-3 text-[14px] leading-relaxed",
        bg,
        className,
      )}
    >
      {title && <p className="font-bold">{title}</p>}
      <div className={cn(title && "mt-0.5")}>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border-[3px] border-dashed border-[#17140d]/40 px-6 py-10 text-center">
      <p className="font-display text-[20px] font-extrabold">{title}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-md text-[15px] text-[#4a4436]">
          {children}
        </div>
      )}
    </div>
  );
}
