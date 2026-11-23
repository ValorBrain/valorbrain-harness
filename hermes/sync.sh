#!/usr/bin/env bash
# Refresh the vendored Hermes plugin in this directory from its canonical source,
# packages/hermes-plugin in ValorBrain/valorbrain-cli. Copies the committed bytes
# of one commit (never a working tree) and records it in VENDORED_FROM.
#
# Usage:
#   hermes/sync.sh                 vendor HEAD of the source checkout
#   hermes/sync.sh --ref <commit>  vendor that commit (sha, tag or branch)
#   hermes/sync.sh --check         exit 1 if the files here differ from VENDORED_FROM's commit
#
# Source: $VALORBRAIN_CLI_DIR (default /www/valorbrain-cli) when it is a git checkout,
# else a fresh clone of https://github.com/ValorBrain/valorbrain-cli in a temp dir.
# The commit must be on a remote branch: an unpushed sha would be recorded where
# nobody else can fetch it.
#
# Vendored: __init__.py, plugin.yaml and tests/*.py of the plugin. Files that are
# ours (README.md, VENDORED_FROM, sync.sh, pyproject.toml, catalog/, patches/,
# tests/test_hub_*.py, tests/live_*) are never touched.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="https://github.com/ValorBrain/valorbrain-cli"
SUBDIR="packages/hermes-plugin"
REF=""
CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref needs a commit}"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "sync.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

SRC="${VALORBRAIN_CLI_DIR:-/www/valorbrain-cli}"
TMP=""
cleanup() { [[ -n "$TMP" ]] && rm -rf "$TMP"; return 0; }
trap cleanup EXIT
if ! git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  git clone -q "$REPO_URL" "$TMP/valorbrain-cli"
  SRC="$TMP/valorbrain-cli"
fi

if [[ $CHECK -eq 1 ]]; then
  [[ -f "$HERE/VENDORED_FROM" ]] || { echo "sync.sh --check: no VENDORED_FROM" >&2; exit 1; }
  REF="$(sed -n 's/^commit: //p' "$HERE/VENDORED_FROM")"
fi
[[ -n "$REF" ]] || REF="HEAD"
SHA="$(git -C "$SRC" rev-parse --verify "$REF^{commit}")"

if [[ -z "$(git -C "$SRC" branch -r --contains "$SHA" 2>/dev/null)" ]]; then
  echo "sync.sh: $SHA is not on any remote branch of $SRC (push it first)" >&2
  exit 1
fi

mapfile -t FILES < <(git -C "$SRC" ls-tree -r --name-only "$SHA" -- "$SUBDIR" \
  | sed "s#^$SUBDIR/##" \
  | grep -E '^(__init__\.py|plugin\.yaml|tests/[^/]+\.py)$')
[[ " ${FILES[*]} " == *" __init__.py "* ]] || { echo "sync.sh: no $SUBDIR/__init__.py at $SHA" >&2; exit 1; }

if [[ $CHECK -eq 1 ]]; then
  drift=0
  for f in "${FILES[@]}"; do
    if ! cmp -s <(git -C "$SRC" show "$SHA:$SUBDIR/$f") "$HERE/$f"; then
      echo "drift: $f differs from $SHA" >&2
      drift=1
    fi
  done
  [[ $drift -eq 0 ]] && echo "hermes/ matches $REPO_URL@$SHA ($SUBDIR)"
  exit $drift
fi

# Drop files the previous sync vendored that the new commit no longer has.
if [[ -f "$HERE/VENDORED_FROM" ]]; then
  while read -r _sum f; do
    [[ " ${FILES[*]} " == *" $f "* ]] || rm -f "$HERE/$f"
  done < <(grep -E '^[0-9a-f]{64}  ' "$HERE/VENDORED_FROM")
fi

for f in "${FILES[@]}"; do
  mkdir -p "$HERE/$(dirname "$f")"
  git -C "$SRC" show "$SHA:$SUBDIR/$f" > "$HERE/$f"
done

VERSION="$(sed -n 's/^version: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$HERE/plugin.yaml")"
{
  echo "repo: $REPO_URL"
  echo "path: $SUBDIR"
  echo "commit: $SHA"
  echo "commit_date: $(git -C "$SRC" show -s --format=%cI "$SHA")"
  echo "plugin_version: $VERSION"
  echo "synced_at: $(date -u +%Y-%m-%d)"
  echo "# sha256 of each vendored file (relative to hermes/):"
  (cd "$HERE" && sha256sum "${FILES[@]}")
} > "$HERE/VENDORED_FROM"

echo "vendored $REPO_URL@$SHA ($SUBDIR, plugin $VERSION): ${FILES[*]}"
