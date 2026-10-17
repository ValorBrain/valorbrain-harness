/**
 * Everything that shapes text before it leaves the machine: the block the
 * plugin injects (and must never send back), OpenClaw's channel metadata,
 * secret redaction, and the transcript serialization the engine's extractors
 * read. Pure functions, no I/O.
 */
export declare const MEMORY_OPEN = "<valorbrain-memory>";
export declare const MEMORY_CLOSE = "</valorbrain-memory>";
/** The block prepended to the user turn. OpenClaw persists it in the session, so captures strip it. */
export declare function wrapMemory(context: string): string;
/**
 * The person's words of one user turn: without our injected block, OpenClaw's
 * `(untrusted metadata)` JSON fences, the trailing untrusted-context section,
 * `[Bootstrap …]` instruction blocks, the timestamp prefix and `System:` event
 * lines. Used for the recall query and for every user message of an uploaded
 * transcript.
 */
export declare function cleanUserText(text: string): string;
export declare const REDACTED = "[redacted]";
export declare function redactSecrets(text: string): string;
type Role = "user" | "assistant";
/**
 * The readable text of one OpenClaw (pi-agent-core) message: `user` and
 * `assistant` only; text blocks only (thinking, tool calls, tool results and
 * images stay on the machine). Null when there is nothing to read.
 */
export declare function messageText(message: unknown): {
    role: Role;
    text: string;
    timestamp?: number;
} | null;
/** Whether a session already has a turn before the current prompt. */
export declare function hasConversation(messages: unknown): boolean;
/** User messages answered by a later assistant message: the session's completed turns. */
export declare function completedTurns(messages: unknown[]): number;
/** The engine's own cap on an uploaded transcript (HOOK_TRANSCRIPT_MAX_BYTES). */
export declare const MAX_TRANSCRIPT_BYTES: number;
/**
 * Messages → JSONL the engine's transcript reader understands
 * (`{"type":"message","message":{"role","content"},"timestamp"}`, the same
 * shape the Hermes plugin writes). User text cleaned, everything redacted.
 * Over `maxBytes`, the oldest lines go first: the tail is what extraction needs.
 */
export declare function serializeTranscript(messages: unknown[], maxBytes?: number): {
    jsonl: string;
    count: number;
};
export {};
