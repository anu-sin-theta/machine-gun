import { redirect } from "next/navigation";

/** The old console moved to the tasks console. */
export default function ConsolePage() {
  redirect("/tasks");
}
