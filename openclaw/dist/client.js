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
import { USER_AGENT } from "./version.js";
export class ValorBrainClient {
    apiUrl;
    #token;
    #fetch;
    constructor(opts) {
        this.apiUrl = opts.apiUrl;
        this.#token = opts.token;
        this.#fetch = opts.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
    }
    async request(method, path, body, timeoutMs, runKind) {
        const headers = {
            authorization: `Bearer ${this.#token}`,
            "user-agent": USER_AGENT,
            accept: "application/json",
        };
        if (body !== undefined)
            headers["content-type"] = "application/json";
        if (runKind)
            headers["x-run-kind"] = runKind;
        const res = await this.#fetch(`${this.apiUrl}${path}`, {
            method,
            headers,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(timeoutMs),
        });
        let json = null;
        try {
            json = (await res.json());
        }
        catch {
            // Not JSON (proxy error page, empty body).
        }
        return { status: res.status, json };
    }
    cue(body, timeoutMs, runKind) {
        return this.request("POST", "/api/v1/hooks/cue", body, timeoutMs, runKind);
    }
    hookRun(hook, input, transcript, timeoutMs, runKind) {
        return this.request("POST", "/api/v1/hooks/run", { hook, input, transcript }, timeoutMs, runKind);
    }
    search(query, limit, timeoutMs) {
        return this.request("POST", "/search", { query, limit }, timeoutMs);
    }
    getDocument(id, timeoutMs) {
        return this.request("GET", `/documents/${encodeURIComponent(id)}`, undefined, timeoutMs);
    }
    store(doc, timeoutMs) {
        return this.request("POST", "/api/v1/memory/store", doc, timeoutMs);
    }
    forget(id, timeoutMs) {
        return this.request("POST", `/documents/${encodeURIComponent(id)}/forget`, {}, timeoutMs);
    }
}
