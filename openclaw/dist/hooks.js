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
import { readSessionMessages } from "./session-file.js";
import { cleanUserText, hasConversation, redactSecrets, wrapMemory } from "./text.js";
/** The engine keeps 8k chars of a prompt and caps the body at 64 KB. */
const MAX_PROMPT_CHARS = 8_000;
/**
 * The run kind OpenClaw's trigger implies (ADR-084). `memory` (pre-compaction
 * flush) and `heartbeat` are housekeeping: no recall, no capture.
 */
export function runKindFor(trigger, override) {
    if (override)
        return override;
    return trigger === "cron" ? "routine" : null;
}
const HOUSEKEEPING_TRIGGERS = { memory: true, heartbeat: true };
export function createHandlers(opts) {
    const { cfg, client, logger, capture } = opts;
    const bootstrapPending = new Set();
    /** One warning per failure kind per process: a dead engine must not flood the log. */
    const warned = new Set();
    const warnOnce = (key, message) => {
        if (warned.has(key)) {
            logger.debug?.(message);
            return;
        }
        warned.add(key);
        logger.warn(message);
    };
    const sessionOf = (ctx) => ctx?.sessionId || ctx?.sessionKey || null;
    async function cue(body, runKind) {
        let res;
        try {
            res = await client.cue(body, cfg.timeoutMs, runKind);
        }
        catch (e) {
            const why = e?.name === "TimeoutError" ? `timed out after ${cfg.timeoutMs} ms` : "request failed";
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
        session_start(event, ctx) {
            const sid = event?.sessionId || ctx?.sessionId || event?.sessionKey || null;
            if (sid)
                bootstrapPending.add(sid);
        },
        /** postcompact-inject: after the history is summarized, bring the session context back. */
        after_compaction(_event, ctx) {
            const sid = sessionOf(ctx);
            if (sid)
                bootstrapPending.add(sid);
        },
        async before_prompt_build(event, ctx) {
            if (!cfg.token || HOUSEKEEPING_TRIGGERS[ctx?.trigger ?? ""])
                return undefined;
            const sid = sessionOf(ctx);
            const runKind = runKindFor(ctx?.trigger, cfg.runKindOverride);
            if (capture && sid && Array.isArray(event?.messages))
                capture.observe(sid, event.messages, runKind);
            const bootstrap = (sid !== null && bootstrapPending.has(sid)) || !hasConversation(event?.messages);
            const prompt = cfg.recall ? cleanUserText(String(event?.prompt ?? "")) : "";
            const calls = [];
            if (bootstrap) {
                calls.push(cue({ event: "session_start", harness: "openclaw", session_id: sid }, runKind).then((ctxText) => {
                    if (sid)
                        bootstrapPending.delete(sid);
                    return ctxText;
                }));
            }
            if (prompt) {
                calls.push(cue({
                    event: "prompt",
                    harness: "openclaw",
                    session_id: sid,
                    prompt: redactSecrets(prompt).slice(0, MAX_PROMPT_CHARS),
                }, runKind));
            }
            if (!calls.length)
                return undefined;
            const sections = (await Promise.all(calls)).filter(Boolean);
            if (!sections.length)
                return undefined;
            return { prependContext: wrapMemory(sections.join("\n\n")) };
        },
        agent_end(event, ctx) {
            if (!capture || event?.success === false || HOUSEKEEPING_TRIGGERS[ctx?.trigger ?? ""])
                return;
            const sid = sessionOf(ctx);
            if (!sid || !Array.isArray(event?.messages))
                return;
            capture.observe(sid, event.messages, runKindFor(ctx?.trigger, cfg.runKindOverride));
        },
        before_compaction(event, ctx) {
            flush(event, ctx, false);
        },
        before_reset(event, ctx) {
            flush(event, ctx, true);
        },
        session_end(event, ctx) {
            const sid = event?.sessionId || ctx?.sessionId || event?.sessionKey || null;
            if (sid)
                bootstrapPending.delete(sid);
            flush(event, { ...ctx, sessionId: sid ?? undefined }, true);
        },
    };
    function flush(event, ctx, end) {
        if (!capture || HOUSEKEEPING_TRIGGERS[ctx?.trigger ?? ""])
            return;
        const sid = sessionOf(ctx);
        if (!sid)
            return;
        const messages = Array.isArray(event?.messages) && event.messages.length
            ? event.messages
            : event?.sessionFile
                ? readSessionMessages(event.sessionFile)
                : [];
        capture.onBoundary(sid, messages, runKindFor(ctx?.trigger, cfg.runKindOverride), { end });
    }
}
