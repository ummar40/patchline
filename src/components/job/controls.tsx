"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cancelJobAction } from "@/web/jobs/actions";
import { Button } from "../ui/button";

// Re-renders the server components on an interval while a job is running. Polling is paused
// while the tab is hidden.
export function AutoRefresh(props: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, props.intervalMs);
    return () => clearInterval(timer);
  }, [router, props.intervalMs]);
  return null;
}

export function CancelJobButton(props: { jobId: string; alreadyRequested: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (props.alreadyRequested) {
    return (
      <Button disabled size="sm" variant="danger">
        Cancelling
      </Button>
    );
  }
  if (!confirming) {
    return (
      <Button onClick={() => setConfirming(true)} size="sm" variant="danger">
        Cancel job
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Confirm cancellation">
      <Button
        disabled={pending}
        onClick={() => startTransition(() => cancelJobAction(props.jobId))}
        size="sm"
        variant="danger"
      >
        {pending ? "Cancelling" : "Confirm cancel"}
      </Button>
      <Button disabled={pending} onClick={() => setConfirming(false)} size="sm" variant="ghost">
        Keep running
      </Button>
    </div>
  );
}
