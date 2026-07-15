import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { requireLiveReferenceKey } from "../src/config.js";
import { LifecycleEngine } from "../src/engine.js";
import { SourceParser } from "../src/source.js";
import type { ExtractedSourceEvent, SignalEvent } from "../src/types.js";
import { signalValidator } from "../src/validator.js";

const key = "adapter-test-reference-key-v1";
const baseTime = "2026-07-15T12:00:00.000Z";

function source(
  status: ExtractedSourceEvent["status"],
  sequence: number,
  overrides: Partial<ExtractedSourceEvent> = {},
): ExtractedSourceEvent {
  return {
    method: "thread/status/changed",
    observedAt: new Date(Date.parse(baseTime) + sequence * 1000).toISOString(),
    timestampSemantics: "source_event_time",
    sourceSequence: sequence,
    rawThreadId: "raw-thread-secret",
    rawTurnId: "raw-turn-secret",
    rawRequestId: null,
    status,
    ...overrides,
  };
}

function assertProfileValid(events: SignalEvent[]): void {
  const validate = signalValidator();
  for (const event of events) {
    assert.equal(validate(event), true, JSON.stringify(validate.errors));
  }
}

test("notLoaded is unobserved, never idle", () => {
  const events = new LifecycleEngine(key).ingest(source("not_loaded", 1));
  assert.equal(events[0]?.event, "agent.unobserved");
  assert.equal(events[0]?.metadata.lifecycle_state, "unobserved");
  assert.notEqual(events[0]?.metadata.lifecycle_state, "idle");
  assertProfileValid(events);
});

test("approval and user input requests override running", () => {
  const engine = new LifecycleEngine(key);
  engine.ingest(source("running", 1));
  const approval = engine.ingest(source("approval_requested", 2, { method: "item/fileChange/requestApproval" }));
  assert.equal(approval[0]?.event, "agent.approval_requested");
  assert.equal(approval[0]?.metadata.requires_action, true);
  const input = engine.ingest(source("input_requested", 3, { method: "item/tool/requestUserInput" }));
  assert.equal(input[0]?.event, "agent.input_requested");
  assert.equal(input[0]?.metadata.lifecycle_state, "needs_input");
  assertProfileValid([...approval, ...input]);
});

test("error overrides approval and running until trusted recovery", () => {
  const engine = new LifecycleEngine(key);
  engine.ingest(source("running", 1));
  const error = engine.ingest(source("system_error_retrying", 2, { method: "error" }));
  assert.equal(error[0]?.metadata.terminal, false);
  assert.deepEqual(engine.ingest(source("approval_requested", 3, { method: "item/permissions/requestApproval" })), []);
  const recovery = engine.ingest(source("running", 4));
  assert.equal(recovery[0]?.event, "agent.recovered");
  assert.equal(recovery[0]?.metadata.lifecycle_state, "running");
  assert.deepEqual(engine.ingest(source("running", 5)), []);
  assertProfileValid([...error, ...recovery]);
});

test("terminal and retrying system errors remain distinct", () => {
  const engine = new LifecycleEngine(key);
  const retrying = engine.ingest(source("system_error_retrying", 1, { method: "error" }));
  const terminal = engine.ingest(source("system_error_terminal", 2, { method: "error" }));
  assert.equal(retrying[0]?.metadata.terminal, false);
  assert.equal(terminal[0]?.metadata.terminal, true);
  assertProfileValid([...retrying, ...terminal]);
});

test("completion emits once and settles to idle after exactly three seconds", () => {
  const engine = new LifecycleEngine(key);
  const completed = engine.ingest(source("completed", 1, { method: "turn/completed" }));
  assert.equal(completed[0]?.event, "agent.completed");
  assert.deepEqual(engine.ingest(source("completed", 1, { method: "turn/completed" })), []);
  assert.deepEqual(engine.advance("2026-07-15T12:00:03.999Z"), []);
  const idle = engine.advance("2026-07-15T12:00:04.000Z");
  assert.equal(idle[0]?.event, "agent.idle");
  assert.equal(idle[0]?.occurred_at, "2026-07-15T12:00:04.000Z");
  assert.deepEqual(engine.advance("2026-07-15T12:00:05.000Z"), []);
  assertProfileValid([...completed, ...idle]);
});

test("interrupted is a warning and never successful completion", () => {
  const events = new LifecycleEngine(key).ingest(source("interrupted", 1, { method: "turn/completed" }));
  assert.equal(events[0]?.event, "agent.interrupted");
  assert.equal(events[0]?.channel, "warning");
  assert.equal(events[0]?.metadata.lifecycle_state, "error");
  assert.notEqual(events[0]?.event, "agent.completed");
  assertProfileValid(events);
});

test("duplicate notifications do not duplicate signals", () => {
  const engine = new LifecycleEngine(key);
  assert.equal(engine.ingest(source("running", 1)).length, 1);
  assert.equal(engine.ingest(source("running", 1)).length, 0);
  assert.equal(engine.ingest(source("running", 2)).length, 0);
});

test("disconnect and expiry each emit unobserved once", () => {
  const disconnected = new LifecycleEngine(key);
  disconnected.ingest(source("running", 1));
  const lost = disconnected.disconnect("2026-07-15T12:00:02.000Z");
  assert.equal(lost[0]?.event, "agent.unobserved");
  assert.equal(lost[0]?.metadata.attention_reason, "source_unavailable");
  assert.deepEqual(disconnected.disconnect("2026-07-15T12:00:03.000Z"), []);

  const expired = new LifecycleEngine(key, 1000);
  expired.ingest(source("running", 1));
  const stale = expired.advance("2026-07-15T12:00:02.000Z");
  assert.equal(stale[0]?.event, "agent.unobserved");
  assert.equal(stale[0]?.metadata.attention_reason, "source_expired");
  assert.deepEqual(expired.advance("2026-07-15T12:00:03.000Z"), []);
  assertProfileValid([...lost, ...stale]);
});

test("unknown and invalid recognized messages fail safely", () => {
  const parser = new SourceParser();
  assert.equal(parser.parseLine('{"method":"future/unknown","params":{"secret":"do not echo"}}', baseTime), null);
  assert.equal(parser.parseLine('{"method":"thread/status/changed","params":{}}', baseTime), null);
  assert.equal(parser.parseLine("not-json-private-content", baseTime), null);
  assert.deepEqual(
    {
      unknown: parser.counters.unknown_methods,
      invalid: parser.counters.invalid_recognized,
      json: parser.counters.invalid_json,
    },
    { unknown: 1, invalid: 1, json: 1 },
  );
});

test("live normalization fails closed without a local reference key", () => {
  assert.throws(() => requireLiveReferenceKey({}), /local reference key/);
  assert.throws(() => requireLiveReferenceKey({ VIBENET_REFERENCE_KEY: "too-short" }), /local reference key/);
  assert.equal(requireLiveReferenceKey({ VIBENET_REFERENCE_KEY: key }), key);
});

function replayFixture(): string {
  const parser = new SourceParser();
  const engine = new LifecycleEngine("vibenet-public-fixture-key-v1");
  const lines = readFileSync(new URL("../fixtures/recovery-run.jsonl", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const events: SignalEvent[] = [];
  let last = baseTime;
  for (const line of lines) {
    const extracted = parser.parseLine(line, baseTime);
    assert.ok(extracted);
    events.push(...engine.advance(extracted.observedAt));
    events.push(...engine.ingest(extracted));
    last = extracted.observedAt;
  }
  events.push(...engine.advance(new Date(Date.parse(last) + 3000).toISOString()));
  assertProfileValid(events);
  return events.map((event) => JSON.stringify(event)).join("\n");
}

test("fixture replay is byte-stable and source content never escapes", () => {
  const first = replayFixture();
  const second = replayFixture();
  assert.equal(first, second);
  assert.equal(first.split("\n").length, 8);
  for (const forbidden of [
    "fixture-thread-alpha",
    "fixture-turn-one",
    "fixture-item-one",
    "forbidden command text",
    "/forbidden/path",
    "forbidden error text",
  ]) {
    assert.equal(first.includes(forbidden), false, forbidden);
  }
  assert.match(first, /hmac-sha256:[a-f0-9]{64}/);
});
