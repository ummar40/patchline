import { describe, expect, it } from "vitest";
import {
  PathPolicyError,
  isProtectedPath,
  resolveRepositoryPath,
  resolveWritablePath,
} from "./path-policy";

describe("resolveRepositoryPath", () => {
  it("normalises repository-relative paths", () => {
    expect(resolveRepositoryPath("src/index.ts")).toBe("src/index.ts");
    expect(resolveRepositoryPath("./src//lib/../index.ts")).toBe("src/index.ts");
    expect(resolveRepositoryPath("src/")).toBe("src");
    expect(resolveRepositoryPath("")).toBe(".");
    expect(resolveRepositoryPath(".")).toBe(".");
  });

  it("accepts absolute paths that point into the repository", () => {
    expect(resolveRepositoryPath("/workspace/repo/src/a.ts")).toBe("src/a.ts");
    expect(resolveRepositoryPath("/workspace/repo")).toBe(".");
  });

  it.each([
    "../secrets",
    "src/../../etc/passwd",
    "/etc/passwd",
    "/workspace/other",
    "/workspace/repo/../x",
    "~/.ssh/id_rsa",
    ".git/config",
    "src/.git/hooks/pre-commit",
    ".git",
    "src\\index.ts",
    "src/\u0000index.ts",
    "a\nb",
    "x".repeat(401),
  ])("rejects %j", (input) => {
    expect(() => resolveRepositoryPath(input)).toThrow(PathPolicyError);
  });

  it("does not confuse .git with similarly named files", () => {
    expect(resolveRepositoryPath(".gitignore")).toBe(".gitignore");
    expect(resolveRepositoryPath(".github/dependabot.yml")).toBe(".github/dependabot.yml");
  });
});

describe("resolveWritablePath", () => {
  it("requires a file path", () => {
    expect(() => resolveWritablePath(".")).toThrow(PathPolicyError);
  });

  it("protects CI workflow definitions", () => {
    expect(() => resolveWritablePath(".github/workflows/ci.yml")).toThrow(/workflow/);
    expect(() => resolveWritablePath("./.github/workflows/../workflows/release.yml")).toThrow(
      /workflow/,
    );
    expect(resolveWritablePath(".github/ISSUE_TEMPLATE/bug.md")).toBe(
      ".github/ISSUE_TEMPLATE/bug.md",
    );
  });

  it("classifies protected paths in a change set", () => {
    expect(isProtectedPath(".github/workflows/ci.yml")).toBe(true);
    expect(isProtectedPath("src/index.ts")).toBe(false);
  });
});
