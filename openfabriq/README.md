# ValorBrain in an openfabriq factory

[openfabriq](https://github.com/openfabriq/openfabriq) runs agents on your repository from files under `openfabriq/`. A factory declares its MCP servers once in `factory.yaml`, and each agent lists the tools it may call. This directory is a small factory where both agents read the team's memory and only the reviewer writes to it.

## The config

[`factory/factory.yaml`](factory/factory.yaml):

```yaml
mcp:
  valorbrain:
    url: https://mcpbrain.valor.digital/mcp
    secret: MCP_VALORBRAIN_TOKEN   # sent as "Authorization: Bearer"

network: [packages, mcpbrain.valor.digital]
```

[`factory/agents/implementer/agent.md`](factory/agents/implementer/agent.md) reads only:

```yaml
tools: [read, edit, shell]
mcp:
  valorbrain: [memory_retrieve]
```

[`factory/agents/reviewer/agent.md`](factory/agents/reviewer/agent.md) reads and writes:

```yaml
tools: [read, shell]
mcp:
  valorbrain: [memory_retrieve, memory_store]
```

The automation in [`factory/automations/`](factory/automations/implement-ready-issues/automation.md) starts the implementer when an issue gets the `ready-for-agent` label, with `reviewed_by: reviewer`.

## Use it

```bash
cp -r factory/ <your repo>/openfabriq/      # then set repository and maintainers in factory.yaml
npx -y @valorbrain/cli@latest init --agent --agent-caller openfabriq --json   # prints mcp_token (vbm_…)
openfabriq secret set MCP_VALORBRAIN_TOKEN
openfabriq validate && openfabriq plan
```

## What ran on 2026-11-27, and what did not

With openfabriq 0.2.0 on Node 24, on a scratch repository:

| Step | Result |
|---|---|
| `openfabriq validate`, `openfabriq doctor` | Pass. |
| `openfabriq plan` | Lists the server, its secret, and each agent's memory tools under "Security changes". Output in [`runs/2026-11-27/plan-output.txt`](runs/2026-11-27/plan-output.txt). |
| `openfabriq apply` | Created the 7 labels on GitHub. |
| `openfabriq start`, then labeling an issue | The engine queued and started the run. **The agent step did not run**: Claude Code answered "Not logged in". On that host Claude Code is signed in under a custom `CLAUDE_CONFIG_DIR`, which the engine does not pass to runs. Log in [`engine-log.txt`](runs/2026-11-27/engine-log.txt). |

So the config is accepted and planned by openfabriq, and **no agent has called ValorBrain from inside an openfabriq run yet.**

What was run instead is the same MCP entry the engine writes for Claude Code ([`runs/2026-11-27/mcp.json`](runs/2026-11-27/mcp.json)), in headless Claude Code (Haiku), with only the tools each agent lists allowed. The memory held one decision and one lesson, stored beforehand. Prompts and outputs are in [`runs/2026-11-27/`](runs/2026-11-27/).

| Pass | Tools allowed | Result |
|---|---|---|
| Implementer | `memory_retrieve` | 9.9 s. Found both memories and changed its plan: `createdAt` as an ISO 8601 string instead of `Date.now()`, and an injectable clock for the test. |
| Reviewer | `memory_retrieve`, `memory_store` | 9.2 s. Rejected a diff that returned an epoch number, citing both memories by id, and stored nothing because memory already had both. |

## What leaves your machine

A request goes to `mcpbrain.valor.digital` only when an agent calls one of its listed tools: the search query for `memory_retrieve`, the title and text for `memory_store`. The token is read from openfabriq's secrets, not from the repository. To stop, remove the `mcp:` block and run `openfabriq apply`.
