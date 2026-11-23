# ValorBrain for OpenClaw — self-hosted engine build (legacy)

This is the vendored bun bundle (0.10.2) of the plugin that ships inside the
private ValorBrain engine (`src/openclaw`). It **requires the self-hosted
engine's binary on the gateway host**: lifecycle hooks spawn the engine
binary's `hook` subcommand and the tools call `http://127.0.0.1:<servePort>`.
Without that binary it does nothing.

**The default path is [`../openclaw/`](../openclaw/)**: an HTTP-only memory
plugin that talks to the hosted API (or to your own engine via `apiUrl`) and
needs no binary. Use this directory only if you run the engine yourself and
want the binary-driven hooks.

Notes:

- `openclaw plugins install` refuses this bundle (OpenClaw's install scanner
  flags its `child_process` use and its env-plus-network pattern as critical).
  Deploy it with `./install.sh openclaw-self-hosted`, which copies `dist/index.js`,
  `openclaw.plugin.json` and `package.json` into `~/.openclaw/extensions/valorbrain/`,
  or build it from the engine checkout: `bun build src/openclaw/index.ts --outdir dist --target node`.
- Both plugins use the id `valorbrain`: install one or the other, not both.
- Refresh from the engine: `scripts/vendor-from-engine.sh`.
