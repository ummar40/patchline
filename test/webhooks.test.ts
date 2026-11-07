import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAccessibleRepositories } from "@/core/access";
import { handleWebhookDelivery } from "@/core/github/webhooks";
import { connectTestDatabase, resetDatabase } from "./support/database";
import { installationView, repositoryView, signIn } from "./support/factories";

const db = connectTestDatabase();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

let delivery = 0;
const deliver = (event: string, payload: unknown, deliveryId = `delivery-${(delivery += 1)}`) =>
  handleWebhookDelivery(db, { deliveryId, event, payload });

function installationPayload(action: string, id: bigint, login = "acme") {
  return {
    action,
    installation: {
      id: Number(id),
      account: { id: 42, login, type: "Organization", avatar_url: null },
      repository_selection: "selected",
      suspended_at: action === "suspend" ? "2026-01-01T00:00:00Z" : null,
    },
  };
}

describe("webhook deliveries", () => {
  it("records a new installation without granting anyone access", async () => {
    expect(await deliver("installation", installationPayload("created", 9001n))).toBe("processed");

    const installation = await db.gitHubInstallation.findUniqueOrThrow({
      where: { githubInstallationId: 9001n },
    });
    expect(installation.accountLogin).toBe("acme");
    expect(await db.installationAccess.count()).toBe(0);
    expect(await db.repositoryAccess.count()).toBe(0);
  });

  it("processes each delivery id once", async () => {
    const payload = installationPayload("created", 9002n);
    expect(await deliver("installation", payload, "same-id")).toBe("processed");
    expect(await deliver("installation", payload, "same-id")).toBe("duplicate");
  });

  it("hides repositories when the app is uninstalled", async () => {
    const view = installationView("acme", [repositoryView("acme/api")]);
    const { user } = await signIn(db, "alice", [view]);

    await deliver("installation", installationPayload("deleted", view.githubInstallationId));

    expect(await listAccessibleRepositories(db, user.id)).toEqual([]);
    const stored = await db.gitHubInstallation.findUniqueOrThrow({
      where: { githubInstallationId: view.githubInstallationId },
    });
    expect(stored.uninstalledAt).toBeInstanceOf(Date);
  });

  it("tracks suspension", async () => {
    const view = installationView("acme", []);
    await signIn(db, "alice", [view]);
    await deliver("installation", installationPayload("suspend", view.githubInstallationId));
    const where = { githubInstallationId: view.githubInstallationId };
    expect((await db.gitHubInstallation.findUniqueOrThrow({ where })).suspendedAt).toBeInstanceOf(
      Date,
    );

    await deliver("installation", installationPayload("unsuspend", view.githubInstallationId));
    expect((await db.gitHubInstallation.findUniqueOrThrow({ where })).suspendedAt).toBeNull();
  });

  it("hides a repository that was removed from the installation", async () => {
    const api = repositoryView("acme/api");
    const web = repositoryView("acme/web");
    const view = installationView("acme", [api, web]);
    const { user } = await signIn(db, "alice", [view]);

    await deliver("installation_repositories", {
      ...installationPayload("removed", view.githubInstallationId),
      repositories_removed: [{ id: Number(web.githubRepoId) }],
      repositories_added: [],
    });

    expect((await listAccessibleRepositories(db, user.id)).map((row) => row.fullName)).toEqual([
      "acme/api",
    ]);
  });

  it("follows repository renames and default branch changes", async () => {
    const api = repositoryView("acme/api");
    await signIn(db, "alice", [installationView("acme", [api])]);

    await deliver("repository", {
      action: "renamed",
      repository: {
        id: Number(api.githubRepoId),
        name: "core-api",
        full_name: "acme/core-api",
        owner: { login: "acme" },
        private: true,
        archived: false,
        default_branch: "trunk",
      },
    });

    const stored = await db.repository.findUniqueOrThrow({
      where: { githubRepoId: api.githubRepoId },
    });
    expect(stored).toMatchObject({
      name: "core-api",
      fullName: "acme/core-api",
      defaultBranch: "trunk",
    });
  });

  it("ignores unrelated events and rejects malformed payloads", async () => {
    expect(await deliver("star", { action: "created" })).toBe("ignored");
    expect(await deliver("installation", { action: "created", installation: { id: "nope" } })).toBe(
      "invalid",
    );
  });
});
