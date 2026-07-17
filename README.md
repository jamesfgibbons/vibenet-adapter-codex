# VIBEnet Adapter for Codex

An independent VIBEnet adapter for the public Codex app-server.

It converts an authorized JSONL app-server stream into validated Signal Contract v1 events using the additive `vibenet.agent-lifecycle/0.1` profile. It is a normalizer, not an official OpenAI integration or a Codex controller.

## P0 boundary

P0 supports two local interfaces:

```bash
npm run replay -- --input fixtures/recovery-run.jsonl
VIBENET_REFERENCE_KEY='local-secret-at-least-16-characters' npm run normalize -- --stdin
```

- `replay` produces deterministic, fixture-backed receipts.
- `normalize --stdin` reads an app-server JSONL stream the operator is already authorized to access.
- Every stdout line is one validated Signal Contract event.
- Stderr contains aggregate compatibility counters only.

The adapter does not launch an app-server, listen on a network port, execute commands, answer approvals, control threads, or resume turns. A separate stdio app-server process cannot passively subscribe to arbitrary Codex Desktop threads, so P0 does not claim cross-client live fleet observation.

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
