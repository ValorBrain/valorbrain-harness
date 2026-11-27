# ValorBrain in Timon

[Timon](https://github.com/ai-timon/timon) keeps its MCP servers in the daemon and attaches them to agents by id. This directory has the record for ValorBrain, and a variant that signs each agent's writes when several agents share one token.

## Register the server

```bash
npx -y @valorbrain/cli@latest init --agent --agent-caller timon --json   # prints mcp_token (vbm_…)

# put the token in valorbrain.mcp.json, then:
timon mcp put valorbrain < valorbrain.mcp.json
timon agent create reviewer --backend claude --mcp-servers valorbrain \
  --allowed-tools mcp__valorbrain__memory_retrieve,mcp__valorbrain__memory_store
```

[`valorbrain.mcp.json`](valorbrain.mcp.json):

```json
{
  "name": "ValorBrain",
  "description": "Shared team memory: who decided what, and when",
  "transport": {
    "type": "http",
    "url": "https://mcpbrain.valor.digital/mcp",
    "headers": { "Authorization": "Bearer <vbm_token>" }
  }
}
```

Timon moves the headers into its own vault: the file it keeps has a secret id, and `timon mcp get` shows `***`. Delete your copy of the JSON after `put`.

## Who wrote it, with one token

ValorBrain takes the author of a write from the token. When every agent on a daemon shares one token, add `X-Source-Agent` and register one record per agent ([`valorbrain-per-agent.mcp.json`](valorbrain-per-agent.mcp.json)):

```bash
timon mcp put valorbrain-ana < valorbrain-per-agent.mcp.json   # "X-Source-Agent": "ana-reviewer"
timon agent create ana-reviewer --backend claude --mcp-servers valorbrain-ana
```

Each agent's writes then go to its own collection under its own name, and another agent that retrieves the memory is told who wrote it.

## What ran on 2026-11-27, and what did not

With Timon orchestrator 0.1.11 built from source, daemon in portable mode in an empty `TIMON_HOME`, telemetry off:

| Step | Result |
|---|---|
| `timon mcp put valorbrain` | Accepted. The bearer went to Timon's vault. |
| `timon agent create … --mcp-servers valorbrain` | Two agents created with the server attached. |
| `timon spawn ana-reviewer "…"` | Timon started Claude Code with the server wired in. Claude Code reported it as `connected` and listed 32 tools, which Timon cached ([`stored-record-after-mission.json`](runs/2026-11-27/stored-record-after-mission.json)). **The model turn did not run**: Claude Code answered "Not logged in", because on that host it is signed in under a custom configuration directory that Timon does not use. |
| `timon mcp put` with `X-Source-Agent` | Accepted. Both headers went to the vault. |

So Timon accepts the record and reaches the server through its own wiring, and **no agent has called a ValorBrain tool from inside a Timon mission yet.** Two things are open: the hosted server lists 36 tools and Timon's cache has 32 (`memory_prepare`, `memory_grep`, `get` and `multi_get` are missing, and we have not found why), and the `X-Source-Agent` records have not been used by a mission.

The authorship behaviour was run directly against the hosted server, one token and two agent names, sending what Timon would send ([`authorship-one-token.txt`](runs/2026-11-27/authorship-one-token.txt)):

- `ana-reviewer` stored a decision. It went to the collection `agent-ana-reviewer`.
- `ben-implementer` asked a question that the decision answers. The result came back with "written by ana-reviewer less than a minute ago", and `memory_recent` lists it as `(by ana-reviewer)`.

This identifies the agent. It does not identify the person behind it: for that, each person needs their own token.

## What leaves your machine

A request goes to `mcpbrain.valor.digital` only when an agent calls a ValorBrain tool, with that tool's arguments. Nothing is captured automatically. To stop, `timon mcp rm valorbrain`.
