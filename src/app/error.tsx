"use client";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted">
        The request could not be completed. If it keeps happening, share this reference with whoever
        operates the service.
      </p>
      {props.error.digest ? (
        <p className="font-mono text-xs text-muted">{props.error.digest}</p>
      ) : null}
      <Button onClick={props.reset}>Try again</Button>
    </main>
  );
}
