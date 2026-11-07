import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  REDACTED,
  clearRegisteredSecrets,
  redactText,
  redactValue,
  registerSecret,
} from "./redaction";

afterEach(() => clearRegisteredSecrets());

describe("redactText", () => {
  it("removes GitHub tokens of every prefix", () => {
    for (const prefix of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
      const token = `${prefix}_${"a1B2c3D4e5".repeat(4)}`;
      expect(redactText(`token=${token} done`)).toBe(`token=${REDACTED} done`);
    }
    expect(redactText(`github_pat_${"A".repeat(30)}`)).toBe(REDACTED);
  });

  it("removes API keys, AWS key ids and JWTs", () => {
    expect(redactText(`key sk-proj-${"x".repeat(40)}`)).toBe(`key ${REDACTED}`);
    expect(redactText("id AKIAIOSFODNN7EXAMPLE")).toBe(`id ${REDACTED}`);
    const jwt = `eyJhbGciOiJSUzI1NiJ9.${"b".repeat(20)}.${"c".repeat(20)}`;
    expect(redactText(jwt)).toBe(REDACTED);
  });

  it("removes credentials embedded in URLs and authorization headers", () => {
    expect(redactText("clone https://x-access-token:abc123@github.com/o/r.git")).toBe(
      `clone https://${REDACTED}@github.com/o/r.git`,
    );
    expect(redactText("postgresql://user:hunter2@db:5432/app")).toBe(
      `postgresql://${REDACTED}@db:5432/app`,
    );
    expect(redactText("Authorization: Basic dXNlcjpwYXNz")).toBe(
      `Authorization: Basic ${REDACTED}`,
    );
    expect(redactText("authorization=Bearer abc.def.ghi")).toBe(`authorization=Bearer ${REDACTED}`);
  });

  it("removes PEM private keys", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA\n-----END RSA PRIVATE KEY-----";
    expect(redactText(`key:\n${pem}\nend`)).toBe(`key:\n${REDACTED}\nend`);
  });

  it("removes registered exact values that match no pattern", () => {
    registerSecret("correct-horse-battery");
    expect(redactText("password is correct-horse-battery!")).toBe(`password is ${REDACTED}!`);
  });

  it("ignores registered values too short to be secrets", () => {
    registerSecret("abc");
    expect(redactText("abc")).toBe("abc");
  });

  it("leaves ordinary text alone", () => {
    const text = "npm test exited with code 1 after 3.2s (12 passed, 1 failed)";
    expect(redactText(text)).toBe(text);
  });
});

describe("redactValue", () => {
  it("masks values stored under credential-like keys", () => {
    expect(
      redactValue({
        accessToken: "anything",
        client_secret: "anything",
        nested: { password: "p", apiKey: "k", Authorization: "Bearer x" },
      }),
    ).toEqual({
      accessToken: REDACTED,
      client_secret: REDACTED,
      nested: { password: REDACTED, apiKey: REDACTED, Authorization: REDACTED },
    });
  });

  it("keeps token usage counters readable", () => {
    const usage = {
      inputTokens: 1200,
      cachedInputTokens: 800,
      outputTokens: 90,
      maxOutputTokens: 5,
    };
    expect(redactValue(usage)).toEqual(usage);
  });

  it("scrubs strings inside arrays and errors", () => {
    const token = `ghs_${"z".repeat(36)}`;
    const result = redactValue({
      lines: [`a ${token}`],
      err: new Error(`failed with ${token}`),
    }) as {
      lines: string[];
      err: { message: string };
    };
    expect(result.lines[0]).toBe(`a ${REDACTED}`);
    expect(result.err.message).toBe(`failed with ${REDACTED}`);
  });

  it("stops at a fixed depth instead of recursing forever", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => redactValue(cyclic)).not.toThrow();
  });
});

describe("logger integration", () => {
  it("never writes a secret to the log stream", async () => {
    const { createLogger } = await import("./logger");
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const token = `ghs_${"q".repeat(36)}`;
    registerSecret("registered-secret-value");

    const logger = createLogger({ service: "test", level: "info", destination: sink });

    logger.info(
      { url: `https://x-access-token:${token}@github.com/o/r`, installationToken: token },
      `cloning with ${token}`,
    );
    logger.error({ err: new Error(`boom registered-secret-value ${token}`) }, "failed");

    const output = lines.join("");
    expect(output).not.toContain(token);
    expect(output).not.toContain("registered-secret-value");
    expect(output).toContain(REDACTED);
  });
});
