// Test doubles: an HTTP recorder that stands in for the network, and a fake
// OpenClaw plugin API. No real requests leave the process.

/**
 * `routes` maps "METHOD /path" to a response spec `{ status, json }`, a
 * function `(body, call) => spec`, or the string "hang" (never answers until
 * aborted) / "throw" (network error).
 */
export function recorder(routes = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { key, url, headers: init.headers, body };
    calls.push(call);
    let spec = routes[key] ?? { status: 404, json: { error: "no route" } };
    if (typeof spec === "function") spec = spec(body, call);
    if (spec === "throw") throw new TypeError("fetch failed");
    if (spec === "hang") {
      // A real hanging fetch holds a socket that keeps the event loop alive until
      // AbortSignal.timeout (an unref'd timer) fires. Model that with a ref'd
      // handle, or Node 22's test runner sees an empty loop and cancels the test.
      const { promise, reject } = Promise.withResolvers();
      const socket = setInterval(() => {}, 1_000);
      init.signal?.addEventListener("abort", () => {
        clearInterval(socket);
        reject(init.signal.reason);
      });
      return await promise;
    }
    return new Response(spec.json === undefined ? "" : JSON.stringify(spec.json), {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, impl };
}

export function silentLogger() {
  const lines = [];
  return {
    lines,
    info: (m) => lines.push(["info", m]),
    warn: (m) => lines.push(["warn", m]),
    debug: (m) => lines.push(["debug", m]),
  };
}

/** The slice of OpenClaw's plugin API the plugin calls, recording registrations. */
export function fakeApi({ pluginConfig = {}, config = {}, registrationMode = "full" } = {}) {
  const logger = silentLogger();
  const api = {
    registrationMode,
    config,
    pluginConfig,
    logger,
    hooks: new Map(),
    tools: [],
    services: [],
    memoryCapability: null,
    on(name, handler, opts) {
      api.hooks.set(name, { handler, opts });
    },
    registerTool(tool, opts) {
      api.tools.push({ tool, opts });
    },
    registerService(svc) {
      api.services.push(svc);
    },
    registerMemoryCapability(cap) {
      api.memoryCapability = cap;
    },
  };
  return api;
}
