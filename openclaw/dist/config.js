/**
 * Plugin config → resolved settings. This module reads the environment and
 * never touches the network (OpenClaw's install scanner flags a file that does
 * both; keeping them apart also keeps the token path easy to audit).
 */
export const DEFAULT_API_URL = "https://valorbrain-api.valor.digital";
/** Per-turn recall budget: the engine answers within ~3.6 s with what is ready. */
export const DEFAULT_TIMEOUT_MS = 4_000;
/** Transcript extraction runs an LLM on the engine (p95 ~2 min); never awaited by a turn. */
export const DEFAULT_CAPTURE_TIMEOUT_MS = 180_000;
const RUN_KINDS = { conversation: true, routine: true, pipeline: true };
const str = (v) => (typeof v === "string" ? v.trim() : "");
/** `on|off|true|false|1|0` → boolean; anything else → null. */
export function parseSwitch(v) {
    if (typeof v === "boolean")
        return v;
    const s = str(v).toLowerCase();
    if (["on", "true", "1", "yes"].includes(s))
        return true;
    if (["off", "false", "0", "no"].includes(s))
        return false;
    return null;
}
/** REST base: no trailing slash, no `/mcp` suffix (people paste the MCP URL). */
export function normalizeApiUrl(raw) {
    return raw.replace(/\/+$/, "").replace(/\/mcp$/, "").replace(/\/+$/, "");
}
const LOOPBACK_HOSTS = { localhost: true, "127.0.0.1": true, "[::1]": true };
function boundedMs(v, fallback, min, max) {
    const n = typeof v === "number" ? v : Number(str(v));
    if (!Number.isFinite(n) || n <= 0)
        return fallback;
    return Math.min(Math.max(Math.round(n), min), max);
}
/**
 * Precedence for each setting: environment switch (machine-wide, same names
 * as `@valorbrain/connect`) > plugin config > default. The token is the
 * exception: plugin config wins, then VALORBRAIN_API_TOKEN, then VALORBRAIN_TOKEN.
 */
export function resolveConfig(raw, env = process.env) {
    const cfg = (raw && typeof raw === "object" ? raw : {});
    const warnings = [];
    let apiUrl = normalizeApiUrl(str(cfg.apiUrl) || str(env.VALORBRAIN_API_URL) || DEFAULT_API_URL);
    try {
        const u = new URL(apiUrl);
        if (u.protocol !== "https:" && u.protocol !== "http:")
            throw new Error("scheme");
        if (u.protocol === "http:" && !LOOPBACK_HOSTS[u.hostname]) {
            warnings.push(`apiUrl uses plain http to ${u.hostname}: the token travels unencrypted`);
        }
    }
    catch {
        warnings.push(`apiUrl is not an http(s) URL; using ${DEFAULT_API_URL}`);
        apiUrl = DEFAULT_API_URL;
    }
    let token = str(cfg.token);
    let tokenSource = token ? "config" : "none";
    if (!token) {
        token = str(env.VALORBRAIN_API_TOKEN) || str(env.VALORBRAIN_TOKEN);
        if (token)
            tokenSource = "env";
    }
    if (!token) {
        warnings.push("no token: set plugins.entries.valorbrain.config.token or VALORBRAIN_API_TOKEN — the plugin stays idle");
    }
    const recall = parseSwitch(env.VALORBRAIN_SEND_PROMPT) ?? parseSwitch(cfg.recall) ?? true;
    const captureTranscript = parseSwitch(env.VALORBRAIN_SEND_TRANSCRIPT) ?? parseSwitch(cfg.captureTranscript) ?? false;
    const tools = parseSwitch(cfg.tools) ?? true;
    const explicitKind = str(env.VALORBRAIN_RUN_KIND).toLowerCase();
    return {
        apiUrl,
        token,
        tokenSource,
        recall,
        captureTranscript,
        tools,
        timeoutMs: boundedMs(cfg.timeoutMs ?? env.VALORBRAIN_HOOK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 500, 30_000),
        captureTimeoutMs: boundedMs(cfg.captureTimeoutMs, DEFAULT_CAPTURE_TIMEOUT_MS, 5_000, 600_000),
        runKindOverride: RUN_KINDS[explicitKind] ? explicitKind : null,
        warnings,
    };
}
/**
 * OpenClaw blocks `agent_end` for non-bundled plugins unless the operator set
 * `plugins.entries.<id>.hooks.allowConversationAccess: true`; registering it
 * without the grant only produces a "blocked" diagnostic, so the plugin asks first.
 */
export function conversationAccessGranted(openclawConfig, pluginId) {
    const entries = openclawConfig?.plugins
        ?.entries;
    const entry = entries?.[pluginId];
    return entry?.hooks?.allowConversationAccess === true;
}
