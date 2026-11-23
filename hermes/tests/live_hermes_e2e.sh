#!/usr/bin/env bash
# Live end-to-end test: Hermes + this plugin (hosted mode) against a ValorBrain
# engine, in a throwaway HOME and HERMES_HOME. The live ~/.hermes is never read
# or written. Skips (exit 0) without the staging variables.
#
#   set -a; . /etc/valorbrain/integracoes-staging.env; set +a
#   hermes/tests/live_hermes_e2e.sh                 # plugin copied into $HERMES_HOME/plugins/valorbrain
#   hermes/tests/live_hermes_e2e.sh --entry-point   # plugin pip-installed, found by its entry point
#
# Env: VB_STAGING_URL, VB_STAGING_MCP_TOKEN (required); HERMES_BIN (default: hermes
# on PATH); HERMES_AGENT_DIR (default ~/.hermes/hermes-agent); VBH_HERMES_HOME to
# reuse a throwaway HERMES_HOME that already holds Hermes' runtime (Hermes
# installs its dependencies on the first start of a new data root, ~2 min).
set -euo pipefail

if [[ -z "${VB_STAGING_URL:-}" || -z "${VB_STAGING_MCP_TOKEN:-}" ]]; then
  echo "[e2e] SKIP: VB_STAGING_URL / VB_STAGING_MCP_TOKEN not set"
  exit 0
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
REAL_HERMES="$HOME/.hermes"
AGENT_DIR="${HERMES_AGENT_DIR:-$REAL_HERMES/hermes-agent}"
HERMES_BIN="${HERMES_BIN:-$(command -v hermes || true)}"
[[ -x "$HERMES_BIN" ]] || { echo "[e2e] hermes not found (set HERMES_BIN)" >&2; exit 2; }

TMP="$(mktemp -d /tmp/vbh-e2e.XXXXXX)"
mkdir -p "$TMP/home"
HH="$(realpath -m "${VBH_HERMES_HOME:-$TMP/hermes-home}")"
case "$HH/" in
  "$(realpath -m "$REAL_HERMES")"/*) echo "[e2e] refusing HERMES_HOME inside $REAL_HERMES" >&2; exit 2 ;;
esac
mkdir -p "$HH"

SITE=""
if [[ " $* " == *" --entry-point "* ]]; then
  # Build from a copy so the hub directory gets no build/ or *.egg-info.
  cp -r "$HERE/.." "$TMP/src"
  rm -rf "$TMP/src/tests" "$TMP/src/patches" "$TMP/src/catalog"
  SITE="$TMP/site"
  python3 -m pip install -q --no-deps --target "$SITE" "$TMP/src"
  echo "[e2e] pip-installed $(ls "$SITE" | grep dist-info) into $SITE"
fi

# Hermes' own interpreter for this data root, as its launcher resolves it; the
# bootstrap import below activates the data root's dependency environment.
RUNTIME_PY="$(env HOME="$TMP/home" HERMES_HOME="$HH" "$HERMES_BIN" --print-runtime-command \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)[0])')"

exec env HOME="$TMP/home" HERMES_HOME="$HH" VBH_E2E_TMP="$TMP" VBH_REAL_HERMES="$REAL_HERMES" \
  VBH_SITE="$SITE" HERMES_AGENT_DIR="$AGENT_DIR" VBH_E2E_SCRIPT="$HERE/live_hermes_e2e.py" \
  "$RUNTIME_PY" -I -c "import os, sys, runpy
sys.path.insert(0, os.environ['HERMES_AGENT_DIR'])
sys.dont_write_bytecode = True
sys._hermes_pin_default_home = True
import hermes_bootstrap
sys.argv = [os.environ['VBH_E2E_SCRIPT'], *sys.argv[1:]]
runpy.run_path(sys.argv[0], run_name='__main__')" "$@"
