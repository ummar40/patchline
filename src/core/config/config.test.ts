import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { clearRegisteredSecrets, redactText } from "../logging/redaction";
import { ConfigError, loadWebConfig, loadWorkerConfig } from "./index";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const common = {
  APP_URL: "http://localhost:3000/",
  DATABASE_URL: "postgresql://app:db-password-value@localhost:5432/app",
  REDIS_URL: "redis://localhost:6379",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: pem,
};

const web = {
  ...common,
  GITHUB_APP_SLUG: "patchline-dev",
  GITHUB_APP_CLIENT_ID: "Iv1.abcdef",
  GITHUB_APP_CLIENT_SECRET: "client-secret-value",
};

const worker = {
  ...common,
  OPENAI_API_KEY: "openai-key-value",
  OPENAI_MODEL: "some-model",
  OPENAI_REASONING_EFFORT: "high",
  SANDBOX_IMAGE: "sandbox:test",
  GIT_COMMIT_AUTHOR_NAME: "Patchline",
  GIT_COMMIT_AUTHOR_EMAIL: "bot@example.com",
};

function issuesOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error("expected a ConfigError");
}

afterEach(() => clearRegisteredSecrets());

describe("web configuration", () => {
  it("accepts a complete environment and applies defaults", () => {
    const config = loadWebConfig(web);
    expect(config.appUrl).toBe("http://localhost:3000");
    expect(config.github.apiUrl).toBe("https://api.github.com");
    expect(config.session.ttlHours).toBe(168);
    expect(config.github.webhookSecret).toBeUndefined();
  });

  it("names every missing variable at once", () => {
    const issues = issuesOf(() => loadWebConfig({}));
    for (const name of [
      "APP_URL",
      "DATABASE_URL",
      "REDIS_URL",
      "GITHUB_APP_ID",
      "GITHUB_APP_CLIENT_SECRET",
    ]) {
      expect(issues.some((issue) => issue.startsWith(`${name}:`))).toBe(true);
    }
  });

  it("treats blank values as missing", () => {
    const issues = issuesOf(() => loadWebConfig({ ...web, GITHUB_APP_SLUG: "  " }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^GITHUB_APP_SLUG:/);
  });

  it("does not require worker-only secrets", () => {
    expect(() => loadWebConfig(web)).not.toThrow();
    expect(Object.keys(web)).not.toContain("OPENAI_API_KEY");
  });

  it("never echoes a rejected value", () => {
    const issues = issuesOf(() =>
      loadWebConfig({
        ...web,
        DATABASE_URL: "mysql://root:super-secret-password@db/app",
        GITHUB_APP_PRIVATE_KEY: "not-a-key-but-secret",
      }),
    );
    expect(issues.join("\n")).not.toContain("super-secret-password");
    expect(issues.join("\n")).not.toContain("not-a-key-but-secret");
  });
});

describe("private key formats", () => {
  it("accepts escaped newlines and base64", () => {
    const escaped = loadWebConfig({ ...web, GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, "\\n") });
    const encoded = loadWebConfig({
      ...web,
      GITHUB_APP_PRIVATE_KEY: Buffer.from(pem).toString("base64"),
    });
    expect(escaped.github.privateKey).toBe(pem.trim());
    expect(encoded.github.privateKey).toBe(pem.trim());
  });
});

describe("worker configuration", () => {
  it("accepts a complete environment", () => {
    const config = loadWorkerConfig(worker);
    expect(config.model.id).toBe("some-model");
    expect(config.model.pricing).toBeUndefined();
    expect(config.sandbox.egressNetwork).toBe("bridge");
    expect(config.agent.maxRepairIterations).toBeGreaterThan(0);
  });

  it("has no default model and no default sandbox image", () => {
    const { OPENAI_MODEL: _model, SANDBOX_IMAGE: _image, ...rest } = worker;
    const issues = issuesOf(() => loadWorkerConfig(rest));
    expect(issues.some((issue) => issue.startsWith("OPENAI_MODEL:"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("SANDBOX_IMAGE:"))).toBe(true);
  });

  it("rejects an unknown reasoning effort and non-positive limits", () => {
    const issues = issuesOf(() =>
      loadWorkerConfig({
        ...worker,
        OPENAI_REASONING_EFFORT: "extreme",
        AGENT_MAX_TURNS: "0",
        SANDBOX_MEMORY_MB: "-1",
      }),
    );
    expect(issues.map((issue) => issue.split(":")[0])).toEqual(
      expect.arrayContaining(["OPENAI_REASONING_EFFORT", "AGENT_MAX_TURNS", "SANDBOX_MEMORY_MB"]),
    );
  });

  it("builds pricing only when input and output prices are present", () => {
    const config = loadWorkerConfig({
      ...worker,
      MODEL_PRICE_INPUT_PER_MTOK: "10",
      MODEL_PRICE_OUTPUT_PER_MTOK: "50",
    });
    expect(config.model.pricing).toEqual({
      inputPerMTok: 10,
      cachedInputPerMTok: 10,
      outputPerMTok: 50,
    });
  });

  it("accepts a GitHub bot identity as commit author and rejects header-breaking values", () => {
    const bot = "123456+patchline-dev[bot]@users.noreply.github.com";
    expect(loadWorkerConfig({ ...worker, GIT_COMMIT_AUTHOR_EMAIL: bot }).git.authorEmail).toBe(bot);
    for (const bad of ["not-an-email", "a b@example.com", "bot@example.com>", "<bot@example.com"]) {
      const issues = issuesOf(() => loadWorkerConfig({ ...worker, GIT_COMMIT_AUTHOR_EMAIL: bad }));
      expect(issues[0]).toMatch(/^GIT_COMMIT_AUTHOR_EMAIL:/);
    }
  });

  it("uses the queue name as sandbox namespace unless one is given", () => {
    expect(loadWorkerConfig(worker).sandbox.namespace).toBe("maintenance-jobs");
    expect(loadWorkerConfig({ ...worker, SANDBOX_NAMESPACE: "staging" }).sandbox.namespace).toBe(
      "staging",
    );
  });

  it("registers loaded secrets for redaction", () => {
    loadWorkerConfig(worker);
    expect(redactText("key=openai-key-value pw=db-password-value")).not.toMatch(
      /openai-key-value|db-password-value/,
    );
  });

  it("does not require web-only secrets", () => {
    expect(Object.keys(worker)).not.toContain("GITHUB_APP_CLIENT_SECRET");
    expect(() => loadWorkerConfig(worker)).not.toThrow();
  });
});
