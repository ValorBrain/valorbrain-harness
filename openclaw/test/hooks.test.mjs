import assert from "node:assert/strict";
import { test } from "node:test";
import { CaptureScheduler } from "../dist/capture.js";
import { ValorBrainClient } from "../dist/client.js";
import { resolveConfig } from "../dist/config.js";
import { createHandlers } from "../dist/hooks.js";
import { USER_AGENT } from "../dist/version.js";
import { recorder, silentLogger } from "./helpers.mjs";

const TOKEN = "vbm_test_token_not_real_0000000000";
const ctx = { agentId: "main", sessionKey: "agent:main:main", sessionId: "0b5c6f1e-2f0e-4c39-9f4b-2b8e6a1d9c11", trigger: "user", messageProvider: "telegram" };

function setup({ routes, config = {}, capture = false } = {}) {
  const rec = recorder(
    routes ?? {
      "POST /api/v1/hooks/cue": (body) => ({
        status: 200,
        json: { ok: true, llm: false, context: body.event === "session_start" ? "## You here\nActor: test" : `- #abc12 decision about ${body.prompt}`, checkpoint: null },
      }),
      "POST /api/v1/hooks/run": { status: 200, json: { ok: true } },
    },
  );
  const cfg = resolveConfig({ apiUrl: "https://vb.example", token: TOKEN, ...config }, {});
  const client = new ValorBrainClient({ apiUrl: cfg.apiUrl, token: cfg.token, fetchImpl: rec.impl });
  const logger = silentLogger();
  const scheduler = capture ? new CaptureScheduler({ client, timeoutMs: 1000, logger }) : null;
  return { rec, logger, scheduler, h: createHandlers({ cfg, client, logger, capture: scheduler }) };
}

const turn = (user, assistant) => [
  { role: "user", content: [{ type: "text", text: user }], timestamp: 1760700000000 },
  { role: "assistant", content: [{ type: "text", text: assistant }], stopReason: "stop", timestamp: 1760700001000 },
];

test("first turn: session_start and prompt cues in parallel, injected as one marked block", async () => {
  const { rec, h } = setup();
  const out = await h.before_prompt_build({ prompt: "What did we decide about pricing?", messages: [] }, ctx);
  assert.deepEqual(rec.calls.map((c) => c.body.event).sort(), ["prompt", "session_start"]);
  for (const c of rec.calls) {
    assert.equal(c.url, "https://vb.example/api/v1/hooks/cue");
    assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(c.headers["user-agent"], USER_AGENT);
    assert.equal(c.headers["x-run-kind"], undefined);
    assert.equal(c.body.harness, "openclaw");
    assert.equal(c.body.session_id, ctx.sessionId);
  }
  assert.match(out.prependContext, /^<valorbrain-memory>\n/);
  assert.match(out.prependContext, /## You here/);
  assert.match(out.prependContext, /decision about What did we decide about pricing\?/);
  assert.match(out.prependContext, /<\/valorbrain-memory>$/);
});

test("later turns ask only for the prompt; session_start comes back after session_start / compaction", async () => {
  const { rec, h } = setup();
  const history = turn("hi", "hello");
  await h.before_prompt_build({ prompt: "next question", messages: history }, ctx);
  assert.deepEqual(rec.calls.map((c) => c.body.event), ["prompt"]);
  h.after_compaction({ messageCount: 2, compactedCount: 10 }, ctx);
  await h.before_prompt_build({ prompt: "after compaction", messages: history }, ctx);
  assert.deepEqual(rec.calls.slice(1).map((c) => c.body.event).sort(), ["prompt", "session_start"]);
  await h.before_prompt_build({ prompt: "and again", messages: history }, ctx);
  assert.deepEqual(rec.calls.slice(3).map((c) => c.body.event), ["prompt"]);
});

test("the prompt is cleaned and redacted before it leaves", async () => {
  const { rec, h } = setup();
  const prompt = [
    "<valorbrain-memory>\nold block\n</valorbrain-memory>",
    "Conversation info (untrusted metadata):",
    "```json",
    '{"sender_id":"123"}',
    "```",
    "",
    "deploy with OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz012345 please",
  ].join("\n");
  await h.before_prompt_build({ prompt, messages: turn("a", "b") }, ctx);
  assert.equal(rec.calls[0].body.prompt, "deploy with OPENAI_API_KEY=[redacted] please");
});

test("fails open: HTTP error, network error and timeout all leave the turn untouched", async () => {
  for (const spec of [{ status: 500, json: { error: "boom" } }, "throw", "hang"]) {
    const { h, logger } = setup({ routes: { "POST /api/v1/hooks/cue": spec }, config: { timeoutMs: 500 } });
    const started = Date.now();
    const out = await h.before_prompt_build({ prompt: "q", messages: turn("a", "b") }, ctx);
    assert.equal(out, undefined);
    assert.ok(Date.now() - started < 3000, "bounded by timeoutMs");
    assert.equal(logger.lines.filter(([lvl]) => lvl === "warn").length, 1);
    assert.ok(!JSON.stringify(logger.lines).includes(TOKEN));
  }
});

test("one warning per failure kind, then debug", async () => {
  const { h, logger } = setup({ routes: { "POST /api/v1/hooks/cue": { status: 503 } } });
  for (let i = 0; i < 3; i++) await h.before_prompt_build({ prompt: "q", messages: turn("a", "b") }, ctx);
  assert.equal(logger.lines.filter(([l]) => l === "warn").length, 1);
  assert.equal(logger.lines.filter(([l]) => l === "debug").length, 2);
});

test("housekeeping triggers, recall off and an empty context send/inject nothing", async () => {
  for (const trigger of ["heartbeat", "memory"]) {
    const { rec, h } = setup();
    assert.equal(await h.before_prompt_build({ prompt: "q", messages: [] }, { ...ctx, trigger }), undefined);
    assert.equal(rec.calls.length, 0);
  }
  const off = setup({ config: { recall: false } });
  await off.h.before_prompt_build({ prompt: "q", messages: turn("a", "b") }, ctx);
  assert.equal(off.rec.calls.length, 0);
  const empty = setup({ routes: { "POST /api/v1/hooks/cue": { status: 200, json: { ok: true, context: "" } } } });
  assert.equal(await empty.h.before_prompt_build({ prompt: "q", messages: [] }, ctx), undefined);
});

test("cron runs say x-run-kind: routine", async () => {
  const { rec, h } = setup();
  await h.before_prompt_build({ prompt: "daily report", messages: turn("a", "b") }, { ...ctx, trigger: "cron" });
  assert.equal(rec.calls[0].headers["x-run-kind"], "routine");
});

test("capture: nothing before 3 turns, one upload (episode then decision) after, never twice for the same history", async () => {
  const { rec, h, scheduler } = setup({ capture: true });
  let history = [...turn("one", "1"), ...turn("two", "2")];
  await h.before_prompt_build({ prompt: "three", messages: history }, ctx);
  h.agent_end({ messages: [...history, ...turn("three", "3")], success: true }, ctx);
  await scheduler.idle();
  const runs = rec.calls.filter((c) => c.key === "POST /api/v1/hooks/run");
  assert.deepEqual(runs.map((c) => c.body.hook), ["episode-extractor", "decision-extractor"]);
  assert.equal(runs[0].body.input.sessionId, ctx.sessionId);
  assert.equal(runs[0].body.transcript.trim().split("\n").length, 6);
  // The next before_prompt_build sees the same 3 turns: no second upload.
  history = [...history, ...turn("three", "3")];
  await h.before_prompt_build({ prompt: "four", messages: history }, ctx);
  await scheduler.idle();
  assert.equal(rec.calls.filter((c) => c.key === "POST /api/v1/hooks/run").length, 2);
});

test("capture: failed or unsuccessful turns are skipped; reset flushes what grew", async () => {
  const { rec, h, scheduler } = setup({ capture: true });
  const history = [...turn("one", "1"), ...turn("two", "2")];
  h.agent_end({ messages: history, success: false }, ctx);
  h.agent_end({ messages: history, success: true }, { ...ctx, trigger: "heartbeat" });
  await scheduler.idle();
  assert.equal(rec.calls.length, 0);
  h.before_reset({ messages: history, reason: "new" }, ctx);
  await scheduler.idle();
  assert.deepEqual(rec.calls.map((c) => c.body.hook), ["episode-extractor", "decision-extractor"]);
});

test("capture off by default: no hooks/run even with a long history", async () => {
  const { rec, h } = setup();
  const history = [...turn("1", "a"), ...turn("2", "b"), ...turn("3", "c"), ...turn("4", "d")];
  h.agent_end({ messages: history, success: true }, ctx);
  h.before_reset({ messages: history }, ctx);
  await h.before_prompt_build({ prompt: "q", messages: history }, ctx);
  assert.ok(rec.calls.every((c) => c.key === "POST /api/v1/hooks/cue"));
});
