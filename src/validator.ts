import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { JsonObject, SignalEvent } from "./types.js";

const coreSchema = JSON.parse(
  readFileSync(new URL("../schemas/signal-contract/1.0/schema.json", import.meta.url), "utf8"),
) as JsonObject;
const profileSchema = JSON.parse(
  readFileSync(new URL("../schemas/signal-contract/agent-lifecycle-0.1/profile.schema.json", import.meta.url), "utf8"),
) as JsonObject;

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) => Number.isFinite(Date.parse(value)) && value.includes("T"),
});
ajv.addSchema(coreSchema);
const validateProfile = ajv.compile(profileSchema);

export function assertValidSignal(event: SignalEvent): void {
  if (!validateProfile(event)) {
    throw new Error("Normalized event failed the vendored Signal Contract profile.");
  }
}

export function signalValidator(): ValidateFunction {
  return validateProfile;
}
