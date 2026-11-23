// Live test against the ValorBrain STAGING engine. Skipped unless
// VB_STAGING_MCP_URL and VB_STAGING_MCP_TOKEN are set; refuses production.
//
//   set -a; . /etc/valorbrain/integracoes-staging.env; set +a
//   bun test --timeout 600000 mcp/test/live.test.ts
//
// 1. Protocol control: initialize → tools/list → memory_store → memory_retrieve
//    finds it → memory_forget → gone.
// 2. Each installed client loads its recipe from mcp/clients (URL swapped for a
//    local recording proxy in front of staging) in a throwaway HOME, and the
//    proxy must see that client's initialize + tools/list answered 200.
//    No client ever reads the real ~/.gemini, ~/.codex, ~/.config/opencode, ~/.kiro or ~/.cline.
//
// Optional, opt-in clients:
//   VB_LIVE_KIRO_DATA_DIR       kiro-cli data dir to copy the login from (Kiro will not load MCP logged out)
//   VB_LIVE_OPENROUTER_API_KEY  lets the Cline CLI run one model turn (Cline connects MCP only inside a task)
//   VB_LIVE_OPEN_WEBUI=1        boots Open WebUI with `uv tool run` (multi-GB download; reuse UV_CACHE_DIR)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { at, recipe, retarget, TOKEN_ENV, TOKEN_PLACEHOLDER } from "./catalog";
import { type Recorder, startRecorder } from "./recorder";

const STAGING = process.env.VB_STAGING_MCP_URL ?? "";
const TOKEN = process.env.VB_STAGING_MCP_TOKEN ?? "";
const LIVE = STAGING !== "" && TOKEN !== "";
if (LIVE && new URL(STAGING).hostname.endsWith("valor.digital")) {
  throw new Error("live test must target staging, not production");
}

const homes: string[] = [];
let recorder: Recorder;

beforeAll(() => {
  if (LIVE) recorder = startRecorder(STAGING);
});

afterAll(() => {
  recorder?.stop();
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

function newHome(label: string): string {
  const home = mkdtempSync(join(tmpdir(), `vb-mcp-${label}-`));
  chmodSync(home, 0o700);
  for (const d of ["proj", "tmp", "run", ".config", ".local/share", ".local/state", ".cache"]) mkdirSync(join(home, d), { recursive: true });
  homes.push(home);
  return home;
}

/** Throwaway environment: nothing from the runner's HOME or client config dirs leaks in. */
function childEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: process.env.LANG ?? "C.UTF-8",
    TERM: "xterm-256color",
    HOME: home,
    TMPDIR: join(home, "tmp"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_STATE_HOME: join(home, ".local/state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: join(home, "run"),
    NO_COLOR: "1",
    [TOKEN_ENV]: TOKEN,
  };
  if (process.env.UV_CACHE_DIR) env.UV_CACHE_DIR = process.env.UV_CACHE_DIR;
  return { ...env, ...extra };
}

function writePrivate(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
}

interface RunResult {
  code: number | null;
  out: string;
}

async function run(argv: string[], home: string, opts: { env?: Record<string, string>; timeoutMs?: number } = {}): Promise<RunResult> {
  const proc = Bun.spawn(argv, { cwd: join(home, "proj"), env: childEnv(home, opts.env), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 120_000);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  clearTimeout(timer);
  return { code: proc.exitCode, out: (stdout + stderr).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "") };
}

/** Start a long-running client and stop it once the recorder has seen its tools/list.
 *  `tty` keeps stdin open (for `script`); otherwise stdin is closed, which `codex exec` needs to start. */
async function runUntilListed(argv: string[], home: string, sourceAgent: string, env: Record<string, string> = {}, tty = false): Promise<boolean> {
  const proc = Bun.spawn(argv, { cwd: join(home, "proj"), env: childEnv(home, env), stdin: tty ? "pipe" : "ignore", stdout: "ignore", stderr: "ignore" });
  const listed = await waitFor(() => recorder.from(sourceAgent, "tools/list").some((s) => s.status === 200), 90_000);
  proc.kill();
  await proc.exited;
  return listed;
}

/** Polls a real external condition (async indexing on the engine, a child process
 *  reaching a server); fake timers cannot drive either, so this waits on the wall clock. */
async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number, everyMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await Bun.sleep(everyMs);
  }
  return false;
}

function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("no free port");
  return port;
}

/** The client connected with a vbm_ bearer and the given JSON-RPC calls came back 200. */
function expectHandshake(sourceAgent: string, rpcs: readonly string[] = ["initialize", "tools/list"]): void {
  for (const rpc of rpcs) {
    const hits = recorder.from(sourceAgent, rpc);
    expect(hits.length, `${sourceAgent} ${rpc}`).toBeGreaterThan(0);
    expect(hits.every((s) => s.status === 200 && s.bearer), `${sourceAgent} ${rpc} 200 with bearer`).toBe(true);
  }
}

// ── 1. protocol control ──────────────────────────────────────────────────────

let rpcId = 0;
async function rpc(method: string, params?: unknown): Promise<unknown> {
  const res = await fetch(STAGING, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "user-agent": "valorbrain-mcp-recipes/1.0",
      "x-source-agent": "mcp-recipes",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status).toBe(200);
  const body: unknown = await res.json();
  const result = at(body, ["result"]);
  if (result === undefined) throw new Error(`${method}: ${JSON.stringify(body).slice(0, 300)}`);
  return result;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ docid: unknown; action: unknown; hits: unknown[] }> {
  const result = await rpc("tools/call", { name, arguments: args });
  const results = at(result, ["structuredContent", "results"]);
  return {
    docid: at(result, ["structuredContent", "docid"]),
    action: at(result, ["structuredContent", "action"]),
    hits: (Array.isArray(results) ? results : []).map((r: unknown) => at(r, ["docid"])),
  };
}

async function retrievable(marker: string, docid: string): Promise<boolean> {
  return (await callTool("memory_retrieve", { query: marker, mode: "keyword", limit: 5 })).hits.includes(docid);
}

describe.skipIf(!LIVE)("protocol control (staging)", () => {
  test("store → retrieve → forget", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "valorbrain-mcp-recipes", version: "1.0" } });
    expect(at(init, ["serverInfo", "name"])).toBe("valorbrain");
    const tools = at(await rpc("tools/list"), ["tools"]);
    const names = (Array.isArray(tools) ? tools : []).map((t: unknown) => at(t, ["name"]));
    for (const t of ["memory_store", "memory_retrieve", "memory_forget", "whoami"]) expect(names).toContain(t);

    const marker = `mcp-recipes-live-${Date.now()}`;
    const stored = await callTool("memory_store", {
      title: `MCP recipes live test ${marker}`,
      content: `Positive control written by mcp/test/live.test.ts. Marker ${marker}. Deleted by the same test.`,
      type: "note",
      tags: ["mcp-recipes-test"],
    });
    const docid = String(stored.docid ?? "");
    expect(docid).toMatch(/^#[0-9a-f]+$/);

    const found = await waitFor(() => retrievable(marker, docid), 30_000, 1000);
    expect(found).toBe(true);

    const forgot = await callTool("memory_forget", { docid, confirm: true });
    expect(forgot.action).toBe("deactivated");
    const gone = await waitFor(async () => !(await retrievable(marker, docid)), 15_000, 1000);
    expect(gone).toBe(true);
  }, 90_000);
});

// ── 2. real clients ──────────────────────────────────────────────────────────

describe.skipIf(!LIVE || !Bun.which("gemini"))("gemini-cli", () => {
  test("gemini mcp list → Connected", async () => {
    const home = newHome("gemini");
    writePrivate(join(home, ".gemini/settings.json"), retarget(recipe("gemini-cli", "settings.json"), recorder.url));
    writePrivate(join(home, ".gemini/trustedFolders.json"), JSON.stringify({ [join(home, "proj")]: "TRUST_FOLDER" }));
    const r = await run(["gemini", "mcp", "list"], home);
    expect(r.out).toMatch(/valorbrain: \S+ \(http\) - Connected/);
    // `gemini mcp list` checks the connection with initialize only; tools are listed in a session.
    expectHandshake("gemini-cli", ["initialize"]);
  }, 180_000);
});

describe.skipIf(!LIVE || !Bun.which("opencode"))("opencode", () => {
  test("opencode mcp list → connected", async () => {
    const home = newHome("opencode");
    writePrivate(join(home, ".config/opencode/opencode.json"), retarget(recipe("opencode", "opencode.json"), recorder.url));
    const r = await run(["opencode", "mcp", "list"], home);
    expect(r.out).toMatch(/valorbrain\s+connected/);
    expectHandshake("opencode");
  }, 180_000);
});

describe.skipIf(!LIVE || !Bun.which("codex"))("codex", () => {
  test("codex exec starts the server (initialize + tools/list), no model needed", async () => {
    const home = newHome("codex");
    // A dead local model endpoint: Codex starts MCP servers before the first model call.
    const offline = 'model_provider = "offline"\nmodel = "none"\n\n[model_providers.offline]\nname = "offline"\nbase_url = "http://127.0.0.1:9/v1"\nwire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0\n\n';
    writePrivate(join(home, ".codex/config.toml"), offline + retarget(recipe("codex", "config.toml"), recorder.url));
    const env = { CODEX_HOME: join(home, ".codex") };
    const get = await run(["codex", "mcp", "get", "valorbrain", "--json"], home, { env });
    expect(get.out).toContain('"bearer_token_env_var": "VALORBRAIN_MCP_TOKEN"');
    expect(await runUntilListed(["codex", "exec", "--skip-git-repo-check", "hi"], home, "codex", env)).toBe(true);
    expectHandshake("codex");
  }, 180_000);
});

describe.skipIf(!LIVE || !Bun.which("kiro-cli") || !Bun.which("script") || !process.env.VB_LIVE_KIRO_DATA_DIR)("kiro-cli", () => {
  test("kiro-cli chat loads the server", async () => {
    const home = newHome("kiro");
    writePrivate(join(home, ".kiro/settings/mcp.json"), retarget(recipe("kiro-cli", "mcp.json"), recorder.url));
    mkdirSync(join(home, ".local/share/kiro-cli"), { recursive: true });
    copyFileSync(join(process.env.VB_LIVE_KIRO_DATA_DIR ?? "", "data.sqlite3"), join(home, ".local/share/kiro-cli/data.sqlite3"));
    // Interactive chat needs a TTY; `script` provides one. MCP servers load at chat start.
    const ok = await runUntilListed(["script", "-qfec", "kiro-cli chat", "/dev/null"], home, "kiro-cli", { KIRO_HOME: join(home, ".kiro") }, true);
    expect(ok).toBe(true);
    expectHandshake("kiro-cli");
  }, 180_000);
});

describe.skipIf(!LIVE || !Bun.which("cline") || !process.env.VB_LIVE_OPENROUTER_API_KEY)("cline CLI", () => {
  test("a Cline task calls valorbrain whoami", async () => {
    const home = newHome("cline");
    // The CLI does not expand ${env:…}; it needs the literal token (what `cline mcp add --header` writes).
    const text = retarget(recipe("cline", "cline_mcp_settings.json"), recorder.url).replace(`\${env:${TOKEN_ENV}}`, TOKEN);
    writePrivate(join(home, ".cline/data/settings/cline_mcp_settings.json"), text);
    const r = await run(
      ["cline", "--json", "-P", "openrouter", "-k", process.env.VB_LIVE_OPENROUTER_API_KEY ?? "", "-m", "openai/gpt-4.1-mini", "Call the whoami tool of the valorbrain MCP server and reply with only its agent field."],
      home,
      { timeoutMs: 120_000 },
    );
    expect(r.out).toContain("valorbrain__whoami");
    expectHandshake("cline");
    expect(recorder.from("cline", "tools/call").some((s) => s.status === 200)).toBe(true);
    Bun.spawnSync(["pkill", "-f", `cline-hub-daemon --cwd ${join(home, "proj")}`]);
  }, 180_000);
});

describe.skipIf(!LIVE || !Bun.which("uvx"))("open-webui via mcpo", () => {
  test("mcpo exposes the tools and whoami answers over OpenAPI", async () => {
    const home = newHome("mcpo");
    const cfg = join(home, "mcpo.config.json");
    // Same recipe, tagged so the recorder can tell mcpo apart from native Open WebUI.
    const text = retarget(recipe("open-webui", "mcpo.config.json"), recorder.url).replace(TOKEN_PLACEHOLDER, TOKEN).replace('"open-webui"', '"open-webui-mcpo"');
    writePrivate(cfg, text);
    const port = freePort();
    const proc = Bun.spawn(["uvx", "--quiet", "--with", "mcp<2", "mcpo@0.0.20", "--host", "127.0.0.1", "--port", String(port), "--config", cfg], {
      cwd: join(home, "proj"),
      env: childEnv(home),
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const base = `http://127.0.0.1:${port}/valorbrain`;
      const up = await waitFor(async () => (await fetch(`${base}/openapi.json`).catch(() => null))?.ok === true, 120_000, 1000);
      expect(up).toBe(true);
      const spec: unknown = await (await fetch(`${base}/openapi.json`)).json();
      expect(Object.keys(at(spec, ["paths"]) ?? {})).toContain("/memory_store");
      const who = await (await fetch(`${base}/whoami`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).text();
      expect(who).toMatch(/agent:\s+open-webui-mcpo/);
      expectHandshake("open-webui-mcpo");
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 240_000);
});

describe.skipIf(!LIVE || !Bun.which("uv") || process.env.VB_LIVE_OPEN_WEBUI !== "1")("open-webui native MCP", () => {
  test("Verify Connection lists the ValorBrain tools", async () => {
    const home = newHome("owui");
    const port = freePort();
    const proc = Bun.spawn(["uv", "tool", "run", "--quiet", "--python", "3.11", "open-webui@0.12.3", "serve", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: join(home, "proj"),
      env: childEnv(home, {
        DATA_DIR: join(home, "data"),
        WEBUI_SECRET_KEY: "vb-mcp-live-test",
        OFFLINE_MODE: "true",
        HF_HUB_OFFLINE: "1",
        ENABLE_OLLAMA_API: "false",
        ENABLE_OPENAI_API: "false",
        BYPASS_EMBEDDING_AND_RETRIEVAL: "true",
        ENABLE_VERSION_UPDATE_CHECK: "false",
        DO_NOT_TRACK: "true",
        ANONYMIZED_TELEMETRY: "false",
      }),
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const up = await waitFor(async () => (await fetch(`${base}/health`).catch(() => null))?.ok === true, 900_000, 2000);
      expect(up).toBe(true);
      const signup: unknown = await (
        await fetch(`${base}/api/v1/auths/signup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "mcp-recipes", email: "mcp-recipes@example.test", password: `Vb-${crypto.randomUUID()}` }),
        })
      ).json();
      expect(at(signup, ["role"])).toBe("admin");
      const [connection] = JSON.parse(retarget(recipe("open-webui", "tool-server-connections.json"), recorder.url).replace(TOKEN_PLACEHOLDER, TOKEN));
      const res = await fetch(`${base}/api/v1/configs/tool_servers/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${String(at(signup, ["token"]))}` },
        body: JSON.stringify(connection),
      });
      expect(res.status).toBe(200);
      const verified: unknown = await res.json();
      expect(at(verified, ["status"])).toBe(true);
      const specs = at(verified, ["specs"]);
      expect((Array.isArray(specs) ? specs : []).map((s: unknown) => at(s, ["name"]))).toContain("memory_retrieve");
      expectHandshake("open-webui");
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 1_000_000);
});
