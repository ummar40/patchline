import Link from "next/link";
import type { listAccessibleJobs } from "@/core/access";
import { Timestamp } from "./format";
import { JobStatusBadge } from "./job-status-badge";
import { Panel } from "./ui/layout";

type JobRow = Awaited<ReturnType<typeof listAccessibleJobs>>[number];

export function JobTable(props: { jobs: JobRow[]; showRepository?: boolean }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium" scope="col">
              Job
            </th>
            {props.showRepository ? (
              <th className="px-4 py-2.5 font-medium" scope="col">
                Repository
              </th>
            ) : null}
            <th className="px-4 py-2.5 font-medium" scope="col">
              Status
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              Pull request
            </th>
            <th className="px-4 py-2.5 font-medium" scope="col">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {props.jobs.map((job) => (
            <tr className="hover:bg-surface" key={job.id}>
              <td className="max-w-md px-4 py-3">
                <Link
                  className="block truncate font-medium hover:underline"
                  href={`/jobs/${job.id}`}
                >
                  {job.title}
                </Link>
                <span className="text-xs text-muted">{job.createdBy.name ?? "Unknown user"}</span>
              </td>
              {props.showRepository ? (
                <td className="px-4 py-3">
                  <Link
                    className="font-mono text-xs hover:underline"
                    href={`/repositories/${job.repository.id}`}
                  >
                    {job.repository.fullName}
                  </Link>
                </td>
              ) : null}
              <td className="px-4 py-3">
                <JobStatusBadge status={job.status} />
              </td>
              <td className="px-4 py-3">
                {job.pullRequest ? (
                  <a
                    className="hover:underline"
                    href={job.pullRequest.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    #{job.pullRequest.number}
                  </a>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-muted">
                <Timestamp value={job.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
