// A stand-in for the Anthropic Messages API, for run-e2e.sh: Claude Code talks
// to it through ANTHROPIC_BASE_URL, so the run needs no Anthropic account and
// no model decides anything. It logs every request body (JSONL) and plays a
// fixed script through the ValorBrain MCP tools the session offers:
//   1. memory_store a note carrying the marker;
//   2. memory_retrieve the marker (after a pause: writes are searchable in ~4 s),
//      again up to 3 times while the result lacks it;
//   3. memory_forget the stored path;
//   4. a short text reply.
// Usage: node mock-anthropic.mjs <port> <log.jsonl> <marker>
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 0);
const logPath = process.argv[3] || '/dev/null';
const marker = process.argv[4] || 'vb-e2e-marker';
const PAUSE_MS = 5000;

/** The tool calls made so far and their results, in order. */
function history(messages) {
    const calls = [];
    for (const m of messages) {
        if (!Array.isArray(m.content)) continue;
        for (const c of m.content) {
            if (c.type === 'tool_use') calls.push({ id: c.id, name: c.name, result: null });
            if (c.type === 'tool_result') {
                const call = calls.find((x) => x.id === c.tool_use_id);
                const text = Array.isArray(c.content) ? c.content.map((p) => p.text || '').join('') : String(c.content ?? '');
                if (call) call.result = text;
            }
        }
    }
    return calls;
}

function storedPath(calls) {
    const store = calls.find((c) => c.name.endsWith('__memory_store'));
    try {
        return JSON.parse(store?.result || '{}').path || null;
    } catch {
        return /"path"\s*:\s*"([^"]+)"/.exec(store?.result || '')?.[1] || null;
    }
}

/** The next step of the script: { tool, input, delay } or { text }. */
export function nextStep(body) {
    const tools = (body.tools || []).map((t) => t.name || '');
    const tool = (suffix) => tools.find((n) => /valorbrain/.test(n) && n.endsWith(`__${suffix}`));
    const calls = history(Array.isArray(body.messages) ? body.messages : []);
    if (!tool('memory_store')) return { text: 'mock: no ValorBrain tools in this request.' };
    const last = calls[calls.length - 1];
    if (calls.length === 0) {
        return { tool: tool('memory_store'), input: { type: 'observation', title: `Claude Code plugin e2e ${marker}`, content: `The Claude Code plugin end-to-end test stored the marker ${marker}. Safe to delete.` } };
    }
    const retrieves = calls.filter((c) => c.name.endsWith('__memory_retrieve'));
    const found = retrieves.some((c) => (c.result || '').includes(`plugin e2e ${marker}`));
    if (last.name.endsWith('__memory_forget')) return { text: `mock: stored, found=${found}, forgot ${marker}.` };
    if (!found && retrieves.length < 4) return { tool: tool('memory_retrieve'), input: { query: marker, limit: 5 }, delay: PAUSE_MS };
    const path = storedPath(calls);
    if (path) return { tool: tool('memory_forget'), input: { path, confirm: true } };
    return { text: `mock: stored, found=${found}, nothing to forget.` };
}

function sse(res, events) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
}

function respond(res, body, step) {
    const model = body.model || 'mock';
    const id = `msg_mock_${Date.now()}`;
    const usage = { input_tokens: 10, output_tokens: 5 };
    const content = step.tool
        ? { type: 'tool_use', id: `toolu_mock_${Date.now()}`, name: step.tool, input: step.input }
        : { type: 'text', text: step.text };
    const stop = step.tool ? 'tool_use' : 'end_turn';
    if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model, content: [content], stop_reason: stop, stop_sequence: null, usage }));
        return;
    }
    const start = step.tool ? { ...content, input: {} } : { type: 'text', text: '' };
    const delta = step.tool
        ? { type: 'input_json_delta', partial_json: JSON.stringify(step.input) }
        : { type: 'text_delta', text: step.text };
    sse(res, [
        ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: start }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }],
        ['message_stop', { type: 'message_stop' }],
    ]);
}

const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
        appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, body }) + '\n');
        if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(req.url.includes('count_tokens') ? { input_tokens: 10 } : {}));
            return;
        }
        // Side requests (titles, summaries) carry no tools: plain text.
        const step = nextStep(body);
        setTimeout(() => respond(res, body, step), step.delay || 0);
    });
});

server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`mock-anthropic listening on ${server.address().port}\n`);
});
