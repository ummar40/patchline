import type { Metadata } from "next";
import { JobTable } from "@/components/job-table";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, Section } from "@/components/ui/layout";
import {
  countAccessibleJobsByStatus,
  listAccessibleInstallations,
  listAccessibleJobs,
  listAccessibleRepositories,
} from "@/core/access";
import { TERMINAL_STATUSES } from "@/core/jobs/state-machine";
import { requireUser } from "@/web/auth/current-user";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const user = await requireUser();
  const { db } = services();
  const [installations, repositories, counts, recentJobs] = await Promise.all([
    listAccessibleInstallations(db, user.id),
    listAccessibleRepositories(db, user.id),
    countAccessibleJobsByStatus(db, user.id),
    listAccessibleJobs(db, user.id, { take: 8 }),
  ]);

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const finished = TERMINAL_STATUSES.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
  const figures = [
    { label: "In progress", value: total - finished },
    {
      label: "Needs attention",
      value: (counts.get("NEEDS_HUMAN") ?? 0) + (counts.get("FAILED") ?? 0),
    },
    { label: "Completed", value: counts.get("COMPLETED") ?? 0 },
    { label: "Repositories", value: repositories.length },
  ];

  return (
    <>
      <PageHeader
        actions={
          repositories.length > 0 ? (
            <ButtonLink href="/jobs/new" variant="primary">
              New job
            </ButtonLink>
          ) : null
        }
        description="Maintenance jobs across the repositories you can access."
        title="Overview"
      />

      {installations.length === 0 ? (
        <EmptyState
          action={
            <ButtonLink href="/settings/github" variant="primary">
              Connect GitHub
            </ButtonLink>
          }
          description="Install the GitHub App on an account or organization and choose which repositories it may access. Nothing is cloned until you create a job."
          title="No GitHub installation yet"
        />
      ) : (
        <>
          <Panel className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
            {figures.map((figure) => (
              <div className="px-5 py-4" key={figure.label}>
                <p className="text-xs text-muted">{figure.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{figure.value}</p>
              </div>
            ))}
          </Panel>

          <Section
            actions={
              recentJobs.length > 0 ? (
                <ButtonLink href="/jobs" size="sm" variant="ghost">
                  View all
                </ButtonLink>
              ) : null
            }
            title="Recent jobs"
          >
            {recentJobs.length > 0 ? (
              <JobTable jobs={recentJobs} showRepository />
            ) : (
              <EmptyState
                action={
                  repositories.length > 0 ? (
                    <ButtonLink href="/jobs/new" variant="primary">
                      Create the first job
                    </ButtonLink>
                  ) : (
                    <ButtonLink href="/settings/github">Review repository access</ButtonLink>
                  )
                }
                description={
                  repositories.length > 0
                    ? "Describe a bug or maintenance task in one of your repositories. You will see every command, test result and changed file as the job runs."
                    : "The GitHub App is installed, but it has not been given access to any repository you can reach."
                }
                title="No jobs yet"
              />
            )}
          </Section>
        </>
      )}
    </>
  );
}
