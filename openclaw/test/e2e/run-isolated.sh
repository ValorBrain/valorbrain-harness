#!/usr/bin/env bash
# End-to-end run of the plugin inside a real, fully isolated OpenClaw:
#   - HOME, OPENCLAW_HOME, OPENCLAW_STATE_DIR and OPENCLAW_CONFIG_PATH point into a fresh temp dir;
#   - the gateway listens on 127.0.0.1:$E2E_GATEWAY_PORT (default 28789, never 18789) with its own token;
#   - channels, cron, gmail, canvas and browser control are off; the model is test/e2e/mock-llm.mjs;
#   - the plugin is installed with `openclaw plugins install <copy of this directory>` into the memory slot.
# Four turns in one session: recall of a seeded memory, a valorbrain_store tool call, a plain turn,
# and a fourth turn whose before_prompt_build sees 3 completed turns and uploads the transcript
# (2026.4.24 cannot grant agent_end to a non-bundled plugin). Everything created in staging is
# forgotten at the end.
#
# Needs VB_STAGING_URL and VB_STAGING_MCP_TOKEN (never printed):
#   set -a; . /etc/valorbrain/integracoes-staging.env; set +a; test/e2e/run-isolated.sh
set -euo pipefail

: "${VB_STAGING_URL:?set VB_STAGING_URL}"
: "${VB_STAGING_MCP_TOKEN:?set VB_STAGING_MCP_TOKEN}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$HERE/../.." && pwd)"
GW_PORT="${E2E_GATEWAY_PORT:-28789}"
LLM_PORT="${E2E_LLM_PORT:-28790}"
REAL_HOME="$HOME"

[[ -f "$PLUGIN_DIR/dist/index.js" ]] || { echo "build first: npm run build" >&2; exit 1; }
[[ "$GW_PORT" != "18789" ]] || { echo "refusing the default gateway port 18789" >&2; exit 1; }
for p in "$GW_PORT" "$LLM_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "port $p is in use — pick E2E_GATEWAY_PORT/E2E_LLM_PORT" >&2; exit 1; fi
done

T="$(mktemp -d /tmp/vb-openclaw-e2e.XXXXXX)"
OUT="${E2E_OUT:-$T/evidence}"
mkdir -p "$OUT" "$T/workspace"
export HOME="$T" OPENCLAW_HOME="$T" OPENCLAW_STATE_DIR="$T/.openclaw" OPENCLAW_CONFIG_PATH="$T/.openclaw/openclaw.json"
export OPENCLAW_SKIP_CHANNELS=1 OPENCLAW_SKIP_CRON=1 OPENCLAW_SKIP_GMAIL_WATCHER=1 OPENCLAW_SKIP_CANVAS_HOST=1 OPENCLAW_SKIP_BROWSER_CONTROL_SERVER=1
export OPENCLAW_GATEWAY_PORT="$GW_PORT"
OPENCLAW_GATEWAY_TOKEN="e2e-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
export OPENCLAW_GATEWAY_TOKEN
unset OPENCLAW_GATEWAY_URL OPENCLAW_GATEWAY_PASSWORD
# The plugin reads its token from the environment; the config file never holds it.
export VALORBRAIN_API_TOKEN="$VB_STAGING_MCP_TOKEN"
[[ "$OPENCLAW_STATE_DIR" != "$REAL_HOME/.openclaw"* ]] || { echo "state dir is not isolated" >&2; exit 1; }

PIDS=()
FORGET=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  if ((${#FORGET[@]})); then
    echo "== cleanup in staging"
    node "$HERE/staging.mjs" forget "${FORGET[@]}" | sed 's/^/   /' || true
  fi
}
trap cleanup EXIT

mkdir -p "$OPENCLAW_STATE_DIR"
cat >"$OPENCLAW_CONFIG_PATH" <<JSON
{
  "gateway": { "mode": "local", "port": $GW_PORT, "bind": "loopback", "auth": { "mode": "token" } },
  "agents": { "defaults": { "workspace": "$T/workspace", "model": { "primary": "mock/mock-1" }, "heartbeat": { "every": "0m" } } },
  "models": { "providers": { "mock": {
    "baseUrl": "http://127.0.0.1:$LLM_PORT/v1", "apiKey": "mock", "api": "openai-completions",
    "models": [ { "id": "mock-1", "name": "Mock", "reasoning": false, "input": ["text"], "contextWindow": 128000, "maxTokens": 4096 } ]
  } } }
}
JSON

echo "== isolated state: $T (gateway 127.0.0.1:$GW_PORT, model 127.0.0.1:$LLM_PORT)"

# A clean copy of this directory, as a git clone would have it (no node_modules).
mkdir -p "$T/src"
tar -C "$PLUGIN_DIR" --exclude=./node_modules -cf - . | tar -C "$T/src" -xf -
echo "== openclaw plugins install"
# OpenClaw 2026.4.24 validates the memory slot against a manifest cache filled before the copy;
# without these two switches a fast first install can fail with "plugin not found: valorbrain".
OPENCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE=1 OPENCLAW_DISABLE_PLUGIN_MANIFEST_CACHE=1 \
  openclaw plugins install "$T/src" 2>&1 | tee "$OUT/install.log"
openclaw plugins install --link "$HERE/probe-plugin" >>"$OUT/install.log" 2>&1
openclaw plugins inspect valorbrain >"$OUT/inspect.log" 2>&1 || true
# Now that both plugins exist, put ValorBrain in the memory slot and configure both.
node - "$OPENCLAW_CONFIG_PATH" "$VB_STAGING_URL" "$OUT/events.jsonl" <<'NODE'
const fs = require("fs");
const [file, apiUrl, eventsOut] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.plugins ??= {};
cfg.plugins.slots = { ...(cfg.plugins.slots ?? {}), memory: "valorbrain" };
cfg.plugins.entries ??= {};
cfg.plugins.entries.valorbrain = { ...(cfg.plugins.entries.valorbrain ?? {}), enabled: true,
  config: { apiUrl, captureTranscript: true, timeoutMs: 6000 } };
cfg.plugins.entries["vb-event-probe"] = { ...(cfg.plugins.entries["vb-event-probe"] ?? {}), enabled: true,
  config: { out: eventsOut } };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
NODE
openclaw plugins list 2>&1 | grep -iE "valorbrain|probe|memory" | tee -a "$OUT/inspect.log" || true

MARKER="E2E-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
echo "== seeding staging memory $MARKER"
SEED_DOCID="$(node "$HERE/staging.mjs" seed "$MARKER")"
FORGET+=("$SEED_DOCID")
node "$HERE/staging.mjs" find "$MARKER" 30 | tee "$OUT/seed-search.txt"

node "$HERE/mock-llm.mjs" "$LLM_PORT" "$OUT/model-requests.jsonl" >"$OUT/mock-llm.log" 2>&1 &
PIDS+=($!)
openclaw gateway run --port "$GW_PORT" --bind loopback --auth token --verbose >"$OUT/gateway.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 90); do
  (exec 3<>"/dev/tcp/127.0.0.1/$GW_PORT") 2>/dev/null && break
  sleep 1
done
(exec 3<>"/dev/tcp/127.0.0.1/$GW_PORT") 2>/dev/null || { echo "gateway did not start"; tail -40 "$OUT/gateway.log"; exit 1; }
echo "== gateway up"

SESSION="e2e-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
turn() {
  echo "== turn: $1"
  openclaw agent --session-id "$SESSION" --message "$1" --json --timeout 120 >"$OUT/turn-$2.json" 2>"$OUT/turn-$2.err" || { cat "$OUT/turn-$2.err"; exit 1; }
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const p=r.result?.payloads??r.payloads??[];console.log("   reply:",p.map(x=>x.text).join(" | ")||JSON.stringify(r).slice(0,300))' "$OUT/turn-$2.json"
}
turn "What is the codename of the OpenClaw plugin end-to-end run?" 1
turn "STORE: OpenClaw e2e follow-up $MARKER | Decision for run $MARKER: the hosted OpenClaw plugin replaces the binary-based one for customers; api_key=sk-ant-THISISNOTAREALKEY0123456789abcdef must never be stored." 2
turn "Thanks, that is all for $MARKER." 3
turn "One last check on $MARKER." 4

echo "== waiting for the transcript upload (started by turn 4)"
for _ in $(seq 1 120); do
  grep -q "valorbrain: transcript uploaded\|valorbrain: transcript .*HTTP\|valorbrain: transcript .*timed out" "$OUT/gateway.log" && break
  sleep 2
done
grep -h "valorbrain" "$OUT/gateway.log" | sed 's/^/   /' | tail -20

echo "== evidence"
node - "$OUT/model-requests.jsonl" "$MARKER" <<'NODE'
const [file, marker] = process.argv.slice(2);
const reqs = require("fs").readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("\n") : "");
const first = reqs[0];
const user = first.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).pop() ?? "";
const sys = first.messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
console.log(`   model requests: ${reqs.length}; tools offered: ${first.tools.filter((t) => t?.startsWith("valorbrain")).join(", ")}`);
console.log(`   turn 1 user message carries <valorbrain-memory>: ${user.includes("<valorbrain-memory>")}; carries ${marker}: ${user.includes(marker)}`);
console.log(`   system prompt carries "## ValorBrain memory": ${sys.includes("## ValorBrain memory")}`);
NODE
STORED="$(node "$HERE/staging.mjs" find "follow-up $MARKER" 40 || true)"
echo "   stored by valorbrain_store: ${STORED:-not found}"
for id in $(printf '%s\n' "$STORED" | cut -f1); do FORGET+=("$id"); done
if [[ -n "$STORED" ]]; then
  node "$HERE/staging.mjs" body "$(printf '%s\n' "$STORED" | grep -P '\tOpenClaw e2e follow-up' | head -1 | cut -f1)" >"$OUT/stored-doc.md"
  grep -q "sk-ant-THISISNOTAREALKEY" "$OUT/stored-doc.md" && echo "   !! secret reached the stored doc" || echo "   stored doc: secret redacted ($(grep -o 'api_key=[^ ]*' "$OUT/stored-doc.md"))"
fi
OC_SESSION="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);console.log(l.find(e=>e.ctx?.sessionId)?.ctx.sessionId??"")' "$OUT/events.jsonl")"
EXTRACTED="$(node "$HERE/staging.mjs" find "$OC_SESSION" 60 || true)"
echo "   docs extracted from the uploaded transcript (session $OC_SESSION):"
printf '%s\n' "$EXTRACTED" | sed 's/^/     /'
for id in $(printf '%s\n' "$EXTRACTED" | cut -f1); do
  FORGET+=("$id")
  node "$HERE/staging.mjs" body "$id" >>"$OUT/extracted-docs.md"
done
if [[ -s "$OUT/extracted-docs.md" ]]; then
  for needle in "<valorbrain-memory>" "Bootstrap pending" "sk-ant-THISISNOTAREALKEY" "$MARKER"; do
    echo "   extracted docs contain '$needle': $(grep -c -- "$needle" "$OUT/extracted-docs.md" || true) line(s)"
  done
fi
echo "   hook events seen by the probe: $(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);const c={};for(const e of l)c[e.hook]=(c[e.hook]||0)+1;console.log(JSON.stringify(c))' "$OUT/events.jsonl")"
for id in $(node "$HERE/staging.mjs" find "$MARKER" 10 2>/dev/null | cut -f1); do FORGET+=("$id"); done
echo "== done: evidence in $OUT (isolated state $T)"
