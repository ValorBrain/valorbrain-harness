# Publishing ValorBrain to MCP catalogs

Status on 2026-10-17: **nothing submitted**. Each step below needs an owner of the ValorBrain domain or org to run it. Listing copy is in [`listing.md`](listing.md).

Recommended order: official MCP Registry → Glama (imports from the registry) → Smithery → mcp.so.

## 1. Official MCP Registry (`registry.modelcontextprotocol.io`)

The manifest is [`../server.json`](../server.json): schema `2025-12-11`, a single `streamable-http` remote, no packages.

- `mcp-publisher validate` (v1.8.1) checked it against the live registry and printed `✅ server.json is valid`.
- `bun mcp/scripts/check-upstream-schemas.ts` validates it against the published JSON Schema.
- The registry had no ValorBrain entry: `GET /v0/servers?search=valorbrain` returned `count: 0`. That matters because each remote URL may belong to only one server name.

### Namespace and ownership proof

The name `br.com.valorbrain/memory` is a domain namespace. Publishing it requires proving control of `valorbrain.com.br`. The registry does **not** check that the remote URL (`mcpbrain.valor.digital`) is on that domain.

- On 2026-10-17, `https://valorbrain.com.br/.well-known/mcp-registry-auth` returned 404.
- The apex TXT records had no `v=MCPv1` entry.

Pick one proof.

**HTTP (no DNS change)**: serve a file from the `valorbrain.com.br` site:

```bash
openssl genpkey -algorithm Ed25519 -out mcp-registry-key.pem          # keep private, outside the repo
PUBLIC_KEY="$(openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}"   # → publish as https://valorbrain.com.br/.well-known/mcp-registry-auth (text/plain)
```

**DNS**: add a TXT record on the **apex** `valorbrain.com.br`, not on a subdomain:

```
valorbrain.com.br. IN TXT "v=MCPv1; k=ed25519; p=<PUBLIC_KEY>"
```

Then publish:

```bash
# https://github.com/modelcontextprotocol/registry/releases (mcp-publisher_<os>_<arch>.tar.gz)
PRIVATE_KEY="$(openssl pkey -in mcp-registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher login http --domain valorbrain.com.br --private-key "$PRIVATE_KEY"   # or: login dns
cd mcp && mcp-publisher publish
curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=br.com.valorbrain'
```

The GitHub alternative needs no domain proof: rename the server to `io.github.ValorBrain/memory` and run `mcp-publisher login github`. The person logging in must be an **Owner** of the `ValorBrain` GitHub org; plain membership is not enough.

Versions are immutable. Bump `version` in `server.json` (it tracks the engine's MCP `serverInfo.version`, `1.1.0` today) before every publish.

## 2. Glama (`glama.ai/mcp/connectors`)

- Glama ingests the official registry, so after step 1 the connector should appear under `br.com.valorbrain/memory` without a manual submission. The manual path is **Add MCP Server → Connector**, with the name, the short description from `listing.md` and the URL `https://mcpbrain.valor.digital/mcp`.
- **Claim ownership.** For registry listings the claim applies to the domain in the namespace, `valorbrain.com.br`. Copy the token from Glama's **Claim ownership** panel into [`glama.well-known.json`](glama.well-known.json) and serve it at `https://valorbrain.com.br/.well-known/glama.json`. The alternative is a TXT record at `_glama-claim.valorbrain.com.br`. Glama re-checks daily.
- **Health check.** Glama only lists healthy connectors. ValorBrain answers every unauthenticated request with `401`, so Glama needs a test profile with credentials: an **API Key** profile with a `vbm_` token from a throwaway tenant, sent as `Authorization: Bearer …`. DCR registers Glama as a client but gives it no token. Creating that sandbox tenant is a product decision.

## 3. Smithery (`smithery.ai`)

```bash
npx -y @smithery/cli@latest mcp publish https://mcpbrain.valor.digital/mcp -n valorbrain/memory
# after the OAuth sign-in Smithery asks for:
npx -y @smithery/cli@latest mcp publish --resume
```

The CLI (`@smithery/cli` 4.11.1) has `mcp publish [target] -n <org/name> [--config-schema] [--resume]`. You can also use the form at `smithery.ai/new`.

- **Scan.** Smithery connects and lists tools. On `401` it runs OAuth discovery, which ValorBrain supports (`WWW-Authenticate` points to `resource_metadata`), and asks the publisher to sign in.
- **Risk.** Smithery documents OAuth client registration through Client ID Metadata Documents (CIMD). ValorBrain's authorization server advertises DCR, not CIMD. Its metadata has no `client_id_metadata_document_supported`. If the scan cannot register, ask Smithery about DCR fallback, or add CIMD support to the engine.
- **Static server card.** Smithery reads `https://mcpbrain.valor.digital/.well-known/mcp/server-card.json` when the scan fails. That path currently returns `401`, because the gateway only exposes the OAuth well-knowns on the MCP host. The app host serves a card at `https://valorbrain.valor.digital/.well-known/mcp/server-card.json`, but its `serverInfo` (`valorbrain-memory` 0.17.0, 4 tools) is out of date. Exposing an up-to-date card on the MCP host is an engine and gateway change.

## 4. mcp.so

- Form: `https://mcp.so/submit?type=remote-server`. Fields: **Remote endpoint URL** `https://mcpbrain.valor.digital/mcp` and **Name** `ValorBrain`. Paste the long description from `listing.md`.
- There are two paths. Free review has no published turnaround. Premium (US$ 39, one-time) publishes immediately with a "Verified" badge.
- mcp.so documents no domain verification and no live scan.
- Do not use the third-party `chatmcp/mcp-server-collector` script.

## What each catalog will do with the server

| Catalog | Connects to the server? | Needs a credential from us? | Ownership proof |
|---|---|---|---|
| Official registry | No (metadata only) | No | HTTP file or DNS TXT on `valorbrain.com.br`, or Owner of the GitHub org |
| Glama | Yes: scheduled `tools/list` | Yes: a sandbox `vbm_` token | `/.well-known/glama.json` or TXT `_glama-claim.valorbrain.com.br` |
| Smithery | Yes: scan at publish | OAuth sign-in by the publisher | Settings → Verification (process not public) |
| mcp.so | Not documented | No | None documented |
