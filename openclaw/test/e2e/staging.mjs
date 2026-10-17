// Staging helper for run-isolated.sh, built on the plugin's own client.
// Reads VB_STAGING_URL and VB_STAGING_MCP_TOKEN from the environment; never prints the token.
//   node staging.mjs seed <marker>          store a memory that carries the marker → prints docid
//   node staging.mjs find <marker> [secs]   search until a doc with the marker shows up → prints docids
//   node staging.mjs body <docid>           print a doc's path and body
//   node staging.mjs forget <docid...>      forget the given docs

import { ValorBrainClient } from "../../dist/client.js";

const url = process.env.VB_STAGING_URL;
const token = process.env.VB_STAGING_MCP_TOKEN;
if (!url || !token) {
  console.error("VB_STAGING_URL and VB_STAGING_MCP_TOKEN are required");
  process.exit(2);
}
const client = new ValorBrainClient({ apiUrl: url.replace(/\/+$/, ""), token });
const [cmd, ...args] = process.argv.slice(2);
const sleep = (ms) => {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  return promise;
};

if (cmd === "seed") {
  const marker = args[0];
  const res = await client.store(
    {
      title: `OpenClaw plugin e2e codename ${marker}`,
      content: `The codename of the OpenClaw plugin end-to-end run is ${marker}. It was agreed with the team that this run proves recall from ValorBrain staging.`,
      type: "decision",
      tags: ["e2e", "openclaw-plugin"],
    },
    15_000,
  );
  if (res.status !== 200 || !res.json?.docid) {
    console.error(`seed failed: HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(res.json.docid);
} else if (cmd === "find") {
  const [marker, secs = "30"] = args;
  const deadline = Date.now() + Number(secs) * 1000;
  for (;;) {
    const res = await client.search(marker, 20, 15_000);
    const hits = (res.json?.results ?? []).filter((r) => JSON.stringify(r).includes(marker));
    if (hits.length) {
      for (const h of hits) console.log(`${h.docid}\t${h.title ?? h.filepath ?? ""}`);
      break;
    }
    if (Date.now() > deadline) {
      console.error(`not found after ${secs}s`);
      process.exit(1);
    }
    await sleep(2000);
  }
} else if (cmd === "body") {
  const res = await client.getDocument(args[0], 15_000);
  console.log(`<!-- ${args[0]} ${res.json?.path ?? ""} -->\n${res.json?.body ?? ""}`);
} else if (cmd === "forget") {
  for (const id of args) {
    const res = await client.forget(id, 15_000);
    console.log(`${id}\tHTTP ${res.status}`);
  }
} else {
  console.error("usage: staging.mjs seed|find|body|forget …");
  process.exit(2);
}
