# ValorBrain for Hermes Agent

A [Hermes Agent](https://github.com/NousResearch/hermes-agent) **memory provider**
backed by ValorBrain: recalled memory is injected before turns, the session
lifecycle (start, compression, end) runs ValorBrain's hooks, and the model gets
`valorbrain_*` memory tools. It works against the hosted ValorBrain API or a
self-hosted engine.

This directory is a vendored copy. The canonical source is
[`packages/hermes-plugin`](https://github.com/ValorBrain/valorbrain-cli/tree/main/packages/hermes-plugin)
in `ValorBrain/valorbrain-cli`; [`VENDORED_FROM`](VENDORED_FROM) records the
exact commit and the checksum of every vendored file. Do not edit `__init__.py`,
`plugin.yaml` or `tests/test_run_kind.py` here: change the canonical package,
then run `./sync.sh`.

| | |
|---|---|
| Plugin version | 1.11.0 (`valorbrain-cli@dba2802`) |
| Tested with | Hermes Agent 0.22.0, hosted mode, 2026-10-17 (see [Tests](#tests)) |
| Requires | Hermes ≥ 0.20, Python ≥ 3.10, no third-party dependency (`httpx` from Hermes is used when present, `urllib` otherwise) |
| License | MIT |

## Install

Memory providers are activated through `memory.provider`, not
`plugins.enabled`. Whichever way you install, finish with:

```bash
hermes memory setup        # pick valorbrain
# or set it directly in $HERMES_HOME/config.yaml:
#   memory:
#     provider: valorbrain
```

### From the Hermes plugin catalog (once the entry is accepted)

```bash
hermes plugins install valorbrain
```

The entry is prepared in [`catalog/valorbrain.yaml`](catalog/valorbrain.yaml);
it is not in the official catalog yet.

### By copy

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/plugins/valorbrain"
cp hermes/__init__.py hermes/plugin.yaml "${HERMES_HOME:-$HOME/.hermes}/plugins/valorbrain/"
```

`./install.sh hermes` at the root of this repository does the same for the
default home. Restart Hermes (or the gateway) to load it.

### With pip

`pyproject.toml` builds the `valorbrain-hermes` package. Hermes finds it through
the `hermes_agent.memory_providers` entry point named `valorbrain`, so nothing is
copied under `$HERMES_HOME/plugins/`. Install it into the Python environment
Hermes itself runs in (a pip/uv install of `hermes-agent` you manage):

```bash
pip install "git+https://github.com/ValorBrain/valorbrain-harness#subdirectory=hermes"
# or, from a checkout: pip install ./hermes
```

The package is not on PyPI yet. Two Hermes rules apply to pip-installed
providers: a copy in `$HERMES_HOME/plugins/valorbrain` wins over the package
(directories come first), and with `plugins.isolation: host` Hermes refuses to
import a pip-installed provider in-process.

## Configure

Hosted (the usual case). `npx @valorbrain/connect --token vbm_… --harness hermes`
writes these into `$HERMES_HOME/config.yaml` for you:

```yaml
env:
  VALORBRAIN_HOOKS_MODE: hosted
  VALORBRAIN_ENGINE_URL: https://valorbrain-api.valor.digital
  VALORBRAIN_API_TOKEN: vbm_…          # one token per person
```

`VALORBRAIN_HOOKS_MODE=hosted` pins every hook to the engine: no local binary,
no fallback to `127.0.0.1`, and no `X-Tenant-ID` / `X-User-ID` header (the token
decides tenant and user). Self-hosted: leave `VALORBRAIN_HOOKS_MODE` unset and
put the `valorbrain` binary on `PATH` (or `VALORBRAIN_BIN`). The full variable
list is in the
[canonical README](https://github.com/ValorBrain/valorbrain-cli/tree/dba280261334420fea55b18b21215998444460a2/packages/hermes-plugin#environment).

## What leaves the machine, and when (hosted mode)

Everything goes to `VALORBRAIN_ENGINE_URL` with the `vbm_` token as bearer.

| When | What | Switch |
|---|---|---|
| Plugin load and session start | Runtime registration: hostname, plugin version, contract version, a random 32-hex install id. A background thread sends a heartbeat every 5 minutes while Hermes runs. | — |
| Session start | `session-bootstrap` hook (session id) and `GET /foundations`; the answer is injected on the first turn. | — |
| After each turn | The user's message, as the recall query for the next turn (`context-surfacing` hook; `/api/v1/memory/prepare` when the hook returns nothing). | `VALORBRAIN_SEND_PROMPT=off` |
| Tool results carrying a `file_path` | The file path, to append vault context for that file. | — |
| When the model calls a `valorbrain_*` tool | The tool's arguments (e.g. `valorbrain_store` sends the title and content). | — |
| Before compression and at session end | The session transcript (every user and assistant message of the session) for the extraction hooks (decisions, handoff, feedback). | `VALORBRAIN_SEND_TRANSCRIPT=on` (off by default: no transcript is written or sent) |

Hermes ≥ 0.22 scrubs common secret shapes from every string it hands to a memory
provider (turn text, recall queries, transcripts) before the plugin sees it;
the plugin itself does no extra redaction. Errors from ValorBrain never break a
turn: every call fails open.

**Self-update (hosted mode).** When `@valorbrain/connect`'s launcher is installed
(`~/.valorbrain/bin/connect/launcher.mjs`) and `node` or `bun` is on `PATH`, the
plugin starts `launcher.mjs heal --harness=hermes` in the background when the API
names a newer client, or every 6 hours; the launcher checks a signed manifest and
may rewrite `~/.hermes/plugins/valorbrain`. Without the launcher nothing runs.
[`patches/0003`](patches/0003-catalog-install-never-self-heals.diff) keeps catalog
installs from ever doing this.

**Messaging-gateway sessions.** In 1.11.0 a gateway session (Telegram, Discord,
Slack, …) is served with the one configured token for every person who talks to
the bot, so their recall and writes land in the token owner's memory. Use it only
on a bot that serves its token's owner. [`patches/0001`](patches/0001-gateway-sessions-off-unless-listed.diff)
turns the provider off in gateway sessions unless `VALORBRAIN_GATEWAY_USERS`
lists the platform user (or is `*`).

## Turn it off

- Stop per-turn recall: `VALORBRAIN_SEND_PROMPT=off`.
- Stop transcript upload: unset `VALORBRAIN_SEND_TRANSCRIPT` (it is off by default).
- Disable the provider: `hermes memory setup` and pick another provider (or remove
  `memory.provider: valorbrain`).
- Uninstall: `hermes plugins remove valorbrain` (catalog), delete
  `$HERMES_HOME/plugins/valorbrain` (copy), or `pip uninstall valorbrain-hermes`.

## Updating this copy

```bash
hermes/sync.sh                 # vendor HEAD of /www/valorbrain-cli (or $VALORBRAIN_CLI_DIR, or a fresh clone)
hermes/sync.sh --ref <commit>  # vendor a specific pushed commit
hermes/sync.sh --check         # exit 1 if the files here differ from VENDORED_FROM's commit
```

It copies the committed bytes of one commit (never a working tree), refuses a
commit that is not on a remote branch, and rewrites `VENDORED_FROM`.

## Patches proposed upstream

`patches/` holds a `git format-patch` series against `valorbrain-cli@dba2802`,
in order, each with its test. Apply with `git am hermes/patches/*.diff` in a
`valorbrain-cli` checkout, then run
`python3 -m unittest discover -s packages/hermes-plugin/tests`.

| Patch | What it fixes |
|---|---|
| `0001-gateway-sessions-off-unless-listed.diff` | Gateway sessions are served with the one token for everyone. Now off unless `VALORBRAIN_GATEWAY_USERS` lists the platform user id (`user_id` or `user_id_alt`), or is `*`. CLI sessions unchanged. |
| `0002-strip-injected-recall-from-transcript.diff` | `<memory-context>` (with Hermes' system note) and the plugin's own `<vault-*>` blocks are stripped from both sides of a turn before it is written to the transcript, so the extraction never stores recalled memory again as new. |
| `0003-catalog-install-never-self-heals.diff` | Hermes catalog rule 3 (no self-updating code): a copy installed by `hermes plugins install` (`.hermes-catalog.json` beside it) never starts the connect heal. Also ignores bytecode; the tracked `packages/hermes-plugin/__pycache__/` must be removed with `git rm -r` (catalog rule 17). |

## Tests

Offline (no network; a local stub server stands in for the engine):

```bash
python3 -m unittest discover -s hermes/tests -v
```

`test_run_kind.py` is the canonical package's test; `test_hub_package.py`
checks this directory: checksums against `VENDORED_FROM`, versions, the catalog
entry against the manifest, the pip entry point, and that the patch series
applies to the recorded commit (skipped without a `valorbrain-cli` checkout).

Live (only with the staging variables; skips otherwise). It runs Hermes' real
agent loop in a throwaway `HOME`/`HERMES_HOME`, with a canned local
OpenAI-compatible model instead of a paid one, and forgets what it creates:

```bash
set -a; . /etc/valorbrain/integracoes-staging.env; set +a
hermes/tests/live_hermes_e2e.sh                 # plugin copied into $HERMES_HOME/plugins/valorbrain
hermes/tests/live_hermes_e2e.sh --entry-point   # plugin pip-installed, found by its entry point
```

It checks that Hermes activates the provider, that `valorbrain_store` →
`valorbrain_retrieve` round-trips, that engine memory reaches the model inside
`<memory-context>` on both turns, and that session end makes the engine write the
session handoff.

## Catalog submission (maintainers)

[`catalog/valorbrain.yaml`](catalog/valorbrain.yaml) is the entry for
`plugin-catalog/valorbrain.yaml` in `NousResearch/hermes-agent`. It points at
the canonical package (`ValorBrain/valorbrain-cli`, `subdir:
packages/hermes-plugin`), not at this copy: one lineage, and SHA bumps follow
the source of truth. Before opening the PR:

1. Land patches 0001–0003 in `valorbrain-cli` (plus `git rm -r
   packages/hermes-plugin/__pycache__`), bump the plugin version, push.
2. Set `sha` and `version` in the entry to that commit, and update the
   gateway sentence of the disclosure and `known_issues` to the new behaviour.
3. At that commit, run what catalog CI runs:
   `hermes plugins validate <checkout>/packages/hermes-plugin --install-deps`,
   `python3 scripts/scan_plugin_payloads.py <dir>` and
   `python3 scripts/validate_plugin_catalog.py plugin-catalog/valorbrain.yaml`
   (the last two from a `hermes-agent` checkout).
4. Open the PR from the ValorBrain organisation (catalog rule 5: owner
   submissions), adding only `plugin-catalog/valorbrain.yaml`, with the
   disclosure lines in the description.
