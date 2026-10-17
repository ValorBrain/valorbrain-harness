// Replays hook payloads captured from a real OpenClaw 2026.4.24 gateway
// (test/e2e/probe-plugin during test/e2e/run-isolated.sh; injected memory elided).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CaptureScheduler } from "../dist/capture.js";
import { ValorBrainClient } from "../dist/client.js";
import { resolveConfig } from "../dist/config.js";
import { createHandlers } from "../dist/hooks.js";
import { recorder, silentLogger } from "./helpers.mjs";

const events = readFileSync(new URL("./fixtures/openclaw-2026.4.24-before_prompt_build.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

test("fixture holds four turns of one session", () => {
  assert.equal(events.length, 4);
  assert.ok(events.every((e) => e.hook === "before_prompt_build" && e.ctx.trigger === "user"));
  assert.equal(new Set(events.map((e) => e.ctx.sessionId)).size, 1);
  assert.deepEqual(events.map((e) => e.event.messages.length), [0, 2, 6, 8]);
});

test("replay: cues, cleaned prompts, and one clean transcript upload on turn 4", async () => {
  const rec = recorder({
    "POST /api/v1/hooks/cue": (body) => ({ status: 200, json: { ok: true, context: `ctx for ${body.event}` } }),
    "POST /api/v1/hooks/run": { status: 200, json: { ok: true } },
  });
  const cfg = resolveConfig({ apiUrl: "https://vb.example", token: "vbm_fixture_token_0000000000000", captureTranscript: true }, {});
  const client = new ValorBrainClient({ apiUrl: cfg.apiUrl, token: cfg.token, fetchImpl: rec.impl });
  const capture = new CaptureScheduler({ client, timeoutMs: 1000, logger: silentLogger() });
  const h = createHandlers({ cfg, client, logger: silentLogger(), capture });

  const injected = [];
  for (const e of events) injected.push(await h.before_prompt_build(e.event, e.ctx));
  await capture.idle();

  const cues = rec.calls.filter((c) => c.key === "POST /api/v1/hooks/cue");
  assert.deepEqual(cues.map((c) => c.body.event), ["session_start", "prompt", "prompt", "prompt", "prompt"]);
  const prompts = cues.filter((c) => c.body.event === "prompt").map((c) => c.body.prompt);
  assert.equal(prompts[0], "What is the codename of the OpenClaw plugin end-to-end run?");
  assert.ok(prompts[1].includes("api_key=[redacted]") && !prompts[1].includes("sk-ant-"));
  assert.ok(prompts.every((p) => !p.startsWith("[")), "timestamp prefix removed");
  assert.match(injected[0].prependContext, /ctx for session_start\n\nctx for prompt/);

  const runs = rec.calls.filter((c) => c.key === "POST /api/v1/hooks/run");
  assert.deepEqual(runs.map((c) => c.body.hook), ["episode-extractor", "decision-extractor"]);
  const transcript = runs[0].body.transcript;
  const lines = transcript.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.message.role), ["user", "assistant", "user", "assistant", "user", "assistant"]);
  for (const bad of ["<valorbrain-memory>", "Bootstrap pending", "BOOTSTRAP.md", "sk-ant-", "[Sat 2026"]) {
    assert.ok(!transcript.includes(bad), `transcript must not carry ${bad}`);
  }
  assert.equal(lines[0].message.content, "What is the codename of the OpenClaw plugin end-to-end run?");
});
