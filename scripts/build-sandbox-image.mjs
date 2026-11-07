// Builds the sandbox execution image under the tag the worker is configured to use.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const image = process.env.SANDBOX_IMAGE;
if (!image) {
  console.error("SANDBOX_IMAGE is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const docker = process.env.SANDBOX_DOCKER_BINARY ?? "docker";
const result = spawnSync(docker, ["build", "--tag", image, "docker/sandbox"], { stdio: "inherit" });
if (result.error) {
  console.error(`Could not run ${docker}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
