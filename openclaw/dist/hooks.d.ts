/**
 * OpenClaw lifecycle hooks → ValorBrain hosted hook protocol v2.
 *
 *   session_start / after_compaction  mark the session: its next turn also asks
 *                                     for session context (goals, own ledger)
 *   before_prompt_build (awaited)     POST /api/v1/hooks/cue — `session_start`
 *                                     on a session's first turn, `prompt` on
 *                                     every turn; the answer goes in front of
 *                                     the user's message as `prependContext`.
 *                                     Its `messages` (the history so far) also
 *                                     feed the opt-in transcript capture
 *   agent_end (fire-and-forget)       same capture, one turn earlier — only
 *                                     where the operator granted
 *                                     `hooks.allowConversationAccess`
 *   before_compaction / before_reset  flush the capture before history is
 *   / session_end                     rewritten or dropped
 *
 * The checkpoint cue of the Stop hook is not used: OpenClaw 2026.4.x runs
 * `agent_end` after the reply is out and gives a plugin no way to continue the
 * turn, so recording during the conversation goes through the tools instead.
 *
 * Fail open everywhere: a ValorBrain error, timeout or missing token leaves
 * the turn exactly as OpenClaw built it.
 */
import type { CaptureScheduler } from "./capture.js";
import type { ValorBrainClient } from "./client.js";
import type { ResolvedConfig, RunKind } from "./config.js";
export type Logger = {
    info: (m: string) => void;
    warn: (m: string) => void;
    debug?: (m: string) => void;
};
/** PluginHookAgentContext (OpenClaw 2026.4.x), the fields this plugin reads. */
export type AgentCtx = {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    trigger?: string;
    messageProvider?: string;
};
type MessagesEvent = {
    messages?: unknown[];
    sessionFile?: string;
};
type SessionEvent = {
    sessionId?: string;
    sessionKey?: string;
    sessionFile?: string;
};
/** The handlers registered with `api.on(<hook>, …)`, keyed by OpenClaw hook name. */
export interface Handlers {
    session_start(event: SessionEvent, ctx?: AgentCtx): void;
    after_compaction(event: unknown, ctx?: AgentCtx): void;
    before_prompt_build(event: {
        prompt?: string;
        messages?: unknown[];
    }, ctx?: AgentCtx): Promise<{
        prependContext: string;
    } | undefined>;
    agent_end(event: {
        messages?: unknown[];
        success?: boolean;
    }, ctx?: AgentCtx): void;
    before_compaction(event: MessagesEvent, ctx?: AgentCtx): void;
    before_reset(event: MessagesEvent, ctx?: AgentCtx): void;
    session_end(event: SessionEvent, ctx?: AgentCtx): void;
}
/**
 * The run kind OpenClaw's trigger implies (ADR-084). `memory` (pre-compaction
 * flush) and `heartbeat` are housekeeping: no recall, no capture.
 */
export declare function runKindFor(trigger: string | undefined, override: RunKind | null): RunKind | null;
export declare function createHandlers(opts: {
    cfg: ResolvedConfig;
    client: ValorBrainClient;
    logger: Logger;
    /** Transcript capture, when enabled and allowed. */
    capture: CaptureScheduler | null;
}): Handlers;
export {};
