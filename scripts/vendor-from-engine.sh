#!/usr/bin/env bash
# Refresh vendored Hermes/OpenClaw plugins from an engine checkout.
# Install.sh does NOT need the engine — this script is for maintainers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${VALORBRAIN_ENGINE_DIR:-/opt/valorbrain}"
if [[ ! -d "$ENGINE/src/hermes" ]]; then
  echo "vendor-from-engine: $ENGINE/src/hermes missing" >&2
  exit 1
fi
mkdir -p "$ROOT/hermes" "$ROOT/openclaw/dist"
cp "$ENGINE/src/hermes/__init__.py" "$ENGINE/src/hermes/plugin.yaml" "$ROOT/hermes/"
(cd "$ENGINE" && bun build src/openclaw/index.ts --outdir "$ROOT/openclaw/dist" --target node)
cp "$ENGINE/src/openclaw/openclaw.plugin.json" "$ENGINE/src/openclaw/package.json" "$ROOT/openclaw/"
[[ -f "$ENGINE/src/openclaw/AGENTS.md" ]] && cp "$ENGINE/src/openclaw/AGENTS.md" "$ROOT/openclaw/"
echo "vendored hermes + openclaw from $ENGINE"
