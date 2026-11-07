import { z } from "zod";
import type { Detection } from "@/core/jobs/artifacts";
import { REPOSITORY_DIR, type Sandbox } from "../sandbox/types";

// Facts that ordinary code can establish: which ecosystems are present, which toolchains the
// sandbox image offers, how dependencies are installed, and which scripts look like the
// verification commands. The model confirms or corrects the candidates during analysis.

const TIMEOUT_MS = 60_000;
const MAX_LISTED_FILES = 5_000;

const ECOSYSTEM_MARKERS: Record<string, { files: RegExp; toolchain: string }> = {
  node: { files: /^package\.json$/, toolchain: "node" },
  python: {
    files: /^(pyproject\.toml|requirements[^/]*\.txt|setup\.py|setup\.cfg|Pipfile)$/,
    toolchain: "python3",
  },
  go: { files: /^go\.mod$/, toolchain: "go" },
  rust: { files: /^Cargo\.toml$/, toolchain: "cargo" },
  java: { files: /^(pom\.xml|build\.gradle(\.kts)?)$/, toolchain: "java" },
  ruby: { files: /^Gemfile$/, toolchain: "ruby" },
  php: { files: /^composer\.json$/, toolchain: "php" },
  dotnet: { files: /\.(sln|csproj|fsproj)$/, toolchain: "dotnet" },
};

const INSTRUCTION_FILES =
  /^(AGENTS\.md|CLAUDE\.md|CONTRIBUTING\.md|README(\.[A-Za-z]+)?|\.github\/CONTRIBUTING\.md|docs\/CONTRIBUTING\.md)$/i;
const CI_FILES =
  /^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|\.circleci\/config\.yml|azure-pipelines\.yml|Jenkinsfile)$/;
const NPM_PLACEHOLDER_TEST = /no test specified/i;

const packageJsonSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  packageManager: z.string().optional(),
});

export type DetectionResult = Detection & {
  unsupportedEcosystems: string[];
  fileCount: number;
};

async function read(sandbox: Sandbox, path: string, signal?: AbortSignal): Promise<string | null> {
  const result = await sandbox.exec({
    argv: ["head", "-c", "262144", "--", `${REPOSITORY_DIR}/${path}`],
    timeoutMs: TIMEOUT_MS,
    signal,
  });
  return result.exitCode === 0 ? result.stdout : null;
}

function nodePlan(files: Set<string>, manifest: z.output<typeof packageJsonSchema>) {
  const manager =
    files.has("pnpm-lock.yaml") || manifest.packageManager?.startsWith("pnpm")
      ? "pnpm"
      : files.has("yarn.lock") || manifest.packageManager?.startsWith("yarn")
        ? "yarn"
        : "npm";
  const install =
    manager === "pnpm"
      ? "pnpm install --frozen-lockfile"
      : manager === "yarn"
        ? files.has(".yarnrc.yml")
          ? "yarn install --immutable"
          : "yarn install --frozen-lockfile"
        : files.has("package-lock.json") || files.has("npm-shrinkwrap.json")
          ? "npm ci"
          : "npm install --no-audit --no-fund";

  const scripts = manifest.scripts ?? {};
  const script = (...names: string[]) => {
    const name = names.find((candidate) => scripts[candidate] !== undefined);
    return name ? (name === "test" ? `${manager} test` : `${manager} run ${name}`) : null;
  };
  return {
    manager,
    install,
    commands: {
      test: scripts.test && !NPM_PLACEHOLDER_TEST.test(scripts.test) ? `${manager} test` : null,
      lint: script("lint"),
      typecheck: script("typecheck", "type-check", "check-types", "tsc"),
      build: script("build"),
    },
  };
}

function pythonPlan(files: Set<string>, pyproject: string | null) {
  const steps = ["python3 -m venv .venv", ".venv/bin/pip install --quiet pytest"];
  for (const requirements of [
    "requirements.txt",
    "requirements-dev.txt",
    "requirements-test.txt",
    "dev-requirements.txt",
  ]) {
    if (files.has(requirements)) {
      steps.push(`.venv/bin/pip install --quiet -r ${requirements}`);
    }
  }
  if (files.has("pyproject.toml") || files.has("setup.py")) {
    steps.push(".venv/bin/pip install --quiet -e .");
  }
  const hasTests = [...files].some((file) =>
    /(^|\/)(tests?\/|test_[^/]+\.py$|[^/]+_test\.py$)/.test(file),
  );
  return {
    install: steps.join(" && "),
    commands: {
      test: hasTests ? "python -m pytest" : null,
      lint:
        files.has("ruff.toml") || files.has(".ruff.toml") || pyproject?.includes("[tool.ruff")
          ? "ruff check ."
          : null,
      typecheck: files.has("mypy.ini") || pyproject?.includes("[tool.mypy") ? "mypy ." : null,
      build: null,
    },
  };
}

export async function detectRepository(
  sandbox: Sandbox,
  signal?: AbortSignal,
): Promise<DetectionResult> {
  const listing = await sandbox.exec({
    argv: ["rg", "--files", "--hidden", "--glob", "!.git", "--max-depth", "4"],
    workdir: REPOSITORY_DIR,
    timeoutMs: TIMEOUT_MS,
    signal,
  });
  const allFiles = listing.stdout.split("\n").filter((line) => line !== "");
  const files = new Set(allFiles.slice(0, MAX_LISTED_FILES));
  const rootFiles = [...files].filter((file) => !file.includes("/"));

  const toolchains = await sandbox.exec({
    argv: [
      "sh",
      "-c",
      'for tool in "$@"; do command -v "$tool" >/dev/null 2>&1 && echo "$tool"; done; true',
      "sh",
      ...Object.values(ECOSYSTEM_MARKERS).map((marker) => marker.toolchain),
    ],
    timeoutMs: TIMEOUT_MS,
    signal,
  });
  const available = new Set(toolchains.stdout.split("\n").filter(Boolean));

  const present = Object.entries(ECOSYSTEM_MARKERS)
    .filter(([, marker]) => rootFiles.some((file) => marker.files.test(file)))
    .map(([name]) => name);
  const supported = present.filter((name) =>
    available.has(ECOSYSTEM_MARKERS[name]?.toolchain ?? ""),
  );

  const installCommands: string[] = [];
  let packageManager: string | null = null;
  const candidates: Detection["candidateCommands"] = {
    test: null,
    lint: null,
    typecheck: null,
    build: null,
  };
  const adopt = (commands: Detection["candidateCommands"]) => {
    for (const key of Object.keys(candidates) as (keyof typeof candidates)[]) {
      candidates[key] ??= commands[key];
    }
  };

  if (supported.includes("node")) {
    const raw = await read(sandbox, "package.json", signal);
    let manifest: z.output<typeof packageJsonSchema> = {};
    try {
      manifest = packageJsonSchema.parse(JSON.parse(raw ?? "{}"));
    } catch {
      manifest = {};
    }
    const plan = nodePlan(files, manifest);
    packageManager = plan.manager;
    installCommands.push(plan.install);
    adopt(plan.commands);
  }
  if (supported.includes("python")) {
    const plan = pythonPlan(
      files,
      files.has("pyproject.toml") ? await read(sandbox, "pyproject.toml", signal) : null,
    );
    packageManager ??= "pip";
    installCommands.push(plan.install);
    adopt(plan.commands);
  }

  return {
    ecosystems: supported,
    unsupportedEcosystems: present.filter((name) => !supported.includes(name)),
    packageManager,
    installCommands,
    candidateCommands: candidates,
    instructionFiles: [...files].filter((file) => INSTRUCTION_FILES.test(file)).sort(),
    ciFiles: [...files].filter((file) => CI_FILES.test(file)).sort(),
    fileCount: allFiles.length,
  };
}
