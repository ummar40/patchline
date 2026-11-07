import type { Metadata } from "next";
import { Timestamp } from "@/components/format";
import { Button, ButtonLink } from "@/components/ui/button";
import { DefinitionList, PageHeader, Panel, Section } from "@/components/ui/layout";
import { signOutAction } from "@/web/auth/actions";
import { githubLogin, requireUser } from "@/web/auth/current-user";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const { config } = services();
  const login = githubLogin(user);

  return (
    <>
      <PageHeader description="Your account and how it is connected to GitHub." title="Settings" />

      <Section title="Account">
        <Panel className="px-5 py-4">
          <DefinitionList
            items={[
              { term: "Name", value: user.name ?? "Not set on GitHub" },
              { term: "GitHub login", value: login ? `@${login}` : "Unknown" },
              { term: "Email", value: user.email ?? "Not public on GitHub" },
              { term: "Member since", value: <Timestamp value={user.createdAt} /> },
            ]}
          />
        </Panel>
        <p className="text-sm text-muted">
          Profile details come from GitHub and refresh each time you sign in. No GitHub token is
          stored for your account.
        </p>
      </Section>

      <Section
        description="Installations, repository access and synchronisation."
        title="GitHub connection"
      >
        <ButtonLink href="/settings/github">Open GitHub connection</ButtonLink>
      </Section>

      <Section title="Limits">
        <Panel className="px-5 py-4">
          <DefinitionList
            items={[
              { term: "Active jobs per user", value: config.limits.maxActiveJobsPerUser },
              { term: "Session lifetime", value: `${config.session.ttlHours} hours` },
            ]}
          />
        </Panel>
      </Section>

      <Section title="Session">
        <form action={signOutAction}>
          <Button type="submit">Sign out</Button>
        </form>
      </Section>
    </>
  );
}
