import { eventIdFor, referenceFor } from "./reference.js";
import type {
  AttentionReason,
  ExtractedSourceEvent,
  LifecycleEvent,
  LifecycleState,
  SignalChannel,
  SignalEvent,
} from "./types.js";
import { assertValidSignal } from "./validator.js";

const COMPLETION_HOLD_MS = 3000;
const DEFAULT_TTL_MS = 30000;

interface Transition {
  event: LifecycleEvent;
  lifecycle: LifecycleState;
  channel: SignalChannel;
  reason: AttentionReason;
  requiresAction: boolean;
  terminal: boolean;
}

interface ThreadState {
  threadRef: string;
  lifecycle: LifecycleState;
  errorLatched: boolean;
  lastObservedMs: number;
  lastFingerprint: string | null;
  completionDueMs: number | null;
  completionTurnRef: string | null;
}

type EmissionContext = Pick<
  ExtractedSourceEvent,
  "method" | "observedAt" | "timestampSemantics" | "sourceSequence"
>;

const transitions: Record<ExtractedSourceEvent["status"], Transition> = {
  not_loaded: {
    event: "agent.unobserved",
    lifecycle: "unobserved",
    channel: "advisory",
    reason: "source_unavailable",
    requiresAction: false,
    terminal: false,
  },
  idle: {
    event: "agent.idle",
    lifecycle: "idle",
    channel: "nominal",
    reason: null,
    requiresAction: false,
    terminal: false,
  },
  running: {
    event: "agent.running",
    lifecycle: "running",
    channel: "nominal",
    reason: null,
    requiresAction: false,
    terminal: false,
  },
  approval_requested: {
    event: "agent.approval_requested",
    lifecycle: "needs_input",
    channel: "handoff",
    reason: "approval_required",
    requiresAction: true,
    terminal: false,
  },
  input_requested: {
    event: "agent.input_requested",
    lifecycle: "needs_input",
    channel: "handoff",
    reason: "user_input_required",
    requiresAction: true,
    terminal: false,
  },
  completed: {
    event: "agent.completed",
    lifecycle: "complete",
    channel: "nominal",
    reason: null,
    requiresAction: false,
    terminal: true,
  },
  interrupted: {
    event: "agent.interrupted",
    lifecycle: "error",
    channel: "warning",
    reason: "interrupted",
    requiresAction: false,
    terminal: true,
  },
  failed: {
    event: "agent.failed",
    lifecycle: "error",
    channel: "critical",
    reason: "turn_failed",
    requiresAction: false,
    terminal: true,
  },
  system_error_retrying: {
    event: "agent.system_error",
    lifecycle: "error",
    channel: "critical",
    reason: "system_error",
    requiresAction: false,
    terminal: false,
  },
  system_error_terminal: {
    event: "agent.system_error",
    lifecycle: "error",
    channel: "critical",
    reason: "system_error",
    requiresAction: false,
    terminal: true,
  },
};

const rendering: Record<SignalChannel, Pick<SignalEvent, "valence" | "energy" | "tension" | "intensity" | "hue" | "pulse">> = {
  nominal: { valence: 0.72, energy: 0.42, tension: 0.16, intensity: 0.42, hue: 158, pulse: 0.32 },
  advisory: { valence: 0.42, energy: 0.38, tension: 0.52, intensity: 0.55, hue: 43, pulse: 0.45 },
  warning: { valence: 0.22, energy: 0.72, tension: 0.82, intensity: 0.78, hue: 39, pulse: 0.76 },
  critical: { valence: 0.08, energy: 0.9, tension: 0.96, intensity: 0.96, hue: 12, pulse: 0.92 },
  recovery: { valence: 0.66, energy: 0.46, tension: 0.24, intensity: 0.6, hue: 174, pulse: 0.38 },
  handoff: { valence: 0.36, energy: 0.62, tension: 0.68, intensity: 0.72, hue: 276, pulse: 0.58 },
};

export class LifecycleEngine {
  private readonly threads = new Map<string, ThreadState>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly referenceKey: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {
    referenceFor(referenceKey, "key-check", "ready");
  }

  ingest(source: ExtractedSourceEvent): SignalEvent[] {
    const nowMs = Date.parse(source.observedAt);
    const threadRef = referenceFor(this.referenceKey, "thread", source.rawThreadId);
    const turnRef = source.rawTurnId ? referenceFor(this.referenceKey, "turn", source.rawTurnId) : null;
    const requestRef = source.rawRequestId ? referenceFor(this.referenceKey, "request", source.rawRequestId) : null;
    const transition = transitions[source.status];
    const dedupeKey = [source.method, threadRef, turnRef ?? "", requestRef ?? "", source.sourceSequence, source.status].join("|");
    const stateKey = [source.method, threadRef, turnRef ?? "", requestRef ?? "", source.status].join("|");
    const state = this.threads.get(threadRef) ?? {
      threadRef,
      lifecycle: "unobserved" as LifecycleState,
      errorLatched: false,
      lastObservedMs: nowMs,
      lastFingerprint: null,
      completionDueMs: null,
      completionTurnRef: null,
    };
    state.lastObservedMs = nowMs;
    this.threads.set(threadRef, state);

    if (this.seen.has(dedupeKey) || state.lastFingerprint === stateKey) return [];

    if (state.errorLatched && (transition.lifecycle === "needs_input" || transition.lifecycle === "complete")) {
      return [];
    }

    let effective = transition;
    if (state.errorLatched && (transition.lifecycle === "idle" || transition.lifecycle === "running")) {
      effective = {
        event: "agent.recovered",
        lifecycle: transition.lifecycle,
        channel: "recovery",
        reason: null,
        requiresAction: false,
        terminal: false,
      };
      state.errorLatched = false;
    } else if (transition.lifecycle === "error") {
      state.errorLatched = true;
    }

    this.seen.add(dedupeKey);
    state.lastFingerprint = stateKey;
    state.lifecycle = effective.lifecycle;
    state.completionDueMs = effective.lifecycle === "complete" ? nowMs + COMPLETION_HOLD_MS : null;
    state.completionTurnRef = effective.lifecycle === "complete" ? turnRef : null;
    return [this.makeSignal(source, effective, threadRef, turnRef)];
  }

  advance(observedAt: string): SignalEvent[] {
    const nowMs = Date.parse(observedAt);
    const emitted: SignalEvent[] = [];
    for (const state of this.threads.values()) {
      if (state.completionDueMs !== null && nowMs >= state.completionDueMs) {
        const source: EmissionContext = {
          method: "adapter/completion-hold",
          observedAt: new Date(state.completionDueMs).toISOString(),
          timestampSemantics: "adapter_observed_time",
          sourceSequence: 0,
        };
        state.completionDueMs = null;
        state.lifecycle = "idle";
        state.lastFingerprint = `adapter/completion-hold|${state.threadRef}|idle`;
        emitted.push(this.makeSignal(source, transitions.idle, state.threadRef, state.completionTurnRef));
        state.completionTurnRef = null;
      }

      if (state.lifecycle !== "unobserved" && nowMs - state.lastObservedMs >= this.ttlMs) {
        emitted.push(this.sourceLost(state, new Date(state.lastObservedMs + this.ttlMs).toISOString(), "source_expired"));
      }
    }
    return emitted;
  }

  disconnect(observedAt: string): SignalEvent[] {
    const emitted: SignalEvent[] = [];
    for (const state of this.threads.values()) {
      if (state.lifecycle !== "unobserved") {
        emitted.push(this.sourceLost(state, observedAt, "source_unavailable"));
      }
    }
    return emitted;
  }

  private sourceLost(state: ThreadState, observedAt: string, reason: "source_unavailable" | "source_expired"): SignalEvent {
    state.lifecycle = "unobserved";
    state.errorLatched = false;
    state.completionDueMs = null;
    state.completionTurnRef = null;
    state.lastFingerprint = `adapter/${reason}|${state.threadRef}|unobserved`;
    const source: EmissionContext = {
      method: reason === "source_expired" ? "adapter/source-expired" : "adapter/source-disconnected",
      observedAt,
      timestampSemantics: "adapter_observed_time",
      sourceSequence: 0,
    };
    return this.makeSignal(source, { ...transitions.not_loaded, reason }, state.threadRef, null);
  }

  private makeSignal(
    source: EmissionContext,
    transition: Transition,
    threadRef: string,
    turnRef: string | null,
  ): SignalEvent {
    const stableIdentity = [source.observedAt, source.method, threadRef, turnRef ?? "", source.sourceSequence, transition.event].join("|");
    const event: SignalEvent = {
      schema_version: "1.0",
      id: eventIdFor(this.referenceKey, stableIdentity),
      occurred_at: source.observedAt,
      producer: "vibenet-adapter-codex",
      entity: `agent.codex.${threadRef.slice("hmac-sha256:".length, "hmac-sha256:".length + 16)}`,
      event: transition.event,
      channel: transition.channel,
      ...rendering[transition.channel],
      confidence: 1,
      ttl_ms: this.ttlMs,
      metadata: {
        profile: "vibenet.agent-lifecycle/0.1",
        lifecycle_state: transition.lifecycle,
        attention_reason: transition.reason,
        requires_action: transition.requiresAction,
        terminal: transition.terminal,
        source_protocol: "codex-app-server",
        source_method: source.method,
        source_version: "0.144.4",
        source_sequence: source.sourceSequence,
        timestamp_semantics: source.timestampSemantics,
        content_redacted: true,
        thread_ref: threadRef,
        turn_ref: turnRef,
      },
    };
    assertValidSignal(event);
    return event;
  }
}
