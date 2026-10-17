/**
 * Reads an OpenClaw session transcript (`sessionFile` of session_end /
 * before_reset / before_compaction) when the event carries no messages.
 * Local file access only; nothing here talks to the network.
 */
/**
 * The `message` payloads of an OpenClaw session JSONL
 * (`{"type":"message","message":{role,content,…}}` lines), oldest first.
 * Empty on any error: capture is best-effort.
 */
export declare function readSessionMessages(path: string): unknown[];
