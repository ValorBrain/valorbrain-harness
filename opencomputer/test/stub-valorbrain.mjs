// In-memory stand-in for the two ValorBrain MCP tools the provider calls
// (memory_store, memory_retrieve), so the contract can be checked offline.
// It answers with the same shapes as the hosted server; ranking is plain word overlap.
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

export function startStub(token = "stub-token") {
  const collections = new Map();
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || []);

  function call(name, args) {
    if (name === "memory_store") {
      const docid = "#" + createHash("sha256").update(args.collection + args.content).digest("hex").slice(0, 6);
      const docs = collections.get(args.collection) || [];
      docs.push({ docid, title: args.title, revision: 1, modified_at: new Date().toISOString(), snippet: args.content, hash: docid });
      collections.set(args.collection, docs);
      return { content: [{ type: "text", text: `Memory stored. Docid: ${docid}` }] };
    }
    if (name === "memory_retrieve") {
      const q = words(args.query);
      const scored = (collections.get(args.collection) || [])
        .map((d) => ({ d, score: [...words(d.snippet)].filter((w) => q.has(w)).length }))
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit || 10)
        .map(({ d }) => (args.mode === "keyword" ? { ...d, modified_at: undefined } : d));
      return { content: [{ type: "text", text: `${scored.length} result(s)` }], structuredContent: { results: scored } };
    }
    return { isError: true, content: [{ type: "text", text: `unknown tool ${name}` }] };
  }

  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (msg.id === undefined) return res.writeHead(202).end();
    const result = msg.method === "initialize"
      ? { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "valorbrain-stub", version: "0" } }
      : call(msg.params.name, msg.params.arguments || {});
    res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": randomUUID() });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/mcp`, token })));
}
