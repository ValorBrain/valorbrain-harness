// Recording reverse proxy for the live test: clients talk to it, it forwards to
// the staging MCP endpoint and remembers what each client sent. Header values
// are never stored, only whether Authorization was present.

export interface Seen {
  httpMethod: string;
  rpc: string[];
  status: number;
  sourceAgent: string | null;
  userAgent: string | null;
  bearer: boolean;
}

export interface Recorder {
  url: string;
  seen: Seen[];
  /** Requests whose X-Source-Agent matches and whose JSON-RPC method is `rpc`. */
  from(sourceAgent: string, rpc: string): Seen[];
  stop(): void;
}

function rpcMethods(body: string | undefined): string[] {
  if (!body) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return messages.map((m) =>
    m !== null && typeof m === "object" && "method" in m && typeof m.method === "string" ? m.method : "response",
  );
}

export function startRecorder(upstream: string): Recorder {
  const seen: Seen[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const body = req.method === "POST" ? await req.text() : undefined;
      const headers = new Headers(req.headers);
      headers.delete("host");
      const res = await fetch(upstream, { method: req.method, headers, body, redirect: "manual" });
      seen.push({
        httpMethod: req.method,
        rpc: rpcMethods(body),
        status: res.status,
        sourceAgent: req.headers.get("x-source-agent"),
        userAgent: req.headers.get("user-agent"),
        bearer: /^Bearer vbm_/.test(req.headers.get("authorization") ?? ""),
      });
      return new Response(res.body, { status: res.status, headers: res.headers });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    seen,
    from: (sourceAgent, rpc) => seen.filter((s) => s.sourceAgent === sourceAgent && s.rpc.includes(rpc)),
    stop: () => server.stop(true),
  };
}
