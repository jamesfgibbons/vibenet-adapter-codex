#!/usr/bin/env node
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { requireLiveReferenceKey } from "./config.js";
import { LifecycleEngine } from "./engine.js";
import { SourceParser } from "./source.js";
import type { SignalEvent } from "./types.js";

const FIXTURE_KEY = "vibenet-public-fixture-key-v1";

function writeEvents(events: SignalEvent[], parser: SourceParser): void {
  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    parser.counters.emitted_signals += 1;
  }
}

function report(parser: SourceParser): void {
  process.stderr.write(`${JSON.stringify({ compatibility: parser.counters })}\n`);
}

async function replay(path: string): Promise<void> {
  const parser = new SourceParser();
  const engine = new LifecycleEngine(FIXTURE_KEY);
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim().length > 0);
  let lastObservedAt: string | null = null;
  for (const line of lines) {
    const source = parser.parseLine(line, "1970-01-01T00:00:00.000Z");
    if (!source || source.timestampSemantics !== "source_event_time") continue;
    if (lastObservedAt) writeEvents(engine.advance(source.observedAt), parser);
    const emitted = engine.ingest(source);
    if (emitted.length === 0) parser.counters.duplicates += 1;
    writeEvents(emitted, parser);
    lastObservedAt = source.observedAt;
  }
  if (lastObservedAt) {
    writeEvents(engine.advance(new Date(Date.parse(lastObservedAt) + 3000).toISOString()), parser);
  }
  report(parser);
}

async function normalize(): Promise<void> {
  const referenceKey = requireLiveReferenceKey(process.env);
  const parser = new SourceParser();
  const engine = new LifecycleEngine(referenceKey);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.trim().length === 0) continue;
    const now = new Date().toISOString();
    writeEvents(engine.advance(now), parser);
    const source = parser.parseLine(line, now);
    if (!source) continue;
    const emitted = engine.ingest(source);
    if (emitted.length === 0) parser.counters.duplicates += 1;
    writeEvents(emitted, parser);
  }
  writeEvents(engine.disconnect(new Date().toISOString()), parser);
  report(parser);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "replay") {
    const inputIndex = args.indexOf("--input");
    const path = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
    if (!path) throw new Error("Usage: vibenet-adapter-codex replay --input <jsonl>");
    await replay(path);
    return;
  }
  if (command === "normalize" && args[0] === "--stdin") {
    await normalize();
    return;
  }
  throw new Error("Usage: vibenet-adapter-codex <replay --input <jsonl> | normalize --stdin>");
}

main().catch(() => {
  process.stderr.write("Adapter stopped safely. No source content was retained.\n");
  process.exitCode = 1;
});
