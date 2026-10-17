/**
 * Plugin config → resolved settings. This module reads the environment and
 * never touches the network (OpenClaw's install scanner flags a file that does
 * both; keeping them apart also keeps the token path easy to audit).
 */
export declare const DEFAULT_API_URL = "https://valorbrain-api.valor.digital";
/** Per-turn recall budget: the engine answers within ~3.6 s with what is ready. */
export declare const DEFAULT_TIMEOUT_MS = 4000;
/** Transcript extraction runs an LLM on the engine (p95 ~2 min); never awaited by a turn. */
export declare const DEFAULT_CAPTURE_TIMEOUT_MS = 180000;
export type RunKind = "conversation" | "routine" | "pipeline";
export type ResolvedConfig = {
    apiUrl: string;
    token: string;
    tokenSource: "config" | "env" | "none";
    /** Send the (cleaned, redacted) prompt of each turn for recall. */
    recall: boolean;
    /** Upload the (cleaned, redacted) conversation to the engine's extraction. */
    captureTranscript: boolean;
    /** Register valorbrain_search / valorbrain_get / valorbrain_store. */
    tools: boolean;
    timeoutMs: number;
    captureTimeoutMs: number;
    /** VALORBRAIN_RUN_KIND: the operator's word on what kind of run this host does. */
    runKindOverride: RunKind | null;
    /** Problems worth one log line (never contains the token). */
    warnings: string[];
};
type Env = Record<string, string | undefined>;
/** `on|off|true|false|1|0` → boolean; anything else → null. */
export declare function parseSwitch(v: unknown): boolean | null;
/** REST base: no trailing slash, no `/mcp` suffix (people paste the MCP URL). */
export declare function normalizeApiUrl(raw: string): string;
/**
 * Precedence for each setting: environment switch (machine-wide, same names
 * as `@valorbrain/connect`) > plugin config > default. The token is the
 * exception: plugin config wins, then VALORBRAIN_API_TOKEN, then VALORBRAIN_TOKEN.
 */
export declare function resolveConfig(raw: unknown, env?: Env): ResolvedConfig;
/**
 * OpenClaw blocks `agent_end` for non-bundled plugins unless the operator set
 * `plugins.entries.<id>.hooks.allowConversationAccess: true`; registering it
 * without the grant only produces a "blocked" diagnostic, so the plugin asks first.
 */
export declare function conversationAccessGranted(openclawConfig: unknown, pluginId: string): boolean;
export {};
