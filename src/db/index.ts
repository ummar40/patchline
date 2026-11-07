import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export type Database = PrismaClient;
export type { Prisma } from "./generated/client";

export function createDatabase(url: string): Database {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
