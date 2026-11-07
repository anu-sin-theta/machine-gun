import type { CheckResult, RiskLevel, TaskStatus } from "@/lib/api";
import { Pill } from "./ui";

const TASK: Record<
  TaskStatus,
  {
    label: string;
    tone: "coral" | "teal" | "mustard" | "sky" | "white" | "cream";
  }
> = {
  "awaiting-choice": { label: "Your choice", tone: "mustard" },
  queued: { label: "Queued", tone: "sky" },
  vetting: { label: "Kavach checking", tone: "sky" },
  "awaiting-approval": { label: "Needs approval", tone: "mustard" },
  running: { label: "Worker running", tone: "sky" },
  completed: { label: "Completed", tone: "teal" },
  blocked: { label: "Blocked", tone: "coral" },
  failed: { label: "Failed", tone: "coral" },
  withdrawn: { label: "Withdrawn", tone: "cream" },
};

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  const s = TASK[status];
  const live =
    status === "queued" || status === "vetting" || status === "running";
  return (
    <Pill tone={s.tone}>
      {live && (
        <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
      )}
      {s.label}
    </Pill>
  );
}

export const isLiveStatus = (status: TaskStatus) =>
  status === "queued" || status === "vetting" || status === "running";

export function RiskPill({ level }: { level: RiskLevel | "unknown" }) {
  const tone =
    level === "low" ? "teal" : level === "medium" ? "mustard" : "coral";
  return <Pill tone={tone}>{level} risk</Pill>;
}

export function CheckStatusPill({ status }: { status: CheckResult["status"] }) {
  const map = {
    paid: ["Paid", "teal"],
    "awaiting-approval": ["Needs approval", "mustard"],
    blocked: ["Blocked", "coral"],
    failed: ["Failed", "coral"],
    received: ["Received", "white"],
    verdict: ["Decided", "white"],
  } as const;
  const [label, tone] = map[status];
  return <Pill tone={tone}>{label}</Pill>;
}
