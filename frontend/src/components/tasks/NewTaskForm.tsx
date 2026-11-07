"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api, type PublicAgent, type PublicTask } from "@/lib/api";
import { hbarToTinybars } from "@/lib/format";
import { Button, Card, Field, Input, Notice, Select, Spinner, Textarea } from "../ui";

export function NewTaskForm({
  token,
  presetAgent,
  onCreated,
}: {
  token: string;
  presetAgent: string | null;
  onCreated: (task: PublicTask) => void;
}) {
  const [workers, setWorkers] = useState<PublicAgent[]>([]);
  const [target, setTarget] = useState<"skill" | "agent">(presetAgent ? "agent" : "skill");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.agents({ role: "worker" }).then((r) => {
      if (r.ok) setWorkers(r.data.agents);
    });
  }, []);

  const skills = useMemo(
    () => [...new Set(workers.flatMap((w) => w.skills))].sort(),
    [workers],
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const max = hbarToTinybars(String(f.get("max") ?? ""));
    if (!max) {
      setError("Enter the most you will pay in HBAR, for example 0.2.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api.proposeTask(token, {
      prompt: String(f.get("prompt") ?? "").trim(),
      ...(target === "skill"
        ? { skill: String(f.get("skill") ?? "") }
        : { agentId: String(f.get("agentId") ?? "") }),
      maxPriceTinybars: max,
      autoAccept: f.get("autoAccept") === "on",
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    form.reset();
    onCreated(r.data.task);
  }

  return (
    <Card className="p-5">
      <h2 className="font-display text-[20px] font-extrabold">New task</h2>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="What should be done?" htmlFor="prompt">
          <Textarea
            id="prompt"
            name="prompt"
            rows={4}
            required
            maxLength={3000}
            placeholder="Summarise this article and list every link in it: …"
          />
        </Field>

        <div className="flex gap-2 text-[13px] font-bold" role="radiogroup" aria-label="Find a worker by">
          {(["skill", "agent"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={target === t}
              onClick={() => setTarget(t)}
              className={`rounded-full border-2 border-[#17140d] px-3 py-1 ${
                target === t ? "bg-[#17140d] text-[#f5efe2]" : "bg-white"
              }`}
            >
              {t === "skill" ? "By skill" : "A specific worker"}
            </button>
          ))}
        </div>

        {target === "skill" ? (
          <Field label="Skill" htmlFor="skill">
            <Select id="skill" name="skill" required defaultValue={skills.includes("summarize") ? "summarize" : skills[0]}
              key={skills.join()}>
              {skills.length === 0 && <option value="">No workers yet</option>}
              {skills.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Worker" htmlFor="agentId">
            <Select
              id="agentId"
              name="agentId"
              required
              defaultValue={presetAgent ?? workers[0]?.id}
              key={workers.map((w) => w.id).join()}
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.price}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Most you will pay (HBAR)" htmlFor="max">
          <Input id="max" name="max" required inputMode="decimal" defaultValue="0.2" />
        </Field>

        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="checkbox" name="autoAccept" className="mt-1 h-4 w-4 accent-[#17140d]" />
          <span>
            <strong>Accept the recommended worker automatically.</strong>{" "}
            <span className="text-[#6b6455]">For unattended agents. Kavach still checks the payment.</span>
          </span>
        </label>

        {error && <Notice tone="coral">{error}</Notice>}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Propose task
        </Button>
      </form>
    </Card>
  );
}
