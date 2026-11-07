import { posix } from "node:path";
import { REPOSITORY_DIR } from "../sandbox/types";

const MAX_PATH_LENGTH = 400;
const GIT_INTERNALS = /(^|\/)\.git(\/|$)/;

// The GitHub App is deliberately not granted the workflows permission, so a change set that
// touches these files could never be pushed. Refusing early gives the model useful feedback.
const PROTECTED_WRITE_PREFIXES = [".github/workflows/"];

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

// Returns a normalised repository-relative path, or "." for the repository root.
export function resolveRepositoryPath(input: string): string {
  if (input.length > MAX_PATH_LENGTH) {
    throw new PathPolicyError(`Path is longer than ${MAX_PATH_LENGTH} characters`);
  }
  if (/[\x00-\x1f\x7f]/.test(input)) {
    throw new PathPolicyError("Path contains control characters");
  }
  if (input.includes("\\")) {
    throw new PathPolicyError("Use forward slashes in paths");
  }

  const prefix = `${REPOSITORY_DIR}/`;
  const relative =
    input === REPOSITORY_DIR ? "." : input.startsWith(prefix) ? input.slice(prefix.length) : input;
  if (relative.startsWith("/") || relative.startsWith("~")) {
    throw new PathPolicyError("Path must be relative to the repository root");
  }

  const normalized = posix.normalize(relative === "" ? "." : relative).replace(/\/+$/, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new PathPolicyError("Path escapes the repository");
  }
  if (GIT_INTERNALS.test(normalized)) {
    throw new PathPolicyError("The .git directory is not accessible");
  }
  return normalized === "" ? "." : normalized;
}

export function resolveWritablePath(input: string): string {
  const path = resolveRepositoryPath(input);
  if (path === ".") {
    throw new PathPolicyError("A file path is required");
  }
  if (PROTECTED_WRITE_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix))) {
    throw new PathPolicyError("CI workflow files can only be changed by a person");
  }
  return path;
}

export function isProtectedPath(path: string): boolean {
  return (
    GIT_INTERNALS.test(path) || PROTECTED_WRITE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}
