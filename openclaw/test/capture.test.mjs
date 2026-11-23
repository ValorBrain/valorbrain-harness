import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CaptureScheduler } from "../dist/capture.js";
import { ValorBrainClient } from "../dist/client.js";
import { readSessionMessages } from "../dist/session-file.js";
import { recorder, silentLogger } from "./helpers.mjs";

const MIN = 60_000;
const turns = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => [
    { role: "user", content: `question ${from + i}` },
    { role: "assistant", content: [{ type: "text", text: `answer ${from + i}` }] },
  ]).flat();

function setup(routes = { "POST /api/v1/hooks/run": { status: 200, json: { ok: true } } }) {
  const rec = recorder(routes);
  let now = 1_000_000;
  const client = new ValorBrainClient({ apiUrl: "https://vb.example", token: "vbm_x", fetchImpl: rec.impl });
  const logger = silentLogger();
  const s = new CaptureScheduler({ client, timeoutMs: 1000, now: () => now, logger });
  return { rec, s, logger, advance: (ms) => (now += ms) };
}

test("later uploads wait 10 minutes and need growth", async () => {
  const { rec, s, advance } = setup();
  assert.ok(s.observe("s1", turns(3), null));
  await s.idle();
  advance(5 * MIN);
  assert.equal(s.observe("s1", turns(5), null), null, "too soon");
  advance(6 * MIN);
  assert.ok(s.observe("s1", turns(5), null));
  await s.idle();
  advance(11 * MIN);
  assert.equal(s.observe("s1", turns(5), null), null, "no growth");
  assert.equal(rec.calls.length, 4);
});

test("at most 8 uploads per 10 minutes across sessions", async () => {
  const { rec, s, advance } = setup();
  for (let i = 0; i < 10; i++) {
    s.observe(`s${i}`, turns(3), null);
    await s.idle();
  }
  assert.equal(rec.calls.length, 16);
  advance(11 * MIN);
  assert.ok(s.observe("s9", turns(3), null));
});

test("429 pauses uploads for 30 minutes and stops the pair", async () => {
  const { rec, s, advance, logger } = setup({ "POST /api/v1/hooks/run": { status: 429, json: { error: "rate" } } });
  const p = s.observe("a", turns(3), "routine");
  assert.deepEqual(await p, { hooks: [], status: 429 });
  assert.equal(rec.calls.length, 1, "decision-extractor not attempted");
  assert.equal(rec.calls[0].headers["x-run-kind"], "routine");
  assert.ok(logger.lines.some(([, m]) => m.includes("paused 30 min")));
  assert.equal(s.observe("b", turns(3), null), null);
  advance(31 * MIN);
  assert.ok(s.observe("b", turns(3), null));
});

test("network failure is logged and swallowed", async () => {
  const { s, logger } = setup({ "POST /api/v1/hooks/run": "throw" });
  assert.deepEqual(await s.observe("a", turns(3), null), { hooks: [], status: null });
  assert.ok(logger.lines.some(([l, m]) => l === "warn" && m.includes("request failed")));
});

test("boundary: a one-turn session never uploads; two turns do", async () => {
  const { rec, s } = setup();
  assert.equal(s.onBoundary("x", turns(1), null, { end: true }), null);
  assert.ok(s.onBoundary("y", turns(2), null, { end: true }));
  await s.idle();
  assert.equal(rec.calls.length, 2);
});

test("session_end without messages reads OpenClaw's session file", () => {
  const dir = mkdtempSync(join(tmpdir(), "vb-oc-"));
  const file = join(dir, "s.jsonl");
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({ type: "message", id: "1", message: { role: "user", content: "hi" } }),
      "{torn line",
      JSON.stringify({ type: "custom", customType: "x" }),
      JSON.stringify({ type: "message", id: "2", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }),
      "",
    ].join("\n"),
  );
  assert.deepEqual(readSessionMessages(file), [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "text", text: "hello" }] },
  ]);
  assert.deepEqual(readSessionMessages(join(dir, "missing.jsonl")), []);
});
