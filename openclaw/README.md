# ValorBrain for OpenClaw

A `kind: "memory"` plugin for [OpenClaw](https://github.com/openclaw/openclaw)
that gives your agent the team memory kept in ValorBrain:

- **Recall before every turn.** The user's message (cleaned and redacted) goes to
  ValorBrain's hook endpoint; the memory it returns is placed in front of the
  message inside a `<valorbrain-memory>` block. On a session's first turn (and
  after a compaction) the session context comes too: your goals and open work.
- **Memory tools.** `valorbrain_search`, `valorbrain_get` and `valorbrain_store`,
  with a short system-prompt section telling the model when to use them.
- **Transcript capture (opt-in, off by default).** The conversation is uploaded so
  ValorBrain extracts decisions and episodes on its side.

It talks to ValorBrain over HTTPS only. No local binary, no daemon, no runtime
dependencies. By default it uses the hosted API; point `apiUrl` at your own
engine if you run one.

Tested with OpenClaw **2026.4.24** (gateway and `openclaw agent`) and Node 22+.

## Install

From this directory (a clone of this repository; `dist/` is committed):

```bash
openclaw plugins install ./openclaw
```

Once published to npm:

```bash
openclaw plugins install @valorbrain/openclaw
```

The install puts the plugin in the exclusive memory slot
(`plugins.slots.memory: "valorbrain"`) and disables `memory-core`. Restart the
gateway afterwards.

## Configure

You need a ValorBrain token (`vbm_…`). Create one in the ValorBrain dashboard, or
let an agent onboard itself:
`npx -y @valorbrain/cli@latest init --agent --agent-caller openclaw --json`
(returns `mcp_token`).

Keep the token out of `openclaw.json`: put it in the gateway's environment.

```bash
export VALORBRAIN_API_TOKEN=vbm_...   # e.g. in ~/.openclaw/.env or the service unit
```

`~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    allow: ["valorbrain"],          // trust list; without it OpenClaw warns at startup
    slots: { memory: "valorbrain" },
    entries: {
      valorbrain: {
        enabled: true,
        config: {
          // all optional
          apiUrl: "https://valorbrain-api.valor.digital", // or your own engine's REST base
          recall: true,              // recall before every turn
          captureTranscript: false,  // upload the conversation for extraction
          tools: true,               // valorbrain_search / _get / _store
          timeoutMs: 4000,           // recall budget per turn
        },
      },
    },
  },
}
```

| Setting | Default | Environment override |
| --- | --- | --- |
| `token` | — | `VALORBRAIN_API_TOKEN` (then `VALORBRAIN_TOKEN`) when `token` is empty |
| `apiUrl` | `https://valorbrain-api.valor.digital` | `VALORBRAIN_API_URL` (when `apiUrl` is empty) |
| `recall` | `true` | `VALORBRAIN_SEND_PROMPT=off\|on` wins |
| `captureTranscript` | `false` | `VALORBRAIN_SEND_TRANSCRIPT=on\|off` wins |
| `tools` | `true` | — |
| `timeoutMs` | `4000` (500–30000) | `VALORBRAIN_HOOK_TIMEOUT_MS` |
| `captureTimeoutMs` | `180000` | — |

`VALORBRAIN_RUN_KIND=routine|pipeline|conversation` labels every request's run
kind; without it, cron-triggered runs are sent as `routine`.

### Hook permissions by OpenClaw version

- **2026.4.24**: nothing to grant. Recall uses `before_prompt_build`; capture uses
  the history that hook receives plus `before_reset`, `session_end` and
  `before_compaction`. Do **not** add `hooks.allowConversationAccess` on 2026.4.24:
  its config schema rejects the key (openclaw/openclaw#71428).
- **Later versions** gate `before_prompt_build` and `agent_end` for non-bundled
  plugins. Grant them in the plugin entry:

  ```json5
  { plugins: { entries: { valorbrain: { hooks: { allowConversationAccess: true } } } } }
  ```

  With the grant the plugin also captures from `agent_end`, one turn earlier.

## What leaves the machine, and when

Everything goes to `apiUrl` with `Authorization: Bearer <token>` and
`User-Agent: valorbrain-openclaw/<version>`. Requests time out (4 s for recall,
15 s for tools, 180 s for extraction) and a failure never breaks the turn: the
agent simply runs without memory and the log gets one warning.

| When | Request | What is sent |
| --- | --- | --- |
| First turn of a session, and the first turn after a compaction | `POST /api/v1/hooks/cue` `event: session_start` | harness name `openclaw`, OpenClaw session id. No message text. |
| Every user turn (`recall` on) | `POST /api/v1/hooks/cue` `event: prompt` | the user's message, at most 8,000 characters, after cleaning and redaction (below) |
| The model calls a tool | `POST /search`, `GET /documents/{id}`, `POST /api/v1/memory/store` | the tool's arguments; `valorbrain_store` title and content are redacted first |
| `captureTranscript` on: once the session has 3 completed turns, then at most every 10 min while it grows, and on reset / session end / compaction (sessions with 2+ turns) | `POST /api/v1/hooks/run` (`episode-extractor`, then `decision-extractor`) | the conversation's user and assistant **text** (cleaned, redacted, last 8 MB). Never thinking blocks, tool calls, tool results or images. At most 8 uploads per 10 min; uploads pause 6 h on 401/403/413 and 30 min on 429. |

Heartbeat runs and OpenClaw's pre-compaction memory flush send nothing.

**Cleaning.** Before a user message is sent, the plugin removes its own
`<valorbrain-memory>` block (OpenClaw persists it with the message), OpenClaw's
channel metadata (`Conversation info (untrusted metadata)` and similar JSON
fences), `[Bootstrap …]` instructions, `System:` event lines and timestamp
prefixes.

**Redaction.** Obvious credentials are replaced by `[redacted]`: GitHub, GitLab,
OpenAI, Anthropic, OpenRouter, AWS, Slack, Stripe, Cloudflare and ValorBrain keys,
`Bearer` tokens, JWTs, private-key blocks, passwords in URLs
(`scheme://user:PASSWORD@host`) and `*SECRET*` / `*PASSWORD*` / `*TOKEN*` /
`*API_KEY*` assignments. This is a safety net, not a guarantee: don't paste secrets
into chats you want remembered.

## Turn it off

- Stop sending prompts: `recall: false` or `VALORBRAIN_SEND_PROMPT=off`.
- Stop transcript capture: leave `captureTranscript` off (the default) or
  `VALORBRAIN_SEND_TRANSCRIPT=off`.
- Disable the plugin: `openclaw plugins disable valorbrain`, or give the memory
  slot back: `plugins.slots.memory: "memory-core"`. Remove it with
  `openclaw plugins uninstall valorbrain`.
- Without a token the plugin stays idle (one warning at startup).

## Recording during a conversation

ValorBrain's hosted hooks end some turns with a short "memory checkpoint" that
the harness's own model executes. OpenClaw 2026.4.x runs `agent_end` after the
reply is delivered and gives plugins no way to continue a turn, so this plugin
does not send checkpoints: the model records with `valorbrain_store` (the system
prompt section says when), and `captureTranscript` covers the rest.

## Self-hosted engine

- **Recommended**: keep this plugin and set `apiUrl` to your engine's REST base
  (for example `https://valorbrain.internal:7438`); use a token from that engine.
- The older binary-driven build that ships inside the engine lives in
  [`../openclaw-self-hosted/`](../openclaw-self-hosted/). It needs the engine's
  `valorbrain` binary on the gateway host. Both use the plugin id `valorbrain`:
  install one or the other.

## Develop

```bash
npm ci
npm run build          # tsc → dist/ (commit dist/)
npm test               # offline: node --test, no network
# live, against a ValorBrain engine (never production for tests):
VB_STAGING_URL=... VB_STAGING_MCP_TOKEN=... npm run test:live
# full run inside an isolated OpenClaw (temp HOME/state, gateway on 127.0.0.1:28789,
# scripted model on 127.0.0.1:28790), cleaning up what it creates:
VB_STAGING_URL=... VB_STAGING_MCP_TOKEN=... test/e2e/run-isolated.sh
```

`test/fixtures/` holds hook payloads captured from a real OpenClaw 2026.4.24
gateway by `test/e2e/probe-plugin` (injected memory elided).

Code layout: `src/config.ts` (settings, reads the environment, no network),
`src/client.ts` (the only module that talks to the network), `src/text.ts`
(cleaning, redaction, transcript format), `src/hooks.ts`, `src/capture.ts`,
`src/tools.ts`, `src/index.ts` (entry).

## Troubleshooting

- `plugin not found: valorbrain` right after `openclaw plugins install` on
  2026.4.24: the CLI validated the memory slot against a stale manifest cache.
  Run the install again, or run it with
  `OPENCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE=1 OPENCLAW_DISABLE_PLUGIN_MANIFEST_CACHE=1`.
- No memory injected: check the gateway log for `valorbrain:` lines (missing
  token, HTTP status, timeout) and, on versions after 2026.4.24, the
  `allowConversationAccess` grant.

## License

MIT, see [LICENSE](LICENSE).
