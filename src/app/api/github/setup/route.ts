import { type NextRequest, NextResponse } from "next/server";
import { services } from "@/web/services";

export const dynamic = "force-dynamic";

// GitHub sends the browser here after the app is installed or its repository selection
// changes. The installation_id in the query string is attacker-controllable, so it is
// ignored entirely: a fresh sign-in pass asks GitHub what this user can actually access.
export function GET(request: NextRequest) {
  const { config } = services();
  const pending = request.nextUrl.searchParams.get("setup_action") === "request";
  const returnTo = pending ? "/settings/github?notice=pending" : "/settings/github?notice=synced";
  const start = new URL("/api/auth/github/start", config.appUrl);
  start.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(start);
}
