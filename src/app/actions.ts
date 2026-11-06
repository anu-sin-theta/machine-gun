"use server";

import { getRepositories } from "@/adapters/db";
import { getAgentDeps, getDemoAudit, runCheck } from "@/agent";
import { checkInputSchema } from "@/agent/types";
import { type CheckView, toView } from "@/ui/view";

export interface FormState {
  view?: CheckView;
  error?: string;
  /** Echoed back so the form keeps what the person typed. */
  text?: string;
  resource?: string;
}

/** Runs the agent for the submitted request. Runs on the server, so no API token reaches the browser. */
export async function submitCheck(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const text = String(formData.get("text") ?? "");
  const resource = String(formData.get("resource") ?? "");

  const input = checkInputSchema.safeParse({ text, resource });
  if (!input.success)
    return {
      error:
        "Paste the payment request (up to 4000 characters) and give the merchant URL.",
      text,
      resource,
    };

  let deps: ReturnType<typeof getAgentDeps>;
  try {
    deps = getAgentDeps();
  } catch {
    return {
      error:
        "The agent is not configured yet. Set AGENT_MODE=demo to try it without any keys.",
      text,
      resource,
    };
  }

  try {
    const result = await runCheck(deps, input.data);
    const check = await getRepositories().checks.get(result.checkId);
    if (!check) throw new Error("check missing after run");
    return {
      view: toView(check, {
        approvalUrl: result.approvalUrl ?? null,
        reason: result.reason ?? null,
        audit: getDemoAudit(result.checkId),
      }),
      text,
      resource,
    };
  } catch (error) {
    console.error("check failed", error);
    return {
      error: "Something went wrong while checking. Nothing was paid.",
      text,
      resource,
    };
  }
}
