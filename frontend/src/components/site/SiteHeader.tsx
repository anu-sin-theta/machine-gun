"use client";

import { Menu, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BackendStatus } from "./BackendStatus";

const NAV = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/tasks", label: "Tasks" },
  { href: "/check", label: "Payment check" },
  { href: "/how-it-works", label: "How it works" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-[#17140d] bg-[#f5efe2]/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          onClick={() => setOpen(false)}
        >
          <span className="memphis-outline-sm flex h-9 w-9 items-center justify-center rounded-lg bg-[#ffc531]">
            <ShieldCheck className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="font-display text-[21px] font-extrabold tracking-[-0.02em]">
            Kavach<span className="text-[#12b3a4]">402</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[15px] font-bold transition-colors",
                  active
                    ? "bg-[#17140d] text-[#f5efe2]"
                    : "hover:bg-[#17140d]/[0.07]",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <BackendStatus />
        </div>

        <button
          type="button"
          className="memphis-outline-sm rounded-lg bg-white p-1.5 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <nav
          className="border-t-[3px] border-[#17140d] bg-[#f5efe2] px-5 py-3 md:hidden"
          aria-label="Mobile"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-[16px] font-bold hover:bg-[#17140d]/[0.07]"
            >
              {item.label}
            </Link>
          ))}
          <div className="px-3 pt-2">
            <BackendStatus />
          </div>
        </nav>
      )}
    </header>
  );
}
