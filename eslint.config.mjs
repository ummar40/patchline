import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const webOnly = ["@/app", "@/app/*", "@/components", "@/components/*", "@/web", "@/web/*"];
const workerOnly = ["@/worker", "@/worker/*"];
const webFrameworks = ["next", "next/*", "react", "react-dom", "react-dom/*", "server-only"];
const processExecution = [
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads",
];

const restrict = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

export default defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "coverage/**",
    "next-env.d.ts",
    "src/db/generated/**",
    "test/fixtures/**",
  ]),
  tseslint.configs.recommended,
  nextPlugin.configs["core-web-vitals"],
  reactHooks.configs.flat["recommended-latest"],
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The control plane never executes processes and never reaches into worker code.
    files: ["src/app/**", "src/components/**", "src/web/**"],
    rules: restrict(
      { group: workerOnly, message: "The web process must not import worker code." },
      { group: processExecution, message: "The web process must not start processes." },
    ),
  },
  {
    files: ["src/core/**", "src/db/**"],
    rules: restrict(
      {
        group: [...webOnly, ...workerOnly],
        message: "Shared modules must not depend on the web app or the worker.",
      },
      {
        group: processExecution,
        message: "Process execution is confined to src/worker/sandbox.",
      },
    ),
  },
  {
    files: ["src/worker/**"],
    rules: restrict(
      {
        group: [...webOnly, ...webFrameworks],
        message: "The worker must not depend on the web application.",
      },
      {
        group: processExecution,
        message: "Process execution is confined to src/worker/sandbox.",
      },
    ),
  },
  {
    // The sandbox layer is the one place allowed to start a process, and the only process
    // it starts is the container runtime CLI.
    files: ["src/worker/sandbox/**"],
    rules: restrict({
      group: [...webOnly, ...webFrameworks],
      message: "The worker must not depend on the web application.",
    }),
  },
]);
