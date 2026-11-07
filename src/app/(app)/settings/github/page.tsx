import type { Metadata } from "next";
import Link from "next/link";
import { Timestamp } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { ExternalButtonLink, buttonStyles } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader, Panel, Section } from "@/components/ui/layout";
import { listAccessibleInstallations } from "@/core/access";
import { installationSettingsUrl, newInstallationUrl } from "@/core/github/urls";
import { requireUser } from "@/web/auth/current-user";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "GitHub connection" };

const SYNC_HREF = `/api/auth/github/start?returnTo=${encodeURIComponent("/settings/github?notice=synced")}`;

const notices: Record<string, { tone: "success" | "info"; text: string }> = {
  synced: {
    tone: "success",
    text: "Synchronised with GitHub. The list below reflects what your account can access now.",
  },
  pending: {
    tone: "info",
    text: "Your installation request was sent to the organization's owners. It will appear here after they approve it and you synchronise again.",
  },
};

export default async function GitHubConnectionPage(props: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requireUser();
  const { config, db } = services();
  const installations = await listAccessibleInstallations(db, user.id);
  const notice = notices[(await props.searchParams).notice ?? ""];
  const installUrl = newInstallationUrl(config.github.webUrl, config.github.slug);

  return (
    <>
      <PageHeader
        actions={
          <>
            {/* A plain anchor: this starts a full-page OAuth round trip, not a client navigation. */}
            <a className={buttonStyles()} href={SYNC_HREF}>
              Sync with GitHub
            </a>
            <ExternalButtonLink href={installUrl} variant="primary">
              Install on an account
            </ExternalButtonLink>
          </>
        }
        description="Access comes from a GitHub App installation. You choose the repositories on GitHub; this page shows what your own GitHub account can reach through it."
        eyebrow={
          <Link className="hover:underline" href="/settings">
            Settings
          </Link>
        }
        title="GitHub connection"
      />

      {notice ? (
        <Notice role="status" tone={notice.tone}>
          {notice.text}
        </Notice>
      ) : null}

      <Section title="Installations">
        {installations.length === 0 ? (
          <EmptyState
            action={
              <ExternalButtonLink href={installUrl} variant="primary">
                Install the GitHub App
              </ExternalButtonLink>
            }
            description="Install the app on your personal account or an organization and pick the repositories it may access. It requests read and write access to code and pull requests, and nothing else."
            title="Not installed anywhere you can access"
          />
        ) : (
          <Panel className="divide-y divide-border">
            {installations.map((installation) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                key={installation.id}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{installation.accountLogin}</span>
                    <Badge>
                      {installation.accountType === "ORGANIZATION" ? "Organization" : "User"}
                    </Badge>
                    {installation.suspendedAt ? (
                      <Badge tone="warning">Suspended</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted">
                    {installation.repositorySelection === "ALL"
                      ? "All repositories"
                      : "Selected repositories"}
                    {" - "}
                    {installation._count.repositories} visible to you
                    {" - updated "}
                    <Timestamp value={installation.updatedAt} />
                  </p>
                </div>
                <ExternalButtonLink
                  href={installationSettingsUrl(config.github.webUrl, installation)}
                  size="sm"
                >
                  Configure on GitHub
                </ExternalButtonLink>
              </div>
            ))}
          </Panel>
        )}
      </Section>

      <Section title="How access works">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>
            You see a repository only if the app is installed on it and your GitHub account can
            access it.
          </li>
          <li>Creating a job requires write access, checked with GitHub at that moment.</li>
          <li>
            Repository credentials are short-lived installation tokens created per job. None are
            stored.
          </li>
          <li>
            After changing the repository selection on GitHub, use Sync with GitHub, then{" "}
            <Link className="text-foreground underline underline-offset-2" href="/repositories">
              view your repositories
            </Link>
            .
          </li>
        </ul>
      </Section>
    </>
  );
}
