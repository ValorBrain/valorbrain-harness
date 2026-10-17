"""Offline stand-in for the parts of Open WebUI that load and call a plugin.

It mirrors open_webui/utils/plugin.py (frontmatter + exec into a throwaway
module) and open_webui/utils/filter.py (valves, signature-based reserved
arguments, `__user__["valves"]`) as of Open WebUI v0.12.3, so the plugin files
are exercised the way the server runs them without installing Open WebUI.
"""

import asyncio
import inspect
import json
import re
import sys
import tempfile
import threading
import time
import types
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent.parent
FILTER_PATH = PLUGIN_DIR / "valorbrain_memory_filter.py"
TOOL_PATH = PLUGIN_DIR / "valorbrain_memory_tool.py"


def extract_frontmatter(content: str) -> dict:
    """Same parsing rule as open_webui.utils.plugin.extract_frontmatter."""
    lines = content.splitlines()
    if not lines or lines[0].strip() != '"""':
        return {}
    out = {}
    pattern = re.compile(r"^\s*([a-z_]+):\s*(.*)\s*$", re.IGNORECASE)
    for line in lines[1:]:
        if '"""' in line:
            break
        match = pattern.match(line)
        if match:
            out[match.group(1).strip()] = match.group(2).strip()
    return out


def load_plugin(path: Path):
    """Exec the file like Open WebUI does; return (instance, kind, frontmatter, module)."""
    content = path.read_text(encoding="utf-8")
    module_name = f"function_test_{uuid.uuid4().hex}"
    module = types.ModuleType(module_name)
    sys.modules[module_name] = module
    temp = tempfile.NamedTemporaryFile(delete=False)
    temp.close()
    try:
        module.__dict__["__file__"] = temp.name
        exec(content, module.__dict__)
        frontmatter = extract_frontmatter(content)
        for kind in ("Pipe", "Filter", "Action", "Event", "Tools"):
            if hasattr(module, kind):
                return getattr(module, kind)(), kind.lower(), frontmatter, module
        raise RuntimeError("no plugin class")
    finally:
        Path(temp.name).unlink()
        sys.modules.pop(module_name, None)


async def call_plugin(instance, handler_name: str, form_data: dict, extra_params: dict,
                      valves: dict | None = None, user_valves: dict | None = None,
                      plugin_id: str = "valorbrain_memory"):
    """Same steps as open_webui.utils.filter.process_filter_function."""
    if hasattr(instance, "valves") and hasattr(instance, "Valves"):
        instance.valves = instance.Valves(**(valves or {}))
    handler = getattr(instance, handler_name)
    sig = inspect.signature(handler)
    params = {"event": form_data} if handler_name == "stream" else {"body": form_data}
    params |= {k: v for k, v in {**extra_params, "__id__": plugin_id}.items() if k in sig.parameters}
    if "__user__" in sig.parameters and hasattr(instance, "UserValves"):
        params["__user__"]["valves"] = instance.UserValves(**(user_valves or {}))
    if inspect.iscoroutinefunction(handler):
        return await handler(**params)
    return handler(**params)


async def call_tool(instance, method: str, valves: dict | None = None, user_valves: dict | None = None,
                    user: dict | None = None, **kwargs):
    """Tool call as open_webui.utils.tools wires it: valves on the instance, __user__ with valves."""
    instance.valves = instance.Valves(**(valves or {}))
    handler = getattr(instance, method)
    sig = inspect.signature(handler)
    if "__user__" in sig.parameters:
        user = dict(user or make_user())
        user["valves"] = instance.UserValves(**(user_valves or {}))
        kwargs["__user__"] = user
    return await handler(**kwargs)


def make_user() -> dict:
    """UserModel.model_dump() shape (fields that matter here)."""
    return {
        "id": "8f6f5c3e-6c1b-4d0f-9a43-1b1b3c2f0a11",
        "name": "Ada",
        "email": "ada@example.com",
        "role": "user",
        "profile_image_url": "/user.png",
        "last_active_at": 1760700000,
        "updated_at": 1760700000,
        "created_at": 1760000000,
        "settings": None,
        "info": None,
        "oauth_sub": None,
    }


def make_inlet(user_text, chat_id="2b1b5a3c-0d2e-4a8a-9c1e-7f2a1c9d4e10", system=None, task=None):
    """form_data + extra_params at the inlet call (open_webui/utils/middleware.py, v0.12.3)."""
    messages = []
    if system is not None:
        messages.append({"role": "system", "content": system})
    messages += [
        {"role": "user", "content": "Hi there"},
        {"role": "assistant", "content": "Hello! How can I help?"},
        {"role": "user", "content": user_text},
    ]
    metadata = {
        "user_id": make_user()["id"],
        "user_agent": "Mozilla/5.0",
        "internal": False,
        "chat_id": chat_id,
        "user_message": {"id": "u-3", "role": "user", "content": user_text if isinstance(user_text, str) else ""},
        "user_message_id": "u-3",
        "assistant_message_id": "a-3",
        "session_id": "sess-1",
        "automation_id": None,
        "folder_id": None,
        "filter_ids": ["valorbrain_memory"],
        "tool_ids": None,
        "tool_servers": None,
        "files": None,
        "features": {"web_search": False, "image_generation": False, "code_interpreter": False},
        "variables": {"{{USER_NAME}}": "Ada"},
        "model": {"id": "llama3.1:8b", "name": "llama3.1:8b", "owned_by": "ollama"},
        "direct": False,
        "params": {"function_calling": "native"},
    }
    if task:
        metadata["task"] = task
    body = {
        "stream": True,
        "model": "llama3.1:8b",
        "messages": messages,
        "features": metadata["features"],
        "metadata": metadata,
        "tool_ids": None,
        "files": None,
    }
    extra = {
        "__event_emitter__": None,
        "__event_call__": None,
        "__user__": make_user(),
        "__metadata__": metadata,
        "__oauth_token__": None,
        "__request__": object(),
        "__model__": metadata["model"],
        "__chat_id__": chat_id,
        "__message_id__": "a-3",
    }
    return body, extra


def make_outlet(question, answer, chat_id="2b1b5a3c-0d2e-4a8a-9c1e-7f2a1c9d4e10", message_id="a-3"):
    """outlet_data + extra_params at the outlet call (open_webui/utils/middleware.py, v0.12.3)."""
    now = int(time.time())
    body = {
        "model": "llama3.1:8b",
        "messages": [
            {"id": "u-1", "role": "user", "content": "Hi there", "info": None, "timestamp": now - 60},
            {"id": "a-1", "role": "assistant", "content": "Hello! How can I help?", "info": None, "timestamp": now - 59},
            {"id": "u-3", "role": "user", "content": question, "info": None, "timestamp": now - 5},
            {
                "id": message_id,
                "role": "assistant",
                "content": answer,
                "info": None,
                "timestamp": now,
                "usage": {"prompt_tokens": 120, "completion_tokens": 40},
                "finish_reason": "stop",
            },
        ],
        "filter_ids": ["valorbrain_memory"],
        "chat_id": chat_id,
        "session_id": "sess-1",
        "id": message_id,
    }
    metadata = {
        "chat_id": chat_id,
        "message_id": message_id,
        "session_id": "sess-1",
        "user_id": make_user()["id"],
        "filter_ids": ["valorbrain_memory"],
    }
    extra = {
        "__event_emitter__": None,
        "__event_call__": None,
        "__user__": make_user(),
        "__metadata__": metadata,
        "__request__": object(),
        "__model__": {"id": "llama3.1:8b"},
    }
    return body, extra


class FakeValorBrain:
    """Local HTTP server that records requests and returns canned JSON."""

    def __init__(self):
        self.requests: list[dict] = []
        self.responses: dict[str, tuple[int, object]] = {}
        self.delay = 0.0
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length)
                owner.requests.append(
                    {"path": self.path, "headers": dict(self.headers), "json": json.loads(raw or b"{}")}
                )
                if owner.delay:
                    time.sleep(owner.delay)
                status, payload = owner.responses.get(self.path, (404, {"error": "not found"}))
                data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # the client timed out on purpose

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def run(coro):
    return asyncio.run(coro)
