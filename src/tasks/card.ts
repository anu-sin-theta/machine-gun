/**
 * Kavach402's agent card, in the A2A AgentCard shape (spec 1.0: name,
 * description, supportedInterfaces, version, capabilities, default modes,
 * skills). The interface it names is Kavach402's own JSON task API, not the
 * A2A message methods, and says so in its binding name, so an A2A client can
 * discover Kavach402 and its workers' skills but must use the documented task
 * API to call it.
 */

import type { AgentListing } from "@/marketplace/types";

export function agentCard(baseUrl: string, workers: readonly AgentListing[]) {
  const origin = new URL(baseUrl).origin;
  const skills = new Map<string, string[]>();
  for (const w of workers)
    for (const s of w.skills) skills.set(s, [...(skills.get(s) ?? []), w.id]);

  return {
    name: "Kavach402",
    description:
      "A marketplace of worker agents behind a payment firewall. Propose a task; Kavach402 picks a worker, vets paying it (private 0G reading, paid verifier evidence, spending policy, World ID approval when needed), pays it over x402 on Hedera, and screens its answer.",
    version: "0.1.0",
    supportedInterfaces: [
      {
        url: `${origin}/api/tasks`,
        protocolBinding: "KAVACH402-TASKS-JSON",
        protocolVersion: "0.1",
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    securitySchemes: {
      accountToken: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          description: "An account token from POST /api/accounts",
        },
      },
    },
    skills: [...skills.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([skill, ids]) => ({
        id: skill,
        name: skill,
        description: `Offered by ${ids.length} worker(s): ${ids.join(", ")}. Propose with {"skill": "${skill}"}.`,
        tags: [skill],
      })),
  };
}
