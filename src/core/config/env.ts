import { z } from "zod";

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export type EnvSource = Record<string, string | undefined>;

// Issue messages name the variable and the rule that failed. They never echo the value,
// because a malformed secret is still a secret.
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  env: EnvSource,
): z.output<Schema> {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = schema.safeParse(present);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const name = issue.path.join(".") || "(root)";
        return name in present ? `${name}: ${issue.message}` : `${name}: is required`;
      }),
    );
  }
  return result.data;
}

export const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

export const optionalNonNegativeNumber = z.coerce.number().nonnegative().optional();

export const httpUrl = z
  .url({ protocol: /^https?$/ })
  .transform((value) => value.replace(/\/+$/, ""));

const PEM_HEADER = "-----BEGIN";

// Accepts a PEM with real newlines, a PEM with escaped newlines (common in .env files),
// or a base64-encoded PEM.
export const pemPrivateKey = z.string().transform((value, context) => {
  const trimmed = value.trim();
  const candidate = (
    trimmed.startsWith(PEM_HEADER)
      ? trimmed.replace(/\\n/g, "\n")
      : Buffer.from(trimmed, "base64").toString("utf8")
  ).trim();
  if (!candidate.startsWith(PEM_HEADER) || !candidate.includes("PRIVATE KEY-----")) {
    context.addIssue({
      code: "custom",
      message: "must be a PEM private key, optionally base64-encoded",
    });
    return z.NEVER;
  }
  return candidate;
});
