import { Suspense } from "react";
import { getRepositories } from "@/adapters/db";
import { DEMO_MERCHANTS, getDemoAudit } from "@/agent";
import { CheckForm } from "@/components/check-form";
import { CheckResult } from "@/components/check-result";
import { VerifierNetwork } from "@/components/verifier-network";
import { getConfig } from "@/config/env";
import { getDirectory } from "@/marketplace";
import { type PublicAgent, toPublic } from "@/marketplace/public";
import { safeReasonCode } from "@/ui/explain";
import { toView } from "@/ui/view";

/** The agent calls 0G, pays checkers and settles on Hedera in one request: allow more than the platform default. */
export const maxDuration = 60;

const APPROVAL_OUTCOMES = ["approved", "denied", "expired", "rejected"];

/** Only the outcomes we produce are shown; anything else in the URL is ignored. */
function approvalOutcome(value: string | undefined): string | null {
  return value && APPROVAL_OUTCOMES.includes(value) ? value : null;
}

export default function Home(props: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Kavach402</h1>
        <p className="mt-2 text-muted">
          A payment agent that checks a request before it pays. It reads the
          request privately, buys evidence from specialist checkers, and asks
          for a stronger World ID approval the riskier the payment looks.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
      <footer className="mt-12 border-t border-border pt-4 text-xs text-muted">
        Built for ETHGlobal Mumbai 2026: 0G Private Computer, Hedera x402, World
        ID Agent Pass.
      </footer>
    </main>
  );
}

async function Dashboard({
  searchParams,
}: {
  searchParams: PageProps<"/">["searchParams"];
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const config = getConfig();
  const demo = config.agentMode === "demo";
  const simulated = config.world.mode === "simulated";

  // The registry the agent buys evidence from. The page still works if it cannot be read.
  let verifiers: PublicAgent[] = [];
  let registryAvailable = true;
  try {
    verifiers = (
      await getDirectory().all({ role: "verifier", status: "active" })
    ).map(toPublic);
  } catch (error) {
    console.error("registry unavailable", error);
    registryAvailable = false;
  }

  // Returning from World ID: show where that check ended up.
  const checkId = one(params.check);
  const check = checkId ? await getRepositories().checks.get(checkId) : null;

  return (
    <div className="space-y-6">
      {demo || simulated ? (
        <div
          role="note"
          data-testid="mode-banner"
          className="rounded-lg border border-warn-fg/30 bg-warn-bg p-3 text-sm text-warn-fg"
        >
          {demo ? (
            <p>
              <strong>Demo mode.</strong> The 0G model, merchant settlement and
              on-chain log are local stand-ins. Link analysis, spending policy
              and approvals are real.
            </p>
          ) : null}
          {simulated ? (
            <p>
              <strong>World ID is simulated.</strong> The approval page is a
              stand-in that checks no one.
            </p>
          ) : null}
        </div>
      ) : null}

      {checkId && !check ? (
        <p
          role="alert"
          data-testid="unknown-check"
          className="rounded-lg bg-bad-bg p-3 text-sm text-bad-fg"
        >
          That check was not found. It may have been started in a previous
          session.
        </p>
      ) : null}

      {check ? (
        <CheckResult
          view={toView(check, {
            audit: getDemoAudit(check.id),
            reason: safeReasonCode(one(params.reason)),
          })}
          demo={demo}
          network={config.hedera.network}
          approval={approvalOutcome(one(params.approval))}
        />
      ) : null}

      <CheckForm
        baseUrl={config.baseUrl}
        demo={demo}
        network={config.hedera.network}
        merchants={
          demo
            ? Object.entries(DEMO_MERCHANTS).map(([path, m]) => ({
                url: `${config.baseUrl}${path}`,
                label: m.label,
              }))
            : null
        }
      />

      <VerifierNetwork agents={verifiers} available={registryAvailable} />
    </div>
  );
}
