# VIBEnet Adapter for Codex

**How do you observe an agent without reading its work?**

VIBEnet Adapter for Codex is an independent, read-only normalizer for an
authorized public Codex app-server JSONL stream. It emits validated lifecycle
state—running, needs input, error, recovery, completion, and unobserved—without
emitting the agent's work.

It never emits or retains prompts, responses, reasoning, commands, paths,
diffs, environment values, account identifiers, raw source IDs, error text, or
request payloads.

It is not an official OpenAI integration, a Codex controller, or a live Codex
Desktop fleet watcher. Public proof is a **documented replay**, not live fleet
state.

> **Release:** `v0.1.0` · **Runtime:** Node.js `>=22` · **Distribution:** tagged
> GitHub source. This release is not published to npm.

## Run the documented replay

```bash
git clone --branch v0.1.0 --depth 1 https://github.com/jamesfgibbons/vibenet-adapter-codex.git
cd vibenet-adapter-codex
npm ci
npm run verify:schemas
npm run replay -- --input fixtures/recovery-run.jsonl
```

The replay emits eight validated Signal Contract events to stdout and a final
compatibility receipt to stderr. For the tagged fixture, the receipt reports
eight emitted signals with zero duplicate, invalid, or unknown inputs.

## Operating boundary

The adapter supports two local interfaces:

```bash
npm run replay -- --input fixtures/recovery-run.jsonl
VIBENET_REFERENCE_KEY='local-secret-at-least-16-characters' npm run normalize -- --stdin
```

- `replay` produces deterministic, fixture-backed receipts.
- `normalize --stdin` reads an app-server JSONL stream the operator is already authorized to access.
- Every stdout line is one validated Signal Contract event.
- Stderr contains aggregate compatibility counters only.

The adapter does not launch an app-server, listen on a network port, execute commands, answer approvals, control threads, or resume turns. A separate stdio app-server process cannot passively subscribe to arbitrary Codex Desktop threads, so this release does not claim cross-client live fleet observation.

## Privacy boundary

Redaction happens before normalization, and emission is whitelist-based.

- Ingests: an authorized Codex app-server JSONL stream (server notifications and requests, schema-pinned to `0.144.4`).
- Reads from each recognized message: the method name, thread/turn/request identifiers, status fields, and `willRetry`. Nothing else is accessed.
- Emits: one validated Signal Contract event per stdout line — lifecycle state, rendering fields, fixed provenance metadata, and keyed references. Stderr carries aggregate compatibility counters only.
- Never emits or retains: prompts, responses, reasoning, commands, paths, diffs, environment values, account identifiers, raw source IDs, error text, or request payloads.

Thread, turn, request, and event references are keyed HMAC-SHA256 digests, so raw identifiers are irreversible without the local key. Live normalization fails closed when `VIBENET_REFERENCE_KEY` is missing or shorter than 16 characters. Error messages are fixed strings that never include source content.

Unknown methods are ignored and counted only in aggregate. Recognized messages that fail the pinned source schema are also ignored without reflecting the source payload in logs or errors. Every emitted event is validated against the vendored profile schema before it reaches stdout.

This boundary is pinned by tests in `tests/adapter.test.ts`: a fixture replay laced with sentinel commands, paths, error text, and raw identifiers must emit none of them, and recognized messages carrying extra content fields must drop those fields.

## Lifecycle semantics

The reducer implements:

```text
error > needs_input > running > complete > idle
```

`notLoaded`, disconnect, and expiry become `unobserved`. Completion is emitted once and settles to idle after a deterministic three-second hold. Interruption is a warning and never successful completion. A trusted running or idle state after error emits one recovery event.

## Schema provenance

- Codex CLI app-server schemas: `0.144.4`
- Signal Contract: `1.0`
- Lifecycle profile: `vibenet.agent-lifecycle/0.1`

Vendored files are pinned in `schemas/lock.json` and verified with:

```bash
npm run verify:schemas
npm run typecheck
npm test
npm run build
```

Fixture-backed public material must be labeled `documented replay`, never live fleet state.

## Related, independent projects

- [Evidence Harness](https://github.com/jamesfgibbons/evidence-harness) governs
  what an agent may do.
- [VIBEnet Signal Contract](https://github.com/jamesfgibbons/vibenet-signal-contract/tree/v1.1.0)
  defines the renderer-facing event format and the
  `vibenet.agent-lifecycle/0.1` profile this adapter emits.

Evidence Harness is a gate. This adapter is a sensor. They can be used
independently; neither sits inside or controls the other.
