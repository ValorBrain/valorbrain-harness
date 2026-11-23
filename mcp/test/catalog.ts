// Machine-readable description of every recipe in mcp/clients. The offline
// test checks each file against it; the live test uses it to retarget a recipe
// at the staging engine.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PROD_URL = "https://mcpbrain.valor.digital/mcp";
export const TOKEN_ENV = "VALORBRAIN_MCP_TOKEN";
export const TOKEN_PLACEHOLDER = "<vbm_token>";
export const MCP_DIR = join(import.meta.dir, "..");
export const CLIENTS_DIR = join(MCP_DIR, "clients");

export type Format = "json" | "yaml" | "toml";
export type Path = readonly (string | number)[];

export interface Recipe {
  client: string;
  file: string;
  auth: "bearer" | "oauth";
  /** Where the ValorBrain server entry sits in the parsed document. */
  entry: Path;
  /** Key under the entry that holds the server URL. */
  urlKey: string;
  /** Exact key/value pairs the client requires on the entry (transport type, auth switches…). */
  expect: Record<string, unknown>;
  /** Path under the entry to the static headers object. */
  headers: Path;
  /** Expected `Authorization` header (bearer recipes that send one). Omitted = must be absent. */
  authorization?: string;
}

const bearer = (syntax: string): string => `Bearer ${syntax}`;

export const RECIPES: readonly Recipe[] = [
  { client: "goose", file: "config.yaml", auth: "bearer", entry: ["extensions", "valorbrain"], urlKey: "uri", expect: { type: "streamable_http", enabled: true, env_keys: [TOKEN_ENV] }, headers: ["headers"], authorization: bearer(`\${${TOKEN_ENV}}`) },
  { client: "goose", file: "config.oauth.yaml", auth: "oauth", entry: ["extensions", "valorbrain"], urlKey: "uri", expect: { type: "streamable_http", enabled: true }, headers: ["headers"] },
  { client: "continue", file: "valorbrain.yaml", auth: "bearer", entry: ["mcpServers", 0], urlKey: "url", expect: { name: "valorbrain", type: "streamable-http" }, headers: ["requestOptions", "headers"], authorization: bearer(`\${{ secrets.${TOKEN_ENV} }}`) },
  { client: "cline", file: "cline_mcp_settings.json", auth: "bearer", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "streamableHttp", disabled: false }, headers: ["headers"], authorization: bearer(`\${env:${TOKEN_ENV}}`) },
  { client: "cline", file: "cline_mcp_settings.oauth.json", auth: "oauth", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "streamableHttp", disabled: false }, headers: ["headers"] },
  { client: "roo-code", file: "mcp.json", auth: "bearer", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "streamable-http", disabled: false }, headers: ["headers"], authorization: bearer(`\${env:${TOKEN_ENV}}`) },
  { client: "kilo-code", file: "kilo.json", auth: "bearer", entry: ["mcp", "valorbrain"], urlKey: "url", expect: { type: "remote", enabled: true, oauth: false }, headers: ["headers"], authorization: bearer(`{env:${TOKEN_ENV}}`) },
  { client: "kilo-code", file: "kilo.oauth.json", auth: "oauth", entry: ["mcp", "valorbrain"], urlKey: "url", expect: { type: "remote", enabled: true, oauth: { scope: "read write" } }, headers: ["headers"] },
  { client: "librechat", file: "librechat.yaml", auth: "bearer", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "streamable-http", requiresOAuth: false }, headers: ["headers"], authorization: bearer(`{{${TOKEN_ENV}}}`) },
  { client: "librechat", file: "librechat.oauth.yaml", auth: "oauth", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "streamable-http", requiresOAuth: true, oauth: { scope: "read write" } }, headers: ["headers"] },
  { client: "anythingllm", file: "anythingllm_mcp_servers.json", auth: "bearer", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "streamable" }, headers: ["headers"], authorization: bearer(TOKEN_PLACEHOLDER) },
  { client: "zed", file: "settings.json", auth: "oauth", entry: ["context_servers", "valorbrain"], urlKey: "url", expect: {}, headers: ["headers"] },
  { client: "zed", file: "settings.bearer.json", auth: "bearer", entry: ["context_servers", "valorbrain"], urlKey: "url", expect: {}, headers: ["headers"], authorization: bearer(TOKEN_PLACEHOLDER) },
  { client: "open-webui", file: "tool-server-connections.json", auth: "bearer", entry: [0], urlKey: "url", expect: { type: "mcp", path: "", auth_type: "bearer", key: TOKEN_PLACEHOLDER, config: { enable: true } }, headers: ["headers"] },
  { client: "open-webui", file: "tool-server-connections.oauth.json", auth: "oauth", entry: [0], urlKey: "url", expect: { type: "mcp", path: "", auth_type: "oauth_2.1", config: { enable: true } }, headers: ["headers"] },
  { client: "open-webui", file: "mcpo.config.json", auth: "bearer", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "streamable-http" }, headers: ["headers"], authorization: bearer(TOKEN_PLACEHOLDER) },
  { client: "gemini-cli", file: "settings.json", auth: "bearer", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "http" }, headers: ["headers"], authorization: bearer(`\${${TOKEN_ENV}}`) },
  { client: "gemini-cli", file: "settings.oauth.json", auth: "oauth", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { type: "http", oauth: { enabled: true, scopes: ["read", "write"] } }, headers: ["headers"] },
  { client: "codex", file: "config.toml", auth: "bearer", entry: ["mcp_servers", "valorbrain"], urlKey: "url", expect: { bearer_token_env_var: TOKEN_ENV }, headers: ["http_headers"] },
  { client: "codex", file: "config.oauth.toml", auth: "oauth", entry: ["mcp_servers", "valorbrain"], urlKey: "url", expect: { scopes: ["read", "write"] }, headers: ["http_headers"] },
  { client: "opencode", file: "opencode.json", auth: "bearer", entry: ["mcp", "valorbrain"], urlKey: "url", expect: { type: "remote", enabled: true, oauth: false }, headers: ["headers"], authorization: bearer(`{env:${TOKEN_ENV}}`) },
  { client: "opencode", file: "opencode.oauth.json", auth: "oauth", entry: ["mcp", "valorbrain"], urlKey: "url", expect: { type: "remote", enabled: true, oauth: { scope: "read write" } }, headers: ["headers"] },
  { client: "kiro-cli", file: "mcp.json", auth: "bearer", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: {}, headers: ["headers"], authorization: bearer(`\${${TOKEN_ENV}}`) },
  { client: "kiro-cli", file: "mcp.oauth.json", auth: "oauth", entry: ["mcpServers", "valorbrain"], urlKey: "url", expect: { oauthScopes: ["read", "write"] }, headers: ["headers"] },
];

export function formatOf(file: string): Format {
  if (file.endsWith(".yaml")) return "yaml";
  if (file.endsWith(".toml")) return "toml";
  return "json";
}

export function recipePath(r: Pick<Recipe, "client" | "file">): string {
  return join(CLIENTS_DIR, r.client, r.file);
}

export function readRecipe(r: Pick<Recipe, "client" | "file">): string {
  return readFileSync(recipePath(r), "utf8");
}

export function parse(text: string, format: Format): unknown {
  switch (format) {
    case "yaml":
      return Bun.YAML.parse(text);
    case "toml":
      return Bun.TOML.parse(text);
    case "json":
      return JSON.parse(text);
  }
}

export function at(value: unknown, path: Path): unknown {
  let cur = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[key];
    } else {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

/** The recipe text pointed at another MCP endpoint (staging or a recording proxy). */
export function retarget(r: Pick<Recipe, "client" | "file">, url: string): string {
  return readRecipe(r).replaceAll(PROD_URL, url);
}

export function recipe(client: string, file: string): Recipe {
  const found = RECIPES.find((r) => r.client === client && r.file === file);
  if (!found) throw new Error(`no recipe ${client}/${file}`);
  return found;
}
