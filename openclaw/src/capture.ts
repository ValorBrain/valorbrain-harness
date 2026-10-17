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
import { completedTurns, serializeTranscript } from "./text.js";

const MIN = 60_000;

export type CapturePolicy = {
  firstAfterTurns: number;
  intervalMs: number;
  windowMs: number;
  maxUploadsPerWindow: number;
  boundaryMinTurns: number;
};

export const DEFAULT_CAPTURE_POLICY: CapturePolicy = {
  firstAfterTurns: 3,
  intervalMs: 10 * MIN,
  windowMs: 10 * MIN,
  maxUploadsPerWindow: 8,
  boundaryMinTurns: 2,
};

const BACKOFF_MS: Record<number, number> = { 401: 360 * MIN, 403: 360 * MIN, 413: 360 * MIN, 429: 30 * MIN };

type SessionState = {
  /** Serialized message count at the last upload. */
  uploadedCount: number;
  lastUploadAt: number | null;
  inFlight: boolean;
};

type Logger = { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };

export type UploadOutcome = { hooks: string[]; status: number | null };

export class CaptureScheduler {
  readonly #client: ValorBrainClient;
  readonly #timeoutMs: number;
  readonly #policy: CapturePolicy;
  readonly #now: () => number;
  readonly #log: Logger;
  readonly #sessions = new Map<string, SessionState>();
  #uploads: number[] = [];
  #backoffUntil = 0;
  readonly #pending = new Set<Promise<UploadOutcome>>();

  constructor(opts: {
    client: ValorBrainClient;
    timeoutMs: number;
    policy?: Partial<CapturePolicy>;
    now?: () => number;
    logger?: Logger;
  }) {
    this.#client = opts.client;
    this.#timeoutMs = opts.timeoutMs;
    this.#policy = { ...DEFAULT_CAPTURE_POLICY, ...opts.policy };
    this.#now = opts.now ?? Date.now;
    this.#log = opts.logger ?? {};
  }

  #state(sessionId: string): SessionState {
    let st = this.#sessions.get(sessionId);
    if (!st) {
      st = { uploadedCount: 0, lastUploadAt: null, inFlight: false };
      this.#sessions.set(sessionId, st);
    }
    return st;
  }

  /** Room in the window and no backoff. Records the slot when it says yes. */
  #claimSlot(now: number): boolean {
    if (now < this.#backoffUntil) return false;
    this.#uploads = this.#uploads.filter((t) => now - t < this.#policy.windowMs);
    if (this.#uploads.length >= this.#policy.maxUploadsPerWindow) return false;
    this.#uploads.push(now);
    return true;
  }

  /**
   * The session history after a completed turn (agent_end) or before the next
   * one (before_prompt_build). Returns the started upload, or null when none is due.
   */
  observe(sessionId: string, messages: unknown[], runKind: RunKind | null): Promise<UploadOutcome> | null {
    const st = this.#state(sessionId);
    const now = this.#now();
    const due =
      st.lastUploadAt === null
        ? completedTurns(messages) >= this.#policy.firstAfterTurns
        : now - st.lastUploadAt >= this.#policy.intervalMs;
    if (!due) return null;
    return this.#start(st, sessionId, messages, runKind, now);
  }

  /** reset / end / compaction: flush what grew. Forgets the session when `end` is set. */
  onBoundary(
    sessionId: string,
    messages: unknown[],
    runKind: RunKind | null,
    opts: { end: boolean },
  ): Promise<UploadOutcome> | null {
    const st = this.#state(sessionId);
    if (opts.end) this.#sessions.delete(sessionId);
    if (st.lastUploadAt === null && completedTurns(messages) < this.#policy.boundaryMinTurns) return null;
    return this.#start(st, sessionId, messages, runKind, this.#now());
  }

  #start(
    st: SessionState,
    sessionId: string,
    messages: unknown[],
    runKind: RunKind | null,
    now: number,
  ): Promise<UploadOutcome> | null {
    if (st.inFlight) return null;
    const { jsonl, count } = serializeTranscript(messages);
    if (count === 0 || count <= st.uploadedCount) return null;
    if (!this.#claimSlot(now)) return null;
    st.inFlight = true;
    st.uploadedCount = count;
    st.lastUploadAt = now;
    const p = this.#upload(sessionId, jsonl, runKind).finally(() => {
      st.inFlight = false;
      this.#pending.delete(p);
    });
    this.#pending.add(p);
    return p;
  }

  async #upload(sessionId: string, transcript: string, runKind: RunKind | null): Promise<UploadOutcome> {
    const hooks: string[] = [];
    const input = { sessionId, hookEventName: "Stop" };
    for (const hook of ["episode-extractor", "decision-extractor"] as const) {
      let status: number;
      try {
        status = (await this.#client.hookRun(hook, input, transcript, this.#timeoutMs, runKind)).status;
      } catch (e) {
        const why = (e as Error)?.name === "TimeoutError" ? "timed out" : "request failed";
        this.#log.warn?.(`valorbrain: transcript ${hook} ${why}`);
        return { hooks, status: null };
      }
      if (status >= 200 && status < 300) {
        hooks.push(hook);
        continue;
      }
      const backoff = BACKOFF_MS[status];
      if (backoff) this.#backoffUntil = this.#now() + backoff;
      this.#log.warn?.(
        `valorbrain: transcript ${hook} HTTP ${status}${backoff ? ` — uploads paused ${Math.round(backoff / MIN)} min` : ""}`,
      );
      return { hooks, status };
    }
    this.#log.info?.(`valorbrain: transcript uploaded (${hooks.join(", ")})`);
    return { hooks, status: 200 };
  }

  /** Resolves when every upload started so far has settled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#pending.size) await Promise.allSettled([...this.#pending]);
  }
}
