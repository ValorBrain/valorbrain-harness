/**
 * Agent tools over REST. Each one answers with text the model can read; an
 * engine error becomes a short message, never an exception into the turn.
 */
import { redactSecrets } from "./text.js";
const TOOL_TIMEOUT_MS = 15_000;
const STORE_TYPES = ["decision", "observation", "problem", "milestone", "handoff", "lesson", "note"];
const reply = (text, details = {}) => ({
    content: [{ type: "text", text }],
    details,
});
async function call(run) {
    try {
        const res = await run();
        if (res.status >= 200 && res.status < 300)
            return res;
        const err = res.json?.error;
        return `ValorBrain answered HTTP ${res.status}${typeof err === "string" ? `: ${err.slice(0, 300)}` : ""}`;
    }
    catch (e) {
        return `ValorBrain unreachable (${e?.name === "TimeoutError" ? "timed out" : "request failed"})`;
    }
}
export const TOOL_NAMES = ["valorbrain_search", "valorbrain_get", "valorbrain_store"];
export function createTools(client) {
    return [
        {
            name: "valorbrain_search",
            label: "ValorBrain search",
            description: "Search the team's long-term memory (decisions, lessons, handoffs, notes) in ValorBrain. Returns titles, docids and snippets.",
            parameters: {
                type: "object",
                additionalProperties: false,
                required: ["query"],
                properties: {
                    query: { type: "string", description: "What to look for, in natural language." },
                    limit: { type: "integer", minimum: 1, maximum: 20, description: "Max results (default 5)." },
                },
            },
            async execute(_id, params) {
                const query = String(params.query ?? "").trim();
                if (!query)
                    return reply("query is required");
                const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
                const res = await call(() => client.search(redactSecrets(query), limit, TOOL_TIMEOUT_MS));
                if (typeof res === "string")
                    return reply(res);
                const hits = (res.json?.results ?? []).slice(0, limit);
                if (!hits.length)
                    return reply("No matching memories.", { count: 0 });
                const text = hits
                    .map((h) => {
                    const score = typeof h.score === "number" ? ` (${h.score.toFixed(2)})` : "";
                    const snippet = (h.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
                    return `- #${h.docid ?? "?"} ${h.title ?? h.filepath ?? "(untitled)"}${score}${snippet ? `\n  ${snippet}` : ""}`;
                })
                    .join("\n");
                return reply(text, { count: hits.length, docids: hits.map((h) => h.docid) });
            },
        },
        {
            name: "valorbrain_get",
            label: "ValorBrain get",
            description: "Read one ValorBrain memory in full by its docid (from valorbrain_search or the injected memory).",
            parameters: {
                type: "object",
                additionalProperties: false,
                required: ["docid"],
                properties: { docid: { type: "string", description: "Document id, e.g. 3f2a9c or #3f2a9c." } },
            },
            async execute(_id, params) {
                const docid = String(params.docid ?? "").trim().replace(/^#/, "");
                if (!docid)
                    return reply("docid is required");
                const res = await call(() => client.getDocument(docid, TOOL_TIMEOUT_MS));
                if (typeof res === "string")
                    return reply(res);
                const doc = (res.json ?? {});
                const body = typeof doc.content === "string" ? doc.content : typeof doc.body === "string" ? doc.body : "";
                const head = [doc.title, doc.path].filter((v) => typeof v === "string" && v).join(" — ");
                return reply(`${head}\n\n${body}`.trim() || "Empty document.", { docid });
            },
        },
        {
            name: "valorbrain_store",
            label: "ValorBrain store",
            description: "Save one durable memory for future sessions and teammates: a decision (what, why, what was rejected), a problem's root cause, a lesson, a milestone or a handoff. One call per item; never store secrets.",
            parameters: {
                type: "object",
                additionalProperties: false,
                required: ["title", "content"],
                properties: {
                    title: { type: "string", minLength: 5, description: "Short, specific title." },
                    content: { type: "string", minLength: 20, description: "The memory itself, self-contained." },
                    type: { type: "string", enum: [...STORE_TYPES], description: "Kind of memory (default note)." },
                    tags: { type: "array", items: { type: "string" } },
                },
            },
            async execute(_id, params) {
                const title = redactSecrets(String(params.title ?? "").trim());
                const content = redactSecrets(String(params.content ?? "").trim());
                if (title.length < 5 || content.length < 20) {
                    return reply("title needs 5+ characters and content 20+ characters");
                }
                const type = STORE_TYPES.includes(String(params.type)) ? String(params.type) : "note";
                const tags = Array.isArray(params.tags) ? params.tags.map(String).slice(0, 20) : undefined;
                const res = await call(() => client.store({ title, content, type, ...(tags ? { tags } : {}) }, TOOL_TIMEOUT_MS));
                if (typeof res === "string")
                    return reply(res);
                const out = (res.json ?? {});
                return reply(`Stored #${out.docid ?? "?"} (${out.action ?? "saved"}).`, { docid: out.docid, path: out.path });
            },
        },
    ];
}
