import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-muted">
        This page does not exist, or it belongs to a repository your GitHub account cannot access.
      </p>
      <Link className={buttonStyles()} href="/overview">
        Go to overview
      </Link>
    </main>
  );
}
