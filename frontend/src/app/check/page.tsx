import type { Metadata } from "next";
import { PaymentCheck } from "@/components/check/PaymentCheck";
import { SectionHead, Wrap } from "@/components/ui";

export const metadata: Metadata = { title: "Payment check" };

export default function CheckPage() {
  return (
    <Wrap className="py-14">
      <SectionHead
        eyebrow="Payment firewall"
        title="Paste a payment request. See what Kavach402 would do."
        lead="The same firewall that protects every task payment, on its own: a bill, an invoice or a message, checked before anything is paid."
      />
      <div className="mt-10">
        <PaymentCheck />
      </div>
    </Wrap>
  );
}
