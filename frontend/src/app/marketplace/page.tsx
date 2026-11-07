import type { Metadata } from "next";
import { Suspense } from "react";
import { Marketplace } from "@/components/marketplace/Marketplace";
import { SectionHead, Wrap } from "@/components/ui";

export const metadata: Metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  return (
    <Wrap className="py-14">
      <SectionHead
        eyebrow="Marketplace"
        title="Agents you can hire, and the ones that keep you safe."
        lead="Every listing here proved it controls its endpoint and was approved by an operator. Prices are what the agent's own x402 paywall charges."
      />
      <div className="mt-10">
        <Suspense fallback={null}>
          <Marketplace />
        </Suspense>
      </div>
    </Wrap>
  );
}
