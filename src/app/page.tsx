import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { getCurrentUser } from "@/web/auth/current-user";
import { landingCopy, product } from "@/web/copy";

export default async function LandingPage() {
  const signedIn = (await getCurrentUser()) !== null;
  const primaryHref = signedIn ? "/overview" : "/sign-in";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6">
      <header className="flex h-16 items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">{product.name}</span>
        <Link className={buttonStyles({ size: "sm" })} href={primaryHref}>
          {signedIn ? "Open app" : "Sign in"}
        </Link>
      </header>

      <main className="flex-1 space-y-20 pt-16 pb-24">
        <section className="max-w-3xl space-y-6">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {product.tagline}
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted">{landingCopy.lead}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link className={buttonStyles({ variant: "primary" })} href={primaryHref}>
              {signedIn ? "Open app" : "Sign in with GitHub"}
            </Link>
            <a className={buttonStyles({ variant: "ghost" })} href="#how-it-works">
              How it works
            </a>
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="space-y-6">
          <h2 className="text-sm font-semibold text-muted" id="how-it-works">
            How it works
          </h2>
          <ol className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {landingCopy.steps.map((step, index) => (
              <li className="space-y-2 bg-background p-5" key={step.title}>
                <p className="font-mono text-xs text-muted">{String(index + 1).padStart(2, "0")}</p>
                <h3 className="text-sm font-semibold">{step.title}</h3>
                <p className="text-sm leading-6 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-12 lg:grid-cols-2">
          <section aria-labelledby="evidence" className="space-y-4">
            <h2 className="text-sm font-semibold text-muted" id="evidence">
              What every job records
            </h2>
            <ul className="divide-y divide-border border-y border-border text-sm">
              {landingCopy.evidence.map((item) => (
                <li className="py-3" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="boundaries" className="space-y-4">
            <h2 className="text-sm font-semibold text-muted" id="boundaries">
              Boundaries
            </h2>
            <ul className="divide-y divide-border border-y border-border text-sm">
              {landingCopy.boundaries.map((item) => (
                <li className="py-3" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <footer className="flex h-16 items-center border-t border-border text-xs text-muted">
        {product.name}. {landingCopy.footer}
      </footer>
    </div>
  );
}
