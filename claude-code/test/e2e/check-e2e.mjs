// Assertions for run-e2e.sh. Reads the session's debug log and the request
// bodies the mock model received. Prints one line per check; exit 1 on a miss.
// Usage: node check-e2e.mjs <A|C> <prefix> <marker>
import { readFileSync } from 'node:fs';

const [scenario, prefix, marker] = process.argv.slice(2);
const debug = readFileSync(`${prefix}.debug.log`, 'utf-8');
const requests = readFileSync(`${prefix}.model.jsonl`, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let failed = 0;
const check = (ok, label) => {
    console.log(`   ${ok ? 'ok  ' : 'MISS'} ${label}`);
    if (!ok) failed++;
};

const turns = requests.filter((r) => r.url.startsWith('/v1/messages') && (r.body.tools || []).some((t) => /valorbrain/.test(t.name || '')));
const first = turns[0]?.body;
const texts = (body) => (body?.messages || []).flatMap((m) => (typeof m.content === 'string' ? [m.content] : (m.content || []).map((c) => c.text || '')));
const contextCount = texts(first).filter((t) => t.includes('SessionStart hook additional context')).length;
const results = turns.length ? (turns[turns.length - 1].body.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])) : [];
const uses = results.filter((c) => c.type === 'tool_use');
const resultOf = (suffix) => uses.filter((u) => u.name.endsWith(`__${suffix}`)).map((u) => {
    const r = results.find((c) => c.type === 'tool_result' && c.tool_use_id === u.id);
    return { input: u.input, text: Array.isArray(r?.content) ? r.content.map((p) => p.text || '').join('') : String(r?.content ?? ''), error: r?.is_error === true };
});

const pluginHook = (event, hook) => new RegExp(`Hooks: ${event}[^\\n]*valorbrain-plugin\\.mjs" hook ${hook} --harness=claude-code\\] \\(plugin valorbrain@valorbrain\\) finished with status 0`);
check(pluginHook('SessionStart', 'session-start').test(debug), 'plugin hook session-start ran (status 0)');
check(pluginHook('UserPromptSubmit', 'prompt').test(debug), 'plugin hook prompt ran (status 0)');
check(pluginHook('Stop', 'stop').test(debug), 'plugin hook stop ran (status 0)');
check(contextCount === 1, `session-start context reached the model exactly once (${contextCount})`);
const store = resultOf('memory_store')[0];
check(Boolean(store) && !store.error && /"path"/.test(store.text), 'MCP memory_store wrote the marker');
const found = resultOf('memory_retrieve').some((r) => r.text.includes(`plugin e2e ${marker}`));
check(found, `MCP memory_retrieve found the marker (after ${resultOf('memory_retrieve').length} call(s))`);
const forget = resultOf('memory_forget')[0];
check(Boolean(forget) && !forget.error && !/"error"/.test(forget.text), 'MCP memory_forget removed it');
const toolNames = (first?.tools || []).map((t) => t.name).filter((n) => /valorbrain/.test(n));
check(toolNames.length > 0, `MCP tools offered to the model: ${toolNames.length} (${toolNames[0] ? toolNames[0].slice(0, toolNames[0].lastIndexOf('__')) : 'none'}__*)`);

if (scenario === 'A') {
    check(/MCP server "plugin:valorbrain:valorbrain": Successfully retrieved \d+ headers from headersHelper/.test(debug), "plugin MCP server got its headers from the plugin's helper");
    check(/MCP server "plugin:valorbrain:valorbrain": Successfully connected/.test(debug), 'plugin MCP server connected');
}
if (scenario === 'C') {
    check(/Hooks: SessionStart[^\n]*launcher\.mjs[^\n]*hook session-start --harness=claude-code[^\n]*finished with status 0/.test(debug), "the installer's own session-start hook ran");
    check(!/MCP server "plugin:valorbrain:valorbrain": Successfully connected/.test(debug), "the plugin's MCP server stayed off (same URL as the installer's)");
}
process.exit(failed ? 1 : 0);
