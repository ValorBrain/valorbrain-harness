import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { conversationAccessGranted, DEFAULT_API_URL, normalizeApiUrl, resolveConfig } from "../dist/config.js";
import { PLUGIN_VERSION } from "../dist/version.js";

test("defaults: hosted API, recall and tools on, transcript off, idle without token", () => {
  const c = resolveConfig({}, {});
  assert.equal(c.apiUrl, DEFAULT_API_URL);
  assert.equal(c.token, "");
  assert.equal(c.tokenSource, "none");
  assert.equal(c.recall, true);
  assert.equal(c.captureTranscript, false);
  assert.equal(c.tools, true);
  assert.equal(c.timeoutMs, 4000);
  assert.ok(c.warnings.some((w) => w.startsWith("no token")));
});

test("token: plugin config, then VALORBRAIN_API_TOKEN, then VALORBRAIN_TOKEN", () => {
  assert.equal(resolveConfig({ token: "vbm_cfg" }, { VALORBRAIN_API_TOKEN: "vbm_env" }).tokenSource, "config");
  const fromEnv = resolveConfig({}, { VALORBRAIN_API_TOKEN: " vbm_env ", VALORBRAIN_TOKEN: "vbm_other" });
  assert.equal(fromEnv.token, "vbm_env");
  assert.equal(fromEnv.tokenSource, "env");
  assert.equal(resolveConfig({}, { VALORBRAIN_TOKEN: "vbm_other" }).token, "vbm_other");
});

test("environment switches win over plugin config (same names as @valorbrain/connect)", () => {
  const c = resolveConfig(
    { recall: true, captureTranscript: false },
    { VALORBRAIN_SEND_PROMPT: "off", VALORBRAIN_SEND_TRANSCRIPT: "on", VALORBRAIN_RUN_KIND: "routine" },
  );
  assert.equal(c.recall, false);
  assert.equal(c.captureTranscript, true);
  assert.equal(c.runKindOverride, "routine");
  assert.equal(resolveConfig({}, { VALORBRAIN_RUN_KIND: "bogus" }).runKindOverride, null);
});

test("apiUrl: normalized, http to a remote host warns, garbage falls back", () => {
  assert.equal(normalizeApiUrl("https://x.example/mcp/"), "https://x.example");
  assert.equal(resolveConfig({ apiUrl: "http://127.0.0.1:7439/" }, {}).apiUrl, "http://127.0.0.1:7439");
  assert.ok(resolveConfig({ apiUrl: "http://engine.lan:7438", token: "t" }, {}).warnings.some((w) => w.includes("unencrypted")));
  assert.equal(resolveConfig({ apiUrl: "ftp://nope" }, {}).apiUrl, DEFAULT_API_URL);
  assert.equal(resolveConfig({}, { VALORBRAIN_API_URL: "https://own.example" }).apiUrl, "https://own.example");
});

test("timeouts are bounded", () => {
  assert.equal(resolveConfig({ timeoutMs: 10 }, {}).timeoutMs, 500);
  assert.equal(resolveConfig({ timeoutMs: 99_999 }, {}).timeoutMs, 30_000);
  assert.equal(resolveConfig({}, { VALORBRAIN_HOOK_TIMEOUT_MS: "2500" }).timeoutMs, 2500);
});

test("conversationAccessGranted reads plugins.entries.<id>.hooks", () => {
  assert.equal(conversationAccessGranted({}, "valorbrain"), false);
  assert.equal(
    conversationAccessGranted({ plugins: { entries: { valorbrain: { hooks: { allowConversationAccess: true } } } } }, "valorbrain"),
    true,
  );
});

test("versions agree across package.json, manifest and code; manifest schema matches config keys", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, PLUGIN_VERSION);
  assert.equal(manifest.version, PLUGIN_VERSION);
  assert.equal(manifest.id, "valorbrain");
  assert.equal(manifest.kind, "memory");
  assert.deepEqual(pkg.openclaw.extensions, ["./dist/index.js"]);
  assert.deepEqual(Object.keys(manifest.configSchema.properties).sort(), [
    "apiUrl", "captureTimeoutMs", "captureTranscript", "recall", "timeoutMs", "token", "tools",
  ]);
});
