#!/usr/bin/env node
// OpenComputer HTTP memory provider (contract preview, version 1) backed by ValorBrain.
// Implements the endpoint protocol from docs.opencomputer.dev/agents/memory-providers:
//   POST /oc-memory  { version: 1, operation: "recall" | "tool", partition, access, deadlineAt, ... }
// One ValorBrain collection per OpenComputer partition key. Zero dependencies, Node >= 18.
//
//   OC_MEMORY_TOKEN=<what OpenComputer sends as bearer> \
//   VALORBRAIN_MCP_TOKEN=vbm_... node oc-memory-valorbrain.mjs
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const PATH = process.env.OC_MEMORY_PATH || "/oc-memory";
const OC_TOKEN = process.env.OC_MEMORY_TOKEN;
const VB_URL = process.env.VALORBRAIN_MCP_URL || "https://mcpbrain.valor.digital/mcp";
const VB_TOKEN = process.env.VALORBRAIN_MCP_TOKEN;
const BODY_LIMIT = 64 * 1024;
if (!OC_TOKEN || !VB_TOKEN) {
  console.error("set OC_MEMORY_TOKEN and VALORBRAIN_MCP_TOKEN");
  process.exit(2);
}

// ---- ValorBrain over streamable HTTP MCP -------------------------------------------------
let session = null;
let rpcId = 1;
async function mcp(method, params, signal, notify = false) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${VB_TOKEN}`,
  };
  if (session) headers["Mcp-Session-Id"] = session;
  const body = { jsonrpc: "2.0", method, params };
  if (!notify) body.id = rpcId++;
  const res = await fetch(VB_URL, { method: "POST", headers, body: JSON.stringify(body), signal });
  const sid = res.headers.get("mcp-session-id");
  if (sid) session = sid;
  if (notify) return null;
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`upstream HTTP ${res.status}`), { upstream: res.status });
  const lines = (res.headers.get("content-type") || "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  const msg = JSON.parse(lines[lines.length - 1]);
  if (msg.error) throw new Error(`upstream MCP ${msg.error.code}: ${msg.error.message}`);
  return msg.result;
}
let ready = null;
function connected(signal) {
  ready ??= (async () => {
    await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "oc-memory-valorbrain", version: "0.1.0" } }, signal);
    await mcp("notifications/initialized", {}, signal, true);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
async function tool(name, args, signal) {
  await connected(signal);
  const r = await mcp("tools/call", { name, arguments: args }, signal);
  if (r.isError) throw new Error(`upstream tool error: ${r.content?.[0]?.text?.slice(0, 200)}`);
  return r;
}

// ---- contract helpers --------------------------------------------------------------------
const collectionOf = (partition) => `oc-${createHash("sha256").update(partition).digest("hex").slice(0, 24)}`;
const bytes = (s) => Buffer.byteLength(s, "utf8");
class Reject extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
// The stored document is "front matter, # title, body"; the snippet carries numbered diff lines.
function factText(snippet) {
  return snippet
    .split("\n")
    .map((l) => l.replace(/^\d+: ?/, ""))
    .filter((l) => l && !l.startsWith("@@") && l !== "---" && !l.startsWith("# ") && !/^[a-z_]+: /.test(l) && !l.startsWith("tags:"))
    .join("\n")
    .trim();
}
async function search(partition, query, limit, signal) {
  const args = { collection: collectionOf(partition), limit, snippet_chars: 2400, compact: false };
  const r = query
    ? await tool("memory_retrieve", { ...args, query }, signal)
    : await tool("memory_retrieve", { ...args, query: "facts decisions constraints", mode: "keyword" }, signal).catch(() => ({ structuredContent: { results: [] } }));
  return (r.structuredContent?.results || []).map((d) => ({
    id: d.docid,
    title: d.title,
    revision: String(d.revision ?? 1),
    updatedAt: d.modified_at,
    text: factText(d.snippet || ""),
    hash: d.hash,
  }));
}

// (partition, operationId) -> { fingerprint, result, until } for writes, replayed until deadlineAt.
const seen = new Map();
function sweep(now) { for (const [k, v] of seen) if (v.until < now) seen.delete(k); }

async function recall(req, signal) {
  const maxBytes = Number.isInteger(req.maxBytes) ? req.maxBytes : 8192;
  const facts = await search(req.partition, req.input?.text ?? null, 12, signal);
  const kept = [];
  let text = "";
  for (const f of facts) {
    const line = f.updatedAt ? `- ${f.text} (${f.updatedAt.slice(0, 10)})` : `- ${f.text}`;
    const next = text ? `${text}\n${line}` : line;
    if (bytes(next) > maxBytes) break; // cut on a fact boundary, never inside a fact
    text = next;
    kept.push(f);
  }
  return {
    text,
    // only the facts that made it into `text`
    sources: kept.map(({ id, title, revision, updatedAt }) => ({ id, title, revision, ...(updatedAt ? { updatedAt } : {}) })),
    cursor: createHash("sha256").update(kept.map((f) => f.hash).join(",")).digest("hex").slice(0, 32),
  };
}

async function runTool(req, signal) {
  const key = `${req.partition}\u0000${req.operationId}`;
  const fingerprint = JSON.stringify([req.tool, req.arguments, req.cursor ?? null]);
  if (req.tool === "search") {
    const q = req.arguments?.query;
    if (typeof q !== "string" || !q) throw new Reject(400, "invalid_arguments", "search needs a query string");
    const facts = await search(req.partition, q, 8, signal);
    return { result: { facts: facts.map(({ id, text, updatedAt }) => ({ id, text, updatedAt })) } };
  }
  if (req.tool === "remember") {
    if (req.access !== "read-write") throw new Reject(403, "read_only", "This binding is read-only.");
    const fact = req.arguments?.fact;
    if (typeof fact !== "string" || !fact.trim()) throw new Reject(400, "invalid_arguments", "remember needs a fact string");
    const prior = seen.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Reject(409, "conflict", "Same operationId, different tool call.");
      return await prior.result; // replay the original result
    }
    const result = (async () => {
      const r = await tool("memory_store", {
        type: "observation",
        title: fact.trim().slice(0, 80),
        content: fact.trim(),
        collection: collectionOf(req.partition),
      }, signal);
      const id = /Docid: (#[0-9a-f]+)/.exec(r.content?.[0]?.text || "")?.[1];
      return { result: { status: "stored", id } };
    })();
    seen.set(key, { fingerprint, result, until: Date.parse(req.deadlineAt) });
    result.catch(() => seen.delete(key));
    return await result;
  }
  throw new Reject(400, "unknown_tool", `No tool named ${req.tool}.`);
}

// ---- HTTP --------------------------------------------------------------------------------
function send(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": bytes(s) });
  res.end(s);
}
const fail = (res, status, code, message, details) => send(res, status, { error: { code, message, ...(details ? { details } : {}) } });

createServer(async (req, res) => {
  const started = Date.now();
  let op = "-";
  try {
    if (req.method !== "POST" || new URL(req.url, "http://x").pathname !== PATH) throw new Reject(404, "not_found", "POST " + PATH);
    const given = Buffer.from((req.headers.authorization || "").replace(/^Bearer /, ""));
    const want = Buffer.from(OC_TOKEN);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new Reject(401, "unauthorized", "Bad connection credential.");
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > BODY_LIMIT) throw new Reject(413, "too_large", "Request body over 64 KiB.");
      chunks.push(c);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Reject(400, "invalid_json", "Body is not JSON."); }
    if (body.version !== 1) throw new Reject(400, "unsupported_version", "Only version 1.");
    if (typeof body.partition !== "string" || !body.partition) throw new Reject(400, "invalid_partition", "partition is required.");
    if (typeof body.operationId !== "string" || !body.operationId) throw new Reject(400, "invalid_operation", "operationId is required.");
    const deadline = Date.parse(body.deadlineAt);
    const now = Date.now();
    if (!Number.isFinite(deadline) || deadline <= now) throw new Reject(400, "deadline_expired", "deadlineAt is in the past.");
    sweep(now);
    op = body.operation === "tool" ? `tool:${body.tool}` : body.operation;
    const signal = AbortSignal.timeout(Math.max(1, deadline - now - 150));
    let out;
    if (body.operation === "recall") out = await recall(body, signal);
    else if (body.operation === "tool") out = await runTool(body, signal);
    else throw new Reject(400, "unknown_operation", "recall or tool.");
    const s = JSON.stringify(out);
    if (bytes(s) > BODY_LIMIT) throw new Reject(500, "too_large", "Response over 64 KiB.");
    send(res, 200, out);
    console.error(`${new Date().toISOString()} 200 ${op} ${Date.now() - started}ms`);
  } catch (e) {
    if (e instanceof Reject) fail(res, e.status, e.code, e.message, e.details);
    else if (e?.name === "TimeoutError" || e?.name === "AbortError") fail(res, 504, "upstream_timeout", "ValorBrain did not answer before the deadline.");
    else fail(res, 502, "upstream_error", String(e?.message || e).slice(0, 200));
    console.error(`${new Date().toISOString()} ${e?.status || (e?.name === "TimeoutError" ? 504 : 502)} ${op} ${Date.now() - started}ms ${e?.code || e?.name}`);
  }
}).listen(PORT, "127.0.0.1", () => console.error(`oc-memory provider on http://127.0.0.1:${PORT}${PATH} -> ${VB_URL}`));
