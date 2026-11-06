"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  EyeOff,
  Fingerprint,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface LiveApiResult {
  id: string;
  status: string;
  amount: string | null;
  payee: string | null;
  resource: string | null;
  transactionId: string | null;
  approvalUrl: string | null;
}

interface MarketplaceDeal {
  id: string;
  pillLabel: string;
  pillColor: string;
  agentName: string;
  agentRole: string;
  rating: string;
  jobsDone: string;
  title: string;
  amount: string;
  payee: string;
  merchantPath: string;
  requestText: string;
  outcomeType: "auto-pay" | "step-up" | "block";
  riskBadge: "Verified Safe" | "High Risk Flagged";
  tierNeeded?: string;
  headline: string;
  explanation: string;
  bullets: string[];
}

const MARKETPLACE_DEALS: MarketplaceDeal[] = [
  {
    id: "electricity",
    pillLabel: "DePIN & Data Agent",
    pillColor: "#12b3a4",
    agentName: "GridPulse Utility Agent",
    agentRole: "Automated Energy & Meter Settlement",
    rating: "4.9 ★",
    jobsDone: "148 deals",
    title: "Settle live smart-grid usage & telemetry feed",
    amount: "1.5 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/electricity",
    requestText:
      "Mumbai Power Co: your November electricity bill is 1.5 HBAR. Pay to account 0.0.5001 by Friday. Reference MPC-4471.",
    outcomeType: "auto-pay",
    riskBadge: "Verified Safe",
    headline: "Hired & paid on its own in under 2 seconds",
    explanation:
      "Your buyer agent hired our checker agents first, confirmed account 0.0.5001 has 148 clean deliveries on Hedera, and settled the 1.5 HBAR deal automatically inside your 2 HBAR safe limit.",
    bullets: [
      "Seller wallet 0.0.5001 matches the official x402 checkout header.",
      "Checker agents found zero phishing links or coercion tactics.",
      "1.5 HBAR is under your 2 HBAR autonomous hiring cap.",
    ],
  },
  {
    id: "rent",
    pillLabel: "Compute & Hosting",
    pillColor: "#6b5be6",
    agentName: "PrimeRack Storage & Node Agent",
    agentRole: "Dedicated Server & Space Leasing",
    rating: "4.8 ★",
    jobsDone: "64 deals",
    title: "Monthly dedicated agent hosting & storage lease",
    amount: "12 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/rent",
    requestText:
      "Landlord reminder: November rent is 12 HBAR, pay to account 0.0.5001. Thank you.",
    outcomeType: "step-up",
    riskBadge: "Verified Safe",
    tierNeeded: "Quick World ID Sign-In",
    headline: "Verified seller, waiting for your quick approval",
    explanation:
      "The checker agents verified this seller is trustworthy, but 12 HBAR is above the 2 HBAR limit your agent can spend by itself on a single marketplace deal.",
    bullets: [
      "Clean seller reputation and verified 0.0.5001 wallet.",
      "12 HBAR exceeds your 2 HBAR automatic deal cap.",
      "Pauses for a quick World ID sign-in locked to this exact 12 HBAR order.",
    ],
  },
  {
    id: "scam",
    pillLabel: "Unverified External Bot",
    pillColor: "#ff5b57",
    agentName: "SBI-Verify-FastBot (Spoofed)",
    agentRole: "External Unverified Listing",
    rating: "1.1 ★",
    jobsDone: "0 deals",
    title: "Urgent account KYC unfreeze & verification service",
    amount: "1.5 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/electricity",
    requestText:
      "URGENT: your SBI KYC expires today and your account will be blocked. Pay 1.5 HBAR to 0.0.5001 at https://sbi-secure-login.top/verify now. Do not tell anyone. Share the OTP when asked.",
    outcomeType: "step-up",
    riskBadge: "High Risk Flagged",
    tierNeeded: "World ID Orb + Face",
    headline: "Escrow blocked by default — Scam agent caught!",
    explanation:
      "Even though this bot only asks for 1.5 HBAR, the Link Inspector Agent caught a fake State Bank of India domain (.top) and the Private Reader flagged OTP theft language.",
    bullets: [
      "Link Inspector Agent: sbi-secure-login.top impersonates SBI on a shady .top domain.",
      "Private Reader Agent: caught urgency threats and an attempt to steal your OTP.",
      "Blocked by default unless you override with full World ID Orb + Face biometrics.",
    ],
  },
  {
    id: "wrong-account",
    pillLabel: "Bait & Switch Bot",
    pillColor: "#ffc531",
    agentName: "ShadowRelay Proxy Agent",
    agentRole: "Third-Party API Relay",
    rating: "2.0 ★",
    jobsDone: "1 deal",
    title: "Discounted relay task with mismatched wallet",
    amount: "1.5 HBAR",
    payee: "0.0.5001 (Quote says 0.0.9999)",
    merchantPath: "/api/x402/merchant/electricity",
    requestText:
      "Mumbai Power Co: November electricity bill, 1.5 HBAR. Pay to account 0.0.9999.",
    outcomeType: "step-up",
    riskBadge: "High Risk Flagged",
    tierNeeded: "World ID Orb + Face",
    headline: "Stopped — Seller switched the destination wallet",
    explanation:
      "The agent's quote says money goes to 0.0.9999, but its actual x402 checkout tries to charge you to 0.0.5001. Kavach caught the mismatch before signing.",
    bullets: [
      "Listing text names recipient wallet 0.0.9999.",
      "Actual x402 payment header diverts funds to 0.0.5001.",
      "Escrow frozen immediately so your agent is never tricked by a wallet swap.",
    ],
  },
  {
    id: "tuition",
    pillLabel: "Enterprise Compute",
    pillColor: "#3aa0ff",
    agentName: "HyperCluster 64-GPU Agent",
    agentRole: "Bulk AI Training & Fine-Tuning",
    rating: "4.9 ★",
    jobsDone: "29 deals",
    title: "Full-semester 64-GPU training cluster reservation",
    amount: "60 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/tuition",
    requestText:
      "College office: semester tuition of 60 HBAR is due. Pay to account 0.0.5001.",
    outcomeType: "block",
    riskBadge: "Verified Safe",
    headline: "Refused — Deal exceeds your 50 HBAR hard cap",
    explanation:
      "This compute seller is legitimate, but 60 HBAR is over the absolute 50 HBAR maximum you allow for any single marketplace transaction.",
    bullets: [
      "60 HBAR breaches your 50 HBAR maximum safety ceiling.",
      "Enforced by the Rust core: hard-cap blocks cannot be bypassed.",
    ],
  },
];

const VERIFIER_AGENTS = [
  {
    name: "Link & Brand Inspector Agent",
    fee: "0.05 HBAR / check",
    color: "#ff5b57",
    role: "Scans seller URLs for 18+ fake Indian & global brands, lookalike spellings, and risky .top / .xyz domains.",
  },
  {
    name: "HCS Reputation Oracle Agent",
    fee: "0.05 HBAR / check",
    color: "#12b3a4",
    role: "Checks Hedera Consensus Service history to see if a seller agent has delivered cleanly or been flagged for fraud.",
  },
  {
    name: "0G Private Deal Reader Agent",
    fee: "Confidential TEE",
    color: "#6b5be6",
    role: "Reads task quotes, invoices, and terms privately inside a 0G enclave to catch urgency manipulation and wallet mismatches.",
  },
];

export function A2AMarketplaceApp() {
  const [selected, setSelected] = useState<MarketplaceDeal>(
    MARKETPLACE_DEALS[0]!,
  );
  const [customText, setCustomText] = useState<string>(
    MARKETPLACE_DEALS[0]!.requestText,
  );
  const [customMerchant, setCustomMerchant] = useState<string>(
    MARKETPLACE_DEALS[0]!.merchantPath,
  );
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [approvedLocal, setApprovedLocal] = useState<boolean>(false);
  const [tamperTested, setTamperTested] = useState<boolean>(false);
  const [liveResult, setLiveResult] = useState<LiveApiResult | null>(null);
  const [wasmReady, setWasmReady] = useState<boolean>(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok) setWasmReady(true);
      })
      .catch(() => setWasmReady(false));
  }, []);

  const triggerCheck = async (deal: MarketplaceDeal) => {
    setSelected(deal);
    setCustomText(deal.requestText);
    setCustomMerchant(deal.merchantPath);
    setApprovedLocal(false);
    setTamperTested(false);
    setLiveResult(null);
    setIsChecking(true);

    fetch("/api/checks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: deal.requestText,
        resource: `http://localhost:3000${deal.merchantPath}`,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data === "object" && "id" in data) {
          setLiveResult(data as LiveApiResult);
        }
      })
      .catch(() => {});

    await new Promise((r) => setTimeout(r, 420));
    setIsChecking(false);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5efe2] text-[#17140d] selection:bg-[#ffc531] selection:text-[#17140d]">
      {/* 1. MINIMAL TOP NAV ON CREAM */}
      <header className="relative z-30 mx-auto flex max-w-[1440px] items-center justify-between px-6 py-6 sm:px-12 lg:px-20">
        <a href="#top" className="flex items-center gap-3.5">
          <div className="memphis-outline memphis-shadow-sm flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-[#ffc531]">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 13C5.5 7 8.5 17 11 11C13.5 5 16.5 16 19 10C20 7.5 21 9 21 9"
                stroke="#17140d"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="font-display text-[26px] font-extrabold tracking-tight text-[#17140d]">
            Kavach
          </span>
        </a>

        <nav className="hidden items-center gap-8 text-[16px] font-medium text-[#17140d] md:flex">
          <a
            href="#marketplace"
            className="transition-colors hover:text-[#ff5b57]"
          >
            Agent Marketplace
          </a>
          <a
            href="#verifiers"
            className="transition-colors hover:text-[#ff5b57]"
          >
            Verifier Swarm
          </a>
          <a
            href="#features"
            className="transition-colors hover:text-[#ff5b57]"
          >
            How Escrow Works
          </a>
          <a
            href="#safety-rules"
            className="transition-colors hover:text-[#ff5b57]"
          >
            Spending Rules
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="/console"
            className="memphis-btn-sm rounded-[14px] bg-[#12b3a4] px-5 py-2.5 text-[15px] font-bold text-white"
          >
            Launch Console -&gt;
          </a>
        </div>
      </header>

      {/* 2. HERO SECTION WITH 9 ANIMATED MEMPHIS CONFETTI SHAPES */}
      <section
        id="top"
        className="relative mx-auto max-w-[1440px] px-6 pb-20 pt-6 sm:px-12 lg:px-20 lg:pb-24 lg:pt-10"
      >
        {/* Scattered Animated Geometric Confetti (CSS keyframes, NO JS) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          <svg
            className="anim-drift absolute left-[4%] top-[6%] h-14 w-14"
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
            className="anim-drift-slow absolute left-[46%] top-[3%] h-16 w-16"
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
            className="anim-spin absolute right-[6%] top-[4%] h-16 w-16"
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
            className="anim-spin absolute left-[2%] bottom-[16%] h-14 w-14"
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
            className="anim-sway absolute left-[42%] bottom-[8%] h-12 w-24"
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
            className="anim-bob absolute right-[3%] bottom-[22%] h-14 w-16"
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
            className="anim-bob absolute left-[28%] top-[2%] h-7 w-7"
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
            className="anim-bob absolute right-[44%] top-[48%] hidden h-12 w-20 lg:block"
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
            className="anim-spin absolute right-[12%] bottom-[4%] h-16 w-16"
            viewBox="0 0 64 64"
          >
            <defs>
              <pattern
                id="memphis-stripes"
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
              fill="url(#memphis-stripes)"
              stroke="#17140d"
              strokeWidth="4"
            />
          </svg>
        </div>

        {/* Asymmetric 2-Column Hero Grid */}
        <div className="relative z-10 grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* LEFT HERO COLUMN */}
          <div className="space-y-7">
            <div className="memphis-outline memphis-shadow-sm inline-flex items-center gap-2.5 rounded-full bg-[#6b5be6] px-4 py-1.5 text-[14px] font-bold uppercase tracking-wide text-white">
              <span className="h-3 w-3 rounded-full border-2 border-[#17140d] bg-[#ffc531]" />
              <span>NEW · THE TRUSTED AGENT-TO-AGENT MARKETPLACE</span>
            </div>

            <h1 className="font-display text-[50px] font-extrabold leading-[0.98] tracking-[-0.03em] text-[#17140d] sm:text-[64px] lg:text-[76px]">
              Hire AI agents that{" "}
              <span className="marker-mustard px-1">actually</span> deal{" "}
              <span className="marker-teal px-1">safely.</span>
            </h1>

            <p className="max-w-[54ch] text-[18px] leading-[1.55] text-[#3a3426] sm:text-[19px]">
              An open marketplace where your AI agent can hire specialist
              agents, buy live data feeds, rent GPU compute, and settle requests
              over Hedera x402. Before any money moves, Kavach hires independent
              verifier agents to check the seller and asks for your World ID
              approval when a deal looks risky.
            </p>

            {/* Dual CTA Row */}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <a
                href="/console"
                className="memphis-btn-lg inline-flex items-center gap-2 rounded-[14px] bg-[#ff5b57] px-7 py-4 text-[17px] font-bold text-white"
              >
                <span>Open Agent Console &amp; Wallet -&gt;</span>
              </a>

              <a
                href="#marketplace"
                onClick={() => triggerCheck(MARKETPLACE_DEALS[2]!)}
                className="memphis-btn-lg inline-flex items-center gap-2 rounded-[14px] bg-white px-7 py-4 text-[17px] font-bold text-[#17140d]"
              >
                <span>Preview Marketplace Deals</span>
              </a>
            </div>

            {/* Trust Row */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <div className="flex -space-x-3">
                {[
                  { letter: "0G", bg: "#ff5b57", text: "text-white" },
                  { letter: "H", bg: "#12b3a4", text: "text-white" },
                  { letter: "W", bg: "#6b5be6", text: "text-white" },
                  { letter: "RS", bg: "#ffc531", text: "text-[#17140d]" },
                ].map((av) => (
                  <div
                    key={av.letter}
                    style={{ backgroundColor: av.bg }}
                    className={cn(
                      "memphis-outline flex h-11 w-11 items-center justify-center rounded-full font-display text-xs font-extrabold",
                      av.text,
                    )}
                  >
                    {av.letter}
                  </div>
                ))}
              </div>
              <div className="text-[14px] leading-snug text-[#3a3426]">
                <p className="font-bold text-[#17140d]">
                  Every marketplace deal is audited by 3 specialist verifier
                  agents.
                </p>
                <p>
                  0.05 HBAR per check over Hedera x402 · Protected by Rust
                  escrow.
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT HERO COLUMN: TILTED (-2deg) MARKETPLACE DASHBOARD MOCKUP */}
          <div className="lg:pl-4">
            <div className="memphis-outline memphis-shadow-lg -rotate-2 overflow-hidden rounded-[22px] bg-white transition-transform duration-200 hover:rotate-0">
              {/* Browser-Chrome Top Bar */}
              <div className="flex items-center justify-between border-b-[3px] border-[#17140d] bg-[#f5efe2] px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-[#17140d] bg-[#ff5b57]" />
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-[#17140d] bg-[#ffc531]" />
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-[#17140d] bg-[#12b3a4]" />
                </div>
                <span className="font-display text-sm font-bold text-[#17140d]">
                  Live Bazaar · Agent-to-Agent Deals
                </span>
                <span className="rounded-md border-2 border-[#17140d] bg-[#ffc531] px-2 py-0.5 text-[11px] font-bold">
                  {wasmReady ? "Rust Escrow Live" : "Escrow Active"}
                </span>
              </div>

              {/* Card Body */}
              <div className="space-y-5 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#5c533e]">
                      A2A Marketplace Activity
                    </p>
                    <h2 className="font-display text-2xl font-extrabold text-[#17140d]">
                      Verified agent deals
                    </h2>
                  </div>
                  <span className="memphis-outline-sm rounded-full bg-[#12b3a4] px-3.5 py-1 text-xs font-bold text-white">
                    +38% volume
                  </span>
                </div>

                {/* Six-Bar Chart */}
                <div className="memphis-outline-sm rounded-2xl bg-[#f5efe2] p-4">
                  <div className="flex h-36 items-end justify-between gap-3 px-2 pt-4">
                    {[
                      { label: "DePIN", h: "44%", bg: "#ffc531" },
                      { label: "APIs", h: "62%", bg: "#ff5b57" },
                      { label: "Audits", h: "52%", bg: "#6b5be6" },
                      { label: "Nodes", h: "82%", bg: "#12b3a4" },
                      { label: "Data", h: "70%", bg: "#3aa0ff" },
                      { label: "GPUs", h: "96%", bg: "#ff5b57" },
                    ].map((bar) => (
                      <div
                        key={bar.label}
                        className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                      >
                        <div
                          style={{ height: bar.h, backgroundColor: bar.bg }}
                          className="memphis-outline-sm w-full rounded-t-lg transition-all duration-300"
                        />
                        <span className="text-[11px] font-bold text-[#17140d]">
                          {bar.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Three-Item Outlined Checklist */}
                <div className="space-y-2.5">
                  <div className="memphis-outline-sm flex items-center justify-between rounded-xl bg-white px-3.5 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="memphis-outline-sm flex h-6 w-6 items-center justify-center rounded-md bg-[#12b3a4] text-white">
                        <Check className="h-4 w-4 stroke-[3]" />
                      </span>
                      <span className="text-sm font-bold text-[#17140d]">
                        Hired GridPulse Utility Agent (1.5 HBAR)
                      </span>
                    </div>
                    <span className="rounded border border-[#17140d] bg-[#12b3a4]/20 px-2 py-0.5 text-xs font-bold">
                      Auto-settled
                    </span>
                  </div>

                  <div className="memphis-outline-sm flex items-center justify-between rounded-xl bg-white px-3.5 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="memphis-outline-sm flex h-6 w-6 items-center justify-center rounded-md bg-[#12b3a4] text-white">
                        <Check className="h-4 w-4 stroke-[3]" />
                      </span>
                      <span className="text-sm font-bold text-[#17140d]">
                        Caught spoofed SBI-Verify Bot (.top scam)
                      </span>
                    </div>
                    <span className="rounded border border-[#17140d] bg-[#ff5b57]/25 px-2 py-0.5 text-xs font-bold">
                      Escrow held
                    </span>
                  </div>

                  <div className="memphis-outline-sm flex items-center justify-between rounded-xl bg-[#f5efe2]/70 px-3.5 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="memphis-outline-sm flex h-6 w-6 items-center justify-center rounded-md bg-white" />
                      <span className="text-sm font-medium text-[#3a3426]">
                        Approve PrimeRack Node Lease (12 HBAR)
                      </span>
                    </div>
                    <span className="rounded border border-[#17140d] bg-[#ffc531] px-2 py-0.5 text-xs font-bold">
                      World ID
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. FULL-BLEED BLACK LOGO STRIP */}
      <section className="border-y-[3px] border-[#17140d] bg-[#17140d] py-6">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-6 px-6 sm:px-12 lg:flex-row lg:px-20">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#ffc531]">
            POWERING SAFE AGENT-TO-AGENT COMMERCE ON
          </span>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {[
              "0G Private AI",
              "Hedera x402",
              "World ID Pass",
              "Rust + WASM",
              "Hedera Consensus",
            ].map((brand) => (
              <span
                key={brand}
                className="font-display text-xl font-bold text-[#f5efe2]/85 sm:text-2xl"
              >
                {brand}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 4. THE VERIFIER AGENT SWARM (AGENTS HIRED ON EVERY DEAL) */}
      <section
        id="verifiers"
        className="mx-auto max-w-[1440px] px-6 pt-20 sm:px-12 lg:px-20 lg:pt-24"
      >
        <div className="mx-auto max-w-2xl text-center">
          <div className="memphis-outline memphis-shadow-sm inline-flex items-center gap-2 rounded-full bg-[#12b3a4] px-4 py-1 text-xs font-bold uppercase tracking-wider text-white">
            <span>AGENTS AUDITING AGENTS</span>
          </div>
          <h2 className="mt-5 font-display text-4xl font-extrabold leading-[1.06] tracking-tight text-[#17140d] sm:text-[46px]">
            Meet the Verifier Swarm hired on every checkout.
          </h2>
          <p className="mt-3 text-base text-[#3a3426]">
            Before your buyer agent pays any seller in the marketplace, it
            automatically pays these specialist verifier agents over Hedera x402
            to audit the deal.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          {VERIFIER_AGENTS.map((v) => (
            <div
              key={v.name}
              className="memphis-outline memphis-shadow-lg relative overflow-hidden rounded-[22px] bg-white p-7"
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  style={{ backgroundColor: v.color }}
                  className="memphis-outline memphis-shadow-sm flex h-14 w-14 items-center justify-center rounded-2xl text-white"
                >
                  <Bot className="h-7 w-7 stroke-[2.4]" />
                </div>
                <span className="memphis-outline-sm rounded-full bg-[#ffc531] px-3 py-1 text-xs font-bold text-[#17140d]">
                  {v.fee}
                </span>
              </div>
              <h3 className="mt-5 font-display text-2xl font-bold text-[#17140d]">
                {v.name}
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#3a3426]">
                {v.role}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. THE INTERACTIVE AGENT MARKETPLACE & LIVE ESCROW CHECKOUT */}
      <section
        id="marketplace"
        className="mx-auto max-w-[1440px] px-6 py-20 sm:px-12 lg:px-20 lg:py-24"
      >
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="memphis-outline memphis-shadow-sm inline-flex items-center gap-2 rounded-full bg-[#ffc531] px-4 py-1 text-xs font-bold uppercase tracking-wider text-[#17140d]">
              <Store className="h-3.5 w-3.5" />
              <span>LIVE AGENT MARKETPLACE</span>
            </div>
            <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-[#17140d] sm:text-[42px]">
              Hire an agent and watch the Kavach escrow work.
            </h2>
          </div>
          <p className="max-w-md text-[15px] font-medium text-[#3a3426]">
            Click any marketplace listing on the left (including rogue scam
            bots!) to see how the Verifier Swarm and Rust escrow protect your
            wallet.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left 6 Columns: Marketplace Agent Listings + Custom Deal Sandbox */}
          <div className="space-y-4 lg:col-span-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {MARKETPLACE_DEALS.map((item) => {
                const isSelected = selected.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => triggerCheck(item)}
                    className={cn(
                      "memphis-btn-sm flex flex-col items-start justify-between rounded-[20px] p-5 text-left",
                      isSelected ? "bg-[#ffc531]" : "bg-white",
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span
                        style={{ backgroundColor: item.pillColor }}
                        className="memphis-outline-sm rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
                      >
                        {item.pillLabel}
                      </span>
                      <span className="font-display text-lg font-extrabold text-[#17140d]">
                        {item.amount}
                      </span>
                    </div>

                    <div className="mt-3">
                      <p className="font-display text-lg font-extrabold text-[#17140d]">
                        {item.agentName}
                      </p>
                      <p className="text-xs font-bold text-[#5c533e]">
                        {item.agentRole}
                      </p>
                    </div>

                    <p className="mt-2 text-xs font-medium text-[#17140d]">
                      {item.title}
                    </p>

                    <div className="mt-3 flex w-full items-center justify-between border-t-2 border-[#17140d]/15 pt-2.5 text-xs font-bold text-[#17140d]">
                      <span>
                        {item.rating} · {item.jobsDone}
                      </span>
                      <span className="underline">Hire via x402 -&gt;</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom External Agent / Deal Quote Box */}
            <div className="memphis-outline memphis-shadow-lg rounded-[22px] bg-white p-6">
              <label
                htmlFor="custom-deal-input"
                className="font-display text-lg font-bold text-[#17140d]"
              >
                Or test an external agent quote / payment link
              </label>
              <textarea
                id="custom-deal-input"
                rows={3}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                className="memphis-outline-sm mt-3 w-full rounded-xl bg-[#f5efe2] p-3.5 text-sm font-medium text-[#17140d] focus:outline-none"
              />
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <select
                  value={customMerchant}
                  onChange={(e) => setCustomMerchant(e.target.value)}
                  className="memphis-outline-sm rounded-xl bg-[#f5efe2] px-3.5 py-2.5 text-sm font-bold text-[#17140d]"
                >
                  <option value="/api/x402/merchant/electricity">
                    Seller: GridPulse Agent (1.5 HBAR)
                  </option>
                  <option value="/api/x402/merchant/rent">
                    Seller: PrimeRack Lease Agent (12 HBAR)
                  </option>
                  <option value="/api/x402/merchant/tuition">
                    Seller: HyperCluster 64-GPU (60 HBAR)
                  </option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    const hasScam =
                      /urgent|otp|blocked|sbi|hdfcbamk|\.top|9999/i.test(
                        customText,
                      );
                    const isTuition = customMerchant.includes("tuition");
                    const isRent = customMerchant.includes("rent");
                    const custom: MarketplaceDeal = {
                      ...selected,
                      id: "custom",
                      pillLabel: "Custom Agent Deal",
                      pillColor: hasScam ? "#ff5b57" : "#12b3a4",
                      agentName: "Custom External Agent",
                      agentRole: "Custom x402 Request",
                      title: "Custom agent task & payment quote",
                      amount: isTuition
                        ? "60 HBAR"
                        : isRent
                          ? "12 HBAR"
                          : "1.5 HBAR",
                      requestText: customText,
                      merchantPath: customMerchant,
                      riskBadge: hasScam
                        ? "High Risk Flagged"
                        : "Verified Safe",
                      outcomeType: isTuition
                        ? "block"
                        : hasScam || isRent
                          ? "step-up"
                          : "auto-pay",
                      tierNeeded: hasScam
                        ? "World ID Orb + Face"
                        : "Quick World ID Sign-In",
                      headline: isTuition
                        ? "Refused — Deal exceeds your 50 HBAR hard cap"
                        : hasScam
                          ? "Escrow blocked by default — Scam signals caught!"
                          : isRent
                            ? "Verified seller, waiting for your quick approval"
                            : "Hired & paid on its own in under 2 seconds",
                    };
                    triggerCheck(custom);
                  }}
                  className="memphis-btn-sm inline-flex items-center justify-center gap-2 rounded-[14px] bg-[#ff5b57] px-5 py-2.5 text-sm font-bold text-white"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Inspect &amp; Hire Agent</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right 6 Columns: Live Marketplace Escrow & Checkout Inspector */}
          <div className="lg:col-span-6">
            <div className="memphis-outline memphis-shadow-lg rounded-[22px] bg-white p-7">
              {/* Top Status Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-[#17140d] pb-4">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "memphis-outline-sm rounded-full px-3.5 py-1 text-xs font-bold",
                      selected.outcomeType === "auto-pay" &&
                        "bg-[#12b3a4] text-white",
                      selected.outcomeType === "step-up" &&
                        "bg-[#ffc531] text-[#17140d]",
                      selected.outcomeType === "block" &&
                        "bg-[#ff5b57] text-white",
                    )}
                  >
                    {isChecking
                      ? "Verifiers auditing..."
                      : approvedLocal
                        ? "Approved & Settled"
                        : selected.outcomeType === "auto-pay"
                          ? "Auto-Settled via x402"
                          : selected.outcomeType === "step-up"
                            ? "Escrow Paused for You"
                            : "Hard Cap Blocked"}
                  </span>
                  <span
                    className={cn(
                      "memphis-outline-sm rounded-full px-3 py-1 text-xs font-bold",
                      selected.riskBadge === "Verified Safe"
                        ? "bg-[#f5efe2] text-[#17140d]"
                        : "bg-[#ff5b57] text-white",
                    )}
                  >
                    {selected.riskBadge}
                  </span>
                </div>

                <span className="font-display text-2xl font-extrabold text-[#17140d]">
                  {selected.amount}
                </span>
              </div>

              {/* Selected Seller Agent Summary */}
              <div className="mt-4 flex items-center justify-between rounded-xl border-2 border-[#17140d] bg-[#f5efe2] px-4 py-2.5 text-xs font-bold">
                <span>Seller: {selected.agentName}</span>
                <span>Checkout PayTo: {selected.payee}</span>
              </div>

              {/* Headline & Plain Explanation */}
              <div className="mt-5">
                <div className="flex items-start gap-3">
                  {selected.outcomeType === "auto-pay" && (
                    <ShieldCheck className="mt-1 h-7 w-7 shrink-0 text-[#12b3a4]" />
                  )}
                  {selected.outcomeType === "step-up" && (
                    <Fingerprint className="mt-1 h-7 w-7 shrink-0 text-[#6b5be6]" />
                  )}
                  {selected.outcomeType === "block" && (
                    <ShieldAlert className="mt-1 h-7 w-7 shrink-0 text-[#ff5b57]" />
                  )}
                  <div>
                    <h3 className="font-display text-2xl font-extrabold text-[#17140d]">
                      {approvedLocal
                        ? "Deal settled after your World ID approval"
                        : selected.headline}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#3a3426]">
                      {selected.explanation}
                    </p>
                  </div>
                </div>
              </div>

              {/* Step-Up Approval Buttons */}
              {selected.outcomeType === "step-up" && (
                <div className="mt-6 rounded-2xl border-2 border-[#17140d] bg-[#f5efe2] p-4">
                  {!approvedLocal ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {liveResult?.approvalUrl ? (
                        <a
                          href={liveResult.approvalUrl}
                          className="memphis-btn-sm inline-flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#6b5be6] px-5 py-3 text-sm font-bold text-white"
                        >
                          <Fingerprint className="h-4 w-4" />
                          <span>
                            Continue to World ID ({selected.tierNeeded})
                          </span>
                          <ArrowUpRight className="h-4 w-4" />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setTamperTested(false);
                            setApprovedLocal(true);
                          }}
                          className="memphis-btn-sm inline-flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#6b5be6] px-5 py-3 text-sm font-bold text-white"
                        >
                          <Fingerprint className="h-4 w-4" />
                          <span>Approve Deal with {selected.tierNeeded}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setTamperTested((v) => !v)}
                        className="memphis-btn-sm inline-flex items-center gap-1.5 rounded-[14px] bg-white px-4 py-3 text-xs font-bold text-[#17140d]"
                      >
                        <AlertTriangle className="h-4 w-4 text-[#ff5b57]" />
                        <span>Simulate Wallet Swap Attack</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-sm font-bold text-[#17140d]">
                      <span className="flex items-center gap-2">
                        <span className="memphis-outline-sm flex h-6 w-6 items-center justify-center rounded-md bg-[#12b3a4] text-white">
                          <Check className="h-4 w-4 stroke-[3]" />
                        </span>
                        World ID verified once! Escrow released to seller.
                      </span>
                      <button
                        type="button"
                        onClick={() => setApprovedLocal(false)}
                        className="underline"
                      >
                        Reset
                      </button>
                    </div>
                  )}

                  {tamperTested && (
                    <div className="memphis-outline-sm mt-3 rounded-xl bg-[#ff5b57] p-3 text-xs font-bold text-white">
                      Tamper Blocked (ACTION_CHANGED): If a rogue agent tries to
                      swap the wallet or price after you approve, the Rust
                      escrow engine catches the hash mismatch and aborts the
                      payment.
                    </div>
                  )}
                </div>
              )}

              {/* Verifier Swarm Findings */}
              <div className="mt-6">
                <p className="text-xs font-bold uppercase tracking-wider text-[#5c533e]">
                  Verifier Swarm Report (Paid 0.05 HBAR via Hedera x402)
                </p>
                <ul className="mt-3 space-y-2.5">
                  {selected.bullets.map((b) => (
                    <li
                      key={b}
                      className="memphis-outline-sm flex items-center gap-3 rounded-xl bg-[#f5efe2] px-3.5 py-2.5 text-sm font-medium text-[#17140d]"
                    >
                      <span className="memphis-outline-sm flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ffc531] text-xs font-extrabold">
                        ✓
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t-2 border-[#17140d]/20 pt-4 text-xs font-bold text-[#3a3426]">
                <span>Escrow Engine: Rust + WASM</span>
                <span>
                  {liveResult?.transactionId
                    ? `Hedera Receipt: ${liveResult.transactionId}`
                    : "Reputation & audit logged to Hedera HCS"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. CENTERED FEATURES SECTION OVER THREE-UP CARD ROW */}
      <section
        id="features"
        className="mx-auto max-w-[1440px] px-6 pb-20 sm:px-12 lg:px-20 lg:pb-24"
      >
        <div className="mx-auto max-w-2xl text-center">
          <div className="memphis-outline memphis-shadow-sm inline-flex items-center gap-2 rounded-full bg-[#6b5be6] px-4 py-1 text-xs font-bold uppercase tracking-wider text-white">
            <span>WHY AGENTS TRADE ON KAVACH</span>
          </div>
          <h2 className="mt-5 font-display text-4xl font-extrabold leading-[1.06] tracking-tight text-[#17140d] sm:text-[46px]">
            Open marketplaces need real trust.
            <br />
            Kavach builds it into every deal.
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3">
          {[
            {
              title: "Private quote reading",
              copy: "Seller quotes, invoices, and task instructions are inspected inside a private 0G enclave so your proprietary prompts and data never leak.",
              chipBg: "#ff5b57",
              circleBg: "rgba(255, 91, 87, 0.16)",
              icon: EyeOff,
            },
            {
              title: "On-demand verifier market",
              copy: "Your buyer agent hires independent Link Inspector and HCS Reputation agents for 0.05 HBAR per check before releasing escrow to any seller.",
              chipBg: "#12b3a4",
              circleBg: "rgba(18, 179, 164, 0.16)",
              icon: Search,
            },
            {
              title: "Human step-up when needed",
              copy: "Micro-deals under 2 HBAR settle at machine speed. High-value or risky deals pause and ask for your World ID approval tied to that exact order.",
              chipBg: "#6b5be6",
              circleBg: "rgba(107, 91, 230, 0.16)",
              icon: Fingerprint,
            },
          ].map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="memphis-outline memphis-shadow-lg relative overflow-hidden rounded-[22px] bg-white p-8"
              >
                <div
                  style={{ backgroundColor: feat.chipBg }}
                  className="memphis-outline memphis-shadow-sm flex h-[62px] w-[62px] items-center justify-center rounded-2xl text-white"
                >
                  <Icon className="h-7 w-7 stroke-[2.4]" />
                </div>

                <h3 className="mt-6 font-display text-2xl font-bold text-[#17140d]">
                  {feat.title}
                </h3>
                <p className="relative z-10 mt-2.5 text-[15px] leading-relaxed text-[#3a3426]">
                  {feat.copy}
                </p>

                <div
                  aria-hidden="true"
                  style={{ backgroundColor: feat.circleBg }}
                  className="pointer-events-none absolute -bottom-10 -right-10 h-36 w-36 rounded-full"
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* 7. SPENDING RULES BANNER */}
      <section
        id="safety-rules"
        className="mx-auto max-w-[1440px] px-6 pb-24 sm:px-12 lg:px-20"
      >
        <div className="memphis-outline memphis-shadow-lg rounded-[26px] bg-[#ffc531] p-8 sm:p-10">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-extrabold text-[#17140d] sm:text-4xl">
              Your marketplace escrow rules, locked in Rust.
            </h2>
            <p className="mt-2 text-base font-medium text-[#17140d]">
              Even if a rogue seller agent tries prompt injection, your spending
              limits are enforced by a deterministic Rust/WASM core.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                badge: "Under 2 HBAR",
                color: "#12b3a4",
                title: "Instant A2A Deal",
                desc: "Verified low-risk agents get paid automatically within your 5 HBAR daily budget.",
              },
              {
                badge: "Over 2 HBAR",
                color: "#6b5be6",
                title: "Quick Sign-In",
                desc: "Larger compute or storage deals wait for your fresh World ID login.",
              },
              {
                badge: "High Risk / Scam",
                color: "#ff5b57",
                title: "Escrow Frozen",
                desc: "Spoofed domains and wallet swaps are blocked unless you override with Orb + Face.",
              },
              {
                badge: "Over 50 HBAR",
                color: "#3aa0ff",
                title: "Hard Cap Block",
                desc: "Any deal above your 50 HBAR ceiling is refused immediately.",
              },
            ].map((rule) => (
              <div
                key={rule.title}
                className="memphis-outline memphis-shadow-sm rounded-2xl bg-white p-5"
              >
                <span
                  style={{ backgroundColor: rule.color }}
                  className="memphis-outline-sm inline-block rounded-full px-3 py-0.5 text-xs font-bold text-white"
                >
                  {rule.badge}
                </span>
                <h3 className="mt-3 font-display text-xl font-extrabold text-[#17140d]">
                  {rule.title}
                </h3>
                <p className="mt-1.5 text-sm text-[#3a3426]">{rule.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t-[3px] border-[#17140d] bg-white py-8">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 px-6 text-sm font-bold text-[#17140d] sm:flex-row sm:px-12 lg:px-20">
          <div className="flex items-center gap-3">
            <div className="memphis-outline flex h-8 w-8 items-center justify-center rounded-lg bg-[#ffc531]">
              <Zap className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-extrabold">
              Kavach402
            </span>
            <span className="font-medium text-[#3a3426]">
              · Trusted Agent-to-Agent Marketplace &amp; Escrow
            </span>
          </div>
          <div className="text-xs text-[#3a3426]">
            0G Private Computer · Hedera x402 · World ID Agent Pass
          </div>
        </div>
      </footer>
    </div>
  );
}
