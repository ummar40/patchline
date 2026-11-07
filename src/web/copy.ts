import type { JobErrorCategory, JobStatus, VerificationCategory } from "@/db/generated/enums";

export { product } from "@/core/product";

export const landingCopy = {
  lead: "Connect a GitHub repository and describe a problem. The job investigates the code, makes the smallest reasonable change, runs the repository's own tests, lint, type checks and build, and opens a pull request only when those results support it. When they do not, it stops and tells you why.",
  steps: [
    {
      title: "Connect",
      body: "Install the GitHub App on the repositories you choose. It asks for code and pull request access and nothing else.",
    },
    {
      title: "Describe",
      body: "Give the problem a title, say what is wrong, and add reproduction steps or expected behavior if you have them.",
    },
    {
      title: "Verify",
      body: "Work happens in a disposable, isolated workspace. The repository's checks run before and after the change, and the exit codes are recorded.",
    },
    {
      title: "Review",
      body: "You get an ordinary pull request on a dedicated branch. Nothing is merged or deployed for you.",
    },
  ],
  evidence: [
    "A timeline of every state change, with timestamps",
    "Each command that ran, its exit code, duration and output",
    "Test, lint, type check and build results before and after the change",
    "The changed files and the exact diff that was pushed",
    "Model usage and estimated cost for the job",
  ],
  boundaries: [
    "Repository code only runs inside disposable containers, without network access by default",
    "Credentials never enter a container that runs repository code",
    "Repository tokens are short-lived, scoped to one repository, and never stored",
    "Pull requests are never merged automatically, and CI workflow files are never modified",
    "A job that cannot finish safely is marked as needing attention, with the reason",
  ],
  footer: "Built for engineering teams that review what they merge.",
} as const;

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const jobStatusCopy: Record<JobStatus, { label: string; description: string; tone: Tone }> =
  {
    QUEUED: { label: "Queued", description: "Waiting for a worker.", tone: "neutral" },
    PREPARING: { label: "Preparing", description: "Creating an isolated workspace.", tone: "info" },
    CLONING: {
      label: "Cloning",
      description: "Cloning the repository into the workspace.",
      tone: "info",
    },
    ANALYZING: {
      label: "Analyzing",
      description: "Inspecting structure, tooling and the code related to the problem.",
      tone: "info",
    },
    REPRODUCING: {
      label: "Reproducing",
      description: "Trying to reproduce the reported problem.",
      tone: "info",
    },
    PLANNING: {
      label: "Planning",
      description: "Deciding on the smallest safe change.",
      tone: "info",
    },
    IMPLEMENTING: { label: "Implementing", description: "Editing code and tests.", tone: "info" },
    VERIFYING: {
      label: "Verifying",
      description: "Running the repository's tests, lint, type checks and build.",
      tone: "info",
    },
    REVIEWING: { label: "Reviewing", description: "Reviewing the resulting diff.", tone: "info" },
    CREATING_PR: {
      label: "Creating PR",
      description: "Pushing a branch and opening a pull request.",
      tone: "info",
    },
    COMPLETED: {
      label: "Completed",
      description: "A pull request is ready for review.",
      tone: "success",
    },
    FAILED: {
      label: "Failed",
      description: "The job stopped because of an error.",
      tone: "danger",
    },
    NEEDS_HUMAN: {
      label: "Needs attention",
      description: "The job stopped because it could not finish safely on its own.",
      tone: "warning",
    },
    CANCELLED: { label: "Cancelled", description: "The job was cancelled.", tone: "neutral" },
  };

export const errorCategoryCopy: Record<JobErrorCategory, string> = {
  CONFIGURATION: "Worker configuration problem",
  GITHUB_ACCESS: "GitHub access problem",
  CLONE_FAILED: "Clone failed",
  SANDBOX: "Sandbox infrastructure problem",
  DEPENDENCY_INSTALL: "Dependency installation failed",
  UNSUPPORTED_REPOSITORY: "Repository not supported",
  MODEL_PROVIDER: "Model provider error",
  MODEL_BEHAVIOR: "No usable result from the model",
  LIMIT_EXCEEDED: "Configured limit reached",
  NO_VERIFICATION: "Nothing to verify the change with",
  VERIFICATION_FAILED: "Verification did not pass",
  REVIEW_REJECTED: "Review did not approve the change",
  POLICY_VIOLATION: "Change set outside policy",
  AGENT_ESCALATION: "Escalated for a human decision",
  PUBLISH_FAILED: "Publishing to GitHub failed",
  WORKER_INTERRUPTED: "Worker was interrupted",
  INTERNAL: "Unexpected internal error",
};

export const verificationCategoryCopy: Record<VerificationCategory, string> = {
  TEST: "Tests",
  LINT: "Lint",
  TYPECHECK: "Type check",
  BUILD: "Build",
};

export const signInErrorCopy: Record<string, string> = {
  access_denied: "GitHub authorization was cancelled.",
  state_mismatch:
    "That sign-in link was not started from this browser or has expired. Please try again.",
  code_rejected: "GitHub rejected the authorization code. Please try again.",
  github_unavailable: "GitHub could not be reached. Please try again in a moment.",
};

export const jobFormCopy = {
  title: { label: "Title", hint: "One line. Becomes the pull request title." },
  problemDescription: {
    label: "Problem",
    hint: "What is wrong, where you see it, and any error output. Plain facts work best.",
  },
  reproductionSteps: {
    label: "How to reproduce",
    hint: "Optional. Commands, inputs or a failing test.",
  },
  expectedBehavior: { label: "Expected behavior", hint: "Optional. What should happen instead." },
} as const;

export const jobActionErrorCopy = {
  repositoryUnavailable: "That repository is not available to your account.",
  repositoryArchived:
    "Archived repositories are read-only on GitHub, so a pull request cannot be opened.",
  installationSuspended: "The GitHub App installation for this repository is suspended.",
  writeAccessRequired:
    "Creating a job opens a pull request on your behalf, which requires write access to the repository on GitHub.",
  accessCheckFailed: "Your access could not be confirmed with GitHub just now. Please try again.",
  activeJobLimit: (limit: number) =>
    `You already have ${limit} active jobs. Wait for one to finish or cancel it first.`,
} as const;
