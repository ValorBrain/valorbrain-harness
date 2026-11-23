/**
 * Opt-in transcript capture, on the same schedule as `@valorbrain/connect`'s
 * Stop hook (decision 18): the engine's `episode-extractor` (conversation doc
 * + episodes) then `decision-extractor` read the uploaded conversation.
 *
 *   - first upload of a session after 3 completed turns (a one-shot run never uploads);
 *   - later uploads at most every 10 min, and only when the conversation grew;
 *   - at most 8 uploads per 10 min per process (16 of the engine's 40 hooks/run);
 *   - a session boundary (reset, end, compaction) flushes what grew since the
 *     last upload, if the session had at least 2 turns;
 *   - 401/403/413 pause uploads for 6 h, 429 for 30 min.
 *
 * Turns are counted from the messages themselves, so the same history seen
 * twice (agent_end of turn N, then before_prompt_build of turn N+1) is one
 * observation, not two. Uploads run in the background: a turn never waits.
 */
import type { ValorBrainClient } from "./client.js";
import type { RunKind } from "./config.js";
export type CapturePolicy = {
    firstAfterTurns: number;
    intervalMs: number;
    windowMs: number;
    maxUploadsPerWindow: number;
    boundaryMinTurns: number;
};
export declare const DEFAULT_CAPTURE_POLICY: CapturePolicy;
type Logger = {
    info?: (m: string) => void;
    warn?: (m: string) => void;
    debug?: (m: string) => void;
};
export type UploadOutcome = {
    hooks: string[];
    status: number | null;
};
export declare class CaptureScheduler {
    #private;
    constructor(opts: {
        client: ValorBrainClient;
        timeoutMs: number;
        policy?: Partial<CapturePolicy>;
        now?: () => number;
        logger?: Logger;
    });
    /**
     * The session history after a completed turn (agent_end) or before the next
     * one (before_prompt_build). Returns the started upload, or null when none is due.
     */
    observe(sessionId: string, messages: unknown[], runKind: RunKind | null): Promise<UploadOutcome> | null;
    /** reset / end / compaction: flush what grew. Forgets the session when `end` is set. */
    onBoundary(sessionId: string, messages: unknown[], runKind: RunKind | null, opts: {
        end: boolean;
    }): Promise<UploadOutcome> | null;
    /** Resolves when every upload started so far has settled (tests, shutdown). */
    idle(): Promise<void>;
}
export {};
