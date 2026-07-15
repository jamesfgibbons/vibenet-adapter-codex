import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import type { CompatibilityCounters, ExtractedSourceEvent, JsonObject } from "./types.js";

const SOURCE_VERSION = "0.144.4";
const notificationSchema = JSON.parse(
  readFileSync(new URL(`../schemas/codex-app-server/${SOURCE_VERSION}/ServerNotification.json`, import.meta.url), "utf8"),
) as JsonObject;
const requestSchema = JSON.parse(
  readFileSync(new URL(`../schemas/codex-app-server/${SOURCE_VERSION}/ServerRequest.json`, import.meta.url), "utf8"),
) as JsonObject;

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validateNotification = ajv.compile(notificationSchema);
const validateRequest = ajv.compile(requestSchema);

const notificationMethods = new Set(["error", "thread/status/changed", "turn/started", "turn/completed"]);
const approvalMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);
const inputMethods = new Set(["item/tool/requestUserInput", "mcpServer/elicitation/request"]);
const requestMethods = new Set([...approvalMethods, ...inputMethods]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(object: JsonObject, key: string): string | null {
  const value = object[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requestId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return null;
}

function extractRecognized(
  message: JsonObject,
  observedAt: string,
  timestampSemantics: ExtractedSourceEvent["timestampSemantics"],
  sourceSequence: number,
): ExtractedSourceEvent | null {
  const method = stringField(message, "method");
  const params = message.params;
  if (!method || !isObject(params)) return null;

  if (method === "thread/status/changed") {
    const threadId = stringField(params, "threadId");
    const status = params.status;
    if (!threadId || !isObject(status)) return null;
    const type = stringField(status, "type");
    let normalized: ExtractedSourceEvent["status"];
    if (type === "notLoaded") normalized = "not_loaded";
    else if (type === "idle") normalized = "idle";
    else if (type === "systemError") normalized = "system_error_terminal";
    else if (type === "active") {
      const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
      if (flags.includes("waitingOnApproval")) normalized = "approval_requested";
      else if (flags.includes("waitingOnUserInput")) normalized = "input_requested";
      else normalized = "running";
    } else return null;
    return {
      method,
      observedAt,
      timestampSemantics,
      sourceSequence,
      rawThreadId: threadId,
      rawTurnId: null,
      rawRequestId: null,
      status: normalized,
    };
  }

  if (method === "turn/started" || method === "turn/completed") {
    const threadId = stringField(params, "threadId");
    const turn = params.turn;
    if (!threadId || !isObject(turn)) return null;
    const turnId = stringField(turn, "id");
    const turnStatus = stringField(turn, "status");
    if (!turnId || !turnStatus) return null;
    let normalized: ExtractedSourceEvent["status"];
    if (method === "turn/started" || turnStatus === "inProgress") normalized = "running";
    else if (turnStatus === "completed") normalized = "completed";
    else if (turnStatus === "interrupted") normalized = "interrupted";
    else if (turnStatus === "failed") normalized = "failed";
    else return null;
    return {
      method,
      observedAt,
      timestampSemantics,
      sourceSequence,
      rawThreadId: threadId,
      rawTurnId: turnId,
      rawRequestId: null,
      status: normalized,
    };
  }

  if (method === "error") {
    const threadId = stringField(params, "threadId");
    const turnId = stringField(params, "turnId");
    if (!threadId || !turnId || typeof params.willRetry !== "boolean") return null;
    return {
      method,
      observedAt,
      timestampSemantics,
      sourceSequence,
      rawThreadId: threadId,
      rawTurnId: turnId,
      rawRequestId: null,
      status: params.willRetry ? "system_error_retrying" : "system_error_terminal",
    };
  }

  if (requestMethods.has(method)) {
    const threadId = stringField(params, "threadId");
    if (!threadId) return null;
    return {
      method,
      observedAt,
      timestampSemantics,
      sourceSequence,
      rawThreadId: threadId,
      rawTurnId: stringField(params, "turnId"),
      rawRequestId: requestId(message.id),
      status: approvalMethods.has(method) ? "approval_requested" : "input_requested",
    };
  }

  return null;
}

export class SourceParser {
  readonly counters: CompatibilityCounters = {
    input_lines: 0,
    emitted_signals: 0,
    duplicates: 0,
    invalid_json: 0,
    invalid_recognized: 0,
    unknown_methods: 0,
  };

  parseLine(line: string, adapterObservedAt: string): ExtractedSourceEvent | null {
    this.counters.input_lines += 1;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line) as unknown;
    } catch {
      this.counters.invalid_json += 1;
      return null;
    }
    if (!isObject(decoded)) {
      this.counters.invalid_json += 1;
      return null;
    }

    const wrapped = isObject(decoded.message);
    const message = wrapped ? decoded.message : decoded;
    if (!isObject(message)) return null;
    const method = stringField(message, "method");
    if (!method || (!notificationMethods.has(method) && !requestMethods.has(method))) {
      this.counters.unknown_methods += 1;
      return null;
    }

    const validator: ValidateFunction = requestMethods.has(method) ? validateRequest : validateNotification;
    if (!validator(message)) {
      this.counters.invalid_recognized += 1;
      return null;
    }

    const explicitObservedAt = wrapped ? stringField(decoded, "observed_at") : null;
    const explicitSequence = wrapped ? decoded.source_sequence : null;
    const sourceSequence = typeof explicitSequence === "number" && Number.isSafeInteger(explicitSequence) && explicitSequence >= 0
      ? explicitSequence
      : this.counters.input_lines;
    const observedAt = explicitObservedAt ?? adapterObservedAt;
    if (!Number.isFinite(Date.parse(observedAt))) {
      this.counters.invalid_recognized += 1;
      return null;
    }

    const extracted = extractRecognized(
      message,
      new Date(observedAt).toISOString(),
      explicitObservedAt ? "source_event_time" : "adapter_observed_time",
      sourceSequence,
    );
    if (!extracted) this.counters.invalid_recognized += 1;
    return extracted;
  }
}
