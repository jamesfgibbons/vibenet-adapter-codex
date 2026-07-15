export type JsonObject = Record<string, unknown>;

export type LifecycleState =
  | "unobserved"
  | "idle"
  | "running"
  | "needs_input"
  | "complete"
  | "error";

export type SignalChannel =
  | "nominal"
  | "advisory"
  | "warning"
  | "critical"
  | "recovery"
  | "handoff";

export type LifecycleEvent =
  | "agent.unobserved"
  | "agent.idle"
  | "agent.running"
  | "agent.approval_requested"
  | "agent.input_requested"
  | "agent.completed"
  | "agent.interrupted"
  | "agent.failed"
  | "agent.system_error"
  | "agent.recovered";

export type AttentionReason =
  | "source_unavailable"
  | "source_expired"
  | "approval_required"
  | "user_input_required"
  | "interrupted"
  | "turn_failed"
  | "system_error"
  | null;

export interface AgentLifecycleMetadata {
  profile: "vibenet.agent-lifecycle/0.1";
  lifecycle_state: LifecycleState;
  attention_reason: AttentionReason;
  requires_action: boolean;
  terminal: boolean;
  source_protocol: "codex-app-server";
  source_method: string;
  source_version: "0.144.4";
  source_sequence: number;
  timestamp_semantics: "source_event_time" | "adapter_observed_time";
  content_redacted: true;
  thread_ref: string;
  turn_ref: string | null;
}

export interface SignalEvent {
  schema_version: "1.0";
  id: string;
  occurred_at: string;
  producer: "vibenet-adapter-codex";
  entity: string;
  event: LifecycleEvent;
  channel: SignalChannel;
  valence: number;
  energy: number;
  tension: number;
  intensity: number;
  hue: number;
  pulse: number;
  confidence: number;
  ttl_ms: number;
  metadata: AgentLifecycleMetadata;
}

export interface ExtractedSourceEvent {
  method: string;
  observedAt: string;
  timestampSemantics: "source_event_time" | "adapter_observed_time";
  sourceSequence: number;
  rawThreadId: string;
  rawTurnId: string | null;
  rawRequestId: string | null;
  status:
    | "not_loaded"
    | "idle"
    | "running"
    | "approval_requested"
    | "input_requested"
    | "completed"
    | "interrupted"
    | "failed"
    | "system_error_retrying"
    | "system_error_terminal";
}

export interface CompatibilityCounters {
  input_lines: number;
  emitted_signals: number;
  duplicates: number;
  invalid_json: number;
  invalid_recognized: number;
  unknown_methods: number;
}
