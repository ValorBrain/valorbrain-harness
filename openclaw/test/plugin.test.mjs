import assert from "node:assert/strict";
import { test } from "node:test";
import { ValorBrainClient } from "../dist/client.js";
import plugin, { memoryPromptSection } from "../dist/index.js";
import { createTools } from "../dist/tools.js";
import { fakeApi, recorder } from "./helpers.mjs";

const TOKEN_CFG = { token: "vbm_test_token_not_real_0000000000", apiUrl: "https://vb.example" };

test("entry: kind memory, id valorbrain", () => {
  assert.equal(plugin.id, "valorbrain");
  assert.equal(plugin.kind, "memory");
  assert.equal(typeof plugin.register, "function");
});

test("no token: memory slot claimed, nothing else registered, one warning", () => {
  const prev = { a: process.env.VALORBRAIN_API_TOKEN, b: process.env.VALORBRAIN_TOKEN };
  delete process.env.VALORBRAIN_API_TOKEN;
  delete process.env.VALORBRAIN_TOKEN;
  try {
    const api = fakeApi();
    plugin.register(api);
    assert.ok(api.memoryCapability?.runtime);
    assert.equal(api.hooks.size, 0);
    assert.equal(api.tools.length, 0);
    assert.ok(api.logger.lines.some(([l, m]) => l === "warn" && m.includes("no token")));
  } finally {
    if (prev.a !== undefined) process.env.VALORBRAIN_API_TOKEN = prev.a;
    if (prev.b !== undefined) process.env.VALORBRAIN_TOKEN = prev.b;
  }
});

test("defaults: recall hooks and three tools; no capture hooks", () => {
  const api = fakeApi({ pluginConfig: TOKEN_CFG });
  plugin.register(api);
  assert.deepEqual([...api.hooks.keys()].sort(), ["after_compaction", "before_prompt_build", "session_start"]);
  assert.equal(api.hooks.get("before_prompt_build").opts.priority, 10);
  assert.deepEqual(api.tools.map((t) => t.tool.name), ["valorbrain_search", "valorbrain_get", "valorbrain_store"]);
  assert.ok(!JSON.stringify(api.logger.lines).includes(TOKEN_CFG.token));
});

test("captureTranscript: boundary hooks always, agent_end only with the operator's grant", () => {
  const without = fakeApi({ pluginConfig: { ...TOKEN_CFG, captureTranscript: true } });
  plugin.register(without);
  assert.ok(["before_compaction", "before_reset", "session_end"].every((h) => without.hooks.has(h)));
  assert.equal(without.hooks.has("agent_end"), false);
  assert.equal(without.services.length, 1);

  const granted = fakeApi({
    pluginConfig: { ...TOKEN_CFG, captureTranscript: true },
    config: { plugins: { entries: { valorbrain: { hooks: { allowConversationAccess: true } } } } },
  });
  plugin.register(granted);
  assert.equal(granted.hooks.has("agent_end"), true);
});

test("tools: false registers none; metadata-only registration does not log", () => {
  const api = fakeApi({ pluginConfig: { ...TOKEN_CFG, tools: false }, registrationMode: "cli-metadata" });
  plugin.register(api);
  assert.equal(api.tools.length, 0);
  assert.equal(api.logger.lines.length, 0);
});

test("memory runtime stub and prompt section", async () => {
  const api = fakeApi({ pluginConfig: TOKEN_CFG });
  plugin.register(api);
  const { runtime, promptBuilder } = api.memoryCapability;
  assert.deepEqual(await runtime.getMemorySearchManager({}), { manager: null });
  assert.deepEqual(runtime.resolveMemoryBackendConfig({}), { backend: "builtin" });
  const lines = promptBuilder({ availableTools: new Set(["valorbrain_search", "valorbrain_store"]) });
  assert.equal(lines[0], "## ValorBrain memory");
  assert.ok(lines.some((l) => l.startsWith("- valorbrain_store")));
  assert.equal(memoryPromptSection(new Set()).filter((l) => l.startsWith("- ")).length, 0);
});

function tools(routes) {
  const rec = recorder(routes);
  const client = new ValorBrainClient({ apiUrl: "https://vb.example", token: "vbm_x", fetchImpl: rec.impl });
  return { rec, byName: Object.fromEntries(createTools(client).map((t) => [t.name, t])) };
}

test("valorbrain_search formats hits and caps the limit", async () => {
  const { rec, byName } = tools({
    "POST /search": { status: 200, json: { results: [{ docid: "539adc", title: "Pricing decision", score: 0.91, snippet: "We  chose\nR$ 49" }] } },
  });
  const r = await byName.valorbrain_search.execute("t1", { query: "pricing", limit: 99 });
  assert.equal(rec.calls[0].body.limit, 20);
  assert.equal(r.content[0].text, "- #539adc Pricing decision (0.91)\n  We chose R$ 49");
  assert.deepEqual(r.details, { count: 1, docids: ["539adc"] });
});

test("valorbrain_get reads the body; strips a leading #", async () => {
  const { rec, byName } = tools({ "GET /documents/539adc": { status: 200, json: { title: "T", path: "p.md", body: "full text" } } });
  const r = await byName.valorbrain_get.execute("t2", { docid: "#539adc" });
  assert.equal(rec.calls[0].url, "https://vb.example/documents/539adc");
  assert.equal(r.content[0].text, "T — p.md\n\nfull text");
});

test("valorbrain_store validates, redacts and reports the docid", async () => {
  const { rec, byName } = tools({ "POST /api/v1/memory/store": { status: 200, json: { ok: true, docid: "319968", action: "inserted" } } });
  assert.match((await byName.valorbrain_store.execute("t3", { title: "x", content: "y" })).content[0].text, /title needs/);
  assert.equal(rec.calls.length, 0);
  const r = await byName.valorbrain_store.execute("t4", {
    title: "Deploy decision",
    content: "Use the staging key sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 never again.",
    type: "bogus",
    tags: ["ops"],
  });
  assert.deepEqual(rec.calls[0].body, {
    title: "Deploy decision",
    content: "Use the staging key [redacted] never again.",
    type: "note",
    tags: ["ops"],
  });
  assert.equal(r.content[0].text, "Stored #319968 (inserted).");
});

test("tool errors become text, never exceptions", async () => {
  const { byName } = tools({ "POST /search": { status: 401, json: { error: "invalid token" } }, "POST /api/v1/memory/store": "throw" });
  assert.equal((await byName.valorbrain_search.execute("t", { query: "q" })).content[0].text, "ValorBrain answered HTTP 401: invalid token");
  assert.equal(
    (await byName.valorbrain_store.execute("t", { title: "Valid title", content: "content long enough to pass" })).content[0].text,
    "ValorBrain unreachable (request failed)",
  );
});
