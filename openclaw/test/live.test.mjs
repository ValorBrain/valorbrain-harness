// Live test against a ValorBrain engine (staging). Skipped unless VB_STAGING_URL
// and VB_STAGING_MCP_TOKEN are set; the token is never printed.
//   set -a; . /etc/valorbrain/integracoes-staging.env; set +a; npm run test:live
// Stores a memory, waits until it is searchable, recalls it through the plugin's
// own before_prompt_build handler and valorbrain_search tool, then forgets it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { ValorBrainClient } from "../dist/client.js";
import { resolveConfig } from "../dist/config.js";
import { createHandlers } from "../dist/hooks.js";
import { createTools } from "../dist/tools.js";
import { silentLogger } from "./helpers.mjs";

const url = process.env.VB_STAGING_URL;
const token = process.env.VB_STAGING_MCP_TOKEN;
const skip = !url || !token ? "VB_STAGING_URL / VB_STAGING_MCP_TOKEN not set" : false;

const sleep = (ms) => {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  return promise;
};

test("store → searchable → recalled by the hook and the tool → forget", { skip, timeout: 120_000 }, async (t) => {
  const marker = `oc-live-${randomBytes(4).toString("hex")}`;
  const cfg = resolveConfig({ apiUrl: url, token, timeoutMs: 8000 }, {});
  const client = new ValorBrainClient({ apiUrl: cfg.apiUrl, token: cfg.token });

  const stored = await client.store(
    {
      title: `OpenClaw plugin live check ${marker}`,
      content: `Live check ${marker}: the OpenClaw plugin's release train is called ${marker}-train and ships on Fridays.`,
      type: "decision",
      tags: ["openclaw-plugin", "live-test"],
    },
    15_000,
  );
  assert.equal(stored.status, 200);
  const docid = stored.json.docid;
  t.diagnostic(`stored docid ${docid} (${marker})`);
  let forgottenOk = false;
  t.after(async () => {
    if (forgottenOk) return;
    const f = await client.forget(docid, 15_000);
    t.diagnostic(`forget ${docid}: HTTP ${f.status}`);
  });

  const started = Date.now();
  let hit = null;
  while (!hit && Date.now() - started < 45_000) {
    const res = await client.search(marker, 5, 15_000);
    hit = (res.json?.results ?? []).find((r) => (r.title ?? "").includes(marker));
    if (!hit) await sleep(1500);
  }
  assert.ok(hit, "searchable within 45 s");
  t.diagnostic(`searchable after ${Date.now() - started} ms as #${hit.docid}`);

  const h = createHandlers({ cfg, client, logger: silentLogger(), capture: null });
  const ctx = { sessionId: `live-${marker}`, sessionKey: `agent:main:explicit:live-${marker}`, trigger: "user" };
  const out = await h.before_prompt_build(
    { prompt: `[Fri 2026-10-17 12:00 GMT-3] What is the release train of the OpenClaw plugin (${marker})?`, messages: [] },
    ctx,
  );
  assert.ok(out?.prependContext.includes(marker), "the hook injected the stored memory");
  assert.match(out.prependContext, /^<valorbrain-memory>/);

  const search = createTools(client).find((x) => x.name === "valorbrain_search");
  const r = await search.execute("live", { query: `${marker} release train` });
  assert.ok(r.content[0].text.includes(marker), "valorbrain_search finds it");

  const forgotten = await client.forget(docid, 15_000);
  assert.equal(forgotten.status, 200);
  forgottenOk = true;
  await sleep(2000);
  const after = await client.search(marker, 5, 15_000);
  assert.ok(!(after.json?.results ?? []).some((x) => (x.title ?? "").includes(marker)), "gone after forget");
});
