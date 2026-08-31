#!/usr/bin/env bash
# Fail if markdown cites a `valorbrain <sub>` that the published CLI does not
# implement. Source of truth: `npx @valorbrain/cli help --json`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HELP_JSON="$(mktemp)"
trap 'rm -f "$HELP_JSON"' EXIT

if ! npx --yes @valorbrain/cli@latest help --json >"$HELP_JSON" 2>/dev/null; then
  echo "check-phantom-commands: could not run @valorbrain/cli help --json" >&2
  exit 2
fi

mapfile -t ALLOWED < <(python3 - "$HELP_JSON" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
cmds = {c["name"] for c in data.get("commands", [])}
# connect is the published alias of `mcp`
cmds.add("mcp")
for c in sorted(cmds):
    print(c)
PY
)

# Also allow mentioning the packages themselves.
ALLOWED_RE="$(printf '%s|' "${ALLOWED[@]}")"
ALLOWED_RE="${ALLOWED_RE%|}"

echo "allowed CLI subs: ${ALLOWED[*]}"

fail=0
# Only invocations: `valorbrain sub` or `npx @valorbrain/cli sub` — not prose.
while IFS= read -r -d '' f; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    cmd=""
    if [[ "$line" =~ valorbrain[[:space:]]+setup ]]; then
      echo "PHANTOM  $f:$line"
      fail=1
      continue
    fi
    if [[ "$line" =~ \`valorbrain[[:space:]]+([a-z][a-z0-9_-]*) ]]; then
      cmd="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ @valorbrain/cli[[:space:]]+([a-z][a-z0-9_-]*) ]]; then
      cmd="${BASH_REMATCH[1]}"
    fi
    [[ -z "$cmd" ]] && continue
    if [[ ! " ${ALLOWED[*]} " =~ " ${cmd} " ]]; then
      echo "UNKNOWN  $f: valorbrain $cmd"
      echo "         $line"
      fail=1
    fi
  done < <(grep -nE 'valorbrain setup|`valorbrain |@valorbrain/cli ' "$f" || true)
done < <(find . -name '*.md' -not -path './.git/*' -print0)

if [[ "$fail" -ne 0 ]]; then
  echo "check-phantom-commands: markdown cites CLI commands that do not exist." >&2
  echo "Published surface: npx @valorbrain/cli help --json" >&2
  exit 1
fi
echo "check-phantom-commands: ok"
