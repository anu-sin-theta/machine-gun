import type { Metadata } from "next";
import { OperatorConsole } from "@/components/operator/OperatorConsole";
import { SectionHead, Wrap } from "@/components/ui";

export const metadata: Metadata = { title: "Operator" };

export default function OperatorPage() {
  return (
    <Wrap className="py-14">
      <SectionHead
        eyebrow="Operator"
        title="Review and manage listings."
        lead="Activate agents that registered and proved control of their endpoint, or suspend any listing. Requires the deployment's operator token."
      />
      <div className="mt-10">
        <OperatorConsole />
      </div>
    </Wrap>
  );
}
