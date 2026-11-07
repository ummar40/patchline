import { jobStatusCopy } from "@/web/copy";
import type { JobEvidence } from "@/web/jobs/detail";
import { formatCount, formatDuration, formatUsd } from "../format";
import { DefinitionList, EmptyState, Panel } from "../ui/layout";

type JobTotals = {
  modelTurns: number;
  repairIterations: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: { toString(): string } | null;
};

export function JobUsage(props: { job: JobTotals; usageByPhase: JobEvidence["usageByPhase"] }) {
  if (props.job.modelTurns === 0) {
    return (
      <EmptyState
        description="Model calls, token counts and the estimated cost are recorded per phase once the analysis starts."
        title="No model usage yet"
      />
    );
  }
  const cost =
    props.job.estimatedCostUsd === null ? null : Number(props.job.estimatedCostUsd.toString());
  return (
    <div className="space-y-4">
      <Panel className="px-5 py-4">
        <DefinitionList
          items={[
            { term: "Model calls", value: formatCount(props.job.modelTurns) },
            { term: "Repair iterations", value: props.job.repairIterations },
            {
              term: "Estimated cost",
              value: cost === null ? "Prices not configured" : formatUsd(cost),
            },
            { term: "Input tokens", value: formatCount(props.job.inputTokens) },
            { term: "of which cached", value: formatCount(props.job.cachedInputTokens) },
            {
              term: "Output tokens",
              value: `${formatCount(props.job.outputTokens)} (${formatCount(props.job.reasoningTokens)} reasoning)`,
            },
          ]}
        />
      </Panel>
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              {[
                "Phase",
                "Calls",
                "Input",
                "Cached",
                "Output",
                "Retries",
                "Model time",
                "Est. cost",
              ].map((heading) => (
                <th className="px-4 py-2.5 font-medium" key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono text-xs tabular-nums">
            {props.usageByPhase.map((row) => (
              <tr key={row.phase}>
                <td className="px-4 py-2.5 font-sans text-sm">{jobStatusCopy[row.phase].label}</td>
                <td className="px-4 py-2.5">{row._count._all}</td>
                <td className="px-4 py-2.5">{formatCount(row._sum.inputTokens ?? 0)}</td>
                <td className="px-4 py-2.5">{formatCount(row._sum.cachedInputTokens ?? 0)}</td>
                <td className="px-4 py-2.5">{formatCount(row._sum.outputTokens ?? 0)}</td>
                <td className="px-4 py-2.5">{row._sum.retryCount ?? 0}</td>
                <td className="px-4 py-2.5">{formatDuration(row._sum.durationMs ?? 0)}</td>
                <td className="px-4 py-2.5">
                  {row._sum.estimatedCostUsd === null
                    ? "n/a"
                    : formatUsd(Number(row._sum.estimatedCostUsd.toString()))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="text-xs text-muted">
        Cost is an estimate from recorded token counts and the prices configured for this
        deployment.
      </p>
    </div>
  );
}
