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
import type { ApiResult, CueRequest, CueResponse, ValorBrainClient } from "./client.js";
import type { ResolvedConfig, RunKind } from "./config.js";
import { readSessionMessages } from "./session-file.js";
import { cleanUserText, hasConversation, redactSecrets, wrapMemory } from "./text.js";

/** The engine keeps 8k chars of a prompt and caps the body at 64 KB. */
const MAX_PROMPT_CHARS = 8_000;

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

type MessagesEvent = { messages?: unknown[]; sessionFile?: string };
type SessionEvent = { sessionId?: string; sessionKey?: string; sessionFile?: string };

/** The handlers registered with `api.on(<hook>, …)`, keyed by OpenClaw hook name. */
export interface Handlers {
  session_start(event: SessionEvent, ctx?: AgentCtx): void;
  after_compaction(event: unknown, ctx?: AgentCtx): void;
  before_prompt_build(
    event: { prompt?: string; messages?: unknown[] },
    ctx?: AgentCtx,
  ): Promise<{ prependContext: string } | undefined>;
  agent_end(event: { messages?: unknown[]; success?: boolean }, ctx?: AgentCtx): void;
  before_compaction(event: MessagesEvent, ctx?: AgentCtx): void;
  before_reset(event: MessagesEvent, ctx?: AgentCtx): void;
  session_end(event: SessionEvent, ctx?: AgentCtx): void;
}

/**
 * The run kind OpenClaw's trigger implies (ADR-084). `memory` (pre-compaction
 * flush) and `heartbeat` are housekeeping: no recall, no capture.
 */
export function runKindFor(trigger: string | undefined, override: RunKind | null): RunKind | null {
  if (override) return override;
  return trigger === "cron" ? "routine" : null;
}

const HOUSEKEEPING_TRIGGERS: Record<string, true> = { memory: true, heartbeat: true };

export function createHandlers(opts: {
  cfg: ResolvedConfig;
  client: ValorBrainClient;
  logger: Logger;
  /** Transcript capture, when enabled and allowed. */
  capture: CaptureScheduler | null;
}): Handlers {
  const { cfg, client, logger, capture } = opts;
  const bootstrapPending = new Set<string>();
  /** One warning per failure kind per process: a dead engine must not flood the log. */
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) {
      logger.debug?.(message);
      return;
    }
    warned.add(key);
    logger.warn(message);
  };

  const sessionOf = (ctx: AgentCtx | undefined) => ctx?.sessionId || ctx?.sessionKey || null;

  async function cue(
    body: CueRequest,
    runKind: RunKind | null,
  ): Promise<string> {
    let res: ApiResult<CueResponse>;
    try {
      res = await client.cue(body, cfg.timeoutMs, runKind);
    } catch (e) {
      const why = (e as Error)?.name === "TimeoutError" ? `timed out after ${cfg.timeoutMs} ms` : "request failed";
      warnOnce(`${body.event}:net`, `valorbrain: ${body.event} recall ${why} (${client.apiUrl})`);
      return "";
    }
    if (res.status < 200 || res.status >= 300) {
      warnOnce(`${body.event}:${res.status}`, `valorbrain: ${body.event} recall HTTP ${res.status} (${client.apiUrl})`);
      return "";
    }
    return typeof res.json?.context === "string" ? res.json.context.trim() : "";
  }

  return {
    session_start(event: { sessionId?: string; sessionKey?: string }, ctx?: AgentCtx): void {
      const sid = event?.sessionId || ctx?.sessionId || event?.sessionKey || null;
      if (sid) bootstrapPending.add(sid);
    },

    /** postcompact-inject: after the history is summarized, bring the session context back. */
    after_compaction(_event: unknown, ctx?: AgentCtx): void {
      const sid = sessionOf(ctx);
      if (sid) bootstrapPending.add(sid);
    },

    async before_prompt_build(
      event: { prompt?: string; messages?: unknown[] },
      ctx?: AgentCtx,
    ): Promise<{ prependContext: string } | undefined> {
      if (!cfg.token || HOUSEKEEPING_TRIGGERS[ctx?.trigger ?? ""]) return undefined;
      const sid = sessionOf(ctx);
      const runKind = runKindFor(ctx?.trigger, cfg.runKindOverride);
      if (capture && sid && Array.isArray(event?.messages)) capture.observe(sid, event.messages, runKind);
      const bootstrap = (sid !== null && bootstrapPending.has(sid)) || !hasConversation(event?.messages);
      const prompt = cfg.recall ? cleanUserText(String(event?.prompt ?? "")) : "";

      const calls: Array<Promise<string>> = [];
      if (bootstrap) {
        calls.push(
          cue({ event: "session_start", harness: "openclaw", session_id: sid }, runKind).then((ctxText) => {
            if (sid) bootstrapPending.delete(sid);
            return ctxText;
          }),
        );
      }
      if (prompt) {
        calls.push(
          cue(
            {
              event: "prompt",
              harness: "openclaw",
              session_id: sid,
              prompt: redactSecrets(prompt).slice(0, MAX_PROMPT_CHARS),
            },
            runKind,
          ),
        );
      }
      if (!calls.length) return undefined;
      const sections = (await Promise.all(calls)).filter(Boolean);
      if (!sections.length) return undefined;
      return { prependContext: wrapMemory(sections.join("\n\n")) };
    },

    agent_end(event: { messages?: unknown[]; success?: boolean }, ctx?: AgentCtx): void {
      if (!capture || event?.success === false || HOUSEKEEPING_TRIGGERS[ctx?.trigger ?? ""]) return;
      const sid = sessionOf(ctx);
      if (!sid || !Array.isArray(event?.messages)) return;
      capture.observe(sid, event.messages, runKindFor(ctx?.trigger, cfg.runKindOverride));
    },

    before_compaction(event: MessagesEvent, ctx?: AgentCtx): void {
      flush(event, ctx, false);
    },

    before_reset(event: MessagesEvent, ctx?: AgentCtx): void {
      flush(event, ctx, true);
    },

    session_end(event: SessionEvent, ctx?: AgentCtx): void {
      const sid = event?.sessionId || ctx?.sessionId || event?.sessionKey || null;
      if (sid) bootstrapPending.delete(sid);
      flush(event, { ...ctx, sessionId: sid ?? undefined }, true);
    },
  };

  function flush(event: MessagesEvent, ctx: AgentCtx | undefined, end: boolean) {
    if (!capture || HOUSEKEEPING_TRIGGERS[ctx?.trigger ?? ""]) return;
    const sid = sessionOf(ctx);
    if (!sid) return;
    const messages = Array.isArray(event?.messages) && event.messages.length
      ? event.messages
      : event?.sessionFile
        ? readSessionMessages(event.sessionFile)
        : [];
    capture.onBoundary(sid, messages, runKindFor(ctx?.trigger, cfg.runKindOverride), { end });
  }
}
