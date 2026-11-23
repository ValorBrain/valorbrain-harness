"""Live check against a ValorBrain staging engine. Skipped unless both variables are set:

    VB_STAGING_URL        for example http://127.0.0.1:7439
    VB_STAGING_MCP_TOKEN  a vbm_ token of a disposable test tenant

It stores one memory in a fresh per-run collection, waits until search finds it (positive
control), reads it back through Prepare context, forgets it and checks that search no longer
finds it. The token is read from the environment and never printed.
"""

import os
import time
import uuid

import pytest
from conftest import make_tool, run

URL = os.environ.get("VB_STAGING_URL", "").strip()
TOKEN = os.environ.get("VB_STAGING_MCP_TOKEN", "").strip()
PRODUCTION_HOSTS = ("valorbrain-api.valor.digital", "mcpbrain.valor.digital")

pytestmark = pytest.mark.skipif(not (URL and TOKEN), reason="set VB_STAGING_URL and VB_STAGING_MCP_TOKEN")


def search(user_id: str, query: str) -> list:
    from tools.search_memory import SearchMemoryTool

    tool = make_tool(SearchMemoryTool, user_id=user_id, credentials={"api_token": TOKEN, "api_url": URL})
    return run(tool, {"query": query, "scope": "dify_user", "limit": 5})[1].message.json_object["results"]


def test_store_find_prepare_forget_round_trip():
    assert not any(host in URL for host in PRODUCTION_HOSTS), "the live test never runs against production"
    from provider.valorbrain import ValorBrainProvider
    from tools.forget_memory import ForgetMemoryTool
    from tools.prepare_context import PrepareContextTool
    from tools.store_memory import StoreMemoryTool

    credentials = {"api_token": TOKEN, "api_url": URL}
    ValorBrainProvider()._validate_credentials(credentials)

    run_id = uuid.uuid4().hex[:10]
    user_id = f"live-{run_id}"
    marker = f"tangerine-kayak-{run_id}"

    stored = run(
        make_tool(StoreMemoryTool, user_id=user_id, credentials=credentials),
        {
            "title": f"Dify live check {run_id}",
            "content": f"The Dify live check {run_id} keeps a {marker} in the garage.",
            "type": "observation",
            "scope": "dify_user",
            "tags": "live-check",
            "fail_open": False,
        },
    )[1].message.json_object
    assert stored["ok"] is True and stored["collection"] == f"dify-user-live-{run_id}"

    found = []
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and not found:
        found = [r for r in search(user_id, marker) if marker in str(r.get("snippet"))]
        if not found:
            time.sleep(2)
    assert found, "positive control: search did not find the stored memory within 30 s"

    context = run(
        make_tool(PrepareContextTool, user_id=user_id, credentials=credentials),
        {"message": f"Where is the {marker}?", "scope": "dify_user", "fail_open": False},
    )[0].message.text
    assert marker in context

    forgotten = run(
        make_tool(ForgetMemoryTool, user_id=user_id, credentials=credentials),
        {"docid": f"#{found[0]['docid']}", "scope": "dify_user"},
    )[1].message.json_object
    assert forgotten["forgotten"] is True

    assert not [r for r in search(user_id, marker) if marker in str(r.get("snippet"))]
