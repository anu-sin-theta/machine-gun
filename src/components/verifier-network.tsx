import type { PublicAgent } from "@/marketplace/public";

const CHECKS: Record<string, string> = {
  link: "checks links",
  payee: "checks payee accounts",
};

/** Who the agent can buy evidence from, straight from the registry. */
export function VerifierNetwork({
  agents,
  available,
}: {
  agents: PublicAgent[];
  /** False when the registry could not be read. */
  available: boolean;
}) {
  return (
    <section
      aria-label="Verifier network"
      data-testid="verifier-network"
      className="rounded-xl border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold">Verifier network</h2>
      <p className="mt-1 text-sm text-muted">
        Before paying, the agent buys evidence from these registered verifiers
        over Hedera x402. It pays each one only the account and price it is
        listed with, and a verifier can raise the risk of a request but never
        lower it.
      </p>
      {available ? (
        <ul className="mt-4 divide-y divide-border">
          {agents.map((agent) => (
            <li
              key={agent.id}
              data-testid="verifier"
              className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {agent.name}
                  {agent.builtIn ? (
                    <span className="ml-2 rounded-full bg-neutral-bg px-2 py-0.5 text-xs font-normal text-neutral-fg">
                      built in
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-muted">{agent.description}</p>
                <p className="mt-1 text-xs text-muted">
                  {agent.input ? CHECKS[agent.input] : "merchant"} · evidence
                  appears as{" "}
                  <code className="font-mono">{agent.evidenceSource}</code>
                </p>
              </div>
              <p className="shrink-0 text-sm font-medium">
                {agent.price} per call
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg"
        >
          The registry could not be read right now.
        </p>
      )}
    </section>
  );
}
