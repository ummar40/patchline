import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import { DockerSandboxProvider } from "@/worker/sandbox/docker-sandbox";
import { REPOSITORY_DIR, type Sandbox } from "@/worker/sandbox/types";
import { docker, sandboxImageAvailable } from "./support/docker";

const image = inject("sandboxImage");
const available = await sandboxImageAvailable(image);

const LIMITS = { cpuLimit: 1, memoryMb: 512, pidsLimit: 128, tmpfsMb: 64 };
const OPTIONS = { image, dockerBinary: "docker", egressNetwork: "bridge", ...LIMITS };
const provider = new DockerSandboxProvider({
  ...OPTIONS,
  namespace: `test-${randomBytes(4).toString("hex")}`,
});
const jobId = () => `t${randomBytes(8).toString("hex")}`;
const sh = (script: string) => ({ argv: ["sh", "-c", script], timeoutMs: 30_000 });

describe.skipIf(!available)("Docker sandbox", { timeout: 120_000 }, () => {
  const created: Sandbox[] = [];
  const create = async () => {
    const sandbox = await provider.create(jobId());
    created.push(sandbox);
    return sandbox;
  };

  afterEach(async () => {
    await Promise.all(created.splice(0).map((sandbox) => sandbox.destroy()));
  });
  afterAll(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("runs a command and reports output and exit code", async () => {
    const sandbox = await create();
    const ok = await sandbox.exec(sh("echo out; echo err >&2"));
    const failed = await sandbox.exec(sh("exit 7"));
    expect(ok).toMatchObject({ exitCode: 0, stdout: "out\n", stderr: "err\n", timedOut: false });
    expect(failed.exitCode).toBe(7);
  });

  it("keeps workspace state between commands of the same job only", async () => {
    const first = await create();
    const second = await create();
    await first.exec(
      sh(`mkdir -p ${REPOSITORY_DIR} && echo secret-of-first > ${REPOSITORY_DIR}/note.txt`),
    );

    expect((await first.exec(sh(`cat ${REPOSITORY_DIR}/note.txt`))).stdout).toBe(
      "secret-of-first\n",
    );
    expect((await second.exec(sh(`cat ${REPOSITORY_DIR}/note.txt`))).exitCode).not.toBe(0);
  });

  it("has no network unless a command is explicitly given egress", async () => {
    const sandbox = await create();
    const isolated = await sandbox.exec(sh("ls /sys/class/net"));
    const connected = await sandbox.exec({ ...sh("ls /sys/class/net"), network: "egress" });
    expect(isolated.stdout.trim()).toBe("lo");
    expect(connected.stdout).toContain("eth0");
  });

  it("runs unprivileged on a read-only root filesystem with resource limits", async () => {
    const sandbox = await create();
    const result = await sandbox.exec(
      sh(
        "id -u; grep CapEff /proc/self/status; touch /etc/probe 2>&1 || true; cat /sys/fs/cgroup/pids.max /sys/fs/cgroup/memory.max",
      ),
    );
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("10001");
    expect(lines[1]).toMatch(/CapEff:\s+0+$/);
    expect(lines[2]).toMatch(/Read-only file system/);
    expect(lines[3]).toBe(String(LIMITS.pidsLimit));
    expect(lines[4]).toBe(String(LIMITS.memoryMb * 1024 * 1024));
  });

  it("does not expose the worker's environment, and forwards secrets only when asked", async () => {
    process.env.OPENAI_API_KEY = "worker-only-secret";
    const sandbox = await create();
    const plain = await sandbox.exec(sh("env"));
    const forwarded = await sandbox.exec({
      ...sh("env"),
      secretEnv: { GIT_CONFIG_VALUE_0: "scoped-value" },
    });
    const smuggled = await sandbox.exec({
      ...sh("env"),
      secretEnv: { OPENAI_API_KEY: "explicit" },
    });

    expect(plain.stdout).not.toContain("worker-only-secret");
    expect(plain.stdout).not.toMatch(/DATABASE_URL|REDIS_URL|OPENAI/);
    expect(plain.stdout).toContain("HOME=/home/sandbox");
    expect(forwarded.stdout).toContain("GIT_CONFIG_VALUE_0=scoped-value");
    // Forwarding is by explicit value only; the worker's own variable never leaks through.
    expect(smuggled.stdout).toContain("OPENAI_API_KEY=explicit");
    expect(smuggled.stdout).not.toContain("worker-only-secret");
  });

  it("kills a command that exceeds its time limit", async () => {
    const sandbox = await create();
    const result = await sandbox.exec({ argv: ["sleep", "120"], timeoutMs: 2_000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(30_000);
  });

  it("stops a running command when the job is aborted", async () => {
    const sandbox = await create();
    const controller = new AbortController();
    const reason = new Error("cancelled by test");
    setTimeout(() => controller.abort(reason), 1_500);
    await expect(
      sandbox.exec({ argv: ["sleep", "120"], timeoutMs: 60_000, signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("bounds captured output", async () => {
    const sandbox = await create();
    const result = await sandbox.exec({
      ...sh("head -c 3000000 /dev/zero | tr '\\0' a"),
      maxOutputBytes: 100_000,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(110_000);
    expect(result.stdout).toContain("bytes omitted");
  });

  it("gives the publish profile a separate volume and a throwaway home", async () => {
    const sandbox = await create();
    await sandbox.exec(
      sh(
        "echo planted > /workspace/marker; echo '[core]\\n\\thooksPath = /workspace/evil' > /home/sandbox/.gitconfig",
      ),
    );
    const publish = await sandbox.exec({
      ...sh("ls -A /workspace /home/sandbox"),
      profile: "publish",
    });
    expect(publish.stdout).not.toContain("marker");
    expect(publish.stdout).not.toContain(".gitconfig");
  });

  it("removes containers and volumes on destroy", async () => {
    const sandbox = await provider.create(jobId());
    await sandbox.exec(sh("true"));
    await sandbox.destroy();
    const volumes = await docker([
      "volume",
      "ls",
      "--quiet",
      "--filter",
      `label=patchline.job=${sandbox.jobId}`,
    ]);
    expect(volumes.stdout.trim()).toBe("");
  });

  it("sweeps inactive jobs of its own namespace and nothing else", async () => {
    const neighbour = new DockerSandboxProvider({ ...OPTIONS, namespace: "test-neighbour" });
    const foreign = await neighbour.create(jobId());
    created.push(foreign);
    const orphan = await provider.create(jobId());
    const live = await create();

    const removed = await provider.removeOrphans((id) => Promise.resolve(id === live.jobId));

    expect(removed).toEqual([orphan.jobId]);
    expect((await live.exec(sh("true"))).exitCode).toBe(0);
    // Another deployment's workspace is left alone even though this database has no such job.
    expect((await foreign.exec(sh("true"))).exitCode).toBe(0);
    const volumes = await docker([
      "volume",
      "ls",
      "--quiet",
      "--filter",
      `label=patchline.job=${orphan.jobId}`,
    ]);
    expect(volumes.stdout.trim()).toBe("");
  });

  it("rejects job ids that are unsafe as resource names", async () => {
    await expect(provider.create("../escape")).rejects.toThrow(/not usable/);
    await expect(provider.create("a b")).rejects.toThrow(/not usable/);
  });
});
