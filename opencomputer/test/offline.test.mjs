// Offline: the provider in front of the in-memory stub must pass every contract check.
//   node --test opencomputer/test/offline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStub } from "./stub-valorbrain.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const collect = (child) => new Promise((resolve) => {
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.on("close", (code) => resolve({ code, out }));
});

test("provider passes the contract checks against the stub", { timeout: 60_000 }, async () => {
  const stub = await startStub();
  const port = await freePort();
  const provider = spawn(process.execPath, [join(here, "..", "oc-memory-valorbrain.mjs")], {
    env: { ...process.env, PORT: String(port), OC_MEMORY_TOKEN: "oc-test", VALORBRAIN_MCP_URL: stub.url, VALORBRAIN_MCP_TOKEN: stub.token },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      provider.stderr.on("data", (d) => String(d).includes("oc-memory provider on") && resolve());
      provider.on("exit", (code) => reject(new Error(`provider exited with ${code}`)));
    });
    const base = `http://127.0.0.1:${port}/oc-memory`;
    const env = { ...process.env, OC_BASE: base, OC_MEMORY_TOKEN: "oc-test" };
    const contract = await collect(spawn(process.execPath, [join(here, "run-contract.mjs")], { env, stdio: ["ignore", "pipe", "inherit"] }));
    assert.equal(contract.code, 0, contract.out.split("\n").filter((l) => l.startsWith("FAIL")).join("\n"));
    assert.match(contract.out, /ALL CHECKS PASSED/);
    assert.equal((contract.out.match(/^PASS /gm) || []).length, 13);

    const raw = await collect(spawn(process.execPath, [join(here, "read-after-write.mjs")], { env, stdio: ["ignore", "pipe", "inherit"] }));
    assert.equal(raw.code, 0);
    assert.match(raw.out, /attempts needed.*: 1, 1, 1, 1, 1, 1, 1, 1/);
  } finally {
    provider.removeAllListeners("exit");
    provider.kill();
    stub.server.close();
  }
});
