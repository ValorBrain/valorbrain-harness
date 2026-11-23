#!/usr/bin/env bash
# End-to-end run of the Claude Code plugin against a ValorBrain engine
# (staging), with the real `claude` CLI in a throwaway HOME. Nothing outside
# that HOME is touched. The model is mock-anthropic.mjs, so no Anthropic
# account is needed and no model decides anything.
#
# Needs: claude, node, npx; VB_STAGING_URL, VB_STAGING_MCP_URL and
# VB_STAGING_MCP_TOKEN (a vbm_ token of a throwaway tenant) in the environment.
# Without them it prints "skip" and exits 0.
#
# Scenarios:
#   A  plugin only: install from the marketplace, sign in with the official
#      installer in MCP-only mode, run a session. The plugin's three hooks run
#      the official client, the session-start context arrives, and the MCP
#      tools store, find and forget a marker.
#   B  the installer's MCP entry and the plugin's at the same URL: Claude Code
#      connects once.
#   C  the installer's hooks already in settings.json: the plugin's hooks step
#      aside, so the session-start context arrives once.
set -euo pipefail

if [[ -z "${VB_STAGING_URL:-}" || -z "${VB_STAGING_MCP_URL:-}" || -z "${VB_STAGING_MCP_TOKEN:-}" ]]; then
  echo "skip: VB_STAGING_URL, VB_STAGING_MCP_URL and VB_STAGING_MCP_TOKEN are not set"
  exit 0
fi
case "$VB_STAGING_URL" in
  *valorbrain-api.valor.digital*|*mcpbrain.valor.digital*) echo "refusing: this test never runs against production" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
HUB="$(cd "$HERE/../../.." && pwd)"
CONNECT="@valorbrain/connect@$(sed -n "s/^export const CONNECT_VERSION = '\(.*\)';/\1/p" "$HUB/claude-code/plugin/bin/valorbrain-plugin.mjs")"
PORT="${E2E_MOCK_PORT:-18431}"
MARKER="vbcc$(date +%s)$RANDOM"
redact() { sed -E 's/vbm_[A-Za-z0-9_-]+/vbm_REDACTED/g; s/vb_agent_[A-Za-z0-9_-]+/vb_agent_REDACTED/g'; }

export HOME="$(mktemp -d /tmp/vb-claude-e2e.XXXXXX)"
WORK="$HOME/work"; mkdir -p "$WORK"
MOCK_PID=""
cleanup() { [[ -n "$MOCK_PID" ]] && kill "$MOCK_PID" 2>/dev/null || true; [[ "${E2E_KEEP:-}" == 1 ]] || rm -rf "$HOME"; }
trap cleanup EXIT
echo "HOME=$HOME  marker=$MARKER  client=$CONNECT"

fail() { echo "FAIL: $*" >&2; exit 1; }
# The installer writes the public MCP URL; point it at the engine under test.
point_user_mcp_at_staging() {
  node -e '
    const fs = require("fs"); const p = process.env.HOME + "/.claude.json";
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    if (d.mcpServers && d.mcpServers.valorbrain) d.mcpServers.valorbrain.url = process.argv[1];
    fs.writeFileSync(p, JSON.stringify(d, null, 2));' "$VB_STAGING_MCP_URL"
}
run_session() { # $1 = label; prompt fixed
  local log="$HOME/$1"
  : > "$log.model.jsonl"
  node "$HERE/mock-anthropic.mjs" "$PORT" "$log.model.jsonl" "$MARKER" > "$log.mock.out" 2>&1 &
  MOCK_PID=$!
  sleep 0.5
  (cd "$WORK" && ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_API_KEY=sk-mock VALORBRAIN_MCP_URL="$VB_STAGING_MCP_URL" \
    timeout 180 claude -p "Remember the marker $MARKER, then look it up (end-to-end test)." \
      --model claude-sonnet-4-5 \
      --allowedTools "mcp__plugin_valorbrain_valorbrain__memory_store,mcp__plugin_valorbrain_valorbrain__memory_retrieve,mcp__plugin_valorbrain_valorbrain__memory_forget,mcp__valorbrain__memory_store,mcp__valorbrain__memory_retrieve,mcp__valorbrain__memory_forget" \
      --output-format json --debug-file "$log.debug.log" > "$log.result.json" 2> "$log.stderr" ) || true
  kill "$MOCK_PID" 2>/dev/null || true; MOCK_PID=""
}

echo "== install from the marketplace"
claude plugin marketplace add "$HUB" 2>&1 | tail -1
claude plugin install valorbrain@valorbrain 2>&1 | tail -1
claude plugin list 2>&1 | grep -A4 'valorbrain@valorbrain' | sed 's/^/   /'

echo "== sign in (the setup skill's command, with a token instead of the browser)"
VALORBRAIN_MCP_TOKEN="$VB_STAGING_MCP_TOKEN" npx -y "$CONNECT" --harness claude-code --mcp-only --api "$VB_STAGING_URL" --no-browser 2>&1 \
  | redact | grep -E '✓|error' | sed 's/^/   /'

echo "== A: plugin only"
claude mcp remove valorbrain -s user >/dev/null 2>&1 || true
run_session A
VALORBRAIN_MCP_URL="$VB_STAGING_MCP_URL" node "$HUB/claude-code/plugin/bin/valorbrain-plugin.mjs" status --harness=claude-code | sed 's/^/   status: /'
node "$HERE/check-e2e.mjs" A "$HOME/A" "$MARKER" || fail "scenario A"

echo "== B: the installer's MCP entry at the same URL"
VALORBRAIN_MCP_TOKEN="$VB_STAGING_MCP_TOKEN" npx -y "$CONNECT" --harness claude-code --mcp-only --api "$VB_STAGING_URL" --no-browser >/dev/null 2>&1
point_user_mcp_at_staging
(cd "$WORK" && VALORBRAIN_MCP_URL="$VB_STAGING_MCP_URL" claude mcp list 2>&1) | redact | tee "$HOME/B.mcp-list.txt" | sed 's/^/   /'
grep -q '^valorbrain: ' "$HOME/B.mcp-list.txt" || fail "B: the installer's server is not listed"
if grep -q 'plugin:valorbrain:valorbrain' "$HOME/B.mcp-list.txt"; then fail "B: the plugin's server is listed too"; fi
echo "   ok: one valorbrain server"

echo "== C: the installer's hooks already in settings.json"
VALORBRAIN_MCP_TOKEN="$VB_STAGING_MCP_TOKEN" npx -y "$CONNECT" --harness claude-code --api "$VB_STAGING_URL" --no-browser 2>&1 \
  | redact | grep -E '✓|error' | sed 's/^/   /'
point_user_mcp_at_staging
VALORBRAIN_MCP_URL="$VB_STAGING_MCP_URL" node "$HUB/claude-code/plugin/bin/valorbrain-plugin.mjs" status --harness=claude-code | sed 's/^/   status: /'
run_session C
node "$HERE/check-e2e.mjs" C "$HOME/C" "$MARKER" || fail "scenario C"

echo "PASS"
