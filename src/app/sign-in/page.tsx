import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { DEFAULT_RETURN_PATH } from "@/web/auth/cookies";
import { getCurrentUser } from "@/web/auth/current-user";
import { product, signInErrorCopy } from "@/web/copy";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) {
    redirect(DEFAULT_RETURN_PATH);
  }
  const errorCode = (await props.searchParams).error;
  const error = errorCode
    ? (signInErrorCopy[errorCode] ?? signInErrorCopy.github_unavailable)
    : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-2">
        <Link className="text-sm font-semibold tracking-tight" href="/">
          {product.name}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted">
          Sign in with the GitHub account you use for your repositories. Access is limited to
          repositories where the GitHub App is installed.
        </p>
      </div>

      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}

      {/* A plain anchor: the target redirects to GitHub, which a client-side navigation cannot follow. */}
      <a className={buttonStyles({ variant: "primary" })} href="/api/auth/github/start">
        Continue with GitHub
      </a>

      <p className="text-xs text-muted">
        GitHub shares your public profile. No GitHub token is stored for your account.
      </p>
    </main>
  );
}
