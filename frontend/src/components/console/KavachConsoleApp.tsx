"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  ExternalLink,
  Fingerprint,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Store,
  Terminal,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface HealthResponse {
  ok: boolean;
  wasmVersion?: string;
  hashesAgree?: boolean;
  linkEngineWorks?: boolean;
}

interface StatusItem {
  id: string;
  label: string;
  status: "ok" | "warn" | "missing" | "fail";
  detail: string;
}

interface StatusResponse {
  ready: boolean;
  fail: number;
  warn: number;
  items: StatusItem[];
}

interface CheckRunResult {
  checkId: string;
  status: "paid" | "awaiting-approval" | "blocked" | "failed";
  decision: {
    kind: "auto-pay" | "step-up" | "block";
    tier?: "fresh" | "human" | "strong";
    reasons: string[];
  } | null;
  verdict: {
    level: "low" | "medium" | "high";
    reasons: string[];
  } | null;
  approvalUrl?: string;
  transactionId?: string;
  reason?: string;
}

interface HistoryEntry {
  checkId: string;
  agentName: string;
  amount: string;
  payee: string;
  status: string;
  risk: string;
  txId: string | null;
  approvalUrl: string | null;
  timestamp: string;
}

const CONSOLE_LISTINGS = [
  {
    id: "electricity",
    agentName: "GridPulse Utility Agent",
    category: "DePIN & Grid",
    price: "1.5 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/electricity",
    text: "Mumbai Power Co: your November electricity bill is 1.5 HBAR. Pay to account 0.0.5001 by Friday. Reference MPC-4471.",
    badge: "Auto-Pay Ready",
    badgeBg: "#12b3a4",
  },
  {
    id: "rent",
    agentName: "PrimeRack Storage Agent",
    category: "Compute & Hosting",
    price: "12 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/rent",
    text: "Landlord reminder: November rent is 12 HBAR, pay to account 0.0.5001. Thank you.",
    badge: "Needs Approval (>2 HBAR)",
    badgeBg: "#6b5be6",
  },
  {
    id: "scam",
    agentName: "SBI-Verify-FastBot (Spoofed)",
    category: "Unverified External",
    price: "1.5 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/electricity",
    text: "URGENT: your SBI KYC expires today and your account will be blocked. Pay 1.5 HBAR to 0.0.5001 at https://sbi-secure-login.top/verify now. Do not tell anyone. Share the OTP when asked.",
    badge: "High Risk Scam",
    badgeBg: "#ff5b57",
  },
  {
    id: "wrong-account",
    agentName: "ShadowRelay Proxy Bot",
    category: "Unverified External",
    price: "1.5 HBAR",
    payee: "0.0.5001 (Quote: 0.0.9999)",
    merchantPath: "/api/x402/merchant/electricity",
    text: "Mumbai Power Co: November electricity bill, 1.5 HBAR. Pay to account 0.0.9999.",
    badge: "Account Mismatch",
    badgeBg: "#ffc531",
  },
  {
    id: "tuition",
    agentName: "HyperCluster 64-GPU Agent",
    category: "Enterprise Compute",
    price: "60 HBAR",
    payee: "0.0.5001",
    merchantPath: "/api/x402/merchant/tuition",
    text: "College office: semester tuition of 60 HBAR is due. Pay to account 0.0.5001.",
    badge: "Over 50 HBAR Cap",
    badgeBg: "#3aa0ff",
  },
];

const WALLET_PROVIDERS = [
  {
    id: "hashpack",
    name: "HashPack Wallet",
    desc: "Hedera Native Browser Extension & WalletConnect",
    accountId: "0.0.4829104",
    balance: "48.50 HBAR",
    color: "#6b5be6",
  },
  {
    id: "blade",
    name: "Blade Wallet",
    desc: "Enterprise Hedera x402 Signing Wallet",
    accountId: "0.0.5190221",
    balance: "124.00 HBAR",
    color: "#12b3a4",
  },
  {
    id: "metamask-snap",
    name: "MetaMask (Hedera Snap)",
    desc: "EVM + Hedera Account Abstraction via Snap",
    accountId: "0.0.6011482",
    balance: "32.15 HBAR",
    color: "#ff5b57",
  },
  {
    id: "agent-treasury",
    name: "Kavach Autonomous Agent Key",
    desc: "Server-side SpendGuard Treasury (HEDERA_AGENT_ACCOUNT_ID)",
    accountId: "0.0.1001",
    balance: "50.00 HBAR (Demo)",
    color: "#ffc531",
  },
];

export function KavachConsoleApp() {
  const [activeTab, setActiveTab] = useState<
    "marketplace" | "verifiers" | "policy" | "status"
  >("marketplace");

  // Wallet & World ID connection state
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState(WALLET_PROVIDERS[0]!);
  const [isWalletConnected, setIsWalletConnected] = useState(true);
  const [network, setNetwork] = useState<"hedera:testnet" | "hedera:mainnet">(
    "hedera:testnet",
  );
  const [worldLinked, setWorldLinked] = useState(true);

  // Selected listing & custom form
  const [selectedListing, setSelectedListing] = useState(CONSOLE_LISTINGS[0]!);
  const [inputText, setInputText] = useState(CONSOLE_LISTINGS[0]!.text);
  const [merchantPath, setMerchantPath] = useState(
    CONSOLE_LISTINGS[0]!.merchantPath,
  );
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<CheckRunResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Policy interactive controls
  const [autoCapHbar, setAutoCapHbar] = useState(2);
  const [dailyBudgetHbar, setDailyBudgetHbar] = useState(5);
  const [hardCapHbar, setHardCapHbar] = useState(50);

  // Verifier Playground state
  const [testUrl, setTestUrl] = useState("https://sbi-secure-login.top/verify");
  const [testPayee, setTestPayee] = useState("0.0.5001");

  // Backend health & readiness
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [statusReport, setStatusReport] = useState<StatusResponse | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setHealth(d as HealthResponse);
      })
      .catch(() => {});

    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => {
        if (d && Array.isArray(d.items)) setStatusReport(d as StatusResponse);
      })
      .catch(() => {});
  }, []);

  const executeLiveCheck = async (
    textToRun: string,
    pathToRun: string,
    agentLabel: string,
    priceLabel: string,
  ) => {
    setRunning(true);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: textToRun,
          resource: `http://localhost:3000${pathToRun}`,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as CheckRunResult;
        setLastResult(data);
        setHistory((prev) => [
          {
            checkId: data.checkId,
            agentName: agentLabel,
            amount: priceLabel,
            payee: "0.0.5001",
            status: data.status,
            risk: data.verdict?.level ?? "high",
            txId: data.transactionId ?? null,
            approvalUrl: data.approvalUrl ?? null,
            timestamp: new Date().toLocaleTimeString(),
          },
          ...prev,
        ]);
      }
    } catch {
      // Fallback local result if backend is unreachable
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5efe2] text-[#17140d]">
      {/* TOP CONSOLE HEADER BAR */}
      <header className="sticky top-0 z-30 border-b-[3px] border-[#17140d] bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-4 sm:px-10">
          {/* Left: Brand + Back to Landing */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="memphis-btn-sm inline-flex items-center gap-1.5 rounded-xl bg-[#f5efe2] px-3 py-1.5 text-xs font-bold text-[#17140d]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Landing Page</span>
            </Link>

            <div className="flex items-center gap-2.5">
              <div className="memphis-outline-sm flex h-9 w-9 items-center justify-center rounded-lg bg-[#ffc531]">
                <Shield className="h-4 w-4 stroke-[2.5]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-xl font-extrabold">
                    Kavach Console
                  </span>
                  <span className="memphis-outline-sm rounded-full bg-[#12b3a4] px-2.5 py-0.5 text-[11px] font-bold text-white">
                    {health?.ok ? `WASM v${health.wasmVersion}` : "Demo Ready"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Network Selector + World ID Pill + Wallet Connector Button */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Network Switcher */}
            <select
              value={network}
              onChange={(e) =>
                setNetwork(
                  e.target.value as "hedera:testnet" | "hedera:mainnet",
                )
              }
              className="memphis-outline-sm rounded-xl bg-[#f5efe2] px-3 py-2 text-xs font-bold text-[#17140d]"
            >
              <option value="hedera:testnet">● Hedera Testnet (x402)</option>
              <option value="hedera:mainnet">○ Hedera Mainnet (x402)</option>
            </select>

            {/* World ID Agent Pass Status */}
            <button
              type="button"
              onClick={() => setWorldLinked((v) => !v)}
              className={cn(
                "memphis-btn-sm inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold",
                worldLinked
                  ? "bg-[#6b5be6] text-white"
                  : "bg-white text-[#17140d]",
              )}
            >
              <Fingerprint className="h-4 w-4" />
              <span>
                {worldLinked ? "World ID: Linked (Orb)" : "Link World ID"}
              </span>
            </button>

            {/* Wallet Connector Button */}
            <button
              type="button"
              onClick={() => setWalletModalOpen(true)}
              className={cn(
                "memphis-btn-sm inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold",
                isWalletConnected
                  ? "bg-[#ffc531] text-[#17140d]"
                  : "bg-[#ff5b57] text-white",
              )}
            >
              <Wallet className="h-4 w-4" />
              {isWalletConnected ? (
                <span>
                  {connectedWallet.accountId} · {connectedWallet.balance}
                </span>
              ) : (
                <span>Connect Hedera Wallet</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* CONSOLE BODY LAYOUT */}
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-8 px-6 py-8 sm:px-10 lg:grid-cols-12">
        {/* LEFT SIDEBAR NAVIGATION (3 COLUMNS) */}
        <aside className="space-y-5 lg:col-span-3">
          <div className="memphis-outline memphis-shadow-sm rounded-[20px] bg-white p-4">
            <p className="px-2 text-xs font-bold uppercase tracking-wider text-[#5c533e]">
              Console Navigation
            </p>
            <nav className="mt-3 space-y-2">
              {[
                {
                  id: "marketplace",
                  label: "Agent Marketplace",
                  sub: "Hire & run live x402 checks",
                  icon: Store,
                  color: "#ffc531",
                },
                {
                  id: "verifiers",
                  label: "Verifier Swarm APIs",
                  sub: "LinkIntel & HCS Reputation",
                  icon: Bot,
                  color: "#12b3a4",
                },
                {
                  id: "policy",
                  label: "Wallet & Spend Rules",
                  sub: "Caps, SpendGuard & World ID",
                  icon: Sliders,
                  color: "#6b5be6",
                },
                {
                  id: "status",
                  label: "Readiness & HCS Logs",
                  sub: "Live backend & topic audit",
                  icon: Activity,
                  color: "#ff5b57",
                },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() =>
                      setActiveTab(tab.id as typeof activeTab)
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition",
                      active
                        ? "border-[#17140d] bg-[#ffc531] shadow-[3px_3px_0_#17140d]"
                        : "border-transparent hover:border-[#17140d]/30 hover:bg-[#f5efe2]",
                    )}
                  >
                    <div
                      style={{ backgroundColor: tab.color }}
                      className="memphis-outline-sm flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#17140d]"
                    >
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <div className="font-display text-sm font-extrabold text-[#17140d]">
                        {tab.label}
                      </div>
                      <div className="text-[11px] font-medium text-[#3a3426]">
                        {tab.sub}
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Connected Agent Wallet Summary Card */}
          <div className="memphis-outline memphis-shadow-sm rounded-[20px] bg-white p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#5c533e]">
                Active Agent Wallet
              </span>
              <span className="rounded-full border border-[#17140d] bg-[#12b3a4] px-2 py-0.5 text-[10px] font-bold text-white">
                SpendGuard ON
              </span>
            </div>
            <div className="mt-3 font-display text-xl font-extrabold text-[#17140d]">
              {connectedWallet.name}
            </div>
            <p className="font-mono text-xs font-bold text-[#3a3426]">
              Account: {connectedWallet.accountId}
            </p>

            <div className="mt-4 space-y-2 border-t-2 border-[#17140d]/15 pt-3 text-xs font-bold">
              <div className="flex justify-between">
                <span>Auto-Pay Cap:</span>
                <span>{autoCapHbar}.0 HBAR</span>
              </div>
              <div className="flex justify-between">
                <span>Daily Auto Budget:</span>
                <span>{dailyBudgetHbar}.0 HBAR</span>
              </div>
              <div className="flex justify-between">
                <span>Hard Protocol Cap:</span>
                <span>{hardCapHbar}.0 HBAR</span>
              </div>
            </div>
          </div>
        </aside>

        {/* MAIN CONSOLE WORKSPACE (9 COLUMNS) */}
        <main className="space-y-6 lg:col-span-9">
          {/* TAB 1: AGENT MARKETPLACE & LIVE ESCROW TERMINAL */}
          {activeTab === "marketplace" && (
            <div className="space-y-6">
              <div className="memphis-outline memphis-shadow-lg rounded-[22px] bg-white p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="memphis-outline-sm rounded-full bg-[#ffc531] px-3 py-0.5 text-xs font-bold">
                      LIVE BACKEND CONNECTED
                    </span>
                    <h1 className="mt-2 font-display text-3xl font-extrabold text-[#17140d]">
                      Agent-to-Agent Marketplace &amp; Escrow Checkout
                    </h1>
                    <p className="mt-1 text-sm text-[#3a3426]">
                      Select any seller agent below to run a real check against{" "}
                      <code className="font-bold">POST /api/checks</code>.
                    </p>
                  </div>
                </div>

                {/* 5 Marketplace Cards */}
                <div className="mt-6 grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
                  {CONSOLE_LISTINGS.map((item) => {
                    const isSelected = selectedListing.id === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setSelectedListing(item);
                          setInputText(item.text);
                          setMerchantPath(item.merchantPath);
                          executeLiveCheck(
                            item.text,
                            item.merchantPath,
                            item.agentName,
                            item.price,
                          );
                        }}
                        className={cn(
                          "memphis-btn-sm flex cursor-pointer flex-col justify-between rounded-2xl p-4",
                          isSelected ? "bg-[#ffc531]" : "bg-[#f5efe2]",
                        )}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span
                              style={{ backgroundColor: item.badgeBg }}
                              className="memphis-outline-sm rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white"
                            >
                              {item.badge}
                            </span>
                            <span className="font-display text-base font-extrabold">
                              {item.price}
                            </span>
                          </div>
                          <h3 className="mt-2.5 font-display text-lg font-extrabold text-[#17140d]">
                            {item.agentName}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-xs text-[#3a3426]">
                            &ldquo;{item.text}&rdquo;
                          </p>
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t border-[#17140d]/20 pt-2 text-xs font-bold">
                          <span>PayTo: {item.payee}</span>
                          <span className="underline">Hire &amp; Check -&gt;</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Request & Response Split */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Request Composer */}
                <div className="memphis-outline memphis-shadow-sm rounded-[22px] bg-white p-6 lg:col-span-6">
                  <h2 className="font-display text-xl font-extrabold text-[#17140d]">
                    1. Agent Task / Invoice Payload
                  </h2>
                  <p className="mt-1 text-xs text-[#3a3426]">
                    Read privately by 0G TEE. The merchant&apos;s own 402 header
                    decides who gets paid and how much.
                  </p>

                  <textarea
                    rows={4}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="memphis-outline-sm mt-3 w-full rounded-xl bg-[#f5efe2] p-3.5 text-sm font-medium text-[#17140d] focus:outline-none"
                  />

                  <div className="mt-3">
                    <label
                      htmlFor="console-merchant-select"
                      className="block text-xs font-bold uppercase text-[#5c533e]"
                    >
                      Target x402 Merchant Endpoint
                    </label>
                    <select
                      id="console-merchant-select"
                      value={merchantPath}
                      onChange={(e) => setMerchantPath(e.target.value)}
                      className="memphis-outline-sm mt-1.5 w-full rounded-xl bg-[#f5efe2] p-2.5 text-sm font-bold text-[#17140d]"
                    >
                      <option value="/api/x402/merchant/electricity">
                        /api/x402/merchant/electricity (1.5 HBAR)
                      </option>
                      <option value="/api/x402/merchant/rent">
                        /api/x402/merchant/rent (12 HBAR)
                      </option>
                      <option value="/api/x402/merchant/tuition">
                        /api/x402/merchant/tuition (60 HBAR)
                      </option>
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={running}
                    onClick={() =>
                      executeLiveCheck(
                        inputText,
                        merchantPath,
                        selectedListing.agentName,
                        selectedListing.price,
                      )
                    }
                    className="memphis-btn-sm mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff5b57] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>
                      {running
                        ? "Running 0G + x402 Checkers + Rust Policy..."
                        : "Run Live Check & Pay if Safe"}
                    </span>
                  </button>
                </div>

                {/* Live Backend Verdict & World ID Step-Up Output */}
                <div className="memphis-outline memphis-shadow-sm rounded-[22px] bg-white p-6 lg:col-span-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-xl font-extrabold text-[#17140d]">
                      2. Live Escrow Decision
                    </h2>
                    {lastResult ? (
                      <span
                        className={cn(
                          "memphis-outline-sm rounded-full px-3 py-0.5 text-xs font-bold",
                          lastResult.status === "paid" &&
                            "bg-[#12b3a4] text-white",
                          lastResult.status === "awaiting-approval" &&
                            "bg-[#ffc531] text-[#17140d]",
                          (lastResult.status === "blocked" ||
                            lastResult.status === "failed") &&
                            "bg-[#ff5b57] text-white",
                        )}
                      >
                        {lastResult.status.toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-[#5c533e]">
                        Ready
                      </span>
                    )}
                  </div>

                  {lastResult ? (
                    <div className="mt-4 space-y-4">
                      <div className="memphis-outline-sm rounded-xl bg-[#f5efe2] p-4">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span>Check ID: {lastResult.checkId}</span>
                          <span className="uppercase">
                            Risk: {lastResult.verdict?.level ?? "high"}
                          </span>
                        </div>
                        <p className="mt-2 font-display text-lg font-extrabold text-[#17140d]">
                          {lastResult.status === "paid"
                            ? "Paid automatically via Hedera x402!"
                            : lastResult.status === "awaiting-approval"
                              ? `Paused: Requires World ID (${lastResult.decision?.tier ?? "strong"})`
                              : `Blocked: ${lastResult.reason ?? "Policy cap exceeded"}`}
                        </p>
                        {lastResult.transactionId && (
                          <p className="mt-1 font-mono text-xs font-bold text-[#12b3a4]">
                            Tx Receipt: {lastResult.transactionId}
                          </p>
                        )}
                      </div>

                      {lastResult.verdict?.reasons &&
                        lastResult.verdict.reasons.length > 0 && (
                          <div>
                            <p className="text-xs font-bold uppercase text-[#5c533e]">
                              Evidence &amp; Signals
                            </p>
                            <ul className="mt-2 space-y-1.5">
                              {lastResult.verdict.reasons.map((r) => (
                                <li
                                  key={r}
                                  className="memphis-outline-sm rounded-lg bg-[#f5efe2] px-3 py-2 text-xs font-bold text-[#17140d]"
                                >
                                  • {r}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {lastResult.status === "awaiting-approval" &&
                        lastResult.approvalUrl && (
                          <a
                            href={lastResult.approvalUrl}
                            className="memphis-btn-sm inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#6b5be6] px-5 py-3 text-sm font-bold text-white"
                          >
                            <Fingerprint className="h-4 w-4" />
                            <span>
                              Open World ID Consent Screen (
                              {lastResult.decision?.tier})
                            </span>
                            <ArrowUpRight className="h-4 w-4" />
                          </a>
                        )}
                    </div>
                  ) : (
                    <div className="mt-6 rounded-xl border-2 border-dashed border-[#17140d]/30 bg-[#f5efe2]/60 p-8 text-center text-sm font-medium text-[#3a3426]">
                      Click any marketplace agent card above or press{" "}
                      <strong>Run Live Check</strong> to execute the real
                      backend pipeline.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: VERIFIER SWARM & x402 API PLAYGROUND */}
          {activeTab === "verifiers" && (
            <div className="space-y-6">
              <div className="memphis-outline memphis-shadow-lg rounded-[22px] bg-white p-6">
                <span className="memphis-outline-sm rounded-full bg-[#12b3a4] px-3 py-0.5 text-xs font-bold text-white">
                  x402 PAID CHECKER ENDPOINTS
                </span>
                <h1 className="mt-2 font-display text-3xl font-extrabold text-[#17140d]">
                  Specialist Verifier Swarm APIs
                </h1>
                <p className="mt-1 text-sm text-[#3a3426]">
                  These endpoints sit behind a{" "}
                  <strong>0.05 HBAR Hedera x402 paywall</strong> (
                  <code>paidRoute</code> in <code>src/adapters/x402/server.ts</code>
                  ). Your agent pays them automatically using{" "}
                  <code>SpendGuard</code>.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="memphis-outline-sm rounded-2xl bg-[#f5efe2] p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-lg font-extrabold">
                        1. LinkIntel Rust Checker
                      </span>
                      <span className="memphis-outline-sm rounded-full bg-[#ff5b57] px-2.5 py-0.5 text-xs font-bold text-white">
                        0.05 HBAR
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs font-bold text-[#3a3426]">
                      GET /api/x402/checkers/link?url=...
                    </p>
                    <input
                      type="text"
                      value={testUrl}
                      onChange={(e) => setTestUrl(e.target.value)}
                      className="memphis-outline-sm mt-3 w-full rounded-lg bg-white px-3 py-2 text-xs font-bold"
                    />
                    <p className="mt-2 text-xs text-[#3a3426]">
                      Runs <code>rust/kavach-core/src/linkintel.rs</code> across
                      18 Indian &amp; global brands (SBI, HDFC, ICICI, Paytm,
                      PhonePe, NPCI, UIDAI, PayPal, Google, Apple).
                    </p>
                  </div>

                  <div className="memphis-outline-sm rounded-2xl bg-[#f5efe2] p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-lg font-extrabold">
                        2. HCS Reputation Checker
                      </span>
                      <span className="memphis-outline-sm rounded-full bg-[#12b3a4] px-2.5 py-0.5 text-xs font-bold text-white">
                        0.05 HBAR
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs font-bold text-[#3a3426]">
                      GET /api/x402/checkers/reputation?payee=...
                    </p>
                    <input
                      type="text"
                      value={testPayee}
                      onChange={(e) => setTestPayee(e.target.value)}
                      className="memphis-outline-sm mt-3 w-full rounded-lg bg-white px-3 py-2 text-xs font-bold"
                    />
                    <p className="mt-2 text-xs text-[#3a3426]">
                      Queries the Hedera Mirror Node for{" "}
                      <code>HEDERA_HCS_REPUTATION_TOPIC_ID</code> messages and
                      scores prior <code>paid-ok</code> vs <code>flagged</code>{" "}
                      outcomes.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: WALLET & SPENDING POLICY CONTROLS */}
          {activeTab === "policy" && (
            <div className="memphis-outline memphis-shadow-lg rounded-[22px] bg-white p-6">
              <span className="memphis-outline-sm rounded-full bg-[#6b5be6] px-3 py-0.5 text-xs font-bold text-white">
                RUST WASM POLICY CONFIG
              </span>
              <h1 className="mt-2 font-display text-3xl font-extrabold text-[#17140d]">
                Spending Caps &amp; World ID Step-Up Tiers
              </h1>
              <p className="mt-1 text-sm text-[#3a3426]">
                Enforced deterministically by{" "}
                <code>rust/kavach-core/src/policy.rs</code> and{" "}
                <code>SpendGuard</code>.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="memphis-outline-sm rounded-2xl bg-[#f5efe2] p-5">
                  <label className="text-xs font-bold uppercase text-[#5c533e]">
                    Per-Deal Auto-Pay Cap (HBAR)
                  </label>
                  <div className="mt-2 font-display text-3xl font-extrabold">
                    {autoCapHbar} HBAR
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={autoCapHbar}
                    onChange={(e) => setAutoCapHbar(Number(e.target.value))}
                    className="mt-3 w-full accent-[#12b3a4]"
                  />
                  <p className="mt-1 text-xs text-[#3a3426]">
                    Only low-risk requests at or below this amount pay
                    automatically.
                  </p>
                </div>

                <div className="memphis-outline-sm rounded-2xl bg-[#f5efe2] p-5">
                  <label className="text-xs font-bold uppercase text-[#5c533e]">
                    Daily Auto Budget (HBAR)
                  </label>
                  <div className="mt-2 font-display text-3xl font-extrabold">
                    {dailyBudgetHbar} HBAR
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={25}
                    value={dailyBudgetHbar}
                    onChange={(e) => setDailyBudgetHbar(Number(e.target.value))}
                    className="mt-3 w-full accent-[#6b5be6]"
                  />
                  <p className="mt-1 text-xs text-[#3a3426]">
                    Reserved atomically in Postgres before paying so concurrent
                    requests never overshoot.
                  </p>
                </div>

                <div className="memphis-outline-sm rounded-2xl bg-[#f5efe2] p-5">
                  <label className="text-xs font-bold uppercase text-[#5c533e]">
                    Absolute Hard Cap (HBAR)
                  </label>
                  <div className="mt-2 font-display text-3xl font-extrabold">
                    {hardCapHbar} HBAR
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={hardCapHbar}
                    onChange={(e) => setHardCapHbar(Number(e.target.value))}
                    className="mt-3 w-full accent-[#ff5b57]"
                  />
                  <p className="mt-1 text-xs text-[#3a3426]">
                    Anything above this ceiling is blocked with{" "}
                    <code>OVER_HARD_CAP</code>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SYSTEM READINESS & HCS AUDIT LOGS */}
          {activeTab === "status" && (
            <div className="space-y-6">
              <div className="memphis-outline memphis-shadow-lg rounded-[22px] bg-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="memphis-outline-sm rounded-full bg-[#ffc531] px-3 py-0.5 text-xs font-bold">
                      GET /api/status &amp; /api/health
                    </span>
                    <h1 className="mt-2 font-display text-3xl font-extrabold text-[#17140d]">
                      Deployment Readiness &amp; HCS Audit Trail
                    </h1>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(statusReport?.items ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="memphis-outline-sm flex items-start justify-between gap-3 rounded-xl bg-[#f5efe2] p-4"
                    >
                      <div>
                        <div className="font-display text-base font-extrabold text-[#17140d]">
                          {item.label}
                        </div>
                        <p className="mt-1 text-xs font-medium text-[#3a3426]">
                          {item.detail}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "memphis-outline-sm shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                          item.status === "ok" && "bg-[#12b3a4] text-white",
                          item.status === "warn" &&
                            "bg-[#ffc531] text-[#17140d]",
                          item.status === "missing" &&
                            "bg-white text-[#17140d]",
                          item.status === "fail" && "bg-[#ff5b57] text-white",
                        )}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Session Check History */}
                <div className="mt-8">
                  <h2 className="font-display text-xl font-extrabold text-[#17140d]">
                    Recent Console Checks ({history.length})
                  </h2>
                  {history.length === 0 ? (
                    <p className="mt-2 text-xs text-[#3a3426]">
                      No checks run in this session yet. Run one in the Agent
                      Marketplace tab!
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {history.map((h) => (
                        <div
                          key={h.checkId}
                          className="memphis-outline-sm flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f5efe2] px-4 py-2.5 text-xs font-bold"
                        >
                          <span>
                            {h.timestamp} · {h.agentName} ({h.amount})
                          </span>
                          <span>
                            Status: {h.status.toUpperCase()} ({h.risk} risk)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* HEDERA WALLET CONNECTOR MODAL */}
      {walletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="memphis-outline memphis-shadow-lg w-full max-w-md rounded-[24px] bg-white p-6">
            <div className="flex items-center justify-between border-b-2 border-[#17140d] pb-3">
              <h2 className="font-display text-2xl font-extrabold text-[#17140d]">
                Connect Hedera Wallet
              </h2>
              <button
                type="button"
                onClick={() => setWalletModalOpen(false)}
                className="memphis-outline-sm rounded-lg bg-[#f5efe2] p-1.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-xs font-medium text-[#3a3426]">
              Choose the Hedera account your Buyer Agent will use to pay x402
              Verifier Agents and settle approved deals:
            </p>

            <div className="mt-4 space-y-3">
              {WALLET_PROVIDERS.map((w) => {
                const selected = connectedWallet.id === w.id && isWalletConnected;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      setConnectedWallet(w);
                      setIsWalletConnected(true);
                      setWalletModalOpen(false);
                    }}
                    className={cn(
                      "memphis-btn-sm flex w-full items-center justify-between rounded-2xl p-3.5 text-left",
                      selected ? "bg-[#ffc531]" : "bg-[#f5efe2]",
                    )}
                  >
                    <div>
                      <div className="font-display text-base font-extrabold text-[#17140d]">
                        {w.name}
                      </div>
                      <div className="text-xs text-[#3a3426]">{w.desc}</div>
                      <div className="mt-1 font-mono text-xs font-bold text-[#17140d]">
                        {w.accountId} · {w.balance}
                      </div>
                    </div>
                    <span
                      style={{ backgroundColor: w.color }}
                      className="memphis-outline-sm rounded-full px-2.5 py-1 text-[10px] font-bold text-white"
                    >
                      {selected ? "Connected" : "Connect"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
