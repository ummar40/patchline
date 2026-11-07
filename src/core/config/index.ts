import { z } from "zod";
import { registerSecret } from "../logging/redaction";
import {
  type EnvSource,
  httpUrl,
  optionalNonNegativeNumber,
  parseEnv,
  pemPrivateKey,
  positiveInt,
} from "./env";

export { ConfigError } from "./env";

const commonShape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  APP_URL: httpUrl,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  JOB_QUEUE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default("maintenance-jobs"),
  GITHUB_APP_ID: z.string().regex(/^\d+$/, "must be the numeric GitHub App ID"),
  GITHUB_APP_PRIVATE_KEY: pemPrivateKey,
  GITHUB_API_URL: httpUrl.default("https://api.github.com"),
  GITHUB_WEB_URL: httpUrl.default("https://github.com"),
};

const webSchema = z.object({
  ...commonShape,
  GITHUB_APP_SLUG: z.string().regex(/^[A-Za-z0-9-]+$/),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(16).optional(),
  SESSION_TTL_HOURS: positiveInt(168),
  MAX_ACTIVE_JOBS_PER_USER: positiveInt(3),
});

const workerSchema = z.object({
  ...commonShape,
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: httpUrl.optional(),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
  OPENAI_MAX_OUTPUT_TOKENS: positiveInt(32_000),
  OPENAI_REQUEST_TIMEOUT_SECONDS: positiveInt(900),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  MODEL_PRICE_INPUT_PER_MTOK: optionalNonNegativeNumber,
  MODEL_PRICE_CACHED_INPUT_PER_MTOK: optionalNonNegativeNumber,
  MODEL_PRICE_OUTPUT_PER_MTOK: optionalNonNegativeNumber,

  AGENT_MAX_TURNS: positiveInt(120),
  AGENT_MAX_REPAIR_ITERATIONS: positiveInt(3),
  AGENT_MAX_JOB_TOKENS: positiveInt(6_000_000),
  AGENT_MAX_TOOL_OUTPUT_CHARS: positiveInt(24_000),
  JOB_TIMEOUT_SECONDS: positiveInt(3_600),

  WORKER_CONCURRENCY: positiveInt(1),
  WORKER_SHUTDOWN_GRACE_SECONDS: positiveInt(30),
  WORKER_RECONCILE_INTERVAL_SECONDS: positiveInt(30),

  SANDBOX_IMAGE: z.string().min(1),
  SANDBOX_NAMESPACE: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/)
    .optional(),
  SANDBOX_DOCKER_BINARY: z.string().min(1).default("docker"),
  SANDBOX_RUNTIME: z.string().min(1).optional(),
  SANDBOX_EGRESS_NETWORK: z.string().min(1).default("bridge"),
  SANDBOX_CPU_LIMIT: z.coerce.number().positive().default(2),
  SANDBOX_MEMORY_MB: positiveInt(4_096),
  SANDBOX_PIDS_LIMIT: positiveInt(512),
  SANDBOX_TMPFS_MB: positiveInt(1_024),
  SANDBOX_COMMAND_TIMEOUT_SECONDS: positiveInt(900),
  SANDBOX_INSTALL_TIMEOUT_SECONDS: positiveInt(1_200),

  GIT_CLONE_DEPTH: positiveInt(50),
  GIT_BRANCH_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .default("maintenance"),
  GIT_COMMIT_AUTHOR_NAME: z.string().min(1),
  // Deliberately looser than an RFC address check: GitHub bot identities look like
  // 123+app-name[bot]@users.noreply.github.com, which strict validators reject. It only has
  // to be safe inside a git author header.
  GIT_COMMIT_AUTHOR_EMAIL: z
    .string()
    .regex(/^[^\s<>@]+@[^\s<>@]+$/, "must look like an email address"),
  CHANGESET_MAX_FILES: positiveInt(40),
  CHANGESET_MAX_PATCH_BYTES: positiveInt(400_000),
});

type CommonEnv = z.output<z.ZodObject<typeof commonShape>>;

function commonConfig(env: CommonEnv) {
  return {
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    appUrl: env.APP_URL,
    database: { url: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },
    queue: { name: env.JOB_QUEUE_NAME },
  };
}

function registerUrlPassword(url: string): void {
  const password = new URL(url).password;
  if (password) {
    registerSecret(password);
    registerSecret(decodeURIComponent(password));
  }
}

export function loadWebConfig(source: EnvSource = process.env) {
  const env = parseEnv(webSchema, source);
  registerUrlPassword(env.DATABASE_URL);
  registerUrlPassword(env.REDIS_URL);
  registerSecret(env.GITHUB_APP_CLIENT_SECRET);
  registerSecret(env.GITHUB_WEBHOOK_SECRET);

  return {
    ...commonConfig(env),
    github: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      apiUrl: env.GITHUB_API_URL,
      webUrl: env.GITHUB_WEB_URL,
      slug: env.GITHUB_APP_SLUG,
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    },
    session: { ttlHours: env.SESSION_TTL_HOURS },
    limits: { maxActiveJobsPerUser: env.MAX_ACTIVE_JOBS_PER_USER },
  };
}

export function loadWorkerConfig(source: EnvSource = process.env) {
  const env = parseEnv(workerSchema, source);
  registerUrlPassword(env.DATABASE_URL);
  registerUrlPassword(env.REDIS_URL);
  registerSecret(env.OPENAI_API_KEY);

  const pricing =
    env.MODEL_PRICE_INPUT_PER_MTOK !== undefined && env.MODEL_PRICE_OUTPUT_PER_MTOK !== undefined
      ? {
          inputPerMTok: env.MODEL_PRICE_INPUT_PER_MTOK,
          cachedInputPerMTok:
            env.MODEL_PRICE_CACHED_INPUT_PER_MTOK ?? env.MODEL_PRICE_INPUT_PER_MTOK,
          outputPerMTok: env.MODEL_PRICE_OUTPUT_PER_MTOK,
        }
      : undefined;

  return {
    ...commonConfig(env),
    github: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      apiUrl: env.GITHUB_API_URL,
      webUrl: env.GITHUB_WEB_URL,
    },
    model: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      id: env.OPENAI_MODEL,
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
      maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
      requestTimeoutMs: env.OPENAI_REQUEST_TIMEOUT_SECONDS * 1000,
      maxRetries: env.OPENAI_MAX_RETRIES,
      pricing,
    },
    agent: {
      maxTurns: env.AGENT_MAX_TURNS,
      maxRepairIterations: env.AGENT_MAX_REPAIR_ITERATIONS,
      maxJobTokens: env.AGENT_MAX_JOB_TOKENS,
      maxToolOutputChars: env.AGENT_MAX_TOOL_OUTPUT_CHARS,
      jobTimeoutMs: env.JOB_TIMEOUT_SECONDS * 1000,
    },
    worker: {
      concurrency: env.WORKER_CONCURRENCY,
      shutdownGraceMs: env.WORKER_SHUTDOWN_GRACE_SECONDS * 1000,
      reconcileIntervalMs: env.WORKER_RECONCILE_INTERVAL_SECONDS * 1000,
    },
    sandbox: {
      // Deployments that share a container host need distinct namespaces. They already need
      // distinct queue names to share Redis, so that is the default.
      namespace: env.SANDBOX_NAMESPACE ?? env.JOB_QUEUE_NAME,
      image: env.SANDBOX_IMAGE,
      dockerBinary: env.SANDBOX_DOCKER_BINARY,
      runtime: env.SANDBOX_RUNTIME,
      egressNetwork: env.SANDBOX_EGRESS_NETWORK,
      cpuLimit: env.SANDBOX_CPU_LIMIT,
      memoryMb: env.SANDBOX_MEMORY_MB,
      pidsLimit: env.SANDBOX_PIDS_LIMIT,
      tmpfsMb: env.SANDBOX_TMPFS_MB,
      commandTimeoutMs: env.SANDBOX_COMMAND_TIMEOUT_SECONDS * 1000,
      installTimeoutMs: env.SANDBOX_INSTALL_TIMEOUT_SECONDS * 1000,
    },
    git: {
      cloneDepth: env.GIT_CLONE_DEPTH,
      branchPrefix: env.GIT_BRANCH_PREFIX,
      authorName: env.GIT_COMMIT_AUTHOR_NAME,
      authorEmail: env.GIT_COMMIT_AUTHOR_EMAIL,
    },
    changeset: {
      maxFiles: env.CHANGESET_MAX_FILES,
      maxPatchBytes: env.CHANGESET_MAX_PATCH_BYTES,
    },
  };
}

export type WebConfig = ReturnType<typeof loadWebConfig>;
export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
export type GitHubAppConfig = WorkerConfig["github"];
export type ModelPricing = NonNullable<WorkerConfig["model"]["pricing"]>;
