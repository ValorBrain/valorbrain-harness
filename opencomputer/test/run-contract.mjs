#!/usr/bin/env node
// Drives the provider with the request bodies from the OpenComputer memory-providers page
// (fresh deadlines, same shapes) and prints each exchange with its latency.
const BASE = process.env.OC_BASE || "http://127.0.0.1:8787/oc-memory";
const TOKEN = process.env.OC_MEMORY_TOKEN;
const run = process.env.RUN_ID || String(Date.now());
const partition = `ocmem_v1_${run}-project-prod-knowledge-owner`;
const other = `ocmem_v1_${run}-project-prod-knowledge-someone-else`;
const deadline = (ms = 10_000) => new Date(Date.now() + ms).toISOString();
const timings = {};

async function post(label, body, { token = TOKEN, raw } = {}) {
  const t = performance.now();
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: raw ?? JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - t);
  const json = await res.json();
  (timings[body?.operation === "tool" ? `tool:${body.tool}` : body?.operation || "other"] ??= []).push(ms);
  console.log(`\n### ${label}\n-> ${raw ? "(invalid body)" : JSON.stringify(body)}\n<- HTTP ${res.status} in ${ms} ms\n${JSON.stringify(json, null, 2)}`);
  return { status: res.status, json };
}
const base = (operation, id, extra) => ({ version: 1, operation, operationId: id, partition, access: "read-write", deadlineAt: deadline(), ...extra });
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed++; };

// 1. empty memory
let r = await post("recall on an empty partition", base("recall", "mrq_100:knowledge", { input: { text: "What hosting did we choose?" }, maxBytes: 8192 }));
check("empty memory is text \"\" and sources []", r.status === 200 && r.json.text === "" && Array.isArray(r.json.sources) && r.json.sources.length === 0);

// 2. the write from the docs
r = await post("tool remember (docs example)", base("tool", "toolcall_456:knowledge", { tool: "remember", arguments: { fact: "Use the free hosting tier for the demo." }, cursor: "provider-snapshot-42" }));
check("write returns result.status stored", r.status === 200 && r.json.result?.status === "stored");
const firstId = r.json.result?.id;

// 3. same operationId again: replay, no second write
r = await post("same operationId replayed", base("tool", "toolcall_456:knowledge", { tool: "remember", arguments: { fact: "Use the free hosting tier for the demo." }, cursor: "provider-snapshot-42" }));
check("replay returns the original result", r.status === 200 && r.json.result?.id === firstId);

// 4. same operationId, different arguments
r = await post("same operationId, changed arguments", base("tool", "toolcall_456:knowledge", { tool: "remember", arguments: { fact: "Use the paid tier." }, cursor: "provider-snapshot-42" }));
check("changed arguments are rejected with 409 conflict", r.status === 409 && r.json.error?.code === "conflict");

// 5. two more facts, then recall
await post("tool remember #2", base("tool", "toolcall_457:knowledge", { tool: "remember", arguments: { fact: "No paid external services for the demo; the owner decided this on 2026-09-08." } }));
await post("tool remember #3", base("tool", "toolcall_458:knowledge", { tool: "remember", arguments: { fact: "The staging database is reset every night at 02:00 UTC, so long tests must finish before then." } }));
await new Promise((s) => setTimeout(s, 1500));
r = await post("recall (docs example)", base("recall", "mrq_123:knowledge", { input: { text: "What hosting did we choose?" }, maxBytes: 8192 }));
check("recall returns the hosting fact with sources", r.status === 200 && /free hosting tier/.test(r.json.text) && r.json.sources.length >= 1 && typeof r.json.cursor === "string");

// 6. maxBytes
r = await post("recall with maxBytes 60", base("recall", "mrq_124:knowledge", { input: { text: "What hosting did we choose?" }, maxBytes: 60 }));
check("text fits maxBytes and sources match what was kept", r.status === 200 && Buffer.byteLength(r.json.text) <= 60 && r.json.sources.length <= 1);

// 7. input.text null
r = await post("recall with input.text null", base("recall", "mrq_125:knowledge", { input: { text: null }, maxBytes: 8192 }));
check("null input does not fail", r.status === 200 && typeof r.json.text === "string");

// 8. isolation
r = await post("recall from another partition", { ...base("recall", "mrq_126:knowledge", { input: { text: "What hosting did we choose?" }, maxBytes: 8192 }), partition: other });
check("another partition sees nothing", r.status === 200 && r.json.text === "" && r.json.sources.length === 0);

// 9. read-only binding
r = await post("write on a read-only binding", { ...base("tool", "toolcall_459:knowledge", { tool: "remember", arguments: { fact: "should not land" } }), access: "read" });
check("read-only write is rejected", r.status === 403 && r.json.error?.code === "read_only");

// 10. expired deadline, bad credential, unknown tool
r = await post("expired deadline", { ...base("recall", "mrq_127:knowledge", { input: { text: "x" }, maxBytes: 8192 }), deadlineAt: "2026-09-10T15:04:15.000Z" });
check("expired deadline is rejected without touching storage", r.status === 400 && r.json.error?.code === "deadline_expired");
r = await post("wrong credential", base("recall", "mrq_128:knowledge", { input: { text: "x" }, maxBytes: 8192 }), { token: "wrong" });
check("wrong credential is 401", r.status === 401);
r = await post("undeclared tool", base("tool", "toolcall_460:knowledge", { tool: "forget_everything", arguments: {} }));
check("undeclared tool is rejected", r.status === 400 && r.json.error?.code === "unknown_tool");

// 11. read tool
r = await post("tool search (read)", { ...base("tool", "toolcall_461:knowledge", { tool: "search", arguments: { query: "when is staging reset" } }), access: "read" });
check("read tool works on a read-only binding", r.status === 200 && r.json.result.facts.some((f) => /02:00 UTC/.test(f.text)));

// 12. latency over repeated recalls
for (let i = 0; i < 10; i++) {
  const t = performance.now();
  await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(base("recall", `mrq_2${i}:knowledge`, { input: { text: "What hosting did we choose?" }, maxBytes: 8192 })) }).then((x) => x.json());
  (timings.recall_warm ??= []).push(Math.round(performance.now() - t));
}
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return `n=${s.length} min=${s[0]} median=${s[Math.floor(s.length / 2)]} max=${s[s.length - 1]} ms`; };
console.log("\n### latency");
for (const [k, v] of Object.entries(timings)) console.log(`${k}: ${stat(v)}`);
console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : failed + " CHECK(S) FAILED"}`);
process.exitCode = failed ? 1 : 0;
