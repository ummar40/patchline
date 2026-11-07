import type { Database, Prisma } from "@/db";

// Every user-facing read goes through these helpers. A row is visible only when GitHub
// reported, at the user's last synchronisation, that the user can reach the repository.

function visibleRepository(userId: string) {
  return {
    removedAt: null,
    installation: { uninstalledAt: null },
    access: { some: { userId } },
  } satisfies Prisma.RepositoryWhereInput;
}

function visibleJob(userId: string) {
  return {
    repository: { access: { some: { userId } } },
  } satisfies Prisma.MaintenanceJobWhereInput;
}

export async function listAccessibleInstallations(db: Database, userId: string) {
  return db.gitHubInstallation.findMany({
    where: { uninstalledAt: null, access: { some: { userId } } },
    orderBy: { accountLogin: "asc" },
    include: {
      _count: {
        select: { repositories: { where: { removedAt: null, access: { some: { userId } } } } },
      },
    },
  });
}

export async function listAccessibleRepositories(
  db: Database,
  userId: string,
  options: { search?: string } = {},
) {
  return db.repository.findMany({
    where: {
      ...visibleRepository(userId),
      ...(options.search
        ? { fullName: { contains: options.search, mode: "insensitive" as const } }
        : {}),
    },
    orderBy: { fullName: "asc" },
    include: {
      installation: { select: { accountLogin: true, suspendedAt: true } },
      access: { where: { userId }, select: { canPush: true } },
      _count: { select: { jobs: true } },
    },
  });
}

export async function findAccessibleRepository(db: Database, userId: string, repositoryId: string) {
  return db.repository.findFirst({
    where: { id: repositoryId, ...visibleRepository(userId) },
    include: {
      installation: true,
      access: { where: { userId }, select: { canPush: true, verifiedAt: true } },
    },
  });
}

export async function listAccessibleJobs(
  db: Database,
  userId: string,
  options: { repositoryId?: string; take?: number } = {},
) {
  return db.maintenanceJob.findMany({
    where: { ...visibleJob(userId), repositoryId: options.repositoryId },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 50,
    include: {
      repository: { select: { id: true, fullName: true } },
      createdBy: { select: { name: true } },
      pullRequest: { select: { number: true, url: true } },
    },
  });
}

export async function findAccessibleJob(db: Database, userId: string, jobId: string) {
  return db.maintenanceJob.findFirst({
    where: { id: jobId, ...visibleJob(userId) },
    include: {
      repository: { include: { installation: true } },
      createdBy: { select: { id: true, name: true, avatarUrl: true } },
      pullRequest: true,
    },
  });
}

export async function countAccessibleJobsByStatus(db: Database, userId: string) {
  const groups = await db.maintenanceJob.groupBy({
    by: ["status"],
    where: visibleJob(userId),
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.status, group._count._all]));
}
