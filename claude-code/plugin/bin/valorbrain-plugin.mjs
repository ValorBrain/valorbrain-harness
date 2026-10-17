#!/usr/bin/env node
// ValorBrain plugin helper for Claude Code and Codex. MIT License.
//
// This file holds no memory logic. It does three small things:
//   hook <event> --harness=<id>    step aside when the official client already
//                                  owns this harness's hooks, else run the
//                                  official client: npx @valorbrain/connect@<pin> hook
//   mcp-headers --harness=<id>     print the MCP request headers as one JSON object
//                                  (the bearer token comes from the environment or
//                                  from the file the official client saved)
//   status --harness=<id>          what the plugin sees, without printing any token
//
// Node builtins only. Byte-identical copies live in claude-code/plugin/bin and
// codex/plugin/bin of github.com/ValorBrain/valorbrain-harness.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLUGIN_VERSION = '0.1.0';
/** The official hook client this plugin runs. Same pin as the engine's HOSTED_CONNECT_VERSION. */
export const CONNECT_VERSION = '0.13.0';
export const DEFAULT_MCP_URL = 'https://mcpbrain.valor.digital/mcp';
export const HARNESSES = ['claude-code', 'codex'];
export const EVENTS = ['session-start', 'prompt', 'stop'];

/** The command the hook runs, as npx argv. Same flags as the hooks the official installer writes. */
export function connectHookArgv(event, harness) {
    return ['--no-update-notifier', '--loglevel=warn', '-y', `@valorbrain/connect@${CONNECT_VERSION}`, 'hook', event, `--harness=${harness}`];
}

/**
 * A hook command that already sends this harness's events to ValorBrain: the
 * official client (npx or its self-updating launcher) or a self-hosted engine
 * hook. This plugin's own command never matches.
 */
const OWNER_COMMAND = /@valorbrain\/connect\b|[\\/]\.valorbrain[\\/]bin[\\/]connect[\\/]launcher\.mjs|valorbrain-hook-env|\bvbhook\b|\bclawmem\s+hook\b|\bvalorbrain\s+hook\b/;

export function isOwnerCommand(command) {
    return typeof command === 'string' && OWNER_COMMAND.test(command);
}

function str(v) {
    return typeof v === 'string' ? v.trim() : '';
}

function readText(path) {
    try {
        return readFileSync(path, 'utf-8');
    } catch {
        return null;
    }
}

function readJson(path) {
    const text = readText(path);
    if (text === null) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** Every `command` string under a settings/hooks.json `hooks` object. */
export function hookCommandsFromJson(doc) {
    const out = [];
    const hooks = doc && typeof doc === 'object' ? doc.hooks : null;
    if (!hooks || typeof hooks !== 'object') return out;
    for (const groups of Object.values(hooks)) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
            for (const h of Array.isArray(group?.hooks) ? group.hooks : []) {
                if (typeof h?.command === 'string') out.push([h.command, ...(Array.isArray(h.args) ? h.args : [])].join(' '));
            }
        }
    }
    return out;
}

/** `command = "…"` / `args = […]` lines of a Codex config.toml (inline [hooks] tables). */
export function hookCommandsFromToml(text) {
    if (typeof text !== 'string') return [];
    return text.split(/\r?\n/).filter((line) => /^\s*(command|args)\s*=/.test(line));
}

/** The files where a hook for this harness can live (user level, then the project). */
export function hookFiles(harness, env = process.env, home = homedir(), cwd = process.cwd()) {
    if (harness === 'claude-code') {
        const config = str(env.CLAUDE_CONFIG_DIR) || join(home, '.claude');
        const project = str(env.CLAUDE_PROJECT_DIR) || cwd;
        return [
            { path: join(config, 'settings.json'), kind: 'json' },
            { path: join(project, '.claude', 'settings.json'), kind: 'json' },
            { path: join(project, '.claude', 'settings.local.json'), kind: 'json' },
        ];
    }
    if (harness === 'codex') {
        const codexHome = str(env.CODEX_HOME) || join(home, '.codex');
        return [
            { path: join(codexHome, 'hooks.json'), kind: 'json' },
            { path: join(codexHome, 'config.toml'), kind: 'toml' },
            { path: join(cwd, '.codex', 'hooks.json'), kind: 'json' },
            { path: join(cwd, '.codex', 'config.toml'), kind: 'toml' },
        ];
    }
    return [];
}

/** The first file whose hooks already reach ValorBrain for this harness, or null. */
export function hookOwner(harness, env = process.env, home = homedir(), cwd = process.cwd()) {
    const seen = new Set();
    for (const f of hookFiles(harness, env, home, cwd)) {
        if (seen.has(f.path)) continue;
        seen.add(f.path);
        const commands = f.kind === 'json' ? hookCommandsFromJson(readJson(f.path)) : hookCommandsFromToml(readText(f.path));
        if (commands.some(isOwnerCommand)) return f.path;
    }
    return null;
}

/**
 * The MCP token, never printed: VALORBRAIN_MCP_TOKEN, then this harness's
 * entry in ~/.valorbrain/connect.json (written by the official installer).
 * Only MCP tokens (vbm_) count; a REST key cannot authenticate MCP.
 */
export function mcpToken(harness, env = process.env, home = homedir()) {
    const fromEnv = str(env.VALORBRAIN_MCP_TOKEN);
    if (fromEnv.startsWith('vbm_')) return { token: fromEnv, source: 'env' };
    const saved = readJson(join(home, '.valorbrain', 'connect.json'));
    const entry = saved?.harnesses?.[harness];
    const token = str(entry?.token);
    if (token.startsWith('vbm_')) return { token, source: 'connect.json', api: str(entry?.api_url) || null, mode: str(entry?.mode) || 'hooks' };
    return { token: null, source: null };
}

/** Header value safe to send: printable ASCII, bounded. */
function headerValue(v) {
    const s = str(v);
    return s && s.length <= 120 && /^[\x20-\x7e]+$/.test(s) ? s : '';
}

/**
 * Same identity as the MCP entry the official installer writes: the harness
 * (X-ValorBrain-Harness), never a persona of our own, so a memory lands in the
 * same collection whichever way the user installed. An explicit persona or
 * lane from the environment goes along, as the official hooks send it.
 */
export function mcpHeaders(harness, env = process.env, home = homedir()) {
    const headers = {
        'X-ValorBrain-Harness': harness,
        'User-Agent': `valorbrain-${harness}-plugin/${PLUGIN_VERSION}`,
    };
    const persona = headerValue(env.VALORBRAIN_SOURCE_AGENT);
    if (persona) headers['X-Source-Agent'] = persona;
    const lane = headerValue(env.VALORBRAIN_AGENT_LANE);
    if (lane) headers['X-Agent-Lane'] = lane;
    const { token } = mcpToken(harness, env, home);
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function parseArgs(argv) {
    const harness = argv.find((a) => a.startsWith('--harness='))?.slice(10) || '';
    const positional = argv.filter((a) => !a.startsWith('-'));
    return { command: positional[0] || '', event: positional[1] || '', harness };
}

function off(v) {
    return /^(0|off|false|no)$/i.test(str(v));
}

/**
 * Obvious secret shapes, replaced before a prompt leaves the machine. The same
 * families as the engine's secret-patterns.ts. Conservative: a shape this list
 * does not know is sent as typed.
 */
const SECRET_PATTERNS = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\b(?:ghp_|gho_|ghs_|ghu_)[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    /\bsk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
    /\b(?:vb_admin_|vbm_|vb_agent_)[A-Za-z0-9_]{16,}\b/g,
    /\bcf[au]t_[A-Za-z0-9_-]{30,}/g,
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
];
/** `scheme://user:password@host`: only the password goes. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]{1,64}:)([^\s/@'"]{6,128})(@)/gi;
/** `API_KEY=…`, `password: "…"`: the name stays, the value goes. */
const ASSIGNED_SECRET = /\b([A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|token|credential|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*["']?)([^\s"']{8,})/gi;

export function redactSecrets(text) {
    if (typeof text !== 'string' || !text) return text;
    let out = text;
    for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
    out = out.replace(URL_CREDENTIALS, '$1[redacted]$3');
    out = out.replace(ASSIGNED_SECRET, (m, name, sep, value) => (value === '[redacted]' ? m : `${name}${sep}[redacted]`));
    return out;
}

/** The payload fields the official client reads a prompt from. */
const PROMPT_FIELDS = ['prompt', 'user_prompt', 'userPrompt', 'message', 'query', 'text'];

/** The hook payload as it should reach the official client: a prompt event's text redacted. */
export function prepareStdin(raw, event) {
    if (event !== 'prompt' || !raw.trim()) return raw;
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        return raw;
    }
    if (!payload || typeof payload !== 'object') return raw;
    for (const k of PROMPT_FIELDS) {
        if (typeof payload[k] === 'string') payload[k] = redactSecrets(payload[k]);
    }
    return JSON.stringify(payload);
}

function readAll(stream) {
    return new Promise((resolve) => {
        if (!stream || stream.isTTY) {
            resolve('');
            return;
        }
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
}

/** How long to wait for the client's last stdout bytes once it exited. */
const DRAIN_MS = 500;

/**
 * Run a hook: step aside, or hand the (redacted) payload to the official
 * client and pass its answer back. The client's own detached children (its
 * background heal, a transcript upload) never hold the harness's pipes: the
 * harness gets our stdout, closed when the client exits. Never fails the
 * harness: every path ends in exit code 0 unless the client says otherwise.
 */
export async function runHook(event, harness, deps = {}) {
    const env = deps.env ?? process.env;
    const err = deps.err ?? ((s) => process.stderr.write(`[valorbrain] ${s}\n`));
    const out = deps.out ?? ((s) => new Promise((r) => process.stdout.write(s, () => r())));
    const spawnImpl = deps.spawnImpl ?? spawn;
    if (!HARNESSES.includes(harness) || !EVENTS.includes(event)) {
        err(`unknown hook "${event}" for harness "${harness}"`);
        return 0;
    }
    if (off(env.VALORBRAIN_PLUGIN_HOOKS)) return 0;
    // The official installer's hooks already fire on this event: running ours
    // too would send every prompt twice. Silent: that is the expected state.
    if (hookOwner(harness, env, deps.home ?? homedir(), deps.cwd ?? process.cwd())) return 0;
    const input = prepareStdin(await (deps.readStdin ?? (() => readAll(process.stdin)))(), event);
    const result = await new Promise((resolve) => {
        let child;
        try {
            child = spawnImpl('npx', connectHookArgv(event, harness), {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
                shell: process.platform === 'win32',
            });
        } catch (e) {
            err(`could not start npx (${e?.message || e}); install Node.js 18+`);
            resolve({ code: 0, stdout: '' });
            return;
        }
        const chunks = [];
        let ended = false;
        let exited = null;
        const finish = () => resolve({ code: exited ?? 0, stdout: Buffer.concat(chunks).toString('utf-8') });
        child.stdout?.on('data', (c) => chunks.push(c));
        child.stdout?.on('end', () => {
            ended = true;
            if (exited !== null) finish();
        });
        child.stderr?.on('data', (c) => process.stderr.write(c));
        child.on('error', (e) => {
            err(`could not start npx (${e?.message || e}); install Node.js 18+`);
            resolve({ code: 0, stdout: '' });
        });
        child.on('exit', (code, signal) => {
            exited = signal ? 0 : (code ?? 0);
            if (ended) finish();
            else setTimeout(finish, DRAIN_MS);
        });
        child.stdin?.on('error', () => { /* the client may exit before reading */ });
        child.stdin?.end(input);
    });
    if (result.stdout) await out(result.stdout);
    return result.code;
}

/** Where the official hook client will find a credential, in its own order (never the value). */
export function hookCredentialSource(harness, env = process.env, home = homedir()) {
    if (str(env.VALORBRAIN_TOKEN)) return 'VALORBRAIN_TOKEN';
    const entry = readJson(join(home, '.valorbrain', 'connect.json'))?.harnesses?.[harness];
    if (str(entry?.token)) return `~/.valorbrain/connect.json [${harness}]`;
    if (str(readJson(join(home, '.valorbrain', 'config.json'))?.api_key)) return '~/.valorbrain/config.json';
    return null;
}

/**
 * A `valorbrain` MCP server configured outside the plugin (the official
 * installer writes one), which Claude Code prefers at the same URL and Codex
 * prefers by name. { path, url } or null.
 */
export function userMcpServer(harness, env = process.env, home = homedir()) {
    if (harness === 'claude-code') {
        const path = join(home, '.claude.json');
        const url = readJson(path)?.mcpServers?.valorbrain?.url;
        return typeof url === 'string' ? { path, url } : null;
    }
    if (harness === 'codex') {
        const path = join(str(env.CODEX_HOME) || join(home, '.codex'), 'config.toml');
        const text = readText(path) || '';
        const table = /^\s*\[mcp_servers\.(?:valorbrain|"valorbrain")\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(text);
        if (!table) return null;
        return { path, url: /^\s*url\s*=\s*"([^"]*)"/m.exec(table[1])?.[1] || '' };
    }
    return null;
}

export function statusLines(harness, env = process.env, home = homedir(), cwd = process.cwd()) {
    const owner = hookOwner(harness, env, home, cwd);
    const creds = mcpToken(harness, env, home);
    const hookCreds = hookCredentialSource(harness, env, home);
    const user = userMcpServer(harness, env, home);
    const url = (harness === 'claude-code' && str(env.VALORBRAIN_MCP_URL)) || DEFAULT_MCP_URL;
    const lines = [
        `valorbrain plugin ${PLUGIN_VERSION} (${harness}); hook client @valorbrain/connect@${CONNECT_VERSION}`,
        `mcp: plugin server ${url}, ${creds.token ? `token from ${creds.source}` : 'no saved token: the harness signs in with OAuth'}`,
    ];
    if (user) {
        const replaces = harness === 'codex' || user.url.replace(/\/+$/, '') === url.replace(/\/+$/, '');
        lines.push(replaces
            ? `mcp: the valorbrain server in ${user.path} (${user.url}) is the one connected; the plugin's stays off`
            : `mcp: ${user.path} also has a valorbrain server, at another URL (${user.url}): both connect`);
    }
    if (off(env.VALORBRAIN_PLUGIN_HOOKS)) lines.push('hooks: off (VALORBRAIN_PLUGIN_HOOKS=off)');
    else if (owner) lines.push(`hooks: already installed in ${owner}; the plugin's hooks step aside`);
    else if (hookCreds) lines.push(`hooks: the plugin runs them (session start, prompt, stop), credential from ${hookCreds}`);
    else lines.push('hooks: no credential yet, so they send nothing; run the setup skill to sign in');
    return lines;
}

export async function main(argv = process.argv.slice(2)) {
    const { command, event, harness } = parseArgs(argv);
    if (command === 'hook') return runHook(event, harness);
    if (command === 'mcp-headers') {
        if (!HARNESSES.includes(harness)) {
            process.stdout.write('{}\n');
            return 0;
        }
        process.stdout.write(JSON.stringify(mcpHeaders(harness)) + '\n');
        return 0;
    }
    if (command === 'status') {
        if (!HARNESSES.includes(harness)) {
            process.stderr.write(`usage: valorbrain-plugin.mjs status --harness=${HARNESSES.join('|')}\n`);
            return 2;
        }
        process.stdout.write(statusLines(harness).join('\n') + '\n');
        return 0;
    }
    process.stderr.write('usage: valorbrain-plugin.mjs hook <session-start|prompt|stop> --harness=<id> | mcp-headers --harness=<id> | status --harness=<id>\n');
    return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then((code) => process.exit(code), () => process.exit(0));
}
