import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { JsonObject } from "./types.js";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(readFileSync(new URL("schemas/lock.json", root), "utf8")) as JsonObject;
const files = lock.files;
if (typeof files !== "object" || files === null || Array.isArray(files)) {
  throw new Error("Schema lock is malformed.");
}

for (const [path, expected] of Object.entries(files)) {
  if (typeof expected !== "string") throw new Error("Schema lock is malformed.");
  const actual = createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
  if (actual !== expected) throw new Error(`Schema lock mismatch: ${path}`);
}

process.stdout.write(`Verified ${Object.keys(files).length} vendored schema locks.\n`);
