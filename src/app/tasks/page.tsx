import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksConsole } from "@/components/tasks/TasksConsole";
import { SectionHead, Wrap } from "@/components/ui";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <Wrap className="py-14">
      <SectionHead
        eyebrow="Tasks console"
        title="Hire a worker. Stay in charge."
        lead="Propose a task, choose among Kavach's suggestions, and watch the payment get checked before the worker is paid."
      />
      <div className="mt-10">
        <Suspense fallback={null}>
          <TasksConsole />
        </Suspense>
      </div>
    </Wrap>
  );
}
