import { isProtectedPath } from "../agent/path-policy";
import type { ChangeSet } from "../git/operations";

const LOCKFILES =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;

export type ChangeSetVerdict = { ok: true } | { ok: false; reason: string };

// Applied to the captured patch before it is verified, reviewed or published. These limits
// hold no matter how the files were changed, including by commands the agent ran.
export function checkChangeSet(
  changes: ChangeSet,
  limits: { maxFiles: number; maxPatchBytes: number },
): ChangeSetVerdict {
  if (changes.truncated || Buffer.byteLength(changes.patch) > limits.maxPatchBytes) {
    return {
      ok: false,
      reason: `The change is larger than the configured limit of ${limits.maxPatchBytes} bytes, which is more than a minimal fix should need.`,
    };
  }
  // The patch travels as text. Bytes that are not valid UTF-8 would be altered on the way and
  // the published commit would no longer match what was verified.
  if (changes.patch.includes("\uFFFD") || changes.patch.includes("\u0000")) {
    return {
      ok: false,
      reason:
        "The change includes file content that is not valid UTF-8 text, which cannot be published reliably.",
    };
  }
  if (changes.files.length > limits.maxFiles) {
    return {
      ok: false,
      reason: `The change touches ${changes.files.length} files; the configured limit is ${limits.maxFiles}.`,
    };
  }
  const protectedPaths = changes.files
    .filter((file) => isProtectedPath(file.path))
    .map((file) => file.path);
  if (protectedPaths.length > 0) {
    return {
      ok: false,
      reason: `The change modifies protected files that only a person may change: ${protectedPaths.join(", ")}.`,
    };
  }
  const lockfiles = changes.files
    .filter((file) => LOCKFILES.test(file.path))
    .map((file) => file.path);
  if (lockfiles.length > 0) {
    return {
      ok: false,
      reason: `The change modifies dependency lockfiles (${lockfiles.join(", ")}). Dependency changes need a person.`,
    };
  }
  return { ok: true };
}
