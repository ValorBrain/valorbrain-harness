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
import { USER_AGENT } from "./version.js";

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

export class ValorBrainClient {
  readonly apiUrl: string;
  readonly #token: string;
  readonly #fetch: FetchLike;

  constructor(opts: { apiUrl: string; token: string; fetchImpl?: FetchLike }) {
    this.apiUrl = opts.apiUrl;
    this.#token = opts.token;
    this.#fetch = opts.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  }

  async request<T = Record<string, unknown>>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    timeoutMs: number,
    runKind?: RunKind | null,
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#token}`,
      "user-agent": USER_AGENT,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (runKind) headers["x-run-kind"] = runKind;
    const res = await this.#fetch(`${this.apiUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json: T | null = null;
    try {
      json = (await res.json()) as T;
    } catch {
      // Not JSON (proxy error page, empty body).
    }
    return { status: res.status, json };
  }

  cue(body: CueRequest, timeoutMs: number, runKind?: RunKind | null): Promise<ApiResult<CueResponse>> {
    return this.request<CueResponse>("POST", "/api/v1/hooks/cue", body, timeoutMs, runKind);
  }

  hookRun(
    hook: "episode-extractor" | "decision-extractor",
    input: Record<string, unknown>,
    transcript: string,
    timeoutMs: number,
    runKind?: RunKind | null,
  ): Promise<ApiResult> {
    return this.request("POST", "/api/v1/hooks/run", { hook, input, transcript }, timeoutMs, runKind);
  }

  search(query: string, limit: number, timeoutMs: number): Promise<ApiResult> {
    return this.request("POST", "/search", { query, limit }, timeoutMs);
  }

  getDocument(id: string, timeoutMs: number): Promise<ApiResult> {
    return this.request("GET", `/documents/${encodeURIComponent(id)}`, undefined, timeoutMs);
  }

  store(
    doc: { title: string; content: string; type?: string; tags?: string[] },
    timeoutMs: number,
  ): Promise<ApiResult> {
    return this.request("POST", "/api/v1/memory/store", doc, timeoutMs);
  }

  forget(id: string, timeoutMs: number): Promise<ApiResult> {
    return this.request("POST", `/documents/${encodeURIComponent(id)}/forget`, {}, timeoutMs);
  }
}
