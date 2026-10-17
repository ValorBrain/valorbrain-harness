// A scripted OpenAI-compatible chat model for the isolated end-to-end run.
// It records every request (so the run can prove what OpenClaw sent the model)
// and answers deterministically:
//   - a user message with `STORE: <title> | <content>` → one valorbrain_store tool call;
//   - after a tool result → "stored";
//   - otherwise → a reply that says whether a <valorbrain-memory> block reached it
//     and which E2E marker it carried.
// Usage: node mock-llm.mjs <port> <requests.jsonl>

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] || 28790);
const logPath = process.argv[3] || "mock-llm-requests.jsonl";

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n")
      : "";

function decide(messages) {
  const last = messages[messages.length - 1];
  if (last?.role === "tool") return { text: "stored" };
  const userText = textOf(last?.content);
  const store = /STORE:\s*(.+?)\s*\|\s*([\s\S]+)$/m.exec(userText);
  if (store) {
    return { tool: { name: "valorbrain_store", args: { title: store[1].trim(), content: store[2].trim(), type: "decision" } } };
  }
  const all = messages.map((m) => textOf(m.content)).join("\n");
  const block = /<valorbrain-memory>[\s\S]*?<\/valorbrain-memory>/.exec(userText);
  const marker = block && /E2E-[A-Za-z0-9-]+/.exec(block[0]);
  const sys = all.includes("## ValorBrain memory") ? "yes" : "no";
  return {
    text: `mock reply. memory block in this turn: ${block ? "yes" : "no"}; marker: ${marker ? marker[0] : "none"}; system section: ${sys}`,
  };
}

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-1", object: "model" }] }));
      return;
    }
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(raw || "{}");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), messages, tools: (body.tools || []).map((t) => t.function?.name) })}\n`);
    const out = decide(messages);
    const base = { id: `mock-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mock-1" };
    const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
    if (out.tool) {
      sse(res, [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_e2e_1", type: "function", function: { name: out.tool.name, arguments: JSON.stringify(out.tool.args) } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage },
      ]);
      return;
    }
    sse(res, [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", content: out.text }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
    ]);
  });
}).listen(port, "127.0.0.1", () => console.log(`mock-llm listening on 127.0.0.1:${port}`));
