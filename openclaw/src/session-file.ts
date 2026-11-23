/**
 * Reads an OpenClaw session transcript (`sessionFile` of session_end /
 * before_reset / before_compaction) when the event carries no messages.
 * Local file access only; nothing here talks to the network.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Read at most this much of the file's tail; the serializer caps the upload again. */
const MAX_READ_BYTES = 16 * 1024 * 1024;

/**
 * The `message` payloads of an OpenClaw session JSONL
 * (`{"type":"message","message":{role,content,…}}` lines), oldest first.
 * Empty on any error: capture is best-effort.
 */
export function readSessionMessages(path: string): unknown[] {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, MAX_READ_BYTES);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, size - length);
    let text = buf.toString("utf8");
    // Started mid-file: the first line is partial.
    if (length < size) text = text.slice(text.indexOf("\n") + 1);
    const messages: unknown[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { type?: unknown; message?: unknown };
        if (entry?.type === "message" && entry.message && typeof entry.message === "object") {
          messages.push(entry.message);
        }
      } catch {
        // A torn or foreign line: skip it.
      }
    }
    return messages;
  } catch {
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
