import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { services } from "../services";
import { cookieNames } from "./cookies";
import { findSessionUser } from "./session";

export const getCurrentUser = cache(async () => {
  // Reading cookies first opts the route into request-time rendering, so nothing below
  // runs during a production build, where the environment is not configured.
  const store = await cookies();
  const { config, db } = services();
  const token = store.get(cookieNames(config.appUrl).session)?.value;
  return token ? findSessionUser(db, token) : null;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

// Called by every authenticated page and action. Layouts are not re-rendered on client
// navigation, so a layout-only check would not protect individual routes.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  return user;
}

export function githubLogin(user: CurrentUser): string | undefined {
  return user.identities.find((identity) => identity.provider === "GITHUB")?.login;
}
