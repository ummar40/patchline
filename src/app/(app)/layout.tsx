import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/web/auth/actions";
import { githubLogin, requireUser } from "@/web/auth/current-user";
import { product } from "@/web/copy";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const login = githubLogin(user);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-border px-4 py-3 md:sticky md:top-0 md:h-dvh md:w-56 md:border-r md:border-b-0 md:py-5">
        <Link className="px-2.5 text-sm font-semibold tracking-tight" href="/overview">
          {product.name}
        </Link>
        <AppNav />
        <div className="hidden min-w-0 flex-1 flex-col justify-end md:flex">
          <div className="space-y-2 border-t border-border pt-3">
            <div className="min-w-0 px-2.5">
              <p className="truncate text-sm font-medium">{user.name}</p>
              {login ? <p className="truncate text-xs text-muted">@{login}</p> : null}
            </div>
            <form action={signOutAction}>
              <Button className="w-full justify-start" size="sm" type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto w-full max-w-5xl space-y-8">{children}</div>
      </main>
    </div>
  );
}
