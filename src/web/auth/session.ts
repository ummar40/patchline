import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@/db";

const TOKEN_BYTES = 32;

// Only the digest is stored. A database leak therefore does not yield usable session tokens.
function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(db: Database, userId: string, ttlHours: number) {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db.session.create({ data: { userId, tokenHash: digest(token), expiresAt } });
  return { token, expiresAt };
}

export async function findSessionUser(db: Database, token: string) {
  const session = await db.session.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: { include: { identities: { select: { provider: true, login: true } } } } },
  });
  if (!session) {
    return null;
  }
  if (session.expiresAt <= new Date()) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session.user;
}

export async function destroySession(db: Database, token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: digest(token) } });
}

export async function destroyExpiredSessions(db: Database): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
