// Offline tests for the Codex plugin: no network, no codex binary.
// The shared helper (bin/valorbrain-plugin.mjs) is tested in depth by
// claude-code/test/plugin.test.mjs; this file checks the Codex wiring and that
// the two copies are the same file.
// Run: node --test codex/test/*.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..', 'plugin');
const HUB = join(HERE, '..', '..');
const BIN = join(PLUGIN, 'bin', 'valorbrain-plugin.mjs');
const m = await import(BIN);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const tmpHome = () => mkdtempSync(join(tmpdir(), 'vb-codex-test-'));
const write = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data));
};

test('the helper is byte-identical to the Claude Code copy', { skip: !existsSync(join(HUB, 'claude-code', 'plugin', 'bin', 'valorbrain-plugin.mjs')) }, () => {
    assert.equal(readFileSync(BIN, 'utf-8'), readFileSync(join(HUB, 'claude-code', 'plugin', 'bin', 'valorbrain-plugin.mjs'), 'utf-8'));
});

test('plugin manifest, hooks and skills', () => {
    const manifest = readJson(join(PLUGIN, '.codex-plugin', 'plugin.json'));
    assert.equal(manifest.name, 'valorbrain');
    assert.equal(manifest.version, m.PLUGIN_VERSION);
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.hooks, './hooks/hooks.json');
    assert.equal(manifest.mcpServers, './.mcp.json');
    assert.equal(manifest.skills, './skills/');
    assert.equal(manifest.interface.displayName, 'ValorBrain');
    const hooks = readJson(join(PLUGIN, 'hooks', 'hooks.json')).hooks;
    const expected = { SessionStart: 'session-start', UserPromptSubmit: 'prompt', Stop: 'stop' };
    assert.deepEqual(Object.keys(hooks).sort(), Object.keys(expected).sort());
    for (const [event, name] of Object.entries(expected)) {
        const h = hooks[event][0].hooks[0];
        // Codex exports PLUGIN_ROOT to plugin hooks.
        assert.equal(h.command, `node "\${PLUGIN_ROOT}/bin/valorbrain-plugin.mjs" hook ${name} --harness=codex`);
        assert.equal(h.timeout, 10);
    }
    for (const skill of ['setup', 'status']) {
        const text = readFileSync(join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf-8');
        assert.match(text, new RegExp(`^---\\nname: ${skill}\\ndescription: .+\\n---\\n`));
        for (const pin of text.matchAll(/@valorbrain\/connect@(\d+\.\d+\.\d+)/g)) assert.equal(pin[1], m.CONNECT_VERSION);
    }
    const readme = readFileSync(join(HERE, '..', 'README.md'), 'utf-8');
    for (const pin of readme.matchAll(/@valorbrain\/connect@(\d+\.\d+\.\d+)/g)) assert.equal(pin[1], m.CONNECT_VERSION);
});

test('the MCP server: public URL, headers from a self-contained helper, no static credential', () => {
    const server = readJson(join(PLUGIN, '.mcp.json')).mcpServers.valorbrain;
    assert.equal(server.url, m.DEFAULT_MCP_URL);
    assert.equal(server.http_headers, undefined);
    assert.equal(server.bearer_token_env_var, undefined);
    // Codex runs the helper without PLUGIN_ROOT, from the session's directory:
    // it must not reference a file of the plugin.
    assert.doesNotMatch(server.http_headers_helper, /PLUGIN_ROOT|valorbrain-plugin\.mjs/);
    assert.match(server.http_headers_helper, new RegExp(`valorbrain-codex-plugin/${m.PLUGIN_VERSION.replace(/\./g, '\\.')}`));
});

/** Run the helper command exactly as written in .mcp.json, through a shell. */
function runHelper(env) {
    const command = readJson(join(PLUGIN, '.mcp.json')).mcpServers.valorbrain.http_headers_helper;
    return JSON.parse(execFileSync('/bin/sh', ['-c', command], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf-8' }));
}

test('the headers helper: token from the installer entry, then the environment; nothing without one', { skip: process.platform === 'win32' }, () => {
    const home = tmpHome();
    assert.deepEqual(runHelper({ HOME: home }), { 'X-ValorBrain-Harness': 'codex', 'User-Agent': `valorbrain-codex-plugin/${m.PLUGIN_VERSION}` });
    write(join(home, '.valorbrain', 'connect.json'), { harnesses: { codex: { token: 'vb_agent_rest' }, 'claude-code': { token: 'vbm_other' } } });
    assert.equal(runHelper({ HOME: home }).Authorization, undefined, 'a REST key or another harness entry never counts');
    write(join(home, '.valorbrain', 'connect.json'), { harnesses: { codex: { token: 'vbm_saved' } } });
    assert.equal(runHelper({ HOME: home }).Authorization, 'Bearer vbm_saved');
    assert.equal(runHelper({ HOME: home, VALORBRAIN_MCP_TOKEN: 'vbm_env' }).Authorization, 'Bearer vbm_env');
    write(join(home, '.valorbrain', 'connect.json'), '{broken');
    assert.equal(runHelper({ HOME: home }).Authorization, undefined);
});

test('the helper agrees with mcpHeaders on identity and token', { skip: process.platform === 'win32' }, () => {
    const home = tmpHome();
    write(join(home, '.valorbrain', 'connect.json'), { harnesses: { codex: { token: 'vbm_saved' } } });
    assert.deepEqual(runHelper({ HOME: home }), m.mcpHeaders('codex', {}, home));
});

test('hook and status commands of the helper, as Codex runs them', { skip: process.platform === 'win32' }, () => {
    const home = tmpHome();
    write(join(home, '.codex', 'hooks.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'npx -y @valorbrain/connect@0.13.0 hook stop --harness=codex' }] }] } });
    // The installer's hooks are there: the plugin's hook exits 0 with no output and never runs npx.
    const out = execFileSync(process.execPath, [BIN, 'hook', 'stop', '--harness=codex'], { env: { HOME: home, PATH: '/nonexistent' }, cwd: home, input: '{}', encoding: 'utf-8' });
    assert.equal(out, '');
    const status = execFileSync(process.execPath, [BIN, 'status', '--harness=codex'], { env: { HOME: home }, cwd: home, encoding: 'utf-8' });
    assert.match(status, /already installed in .*hooks\.json/);
});

test('the marketplace entry points at this plugin', () => {
    const market = readJson(join(HUB, '.agents', 'plugins', 'marketplace.json'));
    assert.equal(market.name, 'valorbrain');
    assert.equal(market.interface.displayName, 'ValorBrain');
    const entry = market.plugins.find((p) => p.name === 'valorbrain');
    assert.deepEqual(entry.source, { source: 'local', path: './codex/plugin' });
    assert.deepEqual(entry.policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
    assert.equal(entry.category, 'Productivity');
    assert.ok(readdirSync(join(HUB, entry.source.path)).includes('.codex-plugin'));
});
