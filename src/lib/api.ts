/**
 * Typed client for the Kavach backend. Every call goes to `/api/*` on this
 * app, which `next.config.ts` proxies to the backend, so the browser never
 * needs the backend's origin (except for links the backend itself returns,
 * such as World ID approval URLs).
 */

export type Role = "verifier" | "worker" | "merchant";
export type RiskLevel = "low" | "medium" | "high";

export interface PublicAgent {
  id: string;
  role: Role;
  name: string;
  description: string;
  endpoint: string;
  input: "link" | "payee" | null;
  model: string | null;
  skills: string[];
  payTo: string;
  priceTinybars: string;
  price: string;
  evidenceSource: string;
  status: "active" | "suspended";
  builtIn: boolean;
  createdAt: number;
}

export type TaskStatus =
  | "awaiting-choice"
  | "queued"
  | "vetting"
  | "awaiting-approval"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "withdrawn";

export type TaskAction = "accept" | "research" | "edit" | "withdraw";

export interface TaskCandidate {
  workerId: string;
  name: string;
  model: string | null;
  skills: string[];
  priceTinybars: string;
  price: string;
  builtIn: boolean;
  recommended: boolean;
}

export interface TaskEvent {
  at: number;
  type: string;
  detail?: string;
}

export interface OutputWarning {
  url: string;
  level: "medium" | "high";
  signals: string[];
}

export interface PublicTask {
  id: string;
  status: TaskStatus;
  actions: TaskAction[];
  prompt: string;
  skill: string | null;
  requestedAgentId: string | null;
  maxPriceTinybars: string;
  maxPrice: string;
  candidates: TaskCandidate[];
  excluded: string[];
  workerId: string | null;
  checkId: string | null;
  approvalUrl: string | null;
  output: string | null;
  warnings: OutputWarning[];
  events: TaskEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface Decision {
  kind: "auto-pay" | "step-up" | "block";
  tier?: "fresh" | "human" | "strong";
  blockedByDefault?: boolean;
  reasons: string[];
}

export interface CheckResult {
  checkId: string;
  status:
    | "received"
    | "verdict"
    | "awaiting-approval"
    | "paid"
    | "blocked"
    | "failed";
  decision: Decision | null;
  verdict: { level: RiskLevel | "unknown"; reasons: string[] } | null;
  approvalUrl?: string;
  transactionId?: string;
  reason?: string;
}

export interface Health {
  ok: boolean;
  wasmVersion: string;
  hashesAgree: boolean;
  linkEngineWorks: boolean;
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: Array<{ url: string; protocolBinding: string }>;
  skills: Array<{ id: string; description: string }>;
}

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

async function call<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<ApiResult<T>> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: {
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "Cannot reach the Kavach backend.",
    };
  }
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok)
    return {
      ok: false,
      status: res.status,
      error:
        (body && typeof body.error === "string" && body.error) ||
        (res.status >= 500
          ? "The backend is not available right now."
          : `Request failed (${res.status}).`),
    };
  return { ok: true, status: res.status, data: body as T };
}

const json = (value: unknown) => JSON.stringify(value);

export const api = {
  health: () => call<Health>("/api/health"),
  agentCard: () => call<AgentCard>("/.well-known/agent-card.json"),

  agents: (
    filter: {
      role?: Role;
      skill?: string;
      input?: string;
      status?: "active" | "suspended";
    } = {},
  ) => {
    const q = new URLSearchParams(
      Object.entries(filter).filter(([, v]) => Boolean(v)) as [
        string,
        string,
      ][],
    ).toString();
    return call<{ agents: PublicAgent[] }>(`/api/agents${q ? `?${q}` : ""}`);
  },
  registerAgent: (registration: Record<string, unknown>) =>
    call<{ agent: PublicAgent }>("/api/agents", {
      method: "POST",
      body: json(registration),
    }),

  /** Operator only: needs the deployment's API_TOKEN. */
  setAgentStatus: (
    operatorToken: string,
    id: string,
    status: "active" | "suspended",
  ) =>
    call<{ agent: PublicAgent }>(
      `/api/agents/${encodeURIComponent(id)}/status`,
      { method: "POST", token: operatorToken, body: json({ status }) },
    ),

  createAccount: (name: string) =>
    call<{
      account: { id: string; name: string; createdAt: number };
      token: string;
    }>("/api/accounts", { method: "POST", body: json({ name }) }),

  tasks: (token: string) =>
    call<{ tasks: PublicTask[] }>("/api/tasks", { token }),
  task: (token: string, id: string) =>
    call<{ task: PublicTask }>(`/api/tasks/${encodeURIComponent(id)}`, {
      token,
    }),
  proposeTask: (
    token: string,
    input: {
      prompt: string;
      skill?: string;
      agentId?: string;
      maxPriceTinybars: string;
      autoAccept?: boolean;
    },
  ) =>
    call<{ task: PublicTask }>("/api/tasks", {
      method: "POST",
      token,
      body: json(input),
    }),
  acceptTask: (token: string, id: string, workerId?: string) =>
    call<{ task: PublicTask }>(`/api/tasks/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      token,
      body: json(workerId ? { workerId } : {}),
    }),
  researchTask: (token: string, id: string, exclude: string[] = []) =>
    call<{ task: PublicTask }>(
      `/api/tasks/${encodeURIComponent(id)}/research`,
      { method: "POST", token, body: json({ exclude }) },
    ),
  editTask: (
    token: string,
    id: string,
    edit: { prompt?: string; skill?: string; maxPriceTinybars?: string },
  ) =>
    call<{ task: PublicTask }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      token,
      body: json(edit),
    }),
  withdrawTask: (token: string, id: string) =>
    call<{ task: PublicTask }>(
      `/api/tasks/${encodeURIComponent(id)}/withdraw`,
      { method: "POST", token, body: json({}) },
    ),

  runCheck: (text: string, resource: string, operatorToken?: string) =>
    call<CheckResult>("/api/checks", {
      method: "POST",
      token: operatorToken || null,
      body: json({ text, resource }),
    }),
};
