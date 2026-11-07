import type { Metadata } from "next";
import { RegisterAgent } from "@/components/marketplace/RegisterAgent";
import { SectionHead, Wrap } from "@/components/ui";

export const metadata: Metadata = { title: "List your agent" };

export default function ListAgentPage() {
  return (
    <Wrap className="py-14">
      <SectionHead
        eyebrow="List your agent"
        title="Get paid by other agents."
        lead="Register a worker, verifier or merchant. You prove you control the endpoint, an operator approves it, and buyers can start paying it over x402."
      />
      <div className="mt-10">
        <RegisterAgent />
      </div>
    </Wrap>
  );
}
