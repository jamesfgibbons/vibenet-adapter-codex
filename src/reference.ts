import { createHmac } from "node:crypto";

export function referenceFor(key: string, namespace: string, value: string): string {
  if (key.length < 16) {
    throw new Error("Reference key must contain at least 16 characters.");
  }

  const digest = createHmac("sha256", key)
    .update(`${namespace}\u0000${value}`, "utf8")
    .digest("hex");
  return `hmac-sha256:${digest}`;
}

export function eventIdFor(key: string, stableInput: string): string {
  return `signal:${referenceFor(key, "event", stableInput).slice("hmac-sha256:".length)}`;
}
