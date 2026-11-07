import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PaymentCheck } from "@/components/check/PaymentCheck";
import { SectionHead, Wrap } from "@/components/ui";
import { getConfig } from "@/config/env";

export const metadata: Metadata = { title: "Payment check" };

/** The demo merchants live on this deployment, so the form needs its base URL at request time. */
async function Check() {
  await connection();
  return <PaymentCheck appUrl={new URL(getConfig().baseUrl).origin} />;
}

export default function CheckPage() {
  return (
    <Wrap className="py-14">
      <SectionHead
        eyebrow="Payment firewall"
        title="Paste a payment request. See what Kavach would do."
        lead="The same firewall that protects every task payment, on its own: a bill, an invoice or a message, checked before anything is paid."
      />
      <div className="mt-10">
        <Suspense fallback={null}>
          <Check />
        </Suspense>
      </div>
    </Wrap>
  );
}
