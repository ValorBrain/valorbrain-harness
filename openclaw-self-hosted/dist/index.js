var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/openclaw/shell.ts
var exports_shell = {};
__export(exports_shell, {
  execCommand: () => execCommand,
  execHook: () => execHook,
  extractContext: () => extractContext,
  parseHookOutput: () => parseHookOutput,
  resolveValorBrainBin: () => resolveValorBrainBin,
  spawnBackground: () => spawnBackground
});
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function resolveValorBrainBin(configured) {
  if (configured && existsSync(configured))
    return configured;
  for (const p of SEARCH_PATHS) {
    if (existsSync(p))
      return p;
  }
  return "valorbrain";
}
function execHook(cfg, hookName, input, timeout) {
  const hookTimeout = timeout ?? (hookName === "decision-extractor" || hookName === "episode-extractor" || hookName === "handoff-generator" ? EXTRACTION_TIMEOUT : DEFAULT_TIMEOUT);
  return new Promise((resolve2) => {
    const child = execFile(cfg.valorbrainBin, ["hook", hookName], {
      timeout: hookTimeout,
      env: { ...process.env, ...cfg.env },
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        const msg = error.killed ? `timeout after ${hookTimeout}ms` : String(error.message || error);
        resolve2({
          stdout: "",
          stderr: `[valorbrain-plugin] hook ${hookName} failed: ${msg}
${stderr}`,
          exitCode: error.code ?? 1
        });
        return;
      }
      resolve2({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
    });
    if (child.stdin) {
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    }
  });
}
function execCommand(cfg, args, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve2) => {
    execFile(cfg.valorbrainBin, args, {
      timeout,
      env: { ...process.env, ...cfg.env },
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        resolve2({
          stdout: "",
          stderr: `[valorbrain-plugin] command failed: ${String(error.message || error)}
${stderr}`,
          exitCode: error.code ?? 1
        });
        return;
      }
      resolve2({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
    });
  });
}
function spawnBackground(cfg, args, logger) {
  const child = spawn(cfg.valorbrainBin, args, {
    env: { ...process.env, ...cfg.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });
  child.stdout?.on("data", (data) => {
    logger?.info(`[valorbrain-serve] ${data.toString().trim()}`);
  });
  child.stderr?.on("data", (data) => {
    logger?.warn(`[valorbrain-serve] ${data.toString().trim()}`);
  });
  child.on("exit", (code, signal) => {
    logger?.warn(`[valorbrain-serve] exited (code=${code}, signal=${signal})`);
  });
  child.unref();
  return child;
}
function parseHookOutput(stdout) {
  if (!stdout.trim())
    return null;
  try {
    return JSON.parse(stdout.trim());
  } catch {
    const lastBrace = stdout.lastIndexOf("}");
    const firstBrace = stdout.indexOf("{");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
function extractContext(hookOutput) {
  if (!hookOutput)
    return "";
  const hso = hookOutput.hookSpecificOutput;
  return hso?.additionalContext || "";
}
var __filename2, __dirname2, SEARCH_PATHS, DEFAULT_TIMEOUT = 1e4, EXTRACTION_TIMEOUT = 30000;
var init_shell = __esm(() => {
  __filename2 = fileURLToPath(import.meta.url);
  __dirname2 = dirname(__filename2);
  SEARCH_PATHS = [
    resolve(__dirname2, "../../bin/valorbrain"),
    "/usr/local/bin/valorbrain",
    resolve(process.env.HOME || "/tmp", "Projects/forge-stack/skill-forge/valorbrain/bin/valorbrain"),
    resolve(process.env.HOME || "/tmp", "valorbrain/bin/valorbrain")
  ];
});

// src/openclaw/index.ts
init_shell();

// src/openclaw/tools.ts
async function apiCall(cfg, method, path, body) {
  const url = `http://127.0.0.1:${cfg.servePort}${path}`;
  const headers = { "Content-Type": "application/json" };
  const token = cfg.env.VALORBRAIN_API_TOKEN || process.env.VALORBRAIN_API_TOKEN;
  if (token)
    headers["Authorization"] = `Bearer ${token}`;
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000)
    });
    const data = await resp.json();
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: `ValorBrain API unreachable at ${url}: ${String(err)}` }
    };
  }
}
function createTools(cfg, _logger) {
  return [
    {
      name: "valorbrain_search",
      label: "ValorBrain Search",
      description: "Search long-term memory for relevant context. Supports keyword, semantic, and hybrid modes. " + "Use for recalling past decisions, preferences, session history, and learned patterns.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          mode: {
            type: "string",
            enum: ["auto", "keyword", "semantic", "hybrid"],
            description: "Search mode (default: auto)"
          },
          collection: { type: "string", description: "Limit to specific collection" },
          limit: { type: "number", description: "Max results (default: 10, max: 50)" },
          compact: { type: "boolean", description: "Return compact results (default: true)" }
        },
        required: ["query"]
      },
      async execute(_id, params) {
        const result = await apiCall(cfg, "POST", "/search", {
          query: params.query,
          mode: params.mode ?? "auto",
          collection: params.collection,
          limit: params.limit ?? 10,
          compact: params.compact ?? true
        });
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Search failed: ${result.data?.error || "unknown error"}` }]
          };
        }
        const data = result.data;
        if (!data.results || data.results.length === 0) {
          return {
            content: [{ type: "text", text: "No relevant memories found." }],
            details: { count: 0 }
          };
        }
        const text = data.results.map((r, i) => `${i + 1}. [${r.contentType || "note"}] ${r.title || r.path} (score: ${r.score})${r.snippet ? `
   ${r.snippet}` : ""}`).join(`
`);
        return {
          content: [{ type: "text", text: `Found ${data.count} results:

${text}` }],
          details: { count: data.count, query: data.query, mode: data.mode }
        };
      }
    },
    {
      name: "valorbrain_get",
      label: "ValorBrain Get",
      description: "Retrieve full content of a specific memory document by its docid (6-char hex prefix).",
      parameters: {
        type: "object",
        properties: {
          docid: { type: "string", description: "Document ID (6-char hex prefix from search results)" }
        },
        required: ["docid"]
      },
      async execute(_id, params) {
        const docid = params.docid;
        const result = await apiCall(cfg, "GET", `/documents/${docid}`);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Document not found: ${docid}` }]
          };
        }
        const d = result.data;
        return {
          content: [{
            type: "text",
            text: `# ${d.title || d.path}

Collection: ${d.collection}
Modified: ${d.modifiedAt}

${d.body}`
          }],
          details: { docid: d.docid, path: d.path }
        };
      }
    },
    {
      name: "valorbrain_session_log",
      label: "ValorBrain Sessions",
      description: "List recent session summaries. Use when asked about past work, previous conversations, or session history.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of sessions to return (default: 5)" }
        }
      },
      async execute(_id, params) {
        const limit = params.limit || 5;
        const result = await apiCall(cfg, "GET", `/sessions?limit=${limit}`);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Failed to retrieve sessions: ${result.data?.error}` }]
          };
        }
        const sessions = result.data.sessions;
        if (!sessions || sessions.length === 0) {
          return { content: [{ type: "text", text: "No session history found." }] };
        }
        const text = sessions.map((s, i) => `${i + 1}. [${s.started_at}] ${s.session_id?.slice(0, 8)}... — ${s.prompt_count || 0} prompts`).join(`
`);
        return {
          content: [{ type: "text", text: `Recent sessions:

${text}` }],
          details: { count: sessions.length }
        };
      }
    },
    {
      name: "valorbrain_timeline",
      label: "ValorBrain Timeline",
      description: "Show temporal context around a document — what was created before and after it.",
      parameters: {
        type: "object",
        properties: {
          docid: { type: "string", description: "Document ID (6-char hex prefix)" },
          before: { type: "number", description: "Documents before (default: 5)" },
          after: { type: "number", description: "Documents after (default: 5)" },
          same_collection: { type: "boolean", description: "Limit to same collection (default: false)" }
        },
        required: ["docid"]
      },
      async execute(_id, params) {
        const docid = params.docid;
        const before = params.before ?? 5;
        const after = params.after ?? 5;
        const sameCol = params.same_collection ?? false;
        const qs = `before=${before}&after=${after}&same_collection=${sameCol}`;
        const result = await apiCall(cfg, "GET", `/timeline/${docid}?${qs}`);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Timeline failed: ${result.data?.error}` }]
          };
        }
        const d = result.data;
        const lines = [];
        if (d.before?.length) {
          lines.push("**Before:**");
          for (const e of d.before)
            lines.push(`  - [${e.modifiedAt}] ${e.title} (${e.collection})`);
        }
        lines.push(`**→ ${d.anchor?.title || docid}** [${d.anchor?.modifiedAt}]`);
        if (d.after?.length) {
          lines.push("**After:**");
          for (const e of d.after)
            lines.push(`  - [${e.modifiedAt}] ${e.title} (${e.collection})`);
        }
        return {
          content: [{ type: "text", text: lines.join(`
`) }],
          details: { docid, before: d.before?.length, after: d.after?.length }
        };
      }
    },
    {
      name: "valorbrain_similar",
      label: "ValorBrain Similar",
      description: "Find documents semantically similar to a given document. Use for discovery and context expansion.",
      parameters: {
        type: "object",
        properties: {
          docid: { type: "string", description: "Document ID (6-char hex prefix)" },
          limit: { type: "number", description: "Max results (default: 5)" }
        },
        required: ["docid"]
      },
      async execute(_id, params) {
        const docid = params.docid;
        const limit = params.limit ?? 5;
        const result = await apiCall(cfg, "GET", `/graph/similar/${docid}?limit=${limit}`);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Similar search failed: ${result.data?.error}` }]
          };
        }
        const similar = result.data.similar;
        if (!similar || similar.length === 0) {
          return { content: [{ type: "text", text: "No similar documents found." }] };
        }
        const text = similar.map((s, i) => `${i + 1}. ${s.title || s.path} (similarity: ${s.score})`).join(`
`);
        return {
          content: [{ type: "text", text: `Similar documents:

${text}` }],
          details: { count: similar.length }
        };
      }
    },
    {
      name: "valorbrain_memory_used",
      label: "ValorBrain Memory Used",
      description: "Declare which retrieved memories you actually used in your answer (docids like '#ab12cd' " + "from search results, or document paths). Call after answering with memory content. " + "Used memories rise in ranking, ignored ones decay — without this declaration the " + "quality signal stays blind. When the user confirms what a memory said, pass " + "verdict='confirmed'; when they correct or contradict it, pass verdict='corrected'.",
      parameters: {
        type: "object",
        properties: {
          docids: {
            type: "array",
            items: { type: "string" },
            description: "Docids ('#ab12cd') or paths of the memories actually used"
          },
          verdict: {
            type: "string",
            enum: ["confirmed", "corrected"],
            description: "V5: user confirmed ('confirmed') or corrected/contradicted ('corrected') the memory"
          },
          note: { type: "string", description: "Optional: why they were useful" }
        },
        required: ["docids"]
      },
      async execute(_id, params) {
        const docids = params.docids ?? [];
        const result = await apiCall(cfg, "POST", "/api/v1/memory/used", {
          docids,
          verdict: params.verdict,
          note: params.note
        });
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Declare failed: ${result.data?.error || result.status}` }]
          };
        }
        return {
          content: [
            { type: "text", text: `Declared ${result.data?.declared} memory(ies) as used.` }
          ],
          details: { declared: result.data?.declared, marked: result.data.marked }
        };
      }
    }
  ];
}

// src/openclaw/engine.ts
init_shell();

// src/openclaw/session-state.ts
var bootstrapContexts = new Map;
var surfacedSessions = new Set;
function setBootstrapContext(sessionId, ctx) {
  bootstrapContexts.set(sessionId, ctx);
}
function takeBootstrapContext(sessionId) {
  const ctx = bootstrapContexts.get(sessionId);
  if (ctx !== undefined)
    bootstrapContexts.delete(sessionId);
  return ctx;
}
function markSessionSurfaced(sessionId) {
  surfacedSessions.add(sessionId);
}
function isSessionSurfaced(sessionId) {
  return surfacedSessions.has(sessionId);
}
function clearSessionState(sessionId) {
  bootstrapContexts.delete(sessionId);
  surfacedSessions.delete(sessionId);
}

// src/openclaw/compaction-threshold.ts
var PRECOMPACT_PROXIMITY_RATIO_DEFAULT = 0.85;
var DEFAULT_CONTEXT_WINDOW_TOKENS = 200000;
var DEFAULT_SOFT_THRESHOLD_TOKENS = 4000;
var DEFAULT_RESERVE_TOKENS_FLOOR = 8000;
function resolveCompactionThreshold(cfg) {
  const contextWindow = cfg.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const reserve = cfg.reserveTokensFloor ?? DEFAULT_RESERVE_TOKENS_FLOOR;
  const soft = cfg.softThresholdTokens ?? DEFAULT_SOFT_THRESHOLD_TOKENS;
  const threshold = contextWindow - reserve - soft;
  return Math.max(threshold, 1000);
}
function resolveProximityRatio(cfg) {
  const fromConfig = cfg.precompactProximityRatio;
  const fromEnv = (() => {
    const raw = process.env.VALORBRAIN_PRECOMPACT_PROXIMITY_RATIO;
    if (!raw)
      return;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  })();
  const ratio = fromConfig ?? fromEnv ?? PRECOMPACT_PROXIMITY_RATIO_DEFAULT;
  if (ratio < 0.5)
    return 0.5;
  if (ratio > 0.95)
    return 0.95;
  return ratio;
}
function estimateTokensFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0)
    return 0;
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg === "string") {
      totalChars += msg.length;
      continue;
    }
    if (msg && typeof msg === "object") {
      const m = msg;
      const content = m.content;
      if (typeof content === "string") {
        totalChars += content.length;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === "string") {
            totalChars += part.length;
          } else if (part && typeof part === "object") {
            const p = part;
            if (typeof p.text === "string") {
              totalChars += p.text.length;
            } else {
              try {
                totalChars += JSON.stringify(p).length;
              } catch {}
            }
          }
        }
      } else {
        try {
          totalChars += JSON.stringify(msg).length;
        } catch {}
      }
    }
  }
  return Math.ceil(totalChars / 4);
}
function isWithinPrecompactProximity(params) {
  return params.estimatedTokens >= params.proximityRatio * params.threshold;
}

// src/openclaw/transcript-resolver.ts
import { existsSync as existsSync2, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve as resolve2 } from "node:path";
import { homedir } from "node:os";
var DEFAULT_AGENT_ID = "main";
var SAFE_SESSION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
var AGENT_ID_VALID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
var AGENT_ID_INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
var AGENT_ID_LEADING_DASH_RE = /^-+/;
var AGENT_ID_TRAILING_DASH_RE = /-+$/;
function normalizeAgentId(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed)
    return DEFAULT_AGENT_ID;
  const lowered = trimmed.toLowerCase();
  if (AGENT_ID_VALID_RE.test(trimmed)) {
    return lowered;
  }
  const sanitized = lowered.replace(AGENT_ID_INVALID_CHARS_RE, "-").replace(AGENT_ID_LEADING_DASH_RE, "").replace(AGENT_ID_TRAILING_DASH_RE, "").slice(0, 64);
  return sanitized || DEFAULT_AGENT_ID;
}
var LEGACY_STATE_DIRNAMES = [".clawdbot"];
var NEW_STATE_DIRNAME = ".openclaw";
function resolveOpenClawStateDir(env = process.env, home = homedir) {
  const stateOverride = env.OPENCLAW_STATE_DIR?.trim();
  if (stateOverride) {
    return resolveHomeRelative(stateOverride, home);
  }
  const effectiveHome = (() => {
    const homeOverride = env.OPENCLAW_HOME?.trim();
    if (homeOverride)
      return resolveHomeRelative(homeOverride, home);
    return home();
  })();
  const newDir = join(effectiveHome, NEW_STATE_DIRNAME);
  if (env.OPENCLAW_TEST_FAST === "1") {
    return newDir;
  }
  try {
    if (existsSync2(newDir))
      return newDir;
  } catch {}
  for (const legacyName of LEGACY_STATE_DIRNAMES) {
    const legacyDir = join(effectiveHome, legacyName);
    try {
      if (existsSync2(legacyDir))
        return legacyDir;
    } catch {}
  }
  return newDir;
}
function resolveHomeRelative(input, home) {
  if (input === "~")
    return home();
  if (input.startsWith("~/"))
    return join(home(), input.slice(2));
  return resolve2(input);
}
function lookupSessionFileFromStore(params) {
  const storePath = join(params.sessionsDir, "sessions.json");
  let raw;
  try {
    raw = readFileSync(storePath, "utf-8");
  } catch {
    return;
  }
  if (!raw.trim())
    return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }
  const store = parsed;
  const resolveEntryFile = (entry) => {
    const file = entry?.sessionFile;
    if (typeof file !== "string" || !file.trim())
      return;
    const trimmed = file.trim();
    return isAbsolute(trimmed) ? trimmed : join(params.sessionsDir, trimmed);
  };
  if (params.sessionKey) {
    const directEntry = store[params.sessionKey];
    if (directEntry && typeof directEntry === "object" && !Array.isArray(directEntry)) {
      const candidate = resolveEntryFile(directEntry);
      if (candidate)
        return candidate;
    }
  }
  for (const value of Object.values(store)) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      continue;
    const entry = value;
    if (typeof entry.sessionId === "string" && entry.sessionId === params.sessionId) {
      const candidate = resolveEntryFile(entry);
      if (candidate)
        return candidate;
    }
  }
  return;
}
function buildTranscriptFileName(sessionId, topicId) {
  if (topicId === undefined || topicId === null || topicId === "") {
    return `${sessionId}.jsonl`;
  }
  const encoded = typeof topicId === "string" ? encodeURIComponent(topicId) : String(topicId);
  return `${sessionId}-topic-${encoded}.jsonl`;
}
function resolveOpenClawSessionFile(params) {
  const sessionId = params.sessionId?.trim();
  if (!sessionId)
    return;
  if (!SAFE_SESSION_ID_RE.test(sessionId))
    return;
  const agentId = normalizeAgentId(params.agentId);
  let stateDir;
  try {
    stateDir = resolveOpenClawStateDir(params.env);
  } catch {
    return;
  }
  const sessionsDir = join(stateDir, "agents", agentId, "sessions");
  const fromStore = lookupSessionFileFromStore({
    sessionsDir,
    sessionId,
    sessionKey: params.sessionKey
  });
  if (fromStore) {
    try {
      if (existsSync2(fromStore))
        return fromStore;
    } catch {}
  }
  if (params.topicId !== undefined && params.topicId !== null && params.topicId !== "") {
    const explicitTopic = join(sessionsDir, buildTranscriptFileName(sessionId, params.topicId));
    try {
      if (existsSync2(explicitTopic))
        return explicitTopic;
    } catch {}
    return;
  }
  let baseExists = false;
  try {
    baseExists = existsSync2(join(sessionsDir, `${sessionId}.jsonl`));
  } catch {
    baseExists = false;
  }
  let topicMatches = [];
  try {
    const topicPrefix = `${sessionId}-topic-`;
    const entries = readdirSync(sessionsDir);
    topicMatches = entries.filter((name) => name.startsWith(topicPrefix) && name.endsWith(".jsonl"));
  } catch {
    topicMatches = [];
  }
  if (baseExists && topicMatches.length > 0) {
    return;
  }
  if (baseExists && topicMatches.length === 0) {
    return join(sessionsDir, `${sessionId}.jsonl`);
  }
  if (!baseExists && topicMatches.length === 1) {
    return join(sessionsDir, topicMatches[0]);
  }
  return;
}

// src/openclaw/engine.ts
var defaultHookRunner = {
  execHook,
  parseHookOutput,
  extractContext
};
var activeHookRunner = defaultHookRunner;
var defaultResolveSessionFile = (params) => resolveOpenClawSessionFile(params);
var activeResolveSessionFile = defaultResolveSessionFile;
function cleanPromptForSearch(prompt) {
  let cleaned = prompt;
  cleaned = cleaned.replace(/<vault-context>[\s\S]*?<\/vault-context>/g, "");
  cleaned = cleaned.replace(/<vault-routing>[\s\S]*?<\/vault-routing>/g, "");
  cleaned = cleaned.replace(/<vault-session>[\s\S]*?<\/vault-session>/g, "");
  cleaned = cleaned.replace(/Sender\s*\(untrusted metadata\)\s*:\s*```json\n[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/Sender\s*\(untrusted metadata\)\s*:\s*\{[\s\S]*?\}\s*/g, "");
  cleaned = cleaned.replace(/OpenClaw runtime context \(internal\):[\s\S]*?(?=\n\n|\n?$)/g, "");
  cleaned = cleaned.replace(/^System:.*$/gm, "");
  cleaned = cleaned.replace(/^\[.*?GMT[+-]\d+\]\s*/gm, "");
  cleaned = cleaned.replace(/\n{3,}/g, `

`).trim();
  return cleaned || prompt;
}
async function handleBeforePromptBuild(cfg, thresholdCfg, logger, event, ctx) {
  if (!event.prompt || event.prompt.length < 5)
    return;
  const sessionId = ctx.sessionId || "unknown";
  const isFirstTurn = !isSessionSurfaced(sessionId);
  let context = "";
  if (isFirstTurn) {
    markSessionSurfaced(sessionId);
    const bootstrapContext = takeBootstrapContext(sessionId);
    if (bootstrapContext) {
      context += bootstrapContext + `

`;
    }
    context += `<valorbrain-quality-loop>
` + "After answering with retrieved memory, call `valorbrain_memory_used` with the " + "docids (e.g. '#ab12cd') or paths of the memories you actually used. " + "Used memories rise in ranking; ignored ones decay. " + 'When the user confirms what a memory said, pass verdict="confirmed"; when they ' + `correct or contradict it, pass verdict="corrected".
` + `</valorbrain-quality-loop>

`;
  }
  const searchPrompt = cleanPromptForSearch(event.prompt);
  if (process.env.VALORBRAIN_MEMORY_PREPARE_HOOK === "1") {
    const prepareResult = await activeHookRunner.execHook(cfg, "memory-prepare", {
      session_id: sessionId,
      prompt: searchPrompt
    });
    if (prepareResult.exitCode === 0) {
      const parsed = activeHookRunner.parseHookOutput(prepareResult.stdout);
      const prepared = activeHookRunner.extractContext(parsed);
      if (prepared)
        context += prepared + `

`;
    }
  }
  const surfacingResult = await activeHookRunner.execHook(cfg, "context-surfacing", {
    session_id: sessionId,
    prompt: searchPrompt
  });
  if (surfacingResult.exitCode === 0) {
    const parsed = activeHookRunner.parseHookOutput(surfacingResult.stdout);
    const surfacedContext = activeHookRunner.extractContext(parsed);
    if (surfacedContext) {
      context += surfacedContext;
    }
  } else {
    logger.warn(`valorbrain: context-surfacing failed: ${surfacingResult.stderr}`);
  }
  const sessionFile = activeResolveSessionFile({
    sessionId,
    agentId: ctx.agentId,
    sessionKey: ctx.sessionKey
  });
  await maybeRunPrecompactExtract(cfg, thresholdCfg, logger, {
    sessionId,
    sessionFile,
    messages: event.messages
  });
  if (!context.trim())
    return;
  return { prependContext: context.trim() };
}
async function maybeRunPrecompactExtract(cfg, thresholdCfg, logger, params) {
  const force = params.force === true;
  if (!force) {
    const estimatedTokens = estimateTokensFromMessages(params.messages);
    const threshold = resolveCompactionThreshold(thresholdCfg);
    const proximityRatio = resolveProximityRatio(thresholdCfg);
    const within = isWithinPrecompactProximity({
      estimatedTokens,
      threshold,
      proximityRatio
    });
    if (!within)
      return;
    logger.debug?.(`valorbrain: precompact gate fired (tokens=${estimatedTokens} threshold=${threshold} ratio=${proximityRatio})`);
  }
  if (!params.sessionFile) {
    logger.debug?.(`valorbrain: precompact-extract skipped — no transcript path resolved for session=${params.sessionId}`);
    return;
  }
  const result = await activeHookRunner.execHook(cfg, "precompact-extract", {
    session_id: params.sessionId,
    transcript_path: params.sessionFile
  });
  if (result.exitCode !== 0) {
    logger.warn(`valorbrain: precompact-extract failed: ${result.stderr}`);
  }
}
async function handleAgentEnd(cfg, logger, event, ctx) {
  if (!ctx.sessionId)
    return;
  if (!Array.isArray(event.messages) || event.messages.length < 2)
    return;
  const sessionFile = activeResolveSessionFile({
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    sessionKey: ctx.sessionKey
  });
  if (!sessionFile) {
    logger.debug?.(`valorbrain: agent_end extractors skipped — no transcript path resolved for session=${ctx.sessionId}`);
    return;
  }
  const hookInput = {
    session_id: ctx.sessionId,
    transcript_path: sessionFile
  };
  const [decisionResult, episodeResult, handoffResult, feedbackResult] = await Promise.allSettled([
    activeHookRunner.execHook(cfg, "decision-extractor", hookInput),
    activeHookRunner.execHook(cfg, "episode-extractor", hookInput),
    activeHookRunner.execHook(cfg, "handoff-generator", hookInput),
    activeHookRunner.execHook(cfg, "feedback-loop", hookInput)
  ]);
  for (const [name, result] of [
    ["decision-extractor", decisionResult],
    ["episode-extractor", episodeResult],
    ["handoff-generator", handoffResult],
    ["feedback-loop", feedbackResult]
  ]) {
    if (result.status === "rejected") {
      logger.warn(`valorbrain: agent_end ${name} failed: ${String(result.reason)}`);
    } else if (result.value.exitCode !== 0) {
      logger.warn(`valorbrain: agent_end ${name} error: ${result.value.stderr}`);
    }
  }
}
async function handleBeforeCompaction(cfg, thresholdCfg, logger, event, ctx) {
  const sessionId = ctx.sessionKey || "compaction-fallback";
  await maybeRunPrecompactExtract(cfg, thresholdCfg, logger, {
    sessionId,
    sessionFile: event.sessionFile,
    messages: event.messages,
    force: true
  });
}
async function handleSessionStart(cfg, logger, event, _ctx) {
  const result = await activeHookRunner.execHook(cfg, "session-bootstrap", {
    session_id: event.sessionId
  });
  if (result.exitCode === 0) {
    const parsed = activeHookRunner.parseHookOutput(result.stdout);
    const bootstrapCtx = activeHookRunner.extractContext(parsed);
    if (bootstrapCtx) {
      setBootstrapContext(event.sessionId, bootstrapCtx);
    }
  } else {
    logger.warn(`valorbrain: session-bootstrap failed: ${result.stderr}`);
  }
  logger.info(`valorbrain: session started ${event.sessionId}`);
}
function handleSessionEnd(logger, event) {
  clearSessionState(event.sessionId);
  logger.info(`valorbrain: session ended ${event.sessionId} (${event.messageCount} messages)`);
}
async function handleBeforeReset(cfg, logger, event, ctx) {
  if (!ctx.sessionId)
    return;
  const sessionFile = event.sessionFile ?? activeResolveSessionFile({
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    sessionKey: ctx.sessionKey
  });
  if (!sessionFile) {
    clearSessionState(ctx.sessionId);
    logger.debug?.(`valorbrain: before_reset extractor sweep skipped — no transcript path resolved for session=${ctx.sessionId}`);
    return;
  }
  const hookInput = {
    session_id: ctx.sessionId,
    transcript_path: sessionFile
  };
  await Promise.allSettled([
    activeHookRunner.execHook(cfg, "decision-extractor", hookInput),
    activeHookRunner.execHook(cfg, "episode-extractor", hookInput),
    activeHookRunner.execHook(cfg, "handoff-generator", hookInput),
    activeHookRunner.execHook(cfg, "feedback-loop", hookInput)
  ]);
  clearSessionState(ctx.sessionId);
  logger.info(`valorbrain: before_reset cleanup for ${ctx.sessionId}`);
}

// src/openclaw/index.ts
var PROFILE_BUDGETS = {
  speed: 400,
  balanced: 800,
  deep: 1200
};
var valorbrainPlugin = {
  id: "valorbrain",
  name: "ValorBrain",
  description: "On-device hybrid memory layer for OpenClaw — composite scoring, graph traversal, lifecycle management, and pre-emptive compaction state extraction",
  version: "0.10.1",
  kind: "memory",
  register(api) {
    const pluginCfg = api.pluginConfig || {};
    const profile = pluginCfg.profile || "balanced";
    const tokenBudget = pluginCfg.tokenBudget || PROFILE_BUDGETS[profile] || 800;
    const cfg = {
      valorbrainBin: resolveValorBrainBin(pluginCfg.valorbrainBin),
      tokenBudget,
      profile,
      enableTools: pluginCfg.enableTools !== false,
      servePort: pluginCfg.servePort || 7438,
      env: {
        ...pluginCfg.gpuEmbed ? { VALORBRAIN_EMBED_URL: pluginCfg.gpuEmbed } : {},
        ...pluginCfg.gpuLlm ? { VALORBRAIN_LLM_URL: pluginCfg.gpuLlm } : {},
        ...pluginCfg.gpuLlmModel ? { VALORBRAIN_LLM_MODEL: pluginCfg.gpuLlmModel } : {},
        ...pluginCfg.gpuLlmReasoningEffort ? { VALORBRAIN_LLM_REASONING_EFFORT: pluginCfg.gpuLlmReasoningEffort } : {},
        ...pluginCfg.gpuLlmNoThink !== undefined ? { VALORBRAIN_LLM_NO_THINK: String(pluginCfg.gpuLlmNoThink) } : {},
        ...pluginCfg.gpuRerank ? { VALORBRAIN_RERANK_URL: pluginCfg.gpuRerank } : {},
        VALORBRAIN_PROFILE: profile
      }
    };
    const thresholdCfg = {
      contextWindowTokens: pluginCfg.compactionContextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
      precompactProximityRatio: pluginCfg.precompactProximityRatio ?? PRECOMPACT_PROXIMITY_RATIO_DEFAULT,
      softThresholdTokens: pluginCfg.softThresholdTokens ?? DEFAULT_SOFT_THRESHOLD_TOKENS,
      reserveTokensFloor: pluginCfg.reserveTokensFloor ?? DEFAULT_RESERVE_TOKENS_FLOOR
    };
    const logger = api.logger;
    logger.info(`valorbrain: plugin registered (kind=memory, bin=${cfg.valorbrainBin}, profile=${profile}, budget=${tokenBudget})`);
    api.registerMemoryCapability({
      runtime: {
        async getMemorySearchManager(_params) {
          return { manager: null };
        },
        resolveMemoryBackendConfig(_params) {
          return { backend: "builtin" };
        }
      }
    });
    api.on("before_prompt_build", async (event, ctx) => {
      return handleBeforePromptBuild(cfg, thresholdCfg, logger, event, ctx);
    }, { priority: 10 });
    api.on("agent_end", async (event, ctx) => {
      await handleAgentEnd(cfg, logger, event, ctx);
    });
    api.on("before_compaction", async (event, ctx) => {
      await handleBeforeCompaction(cfg, thresholdCfg, logger, event, ctx);
    });
    api.on("session_start", async (event, ctx) => {
      await handleSessionStart(cfg, logger, event, ctx);
    });
    api.on("session_end", async (event, _ctx) => {
      handleSessionEnd(logger, event);
    });
    api.on("before_reset", async (event, ctx) => {
      await handleBeforeReset(cfg, logger, event, ctx);
    });
    if (cfg.enableTools) {
      const tools = createTools(cfg, logger);
      for (const tool of tools) {
        api.registerTool({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: tool.parameters,
          async execute(toolCallId, params) {
            return tool.execute(toolCallId, params);
          }
        }, { name: tool.name });
      }
      logger.info(`valorbrain: registered ${tools.length} agent tools`);
    }
    let serveChild = null;
    api.registerService({
      id: "valorbrain-api",
      async start(svcCtx) {
        const { spawnBackground: spawnBackground2 } = await Promise.resolve().then(() => (init_shell(), exports_shell));
        serveChild = spawnBackground2(cfg, ["serve", "--port", String(cfg.servePort)], svcCtx.logger);
        svcCtx.logger.info(`valorbrain: REST API spawned (pid=${serveChild.pid})`);
      },
      stop() {
        if (serveChild && !serveChild.killed) {
          serveChild.kill("SIGTERM");
          logger.info("valorbrain: REST API service stopped");
        }
        serveChild = null;
      }
    });
  }
};
var openclaw_default = valorbrainPlugin;
export {
  openclaw_default as default
};
