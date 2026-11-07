"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { services } from "../services";
import { cookieNames } from "./cookies";
import { destroySession } from "./session";

export async function signOutAction(): Promise<void> {
  const { config, db } = services();
  const store = await cookies();
  const name = cookieNames(config.appUrl).session;
  const token = store.get(name)?.value;
  if (token) {
    await destroySession(db, token);
  }
  store.delete(name);
  redirect("/");
}
