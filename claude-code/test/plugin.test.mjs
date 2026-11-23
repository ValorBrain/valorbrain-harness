// Offline tests for the Claude Code plugin: no network, no claude binary.
// Run: node --test claude-code/test/
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..', 'plugin');
const HUB = join(HERE, '..', '..');
const BIN = join(PLUGIN, 'bin', 'valorbrain-plugin.mjs');
const m = await import(BIN);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const tmpHome = () => mkdtempSync(join(tmpdir(), 'vb-plugin-test-'));
const write = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
};
const settingsWith = (command) => ({ hooks: { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command }] }] } });

/** A fake child process for runHook: records what it was given, answers with `stdout`. */
function fakeSpawn({ stdout = '', code = 0, throws = null, error = null } = {}) {
    const calls = [];
    const impl = (cmd, args, opts) => {
        if (throws) throw throws;
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        const call = { cmd, args, opts, input: '' };
        calls.push(call);
        child.stdin.on('data', (c) => { call.input += c; });
        child.stdin.on('end', () => {
            if (error) {
                child.emit('error', error);
                return;
            }
            child.stdout.end(stdout);
            child.stderr.end();
            setImmediate(() => child.emit('exit', code, null));
        });
        return child;
    };
    return { impl, calls };
}

test('the hook command is the official client at the pinned version, with the installer flags', () => {
    assert.match(m.CONNECT_VERSION, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(m.connectHookArgv('prompt', 'claude-code'), [
        '--no-update-notifier', '--loglevel=warn', '-y', `@valorbrain/connect@${m.CONNECT_VERSION}`, 'hook', 'prompt', '--harness=claude-code',
    ]);
});

test('hook commands that already reach ValorBrain are recognized; ours and third parties are not', () => {
    for (const c of [
        'npx --no-update-notifier --loglevel=warn -y @valorbrain/connect@0.13.0 hook prompt --harness=claude-code',
        'node "/home/u/.valorbrain/bin/connect/launcher.mjs" hook prompt --harness=claude-code',
        'node "C:\\Users\\u\\.valorbrain\\bin\\connect\\launcher.mjs" hook stop --harness=codex',
        '/usr/local/libexec/valorbrain-hook-env hook context-surfacing',
        'valorbrain hook context-surfacing',
        'vbhook prompt',
        'clawmem hook session-start',
    ]) assert.equal(m.isOwnerCommand(c), true, c);
    for (const c of [
        'node "/x/plugins/cache/valorbrain/valorbrain/0.1.0/bin/valorbrain-plugin.mjs" hook prompt --harness=claude-code',
        'rtk hook claude',
        'codedb hook',
        '',
        null,
    ]) assert.equal(m.isOwnerCommand(c), false, String(c));
});

test('hookOwner finds the installer hooks in user and project settings, honours CLAUDE_CONFIG_DIR', () => {
    const home = tmpHome();
    const project = join(home, 'proj');
    mkdirSync(project, { recursive: true });
    assert.equal(m.hookOwner('claude-code', {}, home, project), null);
    write(join(home, '.claude', 'settings.json'), settingsWith('rtk hook claude'));
    assert.equal(m.hookOwner('claude-code', {}, home, project), null, 'third-party hook only');
    write(join(project, '.claude', 'settings.local.json'), settingsWith('npx -y @valorbrain/connect@0.13.0 hook prompt --harness=claude-code'));
    assert.equal(m.hookOwner('claude-code', {}, home, project), join(project, '.claude', 'settings.local.json'));
    const config = join(home, 'cfg');
    write(join(config, 'settings.json'), settingsWith('node "/h/.valorbrain/bin/connect/launcher.mjs" hook prompt --harness=claude-code'));
    assert.equal(m.hookOwner('claude-code', { CLAUDE_CONFIG_DIR: config }, home, home), join(config, 'settings.json'));
    write(join(home, 'broken', '.claude', 'settings.json'), '{not json');
    assert.equal(m.hookOwner('claude-code', {}, join(home, 'broken'), home), null, 'unreadable file is not an owner');
});

test('hookOwner for codex reads hooks.json and inline TOML hooks', () => {
    const home = tmpHome();
    assert.equal(m.hookOwner('codex', {}, home, home), null);
    write(join(home, '.codex', 'config.toml'), '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "npx -y @valorbrain/connect@0.13.0 hook stop --harness=codex"\n');
    assert.equal(m.hookOwner('codex', {}, home, join(home, 'elsewhere')), join(home, '.codex', 'config.toml'));
    const other = tmpHome();
    write(join(other, 'ch', 'hooks.json'), settingsWith('node "/h/.valorbrain/bin/connect/launcher.mjs" hook prompt --harness=codex'));
    assert.equal(m.hookOwner('codex', { CODEX_HOME: join(other, 'ch') }, other, other), join(other, 'ch', 'hooks.json'));
});

test('mcpToken: VALORBRAIN_MCP_TOKEN, then the installer entry of this harness; only vbm_ tokens', () => {
    const home = tmpHome();
    assert.deepEqual(m.mcpToken('claude-code', {}, home), { token: null, source: null });
    write(join(home, '.valorbrain', 'connect.json'), { harnesses: { codex: { token: 'vbm_codexonly' }, 'claude-code': { token: 'vb_agent_rest', api_url: 'x' } } });
    assert.equal(m.mcpToken('claude-code', {}, home).token, null, 'a REST key is not an MCP token');
    write(join(home, '.valorbrain', 'connect.json'), { harnesses: { 'claude-code': { token: 'vbm_saved', api_url: 'http://e', mode: 'mcp-only' } } });
    assert.deepEqual(m.mcpToken('claude-code', {}, home), { token: 'vbm_saved', source: 'connect.json', api: 'http://e', mode: 'mcp-only' });
    assert.equal(m.mcpToken('claude-code', { VALORBRAIN_MCP_TOKEN: ' vbm_env ' }, home).token, 'vbm_env');
    assert.equal(m.mcpToken('claude-code', { VALORBRAIN_MCP_TOKEN: 'vb_agent_x' }, home).token, 'vbm_saved');
});

test('mcpHeaders: harness identity always, Authorization only with a token, persona only when declared', () => {
    const home = tmpHome();
    const none = m.mcpHeaders('claude-code', {}, home);
    assert.equal(none.Authorization, undefined, 'no token: the harness falls back to OAuth');
    assert.equal(none['X-ValorBrain-Harness'], 'claude-code');
    assert.equal(none['X-Source-Agent'], undefined);
    assert.match(none['User-Agent'], /^valorbrain-claude-code-plugin\/\d/);
    write(join(home, '.valorbrain', 'connect.json'), { harnesses: { 'claude-code': { token: 'vbm_saved' } } });
    const h = m.mcpHeaders('claude-code', { VALORBRAIN_SOURCE_AGENT: 'reviewer', VALORBRAIN_AGENT_LANE: 'lane-1' }, home);
    assert.equal(h.Authorization, 'Bearer vbm_saved');
    assert.equal(h['X-Source-Agent'], 'reviewer');
    assert.equal(h['X-Agent-Lane'], 'lane-1');
    assert.equal(m.mcpHeaders('claude-code', { VALORBRAIN_SOURCE_AGENT: 'bad\u200bvalue' }, home)['X-Source-Agent'], undefined, 'invisible character: not sent');
});

test('redactSecrets replaces the obvious shapes and leaves prose alone', () => {
    const cases = [
        ['key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', 'key [redacted]'],
        ['gh ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'gh [redacted]'],
        ['vb vbm_abcdefghijklmnopqrstuv and vb_agent_0123456789abcdef01', 'vb [redacted] and [redacted]'],
        ['aws AKIAABCDEFGHIJKLMNOP', 'aws [redacted]'],
        ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz.0123', 'Authorization: [redacted]'],
        ['db postgres://app:s3cr3tpass@db.local/x', 'db postgres://app:[redacted]@db.local/x'],
        ['export API_KEY=abcd1234efgh5678', 'export API_KEY=[redacted]'],
        ['password: "hunter22hunter22"', 'password: "[redacted]"'],
        ['-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----', '[redacted]'],
    ];
    for (const [input, expected] of cases) assert.equal(m.redactSecrets(input), expected, input);
    const prose = 'What did we decide about the token budget for the password reset flow?';
    assert.equal(m.redactSecrets(prose), prose);
});

test('prepareStdin redacts the prompt fields of a prompt event only', () => {
    const raw = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789 please', session_id: 's' });
    assert.equal(JSON.parse(m.prepareStdin(raw, 'prompt')).prompt, 'use [redacted] please');
    assert.equal(JSON.parse(m.prepareStdin(raw, 'prompt')).session_id, 's');
    assert.equal(m.prepareStdin(raw, 'stop'), raw);
    assert.equal(m.prepareStdin('not json', 'prompt'), 'not json');
    assert.equal(m.prepareStdin('', 'prompt'), '');
});

test('runHook delegates to the official client, passing the redacted payload and its answer', async () => {
    const home = tmpHome();
    const { impl, calls } = fakeSpawn({ stdout: '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"ctx"}}' });
    let printed = '';
    const code = await m.runHook('prompt', 'claude-code', {
        env: { PATH: '/bin' }, home, cwd: home, spawnImpl: impl,
        readStdin: async () => JSON.stringify({ prompt: 'token sk-proj-abcdefghijklmnopqrstuvwxyz' }),
        out: async (s) => { printed += s; },
        err: () => {},
    });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'npx');
    assert.deepEqual(calls[0].args, m.connectHookArgv('prompt', 'claude-code'));
    assert.deepEqual(calls[0].opts.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(JSON.parse(calls[0].input).prompt, 'token [redacted]');
    assert.match(printed, /additionalContext/);
});

test('runHook steps aside when the installer hooks exist, when switched off, and on unknown input', async () => {
    const home = tmpHome();
    const { impl, calls } = fakeSpawn();
    const deps = { home, cwd: home, spawnImpl: impl, readStdin: async () => '{}', out: async () => {}, err: () => {} };
    assert.equal(await m.runHook('prompt', 'claude-code', { ...deps, env: { VALORBRAIN_PLUGIN_HOOKS: 'off' } }), 0);
    assert.equal(await m.runHook('nope', 'claude-code', { ...deps, env: {} }), 0);
    assert.equal(await m.runHook('prompt', 'cursor', { ...deps, env: {} }), 0);
    write(join(home, '.claude', 'settings.json'), settingsWith('node "/h/.valorbrain/bin/connect/launcher.mjs" hook prompt --harness=claude-code'));
    assert.equal(await m.runHook('prompt', 'claude-code', { ...deps, env: {} }), 0);
    assert.equal(calls.length, 0, 'never spawned');
});

test('runHook fails open when npx is missing', async () => {
    const home = tmpHome();
    const errors = [];
    const deps = { env: {}, home, cwd: home, readStdin: async () => '{}', out: async () => {}, err: (s) => errors.push(s) };
    assert.equal(await m.runHook('stop', 'claude-code', { ...deps, spawnImpl: fakeSpawn({ throws: new Error('ENOENT') }).impl }), 0);
    assert.equal(await m.runHook('stop', 'claude-code', { ...deps, spawnImpl: fakeSpawn({ error: new Error('spawn npx ENOENT') }).impl }), 0);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /npx/);
});

test('status never prints a token', () => {
    const home = tmpHome();
    write(join(home, '.valorbrain', 'connect.json'), { harnesses: { 'claude-code': { token: 'vbm_secretvalue123' } } });
    const lines = m.statusLines('claude-code', {}, home, home).join('\n');
    assert.doesNotMatch(lines, /vbm_secretvalue123/);
    assert.match(lines, /token from connect\.json/);
    assert.match(lines, /the plugin runs them/);
    const empty = m.statusLines('claude-code', {}, tmpHome(), home).join('\n');
    assert.match(empty, /no credential yet/);
    assert.match(empty, /OAuth/);
});

test('status names the MCP server configured outside the plugin, which wins', () => {
    const home = tmpHome();
    assert.equal(m.userMcpServer('claude-code', {}, home), null);
    write(join(home, '.claude.json'), { mcpServers: { valorbrain: { type: 'http', url: 'https://mcpbrain.valor.digital/mcp/' } } });
    assert.deepEqual(m.userMcpServer('claude-code', {}, home), { path: join(home, '.claude.json'), url: 'https://mcpbrain.valor.digital/mcp/' });
    assert.match(m.statusLines('claude-code', {}, home, home).join('\n'), /is the one connected; the plugin's stays off/);
    assert.match(m.statusLines('claude-code', { VALORBRAIN_MCP_URL: 'http://127.0.0.1:7439/mcp' }, home, home).join('\n'), /at another URL .*both connect/);
    write(join(home, '.codex', 'config.toml'), 'model = "x"\n\n[mcp_servers.valorbrain]\nurl = "https://mcpbrain.valor.digital/mcp"\nhttp_headers = { "Authorization" = "Bearer vbm_secret" }\n\n[plugins."valorbrain@valorbrain"]\nenabled = true\n');
    assert.deepEqual(m.userMcpServer('codex', {}, home), { path: join(home, '.codex', 'config.toml'), url: 'https://mcpbrain.valor.digital/mcp' });
    const codexStatus = m.statusLines('codex', {}, home, home).join('\n');
    assert.match(codexStatus, /config\.toml .* is the one connected/);
    assert.doesNotMatch(codexStatus, /vbm_secret/);
    write(join(home, '.codex', 'config.toml'), '[plugins."valorbrain@valorbrain"]\nenabled = true\n');
    assert.equal(m.userMcpServer('codex', {}, home), null);
});

test('plugin manifest, hooks and MCP config point at the helper with this harness', () => {
    const manifest = readJson(join(PLUGIN, '.claude-plugin', 'plugin.json'));
    assert.equal(manifest.name, 'valorbrain');
    assert.equal(manifest.version, m.PLUGIN_VERSION);
    assert.equal(manifest.license, 'MIT');
    const hooks = readJson(join(PLUGIN, 'hooks', 'hooks.json')).hooks;
    assert.deepEqual(Object.keys(hooks).sort(), ['SessionStart', 'Stop', 'UserPromptSubmit']);
    const expected = { SessionStart: 'session-start', UserPromptSubmit: 'prompt', Stop: 'stop' };
    for (const [event, name] of Object.entries(expected)) {
        const h = hooks[event][0].hooks[0];
        assert.equal(h.command, `node "\${CLAUDE_PLUGIN_ROOT}/bin/valorbrain-plugin.mjs" hook ${name} --harness=claude-code`);
        assert.equal(h.timeout, 10);
    }
    const server = readJson(join(PLUGIN, '.mcp.json')).mcpServers.valorbrain;
    assert.equal(server.type, 'http');
    assert.equal(server.url, `\${VALORBRAIN_MCP_URL:-${m.DEFAULT_MCP_URL}}`);
    assert.equal(server.headersHelper, 'node "${CLAUDE_PLUGIN_ROOT}/bin/valorbrain-plugin.mjs" mcp-headers --harness=claude-code');
    assert.equal(server.headers, undefined, 'no static credential in the package');
});

test('the marketplace entry points at this plugin', () => {
    const market = readJson(join(HUB, '.claude-plugin', 'marketplace.json'));
    assert.equal(market.name, 'valorbrain');
    assert.ok(market.owner?.name);
    const entry = market.plugins.find((p) => p.name === 'valorbrain');
    assert.equal(entry.source, './claude-code/plugin');
    assert.ok(readdirSync(join(HUB, entry.source)).includes('.claude-plugin'));
});

test('every pinned @valorbrain/connect version in the plugin and README is the helper one', () => {
    const files = [join(PLUGIN, 'skills', 'setup', 'SKILL.md'), join(PLUGIN, 'skills', 'status', 'SKILL.md'), join(HERE, '..', 'README.md')];
    for (const f of files) {
        const pins = [...readFileSync(f, 'utf-8').matchAll(/@valorbrain\/connect@(\d+\.\d+\.\d+)/g)].map((x) => x[1]);
        for (const pin of pins) assert.equal(pin, m.CONNECT_VERSION, `${f} pins ${pin}`);
    }
});
