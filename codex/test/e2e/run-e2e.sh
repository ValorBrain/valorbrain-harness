#!/usr/bin/env bash
# End-to-end run of the Codex plugin against a ValorBrain engine (staging),
# with the real `codex` CLI in a throwaway HOME. Nothing outside that HOME is
# touched. The model is mock-openai.mjs (a custom model provider), so no
# OpenAI account is needed and no model decides anything.
#
# Needs: codex, node, npx; VB_STAGING_URL, VB_STAGING_MCP_URL and
# VB_STAGING_MCP_TOKEN (a vbm_ token of a throwaway tenant) in the environment.
# Without them it prints "skip" and exits 0.
#
# The plugin's MCP URL is fixed (Codex does not expand variables in a plugin's
# .mcp.json), so the run points the installed copy at the engine under test.
#
# Scenarios:
#   A  plugin only: install from the marketplace, sign in with the official
#      installer in MCP-only mode, run a session. The plugin's three hooks run
#      the official client, the session-start context arrives, and the MCP
#      tools store, find and forget a marker.
#   B  the installer's [mcp_servers.valorbrain] table and the plugin's server:
#      Codex keeps one, the installer's.
#   C  the installer's hooks already in ~/.codex/hooks.json: the plugin's hooks
#      step aside, so the session-start context arrives once.
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
CONNECT="@valorbrain/connect@$(sed -n "s/^export const CONNECT_VERSION = '\(.*\)';/\1/p" "$HUB/codex/plugin/bin/valorbrain-plugin.mjs")"
PORT="${E2E_MOCK_PORT:-18432}"
MARKER="vbcx$(date +%s)$RANDOM"
redact() { sed -E 's/vbm_[A-Za-z0-9_-]+/vbm_REDACTED/g; s/vb_agent_[A-Za-z0-9_-]+/vb_agent_REDACTED/g'; }
quiet() { grep -v -E '^WARNING: proceeding|^\s*$' || true; }

export HOME="$(mktemp -d /tmp/vb-codex-e2e.XXXXXX)"
unset CODEX_HOME
WORK="$HOME/work"; mkdir -p "$WORK"
MOCK_PID=""
cleanup() { [[ -n "$MOCK_PID" ]] && kill "$MOCK_PID" 2>/dev/null || true; [[ "${E2E_KEEP:-}" == 1 ]] || rm -rf "$HOME"; }
trap cleanup EXIT
echo "HOME=$HOME  marker=$MARKER  client=$CONNECT"

fail() { echo "FAIL: $*" >&2; exit 1; }
sign_in() { # $@ = extra installer flags
  VALORBRAIN_MCP_TOKEN="$VB_STAGING_MCP_TOKEN" npx -y "$CONNECT" --harness codex --api "$VB_STAGING_URL" --no-browser "$@" 2>&1 \
    | redact | grep -E '✓|error' | sed 's/^/   /'
}
# The installer writes the public MCP URL; point it at the engine under test.
point_user_mcp_at_staging() { sed -i "s#https://mcpbrain.valor.digital/mcp#$VB_STAGING_MCP_URL#" "$HOME/.codex/config.toml"; }
run_session() { # $1 = label
  local log="$HOME/$1"
  : > "$log.model.jsonl"
  node "$HERE/mock-openai.mjs" "$PORT" "$log.model.jsonl" "$MARKER" > "$log.mock.out" 2>&1 &
  MOCK_PID=$!
  sleep 0.5
  (cd "$WORK" && timeout 180 codex exec --skip-git-repo-check --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox \
      -c model_provider=mock -c model=gpt-5.1 \
      -c "model_providers.mock={name=\"mock\",base_url=\"http://127.0.0.1:$PORT/v1\",wire_api=\"responses\"}" \
      "Remember the marker $MARKER, then look it up (end-to-end test)." < /dev/null > "$log.out.txt" 2>&1 ) || true
  kill "$MOCK_PID" 2>/dev/null || true; MOCK_PID=""
}

echo "== install from the marketplace"
codex plugin marketplace add "$HUB" 2>&1 | quiet | sed 's/^/   /'
codex plugin add valorbrain@valorbrain 2>&1 | quiet | sed 's/^/   /'
codex plugin list 2>&1 | quiet | grep valorbrain | sed 's/^/   /'
PLUGIN_DIR="$(ls -d "$HOME"/.codex/plugins/cache/valorbrain/valorbrain/*/ | head -1)"
sed -i "s#https://mcpbrain.valor.digital/mcp#$VB_STAGING_MCP_URL#" "$PLUGIN_DIR/.mcp.json"

echo "== sign in (the setup skill's command, with a token instead of the browser)"
sign_in --mcp-only

echo "== A: plugin only"
codex mcp remove valorbrain 2>&1 | quiet | sed 's/^/   /'
codex mcp get valorbrain 2>&1 | quiet | redact | sed 's/^/   /'
node "$PLUGIN_DIR/bin/valorbrain-plugin.mjs" status --harness=codex | sed 's/^/   status: /'
run_session A
node "$HERE/check-e2e.mjs" A "$HOME/A" "$MARKER" || fail "scenario A"

echo "== B: the installer's MCP table and the plugin's server"
sign_in --mcp-only >/dev/null
point_user_mcp_at_staging
codex mcp list 2>&1 | quiet | redact | tee "$HOME/B.mcp-list.txt" | sed 's/^/   /'
codex mcp get valorbrain 2>&1 | quiet | redact | tee "$HOME/B.mcp-get.txt" | sed 's/^/   /'
[[ "$(grep -c '^valorbrain ' "$HOME/B.mcp-list.txt")" == 1 ]] || fail "B: expected one valorbrain server"
grep -q 'http_headers_helper: -' "$HOME/B.mcp-get.txt" || fail "B: the plugin's server won over the installer's table"
echo "   ok: one valorbrain server, the installer's"

echo "== C: the installer's hooks already in ~/.codex/hooks.json"
sign_in
point_user_mcp_at_staging
node "$PLUGIN_DIR/bin/valorbrain-plugin.mjs" status --harness=codex | sed 's/^/   status: /'
run_session C
node "$HERE/check-e2e.mjs" C "$HOME/C" "$MARKER" || fail "scenario C"

echo "PASS"
