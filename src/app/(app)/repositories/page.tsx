import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { EmptyState, PageHeader, Panel } from "@/components/ui/layout";
import { listAccessibleRepositories } from "@/core/access";
import { requireUser } from "@/web/auth/current-user";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "Repositories" };

export default async function RepositoriesPage(props: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { db } = services();
  const search = (await props.searchParams).q?.trim() || undefined;
  const repositories = await listAccessibleRepositories(db, user.id, { search });

  return (
    <>
      <PageHeader
        actions={<ButtonLink href="/settings/github">Manage access</ButtonLink>}
        description="Repositories the GitHub App can reach and that your GitHub account has access to."
        title="Repositories"
      />

      <form className="flex max-w-md gap-2" role="search">
        <Input
          aria-label="Filter repositories"
          defaultValue={search}
          name="q"
          placeholder="Filter by name"
          type="search"
        />
        <Button type="submit">Filter</Button>
      </form>

      {repositories.length === 0 ? (
        <EmptyState
          action={<ButtonLink href="/settings/github">Open GitHub connection</ButtonLink>}
          description={
            search
              ? "No repository matches that filter."
              : "Install the GitHub App or extend its repository selection, then synchronise from the GitHub connection page."
          }
          title="No repositories"
        />
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium" scope="col">
                  Repository
                </th>
                <th className="px-4 py-2.5 font-medium" scope="col">
                  Default branch
                </th>
                <th className="px-4 py-2.5 font-medium" scope="col">
                  Your access
                </th>
                <th className="px-4 py-2.5 font-medium" scope="col">
                  Jobs
                </th>
                <th className="px-4 py-2.5" scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {repositories.map((repository) => {
                const canPush = repository.access[0]?.canPush === true;
                const blocked =
                  repository.isArchived || repository.installation.suspendedAt !== null || !canPush;
                return (
                  <tr className="hover:bg-surface" key={repository.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          className="font-mono text-[13px] font-medium hover:underline"
                          href={`/repositories/${repository.id}`}
                        >
                          {repository.fullName}
                        </Link>
                        <Badge>{repository.isPrivate ? "Private" : "Public"}</Badge>
                        {repository.isArchived ? <Badge tone="warning">Archived</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {repository.defaultBranch}
                    </td>
                    <td className="px-4 py-3 text-muted">{canPush ? "Write" : "Read only"}</td>
                    <td className="px-4 py-3 tabular-nums text-muted">{repository._count.jobs}</td>
                    <td className="px-4 py-3 text-right">
                      {blocked ? null : (
                        <ButtonLink href={`/jobs/new?repositoryId=${repository.id}`} size="sm">
                          New job
                        </ButtonLink>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
