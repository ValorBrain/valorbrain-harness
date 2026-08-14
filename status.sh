#!/usr/bin/env bash
# status.sh — drift check across every ValorBrain harness integration.
# Read-only. Exit 0 = everything current; exit 1 = something drifted.
set -uo pipefail

fail=0
note() { echo "$@"; }
drift() { echo "✗ $*"; fail=1; }
ok() { echo "✓ $*"; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENGINE="${VALORBRAIN_ENGINE_DIR:-/opt/valorbrain}"

# Engine-managed harnesses (claude-code, kiro, opencode, codex, gemini, cursor)
note "── engine-managed harnesses (valorbrain setup status) ──"
(cd "$ENGINE" && bun run src/valorbrain.ts setup status 2>/dev/null) || drift "setup status failed"

# ZCode: registry version vs deployed plugin.json vs this repo's source
note "── zcode ──"
ZC="$HOME/.zcode/cli/plugins/cache/valor-digital/valorbrain"
reg_ver="$(python3 -c "import json;print(next((p['version'] for p in json.load(open('$HOME/.zcode/cli/plugins/installed_plugins.json'))['plugins'] if p['id']=='valorbrain@valor-digital'),'none'))" 2>/dev/null)"
src_ver="$(python3 -c "import json;print(json.load(open('/opt/valorbrain-harness/zcode/.zcode-plugin/plugin.json'))['version'])" 2>/dev/null)"
dep_ver="$(python3 -c "import json;print(json.load(open('$ZC/$reg_ver/.zcode-plugin/plugin.json'))['version'])" 2>/dev/null)"
if [ "$reg_ver" = "$src_ver" ] && [ "$dep_ver" = "$src_ver" ]; then
  ok "zcode v$src_ver (registry=cache=source)"
else
  drift "zcode drift: registry=$reg_ver deployed=$dep_ver source=$src_ver — run ./install.sh zcode"
fi
grep -q "memory_used" "$ZC/$reg_ver/hooks/user-prompt-submit" 2>/dev/null \
  && ok "zcode recall reminder present" \
  || drift "zcode recall reminder missing"

# Grok: managed block + MCP entry
note "── grok ──"
grep -q "valorbrain:begin" "$HOME/.grok/AGENTS.md" 2>/dev/null \
  && ok "grok AGENTS.md contract block present" \
  || drift "grok AGENTS.md missing contract block — run ./install.sh grok"
grep -q "mcp_servers.valorbrain" "$HOME/.grok/config.toml" 2>/dev/null \
  && ok "grok MCP server registered" \
  || drift "grok config.toml missing [mcp_servers.valorbrain]"

# Hermes: installed == engine source
note "── hermes ──"
if diff -q /opt/valorbrain/src/hermes/__init__.py "$HOME/.hermes/plugins/valorbrain/__init__.py" >/dev/null 2>&1; then
  ok "hermes installed == engine source"
else
  drift "hermes installed differs from engine source — run ./install.sh hermes"
fi
grep -q "memory_used" "$HOME/.hermes/plugins/valorbrain/__init__.py" 2>/dev/null \
  && ok "hermes quality-loop instruction present" \
  || drift "hermes quality-loop instruction missing"

# OpenClaw: dist contains the V3 tool
note "── openclaw ──"
grep -q "valorbrain_memory_used" "$HOME/.openclaw/extensions/valorbrain/dist/index.js" 2>/dev/null \
  && ok "openclaw memory_used tool in dist" \
  || drift "openclaw dist stale — run ./install.sh openclaw"

exit $fail
