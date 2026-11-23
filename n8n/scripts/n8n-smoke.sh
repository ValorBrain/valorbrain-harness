#!/usr/bin/env bash
# Runs examples/write-search-forget.json in a real n8n, fully isolated: a throwaway HOME and
# N8N_USER_FOLDER, the package installed from `npm pack` into <user folder>/.n8n/nodes (the way n8n
# installs community nodes), headless `n8n execute`. Deletes the throwaway folder at the end.
#
#   N8N_BIN=/path/to/node_modules/.bin/n8n VB_LIVE_URL=http://127.0.0.1:7439 VB_LIVE_TOKEN=vbm_… \
#     scripts/n8n-smoke.sh
#
# The token goes from the environment to `n8n import:credentials` on stdin and ends up only in
# n8n's encrypted database inside the throwaway folder. (n8n's CLI ignores CREDENTIALS_OVERWRITE_DATA
# for community credential types, so the overwrite route does not work here.) The API URL is set
# explicitly on the credential, so nothing falls back to the production default.
set -euo pipefail
: "${N8N_BIN:?set N8N_BIN to the n8n executable}"
: "${VB_LIVE_URL:?set VB_LIVE_URL (staging or throwaway tenant)}"
: "${VB_LIVE_TOKEN:?set VB_LIVE_TOKEN}"

PKG=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/n8n-smoke-XXXX")
trap 'rm -rf "$WORK"' EXIT
export HOME=$WORK/home N8N_USER_FOLDER=$WORK/user
mkdir -p "$HOME" "$N8N_USER_FOLDER/.n8n/nodes"

(cd "$PKG" && npm run build --silent >/dev/null && npm pack --silent --pack-destination "$WORK" >/dev/null)
(cd "$N8N_USER_FOLDER/.n8n/nodes" && npm init -y >/dev/null &&
	npm install --no-audit --no-fund --silent --omit=peer "$WORK"/n8n-nodes-valorbrain-*.tgz)
echo "installed in $N8N_USER_FOLDER/.n8n/nodes: $(ls "$N8N_USER_FOLDER/.n8n/nodes/node_modules" | tr '\n' ' ')"

# `n8n execute` prints the run data through the logger at level info.
export N8N_LOG_LEVEL=info N8N_DIAGNOSTICS_ENABLED=false N8N_VERSION_NOTIFICATIONS_ENABLED=false \
	N8N_TEMPLATES_ENABLED=false N8N_PERSONALIZATION_ENABLED=false DB_TYPE=sqlite

node -e 'process.stdout.write(JSON.stringify([{id:"vbSmokeCredential",name:"ValorBrain",type:"valorBrainApi",data:{token:process.env.VB_LIVE_TOKEN,apiUrl:process.env.VB_LIVE_URL}}]))' |
	"$N8N_BIN" import:credentials --input=/dev/stdin
unset VB_LIVE_TOKEN
node -e 'const wf=require(process.argv[1]); wf.id="vbSmokeWorkflow"; wf.active=false; require("fs").writeFileSync(process.argv[2], JSON.stringify([wf]))' \
	"$PKG/examples/write-search-forget.json" "$WORK/wf.json"
"$N8N_BIN" import:workflow --input="$WORK/wf.json"
"$N8N_BIN" execute --id=vbSmokeWorkflow --rawOutput >"$WORK/out.json"

node -e '
const raw = require("fs").readFileSync(process.argv[1], "utf8");
const out = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const run = out.data.resultData.runData;
const pick = (n) => run[n]?.[0]?.data?.main?.[0]?.[0]?.json;
const w = pick("Write document"), s = pick("Search"), f = pick("Forget");
console.log("Write document:", JSON.stringify({docid: w?.docid, action: w?.action, event_at: w?.event_at, title: w?.title}));
console.log("Search:", JSON.stringify((s?.results ?? []).map((r) => ({docid: r.docid, title: r.title, score: r.score}))));
console.log("Forget:", JSON.stringify(f));
const hit = (s?.results ?? []).some((r) => String(r.docid).replace(/^#/, "") === w?.docid);
console.log("positive control (search found the written docid):", hit);
process.exitCode = hit && f?.forgotten === true ? 0 : 1;
' "$WORK/out.json"
