/**
 * The ValorBrain REST calls this plugin makes. The only module that touches
 * the network. Never logs or returns the token; every call has a deadline.
 *
 *   POST /api/v1/hooks/cue        recall for session_start / prompt (no LLM)
 *   POST /api/v1/hooks/run        transcript extraction (opt-in)
 *   POST /search                  valorbrain_search tool
 *   GET  /documents/{id}          valorbrain_get tool
 *   POST /api/v1/memory/store     valorbrain_store tool
 *   POST /documents/{id}/forget   tests' cleanup
 */
import type { RunKind } from "./config.js";
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type ApiResult<T = Record<string, unknown>> = {
    status: number;
    /** Parsed JSON body, or null when the body was not JSON. */
    json: T | null;
};
export type CueRequest = {
    event: "session_start" | "prompt";
    harness: "openclaw";
    session_id: string | null;
    prompt?: string;
    source?: string;
};
export type CueResponse = {
    ok?: boolean;
    context?: string;
    partial?: boolean;
    policy?: Record<string, number>;
};
export declare class ValorBrainClient {
    #private;
    readonly apiUrl: string;
    constructor(opts: {
        apiUrl: string;
        token: string;
        fetchImpl?: FetchLike;
    });
    request<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number, runKind?: RunKind | null): Promise<ApiResult<T>>;
    cue(body: CueRequest, timeoutMs: number, runKind?: RunKind | null): Promise<ApiResult<CueResponse>>;
    hookRun(hook: "episode-extractor" | "decision-extractor", input: Record<string, unknown>, transcript: string, timeoutMs: number, runKind?: RunKind | null): Promise<ApiResult>;
    search(query: string, limit: number, timeoutMs: number): Promise<ApiResult>;
    getDocument(id: string, timeoutMs: number): Promise<ApiResult>;
    store(doc: {
        title: string;
        content: string;
        type?: string;
        tags?: string[];
    }, timeoutMs: number): Promise<ApiResult>;
    forget(id: string, timeoutMs: number): Promise<ApiResult>;
}
