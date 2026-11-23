"""Live tests against a ValorBrain *test* engine.

Run with ``pytest -m live`` and ``VB_STAGING_URL`` + ``VB_STAGING_MCP_TOKEN`` set.
Every test writes into a throwaway collection and forgets what it wrote.
"""

from __future__ import annotations

import os
import secrets
import time

import pytest

from valorbrain import NotFoundError, ValorBrain

URL = os.environ.get("VB_STAGING_URL")
TOKEN = os.environ.get("VB_STAGING_MCP_TOKEN")

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not (URL and TOKEN), reason="VB_STAGING_URL / VB_STAGING_MCP_TOKEN not set"),
]


def _wait(fn, timeout: float = 45.0, every: float = 2.0):
    deadline = time.monotonic() + timeout
    while True:
        value = fn()
        if value or time.monotonic() > deadline:
            return value
        time.sleep(every)


@pytest.fixture
def vb() -> ValorBrain:
    return ValorBrain(TOKEN, base_url=URL, integration="python-live-test")


@pytest.fixture
def collection(vb):
    name = f"hubpython-live-{secrets.token_hex(4)}"
    yield name
    for doc in vb.list_documents("**", collection=name, max_bytes=1000):
        try:
            vb.forget(doc["docid"])
        except NotFoundError:
            pass


def test_live_client_roundtrip(vb, collection):
    marker = secrets.token_hex(4)
    stored = vb.store(
        f"Live probe {marker}",
        f"Python client live probe {marker}: the capybara Odete only drinks hibiscus tea.",
        type="observation",
        collection=collection,
    )
    doc = vb.write_document(
        collection,
        f"facts/{marker}.md",
        f"Python client document {marker}: the heron Tibúrcio nests by the lake.",
        title=f"Heron fact {marker}",
        event_at="2026-10-01T12:00:00Z",
    )
    assert stored["ok"] and doc["docid"]

    hits = _wait(lambda: [h for h in vb.search(f"capybara Odete hibiscus {marker}", collection=collection) if marker in (h.get("title") or "")])
    assert hits, "stored memory never became searchable"
    heron = _wait(lambda: [h for h in vb.search(f"heron Tibúrcio lake {marker}", collection=collection, compact=False) if h["docid"] == doc["docid"]])
    assert heron and heron[0].get("eventAt", "").startswith("2026-10-01")

    assert "markdown" in vb.prepare(f"what does the capybara {marker} drink?", fast_mode=True)
    assert vb.used([doc["docid"]], note="live test")["marked"] >= 1

    assert vb.forget(doc["docid"])["forgotten"] is True
    assert vb.forget(str(stored["docid"]))["forgotten"] is True
    assert not [h for h in vb.search(f"heron Tibúrcio lake {marker}", collection=collection) if h["docid"] == doc["docid"]]
    with pytest.raises(NotFoundError):
        vb.get_document(doc["docid"])


def test_live_langchain_retriever(vb, collection):
    pytest.importorskip("langchain_core")
    from valorbrain.langchain import ValorBrainRetriever

    marker = secrets.token_hex(4)
    doc = vb.write_document(collection, f"lc/{marker}.md", f"LangChain live {marker}: the otter Quitéria collects blue pebbles.")
    retriever = ValorBrainRetriever(client=vb, k=5, collection=collection)
    docs = _wait(lambda: [d for d in retriever.invoke(f"otter Quitéria pebbles {marker}") if d.id == doc["docid"]])
    assert docs and marker in docs[0].page_content
    vb.forget(doc["docid"])


def test_live_langgraph_store(vb, collection):
    pytest.importorskip("langgraph")
    from valorbrain.langgraph import ValorBrainStore

    store = ValorBrainStore(vb, collection=collection)
    marker = secrets.token_hex(4)
    ns = ("users", f"u:{marker}")
    store.put(ns, "prefs", {"food": f"moqueca {marker}", "level": 3})
    assert store.get(ns, "prefs").value["food"] == f"moqueca {marker}"
    store.put(ns, "prefs", {"food": f"tacaca {marker}", "level": 5})
    assert store.get(ns, "prefs").value["food"] == f"tacaca {marker}"
    store.put(ns, "bio", {"text": f"enjoys sailing near Ilhabela {marker}"})

    assert {i.key for i in store.search(("users",))} == {"prefs", "bio"}
    assert [i.key for i in store.search(("users",), filter={"level": {"$gte": 4}})] == ["prefs"]
    hits = _wait(lambda: [i for i in store.search(("users",), query=f"sailing Ilhabela {marker}") if i.key == "bio"])
    assert hits and hits[0].score
    assert store.list_namespaces() == [ns]

    store.delete(ns, "prefs")
    assert store.get(ns, "prefs") is None
    store.put(ns, "prefs", {"food": f"acaraje {marker}"})  # put after delete
    assert store.get(ns, "prefs").value["food"] == f"acaraje {marker}"
    store.delete(ns, "prefs")
    store.delete(ns, "bio")
    assert store.search(("users",)) == []


def test_live_crewai_kickoff(vb, collection, monkeypatch):
    pytest.importorskip("crewai")
    monkeypatch.setenv("CREWAI_DISABLE_TELEMETRY", "true")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    from crewai import Agent, Crew, Task
    from crewai.llms.base_llm import BaseLLM

    from valorbrain.crewai import ValorBrainMemory

    marker = secrets.token_hex(4)
    seeded = vb.write_document(
        collection, f"seed/{marker}.md", f"Project Jandaia {marker}: the launch date is 2026-11-20."
    )
    assert _wait(lambda: vb.search(f"Project Jandaia launch date {marker}", collection=collection))

    prompts: list[str] = []

    class ScriptedLLM(BaseLLM):
        def call(self, messages, *args, **kwargs):
            prompts.append(messages if isinstance(messages, str) else "\n".join(str(m.get("content")) for m in messages))
            return f"Final Answer: Project Jandaia {marker} launches on 2026-11-20."

    memory = ValorBrainMemory(client=vb, collection=collection, recall_collection=collection)
    agent = Agent(role="Planner", goal="Answer using memory", backstory="Keeps dates straight.", llm=ScriptedLLM(model="scripted"), memory=memory)
    task = Task(description=f"When does Project Jandaia {marker} launch?", expected_output="A date", agent=agent)
    result = Crew(agents=[agent], tasks=[task], memory=memory).kickoff()

    assert "2026-11-20" in str(result)
    assert any("2026-11-20" in p and marker in p for p in prompts), "recalled memory not injected"
    saved = _wait(lambda: [d for d in vb.list_documents("**", collection=collection, max_bytes=100000) if d["docid"] != seeded["docid"]])
    assert saved and any("Result:" in (d.get("body") or "") for d in saved), "task result not saved to ValorBrain"
