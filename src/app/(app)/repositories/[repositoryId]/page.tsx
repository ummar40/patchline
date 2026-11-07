import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Timestamp } from "@/components/format";
import { JobTable } from "@/components/job-table";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, ExternalButtonLink } from "@/components/ui/button";
import {
  DefinitionList,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  Section,
} from "@/components/ui/layout";
import { findAccessibleRepository, listAccessibleJobs } from "@/core/access";
import { repositoryUrl } from "@/core/github/urls";
import { requireUser } from "@/web/auth/current-user";
import { jobActionErrorCopy } from "@/web/copy";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "Repository" };

export default async function RepositoryPage(props: { params: Promise<{ repositoryId: string }> }) {
  const user = await requireUser();
  const { config, db } = services();
  const { repositoryId } = await props.params;

  const repository = await findAccessibleRepository(db, user.id, repositoryId);
  if (!repository) {
    notFound();
  }
  const jobs = await listAccessibleJobs(db, user.id, { repositoryId: repository.id });
  const access = repository.access[0];

  const blocker = repository.isArchived
    ? jobActionErrorCopy.repositoryArchived
    : repository.installation.suspendedAt
      ? jobActionErrorCopy.installationSuspended
      : !access?.canPush
        ? jobActionErrorCopy.writeAccessRequired
        : null;

  return (
    <>
      <PageHeader
        actions={
          <>
            <ExternalButtonLink href={repositoryUrl(config.github.webUrl, repository.fullName)}>
              View on GitHub
            </ExternalButtonLink>
            {blocker ? null : (
              <ButtonLink href={`/jobs/new?repositoryId=${repository.id}`} variant="primary">
                New job
              </ButtonLink>
            )}
          </>
        }
        eyebrow={
          <Link className="hover:underline" href="/repositories">
            Repositories
          </Link>
        }
        title={repository.fullName}
      />

      {blocker ? <Notice tone="warning">{blocker}</Notice> : null}

      <Panel className="px-5 py-4">
        <DefinitionList
          items={[
            {
              term: "Visibility",
              value: <Badge>{repository.isPrivate ? "Private" : "Public"}</Badge>,
            },
            {
              term: "Default branch",
              value: <span className="font-mono text-xs">{repository.defaultBranch}</span>,
            },
            { term: "Installed on", value: repository.installation.accountLogin },
            { term: "Your access", value: access?.canPush ? "Write" : "Read only" },
            {
              term: "Access last confirmed",
              value: access ? <Timestamp value={access.verifiedAt} /> : "Never",
            },
          ]}
        />
      </Panel>

      <Section title="Jobs">
        {jobs.length > 0 ? (
          <JobTable jobs={jobs} />
        ) : (
          <EmptyState
            description="Jobs created for this repository appear here with their status, evidence and pull request."
            title="No jobs for this repository"
          />
        )}
      </Section>
    </>
  );
}
