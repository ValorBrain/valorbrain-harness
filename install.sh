#!/usr/bin/env bash
# install.sh — deploy ValorBrain harness integrations from this repo's sources.
#
# Usage: ./install.sh <zcode|grok|hermes|openclaw|openclaw-self-hosted|all>
# `all` installs zcode, grok and hermes. The OpenClaw plugins replace whatever sits in the
# gateway's memory slot and need a gateway restart, so they are only installed by name.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-all}"

install_zcode() {
  local ver
  ver="$(python3 -c "import json;print(json.load(open('$ROOT/zcode/.zcode-plugin/plugin.json'))['version'])")"
  local dest="$HOME/.zcode/cli/plugins/cache/valor-digital/valorbrain/$ver"
  echo "[zcode] deploying v$ver → $dest"
  mkdir -p "$dest"
  rsync -a --delete "$ROOT/zcode/" "$dest/"
  python3 - "$ver" "$HOME" "$dest" <<'EOF'
import json, sys, os, datetime
ver, home, dest = sys.argv[1], sys.argv[2], sys.argv[3]
p = os.path.join(home, ".zcode/cli/plugins/installed_plugins.json")
d = json.load(open(p))
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
for plug in d['plugins']:
    if plug['id'] == 'valorbrain@valor-digital':
        plug['version'] = ver
        plug['installPath'] = dest
        plug['updatedAt'] = now
json.dump(d, open(p, 'w'), indent=2)
print(f"[zcode] registry updated to {ver}")
EOF
}

install_grok() {
  echo "[grok] AGENTS.md (managed contract block) → ~/.grok/AGENTS.md"
  # The static contract copy ships in this repo (grok/valorbrain-contract.md),
  # so the installer has no engine dependency. When the contract text changes
  # upstream, regenerate the file from the engine renderer and commit it.
  if [ ! -f "$ROOT/grok/valorbrain-contract.md" ]; then
    echo "[grok] grok/valorbrain-contract.md missing from this repo" >&2
    return 1
  fi
  python3 - "$HOME/.grok/AGENTS.md" "$ROOT/grok/valorbrain-contract.md" <<'EOF'
import sys, os
path, contract_path = sys.argv[1], sys.argv[2]
block = open(contract_path).read()
BEGIN, END = "<!-- valorbrain:begin -->", "<!-- valorbrain:end -->"
existing = open(path).read() if os.path.exists(path) else ""
start, end = existing.find(BEGIN), existing.find(END)
if start != -1 and end > start:
    out = existing[:start] + block + existing[end + len(END):]
else:
    sep = "" if not existing or existing.endswith("\n\n") else ("\n" if existing.endswith("\n") else "\n\n")
    out = existing + sep + block
os.makedirs(os.path.dirname(path), exist_ok=True)
open(path, "w", newline="\n").write(out)
print("[grok] contract block written")
EOF
  if ! grep -q "mcp_servers.valorbrain" "$HOME/.grok/config.toml" 2>/dev/null; then
    echo "[grok] config.toml has no valorbrain MCP entry — copy the right mode from grok/mcp.example.toml (never commit real tokens)"
  else
    echo "[grok] MCP entry present in config.toml"
  fi
}

install_hermes() {
  echo "[hermes] vendored plugin → ~/.hermes/plugins/valorbrain"
  if [[ ! -f "$ROOT/hermes/plugin.yaml" ]]; then
    echo "[hermes] hermes/ missing from this repo — run scripts/vendor-from-engine.sh on a machine with the engine" >&2
    return 1
  fi
  mkdir -p "$HOME/.hermes/plugins/valorbrain"
  cp "$ROOT/hermes/__init__.py" "$ROOT/hermes/plugin.yaml" "$HOME/.hermes/plugins/valorbrain/"
  rm -rf "$HOME/.hermes/plugins/valorbrain/__pycache__"
  echo "[hermes] deployed (restart Hermes runtime to reload)"
}

install_openclaw() {
  echo "[openclaw] openclaw/ (hosted HTTP plugin) → openclaw plugins install"
  command -v openclaw >/dev/null || { echo "[openclaw] openclaw CLI not found" >&2; return 1; }
  # OpenClaw 2026.4.x can miss a freshly installed plugin through its manifest cache.
  OPENCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE=1 OPENCLAW_DISABLE_PLUGIN_MANIFEST_CACHE=1 \
    openclaw plugins install "$ROOT/openclaw" --force
  echo "[openclaw] installed — set VALORBRAIN_API_TOKEN for the gateway and restart it"
}

install_openclaw_self_hosted() {
  echo "[openclaw-self-hosted] vendored dist → ~/.openclaw/extensions/valorbrain (needs the engine's valorbrain binary)"
  if [[ ! -f "$ROOT/openclaw-self-hosted/dist/index.js" ]]; then
    echo "[openclaw-self-hosted] dist missing — run scripts/vendor-from-engine.sh on a machine with the engine" >&2
    return 1
  fi
  mkdir -p "$HOME/.openclaw/extensions/valorbrain/dist"
  cp "$ROOT/openclaw-self-hosted/dist/index.js" "$HOME/.openclaw/extensions/valorbrain/dist/index.js"
  cp "$ROOT/openclaw-self-hosted/openclaw.plugin.json" "$ROOT/openclaw-self-hosted/package.json" "$HOME/.openclaw/extensions/valorbrain/"
  echo "[openclaw-self-hosted] deployed"
}

case "$TARGET" in
  zcode) install_zcode ;;
  grok) install_grok ;;
  hermes) install_hermes ;;
  openclaw) install_openclaw ;;
  openclaw-self-hosted) install_openclaw_self_hosted ;;
  all) install_zcode; install_grok; install_hermes
       echo "[all] OpenClaw is not part of 'all': run ./install.sh openclaw explicitly" ;;
  *) echo "Usage: $0 <zcode|grok|hermes|openclaw|openclaw-self-hosted|all>"; exit 1 ;;
esac
