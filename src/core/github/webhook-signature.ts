import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

// GitHub signs the exact bytes it sent, so this must receive the raw request body, not a
// re-serialised object.
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader?.startsWith(PREFIX)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(signatureHeader.slice(PREFIX.length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
