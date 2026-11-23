#!/usr/bin/env bash
# Refresh the vendored self-hosted OpenClaw build (openclaw-self-hosted/) from an engine checkout.
# Maintainers only; install.sh does not need the engine.
#
# The default OpenClaw plugin (openclaw/) is source in this repo and needs no engine.
# Hermes is vendored from ValorBrain/valorbrain-cli by hermes/sync.sh, not from here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${VALORBRAIN_ENGINE_DIR:-/opt/valorbrain}"
if [[ ! -d "$ENGINE/src/openclaw" ]]; then
  echo "vendor-from-engine: $ENGINE/src/openclaw missing" >&2
  exit 1
fi
mkdir -p "$ROOT/openclaw-self-hosted/dist"
(cd "$ENGINE" && bun build src/openclaw/index.ts --outdir "$ROOT/openclaw-self-hosted/dist" --target node)
# openclaw.plugin.json and package.json in openclaw-self-hosted/ are maintained here: the engine's
# package.json points at ./index.ts, which the vendored build does not ship.
[[ -f "$ENGINE/src/openclaw/AGENTS.md" ]] && cp "$ENGINE/src/openclaw/AGENTS.md" "$ROOT/openclaw-self-hosted/"
echo "vendored openclaw-self-hosted from $ENGINE"
