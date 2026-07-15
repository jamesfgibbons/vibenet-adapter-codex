# Adapter Boundary

This repository is an independent, read-only normalizer for authorized public Codex app-server JSONL streams.

- Do not add a browser UI, network listener, command execution, approval response, thread control, or thread-resume proxy.
- Do not claim passive observation of Codex Desktop or cross-client fleet state.
- Redact before normalization. Never log or emit source content, commands, paths, diffs, environment values, account identifiers, or raw source IDs.
- Live normalization must fail closed without a local HMAC reference key.
- Keep fixture-backed proofs labeled `documented replay`.
