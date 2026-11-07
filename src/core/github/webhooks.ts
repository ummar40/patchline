import { z } from "zod";
import type { Database } from "@/db";

const accountSchema = z.object({
  id: z.number(),
  login: z.string(),
  type: z.string().optional(),
  avatar_url: z.string().nullish(),
});

const installationSchema = z.object({
  id: z.number(),
  account: accountSchema,
  repository_selection: z.enum(["all", "selected"]),
  suspended_at: z.string().nullish(),
});

const repositoryRefSchema = z.object({ id: z.number() });

const installationEventSchema = z.object({
  action: z.string(),
  installation: installationSchema,
});

const installationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: installationSchema,
  repositories_added: z.array(repositoryRefSchema).default([]),
  repositories_removed: z.array(repositoryRefSchema).default([]),
});

const repositoryEventSchema = z.object({
  action: z.string(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    owner: z.object({ login: z.string() }),
    private: z.boolean(),
    archived: z.boolean().default(false),
    default_branch: z.string(),
  }),
});

export type WebhookDeliveryInput = {
  deliveryId: string;
  event: string;
  payload: unknown;
};

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "invalid";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// Webhooks keep shared installation and repository rows fresh between user synchronisations.
// They never grant access: access rows are only written from a user's own GitHub view.
export async function handleWebhookDelivery(
  db: Database,
  delivery: WebhookDeliveryInput,
  now = new Date(),
): Promise<WebhookOutcome> {
  const action =
    typeof delivery.payload === "object" &&
    delivery.payload !== null &&
    "action" in delivery.payload
      ? String(delivery.payload.action)
      : undefined;

  try {
    await db.webhookDelivery.create({
      data: { id: delivery.deliveryId, event: delivery.event, action },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return "duplicate";
    }
    throw error;
  }

  try {
    return await applyDelivery(db, delivery, now);
  } catch (error) {
    // Forget the delivery so GitHub's redelivery is processed instead of being skipped.
    await db.webhookDelivery.deleteMany({ where: { id: delivery.deliveryId } });
    throw error;
  }
}

async function applyDelivery(
  db: Database,
  delivery: WebhookDeliveryInput,
  now: Date,
): Promise<WebhookOutcome> {
  switch (delivery.event) {
    case "installation": {
      const parsed = installationEventSchema.safeParse(delivery.payload);
      if (!parsed.success) {
        return "invalid";
      }
      const { installation } = parsed.data;
      const githubInstallationId = BigInt(installation.id);
      const details = {
        accountGithubId: BigInt(installation.account.id),
        accountLogin: installation.account.login,
        accountType:
          installation.account.type === "Organization"
            ? ("ORGANIZATION" as const)
            : ("USER" as const),
        accountAvatarUrl: installation.account.avatar_url ?? null,
        repositorySelection:
          installation.repository_selection === "all" ? ("ALL" as const) : ("SELECTED" as const),
        suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
      };

      if (parsed.data.action === "deleted") {
        const existing = await db.gitHubInstallation.findUnique({
          where: { githubInstallationId },
        });
        if (existing) {
          await db.$transaction([
            db.gitHubInstallation.update({
              where: { id: existing.id },
              data: { uninstalledAt: now },
            }),
            db.repository.updateMany({
              where: { installationId: existing.id, removedAt: null },
              data: { removedAt: now },
            }),
          ]);
        }
        return "processed";
      }

      await db.gitHubInstallation.upsert({
        where: { githubInstallationId },
        create: { githubInstallationId, ...details },
        update: { ...details, uninstalledAt: null },
      });
      return "processed";
    }

    case "installation_repositories": {
      const parsed = installationRepositoriesEventSchema.safeParse(delivery.payload);
      if (!parsed.success) {
        return "invalid";
      }
      const removed = parsed.data.repositories_removed.map((repository) => BigInt(repository.id));
      const added = parsed.data.repositories_added.map((repository) => BigInt(repository.id));
      if (removed.length > 0) {
        await db.repository.updateMany({
          where: { githubRepoId: { in: removed }, removedAt: null },
          data: { removedAt: now },
        });
      }
      // Newly added repositories are created when a user next synchronises, because only
      // that view carries per-user permissions. Rows that already exist are simply revived.
      if (added.length > 0) {
        await db.repository.updateMany({
          where: { githubRepoId: { in: added } },
          data: { removedAt: null },
        });
      }
      return "processed";
    }

    case "repository": {
      const parsed = repositoryEventSchema.safeParse(delivery.payload);
      if (!parsed.success) {
        return "invalid";
      }
      const { repository } = parsed.data;
      await db.repository.updateMany({
        where: { githubRepoId: BigInt(repository.id) },
        data: {
          name: repository.name,
          fullName: repository.full_name,
          ownerLogin: repository.owner.login,
          isPrivate: repository.private,
          isArchived: repository.archived,
          defaultBranch: repository.default_branch,
          removedAt: parsed.data.action === "deleted" ? now : undefined,
        },
      });
      return "processed";
    }

    default:
      return "ignored";
  }
}
