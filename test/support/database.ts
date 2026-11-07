import { inject } from "vitest";
import { type Database, createDatabase } from "@/db";

export function connectTestDatabase(): Database {
  return createDatabase(inject("testDatabaseUrl"));
}

export async function resetDatabase(db: Database): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length > 0) {
    const names = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }
}
