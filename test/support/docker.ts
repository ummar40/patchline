import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export type DockerResult = { exitCode: number | null; stdout: string; stderr: string };

export function docker(args: string[], stdin?: string): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

async function mustSucceed(args: string[], stdin?: string): Promise<string> {
  const result = await docker(args, stdin);
  if (result.exitCode !== 0) {
    throw new Error(
      `docker ${args.slice(0, 3).join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

export async function sandboxImageAvailable(image: string | undefined): Promise<boolean> {
  if (!image) {
    return false;
  }
  try {
    return (await docker(["image", "inspect", "--format", "{{.Id}}", image])).exitCode === 0;
  } catch {
    return false;
  }
}

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

export type GitFixture = {
  network: string;
  webUrl: string;
  readToken: string;
  writeToken: string;
  git(args: string[]): Promise<string>;
  remove(): Promise<void>;
};

// Starts a throwaway git remote on a private Docker network: a container that holds a bare
// clone of a fixture directory and serves it over smart HTTP with per-operation credentials.
export async function startGitFixture(options: {
  image: string;
  fixtureDirectory: string;
  repositoryFullName: string;
}): Promise<GitFixture> {
  const suffix = randomBytes(4).toString("hex");
  const network = `patchline-test-${suffix}`;
  const container = `patchline-git-${suffix}`;
  const readToken = `read-${randomBytes(12).toString("hex")}`;
  const writeToken = `write-${randomBytes(12).toString("hex")}`;
  const port = 8080;
  const bare = `/tmp/git/${options.repositoryFullName}.git`;

  await mustSucceed(["network", "create", network]);
  await mustSucceed([
    "run",
    "--detach",
    "--name",
    container,
    "--network",
    network,
    options.image,
    "sleep",
    "3600",
  ]);
  const exec = (command: string, stdin?: string) =>
    mustSucceed(
      ["exec", ...(stdin === undefined ? [] : ["-i"]), container, "sh", "-ec", command],
      stdin,
    );

  for await (const file of walk(options.fixtureDirectory)) {
    const target = `/tmp/source/${relative(options.fixtureDirectory, file).split(sep).join("/")}`;
    await exec(
      `mkdir -p "$(dirname "${target}")" && cat > "${target}"`,
      await readFile(file, "utf8"),
    );
  }
  await exec(
    [
      "cd /tmp/source",
      "git init --quiet --initial-branch main",
      "git -c user.name=Fixture -c user.email=fixture@example.com add --all",
      "git -c user.name=Fixture -c user.email=fixture@example.com commit --quiet -m 'Initial commit'",
      `mkdir -p "$(dirname ${bare})"`,
      `git clone --quiet --bare /tmp/source ${bare}`,
      `git -C ${bare} config http.receivepack true`,
      `git -C ${bare} config uploadpack.allowReachableSHA1InWant true`,
    ].join(" && "),
  );
  await exec(
    "cat > /tmp/server.mjs",
    await readFile(join(options.fixtureDirectory, "..", "git-http-server.mjs"), "utf8"),
  );
  await mustSucceed([
    "exec",
    "--detach",
    container,
    "node",
    "/tmp/server.mjs",
    "/tmp/git",
    readToken,
    writeToken,
    String(port),
  ]);

  return {
    network,
    webUrl: `http://${container}:${port}`,
    readToken,
    writeToken,
    git: (args) => mustSucceed(["exec", container, "git", "-C", bare, ...args]),
    remove: async () => {
      await docker(["rm", "--force", container]);
      await docker(["network", "rm", network]);
    },
  };
}
