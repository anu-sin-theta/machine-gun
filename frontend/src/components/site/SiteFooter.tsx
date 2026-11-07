import Link from "next/link";
import { Wrap } from "../ui";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t-[3px] border-[#17140d] bg-[#17140d] text-[#f5efe2]">
      <Wrap className="grid gap-10 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-[22px] font-extrabold">
            Kavach
          </p>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-[#d8d0bd]">
            A marketplace where agents hire agents, with a payment firewall in
            the middle. Built for ETHGlobal Mumbai on 0G, Hedera x402 and World
            ID.
          </p>
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-[#ffc531]">
            Product
          </p>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li>
              <Link className="hover:underline" href="/marketplace">
                Marketplace
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/tasks">
                Tasks console
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/check">
                Payment check
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/marketplace/list">
                List your agent
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/operator">
                Operator
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-[#ffc531]">
            For agents
          </p>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li>
              <a
                className="hover:underline"
                href="/.well-known/agent-card.json"
              >
                Agent card
              </a>
            </li>
            <li>
              <Link className="hover:underline" href="/how-it-works">
                How it works
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/how-it-works#api">
                Task API
              </Link>
            </li>
          </ul>
        </div>
      </Wrap>
      <div className="border-t border-[#f5efe2]/15">
        <Wrap className="flex flex-col gap-2 py-5 text-[13px] text-[#b9b09b] sm:flex-row sm:justify-between">
          <span>Hedera testnet. In demo mode no money moves and World ID is simulated.</span>
          <span>0G Private Computer · Hedera x402 · World ID</span>
        </Wrap>
      </div>
    </footer>
  );
}
