import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook-signature";

const secret = "webhook-secret-for-tests";
const body = JSON.stringify({ action: "created", installation: { id: 1 } });
const sign = (key: string, payload: string) =>
  `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;

describe("verifyWebhookSignature", () => {
  it("accepts the signature GitHub would send", () => {
    expect(verifyWebhookSignature(secret, body, sign(secret, body))).toBe(true);
  });

  it("matches the documented GitHub test vector", () => {
    expect(
      verifyWebhookSignature(
        "It's a Secret to Everybody",
        "Hello, World!",
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      ),
    ).toBe(true);
  });

  it("rejects a body that was altered after signing", () => {
    expect(verifyWebhookSignature(secret, `${body} `, sign(secret, body))).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWebhookSignature(secret, body, sign("other-secret", body))).toBe(false);
  });

  it("rejects missing, malformed and legacy signatures", () => {
    expect(verifyWebhookSignature(secret, body, null)).toBe(false);
    expect(verifyWebhookSignature(secret, body, "")).toBe(false);
    expect(verifyWebhookSignature(secret, body, "sha256=")).toBe(false);
    expect(verifyWebhookSignature(secret, body, "sha256=zz")).toBe(false);
    expect(
      verifyWebhookSignature(secret, body, sign(secret, body).replace("sha256=", "sha1=")),
    ).toBe(false);
    expect(verifyWebhookSignature(secret, body, sign(secret, body).slice(0, -2))).toBe(false);
  });
});
