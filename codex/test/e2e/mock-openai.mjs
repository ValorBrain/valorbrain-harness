// A stand-in for the OpenAI Responses API, for run-e2e.sh: Codex talks to it
// as a custom model provider, so the run needs no OpenAI account and no model
// decides anything. It logs every request body (JSONL) and plays a fixed
// script through the ValorBrain MCP tools the session offers:
//   1. memory_store a note carrying the marker;
//   2. memory_retrieve the marker (after a pause: writes are searchable in ~4 s),
//      again up to 3 times while the result lacks it;
//   3. memory_forget the stored path;
//   4. a short text reply.
// Usage: node mock-openai.mjs <port> <log.jsonl> <marker>
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 0);
const logPath = process.argv[3] || '/dev/null';
const marker = process.argv[4] || 'vb-e2e-marker';
const PAUSE_MS = 5000;

/** Every function-like tool name in the request, flattening namespaces. */
export function toolNames(tools = []) {
    const out = [];
    for (const t of tools) {
        if (t?.type === 'namespace' && Array.isArray(t.tools)) {
            for (const inner of t.tools) out.push({ name: inner.name, namespace: t.name });
        } else if (t?.name) out.push({ name: t.name, namespace: null });
    }
    return out;
}

/** The tool calls made so far and their outputs, in order. */
function history(input = []) {
    const calls = [];
    for (const item of Array.isArray(input) ? input : []) {
        if (item?.type === 'function_call') calls.push({ id: item.call_id, name: `${item.namespace ? `${item.namespace}.` : ''}${item.name}`, result: null });
        if (item?.type === 'function_call_output') {
            const call = calls.find((c) => c.id === item.call_id);
            const out = item.output;
            const text = typeof out === 'string' ? out : Array.isArray(out) ? out.map((p) => p.text || '').join('') : JSON.stringify(out ?? '');
            if (call) call.result = text;
        }
    }
    return calls;
}

function storedPath(calls) {
    const store = calls.find((c) => /memory_store$/.test(c.name));
    return /\\?"path\\?"\s*:\s*\\?"([^"\\]+)/.exec(store?.result || '')?.[1] || null;
}

/** The next step of the script: { tool, input, delay } or { text }. */
export function nextStep(body) {
    const names = toolNames(body.tools);
    const tool = (suffix) => names.find((t) => /valorbrain/.test(`${t.namespace || ''}${t.name}`) && t.name.endsWith(suffix));
    const calls = history(body.input);
    if (!tool('memory_store')) return { text: 'mock: no ValorBrain tools in this request.' };
    const last = calls[calls.length - 1];
    if (calls.length === 0) {
        return { tool: tool('memory_store'), input: { type: 'observation', title: `Codex plugin e2e ${marker}`, content: `The Codex plugin end-to-end test stored the marker ${marker}. Safe to delete.` } };
    }
    const retrieves = calls.filter((c) => /memory_retrieve$/.test(c.name));
    const found = retrieves.some((c) => (c.result || '').includes(`plugin e2e ${marker}`));
    if (/memory_forget$/.test(last.name)) return { text: `mock: stored, found=${found}, forgot ${marker}.` };
    if (!found && retrieves.length < 4) return { tool: tool('memory_retrieve'), input: { query: marker, limit: 5 }, delay: PAUSE_MS };
    const path = storedPath(calls);
    if (path) return { tool: tool('memory_forget'), input: { path, confirm: true } };
    return { text: `mock: stored, found=${found}, nothing to forget.` };
}

function respond(res, body, step) {
    const id = `resp_mock_${Date.now()}`;
    const item = step.tool
        ? { type: 'function_call', id: `fc_mock_${Date.now()}`, call_id: `call_mock_${Date.now()}`, name: step.tool.name, ...(step.tool.namespace ? { namespace: step.tool.namespace } : {}), arguments: JSON.stringify(step.input), status: 'completed' }
        : { type: 'message', id: `msg_mock_${Date.now()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: step.text, annotations: [] }] };
    const response = { id, object: 'response', status: 'completed', model: body.model || 'mock', output: [item], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 } };
    const events = [
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: step.tool ? { ...item, arguments: '' } : { ...item, content: [] } },
        ...(step.tool ? [] : [{ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: step.text }]),
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response },
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
}

const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
        appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, body }) + '\n');
        if (req.method !== 'POST' || !req.url.includes('/responses')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(req.url.includes('/models') ? { object: 'list', data: [], models: [] } : {}));
            return;
        }
        const step = nextStep(body);
        setTimeout(() => respond(res, body, step), step.delay || 0);
    });
});

server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`mock-openai listening on ${server.address().port}\n`);
});
