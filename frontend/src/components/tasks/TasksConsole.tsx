"use client";

import { LogOut } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type PublicTask } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useAccount } from "@/lib/useAccount";
import { cn } from "@/lib/utils";
import { isLiveStatus, TaskStatusPill } from "../status";
import { Button, Card, EmptyState, Mono, Notice, Spinner } from "../ui";
import { AccountGate } from "./AccountGate";
import { NewTaskForm } from "./NewTaskForm";
import { TaskDetail } from "./TaskDetail";

/** Poll while something can change without the requester doing anything. */
const needsPolling = (t: PublicTask) =>
  isLiveStatus(t.status) || t.status === "awaiting-approval";

export function TasksConsole() {
  const { account, loaded, save } = useAccount();
  const params = useSearchParams();
  const presetAgent = params.get("agent");

  const [tasks, setTasks] = useState<PublicTask[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);

  const token = account?.token ?? null;

  const refresh = useCallback(async () => {
    if (!token) return;
    const r = await api.tasks(token);
    if (r.ok) {
      setTasks(r.data.tasks);
      setError(null);
    } else if (r.status === 401) {
      setError("This token is no longer accepted. Sign in again.");
    } else setError(r.error);
  }, [token]);

  useEffect(() => {
    refresh();
    api.agents({ role: "worker" }).then((r) => {
      if (r.ok) setSkills([...new Set(r.data.agents.flatMap((a) => a.skills))].sort());
    });
  }, [refresh]);

  const selected = useMemo(
    () => tasks?.find((t) => t.id === selectedId) ?? tasks?.[0] ?? null,
    [tasks, selectedId],
  );

  // Keep the open task fresh while it is moving or waiting on World ID.
  useEffect(() => {
    if (!token || !selected || !needsPolling(selected)) return;
    const id = setInterval(async () => {
      const r = await api.task(token, selected.id);
      if (r.ok) upsert(r.data.task);
    }, 1500);
    return () => clearInterval(id);
  }, [token, selected]);

  function upsert(task: PublicTask) {
    setTasks((prev) => {
      const list = prev ?? [];
      const i = list.findIndex((t) => t.id === task.id);
      if (i < 0) return [task, ...list];
      const next = list.slice();
      next[i] = task;
      return next;
    });
  }

  if (!loaded)
    return (
      <div className="flex items-center gap-3 py-16 font-bold">
        <Spinner /> Loading…
      </div>
    );

  if (!account) return <AccountGate onReady={save} />;

  return (
    <div className="space-y-6">
      <Card tone="cream" shadow="none" className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <p className="text-[14px]">
          Signed in as <strong>{account.name}</strong>{" "}
          <Mono className="text-[12px] text-[#6b6455]">
            {account.token.slice(0, 8)}…{account.token.slice(-4)}
          </Mono>
        </p>
        <Button
          tone="white"
          size="sm"
          onClick={() => {
            save(null);
            setTasks(null);
          }}
        >
          <LogOut className="h-4 w-4" /> Forget this token
        </Button>
      </Card>

      {error && <Notice tone="coral">{error}</Notice>}

      <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <NewTaskForm
            token={account.token}
            presetAgent={presetAgent}
            onCreated={(t) => {
              upsert(t);
              setSelectedId(t.id);
            }}
          />
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[20px] font-extrabold">Your tasks</h2>
              <button
                type="button"
                onClick={refresh}
                className="text-[13px] font-bold underline-offset-2 hover:underline"
              >
                Refresh
              </button>
            </div>
            {!tasks ? (
              <div className="flex items-center gap-2 py-6 text-[14px] font-bold">
                <Spinner /> Loading…
              </div>
            ) : tasks.length === 0 ? (
              <p className="py-4 text-[14px] text-[#6b6455]">No tasks yet. Propose one above.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      aria-current={selected?.id === t.id}
                      className={cn(
                        "w-full rounded-xl border-2 border-[#17140d] px-3 py-2.5 text-left transition-colors",
                        selected?.id === t.id ? "bg-[#fff1c7]" : "bg-white hover:bg-[#f5efe2]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <TaskStatusPill status={t.status} />
                        <span className="text-[12px] text-[#6b6455]">{timeAgo(t.updatedAt)}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[14px]">{t.prompt}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          {selected ? (
            <TaskDetail
              key={selected.id}
              token={account.token}
              task={selected}
              skills={skills}
              onChange={upsert}
            />
          ) : (
            <EmptyState title="Propose your first task">
              Describe what you need, pick a skill and the most you will pay. Kavach402 suggests workers and you decide.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
