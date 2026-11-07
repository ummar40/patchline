import type { Metadata } from "next";
import { JobForm } from "@/components/job-form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { findAccessibleJob, listAccessibleRepositories } from "@/core/access";
import { requireUser } from "@/web/auth/current-user";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage(props: {
  searchParams: Promise<{ repositoryId?: string; from?: string }>;
}) {
  const user = await requireUser();
  const { db } = services();
  const params = await props.searchParams;

  const [repositories, source] = await Promise.all([
    listAccessibleRepositories(db, user.id),
    params.from ? findAccessibleJob(db, user.id, params.from) : null,
  ]);
  const eligible = repositories.filter(
    (repository) =>
      !repository.isArchived &&
      repository.installation.suspendedAt === null &&
      repository.access[0]?.canPush === true,
  );

  return (
    <>
      <PageHeader
        description="Describe one problem. The job investigates the repository, makes the smallest reasonable change, verifies it with the repository's own tooling and opens a pull request only if that evidence supports it."
        title="New maintenance job"
      />
      {eligible.length === 0 ? (
        <EmptyState
          action={<ButtonLink href="/settings/github">Open GitHub connection</ButtonLink>}
          description="Jobs can be created for repositories where the GitHub App is installed and your GitHub account has write access."
          title="No eligible repository"
        />
      ) : (
        <JobForm
          cancelHref={source ? `/jobs/${source.id}` : "/jobs"}
          defaults={{
            repositoryId: source?.repositoryId ?? params.repositoryId,
            retryOfJobId: source?.id,
            title: source?.title,
            problemDescription: source?.problemDescription,
            reproductionSteps: source?.reproductionSteps ?? undefined,
            expectedBehavior: source?.expectedBehavior ?? undefined,
          }}
          repositories={eligible.map(({ id, fullName }) => ({ id, fullName }))}
        />
      )}
    </>
  );
}
