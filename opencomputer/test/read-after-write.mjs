#!/usr/bin/env node
// How long after `remember` returns "stored" does `recall` see the fact?
const BASE = process.env.OC_BASE || "http://127.0.0.1:8787/oc-memory";
const TOKEN = process.env.OC_MEMORY_TOKEN;
const post = (body) => fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ version: 1, access: "read-write", deadlineAt: new Date(Date.now() + 10_000).toISOString(), ...body }) }).then((r) => r.json());
const lags = [];
const tries = [];
for (let i = 0; i < 8; i++) {
  const partition = `ocmem_v1_raw-${Date.now()}-${i}`;
  const marker = `marker-${i}-${Math.random().toString(36).slice(2, 8)}`;
  await post({ operation: "tool", operationId: `w${i}`, partition, tool: "remember", arguments: { fact: `The rollout code for batch ${i} is ${marker}.` } });
  const t = performance.now();
  let seen = false;
  let n = 0;
  for (; n < 40 && !seen; n++) {
    const r = await post({ operation: "recall", operationId: `r${i}-${n}`, partition, input: { text: `What is the rollout code for batch ${i}?` }, maxBytes: 8192 });
    seen = (r.text || "").includes(marker);
    if (!seen) await new Promise((s) => setTimeout(s, 100));
  }
  lags.push(seen ? Math.round(performance.now() - t) : Infinity);
  tries.push(n);
}
console.log("ms from stored to first recall that includes the fact:", lags.join(", "));
console.log("recall attempts needed (1 = the recall sent right after the write already had it):", tries.join(", "));
