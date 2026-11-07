import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  findAccessibleJob,
  findAccessibleRepository,
  listAccessibleInstallations,
  listAccessibleJobs,
  listAccessibleRepositories,
} from "@/core/access";
import { persistUserView, upsertUserFromProfile } from "@/core/github/user-view";
import { connectTestDatabase, resetDatabase } from "./support/database";
import {
  installationView,
  queueJob,
  repositoryByName,
  repositoryView,
  signIn,
} from "./support/factories";

const db = connectTestDatabase();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("installation ownership", () => {
  it("grants access only to what GitHub reported for that user", async () => {
    const acme = installationView("acme", [repositoryView("acme/api"), repositoryView("acme/web")]);
    const globex = installationView("globex", [repositoryView("globex/billing")]);
    const alice = await signIn(db, "alice", [acme]);
    const bob = await signIn(db, "bob", [globex]);

    expect(
      (await listAccessibleInstallations(db, alice.user.id)).map((row) => row.accountLogin),
    ).toEqual(["acme"]);
    expect(
      (await listAccessibleInstallations(db, bob.user.id)).map((row) => row.accountLogin),
    ).toEqual(["globex"]);
    expect(
      (await listAccessibleRepositories(db, alice.user.id)).map((row) => row.fullName),
    ).toEqual(["acme/api", "acme/web"]);
    expect((await listAccessibleRepositories(db, bob.user.id)).map((row) => row.fullName)).toEqual([
      "globex/billing",
    ]);
  });

  it("does not let a member see repositories GitHub hides from them in a shared installation", async () => {
    const api = repositoryView("acme/api");
    const payroll = repositoryView("acme/payroll");
    const installation = installationView("acme", [api, payroll]);
    const admin = await signIn(db, "admin", [installation]);
    const contractor = await signIn(db, "contractor", [{ ...installation, repositories: [api] }]);

    const payrollRow = await repositoryByName(db, "acme/payroll");
    expect(await findAccessibleRepository(db, admin.user.id, payrollRow.id)).not.toBeNull();
    expect(await findAccessibleRepository(db, contractor.user.id, payrollRow.id)).toBeNull();
    expect(
      (await listAccessibleRepositories(db, contractor.user.id)).map((row) => row.fullName),
    ).toEqual(["acme/api"]);
  });

  it("revokes access on the next synchronisation when GitHub stops reporting it", async () => {
    const api = repositoryView("acme/api");
    const web = repositoryView("acme/web");
    const installation = installationView("acme", [api, web]);
    const { user, view } = await signIn(db, "alice", [installation]);

    await persistUserView(db, user.id, {
      ...view,
      installations: [{ ...installation, repositories: [api] }],
    });
    expect((await listAccessibleRepositories(db, user.id)).map((row) => row.fullName)).toEqual([
      "acme/api",
    ]);

    await persistUserView(db, user.id, { ...view, installations: [] });
    expect(await listAccessibleRepositories(db, user.id)).toEqual([]);
    expect(await listAccessibleInstallations(db, user.id)).toEqual([]);
  });

  it("keeps another user's access when one user loses theirs", async () => {
    const installation = installationView("acme", [repositoryView("acme/api")]);
    const alice = await signIn(db, "alice", [installation]);
    const bob = await signIn(db, "bob", [installation]);

    await persistUserView(db, alice.user.id, { ...alice.view, installations: [] });

    expect(await listAccessibleRepositories(db, alice.user.id)).toEqual([]);
    expect((await listAccessibleRepositories(db, bob.user.id)).map((row) => row.fullName)).toEqual([
      "acme/api",
    ]);
  });

  it("records push permission per user", async () => {
    const readOnly = repositoryView("acme/api", { canPush: false });
    const installation = installationView("acme", [readOnly]);
    const reader = await signIn(db, "reader", [installation]);
    const writer = await signIn(db, "writer", [
      { ...installation, repositories: [{ ...readOnly, canPush: true }] },
    ]);

    const [asReader] = await listAccessibleRepositories(db, reader.user.id);
    const [asWriter] = await listAccessibleRepositories(db, writer.user.id);
    expect(asReader?.access[0]?.canPush).toBe(false);
    expect(asWriter?.access[0]?.canPush).toBe(true);
  });

  it("hides repositories of uninstalled installations and removed repositories", async () => {
    const installation = installationView("acme", [
      repositoryView("acme/api"),
      repositoryView("acme/web"),
    ]);
    const { user } = await signIn(db, "alice", [installation]);

    await db.repository.updateMany({
      where: { fullName: "acme/web" },
      data: { removedAt: new Date() },
    });
    expect((await listAccessibleRepositories(db, user.id)).map((row) => row.fullName)).toEqual([
      "acme/api",
    ]);

    await db.gitHubInstallation.updateMany({ data: { uninstalledAt: new Date() } });
    expect(await listAccessibleRepositories(db, user.id)).toEqual([]);
    expect(await listAccessibleInstallations(db, user.id)).toEqual([]);
  });

  it("reuses the same account when a user signs in again", async () => {
    const installation = installationView("acme", [repositoryView("acme/api")]);
    const first = await signIn(db, "alice", [installation]);
    const again = await upsertUserFromProfile(db, {
      ...first.view.profile,
      login: "alice-renamed",
    });

    expect(again.id).toBe(first.user.id);
    expect(await db.user.count()).toBe(1);
    expect((await db.authIdentity.findFirstOrThrow()).login).toBe("alice-renamed");
  });
});

describe("job authorization boundaries", () => {
  it("shows a job only to users with access to its repository", async () => {
    const acme = installationView("acme", [repositoryView("acme/api")]);
    const globex = installationView("globex", [repositoryView("globex/billing")]);
    const alice = await signIn(db, "alice", [acme]);
    const teammate = await signIn(db, "teammate", [acme]);
    const outsider = await signIn(db, "outsider", [globex]);

    const job = await queueJob(db, alice.user.id, (await repositoryByName(db, "acme/api")).id);

    expect((await findAccessibleJob(db, alice.user.id, job.id))?.id).toBe(job.id);
    expect((await findAccessibleJob(db, teammate.user.id, job.id))?.id).toBe(job.id);
    expect(await findAccessibleJob(db, outsider.user.id, job.id)).toBeNull();
    expect(await listAccessibleJobs(db, outsider.user.id)).toEqual([]);
    expect(
      await listAccessibleJobs(db, outsider.user.id, { repositoryId: job.repositoryId }),
    ).toEqual([]);
  });

  it("hides a user's own job once they lose access to the repository", async () => {
    const installation = installationView("acme", [repositoryView("acme/api")]);
    const { user, view } = await signIn(db, "alice", [installation]);
    const job = await queueJob(db, user.id, (await repositoryByName(db, "acme/api")).id);

    await persistUserView(db, user.id, { ...view, installations: [] });

    expect(await findAccessibleJob(db, user.id, job.id)).toBeNull();
  });

  it("returns nothing for identifiers that do not exist", async () => {
    const { user } = await signIn(db, "alice", []);
    expect(await findAccessibleJob(db, user.id, "missing")).toBeNull();
    expect(await findAccessibleRepository(db, user.id, "missing")).toBeNull();
  });
});
