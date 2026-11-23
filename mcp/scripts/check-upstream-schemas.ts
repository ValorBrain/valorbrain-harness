// Validates the recipes in mcp/clients against the schemas the clients publish
// (JSON Schema files, or the zod schemas shipped in their npm packages), and
// mcp/server.json against the official MCP Registry schema. Needs network; installs
// its validators into a throwaway directory, never into the repo.
//
//   bun mcp/scripts/check-upstream-schemas.ts
//
// Clients whose config parser is not published (Goose, Zed: Rust structs; Cline and
// Roo Code: zod inside the VS Code extension; AnythingLLM: hand-written checks;
// Kiro: closed source) are covered by mcp/test/recipes.test.ts against the shapes
// documented in each client README.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { at, formatOf, parse, readRecipe } from "../test/catalog";

const MCP_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

// `broken` swaps one string in the first recipe for a value the client rejects. The
// schema must refuse it; otherwise the check would be accepting anything.
const JSON_SCHEMAS: { schema: string; recipes: [client: string, file: string][]; broken: [from: string, to: string] }[] = [
  { schema: "https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json", recipes: [["gemini-cli", "settings.json"], ["gemini-cli", "settings.oauth.json"]], broken: ['"type": "http"', '"type": "streamable-http"'] },
  { schema: "https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/config.schema.json", recipes: [["codex", "config.toml"], ["codex", "config.oauth.toml"]], broken: ["bearer_token_env_var", "bearer_tokn_env_var"] },
  { schema: "https://opencode.ai/config.json", recipes: [["opencode", "opencode.json"], ["opencode", "opencode.oauth.json"]], broken: ['"type": "remote"', '"type": "http"'] },
  { schema: "https://app.kilo.ai/config.json", recipes: [["kilo-code", "kilo.json"], ["kilo-code", "kilo.oauth.json"]], broken: ['"type": "remote"', '"type": "http"'] },
];

const work = mkdtempSync(join(tmpdir(), "vb-mcp-schemas-"));
let failures = 0;

function report(label: string, errors: unknown, expectInvalid = false): void {
  const valid = errors === null || errors === undefined || (Array.isArray(errors) && errors.length === 0);
  const ok = valid !== expectInvalid;
  if (!ok) failures++;
  const detail = ok || expectInvalid ? "" : `\n     ${JSON.stringify(errors).slice(0, 800)}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${expectInvalid ? "rejects broken " : ""}${label}${detail}`);
}

async function load(pkg: string): Promise<Record<string, unknown>> {
  return import(Bun.resolveSync(pkg, work));
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>; // JSON Schema documents: validated by Ajv on compile
}

try {
  const install = Bun.spawnSync(["bun", "add", "--silent", "ajv@8", "ajv-formats@3", "@continuedev/config-yaml@latest", "librechat-data-provider@latest"], { cwd: work, stdout: "ignore", stderr: "pipe" });
  if (install.exitCode !== 0) throw new Error(`bun add failed: ${install.stderr.toString()}`);

  const { default: Ajv } = (await load("ajv")) as { default: new (o: object) => AjvLike };
  const { default: Ajv2020 } = (await load("ajv/dist/2020")) as { default: new (o: object) => AjvLike };
  const { default: addFormats } = (await load("ajv-formats")) as { default: (a: AjvLike) => void };

  const validator = (schema: Record<string, unknown>): AjvLike => {
    const opts = { strict: false, allErrors: true, logger: false, loadSchema: fetchJson };
    const ajv = String(schema.$schema ?? "").includes("2020-12") ? new Ajv2020(opts) : new Ajv(opts);
    addFormats(ajv);
    return ajv;
  };

  const serverSchema = await fetchJson(MCP_SCHEMA);
  const checkServer = await validator(serverSchema).compileAsync(serverSchema);
  const server: Record<string, unknown> = JSON.parse(await Bun.file(join(import.meta.dir, "../server.json")).text());
  checkServer(server);
  report(`server.json ← ${MCP_SCHEMA}`, checkServer.errors);
  checkServer({ ...server, description: "x".repeat(101) });
  report("server.json (description > 100 chars)", checkServer.errors, true);

  for (const { schema, recipes, broken } of JSON_SCHEMAS) {
    const doc = await fetchJson(schema);
    const check = await validator(doc).compileAsync(doc);
    for (const [client, file] of recipes) {
      check(parse(readRecipe({ client, file }), formatOf(file)));
      report(`${client}/${file} ← ${schema}`, check.errors);
    }
    const [client, file] = recipes[0];
    check(parse(readRecipe({ client, file }).replace(broken[0], broken[1]), formatOf(file)));
    report(`${client}/${file} (${broken[1]})`, check.errors, true);
  }

  const continueYaml = await load("@continuedev/config-yaml");
  const blockSchema = continueYaml.blockSchema as ZodLike; // zod schema exported by the package
  const continueText = readRecipe({ client: "continue", file: "valorbrain.yaml" });
  const block = blockSchema.safeParse(parse(continueText, "yaml"));
  report("continue/valorbrain.yaml ← @continuedev/config-yaml blockSchema", block.success ? null : block.error?.issues);
  const badBlock = blockSchema.safeParse(parse(continueText.replace("type: streamable-http", "type: streamableHttp"), "yaml"));
  report("continue/valorbrain.yaml (type: streamableHttp)", badBlock.success ? null : badBlock.error?.issues, true);

  const libre = await load("librechat-data-provider");
  const mcpServers = libre.MCPServersSchema as ZodLike; // zod schema exported by the package
  const servers = (text: string): unknown => at(parse(text, "yaml"), ["mcpServers"]);
  for (const file of ["librechat.yaml", "librechat.oauth.yaml"]) {
    const parsed = mcpServers.safeParse(servers(readRecipe({ client: "librechat", file })));
    report(`librechat/${file} ← librechat-data-provider MCPServersSchema`, parsed.success ? null : parsed.error?.issues);
  }
  const badLibre = mcpServers.safeParse(servers(readRecipe({ client: "librechat", file: "librechat.yaml" }).replace("type: streamable-http", "type: streamableHttp")));
  report("librechat/librechat.yaml (type: streamableHttp)", badLibre.success ? null : badLibre.error?.issues, true);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nall upstream schemas accept the recipes" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

interface AjvLike {
  compileAsync(schema: object): Promise<((data: unknown) => boolean) & { errors?: unknown }>;
}

interface ZodLike {
  safeParse(data: unknown): { success: boolean; error?: { issues: unknown } };
}
