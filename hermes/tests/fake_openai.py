"""A canned OpenAI-compatible chat endpoint for running Hermes without a paid model.

Every request body is kept in `FakeOpenAI.requests`; every answer is
`FakeOpenAI.reply` (plain or streamed). Stdlib only.
"""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeOpenAI:
    def __init__(self, reply: str = "Noted."):
        self.reply = reply
        self.requests: list = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_a):
                pass

            def _json(self, payload: dict, status: int = 200):
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path.rstrip("/").endswith("/models"):
                    return self._json({"object": "list", "data": [{"id": "fake-model", "object": "model"}]})
                self._json({"error": "not found"}, 404)

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                owner.requests.append(body)
                usage = {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}
                base = {"id": f"chatcmpl-{len(owner.requests)}", "created": int(time.time()), "model": body.get("model") or "fake-model"}
                if not body.get("stream"):
                    return self._json({**base, "object": "chat.completion", "usage": usage, "choices": [
                        {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": owner.reply}}]})
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                chunks = [
                    {**base, "object": "chat.completion.chunk", "choices": [
                        {"index": 0, "delta": {"role": "assistant", "content": owner.reply}, "finish_reason": None}]},
                    {**base, "object": "chat.completion.chunk", "choices": [
                        {"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": usage},
                ]
                for chunk in chunks:
                    self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self._server.server_address[1]}/v1"
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self._server.shutdown()

    def user_messages(self) -> list:
        """Text of the last user message of every chat request, in order."""
        out = []
        for body in self.requests:
            users = [m for m in body.get("messages") or [] if m.get("role") == "user"]
            if not users:
                continue
            content = users[-1].get("content")
            if isinstance(content, list):
                content = "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
            out.append(content or "")
        return out
