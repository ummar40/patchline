import type { Metadata } from "next";
import { JobTable } from "@/components/job-table";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { listAccessibleJobs } from "@/core/access";
import { requireUser } from "@/web/auth/current-user";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "Jobs" };

const PAGE_SIZE = 100;

export default async function JobsPage() {
  const user = await requireUser();
  const { db } = services();
  const jobs = await listAccessibleJobs(db, user.id, { take: PAGE_SIZE });

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/jobs/new" variant="primary">
            New job
          </ButtonLink>
        }
        description={`The ${PAGE_SIZE} most recent jobs in repositories you can access.`}
        title="Jobs"
      />
      {jobs.length > 0 ? (
        <JobTable jobs={jobs} showRepository />
      ) : (
        <EmptyState
          description="A job takes a problem description and works toward a verified pull request. Every step is recorded."
          title="No jobs yet"
        />
      )}
    </>
  );
}
