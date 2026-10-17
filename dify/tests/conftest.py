import json
import sys
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PLUGIN_ROOT))

FAKE_TOKEN = "vbm_test_not_a_real_token_000000"
API_URL = "https://valorbrain-api.valor.digital"


class FakeApi:
    """Records each request and answers from a queue of (status, body, headers)."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.responses: list[object] = []
        self.sleeps: list[float] = []

    def answer(self, status: int, body: object = None, headers: dict[str, str] | None = None) -> None:
        self.responses.append((status, body, headers or {}))

    def fail(self, error: Exception) -> None:
        self.responses.append(error)

    def body(self, index: int = -1) -> dict:
        return json.loads(self.requests[index].content)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.responses.pop(0)
        if isinstance(answer, Exception):
            raise answer
        status, body, headers = answer
        content = b"" if body is None else json.dumps(body).encode()
        return httpx.Response(status, content=content, headers={"Content-Type": "application/json", **headers})


@pytest.fixture
def fake_api(monkeypatch: pytest.MonkeyPatch) -> FakeApi:
    import valorbrain_client

    api = FakeApi()
    transport = httpx.MockTransport(api.handler)
    original: Callable = valorbrain_client.ValorBrainClient.__init__

    def init(self, api_token, api_url=None, **_ignored):
        original(self, api_token, api_url, transport=transport, sleep=api.sleeps.append)

    monkeypatch.setattr(valorbrain_client.ValorBrainClient, "__init__", init)
    return api


@pytest.fixture
def plugin_cwd(monkeypatch: pytest.MonkeyPatch) -> Path:
    """The Dify loader reads YAML paths relative to the plugin root."""
    monkeypatch.chdir(PLUGIN_ROOT)
    return PLUGIN_ROOT


def make_tool(tool_class, user_id: str | None = "dify-user-1", credentials: dict | None = None):
    from dify_plugin.core.runtime import Session
    from dify_plugin.entities.tool import ToolRuntime

    return tool_class(
        runtime=ToolRuntime(
            credentials=credentials or {"api_token": FAKE_TOKEN, "api_url": API_URL},
            user_id=user_id,
            session_id=None,
        ),
        session=Session.empty_session(),
    )


def run(tool, parameters: dict) -> list:
    return list(tool.invoke(dict(parameters)))
