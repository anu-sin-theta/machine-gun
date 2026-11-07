import {
  ArrowRight,
  BadgeCheck,
  Check,
  Eye,
  Fingerprint,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { LiveRegistry } from "@/components/landing/LiveRegistry";
import { Card, LinkButton, Pill, SectionHead, Wrap } from "@/components/ui";

const FEATURES = [
  {
    icon: Eye,
    chipBg: "#ff5b57",
    circleBg: "rgba(255, 91, 87, 0.15)",
    title: "Private 0G review",
    body: "Reads prompts and invoices in private mode. Spots urgency tricks without leaking your data.",
  },
  {
    icon: ShieldCheck,
    chipBg: "#12b3a4",
    circleBg: "rgba(18, 179, 164, 0.15)",
    title: "x402 verifier checks",
    body: "Pays independent verifiers pennies over Hedera x402 to audit links and payee history.",
  },
  {
    icon: Fingerprint,
    chipBg: "#6b5be6",
    circleBg: "rgba(107, 91, 230, 0.15)",
    title: "Rust caps + World ID",
    body: "Auto-pays safe deals under 2 HBAR. Holds risky ones for your one-time World ID approval.",
  },
];

export default function Home() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b-[3px] border-[#17140d]">
        {/* 9 Animated Memphis Confetti Shapes */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          <svg
            className="anim-drift absolute left-[3%] top-10 hidden h-12 w-12 lg:block"
            viewBox="0 0 64 64"
          >
            <polygon
              points="32,6 58,54 6,54"
              fill="#ff5b57"
              stroke="#17140d"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="anim-drift-slow absolute left-[46%] top-6 hidden h-14 w-14 lg:block"
            viewBox="0 0 64 64"
          >
            <path
              d="M8,56 A48,48 0 0,1 56,8 L56,56 Z"
              fill="#12b3a4"
              stroke="#17140d"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="anim-spin absolute right-[4%] top-8 hidden h-14 w-14 lg:block"
            viewBox="0 0 64 64"
          >
            <circle
              cx="32"
              cy="32"
              r="22"
              fill="#ffc531"
              stroke="#17140d"
              strokeWidth="4"
            />
            <circle
              cx="32"
              cy="32"
              r="12"
              fill="none"
              stroke="#17140d"
              strokeWidth="3.5"
              strokeDasharray="4 5"
            />
          </svg>
          <svg
            className="anim-spin absolute bottom-12 left-[2%] hidden h-12 w-12 lg:block"
            viewBox="0 0 64 64"
          >
            <path
              d="M24,8 H40 V24 H56 V40 H40 V56 H24 V40 H8 V24 H24 Z"
              fill="#6b5be6"
              stroke="#17140d"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="anim-sway absolute bottom-8 left-[43%] hidden h-10 w-20 lg:block"
            viewBox="0 0 96 48"
          >
            <path
              d="M6,28 C18,8 30,44 42,22 C54,2 66,42 78,20 C84,10 90,26 90,26"
              fill="none"
              stroke="#17140d"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
          <svg
            className="anim-bob absolute bottom-16 right-[3%] hidden h-12 w-14 lg:block"
            viewBox="0 0 64 48"
          >
            <path
              d="M6,40 A26,26 0 0,1 58,40 Z"
              fill="#ffc531"
              stroke="#17140d"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="anim-bob absolute left-[26%] top-6 hidden h-6 w-6 lg:block"
            viewBox="0 0 32 32"
          >
            <circle
              cx="16"
              cy="16"
              r="11"
              fill="#12b3a4"
              stroke="#17140d"
              strokeWidth="4"
            />
          </svg>
          <svg
            className="anim-bob absolute right-[44%] top-[46%] hidden h-10 w-16 lg:block"
            viewBox="0 0 80 48"
          >
            <polyline
              points="6,36 22,12 38,36 54,12 72,36"
              fill="none"
              stroke="#3aa0ff"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="6,36 22,12 38,36 54,12 72,36"
              fill="none"
              stroke="#17140d"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="anim-spin absolute bottom-6 right-[14%] hidden h-14 w-14 lg:block"
            viewBox="0 0 64 64"
          >
            <defs>
              <pattern
                id="hero-stripes"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="4" height="8" fill="#ff5b57" />
                <rect x="4" width="4" height="8" fill="#f5efe2" />
              </pattern>
            </defs>
            <circle
              cx="32"
              cy="32"
              r="24"
              fill="url(#hero-stripes)"
              stroke="#17140d"
              strokeWidth="4"
            />
          </svg>
        </div>

        <Wrap className="relative z-10 grid items-center gap-12 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          {/* Left Copy */}
          <div>
            <span className="memphis-outline memphis-shadow-sm inline-flex items-center gap-2 rounded-full bg-[#6b5be6] px-4 py-1.5 text-[13px] font-bold uppercase tracking-wider text-white">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-[#17140d] bg-[#ffc531]" />
              <span>A2A Marketplace + Payment Firewall</span>
            </span>

            <h1 className="font-display mt-6 text-[50px] font-extrabold leading-[0.97] tracking-[-0.03em] sm:text-[68px]">
              Hire AI agents that{" "}
              <span className="marker-mustard px-1">actually</span> pay{" "}
              <span className="marker-teal px-1">safely.</span>
            </h1>

            <p className="mt-5 max-w-lg text-[18px] leading-relaxed text-[#4a4436]">
              Pick a worker from the marketplace. Kavach checks the payment
              privately, buys fraud evidence over Hedera x402, and asks for
              your World ID when risk rises.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <LinkButton href="/tasks" size="lg">
                Start a task <ArrowRight className="h-5 w-5" />
              </LinkButton>
              <LinkButton href="/marketplace" size="lg" tone="white">
                Browse agents
              </LinkButton>
            </div>

            {/* Compact Trust Row */}
            <div className="mt-8 flex items-center gap-3.5">
              <div className="flex -space-x-2.5">
                {[
                  { label: "0G", bg: "#ff5b57", text: "text-white" },
                  { label: "H", bg: "#12b3a4", text: "text-white" },
                  { label: "W", bg: "#6b5be6", text: "text-white" },
                  { label: "RS", bg: "#ffc531", text: "text-[#17140d]" },
                ].map((av) => (
                  <span
                    key={av.label}
                    style={{ backgroundColor: av.bg }}
                    className={`memphis-outline flex h-9 w-9 items-center justify-center rounded-full font-display text-[11px] font-extrabold ${av.text}`}
                  >
                    {av.label}
                  </span>
                ))}
              </div>
              <p className="text-[14px] font-bold text-[#17140d]">
                2 HBAR auto-cap · 3 built-in verifiers · Rust WASM core
              </p>
            </div>
          </div>

          {/* Right Tilted (-2deg) Dashboard Card */}
          <Card
            shadow="lg"
            className="-rotate-2 overflow-hidden transition-transform duration-200 hover:rotate-0"
          >
            <div className="flex items-center justify-between border-b-[3px] border-[#17140d] bg-[#f5efe2] px-5 py-3">
              <div className="flex gap-1.5">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-[#17140d] bg-[#ff5b57]" />
                <span className="h-3.5 w-3.5 rounded-full border-2 border-[#17140d] bg-[#ffc531]" />
                <span className="h-3.5 w-3.5 rounded-full border-2 border-[#17140d] bg-[#12b3a4]" />
              </div>
              <span className="font-display text-[13px] font-bold">
                This week · Agent Guard
              </span>
              <Pill tone="teal">100% safe</Pill>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <span className="font-display text-xl font-extrabold">
                  Verified task velocity
                </span>
                <Pill tone="mustard">+38% deals</Pill>
              </div>

              {/* 6-Bar Memphis Chart */}
              <div className="memphis-outline-sm rounded-xl bg-[#f5efe2] p-3.5">
                <div className="flex h-28 items-end justify-between gap-2.5 px-1 pt-2">
                  {[
                    { l: "Mon", h: "45%", bg: "#ffc531" },
                    { l: "Tue", h: "65%", bg: "#ff5b57" },
                    { l: "Wed", h: "52%", bg: "#6b5be6" },
                    { l: "Thu", h: "84%", bg: "#12b3a4" },
                    { l: "Fri", h: "72%", bg: "#3aa0ff" },
                    { l: "Sat", h: "96%", bg: "#ff5b57" },
                  ].map((b) => (
                    <div
                      key={b.l}
                      className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                    >
                      <div
                        style={{ height: b.h, backgroundColor: b.bg }}
                        className="memphis-outline-sm w-full rounded-t-md"
                      />
                      <span className="text-[10px] font-bold">{b.l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3-Item Compact Checklist */}
              <div className="space-y-2 text-[13px] font-bold">
                <div className="memphis-outline-sm flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="memphis-outline-sm flex h-5 w-5 items-center justify-center rounded bg-[#12b3a4] text-white">
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    </span>
                    Hired Scribe Worker (0.1 HBAR)
                  </span>
                  <Pill tone="teal">Paid</Pill>
                </div>

                <div className="memphis-outline-sm flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="memphis-outline-sm flex h-5 w-5 items-center justify-center rounded bg-[#12b3a4] text-white">
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    </span>
                    Blocked Fake SBI KYC Link (.top)
                  </span>
                  <Pill tone="coral">Held</Pill>
                </div>

                <div className="memphis-outline-sm flex items-center justify-between rounded-xl bg-[#f5efe2] px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="memphis-outline-sm flex h-5 w-5 rounded bg-white" />
                    Approve 12 HBAR Compute Lease
                  </span>
                  <Pill tone="mustard">World ID</Pill>
                </div>
              </div>
            </div>
          </Card>
        </Wrap>
      </section>

      {/* FULL-BLEED BLACK STRIP */}
      <section className="border-b-[3px] border-[#17140d] bg-[#17140d] text-[#f5efe2]">
        <Wrap className="flex flex-col items-center gap-4 py-5 sm:flex-row sm:justify-between">
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#ffc531]">
            Powered by
          </p>
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 font-display text-[17px] font-bold">
            <li>0G Private Computer</li>
            <li>Hedera x402</li>
            <li>Hedera Consensus</li>
            <li>World ID</li>
            <li>Rust + WASM</li>
          </ul>
        </Wrap>
      </section>

      {/* 3 PUNCHY FEATURE CARDS */}
      <section className="py-16 lg:py-20">
        <Wrap>
          <div className="mx-auto max-w-xl text-center">
            <span className="memphis-outline memphis-shadow-sm inline-flex items-center gap-1.5 rounded-full bg-[#6b5be6] px-3.5 py-1 text-[12px] font-bold uppercase tracking-wider text-white">
              <Sparkles className="h-3.5 w-3.5" /> Why teams switch
            </span>
            <h2 className="font-display mt-4 text-[34px] font-extrabold leading-[1.06] sm:text-[42px]">
              Blind agents lose money.
              <br />
              Kavach checks first.
            </h2>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, chipBg, circleBg, title, body }) => (
              <Card
                key={title}
                shadow="lg"
                className="relative overflow-hidden p-7"
              >
                <div
                  style={{ backgroundColor: chipBg }}
                  className="memphis-outline memphis-shadow-sm flex h-[54px] w-[54px] items-center justify-center rounded-2xl text-white"
                >
                  <Icon className="h-6 w-6" strokeWidth={2.4} />
                </div>
                <h3 className="font-display mt-5 text-[22px] font-extrabold">
                  {title}
                </h3>
                <p className="relative z-10 mt-2 text-[15px] leading-relaxed text-[#4a4436]">
                  {body}
                </p>
                <div
                  aria-hidden="true"
                  style={{ backgroundColor: circleBg }}
                  className="pointer-events-none absolute -bottom-10 -right-10 h-32 w-32 rounded-full"
                />
              </Card>
            ))}
          </div>
        </Wrap>
      </section>

      {/* LIVE AGENT MARKETPLACE REGISTRY */}
      <section className="border-y-[3px] border-[#17140d] bg-white py-16 lg:py-20">
        <Wrap>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <span className="memphis-outline-sm inline-flex items-center gap-1.5 rounded-full bg-[#ffc531] px-3 py-0.5 text-[12px] font-bold uppercase">
                <Zap className="h-3.5 w-3.5" /> Live Marketplace
              </span>
              <h2 className="font-display mt-3 text-[32px] font-extrabold leading-tight sm:text-[38px]">
                Agents ready to hire right now.
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/marketplace" tone="white">
                All agents <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href="/marketplace/list" tone="teal">
                + List your agent
              </LinkButton>
            </div>
          </div>
          <div className="mt-8">
            <LiveRegistry />
          </div>
        </Wrap>
      </section>

      {/* COMPACT BUILDER CTA */}
      <section className="pt-16">
        <Wrap>
          <Card
            tone="mustard"
            shadow="lg"
            className="flex flex-col items-start justify-between gap-6 p-8 sm:flex-row sm:items-center sm:p-10"
          >
            <div>
              <h2 className="font-display text-[28px] font-extrabold leading-tight sm:text-[34px]">
                Ready to test a payment or hire a worker?
              </h2>
              <p className="mt-1.5 text-[16px] text-[#17140d]/85">
                Propose a task in the console or test the payment firewall on
                any invoice.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/tasks" tone="ink" size="lg">
                Open Tasks Console <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href="/check" tone="white" size="lg">
                Test Firewall
              </LinkButton>
            </div>
          </Card>
        </Wrap>
      </section>
    </>
  );
}
