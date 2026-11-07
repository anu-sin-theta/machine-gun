"use client";

import {
  AlertTriangle,
  Ban,
  Check,
  CircleDashed,
  ExternalLink,
  Fingerprint,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { type ApiResult, api, type PublicTask } from "@/lib/api";
import {
  clockTime,
  EVENT_LABELS,
  explainReason,
  formatHbar,
  hbarToTinybars,
  timeAgo,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { TaskStatusPill } from "../status";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Mono,
  Notice,
  Pill,
  Select,
  Spinner,
  Textarea,
} from "../ui";

type Busy = null | "accept" | "research" | "edit" | "withdraw";

export function TaskDetail({
  token,
  task,
  skills,
  onChange,
}: {
  token: string;
  task: PublicTask;
  skills: string[];
  onChange: (task: PublicTask) => void;
}) {
  const recommended =
    task.candidates.find((c) => c.recommended)?.workerId ?? null;
  const [choice, setChoice] = useState<string | null>(recommended);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  // A new set of suggestions resets the selection to Kavach's pick.
  const [seenCandidates, setSeenCandidates] = useState(task.candidates);
  if (seenCandidates !== task.candidates) {
    setSeenCandidates(task.candidates);
    setChoice(recommended);
  }

  async function act(
    kind: Exclude<Busy, null>,
    run: () => Promise<ApiResult<{ task: PublicTask }>>,
  ) {
    setBusy(kind);
    setError(null);
    const r = await run();
    setBusy(null);
    if (r.ok) {
      onChange(r.data.task);
      setEditing(false);
      setConfirmWithdraw(false);
    } else setError(r.error);
  }

  const can = (a: PublicTask["actions"][number]) => task.actions.includes(a);
  const lastDetail = [...task.events].reverse().find((e) => e.detail)?.detail;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <TaskStatusPill status={task.status} />
            <Mono className="text-[12px] text-[#6b6455]">{task.id}</Mono>
          </div>
          <span className="text-[13px] text-[#6b6455]">
            created {timeAgo(task.createdAt)}
          </span>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-[16px] leading-relaxed">
          {task.prompt}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {task.skill && <Pill tone="cream">skill: {task.skill}</Pill>}
          {task.requestedAgentId && (
            <Pill tone="cream">worker: {task.requestedAgentId}</Pill>
          )}
          <Pill tone="cream">max {task.maxPrice}</Pill>
          {task.workerId && <Pill tone="teal">accepted: {task.workerId}</Pill>}
        </div>
      </Card>

      {error && <Notice tone="coral">{error}</Notice>}

      {/* Choosing a worker */}
      {task.status === "awaiting-choice" && !editing && (
        <Card shadow="lg" className="p-6">
          <h3 className="font-display text-[22px] font-extrabold">
            Choose a worker
          </h3>
          <p className="mt-1 text-[15px] text-[#4a4436]">
            Kavach suggests these, cheapest first. Nothing is paid until you
            accept.
          </p>
          {task.candidates.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No worker matches yet">
                Search again later (new workers may join), raise your maximum,
                or change the skill.
              </EmptyState>
            </div>
          ) : (
            <fieldset className="mt-5 min-w-0">
              <legend className="sr-only">Suggested workers</legend>
              <ul className="space-y-3">
                {task.candidates.map((c) => (
                  <li key={c.workerId}>
                    <div
                      className={cn(
                        "memphis-outline-sm flex flex-wrap items-center gap-4 rounded-xl p-4 transition-colors",
                        choice === c.workerId ? "bg-[#fff1c7]" : "bg-white",
                      )}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left has-focus-visible:outline-[3px] has-focus-visible:outline-offset-4 has-focus-visible:outline-[#17140d]">
                        <input
                          type="radio"
                          name="worker-choice"
                          value={c.workerId}
                          checked={choice === c.workerId}
                          onChange={() => setChoice(c.workerId)}
                          className="sr-only"
                        />
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[3px] border-[#17140d]",
                            choice === c.workerId && "bg-[#17140d]",
                          )}
                        >
                          {choice === c.workerId && (
                            <span className="h-1.5 w-1.5 rounded-full bg-[#ffc531]" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-bold">{c.name}</span>
                            {c.recommended && (
                              <Pill tone="teal">recommended</Pill>
                            )}
                            {c.builtIn && <Pill tone="cream">built-in</Pill>}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-[#6b6455]">
                            <Mono>{c.workerId}</Mono>
                            {c.model && <> · {c.model}</>} ·{" "}
                            {c.skills.join(", ")}
                          </span>
                        </span>
                      </label>
                      <span className="font-bold">{c.price}</span>
                      <button
                        type="button"
                        className="text-[13px] font-bold text-[#6b6455] underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={busy !== null}
                        onClick={() =>
                          act("research", () =>
                            api.researchTask(token, task.id, [c.workerId]),
                          )
                        }
                      >
                        Rule out
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              disabled={!choice || busy !== null}
              onClick={() =>
                act("accept", () =>
                  api.acceptTask(token, task.id, choice ?? undefined),
                )
              }
            >
              {busy === "accept" ? <Spinner /> : <Check className="h-4 w-4" />}{" "}
              Accept and run
            </Button>
            {secondaryActions()}
          </div>
        </Card>
      )}

      {/* Editing */}
      {editing && (
        <EditForm
          task={task}
          skills={skills}
          busy={busy === "edit"}
          onCancel={() => setEditing(false)}
          onSubmit={(edit) =>
            act("edit", () => api.editTask(token, task.id, edit))
          }
        />
      )}

      {/* In progress */}
      {(task.status === "queued" ||
        task.status === "vetting" ||
        task.status === "running") && (
        <Card className="p-6">
          <h3 className="font-display text-[22px] font-extrabold">
            In progress
          </h3>
          <Progress status={task.status} />
          {can("withdraw") && <div className="mt-5">{secondaryActions()}</div>}
        </Card>
      )}

      {/* Needs a human */}
      {task.status === "awaiting-approval" && !editing && (
        <Card tone="mustard" shadow="lg" className="p-6">
          <div className="flex items-start gap-3">
            <Fingerprint
              className="mt-0.5 h-7 w-7 shrink-0"
              strokeWidth={2.4}
            />
            <div>
              <h3 className="font-display text-[22px] font-extrabold">
                A human needs to approve this payment
              </h3>
              <p className="mt-1 text-[15px] leading-relaxed">
                Kavach&apos;s policy wants a World ID approval before paying{" "}
                <Mono className="font-bold">{task.workerId}</Mono>. The approval
                is bound to this exact payment. This page updates when it is
                done.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {task.approvalUrl && (
              <a
                href={task.approvalUrl}
                target="_blank"
                rel="noreferrer"
                className="memphis-btn-sm inline-flex items-center gap-2 rounded-xl bg-[#17140d] px-4 py-2.5 text-[15px] font-bold text-[#f5efe2]"
              >
                Approve with World ID <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {secondaryActions()}
          </div>
        </Card>
      )}

      {/* Finished */}
      {task.status === "completed" && (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-[22px] font-extrabold">Answer</h3>
            <Pill tone="teal">screened</Pill>
          </div>
          {task.warnings.length > 0 && (
            <Notice
              tone="coral"
              title={`${task.warnings.length} risky link(s) in this answer`}
              className="mt-4"
            >
              <ul className="mt-1 space-y-1">
                {task.warnings.map((w) => (
                  <li key={w.url}>
                    <Mono>{w.url}</Mono> · {w.level} · {w.signals.join(", ")}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          <pre className="memphis-outline-sm mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#f5efe2] p-4 font-mono text-[13px] leading-relaxed">
            {task.output}
          </pre>
        </Card>
      )}

      {(task.status === "blocked" || task.status === "failed") && !editing && (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            {task.status === "blocked" ? (
              <Ban
                className="h-7 w-7 shrink-0 text-[#ff5b57]"
                strokeWidth={2.4}
              />
            ) : (
              <AlertTriangle
                className="h-7 w-7 shrink-0 text-[#ff5b57]"
                strokeWidth={2.4}
              />
            )}
            <div>
              <h3 className="font-display text-[22px] font-extrabold">
                {task.status === "blocked"
                  ? "Kavach did not pay"
                  : "The run did not finish"}
              </h3>
              <p className="mt-1 text-[15px] text-[#4a4436]">
                {lastDetail
                  ? explainReason(lastDetail)
                  : "No reason was recorded."}{" "}
                You can search for another worker (the one tried is ruled out),
                edit the task, or withdraw it.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">{secondaryActions()}</div>
        </Card>
      )}

      {task.status === "withdrawn" && (
        <Notice title="Withdrawn">
          You called this task off. Nothing was paid after that.
        </Notice>
      )}

      <Card tone="cream" className="p-6">
        <h3 className="font-display text-[18px] font-extrabold">Timeline</h3>
        <ol className="mt-4 space-y-3">
          {task.events.map((e, i) => (
            <li
              key={`${e.at}-${i}`}
              className="grid grid-cols-[72px_1fr] gap-3 text-[14px]"
            >
              <span className="font-mono text-[12px] text-[#6b6455]">
                {clockTime(e.at)}
              </span>
              <span>
                <span className="font-bold">
                  {EVENT_LABELS[e.type] ?? e.type}
                </span>
                {e.detail && (
                  <span className="text-[#4a4436]">
                    {" "}
                    · {explainReason(e.detail)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );

  function secondaryActions() {
    return (
      <>
        {can("research") && (
          <Button
            tone="white"
            disabled={busy !== null}
            onClick={() =>
              act("research", () => api.researchTask(token, task.id))
            }
          >
            {busy === "research" ? (
              <Spinner />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}{" "}
            Search again
          </Button>
        )}
        {can("edit") && (
          <Button
            tone="white"
            disabled={busy !== null}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        )}
        {can("withdraw") &&
          (confirmWithdraw ? (
            <span className="inline-flex items-center gap-2">
              <Button
                tone="ink"
                disabled={busy !== null}
                onClick={() =>
                  act("withdraw", () => api.withdrawTask(token, task.id))
                }
              >
                {busy === "withdraw" ? <Spinner /> : null} Yes, withdraw
              </Button>
              <Button
                tone="white"
                size="sm"
                onClick={() => setConfirmWithdraw(false)}
              >
                Keep it
              </Button>
            </span>
          ) : (
            <Button
              tone="white"
              disabled={busy !== null}
              onClick={() => setConfirmWithdraw(true)}
            >
              Withdraw
            </Button>
          ))}
      </>
    );
  }
}

function Progress({ status }: { status: "queued" | "vetting" | "running" }) {
  const steps = [
    { id: "queued", label: "Accepted" },
    { id: "vetting", label: "Kavach checks the payment" },
    { id: "running", label: "Worker paid and working" },
  ] as const;
  const at = steps.findIndex((s) => s.id === status);
  return (
    <ol className="mt-5 space-y-3">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-3 text-[15px]">
          {i < at ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-[#17140d] bg-[#12b3a4] text-white">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          ) : i === at ? (
            <Spinner className="h-6 w-6" />
          ) : (
            <CircleDashed className="h-6 w-6 text-[#8a8270]" />
          )}
          <span
            className={cn(i > at && "text-[#8a8270]", i === at && "font-bold")}
          >
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EditForm({
  task,
  skills,
  busy,
  onCancel,
  onSubmit,
}: {
  task: PublicTask;
  skills: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (edit: {
    prompt?: string;
    skill?: string;
    maxPriceTinybars?: string;
  }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const prompt = String(f.get("prompt") ?? "").trim();
    const skill = String(f.get("skill") ?? "");
    const max = hbarToTinybars(String(f.get("max") ?? ""));
    if (!max) {
      setError("Enter a maximum in HBAR, for example 0.2.");
      return;
    }
    const edit: { prompt?: string; skill?: string; maxPriceTinybars?: string } =
      {};
    if (prompt && prompt !== task.prompt) edit.prompt = prompt;
    if (skill && skill !== task.skill) edit.skill = skill;
    if (max !== task.maxPriceTinybars) edit.maxPriceTinybars = max;
    if (Object.keys(edit).length === 0) {
      setError("Nothing changed.");
      return;
    }
    setError(null);
    onSubmit(edit);
  }
  return (
    <Card shadow="lg" className="p-6">
      <h3 className="font-display text-[22px] font-extrabold">Edit the task</h3>
      <p className="mt-1 text-[14px] text-[#4a4436]">
        Kavach suggests workers again afterwards.
        {task.status === "awaiting-approval" &&
          " The pending approval is cancelled so it can never pay."}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Task" htmlFor="edit-prompt">
          <Textarea
            id="edit-prompt"
            name="prompt"
            rows={4}
            defaultValue={task.prompt}
            maxLength={3000}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Skill" htmlFor="edit-skill">
            <Select
              id="edit-skill"
              name="skill"
              defaultValue={task.skill ?? ""}
            >
              {!task.skill && <option value="">Keep the named worker</option>}
              {skills.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Most you will pay (HBAR)" htmlFor="edit-max">
            <Input
              id="edit-max"
              name="max"
              inputMode="decimal"
              defaultValue={formatHbar(task.maxPriceTinybars).replace(
                " HBAR",
                "",
              )}
            />
          </Field>
        </div>
        {error && <Notice tone="coral">{error}</Notice>}
        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null} Save and suggest again
          </Button>
          <Button tone="white" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
