import { type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/core/github/webhook-signature";
import { handleWebhookDelivery } from "@/core/github/webhooks";
import { services } from "@/web/services";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const { config, db, logger } = services();
  if (!config.github.webhookSecret) {
    return NextResponse.json({ error: "Webhooks are not configured" }, { status: 503 });
  }

  // This endpoint is unauthenticated until the signature is checked, so an oversized body
  // is turned away from its declared length before any of it is buffered.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(config.github.webhookSecret, rawBody, signature)) {
    logger.warn("Rejected webhook delivery with an invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  if (!deliveryId || !event) {
    return NextResponse.json({ error: "Missing delivery headers" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }

  const outcome = await handleWebhookDelivery(db, { deliveryId, event, payload });
  logger.info({ deliveryId, event, outcome }, "Webhook delivery handled");
  return NextResponse.json({ outcome }, { status: outcome === "invalid" ? 422 : 200 });
}
