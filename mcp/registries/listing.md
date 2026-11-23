# ValorBrain: listing copy for MCP catalogs

Copy these fields into the Smithery, Glama and mcp.so forms. The official MCP Registry takes the same data from [`../server.json`](../server.json).

## Identity

| Field | Value |
|---|---|
| Name | ValorBrain |
| Registry name | `br.com.valorbrain/memory` |
| Endpoint (Streamable HTTP) | `https://mcpbrain.valor.digital/mcp` |
| Transport | Streamable HTTP (no SSE, no stdio package) |
| Auth | OAuth 2.1 (RFC 9728 discovery, DCR, PKCE S256, scopes `read write`) **or** `Authorization: Bearer vbm_…` |
| Website | https://valorbrain.com.br |
| Docs | https://docs.valorbrain.com.br/docs/mcp · agent contract https://valorbrain.com.br/connect.md |
| Source of the recipes | https://github.com/ValorBrain/valorbrain-harness/tree/main/mcp |
| Icon | https://valorbrain.com.br/icon.svg |
| License (recipes) | MIT |

## Short description (at most 100 characters)

Shared, sourced company memory for AI agents: recall context, store decisions, hand off work.

## Long description

ValorBrain is shared company memory for AI agents. Agents call it at the start of a task:

- `memory_prepare` returns who the agent is, the open task state and the memories relevant to the request, each with its source.
- `memory_store` saves what was decided or learned, as a typed record: decision, problem, lesson, milestone, handoff.
- `team_handoff` passes work from one agent or person to the next, so it does not depend on a chat log.

Memory belongs to the tenant (the company), not to a single agent. Claude Code, Codex, Gemini CLI, OpenCode, Goose, Zed or Open WebUI all read and write the same brain. Each write is attributed to the agent and person behind it. Answers cite documents, and wrong or stale memories can be corrected with authority instead of piling up.

## Categories / tags

memory, knowledge-base, agents, team-collaboration, context, rag, productivity

## Tools (36)

| Group | Tools |
|---|---|
| Recall | `memory_prepare`, `memory_retrieve`, `memory_recent`, `memory_grep`, `get`, `multi_get`, `working_context`, `episodes`, `keyed_facts_as_of`, `mental_models` |
| Write and correct | `memory_store`, `memory_forget`, `memory_curate`, `memory_used`, `upsert_keyed_fact`, `assert_authority_correction`, `authority_restore_demotion`, `record_lesson`, `list_lessons`, `diary`, `entity_cards`, `append_entity_card`, `commitments` |
| Coordinate | `team_handoff`, `team_message`, `team_inbox`, `team_briefing`, `team_roster`, `team_notify_human`, `task_state`, `notifications` |
| Identity and health | `whoami`, `acl_me`, `memory_health`, `feedback`, `secrets` |

## Connection snippet for catalogs that show one

```json
{
  "mcpServers": {
    "valorbrain": {
      "type": "http",
      "url": "https://mcpbrain.valor.digital/mcp"
    }
  }
}
```

Clients with MCP OAuth need nothing else. Others add `"headers": {"Authorization": "Bearer <vbm_token>"}`. Per-client recipes: https://github.com/ValorBrain/valorbrain-harness/tree/main/mcp/clients
