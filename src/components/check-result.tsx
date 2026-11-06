import type { ReactNode } from "react";
import {
  AUDIT_LABEL,
  explainOutcome,
  explainReason,
  hashscanUrl,
  riskTone,
  STATUS_LABEL,
  statusTone,
  TIER_LABEL,
  type Tone,
} from "@/ui/explain";
import type { CheckView } from "@/ui/view";

const TONE: Record<Tone, string> = {
  good: "bg-good-bg text-good-fg",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export function CheckResult({
  view,
  demo,
  network = "testnet",
  approval,
}: {
  view: CheckView;
  /** True when settlement is a stand-in, so no explorer link is offered. */
  demo: boolean;
  network?: "testnet" | "mainnet";
  /** Outcome of a World redirect, shown when returning to the page. */
  approval?: string | null;
}) {
  const decision = explainOutcome(view);
  const reasons = view.decision?.reasons ?? [];
  const needsApproval = view.status === "awaiting-approval" && view.approvalUrl;
  const tier = view.decision?.kind === "step-up" ? view.decision.tier : null;

  return (
    <section
      aria-label="Result"
      data-testid="result"
      data-status={view.status}
      className="rounded-xl border border-border bg-surface p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold" data-testid="status-label">
          {STATUS_LABEL[view.status]}
        </h2>
        <Pill tone={statusTone(view.status)}>{view.status}</Pill>
        {view.verdict ? (
          <Pill tone={riskTone(view.verdict.level)}>
            {view.verdict.level} risk
          </Pill>
        ) : (
          view.decision && <Pill tone="bad">no risk review</Pill>
        )}
      </div>

      {approval && approval !== "approved" ? (
        <p className="mt-3 text-sm text-muted">
          World ID returned: <strong>{approval}</strong>.
        </p>
      ) : null}

      {decision ? (
        <div className="mt-4">
          <p className="font-medium" data-testid="decision-headline">
            {decision.headline}
          </p>
          <p className="text-sm text-muted">{decision.detail}</p>
        </div>
      ) : null}

      {view.reason ? (
        <p className="mt-3 text-sm" data-testid="reason">
          {explainReason(view.reason)}
        </p>
      ) : null}

      {needsApproval ? (
        <div className="mt-4">
          <a
            href={view.approvalUrl ?? "#"}
            data-testid="approve-link"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Continue to World ID
          </a>
          {tier ? (
            <p className="mt-2 text-xs text-muted">Needs {TIER_LABEL[tier]}.</p>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-5 space-y-2 border-t border-border pt-4">
        {view.amount ? <Row label="Amount">{view.amount}</Row> : null}
        {view.payee ? (
          <Row label="Pays to">
            <code className="font-mono">{view.payee}</code>
          </Row>
        ) : null}
        {view.resource ? (
          <Row label="Merchant">
            <code className="font-mono text-xs">{view.resource}</code>
          </Row>
        ) : null}
        {view.transactionId ? (
          <Row label="Transaction">
            {demo ? (
              <span>
                <code className="font-mono text-xs" data-testid="tx">
                  {view.transactionId}
                </code>{" "}
                <span className="text-muted">(demo, not on Hedera)</span>
              </span>
            ) : (
              <a
                className="text-accent underline"
                data-testid="tx"
                href={hashscanUrl(view.transactionId, network)}
                rel="noreferrer"
                target="_blank"
              >
                {view.transactionId}
              </a>
            )}
          </Row>
        ) : null}
      </dl>

      {view.verdict || reasons.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Why</h3>
          <ul
            className="mt-2 list-disc space-y-1 pl-5 text-sm"
            data-testid="why"
          >
            {view.verdict?.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
            {reasons.map((r) => (
              <li key={r} className="text-muted">
                {explainReason(r)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.audit.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-medium">
            Audit trail{" "}
            {demo ? <span className="text-muted">(in memory)</span> : null}
          </h3>
          <ol className="mt-2 space-y-1 text-sm" data-testid="audit">
            {view.audit.map((e, i) => (
              <li key={`${e.type}-${i}`} className="flex gap-2">
                <span className="text-muted">{i + 1}.</span>
                <span>{AUDIT_LABEL[e.type] ?? e.type}</span>
                {e.detail ? (
                  <span className="text-muted">({e.detail})</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
