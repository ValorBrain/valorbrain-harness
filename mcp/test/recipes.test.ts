// Offline checks for mcp/: every recipe parses, matches its client's format,
// is embedded verbatim in the client's README, and carries no credential.
// Run: bun test mcp/test/recipes.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { at, CLIENTS_DIR, formatOf, MCP_DIR, parse, PROD_URL, readRecipe, RECIPES, TOKEN_PLACEHOLDER } from "./catalog";

const clientDirs = readdirSync(CLIENTS_DIR).filter((d) => statSync(join(CLIENTS_DIR, d)).isDirectory());

describe("catalog covers mcp/clients", () => {
  test("each client directory has a README and is in the catalog", () => {
    for (const dir of clientDirs) {
      expect(readFileSync(join(CLIENTS_DIR, dir, "README.md"), "utf8").length).toBeGreaterThan(200);
      expect(RECIPES.some((r) => r.client === dir)).toBe(true);
    }
  });

  test("every config file in mcp/clients is described by the catalog", () => {
    for (const dir of clientDirs) {
      for (const file of readdirSync(join(CLIENTS_DIR, dir)).filter((f) => f !== "README.md")) {
        expect(RECIPES.some((r) => r.client === dir && r.file === file)).toBe(true);
      }
    }
  });

  test("the twelve requested clients are present", () => {
    const wanted = ["goose", "continue", "cline", "roo-code", "kilo-code", "librechat", "anythingllm", "zed", "open-webui", "gemini-cli", "codex", "opencode"];
    for (const c of wanted) expect(clientDirs).toContain(c);
  });
});

describe.each(RECIPES.map((r) => [`${r.client}/${r.file}`, r] as const))("%s", (_label, r) => {
  const text = readRecipe(r);
  const doc = parse(text, formatOf(r.file));
  const entry = at(doc, r.entry);

  test("has the ValorBrain entry with the production URL", () => {
    expect(entry).toBeObject();
    expect(at(entry, [r.urlKey])).toBe(PROD_URL);
  });

  test("uses the transport and auth keys the client expects", () => {
    for (const [key, value] of Object.entries(r.expect)) expect(at(entry, [key])).toEqual(value);
  });

  test("identifies itself with X-Source-Agent", () => {
    expect(at(entry, [...r.headers, "X-Source-Agent"])).toBe(r.client);
  });

  test(r.auth === "oauth" ? "sends no Authorization header (OAuth)" : "sends the bearer token the client way", () => {
    expect(at(entry, [...r.headers, "Authorization"])).toBe(r.authorization);
  });

  test("is embedded verbatim in the client README", () => {
    expect(readFileSync(join(CLIENTS_DIR, r.client, "README.md"), "utf8")).toContain(text);
  });
});

describe("no credentials in mcp/", () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(MCP_DIR);

  test.each(files.map((f) => [relative(MCP_DIR, f)]))("%s", (rel) => {
    const text = readFileSync(join(MCP_DIR, rel), "utf8");
    expect(text).not.toMatch(/vbm_[A-Za-z0-9]{12,}/);
    expect(text).not.toMatch(/vb_agent_[A-Za-z0-9]{12,}/);
    expect(text).not.toMatch(/sk-[A-Za-z0-9-]{20,}/);
  });

  test("placeholder is the only literal token form", () => {
    expect(TOKEN_PLACEHOLDER).toBe("<vbm_token>");
  });
});

describe("server.json (official MCP Registry)", () => {
  const server = JSON.parse(readFileSync(join(MCP_DIR, "server.json"), "utf8"));

  test("uses the current schema and required fields", () => {
    expect(server.$schema).toBe("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.title.length).toBeLessThanOrEqual(100);
    expect(server.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("namespace is the domain proven by HTTP auth", () => {
    expect(server.name.startsWith("br.com.valorbrain/")).toBe(true);
  });

  test("declares only the streamable-http remote, optional secret bearer header", () => {
    expect(server.packages).toBeUndefined();
    expect(server.remotes).toEqual([expect.objectContaining({ type: "streamable-http", url: PROD_URL })]);
    const auth = server.remotes[0].headers.find((h: { name: string }) => h.name === "Authorization");
    expect(auth).toMatchObject({ isRequired: false, isSecret: true, value: "Bearer {vbm_token}" });
    expect(Object.keys(auth.variables)).toEqual(["vbm_token"]);
  });

  test("publisher metadata stays inside the registry limits", () => {
    expect(JSON.stringify(server._meta ?? {}).length).toBeLessThan(4096);
  });
});

describe("registry listing material", () => {
  const dir = join(MCP_DIR, "registries");
  const server = JSON.parse(readFileSync(join(MCP_DIR, "server.json"), "utf8"));

  test.each([["README.md"], ["listing.md"]])("%s names the same endpoint and registry name", (file) => {
    const text = readFileSync(join(dir, file), "utf8");
    expect(text).toContain(PROD_URL);
    expect(text).toContain(server.name);
  });

  test("listing short description is the server.json description", () => {
    expect(readFileSync(join(dir, "listing.md"), "utf8")).toContain(server.description);
  });

  test("Glama claim template matches Glama's connector schema shape", () => {
    const claim = JSON.parse(readFileSync(join(dir, "glama.well-known.json"), "utf8"));
    expect(claim.$schema).toBe("https://glama.ai/mcp/schemas/connector.json");
    expect(typeof claim.claim).toBe("string");
  });
});
