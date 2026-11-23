// Assertions for run-e2e.sh. Reads the codex exec output and the request
// bodies the mock model received. Prints one line per check; exit 1 on a miss.
// Usage: node check-e2e.mjs <A|C> <prefix> <marker>
import { readFileSync } from 'node:fs';

const [scenario, prefix, marker] = process.argv.slice(2);
const out = readFileSync(`${prefix}.out.txt`, 'utf-8');
const requests = readFileSync(`${prefix}.model.jsonl`, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.method === 'POST' && r.url.includes('/responses'));
let failed = 0;
const check = (ok, label) => {
    console.log(`   ${ok ? 'ok  ' : 'MISS'} ${label}`);
    if (!ok) failed++;
};

const count = (re) => (out.match(re) || []).length;
const perEvent = scenario === 'C' ? 2 : 1; // C: the plugin's hook and the installer's
for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    const done = count(new RegExp(`^hook: ${event} Completed$`, 'gm'));
    check(done === perEvent && count(new RegExp(`^hook: ${event} Failed$`, 'gm')) === 0, `${event}: ${done} hook(s) completed, none failed`);
}

const first = requests[0]?.body;
const contextItems = (first?.input || []).filter((i) => JSON.stringify(i).includes('ValorBrain guide v'));
check(contextItems.length === 1, `session-start context reached the model exactly once (${contextItems.length})`);

const input = requests[requests.length - 1]?.body?.input || [];
const calls = input.filter((i) => i.type === 'function_call');
const output = (call) => {
    const o = input.find((i) => i.type === 'function_call_output' && i.call_id === call.call_id)?.output;
    return typeof o === 'string' ? o : JSON.stringify(o ?? '');
};
const named = (n) => calls.filter((c) => c.name === n && /valorbrain/.test(c.namespace || ''));
const store = named('memory_store')[0];
check(Boolean(store) && /path/.test(output(store)), `MCP memory_store wrote the marker (${store?.namespace || 'no call'})`);
const retrieves = named('memory_retrieve');
check(retrieves.some((c) => output(c).includes(`plugin e2e ${marker}`)), `MCP memory_retrieve found the marker (after ${retrieves.length} call(s))`);
const forget = named('memory_forget')[0];
check(Boolean(forget) && /deactivated|forgot|removed/.test(output(forget)), 'MCP memory_forget removed it');
process.exit(failed ? 1 : 0);
